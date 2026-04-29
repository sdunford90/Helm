import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createTestApp, buildCustomer, buildPayment } from '../helpers.js';
import { mockPrisma } from '../setup.js';
import { requireStripe } from '../../src/lib/stripe.js';

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
    // No onboarded locations and no invoices yet → resolver falls all the
    // way back to the tenant-level Stripe account.
    mockPrisma.location.findMany.mockResolvedValue([]);
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

  it('refuses to enable autopay when the default card on file is expired', async () => {
    // Customer has a card on file, but the one Stripe uses as the default
    // for invoice charges has already expired. The next off-session attempt
    // would be declined, so the route must reject the toggle with a clear
    // DEFAULT_CARD_EXPIRED code instead of writing metadata.autopay=true.
    mockPrisma.customer.findFirst.mockResolvedValue({
      id: 'cust-1',
      stripeCustomerId: 'cus_test',
      email: 'jane@example.com',
      firstName: 'Jane',
      lastName: 'Doe',
    } as any);
    mockTenantWithStripe();

    // Pick a year safely in the past so this case stays expired regardless
    // of when the test is run.
    const expiredCard = {
      id: 'pm_card_expired',
      card: { exp_month: 1, exp_year: 2000, brand: 'visa', last4: '4242' },
    };
    stripe.paymentMethods.list
      .mockResolvedValueOnce({ data: [expiredCard] }) // cards
      .mockResolvedValueOnce({ data: [] }); // banks
    stripe.customers.retrieve.mockResolvedValue({
      id: 'cus_test',
      invoice_settings: { default_payment_method: 'pm_card_expired' },
      metadata: { autopay: 'false' },
    } as any);

    const res = await request(app)
      .put('/api/customers/cust-1/autopay')
      .send({ autopay: true });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'DEFAULT_CARD_EXPIRED' });
    // Crucially, the metadata write must NOT happen on the rejection path,
    // otherwise we'd quietly flip the flag and get the very failure mode
    // this guard exists to prevent.
    expect(stripe.customers.update).not.toHaveBeenCalled();
  });

  it('allows enabling autopay when the default card is still valid', async () => {
    // Mirror image of the previous test: same default-card lookup path but
    // the card hasn't expired yet, so the route should fall through to the
    // metadata.autopay=true write. Picks a year far enough out to stay
    // valid for the lifetime of this codebase.
    mockPrisma.customer.findFirst.mockResolvedValue({
      id: 'cust-1',
      stripeCustomerId: 'cus_test',
      email: 'jane@example.com',
      firstName: 'Jane',
      lastName: 'Doe',
    } as any);
    mockTenantWithStripe();
    mockPrisma.auditLog.create.mockResolvedValue({} as any);

    const validCard = {
      id: 'pm_card_valid',
      card: { exp_month: 12, exp_year: 2099, brand: 'visa', last4: '4242' },
    };
    stripe.paymentMethods.list
      .mockResolvedValueOnce({ data: [validCard] })
      .mockResolvedValueOnce({ data: [] });
    stripe.customers.retrieve.mockResolvedValue({
      id: 'cus_test',
      invoice_settings: { default_payment_method: 'pm_card_valid' },
      metadata: { autopay: 'false' },
    } as any);

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
  });

  it('allows enabling autopay when the default card is expired but a non-card method is the default', async () => {
    // Bank accounts (us_bank_account) don't have an expiry, so even when an
    // expired card sits in the wallet the autopay toggle must work as long
    // as the actual default is the bank. This guards against false positives
    // from the new check.
    mockPrisma.customer.findFirst.mockResolvedValue({
      id: 'cust-1',
      stripeCustomerId: 'cus_test',
      email: 'jane@example.com',
      firstName: 'Jane',
      lastName: 'Doe',
    } as any);
    mockTenantWithStripe();
    mockPrisma.auditLog.create.mockResolvedValue({} as any);

    const expiredCard = {
      id: 'pm_card_expired',
      card: { exp_month: 1, exp_year: 2000, brand: 'visa', last4: '4242' },
    };
    stripe.paymentMethods.list
      .mockResolvedValueOnce({ data: [expiredCard] })
      .mockResolvedValueOnce({ data: [{ id: 'pm_bank_default' }] });
    stripe.customers.retrieve.mockResolvedValue({
      id: 'cus_test',
      invoice_settings: { default_payment_method: 'pm_bank_default' },
      metadata: { autopay: 'false' },
    } as any);

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
    mockPrisma.location.findMany.mockResolvedValue([]);
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

describe('POST /api/customers/:id/payments/:paymentId/refund', () => {
  // Mirrors the key remaining-balance scenarios already covered for the
  // sibling /api/payments/:id/refund handler, since both endpoints share
  // the reserve-then-charge + atomic-decrement-rollback flow and must
  // behave identically with respect to the new refundedCents ledger.

  it('rejects a partial refund that exceeds the remaining refundable balance', async () => {
    const customer = buildCustomer({ id: 'cust-partial' });
    // $1000 originally, $700 already refunded → only $300 remaining;
    // a $400 request must fail even though it's < the original amount.
    const payment = buildPayment({
      id: 'pay-cust-partial',
      amountCents: 100000,
      refundedCents: 70000,
      status: 'PARTIALLY_REFUNDED',
      stripePaymentId: 'pi_cust_partial',
      invoice: {
        id: 'inv-cust',
        balanceCents: 70000,
        totalCents: 100000,
        status: 'ISSUED',
        location: { stripeAccountId: 'acct_x' },
      },
    });

    mockPrisma.customer.findFirst.mockResolvedValue(customer);
    mockPrisma.payment.findFirst.mockResolvedValue(payment);

    const res = await request(app)
      .post('/api/customers/cust-partial/payments/pay-cust-partial/refund')
      .send({ amountCents: 40000 });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('code', 'EXCESS_REFUND');
  });

  it('rejects refund when the ledger is already exhausted', async () => {
    const customer = buildCustomer({ id: 'cust-exhausted' });
    const payment = buildPayment({
      id: 'pay-cust-exhausted',
      amountCents: 100000,
      refundedCents: 100000,
      status: 'PARTIALLY_REFUNDED',
      stripePaymentId: 'pi_cust_exhausted',
    });

    mockPrisma.customer.findFirst.mockResolvedValue(customer);
    mockPrisma.payment.findFirst.mockResolvedValue(payment);

    const res = await request(app)
      .post('/api/customers/cust-exhausted/payments/pay-cust-exhausted/refund')
      .send({ amountCents: 1000 });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('code', 'ALREADY_REFUNDED');
  });

  it('returns REFUND_CONFLICT and does not call Stripe when a concurrent refund wins the race', async () => {
    const customer = buildCustomer({ id: 'cust-race' });
    const payment = buildPayment({
      id: 'pay-cust-race',
      amountCents: 100000,
      refundedCents: 0,
      status: 'COMPLETED',
      stripePaymentId: 'pi_cust_race',
      invoice: {
        id: 'inv-race',
        balanceCents: 0,
        totalCents: 100000,
        status: 'PAID',
        location: { stripeAccountId: 'acct_x' },
      },
    });

    mockPrisma.customer.findFirst.mockResolvedValue(customer);
    mockPrisma.payment.findFirst.mockResolvedValue(payment);
    // Optimistic guard fails — a concurrent caller already bumped
    // refundedCents past the prior value.
    mockPrisma.payment.updateMany.mockResolvedValue({ count: 0 });

    const stripe = requireStripe();
    (stripe.refunds.create as any).mockClear();

    const res = await request(app)
      .post('/api/customers/cust-race/payments/pay-cust-race/refund')
      .send({ amountCents: 50000 });

    expect(res.status).toBe(409);
    expect(res.body).toHaveProperty('code', 'REFUND_CONFLICT');
    // Critical: no external charge issued for the losing request.
    expect(stripe.refunds.create).not.toHaveBeenCalled();
  });

  it('accepts a partial top-up and atomically updates the refundedCents ledger', async () => {
    const customer = buildCustomer({ id: 'cust-ok' });
    const payment = buildPayment({
      id: 'pay-cust-ok',
      amountCents: 100000,
      refundedCents: 60000,
      status: 'PARTIALLY_REFUNDED',
      stripePaymentId: null, // skip the Stripe path
      invoice: {
        id: 'inv-ok',
        balanceCents: 60000,
        totalCents: 100000,
        status: 'ISSUED',
        location: { stripeAccountId: 'acct_x' },
      },
    });

    mockPrisma.customer.findFirst.mockResolvedValue(customer);
    mockPrisma.payment.findFirst.mockResolvedValue(payment);
    mockPrisma.payment.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.payment.findUniqueOrThrow.mockResolvedValue({
      ...payment,
      refundedCents: 100000,
      status: 'REFUNDED',
    });
    mockPrisma.invoice.update.mockResolvedValue({});
    mockPrisma.auditLog.create.mockResolvedValue({});

    const res = await request(app)
      .post('/api/customers/cust-ok/payments/pay-cust-ok/refund')
      .send({ amountCents: 40000 });

    expect(res.status).toBe(200);
    // Atomic guard: updateMany must filter on the prior refundedCents
    // value to detect concurrent refunds.
    expect(mockPrisma.payment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'pay-cust-ok',
          refundedCents: 60000,
        }),
        data: expect.objectContaining({
          refundedCents: 100000,
          status: 'REFUNDED',
        }),
      }),
    );
  });
});

