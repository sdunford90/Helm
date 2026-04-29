import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { mockPrisma } from '../setup.js';
import { buildPosProduct, buildPosTransaction, buildShift } from '../helpers.js';
// Pull the mocked stripe module so direct-charge tests can assert how the
// PaymentIntent was created (header vs. transfer_data).
import * as stripeMod from '../../src/lib/stripe.js';
const mockedStripe = stripeMod.stripe as unknown as {
  paymentIntents: { create: ReturnType<typeof vi.fn> };
};
// tax-engine is module-mocked in setup.ts; pull the mocked fn so we can
// inspect the calls POS makes into it and override per-test return values.
import { calculateTax } from '../../src/services/tax-engine.js';
const mockCalculateTax = vi.mocked(calculateTax);

let app: any;

beforeEach(async () => {
  vi.clearAllMocks();
  const mod = await import('../../src/index.js');
  app = mod.default;
});

describe('GET /api/pos/products', () => {
  it('returns POS products with pagination', async () => {
    const products = [
      buildPosProduct({ name: 'Dock Line 20ft' }),
      buildPosProduct({ name: 'Fender Medium' }),
    ];
    mockPrisma.product.findMany.mockResolvedValue(products);
    mockPrisma.product.count.mockResolvedValue(2);

    const res = await request(app).get('/api/pos/products');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(res.body.data).toHaveLength(2);
    expect(res.body).toHaveProperty('pagination');
    expect(res.body.pagination).toEqual(
      expect.objectContaining({ total: 2 }),
    );
  });
});

describe('POST /api/pos/transactions', () => {
  it('creates a transaction with line items', async () => {
    const product = buildPosProduct({ priceCents: 1500, taxClass: null });
    const transaction = buildPosTransaction({
      subtotalCents: 3000,
      taxCents: 0,
      tipCents: 0,
      totalCents: 3000,
    });

    mockPrisma.product.findMany.mockResolvedValue([product]);
    mockPrisma.posTransaction.create.mockResolvedValue({
      ...transaction,
      lineItems: [
        {
          productId: product.id,
          quantity: 2,
          unitPriceCents: 1500,
          discountCents: 0,
          taxCents: 0,
          extendedCents: 3000,
          product,
        },
      ],
    });
    mockPrisma.inventory.updateMany.mockResolvedValue({ count: 0 });
    mockPrisma.auditLog.create.mockResolvedValue({});

    const res = await request(app)
      .post('/api/pos/transactions')
      .send({
        lineItems: [
          {
            productId: product.id,
            quantity: 2,
            unitPriceCents: 1500,
          },
        ],
        paymentMethod: 'CASH',
      });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('totalCents');
    expect(res.body).toHaveProperty('lineItems');
  });
});

describe('POST /api/pos/shifts/open', () => {
  it('opens a shift with opening float', async () => {
    const shift = buildShift({ status: 'OPEN', openingFloatCents: 20000 });

    mockPrisma.shift.findFirst.mockResolvedValue(null); // no existing open shift
    mockPrisma.shift.create.mockResolvedValue(shift);
    mockPrisma.auditLog.create.mockResolvedValue({});

    const res = await request(app)
      .post('/api/pos/shifts/open')
      .send({ openingFloatCents: 20000 });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('status', 'OPEN');
    expect(res.body).toHaveProperty('openingFloatCents', 20000);
  });

  it('rejects opening a second shift for same cashier', async () => {
    const existingShift = buildShift({ status: 'OPEN' });
    mockPrisma.shift.findFirst.mockResolvedValue(existingShift);

    const res = await request(app)
      .post('/api/pos/shifts/open')
      .send({ openingFloatCents: 20000 });

    expect(res.status).toBe(400);
  });
});

