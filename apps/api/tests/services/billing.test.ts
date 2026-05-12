import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockPrisma } from '../setup.js';
import {
  buildContract,
  buildSlip,
  buildCustomer,
  buildInvoice,
  buildMeterReading,
} from '../helpers.js';
import { queues } from '../../src/lib/queue.js';

vi.mock('../../src/services/gl-posting.js', () => ({
  postInvoice: vi.fn().mockResolvedValue(undefined),
  postVoid: vi.fn().mockResolvedValue(undefined),
  postPayment: vi.fn().mockResolvedValue(undefined),
  postRefund: vi.fn().mockResolvedValue(undefined),
  postManualJournalEntry: vi.fn().mockResolvedValue('je-test-id'),
}));

// Replace the gl-account-resolver module so the QBO-enqueue gating tests
// below can flip per-location connection state without standing up the
// full prisma mock surface that isLocationQboConnected normally uses.
// resolveDockageRateGlAccount is also exported by billing.ts; existing
// tests never trigger it (slip.locationId/slipType are null) so a no-op
// default is safe.
vi.mock('../../src/services/gl-account-resolver.js', () => ({
  resolveDockageRateGlAccount: vi.fn().mockResolvedValue(null),
  isLocationQboConnected: vi.fn().mockResolvedValue(false),
}));

// The tax-engine mock in tests/setup.ts only covers calculateTax — but
// billing.ts also imports getTaxProvider and checkTaxExempt. Without
// these the recurring-billing run throws inside its catch block and
// returns 0 invoices, which masks every assertion below. Provide both
// here so the engine is fully stubbed for billing-service tests.
vi.mock('../../src/services/tax-engine.js', () => ({
  calculateTax: vi.fn().mockResolvedValue({
    items: [],
    totalTaxCents: 0,
  }),
  getTaxProvider: vi.fn(() => ({
    calculateTax: vi.fn().mockResolvedValue({ items: [], totalTaxCents: 0 }),
  })),
  checkTaxExempt: vi.fn().mockResolvedValue(false),
}));

let generateRecurringInvoices: typeof import('../../src/services/billing.js').generateRecurringInvoices;
let calculateElectricity: typeof import('../../src/services/billing.js').calculateElectricity;
let applyCredits: typeof import('../../src/services/billing.js').applyCredits;

beforeEach(async () => {
  vi.clearAllMocks();
  const mod = await import('../../src/services/billing.js');
  generateRecurringInvoices = mod.generateRecurringInvoices;
  calculateElectricity = mod.calculateElectricity;
  applyCredits = mod.applyCredits;
});

