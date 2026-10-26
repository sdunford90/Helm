import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockPrisma } from '../setup.js';
import { stripe } from '../../src/lib/stripe.js';
import {
  buildContract,
  buildSlip,
  buildCustomer,
  buildInvoice,
  buildMeterReading,
} from '../helpers.js';

let billing: typeof import('../../src/services/billing.js');

beforeEach(async () => {
  vi.clearAllMocks();
  mockPrisma.tenant.findUnique.mockReset().mockResolvedValue(null);
  mockPrisma.invoice.findFirst.mockReset().mockResolvedValue(null);
  mockPrisma.invoice.findUnique.mockReset().mockResolvedValue(null);
  mockPrisma.payment.findMany.mockReset().mockResolvedValue([]);
  mockPrisma.payment.updateMany.mockReset().mockResolvedValue({ count: 1 });
  mockPrisma.payment.create.mockReset().mockResolvedValue({ id: 'pay-remainder' });
  mockPrisma.invoice.update.mockReset().mockResolvedValue({ balanceCents: 0 });
  mockPrisma.auditLog.create.mockReset().mockResolvedValue({});
  mockPrisma.$transaction.mockReset().mockImplementation((arg: any) =>
    typeof arg === 'function' ? arg(mockPrisma) : Promise.all(arg),
  );
  billing = await import('../../src/services/billing.js');
});

function dueContract(customerOverrides: Record<string, unknown> = {}) {
  const today = new Date();
  const customer = buildCustomer();
  const slip = buildSlip({ slipNumber: 'A-12', electricityMode: null, flatFeeCents: null, kwhRateCents: null });
  const contract = buildContract({
    status: 'ACTIVE',
    billingAnchor: today.getDate(),
    rateCents: 150000,
    customerId: customer.id,
    slipId: slip.id,
    billingCycle: 'MONTHLY',
    electricityMode: null,
    qboItemId: null,
    startDate: new Date(today.getFullYear(), today.getMonth() - 1, 1),
  });
  return {
    ...contract,
    customer: {
      id: customer.id,
      stripeCustomerId: null,
      achBlocked: false,
      firstName: 'Test',
      lastName: 'Customer',
      ...customerOverrides,
    },
    slip: { id: slip.id, slipNumber: 'A-12', electricityMode: null, flatFeeCents: null, kwhRateCents: null },
  };
}

function mockInvoiceCreate() {
  mockPrisma.invoice.create.mockReset().mockImplementation(async ({ data }: any) =>
    buildInvoice({
      id: data.id,
      totalCents: data.totalCents,
      balanceCents: data.balanceCents,
      lineItems: [{ id: 'li-1', extendedCents: data.subtotalCents, taxCents: 0, isDeferred: false }],
    }),
  );
}