describe('POST /api/pos/transactions — tax engine integration', () => {
  // The tax-engine module is globally mocked in setup.ts. These tests assert
  // on the arguments POS passes INTO the engine (customerId, locationId, and
  // the per-line taxCategory derived from product/category) so we know the
  // routing logic is correct, then control the engine's return to verify
  // POS aggregates totals from what the engine reports.
  function captureCreatedTransaction() {
    let captured: any = null;
    mockPrisma.posTransaction.create.mockImplementation(async ({ data }: any) => {
      captured = data;
      return { id: 'txn-new', ...data, lineItems: data.lineItems?.create ?? [] };
    });
    mockPrisma.inventory.updateMany.mockResolvedValue({ count: 0 });
    mockPrisma.auditLog.create.mockResolvedValue({});
    return () => captured;
  }

  it('passes customerId=null to engine for anonymous walk-up sale', async () => {
    const product = buildPosProduct({ priceCents: 1000, taxClass: null });
    mockPrisma.product.findMany.mockResolvedValue([
      { ...product, productCategory: null },
    ]);
    mockPrisma.shift.findFirst.mockResolvedValue({ locationId: 'loc-1' });
    mockCalculateTax.mockResolvedValue({
      items: [{ taxCents: 70, taxRate: 0.07 }],
      totalTaxCents: 70,
    } as any);
    const getCaptured = captureCreatedTransaction();

    const res = await request(app)
      .post('/api/pos/transactions')
      .send({
        shiftId: 'shift-1',
        lineItems: [{ productId: product.id, quantity: 1, unitPriceCents: 1000 }],
        paymentMethod: 'CASH',
      });

    expect(res.status).toBe(201);
    // POS must call the engine with customerId=null (not undefined / not
    // skipped) and with the resolved locationId from the open shift.
    expect(mockCalculateTax).toHaveBeenCalledTimes(1);
    const args = mockCalculateTax.mock.calls[0][0] as any;
    expect(args.customerId).toBeNull();
    expect(args.locationId).toBe('loc-1');
    expect(args.lineItems).toHaveLength(1);
    expect(args.lineItems[0].amountCents).toBe(1000);
    const captured = getCaptured();
    expect(captured.taxCents).toBe(70);
    expect(captured.totalCents).toBe(1070);
  });

  it('forwards customerId to the engine so per-customer exemption can apply', async () => {
    const product = buildPosProduct({ priceCents: 1000, taxClass: null });
    mockPrisma.product.findMany.mockResolvedValue([
      { ...product, productCategory: null },
    ]);
    mockPrisma.shift.findFirst.mockResolvedValue({ locationId: 'loc-1' });
    // Engine returns 0 — simulating its checkTaxExempt short-circuit.
    mockCalculateTax.mockResolvedValue({
      items: [{ taxCents: 0, taxRate: 0 }],
      totalTaxCents: 0,
    } as any);
    captureCreatedTransaction();

    const res = await request(app)
      .post('/api/pos/transactions')
      .send({
        shiftId: 'shift-1',
        customerId: 'cust-exempt',
        lineItems: [{ productId: product.id, quantity: 1, unitPriceCents: 1000 }],
        paymentMethod: 'CASH',
      });

    expect(res.status).toBe(201);
    const args = mockCalculateTax.mock.calls[0][0] as any;
    expect(args.customerId).toBe('cust-exempt');
  });

  it('feeds the engine a per-line taxCategory derived from product category', async () => {
    // Product has no per-product override; the category default ("food")
    // must be the value POS passes into calculateTax.
    const product = buildPosProduct({ priceCents: 1000, taxClass: null });
    mockPrisma.product.findMany.mockResolvedValue([
      {
        ...product,
        productCategory: { defaultTaxCategory: 'food', taxable: true },
      },
    ]);
    mockPrisma.shift.findFirst.mockResolvedValue({ locationId: 'loc-1' });
    mockCalculateTax.mockResolvedValue({
      items: [{ taxCents: 20, taxRate: 0.02 }],
      totalTaxCents: 20,
    } as any);
    captureCreatedTransaction();

    const res = await request(app)
      .post('/api/pos/transactions')
      .send({
        shiftId: 'shift-1',
        lineItems: [{ productId: product.id, quantity: 1, unitPriceCents: 1000 }],
        paymentMethod: 'CASH',
      });

    expect(res.status).toBe(201);
    const args = mockCalculateTax.mock.calls[0][0] as any;
    expect(args.lineItems[0].taxCategory).toBe('food');
  });

  it('per-product Tax Exempt class skips the engine entirely', async () => {
    // resolveProductTaxCategory short-circuits to taxable=false so POS
    // filters out every line and never calls calculateTax.
    const product = buildPosProduct({ priceCents: 1000, taxClass: 'Tax Exempt' });
    mockPrisma.product.findMany.mockResolvedValue([
      { ...product, productCategory: null },
    ]);
    mockPrisma.shift.findFirst.mockResolvedValue({ locationId: 'loc-1' });
    const getCaptured = captureCreatedTransaction();

    const res = await request(app)
      .post('/api/pos/transactions')
      .send({
        shiftId: 'shift-1',
        lineItems: [{ productId: product.id, quantity: 1, unitPriceCents: 1000 }],
        paymentMethod: 'CASH',
      });

    expect(res.status).toBe(201);
    expect(mockCalculateTax).not.toHaveBeenCalled();
    const captured = getCaptured();
    expect(captured.taxCents).toBe(0);
    expect(captured.subtotalCents).toBe(1000);
  });
});