describe('generateRecurringInvoices', () => {
  it('creates invoices for active contracts with billing anchor due today', async () => {
    const today = new Date();
    const customer = buildCustomer({ stripeCustomerId: null });
    const slip = buildSlip({
      slipNumber: 'A-12',
      electricityMode: null,
      flatFeeCents: null,
      kwhRateCents: null,
    });
    const contract = buildContract({
      status: 'ACTIVE',
      billingAnchor: today.getDate(),
      rateCents: 150000,
      customerId: customer.id,
      slipId: slip.id,
      billingCycle: 'MONTHLY',
      startDate: new Date(today.getFullYear(), today.getMonth() - 1, 1),
    });

    mockPrisma.slipContract.findMany.mockResolvedValue([
      {
        ...contract,
        customer: {
          id: customer.id,
          stripeCustomerId: null,
          achBlocked: false,
          firstName: 'Test',
          lastName: 'Customer',
        },
        slip: {
          id: slip.id,
          slipNumber: 'A-12',
          electricityMode: null,
          flatFeeCents: null,
          kwhRateCents: null,
        },
      },
    ]);

    // No existing invoice for this month
    mockPrisma.invoice.findFirst.mockResolvedValue(null);

    // Mock transaction to run callback
    mockPrisma.$transaction.mockImplementation(async (fn: any) => {
      const inv = buildInvoice({
        tenantId: 'tenant-1',
        customerId: customer.id,
        totalCents: 150000,
        lineItems: [
          {
            id: 'li-1',
            extendedCents: 150000,
            taxCents: 0,
            isDeferred: false,
          },
        ],
      });
      const tx = {
        invoice: { create: vi.fn().mockResolvedValue(inv) },
      };
      return fn(tx);
    });

    const results = await generateRecurringInvoices('tenant-1');

    expect(results).toHaveLength(1);
    expect(results[0]).toHaveProperty('invoiceId');
    expect(results[0]).toHaveProperty('customerId', customer.id);
    expect(results[0]).toHaveProperty('totalCents');
    expect(results[0].totalCents).toBeGreaterThan(0);
  });

  // ─── Autopay gate ──────────────────────────────────────────────────────
  // The recurring-billing job must only auto-charge customers who have
  // explicitly turned autopay ON (Stripe metadata.autopay === "true"). The
  // staff/portal toggle writes that flag; these tests pin the read side.
  describe('autopay gate', () => {
    let stripeMock: any;
    beforeEach(async () => {
      stripeMock = (await import('../../src/lib/stripe.js')).stripe;
      // Reset Stripe spies so per-test mockResolvedValue calls don't stack.
      stripeMock.customers.retrieve.mockReset();
      stripeMock.customers.update.mockReset();
      stripeMock.paymentIntents.create.mockReset();
      stripeMock.customers.retrieve.mockResolvedValue({
        id: 'cus_test',
        metadata: { autopay: 'true' },
      });
      stripeMock.paymentIntents.create.mockResolvedValue({
        id: 'pi_test',
        status: 'succeeded',
      });
    });

    function mockContract(opts: { stripeCustomerId: string | null; achBlocked: boolean }) {
      const today = new Date();
      const customer = buildCustomer({ stripeCustomerId: opts.stripeCustomerId });
      const slip = buildSlip({
        slipNumber: 'A-1',
        electricityMode: null,
        flatFeeCents: null,
        kwhRateCents: null,
      });
      const contract = buildContract({
        status: 'ACTIVE',
        billingAnchor: today.getDate(),
        rateCents: 100000,
        customerId: customer.id,
        slipId: slip.id,
        billingCycle: 'MONTHLY',
        startDate: new Date(today.getFullYear(), today.getMonth() - 1, 1),
      });
      mockPrisma.slipContract.findMany.mockResolvedValue([
        {
          ...contract,
          customer: {
            id: customer.id,
            stripeCustomerId: opts.stripeCustomerId,
            achBlocked: opts.achBlocked,
            firstName: 'Test',
            lastName: 'User',
          },
          slip: {
            id: slip.id,
            slipNumber: 'A-1',
            locationId: null,
            electricityMode: null,
            flatFeeCents: null,
            kwhRateCents: null,
          },
        },
      ]);
      // Both the "existing invoice this month" check AND the
      // getStripeAccountForCustomer "recent invoice with location" lookup
      // call invoice.findFirst — return null both times to drive the
      // tenant-account fallback.
      mockPrisma.invoice.findFirst.mockResolvedValue(null);
      mockPrisma.tenant.findUnique.mockResolvedValue({
        stripeAccountId: 'acct_test',
      });
      // $transaction is called twice in the auto-charge path: once to
      // create the invoice + lines, once again INSIDE the auto-charge
      // block to record the payment + mark the invoice paid. Provide a
      // tx that supports the union of both call sites.
      mockPrisma.$transaction.mockImplementation(async (fn: any) => {
        const inv = buildInvoice({
          tenantId: 'tenant-1',
          customerId: customer.id,
          totalCents: 100000,
          balanceCents: 100000,
          lineItems: [
            { id: 'li-1', extendedCents: 100000, taxCents: 0, isDeferred: false },
          ],
        });
        const tx = {
          invoice: {
            create: vi.fn().mockResolvedValue(inv),
            update: vi.fn().mockResolvedValue(inv),
          },
          payment: { create: vi.fn().mockResolvedValue({ id: 'pay-test' }) },
        };
        return fn(tx);
      });
      mockPrisma.invoice.findUnique.mockResolvedValue({ balanceCents: 100000 });
      return { customer, slip, contract };
    }

    it('charges the customer when autopay is turned on', async () => {
      mockContract({ stripeCustomerId: 'cus_test', achBlocked: false });
      stripeMock.customers.retrieve.mockResolvedValue({
        id: 'cus_test',
        metadata: { autopay: 'true' },
      });

      const results = await generateRecurringInvoices('tenant-1');

      expect(results).toHaveLength(1);
      expect(results[0].autoChargeResult).toBe('SUCCESS');
      expect(stripeMock.paymentIntents.create).toHaveBeenCalledTimes(1);
      // Both reads (metadata) and write (paymentIntent) target the SAME
      // resolved Connect account — no cross-account drift.
      expect(stripeMock.customers.retrieve).toHaveBeenCalledWith(
        'cus_test',
        {},
        { stripeAccount: 'acct_test' },
      );
      expect(stripeMock.paymentIntents.create).toHaveBeenCalledWith(
        expect.objectContaining({ customer: 'cus_test', amount: 100000 }),
        { stripeAccount: 'acct_test' },
      );
    });

    it('skips charging when autopay is OFF (the bug this gate closes)', async () => {
      mockContract({ stripeCustomerId: 'cus_test', achBlocked: false });
      stripeMock.customers.retrieve.mockResolvedValue({
        id: 'cus_test',
        metadata: { autopay: 'false' },
      });

      const results = await generateRecurringInvoices('tenant-1');

      expect(results).toHaveLength(1);
      expect(results[0].autoChargeResult).toBe('SKIPPED');
      // Critically: NO payment intent is created when the customer never
      // opted in. This is the exact regression that prompted Task #103.
      expect(stripeMock.paymentIntents.create).not.toHaveBeenCalled();
    });

    it('skips charging when the autopay flag is missing entirely', async () => {
      mockContract({ stripeCustomerId: 'cus_test', achBlocked: false });
      // Brand-new customer who saved a card without ever toggling autopay
      // — Stripe metadata simply has no `autopay` key.
      stripeMock.customers.retrieve.mockResolvedValue({
        id: 'cus_test',
        metadata: {},
      });

      const results = await generateRecurringInvoices('tenant-1');

      expect(results[0].autoChargeResult).toBe('SKIPPED');
      expect(stripeMock.paymentIntents.create).not.toHaveBeenCalled();
    });

    it('still skips ACH-blocked customers without ever calling Stripe', async () => {
      mockContract({ stripeCustomerId: 'cus_test', achBlocked: true });

      const results = await generateRecurringInvoices('tenant-1');

      expect(results[0].autoChargeResult).toBe('SKIPPED');
      // ACH-blocked is a short-circuit BEFORE the autopay metadata read,
      // so Stripe shouldn't be touched at all for these customers.
      expect(stripeMock.customers.retrieve).not.toHaveBeenCalled();
      expect(stripeMock.paymentIntents.create).not.toHaveBeenCalled();
    });

    it('skips customers with no Stripe customer record', async () => {
      mockContract({ stripeCustomerId: null, achBlocked: false });

      const results = await generateRecurringInvoices('tenant-1');

      expect(results[0].autoChargeResult).toBe('SKIPPED');
      expect(stripeMock.customers.retrieve).not.toHaveBeenCalled();
      expect(stripeMock.paymentIntents.create).not.toHaveBeenCalled();
    });
  });

  it('skips contracts that already have an invoice this month', async () => {
    const customer = buildCustomer();
    const slip = buildSlip();
    const contract = buildContract({
      status: 'ACTIVE',
      billingAnchor: new Date().getDate(),
    });

    mockPrisma.slipContract.findMany.mockResolvedValue([
      {
        ...contract,
        customer: {
          id: customer.id,
          stripeCustomerId: null,
          achBlocked: false,
          firstName: 'Test',
          lastName: 'User',
        },
        slip: {
          id: slip.id,
          slipNumber: 'B-5',
          electricityMode: null,
          flatFeeCents: null,
          kwhRateCents: null,
        },
      },
    ]);

    // Existing invoice already found
    mockPrisma.invoice.findFirst.mockResolvedValue(buildInvoice());

    const results = await generateRecurringInvoices('tenant-1');

    expect(results).toHaveLength(0);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });
});

