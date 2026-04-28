import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockPrisma } from '../setup.js';
import {
  buildContract,
  buildSlip,
  buildCustomer,
  buildInvoice,
  buildMeterReading,
} from '../helpers.js';

vi.mock('../../src/services/gl-posting.js', () => ({
  postInvoice: vi.fn().mockResolvedValue(undefined),
  postVoid: vi.fn().mockResolvedValue(undefined),
  postPayment: vi.fn().mockResolvedValue(undefined),
  postRefund: vi.fn().mockResolvedValue(undefined),
  postManualJournalEntry: vi.fn().mockResolvedValue('je-test-id'),
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