describe('GET /api/pos/transactions', () => {
  it('returns transaction list with pagination', async () => {
    const transactions = [buildPosTransaction(), buildPosTransaction()];
    mockPrisma.posTransaction.findMany.mockResolvedValue(
      transactions.map((t) => ({ ...t, lineItems: [] })),
    );
    mockPrisma.posTransaction.count.mockResolvedValue(2);

    const res = await request(app).get('/api/pos/transactions');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(res.body.data).toHaveLength(2);
    expect(res.body).toHaveProperty('pagination');
  });
});

describe('POST /api/pos/transactions — card rail tagging', () => {
  // Persisting the rail (Terminal vs CNP) and CNP fallback reason is what
  // powers the rail-mix report. These tests pin down that the create endpoint
  // (a) stores what the cashier client sent for card sales, (b) clears any
  // fallback reason on Terminal sales, and (c) refuses to tag rail metadata
  // on non-card sales so the report dataset stays clean.
  function captureCreate() {
    let captured: any = null;
    mockPrisma.posTransaction.create.mockImplementation(async ({ data }: any) => {
      captured = data;
      return { id: 'txn-card', ...data, lineItems: data.lineItems?.create ?? [] };
    });
    mockPrisma.product.findMany.mockResolvedValue([
      buildPosProduct({ id: 'p1', priceCents: 1000, taxClass: null }),
    ]);
    mockPrisma.inventory.updateMany.mockResolvedValue({ count: 0 });
    mockPrisma.auditLog.create.mockResolvedValue({});
    return () => captured;
  }

  it('stores cardRail=TERMINAL with no fallback reason for reader sales', async () => {
    const get = captureCreate();
    const res = await request(app)
      .post('/api/pos/transactions')
      .send({
        lineItems: [{ productId: 'p1', quantity: 1, unitPriceCents: 1000 }],
        paymentMethod: 'CARD',
        cardRail: 'TERMINAL',
      });
    expect(res.status).toBe(201);
    const captured = get();
    expect(captured.cardRail).toBe('TERMINAL');
    expect(captured.cnpFallbackReason).toBeNull();
  });

  it('stores cardRail=CNP and the cnpFallbackReason for keyed sales', async () => {
    const get = captureCreate();
    const res = await request(app)
      .post('/api/pos/transactions')
      .send({
        lineItems: [{ productId: 'p1', quantity: 1, unitPriceCents: 1000 }],
        paymentMethod: 'CARD',
        cardRail: 'CNP',
        cnpFallbackReason: 'NO_READER',
      });
    expect(res.status).toBe(201);
    const captured = get();
    expect(captured.cardRail).toBe('CNP');
    expect(captured.cnpFallbackReason).toBe('NO_READER');
  });

  it('drops the fallback reason when cardRail is TERMINAL even if client sends one', async () => {
    // A buggy client could send a fallback reason with a Terminal sale.
    // The server must scrub it so the report doesn't double-count.
    const get = captureCreate();
    await request(app)
      .post('/api/pos/transactions')
      .send({
        lineItems: [{ productId: 'p1', quantity: 1, unitPriceCents: 1000 }],
        paymentMethod: 'CARD',
        cardRail: 'TERMINAL',
        cnpFallbackReason: 'NO_READER',
      });
    const captured = get();
    expect(captured.cardRail).toBe('TERMINAL');
    expect(captured.cnpFallbackReason).toBeNull();
  });

  it('drops cardRail entirely on non-card sales', async () => {
    // Cash/ACH/charge sales don't belong in the card-rail-mix dataset.
    const get = captureCreate();
    await request(app)
      .post('/api/pos/transactions')
      .send({
        lineItems: [{ productId: 'p1', quantity: 1, unitPriceCents: 1000 }],
        paymentMethod: 'CASH',
        cardRail: 'CNP',
        cnpFallbackReason: 'MANUAL_CHOICE',
      });
    const captured = get();
    expect(captured.cardRail).toBeNull();
    expect(captured.cnpFallbackReason).toBeNull();
  });

  it('rejects an unknown cardRail value', async () => {
    captureCreate();
    const res = await request(app)
      .post('/api/pos/transactions')
      .send({
        lineItems: [{ productId: 'p1', quantity: 1, unitPriceCents: 1000 }],
        paymentMethod: 'CARD',
        cardRail: 'BITCOIN',
      });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});

describe('GET /api/pos/reports/card-rail-mix', () => {
  // The rail-mix report aggregates raw card rows into per-location buckets so
  // owners can spot locations that are silently routing sales through CNP.
  // These tests pin down the bucket math and the per-location bucketing.
  it('aggregates card sales into Terminal vs CNP buckets and breaks down fallback reasons', async () => {
    mockPrisma.posTransaction.findMany.mockResolvedValue([
      // Terminal sale
      {
        totalCents: 1000,
        cardRail: 'TERMINAL',
        cnpFallbackReason: null,
        createdAt: new Date(),
        shift: { locationId: 'loc-A' },
      },
      // CNP — silent fallback (no reader)
      {
        totalCents: 2000,
        cardRail: 'CNP',
        cnpFallbackReason: 'NO_READER',
        createdAt: new Date(),
        shift: { locationId: 'loc-A' },
      },
      // CNP — explicit cashier choice, different location
      {
        totalCents: 3000,
        cardRail: 'CNP',
        cnpFallbackReason: 'MANUAL_CHOICE',
        createdAt: new Date(),
        shift: { locationId: 'loc-B' },
      },
      // Pre-migration card sale with no rail tagged
      {
        totalCents: 500,
        cardRail: null,
        cnpFallbackReason: null,
        createdAt: new Date(),
        shift: { locationId: 'loc-A' },
      },
    ]);
    mockPrisma.location.findMany.mockResolvedValue([
      { id: 'loc-A', name: 'Main Marina' },
      { id: 'loc-B', name: 'North Dock' },
    ]);

    const res = await request(app).get('/api/pos/reports/card-rail-mix');

    expect(res.status).toBe(200);
    expect(res.body.overall).toEqual(
      expect.objectContaining({
        terminalCount: 1,
        terminalCents: 1000,
        cnpCount: 2,
        cnpCents: 5000,
        unknownCardCount: 1,
      }),
    );
    expect(res.body.overall.cnpFallbackBreakdown).toEqual({
      no_reader: 1,
      discovery_failed: 0,
      manual_choice: 1,
      unknown: 0,
    });

    // Per-location buckets carry their location name for nice rendering.
    const byLoc = new Map<string, any>(res.body.byLocation.map((b: any) => [b.locationId, b]));
    expect(byLoc.get('loc-A')).toEqual(
      expect.objectContaining({
        locationName: 'Main Marina',
        terminalCount: 1,
        cnpCount: 1,
        unknownCardCount: 1,
      }),
    );
    expect(byLoc.get('loc-B')).toEqual(
      expect.objectContaining({
        locationName: 'North Dock',
        terminalCount: 0,
        cnpCount: 1,
      }),
    );
  });

  it('only queries CARD rows so cash/ACH/charge sales are excluded', async () => {
    mockPrisma.posTransaction.findMany.mockResolvedValue([]);
    mockPrisma.location.findMany.mockResolvedValue([]);
    await request(app).get('/api/pos/reports/card-rail-mix');
    expect(mockPrisma.posTransaction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'CARD' }),
      }),
    );
  });

  it('returns an empty overall bucket when there are no card sales', async () => {
    mockPrisma.posTransaction.findMany.mockResolvedValue([]);
    mockPrisma.location.findMany.mockResolvedValue([]);
    const res = await request(app).get('/api/pos/reports/card-rail-mix');
    expect(res.status).toBe(200);
    expect(res.body.overall.terminalCount).toBe(0);
    expect(res.body.overall.cnpCount).toBe(0);
    expect(res.body.byLocation).toEqual([]);
  });

  it('respects an optional locationId filter', async () => {
    mockPrisma.posTransaction.findMany.mockResolvedValue([
      {
        totalCents: 1000,
        cardRail: 'TERMINAL',
        cnpFallbackReason: null,
        createdAt: new Date(),
        shift: { locationId: 'loc-A' },
      },
      {
        totalCents: 2000,
        cardRail: 'CNP',
        cnpFallbackReason: 'NO_READER',
        createdAt: new Date(),
        shift: { locationId: 'loc-B' },
      },
    ]);
    mockPrisma.location.findMany.mockResolvedValue([{ id: 'loc-A', name: 'Main Marina' }]);

    const res = await request(app)
      .get('/api/pos/reports/card-rail-mix?locationId=loc-A');

    expect(res.status).toBe(200);
    // Only loc-A's Terminal sale should land in the overall bucket.
    expect(res.body.overall.terminalCount).toBe(1);
    expect(res.body.overall.cnpCount).toBe(0);
    expect(res.body.byLocation).toHaveLength(1);
    expect(res.body.byLocation[0].locationId).toBe('loc-A');
  });
});

