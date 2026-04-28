import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createTestApp, buildCustomer } from '../helpers.js';
import { mockPrisma } from '../setup.js';

let app: Express;

beforeAll(async () => {
  app = await createTestApp();
});

beforeEach(() => {
  Object.values(mockPrisma).forEach((model) => {
    if (typeof model === 'object' && model !== null) {
      Object.values(model).forEach((fn) => {
        if (typeof fn === 'function' && 'mockReset' in fn) {
          (fn as any).mockReset();
        }
      });
    }
  });
});

describe('GET /api/customers', () => {
  it('returns a paginated list of customers', async () => {
    const customers = [buildCustomer(), buildCustomer({ id: 'cust-2', firstName: 'Bob' })];
    mockPrisma.customer.findMany.mockResolvedValue(customers);
    mockPrisma.customer.count.mockResolvedValue(2);
    mockPrisma.invoice.groupBy.mockResolvedValue([]);

    const res = await request(app).get('/api/customers');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(res.body).toHaveProperty('pagination');
    expect(res.body.data).toHaveLength(2);
    expect(res.body.pagination).toHaveProperty('total', 2);
    expect(res.body.pagination).toHaveProperty('skip');
    expect(res.body.pagination).toHaveProperty('take');
  });

  it('returns empty list when no customers exist', async () => {
    mockPrisma.customer.findMany.mockResolvedValue([]);
    mockPrisma.customer.count.mockResolvedValue(0);

    const res = await request(app).get('/api/customers');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
    expect(res.body.pagination.total).toBe(0);
  });

  it('supports status filter', async () => {
    mockPrisma.customer.findMany.mockResolvedValue([]);
    mockPrisma.customer.count.mockResolvedValue(0);

    const res = await request(app).get('/api/customers?status=ACTIVE');

    expect(res.status).toBe(200);
    expect(mockPrisma.customer.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'ACTIVE' }),
      }),
    );
  });

  it('supports search query', async () => {
    mockPrisma.customer.findMany.mockResolvedValue([]);
    mockPrisma.customer.count.mockResolvedValue(0);

    const res = await request(app).get('/api/customers?search=Jane');

    expect(res.status).toBe(200);
    expect(mockPrisma.customer.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            expect.objectContaining({ firstName: expect.any(Object) }),
          ]),
        }),
      }),
    );
  });
});

describe('POST /api/customers', () => {
  it('creates a customer with valid data', async () => {
    const newCustomer = buildCustomer();
    mockPrisma.customer.create.mockResolvedValue(newCustomer);
    mockPrisma.auditLog.create.mockResolvedValue({});

    const res = await request(app)
      .post('/api/customers')
      .send({ firstName: 'Jane', lastName: 'Smith' });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
    expect(res.body).toHaveProperty('firstName');
    expect(mockPrisma.customer.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: 'test-tenant-id',
          firstName: 'Jane',
          lastName: 'Smith',
        }),
      }),
    );
  });

  it('creates a customer with optional fields', async () => {
    const newCustomer = buildCustomer({ email: 'jane@test.com', phone: '5559876543' });
    mockPrisma.customer.create.mockResolvedValue(newCustomer);
    mockPrisma.auditLog.create.mockResolvedValue({});

    const res = await request(app)
      .post('/api/customers')
      .send({
        firstName: 'Jane',
        lastName: 'Smith',
        email: 'jane@test.com',
        phone: '5559876543',
      });

    expect(res.status).toBe(201);
  });

  it('rejects invalid email', async () => {
    const res = await request(app)
      .post('/api/customers')
      .send({ firstName: 'Jane', lastName: 'Smith', email: 'bad-email' });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('code', 'VALIDATION_ERROR');
    expect(res.body.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'email' }),
      ]),
    );
  });

  it('rejects missing firstName', async () => {
    const res = await request(app)
      .post('/api/customers')
      .send({ lastName: 'Smith' });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('code', 'VALIDATION_ERROR');
  });

  it('rejects missing lastName', async () => {
    const res = await request(app)
      .post('/api/customers')
      .send({ firstName: 'Jane' });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('code', 'VALIDATION_ERROR');
  });
});

