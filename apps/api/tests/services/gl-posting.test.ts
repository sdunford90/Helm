import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockPrisma } from '../setup.js';

// Override the global mock from setup.ts — this test exercises the real implementation.
vi.mock('../../src/services/gl-posting.js', async (importOriginal) => {
  return await importOriginal();
});

let postInvoice: typeof import('../../src/services/gl-posting.js').postInvoice;
let postPayment: typeof import('../../src/services/gl-posting.js').postPayment;
let postManualJournalEntry: typeof import('../../src/services/gl-posting.js').postManualJournalEntry;

beforeEach(async () => {
  vi.clearAllMocks();
  const mod = await import('../../src/services/gl-posting.js');
  postInvoice = mod.postInvoice;
  postPayment = mod.postPayment;
  postManualJournalEntry = mod.postManualJournalEntry;
});

describe('postInvoice', () => {
  it('creates balanced debit/credit GL entries for an invoice', async () => {
    // Mock account lookups
    mockPrisma.glAccount.findFirst
      .mockResolvedValueOnce({ id: 'acct-ar' })    // Accounts Receivable
      .mockResolvedValueOnce(null)                   // Deferred Revenue (not found, catch)
      .mockResolvedValueOnce({ id: 'acct-revenue' }); // General Revenue fallback

    mockPrisma.glEntry.createMany.mockResolvedValue({ count: 2 });

    const journalId = await postInvoice({
      id: 'inv-1',
      tenantId: 'tenant-1',
      totalCents: 150000,
      lineItems: [
        {
          id: 'li-1',
          extendedCents: 140000,
          taxCents: 10000,
          glAccountId: null,
          isDeferred: false,
        },
      ],
    });

    expect(journalId).toBeDefined();
    expect(typeof journalId).toBe('string');
    expect(mockPrisma.glEntry.createMany).toHaveBeenCalledTimes(1);

    // Verify the entries are balanced
    const callArgs = mockPrisma.glEntry.createMany.mock.calls[0][0];
    const entries = callArgs.data;
    const totalDebits = entries.reduce((s: number, e: any) => s + e.debitCents, 0);
    const totalCredits = entries.reduce((s: number, e: any) => s + e.creditCents, 0);
    expect(totalDebits).toBe(totalCredits);
    expect(totalDebits).toBe(150000);
  });
});

describe('postPayment', () => {
  it('creates balanced debit/credit entries for a payment', async () => {
    mockPrisma.glAccount.findFirst
      .mockResolvedValueOnce({ id: 'acct-bank' }) // Bank account
      .mockResolvedValueOnce({ id: 'acct-ar' });  // Accounts Receivable

    mockPrisma.glEntry.createMany.mockResolvedValue({ count: 2 });

    const journalId = await postPayment({
      id: 'pay-1',
      tenantId: 'tenant-1',
      amountCents: 50000,
      method: 'CARD',
    });

    expect(journalId).toBeDefined();

    const callArgs = mockPrisma.glEntry.createMany.mock.calls[0][0];
    const entries = callArgs.data;
    const totalDebits = entries.reduce((s: number, e: any) => s + e.debitCents, 0);
    const totalCredits = entries.reduce((s: number, e: any) => s + e.creditCents, 0);
    expect(totalDebits).toBe(totalCredits);
    expect(totalDebits).toBe(50000);
  });

  it('uses cash account for CASH payments', async () => {
    mockPrisma.glAccount.findFirst
      .mockResolvedValueOnce({ id: 'acct-cash' }) // Cash account (1000)
      .mockResolvedValueOnce({ id: 'acct-ar' });

    mockPrisma.glEntry.createMany.mockResolvedValue({ count: 2 });

    await postPayment({
      id: 'pay-2',
      tenantId: 'tenant-1',
      amountCents: 2000,
      method: 'CASH',
    });

    // Verify it looked up cash account (1000) not bank (1010)
    expect(mockPrisma.glAccount.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ accountNumber: '1000' }),
      }),
    );
  });
});

describe('postManualJournalEntry', () => {
  it('rejects unbalanced entries', async () => {
    mockPrisma.glEntry.createMany.mockResolvedValue({ count: 0 });

    await expect(
      postManualJournalEntry('tenant-1', [
        { accountId: 'acct-1', debitCents: 5000, creditCents: 0 },
        { accountId: 'acct-2', debitCents: 0, creditCents: 3000 },
      ]),
    ).rejects.toThrow(/do not balance/i);
  });

  it('rejects zero-amount entries', async () => {
    await expect(
      postManualJournalEntry('tenant-1', [
        { accountId: 'acct-1', debitCents: 0, creditCents: 0 },
        { accountId: 'acct-2', debitCents: 0, creditCents: 0 },
      ]),
    ).rejects.toThrow(/cannot all be zero/i);
  });

  it('accepts balanced entries and returns journal ID', async () => {
    mockPrisma.glEntry.createMany.mockResolvedValue({ count: 2 });

    const journalId = await postManualJournalEntry('tenant-1', [
      { accountId: 'acct-1', debitCents: 10000, creditCents: 0 },
      { accountId: 'acct-2', debitCents: 0, creditCents: 10000 },
    ]);

    expect(journalId).toBeDefined();
    expect(typeof journalId).toBe('string');
  });
});