// ─── QBO sync enqueue gate ───────────────────────────────────────────────
// Task #257 wired the recurring billing engine to enqueue a `sync-invoice`
// job after each finalised invoice. The job-name shape ("sync-invoice")
// has to match what the qbo-sync worker switches on, the gating must
// honour both per-location and tenant-level QBO connections, and an
// enqueue failure must never break invoice creation.
describe('QBO sync enqueue', () => {
  const qboSyncQueue = queues['qbo-sync'] as { add: ReturnType<typeof vi.fn> };
  let isLocationQboConnected: ReturnType<typeof vi.fn>;

  function setupBilledContract(opts: {
    locationId?: string | null;
    tenantQboRealmId?: string | null;
  }) {
    const today = new Date();
    const customer = buildCustomer({ stripeCustomerId: null });
    const slip = buildSlip({ slipNumber: 'A-1' });
    const contract = buildContract({
      status: 'ACTIVE',
      billingAnchor: today.getDate(),
      rateCents: 100000,
      customerId: customer.id,
      slipId: slip.id,
      billingCycle: 'MONTHLY',
      startDate: new Date(today.getFullYear(), today.getMonth() - 1, 1),
    });

    mockPrisma.slipContract.findMany.mockResolvedValue([
      {
        ...contract,
        customer: {
          id: customer.id,
          stripeCustomerId: null,
          achBlocked: false,
          firstName: 'Test',
          lastName: 'User',
        },
        slip: {
          id: slip.id,
          slipNumber: 'A-1',
          locationId: opts.locationId ?? null,
          slipType: null,
          electricityMode: null,
          flatFeeCents: null,
          kwhRateCents: null,
        },
      },
    ]);
    mockPrisma.invoice.findFirst.mockResolvedValue(null);
    mockPrisma.tenant.findUnique.mockResolvedValue({
      qboRealmId: opts.tenantQboRealmId ?? null,
    });
    mockPrisma.$transaction.mockImplementation(async (fn: any) => {
      const inv = buildInvoice({
        id: 'inv-recurring-1',
        tenantId: 'tenant-1',
        customerId: customer.id,
        totalCents: 100000,
        balanceCents: 100000,
        lineItems: [{ id: 'li-1', extendedCents: 100000, taxCents: 0, isDeferred: false }],
      });
      const tx = {
        invoice: {
          create: vi.fn().mockResolvedValue(inv),
          update: vi.fn().mockResolvedValue(inv),
        },
        invoiceLineItemTax: { createMany: vi.fn() },
        payment: { create: vi.fn() },
      };
      return fn(tx);
    });
  }

  beforeEach(async () => {
    qboSyncQueue.add.mockReset();
    qboSyncQueue.add.mockResolvedValue({ id: 'job-1' } as any);
    const resolver = await import('../../src/services/gl-account-resolver.js');
    isLocationQboConnected = vi.mocked(resolver.isLocationQboConnected);
    isLocationQboConnected.mockReset();
    isLocationQboConnected.mockResolvedValue(false);
  });

  it('enqueues exactly one sync-invoice job per new invoice when the location has QBO connected', async () => {
    setupBilledContract({ locationId: 'loc-connected', tenantQboRealmId: null });
    isLocationQboConnected.mockResolvedValue(true);

    const results = await generateRecurringInvoices('tenant-1');

    expect(results).toHaveLength(1);
    expect(qboSyncQueue.add).toHaveBeenCalledTimes(1);
    // Job-name shape MUST match what the qbo-sync worker switches on
    // (case "sync-invoice" in apps/api/src/workers/index.ts) — drift
    // here would silently route every recurring invoice to "Unknown
    // job type" and they'd never reach QuickBooks.
    // billing.ts mints the invoice UUID itself BEFORE the tx insert, so
    // the queue payload must carry that same id verbatim — that's the
    // contract the qbo-sync worker uses to look the invoice back up.
    expect(qboSyncQueue.add).toHaveBeenCalledWith(
      'sync-invoice',
      expect.objectContaining({
        tenantId: 'tenant-1',
        invoiceId: expect.any(String),
      }),
    );
    const enqueuedInvoiceId = qboSyncQueue.add.mock.calls[0][1].invoiceId;
    expect(results[0].invoiceId).toBe(enqueuedInvoiceId);
  });

  it('falls back to the tenant-level qboRealmId when the location is not connected', async () => {
    setupBilledContract({ locationId: 'loc-disconnected', tenantQboRealmId: 'realm-tenant' });
    isLocationQboConnected.mockResolvedValue(false);

    const results = await generateRecurringInvoices('tenant-1');

    expect(results).toHaveLength(1);
    expect(qboSyncQueue.add).toHaveBeenCalledTimes(1);
    expect(qboSyncQueue.add).toHaveBeenCalledWith(
      'sync-invoice',
      expect.objectContaining({
        tenantId: 'tenant-1',
        invoiceId: results[0].invoiceId,
      }),
    );
  });

  it('enqueues nothing when neither the location nor the tenant has a QBO connection', async () => {
    setupBilledContract({ locationId: 'loc-disconnected', tenantQboRealmId: null });
    isLocationQboConnected.mockResolvedValue(false);

    const results = await generateRecurringInvoices('tenant-1');

    expect(results).toHaveLength(1);
    expect(qboSyncQueue.add).not.toHaveBeenCalled();
  });

  it('still enqueues via the tenant-realm fallback when the contract has no location', async () => {
    // Slip with no locationId at all — the per-location gate is
    // skipped entirely and we drop straight into the tenant check.
    setupBilledContract({ locationId: null, tenantQboRealmId: 'realm-tenant' });

    const results = await generateRecurringInvoices('tenant-1');

    expect(results).toHaveLength(1);
    expect(qboSyncQueue.add).toHaveBeenCalledTimes(1);
    // We never even consulted isLocationQboConnected because there's
    // no locationId to gate on.
    expect(isLocationQboConnected).not.toHaveBeenCalled();
  });

  it('enqueues exactly one job per invoice across a multi-contract run (no duplicates, no skips)', async () => {
    // Single-contract tests can't catch a regression where the engine
    // enqueues once per RUN instead of once per invoice, or where it
    // re-enqueues the same invoice on every iteration. Drive THREE due
    // contracts through one call and pin the per-invoice 1:1 mapping.
    const today = new Date();
    const customerA = buildCustomer({ id: 'cust-A', stripeCustomerId: null });
    const customerB = buildCustomer({ id: 'cust-B', stripeCustomerId: null });
    const customerC = buildCustomer({ id: 'cust-C', stripeCustomerId: null });
    const baseContract = (id: string, customerId: string, slipNumber: string) =>
      buildContract({
        id,
        status: 'ACTIVE',
        billingAnchor: today.getDate(),
        rateCents: 100000,
        customerId,
        slipId: `slip-${id}`,
        billingCycle: 'MONTHLY',
        startDate: new Date(today.getFullYear(), today.getMonth() - 1, 1),
      });

    mockPrisma.slipContract.findMany.mockResolvedValue([
      {
        ...baseContract('con-A', customerA.id, 'A-1'),
        customer: { id: customerA.id, stripeCustomerId: null, achBlocked: false, firstName: 'A', lastName: 'A' },
        slip: {
          id: 'slip-con-A', slipNumber: 'A-1', locationId: 'loc-connected',
          slipType: null, electricityMode: null, flatFeeCents: null, kwhRateCents: null,
        },
      },
      {
        ...baseContract('con-B', customerB.id, 'B-1'),
        customer: { id: customerB.id, stripeCustomerId: null, achBlocked: false, firstName: 'B', lastName: 'B' },
        slip: {
          id: 'slip-con-B', slipNumber: 'B-1', locationId: 'loc-connected',
          slipType: null, electricityMode: null, flatFeeCents: null, kwhRateCents: null,
        },
      },
      {
        ...baseContract('con-C', customerC.id, 'C-1'),
        customer: { id: customerC.id, stripeCustomerId: null, achBlocked: false, firstName: 'C', lastName: 'C' },
        slip: {
          id: 'slip-con-C', slipNumber: 'C-1', locationId: 'loc-connected',
          slipType: null, electricityMode: null, flatFeeCents: null, kwhRateCents: null,
        },
      },
    ]);
    mockPrisma.invoice.findFirst.mockResolvedValue(null);
    mockPrisma.tenant.findUnique.mockResolvedValue({ qboRealmId: null });
    isLocationQboConnected.mockResolvedValue(true);
    // Each $transaction call is for ONE contract — return a fresh
    // invoice each time so all three look like real distinct creates.
    mockPrisma.$transaction.mockImplementation(async (fn: any) => {
      const tx = {
        invoice: {
          create: vi.fn().mockImplementation(({ data }: any) =>
            Promise.resolve(buildInvoice({
              id: data.id,
              tenantId: 'tenant-1',
              customerId: data.customerId,
              totalCents: 100000,
              balanceCents: 100000,
              lineItems: [{ id: `li-${data.id}`, extendedCents: 100000, taxCents: 0, isDeferred: false }],
            })),
          ),
          update: vi.fn().mockImplementation(({ where }: any) =>
            Promise.resolve(buildInvoice({ id: where.id })),
          ),
        },
        invoiceLineItemTax: { createMany: vi.fn() },
        payment: { create: vi.fn() },
      };
      return fn(tx);
    });

    const results = await generateRecurringInvoices('tenant-1');

    expect(results).toHaveLength(3);
    // Three invoices in, three jobs out — never two, never four.
    expect(qboSyncQueue.add).toHaveBeenCalledTimes(3);
    // Every enqueued invoiceId corresponds to a result invoiceId, and
    // there are no duplicates in either set. This kills the "enqueued
    // the same invoice three times" regression as well as the "only
    // enqueued the last/first one" regression.
    const enqueuedIds = qboSyncQueue.add.mock.calls.map((call) => call[1].invoiceId);
    const resultIds = results.map((r: any) => r.invoiceId);
    expect(new Set(enqueuedIds).size).toBe(3);
    expect(new Set(enqueuedIds)).toEqual(new Set(resultIds));
    // And the job-name shape stays consistent across the run.
    qboSyncQueue.add.mock.calls.forEach((call) => {
      expect(call[0]).toBe('sync-invoice');
      expect(call[1]).toMatchObject({ tenantId: 'tenant-1' });
    });
  });

  it('does not break invoice creation when the queue.add throws', async () => {
    // If Redis is degraded the enqueue can throw — the recurring billing
    // run must NOT lose the invoice it just finalised. The error gets
    // logged and the next contract iteration continues.
    setupBilledContract({ locationId: 'loc-connected', tenantQboRealmId: null });
    isLocationQboConnected.mockResolvedValue(true);
    qboSyncQueue.add.mockRejectedValueOnce(new Error('redis down'));
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const results = await generateRecurringInvoices('tenant-1');

    expect(results).toHaveLength(1);
    expect(results[0]).toHaveProperty('invoiceId');
    expect(typeof results[0].invoiceId).toBe('string');
    // The enqueue was attempted exactly once and failed loudly via
    // console.error rather than bubbling out of the billing engine.
    expect(qboSyncQueue.add).toHaveBeenCalledTimes(1);
    expect(consoleSpy).toHaveBeenCalled();
    const loggedAny = consoleSpy.mock.calls.some((call) =>
      String(call[0]).includes('failed to enqueue qbo-sync'),
    );
    expect(loggedAny).toBe(true);

    consoleSpy.mockRestore();
  });
});

