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
        shiftId: 'shift-1',
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

  // Best-practice gate: a register sale (cash / card / ACH) must be
  // attached to an open shift so it lands in the cashier's Z-out and
  // hits the right COGS journal. Charge-to-A/R is the documented carve-
  // out — it's a billing event, not a register sale, so it can be
  // recorded with no shift open.
  it('rejects a CASH sale with no shiftId (SHIFT_REQUIRED)', async () => {
    const product = buildPosProduct({ priceCents: 1500, taxClass: null });
    mockPrisma.product.findMany.mockResolvedValue([product]);

    const res = await request(app)
      .post('/api/pos/transactions')
      .send({
        lineItems: [{ productId: product.id, quantity: 1, unitPriceCents: 1500 }],
        paymentMethod: 'CASH',
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('SHIFT_REQUIRED');
    // Sale must not have been written.
    expect(mockPrisma.posTransaction.create).not.toHaveBeenCalled();
  });

  it('allows a CHARGE_TO_AR sale with no shiftId (carve-out for member billing)', async () => {
    const product = buildPosProduct({ priceCents: 1500, taxClass: null });
    mockPrisma.product.findMany.mockResolvedValue([product]);
    // location.findUnique (accounting gate + tax provider lookup) and
    // location.findFirst (CHARGE_TO_AR allowance check) both need to
    // resolve a location with posChargeToARAllowed=true so the carve-out
    // path can complete.
    mockPrisma.location.findUnique.mockResolvedValue({
      accountingSetupComplete: true,
      accountingGracePeriodEndsAt: null,
      taxProvider: null,
    } as any);
    mockPrisma.location.findFirst.mockResolvedValue({
      posChargeToARAllowed: true,
    } as any);
    mockPrisma.invoice.create.mockResolvedValue({ id: 'inv-ar-1' } as any);
    mockPrisma.posTransaction.create.mockImplementation(async ({ data }: any) => ({
      id: 'txn-ar',
      ...data,
      lineItems: data.lineItems?.create ?? [],
    }));
    mockPrisma.inventory.updateMany.mockResolvedValue({ count: 0 });
    mockPrisma.auditLog.create.mockResolvedValue({});

    const res = await request(app)
      .post('/api/pos/transactions')
      .send({
        lineItems: [{ productId: product.id, quantity: 1, unitPriceCents: 1500 }],
        paymentMethod: 'CHARGE_TO_AR',
        customerId: 'cust-1',
        locationId: 'loc-1',
      });

    expect(res.status).toBe(201);
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

  // Regression for task #295: legacy products were stored with the literal
  // "Standard" sentinel (the inventory modal pre-fills it for legacy null
  // rows). The POS resolver must treat that as "no override" and fall
  // through to the category's defaultTaxCategory — otherwise the engine
  // looks up a non-existent rate and the line rings up with zero tax even
  // though the category-level setup is correct.
  it.each(['Standard', 'standard', '', '  '])(
    'a stored taxClass=%j (legacy "no override" sentinel) still inherits the category default at POS',
    async (storedTaxClass) => {
      const product = buildPosProduct({ priceCents: 1000, taxClass: storedTaxClass });
      mockPrisma.product.findMany.mockResolvedValue([
        {
          ...product,
          productCategory: { defaultTaxCategory: 'food', taxable: true },
        },
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
      // Crucially: the engine WAS called (the line wasn't dropped by POS's
      // taxableLines filter) and the category default flowed through.
      expect(mockCalculateTax).toHaveBeenCalledTimes(1);
      const args = mockCalculateTax.mock.calls[0][0] as any;
      expect(args.lineItems[0].taxCategory).toBe('food');
      const captured = getCaptured();
      expect(captured.taxCents).toBe(70);
    },
  );

  it('a non-taxable category zeros the tax even when the product carries a stale taxClass', async () => {
    // Per the task: "A category marked non-taxable still produces zero tax
    // for its products at POS." A stale per-product value (e.g. "general"
    // copied from when the category was taxable) must NOT override the
    // category-level non-taxable flag.
    const product = buildPosProduct({ priceCents: 1000, taxClass: 'general' });
    mockPrisma.product.findMany.mockResolvedValue([
      {
        ...product,
        productCategory: { defaultTaxCategory: 'general', taxable: false },
      },
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
    expect(getCaptured().taxCents).toBe(0);
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
        shiftId: 'shift-1',
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
        shiftId: 'shift-1',
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
        shiftId: 'shift-1',
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
        shiftId: 'shift-1',
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
        shiftId: 'shift-1',
        lineItems: [{ productId: 'p1', quantity: 1, unitPriceCents: 1000 }],
        paymentMethod: 'CARD',
        cardRail: 'BITCOIN',
      });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});

describe('POST /api/pos/transactions — Stripe PaymentIntent reconciliation id (task #255)', () => {
  // The cashier client forwards the PaymentIntent id returned by
  // confirmCardPayment / Terminal capture so the row stores Stripe's id at
  // sale time. End-of-day reconciliation, refunds, and dispute matching
  // all join on this id instead of the fragile amount + timestamp pairing
  // we had to use before.
  function captureCreate() {
    let captured: any = null;
    mockPrisma.posTransaction.create.mockImplementation(async ({ data }: any) => {
      captured = data;
      return { id: 'txn-pi', ...data, lineItems: data.lineItems?.create ?? [] };
    });
    mockPrisma.product.findMany.mockResolvedValue([
      buildPosProduct({ id: 'p1', priceCents: 1000, taxClass: null }),
    ]);
    mockPrisma.inventory.updateMany.mockResolvedValue({ count: 0 });
    mockPrisma.auditLog.create.mockResolvedValue({});
    // Default: pretend the PI was already verified server-side (CNP finalize
    // / Terminal capture wrote a PosPayment audit row). Tests that want to
    // exercise the unverified path can override this with mockResolvedValue(null).
    mockPrisma.auditLog.findFirst.mockResolvedValue({ id: 'audit-row-1' } as any);
    return () => captured;
  }

  it('persists the Stripe PaymentIntent id on a CARD sale', async () => {
    const get = captureCreate();
    const res = await request(app)
      .post('/api/pos/transactions')
      .send({
        shiftId: 'shift-1',
        lineItems: [{ productId: 'p1', quantity: 1, unitPriceCents: 1000 }],
        paymentMethod: 'CARD',
        cardRail: 'CNP',
        cnpFallbackReason: 'MANUAL_CHOICE',
        stripePaymentIntentId: 'pi_card_abc123',
      });
    expect(res.status).toBe(201);
    const captured = get();
    expect(captured.stripePaymentIntentId).toBe('pi_card_abc123');
  });

  it('drops the PaymentIntent id on non-card sales so the join key only exists where it is meaningful', async () => {
    // A buggy / malicious client could attach a PI id to a CASH row.
    // Same scrubbing rule as cardRail — non-card rows must not carry the
    // reconciliation key.
    const get = captureCreate();
    const res = await request(app)
      .post('/api/pos/transactions')
      .send({
        shiftId: 'shift-1',
        lineItems: [{ productId: 'p1', quantity: 1, unitPriceCents: 1000 }],
        paymentMethod: 'CASH',
        stripePaymentIntentId: 'pi_should_be_dropped',
      });
    expect(res.status).toBe(201);
    const captured = get();
    expect(captured.stripePaymentIntentId).toBeNull();
  });

  it('persists null when the client omits the PI id (e.g. legacy clients)', async () => {
    const get = captureCreate();
    const res = await request(app)
      .post('/api/pos/transactions')
      .send({
        shiftId: 'shift-1',
        lineItems: [{ productId: 'p1', quantity: 1, unitPriceCents: 1000 }],
        paymentMethod: 'CARD',
        cardRail: 'TERMINAL',
      });
    expect(res.status).toBe(201);
    const captured = get();
    expect(captured.stripePaymentIntentId).toBeNull();
  });

  // The connected Stripe account that captured the PaymentIntent must be
  // resolved AT SALE TIME and persisted on the row, not re-derived later by
  // the refund handler. Otherwise refunds on sales made without an open
  // shift, or sales whose location's Stripe-account assignment changes
  // afterwards, would route to the wrong account (or fail outright).
  it('captures and persists the connected Stripe account on the row when a CARD sale carries a PI id', async () => {
    const get = captureCreate();
    // Shift open but its location is unset — the explicit locationId on the
    // request drives the per-location Stripe account resolution
    // (acct_loc_per_location), not the shift's.
    // location.findUnique is hit twice: once by the accounting-gate
    // middleware (needs accountingSetupComplete), once by the route to
    // resolve taxProvider. Returning a row that satisfies both lets the
    // request pass through and lets the tax lookup no-op.
    mockPrisma.shift.findFirst.mockResolvedValue({ locationId: null });
    mockPrisma.location.findUnique.mockResolvedValue({
      accountingSetupComplete: true,
      accountingGracePeriodEndsAt: null,
      taxProvider: null,
    } as any);
    mockPrisma.location.findFirst.mockResolvedValue({
      stripeAccountId: 'acct_loc_per_location',
    } as any);

    const res = await request(app)
      .post('/api/pos/transactions')
      .send({
        shiftId: 'shift-1',
        lineItems: [{ productId: 'p1', quantity: 1, unitPriceCents: 1000 }],
        paymentMethod: 'CARD',
        cardRail: 'CNP',
        locationId: 'loc-A',
        stripePaymentIntentId: 'pi_card_loc_A',
      });

    expect(res.status).toBe(201);
    const captured = get();
    expect(captured.stripePaymentIntentId).toBe('pi_card_loc_A');
    expect(captured.stripeAccountId).toBe('acct_loc_per_location');
  });

  it('rejects a CARD sale that carries an unverified PaymentIntent id (no PosPayment audit row)', async () => {
    // Without server-side proof of payment (CNP-finalize / Terminal-capture
    // audit row), a forged or replayed PI id must NOT be persisted —
    // otherwise the refund handler would later issue a real Stripe refund
    // against an attacker-chosen PaymentIntent. Belt-and-braces against the
    // "trusted-client PI id" attack flagged in code review.
    captureCreate();
    // Override: pretend NO PosPayment audit row exists for this PI.
    mockPrisma.auditLog.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/pos/transactions')
      .send({
        shiftId: 'shift-1',
        lineItems: [{ productId: 'p1', quantity: 1, unitPriceCents: 1000 }],
        paymentMethod: 'CARD',
        cardRail: 'CNP',
        stripePaymentIntentId: 'pi_attacker_chosen',
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('PAYMENT_INTENT_NOT_VERIFIED');
    // Critically: no Stripe refund / posTransaction row was created.
    expect(mockPrisma.posTransaction.create).not.toHaveBeenCalled();
  });

  it('does not resolve / persist a Stripe account for non-card sales', async () => {
    // Belt-and-braces: even if the lookup somehow returned an account, a
    // CASH row must never carry one — the column is meaningful only for
    // sales that actually hit Stripe.
    const get = captureCreate();
    mockPrisma.shift.findFirst.mockResolvedValue({ locationId: null });
    mockPrisma.location.findUnique.mockResolvedValue({
      accountingSetupComplete: true,
      accountingGracePeriodEndsAt: null,
      taxProvider: null,
    } as any);
    mockPrisma.location.findFirst.mockResolvedValue({
      stripeAccountId: 'acct_should_not_be_used',
    } as any);

    const res = await request(app)
      .post('/api/pos/transactions')
      .send({
        shiftId: 'shift-1',
        lineItems: [{ productId: 'p1', quantity: 1, unitPriceCents: 1000 }],
        paymentMethod: 'CASH',
        locationId: 'loc-A',
      });

    expect(res.status).toBe(201);
    const captured = get();
    expect(captured.stripeAccountId).toBeNull();
  });
});

describe('POST /api/pos/transactions/:id/refund — Stripe refund via stored PI id (task #255)', () => {
  // When the original POS sale carries a stripePaymentIntentId, the refund
  // endpoint must call stripe.refunds.create on the connected account
  // referencing that PI id. Without the stored id, refund matching had to
  // be done manually in the Stripe Dashboard.
  beforeEach(() => {
    mockedStripe.refunds = {
      create: vi.fn().mockResolvedValue({ id: 're_test_12345' }),
    } as any;
    // The shared mockPrisma in tests/setup.ts doesn't define every method
    // on posTransaction (refund-style endpoints aren't covered elsewhere),
    // so wire the ones the refund handler needs locally.
    (mockPrisma.posTransaction as any).findFirst = vi.fn();
    (mockPrisma.posTransaction as any).update = vi.fn().mockResolvedValue({});
    mockPrisma.product.findFirst.mockResolvedValue(null);
    mockPrisma.inventory.updateMany.mockResolvedValue({ count: 0 });
    mockPrisma.auditLog.create.mockResolvedValue({});
    // No shift lookup → resolveStripeAccount falls back to the tenant's
    // stripeAccountId. Wire that here so the refund flow finds an account.
    mockPrisma.shift.findFirst.mockResolvedValue(null);
    mockPrisma.tenant.findUnique.mockResolvedValue({ stripeAccountId: 'acct_test' } as any);
    mockPrisma.location.findFirst.mockResolvedValue(null as any);
  });

  it('issues a Stripe refund on the connected account using the stored PI id and the per-row stripeAccountId', async () => {
    // Per-location Stripe account scenario: no open shift, but the original
    // sale was stamped with the location's connected account at sale time.
    // The refund must hit THAT account, not the tenant default — re-resolving
    // via shift would have failed (null shift) and fallen back to the tenant
    // account, breaking refunds for per-location Connect setups.
    mockPrisma.tenant.findUnique.mockResolvedValue({ stripeAccountId: 'acct_tenant_default' } as any);
    (mockPrisma.posTransaction as any).findFirst.mockResolvedValue({
      id: 'txn-orig',
      tenantId: 'test-tenant-id',
      status: 'CARD',
      stripePaymentIntentId: 'pi_orig_xyz',
      stripeAccountId: 'acct_loc_per_location',
      shiftId: null,
      subtotalCents: 1000,
      taxCents: 0,
      lineItems: [
        {
          id: 'li-1',
          productId: null,
          quantity: 1,
          unitPriceCents: 1000,
          discountCents: 0,
          taxCents: 0,
          extendedCents: 1000,
        },
      ],
    } as any);
    let capturedRefundCreate: any = null;
    mockPrisma.posTransaction.create.mockImplementation(async ({ data }: any) => {
      capturedRefundCreate = data;
      return { id: 'txn-refund', ...data, lineItems: data.lineItems?.create ?? [] };
    });

    const res = await request(app)
      .post('/api/pos/transactions/txn-orig/refund')
      .send({});

    expect(res.status).toBe(201);
    expect(mockedStripe.refunds.create).toHaveBeenCalledTimes(1);
    const [body, opts] = (mockedStripe.refunds.create as any).mock.calls[0];
    expect(body).toEqual(
      expect.objectContaining({
        payment_intent: 'pi_orig_xyz',
        amount: 1000,
      }),
    );
    // Critically: refund hits the per-location account stored on the row,
    // NOT the tenant-default account a re-resolution would have returned.
    expect(opts).toEqual({ stripeAccount: 'acct_loc_per_location' });
    // Refund row mirrors the original PI id + account so the negative-amount
    // entry is also joined to the same Stripe charge during reconciliation.
    expect(capturedRefundCreate.stripePaymentIntentId).toBe('pi_orig_xyz');
    expect(capturedRefundCreate.stripeAccountId).toBe('acct_loc_per_location');
  });

  it('falls back to live shift→location resolution when the original row predates stripeAccountId capture', async () => {
    // Very early task-#255 rows might have a PI id but no stored account
    // (rows written between the two migration steps). For those, fall back
    // to live resolveStripeAccount via shift→location, then tenant default.
    (mockPrisma.posTransaction as any).findFirst.mockResolvedValue({
      id: 'txn-early',
      tenantId: 'test-tenant-id',
      status: 'CARD',
      stripePaymentIntentId: 'pi_early_abc',
      stripeAccountId: null,
      shiftId: null,
      subtotalCents: 500,
      taxCents: 0,
      lineItems: [
        {
          id: 'li-e',
          productId: null,
          quantity: 1,
          unitPriceCents: 500,
          discountCents: 0,
          taxCents: 0,
          extendedCents: 500,
        },
      ],
    } as any);
    mockPrisma.posTransaction.create.mockResolvedValue({
      id: 'txn-refund',
      lineItems: [],
    } as any);

    const res = await request(app)
      .post('/api/pos/transactions/txn-early/refund')
      .send({});

    expect(res.status).toBe(201);
    expect(mockedStripe.refunds.create).toHaveBeenCalledTimes(1);
    const [, opts] = (mockedStripe.refunds.create as any).mock.calls[0];
    // Falls all the way back to the tenant default since shift+location are null.
    expect(opts).toEqual({ stripeAccount: 'acct_test' });
  });

  it('skips the Stripe call for legacy rows that have no stored PI id (offline refund)', async () => {
    // Refunding a sale recorded before this column existed must not 500
    // the cashier — fall back to a database-only refund.
    (mockPrisma.posTransaction as any).findFirst.mockResolvedValue({
      id: 'txn-legacy',
      tenantId: 'test-tenant-id',
      status: 'CARD',
      stripePaymentIntentId: null,
      shiftId: null,
      subtotalCents: 500,
      taxCents: 0,
      lineItems: [
        {
          id: 'li-2',
          productId: null,
          quantity: 1,
          unitPriceCents: 500,
          discountCents: 0,
          taxCents: 0,
          extendedCents: 500,
        },
      ],
    } as any);
    mockPrisma.posTransaction.create.mockResolvedValue({
      id: 'txn-refund',
      lineItems: [],
    } as any);

    const res = await request(app)
      .post('/api/pos/transactions/txn-legacy/refund')
      .send({});

    expect(res.status).toBe(201);
    expect(mockedStripe.refunds.create).not.toHaveBeenCalled();
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

// Server-confirmed PaymentIntent migration (task #254): the POS keyed-in
// (CNP) path used to take a `paymentMethodId` from the browser and create+
// confirm the PI server-side. The browser tokenized the card against the
// platform Stripe account (Stripe.js was loaded with only the platform
// publishable key), so when the backend tried to confirm on the **connected
// location's** account Stripe rejected the mismatch with
//   "platform-owned payment method ID".
// We now create the PI **unconfirmed** on the connected account (header) and
// hand the `client_secret` back to the browser, which calls
//   stripe.confirmCardPayment(clientSecret, { payment_method: { card: cardEl } })
// against the same connected account — the cross-account mismatch becomes
// structurally impossible because the client_secret is account-scoped.
//
// Direct-charge model is preserved (no `transfer_data`, application fee
// collected via `application_fee_amount`) so onboarding's existing
// `card_payments` capability is still sufficient.
describe('POST /api/pos/payments/cnp — server-confirmed PaymentIntent', () => {
  beforeEach(() => {
    mockedStripe.paymentIntents.create.mockReset();
    mockedStripe.paymentIntents.create.mockResolvedValue({
      id: 'pi_cnp_1',
      client_secret: 'pi_cnp_1_secret_abc',
      status: 'requires_confirmation',
      amount: 5000,
    });
  });

  it('creates an unconfirmed PaymentIntent on the connected account and returns its client_secret', async () => {
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
        shiftId: 'shift-1',
        description: 'Tank top',
        clientNonce: 'nonce-xyz',
      });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: 'pi_cnp_1',
      clientSecret: 'pi_cnp_1_secret_abc',
      status: 'requires_confirmation',
    });
    expect(mockedStripe.paymentIntents.create).toHaveBeenCalledTimes(1);

    const [body, options] = mockedStripe.paymentIntents.create.mock.calls[0];
    // Direct-charge: connected account is in the request *options*, not body.
    // Idempotency key (task #256) lives alongside `stripeAccount` in the
    // Stripe SDK request options so retries collapse to the same PI.
    expect(options).toEqual({
      stripeAccount: 'acct_marina',
      idempotencyKey: 'cnp:shift-1:5000:nonce-xyz',
    });
    // No destination charge — `transfer_data` would re-introduce the
    // capability requirement we're trying to escape.
    expect(body).not.toHaveProperty('transfer_data');
    expect(body).not.toHaveProperty('on_behalf_of');
    // The whole point of the fix: the server must NOT attach a payment
    // method or auto-confirm — the browser confirms client-side via
    // confirmCardPayment so the card is tokenized on the connected account.
    expect(body).not.toHaveProperty('payment_method');
    expect(body.confirm).toBeUndefined();
    // Application fee = ceil(5000 * 50 / 10000) + 30 = 25 + 30 = 55.
    expect(body.application_fee_amount).toBe(55);
    expect(body).toMatchObject({
      amount: 5000,
      currency: 'usd',
      payment_method_types: ['card'],
    });
  });

  it('rejects requests that still send a paymentMethodId (legacy clients) with a 400', async () => {
    // Belt-and-suspenders: the schema is `.strict()` so a stale frontend
    // that still ships `paymentMethodId` (the field that caused the
    // platform-vs-connected-account mismatch) gets a hard 400 instead of
    // having the field silently ignored. This forces every client onto the
    // new server-confirmed flow rather than degrading to confusing
    // "the browser is sending it but Stripe says it's missing" debugging.
    const res = await request(app)
      .post('/api/pos/payments/cnp')
      .send({
        amountCents: 5000,
        paymentMethodId: 'pm_card_visa',
        shiftId: 'shift-1',
        clientNonce: 'nonce-xyz',
      });

    expect(res.status).toBe(400);
    // No PI should ever be created when the request itself is invalid.
    expect(mockedStripe.paymentIntents.create).not.toHaveBeenCalled();
  });

  it('returns STRIPE_NOT_CONFIGURED when no Stripe account resolves', async () => {
    mockPrisma.shift.findFirst.mockResolvedValue({ locationId: 'loc-1' });
    mockPrisma.location.findFirst.mockResolvedValue({ stripeAccountId: null });
    mockPrisma.tenant.findUnique.mockResolvedValue({ stripeAccountId: null });

    const res = await request(app)
      .post('/api/pos/payments/cnp')
      .send({
        amountCents: 5000,
        shiftId: 'shift-1',
        clientNonce: 'nonce-xyz',
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('STRIPE_NOT_CONFIGURED');
    expect(mockedStripe.paymentIntents.create).not.toHaveBeenCalled();
  });

  // Task #256 — double-click protection. The cashier hammering "Charge
  // Card" or a network-layer retry must not mint a second PaymentIntent
  // on the marina's connected account (every abandoned PI burns Radar
  // review minutes and pollutes reconciliation). The fix is a stable
  // Stripe `Idempotency-Key` derived from { shiftId, amountCents,
  // clientNonce }: same inputs → same key → Stripe returns the SAME PI
  // on the second call. We assert two things at once here:
  //   1. The exact key string the server hands to Stripe (so the recipe
  //      doesn't drift — e.g. someone reordering the components or
  //      dropping shiftId would silently break dedup across cashiers).
  //   2. Both calls hand Stripe the SAME key, which is the contract that
  //      lets Stripe collapse the duplicate.
  it('sends a stable Idempotency-Key so a double-clicked Charge collapses to one PaymentIntent', async () => {
    mockPrisma.shift.findFirst.mockResolvedValue({ locationId: 'loc-1' });
    mockPrisma.location.findFirst.mockResolvedValue({ stripeAccountId: 'acct_marina' });
    mockPrisma.tenant.findUnique.mockResolvedValue({
      applicationFeePctBps: 0,
      applicationFeeFixedCents: 0,
    });

    const body = {
      amountCents: 5000,
      shiftId: 'shift-1',
      clientNonce: 'click-nonce-1',
    };

    const res1 = await request(app).post('/api/pos/payments/cnp').send(body);
    const res2 = await request(app).post('/api/pos/payments/cnp').send(body);

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    // Stripe collapses duplicates server-side; our mock just returns the
    // canned PI for both calls, mirroring what real Stripe does — same
    // key in, same `{ id, clientSecret }` out.
    expect(res1.body.id).toBe(res2.body.id);
    expect(res1.body.clientSecret).toBe(res2.body.clientSecret);

    expect(mockedStripe.paymentIntents.create).toHaveBeenCalledTimes(2);
    const opts1 = mockedStripe.paymentIntents.create.mock.calls[0][1];
    const opts2 = mockedStripe.paymentIntents.create.mock.calls[1][1];
    // Pin the key recipe — `cnp:` namespace, then shift, amount, nonce.
    expect(opts1.idempotencyKey).toBe('cnp:shift-1:5000:click-nonce-1');
    // Both calls must hand Stripe the SAME key, otherwise dedup is moot.
    expect(opts2.idempotencyKey).toBe(opts1.idempotencyKey);
    // Same connected account on both calls — Stripe scopes Idempotency-
    // Keys per account, so a dedup across accounts wouldn't apply
    // anyway, but we want them aligned for the same-shift case.
    expect(opts1.stripeAccount).toBe('acct_marina');
    expect(opts2.stripeAccount).toBe('acct_marina');
  });

  it('produces a different Idempotency-Key when the cart total changes between attempts', async () => {
    // Cashier adds a forgotten line item and re-clicks Charge — that's a
    // legitimately different sale and must NOT be deduped against the
    // first attempt. Folding `amountCents` into the key handles this.
    mockPrisma.shift.findFirst.mockResolvedValue({ locationId: 'loc-1' });
    mockPrisma.location.findFirst.mockResolvedValue({ stripeAccountId: 'acct_marina' });
    mockPrisma.tenant.findUnique.mockResolvedValue({
      applicationFeePctBps: 0,
      applicationFeeFixedCents: 0,
    });

    await request(app).post('/api/pos/payments/cnp').send({
      amountCents: 5000,
      shiftId: 'shift-1',
      clientNonce: 'same-nonce',
    });
    await request(app).post('/api/pos/payments/cnp').send({
      amountCents: 5500,
      shiftId: 'shift-1',
      clientNonce: 'same-nonce',
    });

    const opts1 = mockedStripe.paymentIntents.create.mock.calls[0][1];
    const opts2 = mockedStripe.paymentIntents.create.mock.calls[1][1];
    expect(opts1.idempotencyKey).not.toBe(opts2.idempotencyKey);
  });

  it('rejects requests missing clientNonce (idempotency is mandatory)', async () => {
    // The schema is `.strict()` and `clientNonce` is required. Without
    // it the server cannot build a stable Idempotency-Key and the whole
    // double-click protection collapses, so we fail loudly rather than
    // silently regress to the pre-#256 behavior of always minting a
    // fresh PI.
    const res = await request(app)
      .post('/api/pos/payments/cnp')
      .send({
        amountCents: 5000,
        shiftId: 'shift-1',
      });

    expect(res.status).toBe(400);
    expect(mockedStripe.paymentIntents.create).not.toHaveBeenCalled();
  });
});

// Companion endpoint for the server-confirmed flow. After the browser runs
// `confirmCardPayment` it must round-trip through /finalize so the server
// can re-fetch the PI on the connected account and refuse to record the
// sale unless Stripe agrees it succeeded for the expected amount. Without
// this the browser could lie about the payment outcome.
describe('POST /api/pos/payments/cnp/finalize — server-side verification', () => {
  beforeEach(() => {
    mockedStripe.paymentIntents.retrieve.mockReset();
    mockPrisma.auditLog.create.mockReset();
    mockPrisma.auditLog.create.mockResolvedValue({ id: 'audit-1' });
  });

  function arrangeConnected() {
    mockPrisma.shift.findFirst.mockResolvedValue({ locationId: 'loc-1' });
    mockPrisma.location.findFirst.mockResolvedValue({ stripeAccountId: 'acct_marina' });
    mockPrisma.tenant.findUnique.mockResolvedValue({ stripeAccountId: 'acct_marina' });
  }

  it('retrieves the PI on the connected account and audit-logs success', async () => {
    arrangeConnected();
    mockedStripe.paymentIntents.retrieve.mockResolvedValue({
      id: 'pi_cnp_1',
      status: 'succeeded',
      amount: 5000,
    });

    const res = await request(app)
      .post('/api/pos/payments/cnp/finalize')
      .send({
        paymentIntentId: 'pi_cnp_1',
        expectedAmountCents: 5000,
        shiftId: 'shift-1',
      });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: 'pi_cnp_1', status: 'succeeded', amount: 5000 });

    // Critical: PI is re-read on the **connected account**, not the
    // platform — same account header as create. This is what makes the
    // verification trustworthy.
    expect(mockedStripe.paymentIntents.retrieve).toHaveBeenCalledWith(
      'pi_cnp_1',
      {},
      { stripeAccount: 'acct_marina' },
    );

    // Audit row pins the PI id to this sale for downstream
    // reconciliation (no schema change required).
    expect(mockPrisma.auditLog.create).toHaveBeenCalledTimes(1);
    const auditArgs = mockPrisma.auditLog.create.mock.calls[0][0] as any;
    expect(auditArgs.data).toMatchObject({
      recordType: 'PosPayment',
      recordId: 'pi_cnp_1',
      action: 'FINALIZED',
    });
    expect(auditArgs.data.changedFieldsJson).toMatchObject({
      paymentIntentId: 'pi_cnp_1',
      stripeAccountId: 'acct_marina',
      amountCents: 5000,
      cardRail: 'CNP',
    });
  });

  it('refuses to finalize when Stripe says the PI did not succeed', async () => {
    // The browser can claim "succeeded" all it wants — the server reads
    // Stripe directly and refuses if Stripe disagrees. This stops a
    // malicious or buggy client from booking a sale that never paid.
    arrangeConnected();
    mockedStripe.paymentIntents.retrieve.mockResolvedValue({
      id: 'pi_cnp_2',
      status: 'requires_payment_method',
      amount: 5000,
    });

    const res = await request(app)
      .post('/api/pos/payments/cnp/finalize')
      .send({
        paymentIntentId: 'pi_cnp_2',
        expectedAmountCents: 5000,
        shiftId: 'shift-1',
      });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      error: 'PAYMENT_NOT_SUCCEEDED',
      status: 'requires_payment_method',
    });
    // No audit row when verification fails.
    expect(mockPrisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('refuses to finalize when the Stripe amount does not match what the client claimed', async () => {
    // Defends against a tampered cart total or a replay against a stale
    // PI for a different sale.
    arrangeConnected();
    mockedStripe.paymentIntents.retrieve.mockResolvedValue({
      id: 'pi_cnp_3',
      status: 'succeeded',
      amount: 9999,
    });

    const res = await request(app)
      .post('/api/pos/payments/cnp/finalize')
      .send({
        paymentIntentId: 'pi_cnp_3',
        expectedAmountCents: 5000,
        shiftId: 'shift-1',
      });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      error: 'AMOUNT_MISMATCH',
      expectedAmountCents: 5000,
      stripeAmountCents: 9999,
    });
    expect(mockPrisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('returns STRIPE_NOT_CONFIGURED if no connected account resolves', async () => {
    mockPrisma.shift.findFirst.mockResolvedValue({ locationId: 'loc-1' });
    mockPrisma.location.findFirst.mockResolvedValue({ stripeAccountId: null });
    mockPrisma.tenant.findUnique.mockResolvedValue({ stripeAccountId: null });

    const res = await request(app)
      .post('/api/pos/payments/cnp/finalize')
      .send({
        paymentIntentId: 'pi_cnp_4',
        expectedAmountCents: 5000,
        shiftId: 'shift-1',
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('STRIPE_NOT_CONFIGURED');
    expect(mockedStripe.paymentIntents.retrieve).not.toHaveBeenCalled();
  });
});