describe('GET /api/customers/:id', () => {
  it('returns a single customer with related data', async () => {
    const customer = buildCustomer({
      boats: [],
      slipContracts: [],
      securityDeposits: [],
    });
    mockPrisma.customer.findFirst.mockResolvedValue(customer);
    mockPrisma.invoice.groupBy.mockResolvedValue([]);
    mockPrisma.invoice.aggregate.mockResolvedValue({ _sum: { balanceCents: 0 } });
    mockPrisma.payment.aggregate.mockResolvedValue({ _sum: { amountCents: 0 } });
    mockPrisma.securityDeposit.aggregate.mockResolvedValue({ _sum: { amountCents: 0 } });

    const res = await request(app).get('/api/customers/cust-1');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('id', 'cust-1');
    expect(res.body).toHaveProperty('firstName');
    expect(res.body).toHaveProperty('invoiceSummary');
    expect(res.body).toHaveProperty('complianceScore');
    expect(res.body).toHaveProperty('balanceSummary');
  });

  it('returns 404 for non-existent customer', async () => {
    mockPrisma.customer.findFirst.mockResolvedValue(null);

    const res = await request(app).get('/api/customers/non-existent');

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('code', 'NOT_FOUND');
  });
});

describe('PUT /api/customers/:id/autopay', () => {
  // Reach into the same Stripe mock the route uses, so each test can
  // tweak the per-call return values (cards on file, customer metadata).
  let stripe: {
    customers: {
      retrieve: ReturnType<typeof import('vitest').vi.fn>;
      update: ReturnType<typeof import('vitest').vi.fn>;
      create: ReturnType<typeof import('vitest').vi.fn>;
    };
    paymentMethods: { list: ReturnType<typeof import('vitest').vi.fn> };
  };

  beforeAll(async () => {
    stripe = (await import('../../src/lib/stripe.js')).stripe as any;
  });

  beforeEach(() => {
    // The outer beforeEach only resets prisma mocks; reset Stripe spies too
    // so each test sees a clean call count and can stack its own per-test
    // mockResolvedValueOnce returns without leftover state.
    stripe.customers.retrieve.mockReset();
    stripe.customers.update.mockReset();
    stripe.customers.create.mockReset();
    stripe.paymentMethods.list.mockReset();
    stripe.customers.retrieve.mockResolvedValue({
      id: 'cus_test',
      metadata: { autopay: 'true' },
    });
    stripe.customers.update.mockResolvedValue({ id: 'cus_test' });
    stripe.customers.create.mockResolvedValue({ id: 'cus_test' });
    stripe.paymentMethods.list.mockResolvedValue({ data: [] });
  });

  function mockTenantWithStripe() {
    // No invoices yet → falls back to tenant-level Stripe account.
    mockPrisma.invoice.findFirst.mockResolvedValue(null);
    mockPrisma.tenant.findUnique.mockResolvedValue({
      stripeAccountId: 'acct_test',
    } as any);
  }

  it('enables autopay when the customer has a card on file', async () => {
    // Route looks up the customer twice: once at the top of the handler,
    // once inside ensureStripeCustomer. Return the same row both times.
    mockPrisma.customer.findFirst.mockResolvedValue({
      id: 'cust-1',
      stripeCustomerId: 'cus_test',
      email: 'jane@example.com',
      firstName: 'Jane',
      lastName: 'Doe',
    } as any);
    mockTenantWithStripe();
    mockPrisma.auditLog.create.mockResolvedValue({} as any);

    stripe.paymentMethods.list
      .mockResolvedValueOnce({ data: [{ id: 'pm_card_1' }] }) // cards
      .mockResolvedValueOnce({ data: [] }); // banks

    const res = await request(app)
      .put('/api/customers/cust-1/autopay')
      .send({ autopay: true });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ autopay: true });
    expect(stripe.customers.update).toHaveBeenCalledWith(
      'cus_test',
      { metadata: { autopay: 'true' } },
      { stripeAccount: 'acct_test' },
    );
    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'AUTOPAY_CHANGED',
          recordType: 'Customer',
          recordId: 'cust-1',
          changedFieldsJson: { autopay: true },
        }),
      }),
    );
  });

  it('refuses to enable autopay when no payment methods are saved', async () => {
    mockPrisma.customer.findFirst.mockResolvedValue({
      id: 'cust-1',
      stripeCustomerId: 'cus_test',
      email: 'jane@example.com',
      firstName: 'Jane',
      lastName: 'Doe',
    } as any);
    mockTenantWithStripe();

    stripe.paymentMethods.list
      .mockResolvedValueOnce({ data: [] }) // cards
      .mockResolvedValueOnce({ data: [] }); // banks

    const res = await request(app)
      .put('/api/customers/cust-1/autopay')
      .send({ autopay: true });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'NO_PAYMENT_METHOD' });
    expect(stripe.customers.update).not.toHaveBeenCalled();
  });

  it('always allows disabling autopay, even with no cards on file', async () => {
    mockPrisma.customer.findFirst.mockResolvedValue({
      id: 'cust-1',
      stripeCustomerId: 'cus_test',
      email: 'jane@example.com',
      firstName: 'Jane',
      lastName: 'Doe',
    } as any);
    mockTenantWithStripe();
    mockPrisma.auditLog.create.mockResolvedValue({} as any);

    const res = await request(app)
      .put('/api/customers/cust-1/autopay')
      .send({ autopay: false });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ autopay: false });
    // The "skip the cards check on disable" branch must NOT call list.
    expect(stripe.paymentMethods.list).not.toHaveBeenCalled();
    expect(stripe.customers.update).toHaveBeenCalledWith(
      'cus_test',
      { metadata: { autopay: 'false' } },
      { stripeAccount: 'acct_test' },
    );
  });

  it('upserts a Stripe customer when disabling autopay for someone never charged before', async () => {
    // Edge case flagged in code review: Stripe is configured for the
    // tenant, but the local customer row has no stripeCustomerId yet
    // (they've never been charged). Disabling autopay must succeed —
    // the route should call ensureStripeCustomer to lazily create the
    // Stripe record and then write metadata.autopay: "false".
    mockPrisma.customer.findFirst.mockResolvedValue({
      id: 'cust-1',
      stripeCustomerId: null,
      email: 'jane@example.com',
      firstName: 'Jane',
      lastName: 'Doe',
    } as any);
    mockPrisma.customer.update.mockResolvedValue({} as any);
    mockTenantWithStripe();
    mockPrisma.auditLog.create.mockResolvedValue({} as any);
    stripe.customers.create.mockResolvedValue({ id: 'cus_new' });

    const res = await request(app)
      .put('/api/customers/cust-1/autopay')
      .send({ autopay: false });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ autopay: false });
    // ensureStripeCustomer creates the Stripe-side record on the
    // tenant's Connect account.
    expect(stripe.customers.create).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ helmCustomerId: 'cust-1' }),
      }),
      { stripeAccount: 'acct_test' },
    );
    // Then the freshly-created customer gets autopay=false written to
    // its metadata — same Connect account, no cross-account drift.
    expect(stripe.customers.update).toHaveBeenCalledWith(
      'cus_new',
      { metadata: { autopay: 'false' } },
      { stripeAccount: 'acct_test' },
    );
  });

  it('returns STRIPE_NOT_CONFIGURED when no Stripe account is connected', async () => {
    mockPrisma.customer.findFirst.mockResolvedValue({
      id: 'cust-1',
      stripeCustomerId: null,
    } as any);
    mockPrisma.invoice.findFirst.mockResolvedValue(null);
    mockPrisma.tenant.findUnique.mockResolvedValue({ stripeAccountId: null } as any);

    const res = await request(app)
      .put('/api/customers/cust-1/autopay')
      .send({ autopay: true });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'STRIPE_NOT_CONFIGURED' });
  });

  it('returns 404 for an unknown customer', async () => {
    mockPrisma.customer.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .put('/api/customers/missing/autopay')
      .send({ autopay: true });

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('code', 'NOT_FOUND');
  });

  it('refuses to expose customers from another tenant', async () => {
    // The route looks up the customer with `where: { id, tenantId }`. The
    // request comes through the test app under tenantId "test-tenant-id"
    // (see tenantMiddleware mock in tests/setup.ts). A customer that
    // exists in a different tenant would NOT match that compound where —
    // mirror that by returning null and confirm the endpoint refuses the
    // write without ever touching Stripe.
    mockPrisma.customer.findFirst.mockImplementation(({ where }: any) => {
      // Sanity-check the route is actually scoping by tenantId so this
      // test would catch a regression that drops it.
      expect(where).toEqual(expect.objectContaining({ tenantId: 'test-tenant-id' }));
      return Promise.resolve(null);
    });

    const res = await request(app)
      .put('/api/customers/cust-belongs-to-other-tenant/autopay')
      .send({ autopay: true });

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('code', 'NOT_FOUND');
    expect(stripe.customers.update).not.toHaveBeenCalled();
    expect(mockPrisma.auditLog.create).not.toHaveBeenCalled();
  });
});
