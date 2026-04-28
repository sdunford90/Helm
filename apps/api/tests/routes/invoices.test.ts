import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createTestApp, buildInvoice, buildCustomer } from '../helpers.js';
import { mockPrisma } from '../setup.js';
// tax-engine is module-mocked in setup.ts; pull the mocked fn so we can
// assert exactly what the invoice route passes in (locationId, per-line
// taxCategory, per-line amountCents) and stub its return values.
import { calculateTax } from '../../src/services/tax-engine.js';
const mockCalculateTax = vi.mocked(calculateTax);

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

describe('GET /api/invoices', () => {
  it('returns a paginated list of invoices', async () => {
    const invoices = [buildInvoice(), buildInvoice({ id: 'inv-2', invoiceNumber: 'INV-1002' })];
    mockPrisma.invoice.findMany.mockResolvedValue(invoices);
    mockPrisma.invoice.count.mockResolvedValue(2);

    const res = await request(app).get('/api/invoices');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(res.body).toHaveProperty('pagination');
    expect(res.body.data).toHaveLength(2);
    expect(res.body.pagination).toHaveProperty('total', 2);
    expect(res.body.pagination).toHaveProperty('skip');
    expect(res.body.pagination).toHaveProperty('take');
  });

  it('returns empty list when no invoices exist', async () => {
    mockPrisma.invoice.findMany.mockResolvedValue([]);
    mockPrisma.invoice.count.mockResolvedValue(0);

    const res = await request(app).get('/api/invoices');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
    expect(res.body.pagination.total).toBe(0);
  });

  it('supports status filter', async () => {
    mockPrisma.invoice.findMany.mockResolvedValue([]);
    mockPrisma.invoice.count.mockResolvedValue(0);

    const res = await request(app).get('/api/invoices?status=ISSUED');

    expect(res.status).toBe(200);
    expect(mockPrisma.invoice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'ISSUED' }),
      }),
    );
  });

  it('supports customerId filter', async () => {
    mockPrisma.invoice.findMany.mockResolvedValue([]);
    mockPrisma.invoice.count.mockResolvedValue(0);

    const res = await request(app).get('/api/invoices?customerId=550e8400-e29b-41d4-a716-446655440000');

    expect(res.status).toBe(200);
    expect(mockPrisma.invoice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ customerId: '550e8400-e29b-41d4-a716-446655440000' }),
      }),
    );
  });
});

describe('POST /api/invoices', () => {
  it('creates an invoice with line items', async () => {
    const customer = buildCustomer();
    const invoice = buildInvoice({ status: 'DRAFT' });
    mockPrisma.customer.findFirst.mockResolvedValue(customer);
    mockPrisma.invoice.create.mockResolvedValue(invoice);
    mockPrisma.auditLog.create.mockResolvedValue({});

    const res = await request(app)
      .post('/api/invoices')
      .send({
        customerId: '550e8400-e29b-41d4-a716-446655440000',
        issuedDate: '2025-01-15',
        dueDate: '2025-02-15',
        lineItems: [
          {
            description: 'Slip rental - January',
            quantity: 1,
            unitPriceCents: 100000,
          },
        ],
      });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
    expect(mockPrisma.invoice.create).toHaveBeenCalled();
  });

  it('rejects invoice without line items', async () => {
    const res = await request(app)
      .post('/api/invoices')
      .send({
        customerId: '550e8400-e29b-41d4-a716-446655440000',
        issuedDate: '2025-01-15',
        dueDate: '2025-02-15',
        lineItems: [],
      });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('code', 'VALIDATION_ERROR');
  });

  it('rejects invoice without customerId', async () => {
    const res = await request(app)
      .post('/api/invoices')
      .send({
        issuedDate: '2025-01-15',
        dueDate: '2025-02-15',
        lineItems: [{ description: 'Test', quantity: 1, unitPriceCents: 5000 }],
      });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('code', 'VALIDATION_ERROR');
  });

  it('returns 404 when customer does not exist', async () => {
    mockPrisma.customer.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/invoices')
      .send({
        customerId: '550e8400-e29b-41d4-a716-446655440000',
        issuedDate: '2025-01-15',
        dueDate: '2025-02-15',
        lineItems: [{ description: 'Test', quantity: 1, unitPriceCents: 5000 }],
      });

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('code', 'CUSTOMER_NOT_FOUND');
  });
});