describe('GET /api/customers/:id/payment-history', () => {
  it('annotates each payment with its refundCount so the UI can mark expandable rows', async () => {
    // The history endpoint runs a single groupBy across the page of
    // payments rather than fetching every refund up front; the per-row
    // refundCount lets the UI lazy-load the actual rows on expand.
    mockPrisma.customer.findFirst.mockResolvedValue({ id: 'cust-1' });
    mockPrisma.payment.findMany.mockResolvedValue([
      buildPayment({ id: 'pay-a', amountCents: 100000, refundedCents: 30000 }),
      buildPayment({ id: 'pay-b', amountCents: 50000, refundedCents: 0 }),
    ]);
    mockPrisma.payment.count.mockResolvedValue(2);
    mockPrisma.auditLog.findMany.mockResolvedValue([]);
    mockPrisma.paymentRefund.groupBy.mockResolvedValue([
      { paymentId: 'pay-a', _count: { _all: 2 } },
    ]);

    const res = await request(app).get('/api/customers/cust-1/payment-history');

    expect(res.status).toBe(200);
    const byId = Object.fromEntries(res.body.data.map((p: any) => [p.id, p]));
    expect(byId['pay-a'].refundCount).toBe(2);
    // Payments with no refunds should still report 0 (not undefined) so
    // the UI never has to coerce missing values.
    expect(byId['pay-b'].refundCount).toBe(0);
  });
});

