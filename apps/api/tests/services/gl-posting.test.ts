import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockPrisma } from '../setup.js';

// Override the global mock from setup.ts — this test exercises the real implementation.
vi.mock('../../src/services/gl-posting.js', async (importOriginal) => {
  return await importOriginal();
});

let postInvoice: typeof import('../../src/services/gl-posting.js').postInvoice;
let postPayment: typeof import('../../src/services/gl-posting.js').postPayment;
let postManualJournalEntry: typeof import('../../src/services/gl-posting.js').postManualJournalEntry;
let postSecurityDeposit: typeof import('../../src/services/gl-posting.js').postSecurityDeposit;
let releaseSecurityDeposit: typeof import('../../src/services/gl-posting.js').releaseSecurityDeposit;

beforeEach(async () => {
  vi.clearAllMocks();
  const mod = await import('../../src/services/gl-posting.js');
  postInvoice = mod.postInvoice;
  postPayment = mod.postPayment;
  postManualJournalEntry = mod.postManualJournalEntry;
  postSecurityDeposit = mod.postSecurityDeposit;
  releaseSecurityDeposit = mod.releaseSecurityDeposit;
});

describe('postInvoice', () => {
  it('creates balanced debit/credit GL entries for an invoice', async () => {
    // Mock account lookups.
    // getDeferredRevenueAccountId makes two findFirst calls:
    //   1. isDeferredRevenue = true  → null (no flagged account)
    //   2. accountNumber '2100'      → null (not in test CoA either)
    // Then postInvoice falls through to the revenue account lookup.
    mockPrisma.glAccount.findFirst
      .mockResolvedValueOnce({ id: 'acct-ar' })    // Accounts Receivable
      .mockResolvedValueOnce(null)                   // deferred flag query → not found
      .mockResolvedValueOnce(null)                   // deferred fallback by number → not found
      .mockResolvedValueOnce({ id: 'acct-revenue' }); // General Revenue (4500)

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

// ---------------------------------------------------------------------------
// Per-location security deposit posting
// ---------------------------------------------------------------------------
// Multi-marina operators run separate per-location charts of accounts (one
// per QBO realm). Security deposits booked at marina A must credit A's
// security-deposits-held liability and debit A's bank — and a release must
// reverse exactly those same A-scoped rows. These tests stand up two
// per-location charts (each with their own bank + 2300 liability rows
// flagged on `locationId`) and assert that postSecurityDeposit and
// releaseSecurityDeposit pick the correct location's accounts based on the
// `locationId` carried on the deposit.

describe('postSecurityDeposit / releaseSecurityDeposit per-location chart', () => {
  // Per-location charts: marina A and marina B each have their own
  // bank (1010) and security-deposits-held (2300) accounts.
  const CHART = {
    'loc-A': {
      '1010': 'acct-A-bank',
      '2300': 'acct-A-deposits',
      '1200': 'acct-A-ar',
    },
    'loc-B': {
      '1010': 'acct-B-bank',
      '2300': 'acct-B-deposits',
      '1200': 'acct-B-ar',
    },
  } as const;

  beforeEach(() => {
    // Both locations are QBO-connected so the strict per-location lookup
    // path is exercised.
    mockPrisma.location.findUnique.mockImplementation(async ({ where }: any) => ({
      id: where.id,
      qboAccessToken: 'tok',
      qboRealmId: `realm-${where.id}`,
    }));

    // Resolve glAccount.findFirst against the location-scoped chart only.
    // If a query asks for a location that doesn't have a row we return
    // null so any cross-marina lookup fails loudly.
    mockPrisma.glAccount.findFirst.mockImplementation(async ({ where }: any) => {
      const locId = where?.locationId as keyof typeof CHART | undefined;
      const num = where?.accountNumber as keyof (typeof CHART)['loc-A'] | undefined;
      if (!locId || !num) return null;
      const chart = CHART[locId];
      if (!chart) return null;
      const id = chart[num];
      return id ? { id } : null;
    });

    mockPrisma.glEntry.createMany.mockResolvedValue({ count: 2 });
  });

  it('books a deposit against the originating marina’s bank and 2300 liability', async () => {
    await postSecurityDeposit({
      id: 'dep-A1',
      tenantId: 'tenant-1',
      amountCents: 50000,
      locationId: 'loc-A',
    });

    const entries = mockPrisma.glEntry.createMany.mock.calls[0][0].data;
    const debit = entries.find((e: any) => e.debitCents > 0);
    const credit = entries.find((e: any) => e.creditCents > 0);

    expect(debit.accountId).toBe(CHART['loc-A']['1010']);   // Bank @ A
    expect(credit.accountId).toBe(CHART['loc-A']['2300']);  // Liability @ A
    expect(debit.debitCents).toBe(50000);
    expect(credit.creditCents).toBe(50000);

    // Confirm we never resolved against marina B's accounts.
    const allCalls = mockPrisma.glAccount.findFirst.mock.calls;
    expect(allCalls.every((c: any) => c[0].where.locationId !== 'loc-B')).toBe(true);
  });

  it('releases a deposit against the same marina’s bank and 2300 liability', async () => {
    await releaseSecurityDeposit({
      id: 'dep-A1',
      tenantId: 'tenant-1',
      amountCents: 50000,
      locationId: 'loc-A',
    });

    const entries = mockPrisma.glEntry.createMany.mock.calls[0][0].data;
    const debit = entries.find((e: any) => e.debitCents > 0);
    const credit = entries.find((e: any) => e.creditCents > 0);

    expect(debit.accountId).toBe(CHART['loc-A']['2300']);   // Liability cleared @ A
    expect(credit.accountId).toBe(CHART['loc-A']['1010']);  // Refunded from bank @ A
    expect(debit.debitCents).toBe(50000);
    expect(credit.creditCents).toBe(50000);

    const allCalls = mockPrisma.glAccount.findFirst.mock.calls;
    expect(allCalls.every((c: any) => c[0].where.locationId !== 'loc-B')).toBe(true);
  });

  it('release-to-invoice debits 2300 liability and credits A/R on the originating marina', async () => {
    await releaseSecurityDeposit({
      id: 'dep-A2',
      tenantId: 'tenant-1',
      amountCents: 30000,
      appliedToInvoiceId: 'inv-99',
      locationId: 'loc-A',
    });

    const entries = mockPrisma.glEntry.createMany.mock.calls[0][0].data;
    const debit = entries.find((e: any) => e.debitCents > 0);
    const credit = entries.find((e: any) => e.creditCents > 0);

    expect(debit.accountId).toBe(CHART['loc-A']['2300']);   // Liability cleared @ A
    expect(credit.accountId).toBe(CHART['loc-A']['1200']);  // A/R reduction @ A
  });

  it('books deposits at marina B against B’s chart, never A’s', async () => {
    await postSecurityDeposit({
      id: 'dep-B1',
      tenantId: 'tenant-1',
      amountCents: 75000,
      locationId: 'loc-B',
    });

    const entries = mockPrisma.glEntry.createMany.mock.calls[0][0].data;
    const accountIds = entries.map((e: any) => e.accountId);
    expect(accountIds).toContain(CHART['loc-B']['1010']);
    expect(accountIds).toContain(CHART['loc-B']['2300']);
    expect(accountIds).not.toContain(CHART['loc-A']['1010']);
    expect(accountIds).not.toContain(CHART['loc-A']['2300']);
  });

  it('refuses to post when QBO-connected location has no 2300 liability mapped', async () => {
    // Override the chart resolver: marina A is QBO-connected but is
    // missing the 2300 row. The strict path must throw rather than
    // silently routing the credit to a tenant-wide row from another
    // realm.
    mockPrisma.glAccount.findFirst.mockImplementation(async ({ where }: any) => {
      if (where?.locationId === 'loc-A' && where?.accountNumber === '2300') return null;
      if (where?.locationId === 'loc-A' && where?.accountNumber === '1010') {
        return { id: CHART['loc-A']['1010'] };
      }
      return null;
    });

    await expect(
      postSecurityDeposit({
        id: 'dep-A3',
        tenantId: 'tenant-1',
        amountCents: 1000,
        locationId: 'loc-A',
      }),
    ).rejects.toThrow(/UNCONFIGURED_GL_MAPPING/);
  });
});
