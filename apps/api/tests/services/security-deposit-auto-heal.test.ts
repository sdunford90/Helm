import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockPrisma } from '../setup.js';

// Exercise the real gl-posting implementation (the global setup mocks it
// out so route tests don't accidentally hit the real posting logic).
vi.mock('../../src/services/gl-posting.js', async (importOriginal) => {
  return await importOriginal();
});

let postSecurityDeposit: typeof import('../../src/services/gl-posting.js').postSecurityDeposit;
let releaseSecurityDeposit: typeof import('../../src/services/gl-posting.js').releaseSecurityDeposit;

beforeEach(async () => {
  vi.clearAllMocks();
  const mod = await import('../../src/services/gl-posting.js');
  postSecurityDeposit = mod.postSecurityDeposit;
  releaseSecurityDeposit = mod.releaseSecurityDeposit;
});

// ---------------------------------------------------------------------------
// Regression test for production crash:
//   "GL account 2300 not found for tenant ..." (unhandled 500) raised mid-tx
//   from `releaseSecurityDeposit` for tenants whose chart of accounts was
//   missing the system Security-Deposits-Held row.
//
// The fix in `gl-posting.ts` auto-creates the missing tenant-wide row on
// first reference instead of throwing. These tests assert:
//   1. Releasing a deposit when 2300 is missing auto-heals (creates the row,
//      then posts the journal against it) rather than throwing.
//   2. When the lookup fundamentally can't be satisfied (e.g. 2300 still
//      missing AND auto-create itself fails), the caller gets a typed
//      `UNCONFIGURED_GL_ACCOUNT` error with statusCode 400 — never a bare
//      `Error: GL account 2300 not found ...` that surfaces as a 500.
// ---------------------------------------------------------------------------