describe('calculateElectricity', () => {
  it('returns electricity charge for metered slips', async () => {
    const reading = buildMeterReading({
      consumedKwh: 350,
      rateCents: 12,
      amountCents: 4200,
    });

    mockPrisma.meterReading.findMany.mockResolvedValue([reading]);
    mockPrisma.invoiceLineItem.findMany.mockResolvedValue([]);

    const result = await calculateElectricity('slip-1', 'tenant-1');

    expect(result).not.toBeNull();
    expect(result!.consumedKwh).toBe(350);
    expect(result!.rateCents).toBe(12);
    expect(result!.amountCents).toBe(4200);
    expect(result!.meterReadingIds[0]).toBe(reading.id);
  });

  it('returns null when no meter reading exists', async () => {
    mockPrisma.meterReading.findMany.mockResolvedValue([]);

    const result = await calculateElectricity('slip-1', 'tenant-1');

    expect(result).toBeNull();
  });
});

describe('applyCredits', () => {
  it('applies unapplied credit payments to invoice balance', async () => {
    const invoice = buildInvoice({
      balanceCents: 10000,
      status: 'ISSUED',
    });

    mockPrisma.invoice.findFirst.mockResolvedValue(invoice);
    mockPrisma.payment.findMany.mockResolvedValue([
      { id: 'credit-1', amountCents: 3000, createdAt: new Date() },
      { id: 'credit-2', amountCents: 5000, createdAt: new Date() },
    ]);
    mockPrisma.$transaction.mockImplementation(async (fn: any) => {
      const tx = {
        payment: { update: vi.fn() },
        invoice: { update: vi.fn() },
      };
      return fn(tx);
    });

    const applied = await applyCredits(invoice.id, 'tenant-1');

    expect(applied).toBe(8000);
  });

  it('returns 0 when invoice balance is already zero', async () => {
    const invoice = buildInvoice({ balanceCents: 0 });
    mockPrisma.invoice.findFirst.mockResolvedValue(invoice);

    const applied = await applyCredits(invoice.id, 'tenant-1');

    expect(applied).toBe(0);
    expect(mockPrisma.payment.findMany).not.toHaveBeenCalled();
  });
});