// Direct-charge migration: the POS keyed-in (CNP) path used to be a
// destination charge with `transfer_data.destination`, which required the
// `transfers` capability on the connected account. Onboarding only requests
// `card_payments`, so those PIs were rejected by Stripe with the dreaded
// "needs at least one of: transfers, crypto_transfers, legacy_payments"
// error. We now do a direct charge on the connected account (header) with
// `application_fee_amount` for the platform's slice — same model as
// checkout/portal/terminal — so the existing onboarding capability set is
// sufficient.
describe('POST /api/pos/payments/cnp — direct charge', () => {
  beforeEach(() => {
    mockedStripe.paymentIntents.create.mockReset();
    mockedStripe.paymentIntents.create.mockResolvedValue({
      id: 'pi_cnp_1',
      status: 'succeeded',
      amount: 5000,
    });
  });

  it('creates the PaymentIntent on the connected account via header (no transfer_data)', async () => {
    // Resolve to a connected account via shift -> location lookup.
    mockPrisma.shift.findFirst.mockResolvedValue({ locationId: 'loc-1' });
    mockPrisma.location.findFirst.mockResolvedValue({ stripeAccountId: 'acct_marina' });
    mockPrisma.tenant.findUnique.mockResolvedValue({
      applicationFeePctBps: 50, // 0.5%
      applicationFeeFixedCents: 30,
    });

    const res = await request(app)
      .post('/api/pos/payments/cnp')
      .send({
        amountCents: 5000,
        paymentMethodId: 'pm_card_visa',
        shiftId: 'shift-1',
        description: 'Tank top',
      });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 'pi_cnp_1', status: 'succeeded' });
    expect(mockedStripe.paymentIntents.create).toHaveBeenCalledTimes(1);

    const [body, options] = mockedStripe.paymentIntents.create.mock.calls[0];
    // Direct-charge: connected account is in the request *options*, not body.
    expect(options).toEqual({ stripeAccount: 'acct_marina' });
    // No destination charge — `transfer_data` would re-introduce the
    // capability requirement we're trying to escape.
    expect(body).not.toHaveProperty('transfer_data');
    expect(body).not.toHaveProperty('on_behalf_of');
    // Application fee = ceil(5000 * 50 / 10000) + 30 = 25 + 30 = 55.
    expect(body.application_fee_amount).toBe(55);
    expect(body).toMatchObject({
      amount: 5000,
      currency: 'usd',
      payment_method: 'pm_card_visa',
      confirm: true,
    });
  });

  it('returns STRIPE_NOT_CONFIGURED when no Stripe account resolves', async () => {
    mockPrisma.shift.findFirst.mockResolvedValue({ locationId: 'loc-1' });
    mockPrisma.location.findFirst.mockResolvedValue({ stripeAccountId: null });
    mockPrisma.tenant.findUnique.mockResolvedValue({ stripeAccountId: null });

    const res = await request(app)
      .post('/api/pos/payments/cnp')
      .send({
        amountCents: 5000,
        paymentMethodId: 'pm_card_visa',
        shiftId: 'shift-1',
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('STRIPE_NOT_CONFIGURED');
    expect(mockedStripe.paymentIntents.create).not.toHaveBeenCalled();
  });
});