// The Cards-on-File resolver used to declare a customer "Stripe not set up"
// whenever the customer's most-recent-invoice location wasn't onboarded —
// even when other locations on the same tenant were. The new resolver falls
// back across onboarded locations (and finally the tenant Stripe account)
// and exposes the candidate list so the UI can show a picker.
describe('GET /api/customers/:id/payment-methods — resolver fallback', () => {
  function setupCustomer() {
    mockPrisma.customer.findFirst.mockResolvedValue({
      id: 'cust-1',
      stripeCustomerId: null, // not yet a Stripe customer — short-circuits Stripe call
    });
  }

  it('falls back to a fully-onboarded location when the customer has no invoices', async () => {
    setupCustomer();
    mockPrisma.location.findMany.mockResolvedValue([
      { id: 'loc-A', name: 'Main Marina', stripeAccountId: 'acct_main' },
    ]);
    mockPrisma.invoice.findFirst.mockResolvedValue(null);

    const res = await request(app).get('/api/customers/cust-1/payment-methods');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      stripeConfigured: true,
      locationConnected: true,
      locationId: 'loc-A',
      locationName: 'Main Marina',
    });
    expect(res.body.candidates).toEqual([
      { locationId: 'loc-A', locationName: 'Main Marina', stripeAccountId: 'acct_main' },
    ]);
  });

  it('exposes every onboarded location as a candidate when there are multiple', async () => {
    setupCustomer();
    mockPrisma.location.findMany.mockResolvedValue([
      { id: 'loc-A', name: 'Bayfront', stripeAccountId: 'acct_a' },
      { id: 'loc-B', name: 'Riverside', stripeAccountId: 'acct_b' },
    ]);
    mockPrisma.invoice.findFirst.mockResolvedValue(null);

    const res = await request(app).get('/api/customers/cust-1/payment-methods');
    expect(res.status).toBe(200);
    expect(res.body.stripeConfigured).toBe(true);
    expect(res.body.candidates).toHaveLength(2);
    // Resolver picks the first deterministically; UI renders the picker.
    expect(res.body.locationId).toBe('loc-A');
  });

  it('honors the ?locationId= picker when staff explicitly choose an onboarded location', async () => {
    setupCustomer();
    mockPrisma.location.findMany.mockResolvedValue([
      { id: 'loc-A', name: 'Bayfront', stripeAccountId: 'acct_a' },
      { id: 'loc-B', name: 'Riverside', stripeAccountId: 'acct_b' },
    ]);
    mockPrisma.invoice.findFirst.mockResolvedValue(null);

    const res = await request(app).get(
      '/api/customers/cust-1/payment-methods?locationId=loc-B',
    );
    expect(res.status).toBe(200);
    expect(res.body.locationId).toBe('loc-B');
    expect(res.body.locationName).toBe('Riverside');
  });

  it('returns candidates with the {locationId, locationName, stripeAccountId} contract the web UI consumes', async () => {
    // Lock the field shape so a future rename in the resolver can't silently
    // break the customer-file Stripe location picker (which reads
    // `c.locationId`/`c.locationName`).
    setupCustomer();
    mockPrisma.location.findMany.mockResolvedValue([
      { id: 'loc-A', name: 'Bayfront', stripeAccountId: 'acct_a' },
      { id: 'loc-B', name: 'Riverside', stripeAccountId: 'acct_b' },
    ]);
    mockPrisma.invoice.findFirst.mockResolvedValue(null);

    const res = await request(app).get('/api/customers/cust-1/payment-methods');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.candidates)).toBe(true);
    for (const c of res.body.candidates) {
      expect(c).toEqual(expect.objectContaining({
        locationId: expect.any(String),
        locationName: expect.any(String),
        stripeAccountId: expect.any(String),
      }));
      // Catch a regression where someone copies the old `{id, name}` shape:
      expect(c).not.toHaveProperty('id');
      expect(c).not.toHaveProperty('name');
    }
  });

  it('pins the SetupIntent to the operator-picked location when one is supplied', async () => {
    // The web UI sends `locationId` from the picker so the new card lands
    // on the same Connect account the staff is currently looking at — this
    // test prevents the server from silently ignoring that field and
    // dropping back to the resolver default (which would drop the new card
    // onto a different connected account).
    mockPrisma.customer.findFirst.mockResolvedValue({ id: 'cust-1' });
    mockPrisma.location.findMany.mockResolvedValue([
      { id: 'loc-A', name: 'Bayfront', stripeAccountId: 'acct_a' },
      { id: 'loc-B', name: 'Riverside', stripeAccountId: 'acct_b' },
    ]);
    mockPrisma.invoice.findFirst.mockResolvedValue(null);
    mockPrisma.customer.update.mockResolvedValue({
      id: 'cust-1',
      stripeCustomerId: 'cus_pinned',
    });

    const stripeMod = await import('../../src/lib/stripe.js');
    const checkout = (stripeMod.stripe as any).checkout.sessions
      .create as ReturnType<typeof vi.fn>;
    checkout.mockClear();

    const res = await request(app)
      .post('/api/customers/cust-1/payment-methods/setup-session')
      .send({
        type: 'card',
        returnUrl: 'https://example.com/customers/cust-1?tab=payments',
        locationId: 'loc-B',
      });

    expect(res.status).toBe(200);
    expect(checkout).toHaveBeenCalledTimes(1);
    const [, options] = checkout.mock.calls[0];
    // Direct-charge: connected account is in the request *options*. With
    // locationId=loc-B the server must use loc-B's Stripe account, not
    // loc-A (the default first-candidate the resolver would have picked).
    expect(options).toEqual({ stripeAccount: 'acct_b' });
  });

  it('reports "not configured" only when no onboarded location AND no tenant account exist', async () => {
    setupCustomer();
    mockPrisma.location.findMany.mockResolvedValue([]);
    mockPrisma.invoice.findFirst.mockResolvedValue(null);
    mockPrisma.tenant.findUnique.mockResolvedValue({ stripeAccountId: null });

    const res = await request(app).get('/api/customers/cust-1/payment-methods');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      stripeConfigured: false,
      locationConnected: false,
      candidates: [],
    });
  });
});