describe('gl-posting auto-heal of missing system accounts', () => {
  it('releaseSecurityDeposit auto-creates the missing 2300 row instead of throwing', async () => {
    // Simulate a non-QBO tenant: location.findUnique returns no qbo*
    // fields so resolveLocationScopedAccountByNumber goes through the
    // lenient (auto-heal-eligible) `getAccountByNumber` path.
    mockPrisma.location.findUnique.mockResolvedValue({
      id: 'loc-1',
      qboAccessToken: null,
      qboRealmId: null,
    });

    // Shared chart-of-accounts state: starts with 1010 (bank) only — no
    // 2300 (Security Deposits Held). Auto-heal should insert a tenant-wide
    // 2300 row on the fly.
    const accounts: Array<{
      id: string;
      tenantId: string;
      locationId: string | null;
      accountNumber: string;
      name: string;
      type: string;
    }> = [
      {
        id: 'acct-bank',
        tenantId: 'tenant-1',
        locationId: null,
        accountNumber: '1010',
        name: 'Stripe Clearing',
        type: 'ASSET',
      },
    ];

    mockPrisma.glAccount.findFirst.mockImplementation(async ({ where }: any) => {
      const match = accounts.find((a) => {
        if (a.tenantId !== where.tenantId) return false;
        if (where.accountNumber !== undefined && a.accountNumber !== where.accountNumber) return false;
        if ('locationId' in where) {
          if (where.locationId !== a.locationId) return false;
        }
        if (where.subType !== undefined) return false;
        if (where.isDeferredRevenue !== undefined) return false;
        return true;
      });
      return match ? { id: match.id } : null;
    });
    mockPrisma.glAccount.findMany.mockResolvedValue([]);
    mockPrisma.glAccount.create = vi.fn().mockImplementation(async ({ data, select }: any) => {
      const row = {
        id: `acct-${data.accountNumber}-auto`,
        tenantId: data.tenantId,
        locationId: data.locationId ?? null,
        accountNumber: data.accountNumber,
        name: data.name,
        type: data.type,
      };
      accounts.push(row);
      return select?.id ? { id: row.id } : row;
    });

    mockPrisma.glEntry.createMany.mockResolvedValue({ count: 2 });

    // Refund-to-customer path: needs 2300 (auto-healed) + 1010 (present).
    const journalId = await releaseSecurityDeposit({
      id: 'dep-1',
      tenantId: 'tenant-1',
      amountCents: 25000,
      locationId: 'loc-1',
    });

    expect(journalId).toBeDefined();
    // Auto-heal must have created the missing 2300 row.
    expect(mockPrisma.glAccount.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: 'tenant-1',
          accountNumber: '2300',
          type: 'LIABILITY',
        }),
      }),
    );

    // Posted journal must use the freshly-created 2300 row id.
    const entries = mockPrisma.glEntry.createMany.mock.calls[0][0].data;
    const debit = entries.find((e: any) => e.debitCents > 0);
    const credit = entries.find((e: any) => e.creditCents > 0);
    expect(debit.accountId).toBe('acct-2300-auto'); // 2300 liability cleared
    expect(credit.accountId).toBe('acct-bank');     // refunded from 1010 bank
    expect(debit.debitCents).toBe(25000);
    expect(credit.creditCents).toBe(25000);
  });

  it('postSecurityDeposit auto-creates 2300 on first contract create', async () => {
    mockPrisma.location.findUnique.mockResolvedValue({
      id: 'loc-1',
      qboAccessToken: null,
      qboRealmId: null,
    });

    const accounts: any[] = [
      { id: 'acct-bank', tenantId: 'tenant-1', locationId: null, accountNumber: '1010' },
    ];
    mockPrisma.glAccount.findFirst.mockImplementation(async ({ where }: any) => {
      const m = accounts.find(
        (a) =>
          a.tenantId === where.tenantId &&
          (where.accountNumber === undefined || a.accountNumber === where.accountNumber) &&
          (!('locationId' in where) || where.locationId === a.locationId) &&
          where.subType === undefined &&
          where.isDeferredRevenue === undefined,
      );
      return m ? { id: m.id } : null;
    });
    mockPrisma.glAccount.findMany.mockResolvedValue([]);
    mockPrisma.glAccount.create = vi.fn().mockImplementation(async ({ data, select }: any) => {
      const row = { id: `acct-${data.accountNumber}-auto`, ...data, locationId: data.locationId ?? null };
      accounts.push(row);
      return select?.id ? { id: row.id } : row;
    });
    mockPrisma.glEntry.createMany.mockResolvedValue({ count: 2 });

    const journalId = await postSecurityDeposit({
      id: 'dep-1',
      tenantId: 'tenant-1',
      amountCents: 50000,
      locationId: 'loc-1',
    });

    expect(journalId).toBeDefined();
    expect(mockPrisma.glAccount.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ accountNumber: '2300' }),
      }),
    );
  });

  it('throws a typed UNCONFIGURED_GL_ACCOUNT (400) — never a bare 500 — when auto-heal cannot satisfy the lookup', async () => {
    mockPrisma.location.findUnique.mockResolvedValue({
      id: 'loc-1',
      qboAccessToken: null,
      qboRealmId: null,
    });

    // Chart has 1010 but is permanently missing 2300; auto-heal create
    // fails (e.g. DB unavailable) and the post-create re-read also returns
    // null. The caller MUST get a typed 400, not a generic Error 500.
    mockPrisma.glAccount.findFirst.mockImplementation(async ({ where }: any) => {
      if (where.accountNumber === '1010') return { id: 'acct-bank' };
      return null;
    });
    mockPrisma.glAccount.findMany.mockResolvedValue([]);
    mockPrisma.glAccount.create = vi.fn().mockRejectedValue(new Error('connection terminated'));

    await expect(
      releaseSecurityDeposit({
        id: 'dep-1',
        tenantId: 'tenant-1',
        amountCents: 1000,
        locationId: 'loc-1',
      }),
    ).rejects.toMatchObject({
      message: expect.stringContaining('UNCONFIGURED_GL_ACCOUNT'),
      statusCode: 400,
      code: 'UNCONFIGURED_GL_ACCOUNT',
    });
  });
});