describe('generateRecurringInvoices', () => {
  it('creates invoices for active contracts with billing anchor due today', async () => {
    mockPrisma.slipContract.findMany.mockResolvedValue([dueContract()]);
    mockInvoiceCreate();

    const results = await billing.generateRecurringInvoices('tenant-1');

    expect(results).toHaveLength(1);
    expect(results[0]).toHaveProperty('invoiceId');
    expect(results[0]).toHaveProperty('customerId', 'cust-1');
    expect(results[0].totalCents).toBeGreaterThan(0);
  });

  it('skips contracts that already have an invoice this month', async () => {
    mockPrisma.slipContract.findMany.mockResolvedValue([dueContract()]);
    mockPrisma.invoice.findFirst.mockResolvedValue(buildInvoice());

    const results = await billing.generateRecurringInvoices('tenant-1');

    expect(results).toHaveLength(0);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('does NOT auto-charge when the tenant has not enabled auto-charge (default OFF)', async () => {
    mockPrisma.tenant.findUnique.mockResolvedValue({ stripeAccountId: 'acct_1', invoiceTemplateJson: {} });
    mockPrisma.slipContract.findMany.mockResolvedValue([dueContract({ stripeCustomerId: 'cus_1' })]);
    mockInvoiceCreate();

    const results = await billing.generateRecurringInvoices('tenant-1');

    expect(results).toHaveLength(1);
    expect(results[0].autoChargeResult).toBe('SKIPPED');
    expect(stripe!.paymentIntents.create).not.toHaveBeenCalled();
  });

  it('auto-charges when invoiceTemplateJson.autoChargeEnabled === true', async () => {
    mockPrisma.tenant.findUnique.mockResolvedValue({
      stripeAccountId: 'acct_1',
      invoiceTemplateJson: { autoChargeEnabled: true },
    });
    mockPrisma.slipContract.findMany.mockResolvedValue([dueContract({ stripeCustomerId: 'cus_1' })]);
    mockInvoiceCreate();
    mockPrisma.invoice.findUnique.mockResolvedValue({ balanceCents: 150000 });

    const results = await billing.generateRecurringInvoices('tenant-1');

    expect(stripe!.paymentIntents.create).toHaveBeenCalledTimes(1);
    expect((stripe!.paymentIntents.create as any).mock.calls[0][1]).toEqual({ stripeAccount: 'acct_1' });
    expect(results[0].autoChargeResult).toBe('SUCCESS');
  });
});

describe('isAutoChargeEnabled', () => {
  it('is only true for an explicit boolean true', () => {
    expect(billing.isAutoChargeEnabled(null)).toBe(false);
    expect(billing.isAutoChargeEnabled({})).toBe(false);
    expect(billing.isAutoChargeEnabled({ autoChargeEnabled: false })).toBe(false);
    expect(billing.isAutoChargeEnabled({ autoChargeEnabled: 'true' })).toBe(false);
    expect(billing.isAutoChargeEnabled([true])).toBe(false);
    expect(billing.isAutoChargeEnabled({ autoChargeEnabled: true })).toBe(true);
  });
});

describe('calculateElectricity', () => {
  it('returns electricity charge for metered slips', async () => {
    const reading = buildMeterReading({ consumedKwh: 350, rateCents: 12, amountCents: 4200 });
    mockPrisma.meterReading.findFirst.mockResolvedValue(reading);

    const result = await billing.calculateElectricity('slip-1', 'tenant-1');

    expect(result).not.toBeNull();
    expect(result!.consumedKwh).toBe(350);
    expect(result!.rateCents).toBe(12);
    expect(result!.amountCents).toBe(4200);
    expect(result!.meterReadingId).toBe(reading.id);
  });

  it('returns null when no meter reading exists', async () => {
    mockPrisma.meterReading.findFirst.mockResolvedValue(null);
    expect(await billing.calculateElectricity('slip-1', 'tenant-1')).toBeNull();
  });
});

describe('applyCredits', () => {
  const credit = (id: string, amountCents: number) => ({
    id,
    tenantId: 'tenant-1',
    customerId: 'cust-1',
    invoiceId: null,
    amountCents,
    method: 'CHECK',
    postedDate: new Date('2026-01-01'),
    status: 'COMPLETED',
    createdAt: new Date(),
  });

  it('applies whole credits until the balance is covered', async () => {
    mockPrisma.invoice.findFirst.mockResolvedValue(buildInvoice({ balanceCents: 10000, status: 'ISSUED' }));
    mockPrisma.payment.findMany.mockResolvedValue([credit('credit-1', 3000), credit('credit-2', 5000)]);
    mockPrisma.invoice.update.mockResolvedValue({ balanceCents: 2000 });

    const applied = await billing.applyCredits('inv-1', 'tenant-1');

    expect(applied).toBe(8000);
    expect(mockPrisma.payment.create).not.toHaveBeenCalled(); // no split needed
    expect(mockPrisma.invoice.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { balanceCents: { decrement: 8000 } } }),
    );
    // Not fully paid: no status change.
    expect(mockPrisma.invoice.update).toHaveBeenCalledTimes(1);
  });

  it('keeps the unused remainder of a partially used credit (W-4: $100 credit, $60 invoice)', async () => {
    mockPrisma.invoice.findFirst.mockResolvedValue(buildInvoice({ balanceCents: 6000, status: 'ISSUED' }));
    mockPrisma.payment.findMany.mockResolvedValue([credit('credit-1', 10000)]);
    mockPrisma.invoice.update.mockResolvedValueOnce({ balanceCents: 0 }).mockResolvedValueOnce({});

    const applied = await billing.applyCredits('inv-1', 'tenant-1');

    expect(applied).toBe(6000);
    // Original credit is reduced to the applied amount and linked to the invoice,
    // guarded so it cannot be spent twice.
    expect(mockPrisma.payment.updateMany).toHaveBeenCalledWith({
      where: { id: 'credit-1', tenantId: 'tenant-1', invoiceId: null, amountCents: 10000 },
      data: { invoiceId: 'inv-1', amountCents: 6000 },
    });
    // The $40 remainder stays available as an unapplied credit.
    expect(mockPrisma.payment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: 'tenant-1',
        customerId: 'cust-1',
        invoiceId: null,
        amountCents: 4000,
        status: 'COMPLETED',
        method: 'CHECK',
      }),
    });
    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'CREDIT_SPLIT' }) }),
    );
    // Fully paid now.
    expect(mockPrisma.invoice.update).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: { status: 'PAID' } }),
    );
    // All in one transaction.
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('skips a credit that was spent concurrently', async () => {
    mockPrisma.invoice.findFirst.mockResolvedValue(buildInvoice({ balanceCents: 6000, status: 'ISSUED' }));
    mockPrisma.payment.findMany.mockResolvedValue([credit('credit-1', 10000)]);
    mockPrisma.payment.updateMany.mockResolvedValue({ count: 0 });

    expect(await billing.applyCredits('inv-1', 'tenant-1')).toBe(0);
    expect(mockPrisma.payment.create).not.toHaveBeenCalled();
    expect(mockPrisma.invoice.update).not.toHaveBeenCalled();
  });

  it('returns 0 when invoice balance is already zero', async () => {
    mockPrisma.invoice.findFirst.mockResolvedValue(buildInvoice({ balanceCents: 0 }));

    const applied = await billing.applyCredits('inv-1', 'tenant-1');

    expect(applied).toBe(0);
    expect(mockPrisma.payment.findMany).not.toHaveBeenCalled();
  });
});
