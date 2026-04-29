import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockPrisma } from '../setup.js';

const fetchMock = vi.fn();
(globalThis as any).fetch = fetchMock;

let pullChartOfAccountsForLocation: typeof import('../../src/services/qbo-sync.js').pullChartOfAccountsForLocation;

beforeEach(async () => {
  vi.clearAllMocks();
  fetchMock.mockReset();

  const mod = await import('../../src/services/qbo-sync.js');
  pullChartOfAccountsForLocation = mod.pullChartOfAccountsForLocation;

  (mockPrisma as any).glAccount = {
    findFirst: vi.fn().mockResolvedValue(null),
    findMany: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue({}),
    update: vi.fn().mockResolvedValue({}),
    updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    count: vi.fn().mockResolvedValue(0),
  };
  (mockPrisma as any).location = {
    ...(mockPrisma as any).location,
    findFirst: vi.fn().mockResolvedValue({
      id: 'loc-1',
      qboAccessToken: 'access',
      qboRealmId: 'realm-1',
      qboTokenExpiresAt: new Date(Date.now() + 3600_000),
      qboRefreshToken: 'refresh',
    }),
    findUnique: vi.fn().mockResolvedValue({
      id: 'loc-1',
      qboAccessToken: 'access',
      qboRefreshToken: 'refresh',
      qboRealmId: 'realm-1',
      qboTokenExpiresAt: new Date(Date.now() + 3600_000),
    }),
    update: vi.fn().mockResolvedValue({}),
  };
});

function mockAccountsResponse(accounts: any[]) {
  fetchMock.mockResolvedValueOnce({
    ok: true,
    status: 200,
    headers: { get: () => 'application/json' },
    text: async () =>
      JSON.stringify({
        QueryResponse: { Account: accounts },
      }),
    json: async () => ({
      QueryResponse: { Account: accounts },
    }),
  } as any);
}

describe('pullChartOfAccountsForLocation', () => {
  it('upserts new QBO accounts and marks missing ones inactive', async () => {
    mockAccountsResponse([
      {
        Id: '1',
        Name: 'Slip Revenue',
        AcctNum: '4100',
        AccountType: 'Income',
        AccountSubType: 'ServiceFeeIncome',
        Active: true,
      },
      {
        Id: '2',
        Name: 'AR',
        AcctNum: '1200',
        AccountType: 'Accounts Receivable',
        Active: true,
      },
    ]);

    // No existing rows for either Id, so both are created.
    (mockPrisma as any).glAccount.findFirst.mockResolvedValue(null);

    // One stale QBO row should be marked inactive.
    (mockPrisma as any).glAccount.findMany.mockResolvedValueOnce([
      { id: 'stale-1' },
    ]);
    (mockPrisma as any).glAccount.count.mockResolvedValue(2);

    const result = await pullChartOfAccountsForLocation('loc-1', 'tenant-1');

    expect(result.pulled).toBe(2);
    expect(result.created).toBe(2);
    expect(result.updated).toBe(0);
    expect(result.deactivated).toBe(1);

    expect((mockPrisma as any).glAccount.create).toHaveBeenCalledTimes(2);
    expect((mockPrisma as any).glAccount.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['stale-1'] } },
        data: expect.objectContaining({ isActive: false }),
      }),
    );
    expect((mockPrisma as any).location.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'loc-1' },
        data: expect.objectContaining({
          qboLastChartOfAccountsSyncAt: expect.any(Date),
        }),
      }),
    );
  });

  it('updates existing QBO row by qboAccountId', async () => {
    mockAccountsResponse([
      {
        Id: '7',
        Name: 'Updated Name',
        AcctNum: '4500',
        AccountType: 'Income',
        Active: true,
      },
    ]);

    (mockPrisma as any).glAccount.findFirst.mockResolvedValueOnce({ id: 'gl-existing' });
    (mockPrisma as any).glAccount.count.mockResolvedValue(1);

    const result = await pullChartOfAccountsForLocation('loc-1', 'tenant-1');

    expect(result.created).toBe(0);
    expect(result.updated).toBe(1);
    expect((mockPrisma as any).glAccount.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'gl-existing' },
        data: expect.objectContaining({
          name: 'Updated Name',
          qboAccountId: '7',
          source: 'QBO',
        }),
      }),
    );
  });

  it('throws when location is not connected to QBO', async () => {
    (mockPrisma as any).location.findFirst.mockResolvedValueOnce({
      id: 'loc-1',
      qboAccessToken: null,
      qboRealmId: null,
    });

    await expect(
      pullChartOfAccountsForLocation('loc-1', 'tenant-1'),
    ).rejects.toThrow(/not connected/i);
  });
});