describe('GET /api/customers/:id/payments/:paymentId/refunds', () => {
  it('returns the refund history for a payment scoped to the customer', async () => {
    // Tenant + customer scope is enforced via the payment lookup; this
    // verifies that a positive lookup hits paymentRefund.findMany with
    // the correct filter and returns the rows newest-first.
    mockPrisma.customer.findFirst.mockResolvedValue({ id: 'cust-1' });
    mockPrisma.payment.findFirst.mockResolvedValue(
      buildPayment({ id: 'pay-x', customerId: 'cust-1' }),
    );
    mockPrisma.paymentRefund.findMany.mockResolvedValue([
      {
        id: 'r1',
        paymentId: 'pay-x',
        amountCents: 5000,
        reason: 'fee dispute',
        userId: 'u1',
        userName: 'admin@test.com',
        stripeRefundId: null,
        isFullRefund: false,
        source: 'customer-payment-history',
        createdAt: new Date('2026-04-21T00:00:00Z'),
      },
    ]);

    const res = await request(app).get(
      '/api/customers/cust-1/payments/pay-x/refunds',
    );

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({ id: 'r1', amountCents: 5000 });
    expect(mockPrisma.paymentRefund.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ paymentId: 'pay-x' }),
        orderBy: expect.objectContaining({ createdAt: 'asc' }),
      }),
    );
  });
});