// ─── Task #274 — Linked DockageRate drives GL resolution ──────────
//
// When a contract is linked to a rate plan, the billing engine must
// resolve GL via that plan (deterministic, audit-traceable). When the
// link is absent or the plan was deactivated, it must fall back to
// the legacy (location, slipType) lookup so historical contracts
// keep billing — surfacing the gap via console.warn rather than
// crashing the run.
describe('generateRecurringInvoices — DockageRate link (Task #274)', () => {
  let resolveMock: any;
  beforeEach(async () => {
    const resolver = await import('../../src/services/gl-account-resolver.js');
    resolveMock = resolver.resolveDockageRateGlAccount as any;
    resolveMock.mockReset();
  });

  function makeRow({ dockageRate, locationId = 'loc-1', slipType = 'STANDARD' }: any) {
    const today = new Date();
    const customer = buildCustomer({ stripeCustomerId: null });
    const slip = buildSlip({ slipNumber: 'A-12', locationId, slipType });
    const contract = buildContract({
      status: 'ACTIVE',
      billingAnchor: today.getDate(),
      rateCents: 150000,
      customerId: customer.id,
      slipId: slip.id,
      billingCycle: 'MONTHLY',
      startDate: new Date(today.getFullYear(), today.getMonth() - 1, 1),
    });
    return {
      ...contract,
      customer: {
        id: customer.id, stripeCustomerId: null, achBlocked: false,
        firstName: 'A', lastName: 'B',
      },
      slip: {
        id: slip.id, slipNumber: 'A-12', locationId, slipType,
        electricityMode: null, flatFeeCents: null, kwhRateCents: null,
      },
      dockageRate,
    };
  }

  function bootRunMocks() {
    mockPrisma.invoice.findFirst.mockResolvedValue(null);
    mockPrisma.$transaction.mockImplementation(async (fn: any) => {
      const inv = buildInvoice({ totalCents: 150000, lineItems: [{ id: 'li-1', extendedCents: 150000, taxCents: 0, isDeferred: false }] });
      const tx = { invoice: { create: vi.fn().mockResolvedValue(inv) } };
      return fn(tx);
    });
  }

  it('uses the linked plan for GL resolution and skips the (location, slipType) fallback', async () => {
    const PLAN_ID = 'rate-linked';
    mockPrisma.slipContract.findMany.mockResolvedValue([
      makeRow({ dockageRate: { id: PLAN_ID, glAccountId: 'gl-from-plan', active: true, slipType: 'STANDARD', taxClass: null } }),
    ]);
    bootRunMocks();
    resolveMock.mockResolvedValue('gl-resolved');

    const results = await generateRecurringInvoices('tenant-1');

    expect(results).toHaveLength(1);
    // Resolver was called with the linked plan id, not via a fallback findFirst.
    expect(resolveMock).toHaveBeenCalledWith('tenant-1', PLAN_ID, 'loc-1');
    expect(mockPrisma.dockageRate.findFirst).not.toHaveBeenCalled();
  });

  it("uses the linked plan's taxClass to drive line-item taxCategory", async () => {
    // The taxClass on the linked rate plan must flow through to the
    // tax engine's per-line taxCategory so an EXEMPT plan books slip
    // dockage as exempt rather than taxable "slip_rental".
    const taxEngine: any = await import('../../src/services/tax-engine.js');
    const captured: any[] = [];
    taxEngine.getTaxProvider.mockReturnValue({
      calculateTax: vi.fn().mockImplementation(async (args: any) => {
        captured.push(args);
        return { items: args.lineItems.map((li: any) => ({ description: li.description, taxRate: 0, taxCents: 0, breakdowns: [] })), totalTaxCents: 0 };
      }),
    });
    // Force the tax engine to actually be invoked (skip the customer-
    // exempt + missing-location shortcut in billing.ts).
    mockPrisma.location.findUnique.mockResolvedValue({ taxProvider: 'noop' });

    mockPrisma.slipContract.findMany.mockResolvedValue([
      makeRow({ dockageRate: { id: 'plan-tx', glAccountId: 'gl-x', active: true, slipType: 'STANDARD', taxClass: 'EXEMPT' } }),
    ]);
    bootRunMocks();
    resolveMock.mockResolvedValue('gl-x');

    await generateRecurringInvoices('tenant-1');

    const slipLine = captured[0]?.lineItems?.find((li: any) =>
      li.description.startsWith('Slip '),
    );
    expect(slipLine?.taxCategory).toBe('exempt');
  });

  it('uses the linked plan even when deactivated and warns rather than re-routing GL', async () => {
    // deactivating a rate plan removes it from new-contract
    // pickers but historical contracts already pointed at that plan
    // must keep billing to the same GL the operator originally chose.
    // Silently re-routing to a different (location, slipType) plan
    // would corrupt the audit trail. We warn so the gap is visible
    // and the operator can re-link to a current plan.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const DEAD_PLAN_ID = 'rate-dead';
    mockPrisma.slipContract.findMany.mockResolvedValue([
      makeRow({ dockageRate: { id: DEAD_PLAN_ID, glAccountId: 'gl-from-plan', active: false, slipType: 'STANDARD', taxClass: null } }),
    ]);
    bootRunMocks();
    resolveMock.mockResolvedValue('gl-from-plan');

    const results = await generateRecurringInvoices('tenant-1');

    expect(results).toHaveLength(1);
    // Resolver was still called with the linked (deactivated) plan id.
    expect(resolveMock).toHaveBeenCalledWith('tenant-1', DEAD_PLAN_ID, 'loc-1');
    // The (location, slipType) fallback lookup must NOT run when a link exists.
    expect(mockPrisma.dockageRate.findFirst).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('deactivated dockage rate'));
    warnSpy.mockRestore();
  });

  it('warns and falls back when no plan is linked at all', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    mockPrisma.slipContract.findMany.mockResolvedValue([
      makeRow({ dockageRate: null }),
    ]);
    mockPrisma.dockageRate.findFirst.mockResolvedValue(null);
    bootRunMocks();

    const results = await generateRecurringInvoices('tenant-1');

    expect(results).toHaveLength(1);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('no linked dockage rate'));
    warnSpy.mockRestore();
  });
});