describe('GET /api/invoices/:id', () => {
  it('returns an invoice with line items and GL entries', async () => {
    const invoice = buildInvoice();
    mockPrisma.invoice.findFirst.mockResolvedValue(invoice);
    mockPrisma.glEntry.findMany.mockResolvedValue([]);

    const res = await request(app).get('/api/invoices/inv-1');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('id', 'inv-1');
    expect(res.body).toHaveProperty('invoiceNumber');
    expect(res.body).toHaveProperty('lineItems');
    expect(res.body).toHaveProperty('glEntries');
    expect(res.body).toHaveProperty('customer');
    expect(Array.isArray(res.body.lineItems)).toBe(true);
  });

  it('returns 404 for non-existent invoice', async () => {
    mockPrisma.invoice.findFirst.mockResolvedValue(null);

    const res = await request(app).get('/api/invoices/non-existent');

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('code', 'NOT_FOUND');
  });
});

describe('POST /api/invoices — tax derivation', () => {
  // The tax-engine module is globally mocked in setup.ts so these tests
  // assert on what the invoice route actually feeds calculateTax with
  // (locationId, per-line taxCategory, taxable line amountCents) rather
  // than depending on real tax-engine behavior.

  beforeEach(() => {
    mockCalculateTax.mockReset();
    mockPrisma.customer.findFirst.mockResolvedValue(buildCustomer());
    mockPrisma.invoice.create.mockResolvedValue(buildInvoice({ status: 'DRAFT' }));
    mockPrisma.auditLog?.create?.mockResolvedValue?.({});
  });

  it('forwards per-line taxCategory inherited from product category default', async () => {
    // Two product line items; neither carries a caller-supplied taxCategory,
    // so the route must batch-load the products and inherit the category's
    // defaultTaxCategory ("food") for both lines.
    const FOOD_1 = '11111111-1111-4111-8111-111111111111';
    const FOOD_2 = '22222222-2222-4222-8222-222222222222';
    mockPrisma.product.findMany.mockResolvedValue([
      {
        id: FOOD_1,
        taxClass: null,
        productCategory: { defaultTaxCategory: 'food', taxable: true },
      },
      {
        id: FOOD_2,
        taxClass: null,
        productCategory: { defaultTaxCategory: 'food', taxable: true },
      },
    ]);
    mockCalculateTax.mockResolvedValue({
      items: [
        { taxCents: 200, taxRate: 0.04 },
        { taxCents: 100, taxRate: 0.04 },
      ],
      totalTaxCents: 300,
    } as any);

    const res = await request(app)
      .post('/api/invoices')
      .send({
        customerId: '550e8400-e29b-41d4-a716-446655440000',
        issuedDate: '2025-01-15',
        dueDate: '2025-02-15',
        lineItems: [
          { description: 'Bait', quantity: 1, unitPriceCents: 5000, productId: FOOD_1 },
          { description: 'Snacks', quantity: 1, unitPriceCents: 2500, productId: FOOD_2 },
        ],
      });

    expect(res.status).toBe(201);
    expect(mockCalculateTax).toHaveBeenCalledTimes(1);
    const args = mockCalculateTax.mock.calls[0][0] as any;
    expect(args.lineItems).toHaveLength(2);
    expect(args.lineItems[0].taxCategory).toBe('food');
    expect(args.lineItems[1].taxCategory).toBe('food');
    expect(args.lineItems[0].amountCents).toBe(5000);
    expect(args.lineItems[1].amountCents).toBe(2500);
  });

  it('honors per-product Tax Exempt by zeroing the line amount fed to engine', async () => {
    // The per-product taxClass is the strongest signal — when it's "Tax
    // Exempt" the resolver must report taxable=false, and the route must
    // pass amountCents=0 for that line so the engine returns zero tax
    // without us having to special-case the engine itself.
    const EXEMPT_ID = '33333333-3333-4333-8333-333333333333';
    mockPrisma.product.findMany.mockResolvedValue([
      {
        id: EXEMPT_ID,
        taxClass: 'Tax Exempt',
        productCategory: { defaultTaxCategory: 'general', taxable: true },
      },
    ]);
    mockCalculateTax.mockResolvedValue({
      items: [{ taxCents: 0, taxRate: 0 }],
      totalTaxCents: 0,
    } as any);

    const res = await request(app)
      .post('/api/invoices')
      .send({
        customerId: '550e8400-e29b-41d4-a716-446655440000',
        issuedDate: '2025-01-15',
        dueDate: '2025-02-15',
        lineItems: [
          { description: 'Exempt service', quantity: 1, unitPriceCents: 9999, productId: EXEMPT_ID },
        ],
      });

    expect(res.status).toBe(201);
    const args = mockCalculateTax.mock.calls[0][0] as any;
    expect(args.lineItems[0].amountCents).toBe(0);
  });

  it('resolves locationId from the first CONTRACT line item slip', async () => {
    // Contract-backed invoice lines drive jurisdiction selection: the
    // invoice route looks up the slipContract → slip.locationId and
    // hands it to calculateTax. This is what makes multi-location
    // marinas charge the correct rate per location.
    mockPrisma.slipContract.findUnique.mockResolvedValue({
      slip: { locationId: 'loc-marina-A' },
    } as any);
    mockCalculateTax.mockResolvedValue({
      items: [{ taxCents: 800, taxRate: 0.08 }],
      totalTaxCents: 800,
    } as any);

    const res = await request(app)
      .post('/api/invoices')
      .send({
        customerId: '550e8400-e29b-41d4-a716-446655440000',
        issuedDate: '2025-01-15',
        dueDate: '2025-02-15',
        lineItems: [
          {
            description: 'Slip rental - January',
            quantity: 1,
            unitPriceCents: 10000,
            sourceType: 'CONTRACT',
            sourceId: 'contract-1',
          },
        ],
      });

    expect(res.status).toBe(201);
    const args = mockCalculateTax.mock.calls[0][0] as any;
    expect(args.locationId).toBe('loc-marina-A');
    expect(args.tenantId).toBeDefined();
  });

  it('passes different locationIds for invoices on different marinas (rate variance)', async () => {
    // Same product, two invoices issued at two different locations: each
    // call to the engine must carry the right locationId so the engine's
    // jurisdiction stack picks the right rate for that marina. We assert
    // the route makes that distinction; the engine itself is mocked so
    // we don't double-test rate math here.
    mockCalculateTax.mockResolvedValue({
      items: [{ taxCents: 0, taxRate: 0 }],
      totalTaxCents: 0,
    } as any);

    // Invoice #1 → marina A
    mockPrisma.slipContract.findUnique.mockResolvedValueOnce({
      slip: { locationId: 'loc-marina-A' },
    } as any);
    await request(app)
      .post('/api/invoices')
      .send({
        customerId: '550e8400-e29b-41d4-a716-446655440000',
        issuedDate: '2025-01-15',
        dueDate: '2025-02-15',
        lineItems: [
          {
            description: 'Slip rental',
            quantity: 1,
            unitPriceCents: 10000,
            sourceType: 'CONTRACT',
            sourceId: 'contract-A',
          },
        ],
      });

    // Invoice #2 → marina B
    mockPrisma.slipContract.findUnique.mockResolvedValueOnce({
      slip: { locationId: 'loc-marina-B' },
    } as any);
    await request(app)
      .post('/api/invoices')
      .send({
        customerId: '550e8400-e29b-41d4-a716-446655440000',
        issuedDate: '2025-01-15',
        dueDate: '2025-02-15',
        lineItems: [
          {
            description: 'Slip rental',
            quantity: 1,
            unitPriceCents: 10000,
            sourceType: 'CONTRACT',
            sourceId: 'contract-B',
          },
        ],
      });

    expect(mockCalculateTax).toHaveBeenCalledTimes(2);
    const argsA = mockCalculateTax.mock.calls[0][0] as any;
    const argsB = mockCalculateTax.mock.calls[1][0] as any;
    expect(argsA.locationId).toBe('loc-marina-A');
    expect(argsB.locationId).toBe('loc-marina-B');
  });

  it('respects caller-supplied taxCategory and skips product lookup', async () => {
    // When the API caller already specifies a taxCategory on the line
    // (e.g. an explicit override from a custom integration), the route
    // must NOT query products to derive one — the resolver short-circuits
    // and the explicit value flows straight to the engine.
    mockCalculateTax.mockResolvedValue({
      items: [{ taxCents: 0, taxRate: 0 }],
      totalTaxCents: 0,
    } as any);

    await request(app)
      .post('/api/invoices')
      .send({
        customerId: '550e8400-e29b-41d4-a716-446655440000',
        issuedDate: '2025-01-15',
        dueDate: '2025-02-15',
        lineItems: [
          {
            description: 'Custom override',
            quantity: 1,
            unitPriceCents: 5000,
            taxCategory: 'fuel',
          },
        ],
      });

    expect(mockPrisma.product.findMany).not.toHaveBeenCalled();
    const args = mockCalculateTax.mock.calls[0][0] as any;
    expect(args.lineItems[0].taxCategory).toBe('fuel');
  });
});
