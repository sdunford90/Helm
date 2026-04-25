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
