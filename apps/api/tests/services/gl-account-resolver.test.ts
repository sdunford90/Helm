import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockPrisma } from '../setup.js';

let resolveProductGlAccounts: typeof import('../../src/services/gl-account-resolver.js').resolveProductGlAccounts;
let resolveDockageRateGlAccount: typeof import('../../src/services/gl-account-resolver.js').resolveDockageRateGlAccount;
let getMissingGlAccountWarnings: typeof import('../../src/services/gl-account-resolver.js').getMissingGlAccountWarnings;

beforeEach(async () => {
  vi.clearAllMocks();
  const mod = await import('../../src/services/gl-account-resolver.js');
  resolveProductGlAccounts = mod.resolveProductGlAccounts;
  resolveDockageRateGlAccount = mod.resolveDockageRateGlAccount;
  getMissingGlAccountWarnings = mod.getMissingGlAccountWarnings;

  // Default: location has NO QBO connection — so legacy FKs are honored.
  (mockPrisma as any).location.findUnique = vi.fn().mockResolvedValue({
    id: 'loc-1',
    qboAccessToken: null,
    qboRealmId: null,
  });

  (mockPrisma as any).productGlMapping = {
    findFirst: vi.fn().mockResolvedValue(null),
    findMany: vi.fn().mockResolvedValue([]),
  };
  (mockPrisma as any).productCategoryGlMapping = {
    findFirst: vi.fn().mockResolvedValue(null),
    findMany: vi.fn().mockResolvedValue([]),
  };
  (mockPrisma as any).dockageRateGlMapping = {
    findFirst: vi.fn().mockResolvedValue(null),
    findMany: vi.fn().mockResolvedValue([]),
  };
  (mockPrisma as any).serviceFeeGlMapping = {
    findFirst: vi.fn().mockResolvedValue(null),
    findMany: vi.fn().mockResolvedValue([]),
  };
  (mockPrisma as any).dockageRate = {
    findFirst: vi.fn().mockResolvedValue(null),
    findMany: vi.fn().mockResolvedValue([]),
  };
  (mockPrisma as any).serviceFee = {
    findFirst: vi.fn().mockResolvedValue(null),
    findMany: vi.fn().mockResolvedValue([]),
  };
  (mockPrisma as any).rentalProduct = {
    findFirst: vi.fn().mockResolvedValue(null),
    findMany: vi.fn().mockResolvedValue([]),
  };
  (mockPrisma as any).rentalProductGlMapping = {
    findFirst: vi.fn().mockResolvedValue(null),
    findMany: vi.fn().mockResolvedValue([]),
  };
});

describe('resolveProductGlAccounts', () => {
  it('returns per-location override when present', async () => {
    (mockPrisma as any).product = {
      findFirst: vi.fn().mockResolvedValue({
        id: 'p-1',
        productCategoryId: 'cat-1',
        revenueGlAccountId: 'gl-legacy',
        cogsGlAccountId: null,
        inventoryAssetGlAccountId: null,
        productCategory: {
          id: 'cat-1',
          defaultRevenueGlAccountId: 'gl-cat-default',
          defaultCogsGlAccountId: null,
          defaultInventoryAssetGlAccountId: null,
        },
      }),
      findMany: vi.fn().mockResolvedValue([]),
    };
    (mockPrisma as any).productGlMapping.findFirst.mockResolvedValueOnce({
      revenueGlAccountId: 'gl-override',
      cogsGlAccountId: null,
      inventoryAssetGlAccountId: null,
    });

    const r = await resolveProductGlAccounts('tenant-1', 'p-1', 'loc-1');

    expect(r.revenueGlAccountId).toBe('gl-override');
    expect(r.source).toBe('product_override');
  });

  it('falls back to category per-location default', async () => {
    (mockPrisma as any).product = {
      findFirst: vi.fn().mockResolvedValue({
        id: 'p-1',
        productCategoryId: 'cat-1',
        revenueGlAccountId: null,
        cogsGlAccountId: null,
        inventoryAssetGlAccountId: null,
        productCategory: {
          id: 'cat-1',
          defaultRevenueGlAccountId: null,
          defaultCogsGlAccountId: null,
          defaultInventoryAssetGlAccountId: null,
        },
      }),
      findMany: vi.fn().mockResolvedValue([]),
    };
    (mockPrisma as any).productGlMapping.findFirst.mockResolvedValueOnce(null);
    (mockPrisma as any).productCategoryGlMapping.findFirst.mockResolvedValueOnce({
      revenueGlAccountId: 'gl-cat-loc',
      cogsGlAccountId: null,
      inventoryAssetGlAccountId: null,
    });

    const r = await resolveProductGlAccounts('tenant-1', 'p-1', 'loc-1');
    expect(r.revenueGlAccountId).toBe('gl-cat-loc');
    expect(r.source).toBe('category_default');
  });

  it('skips legacy product FK when the location is QBO-connected', async () => {
    (mockPrisma as any).location.findUnique = vi.fn().mockResolvedValue({
      id: 'loc-1',
      qboAccessToken: 'tok',
      qboRealmId: 'realm-1',
    });
    (mockPrisma as any).product = {
      findFirst: vi.fn().mockResolvedValue({
        id: 'p-1',
        productCategoryId: 'cat-1',
        revenueGlAccountId: 'gl-legacy',
        cogsGlAccountId: 'gl-legacy-cogs',
        inventoryAssetGlAccountId: null,
        productCategory: {
          id: 'cat-1',
          defaultRevenueGlAccountId: null,
          defaultCogsGlAccountId: null,
          defaultInventoryAssetGlAccountId: null,
        },
      }),
      findMany: vi.fn().mockResolvedValue([]),
    };

    const r = await resolveProductGlAccounts('tenant-1', 'p-1', 'loc-1');
    expect(r.revenueGlAccountId).toBe(null);
    expect(r.cogsGlAccountId).toBe(null);
    expect(r.source).toBe('unmapped');
  });

  it('falls back to legacy product FK when no per-location mapping (non-QBO location)', async () => {
    (mockPrisma as any).product = {
      findFirst: vi.fn().mockResolvedValue({
        id: 'p-1',
        productCategoryId: 'cat-1',
        revenueGlAccountId: 'gl-legacy',
        cogsGlAccountId: null,
        inventoryAssetGlAccountId: null,
        productCategory: {
          id: 'cat-1',
          defaultRevenueGlAccountId: null,
          defaultCogsGlAccountId: null,
          defaultInventoryAssetGlAccountId: null,
        },
      }),
      findMany: vi.fn().mockResolvedValue([]),
    };

    const r = await resolveProductGlAccounts('tenant-1', 'p-1', 'loc-1');
    expect(r.revenueGlAccountId).toBe('gl-legacy');
    expect(r.source).toBe('legacy_product_fk');
  });
});

describe('resolveDockageRateGlAccount', () => {
  it('prefers per-location mapping over legacy FK', async () => {
    (mockPrisma as any).dockageRateGlMapping.findFirst.mockResolvedValueOnce({
      glAccountId: 'gl-loc',
    });
    (mockPrisma as any).dockageRate.findFirst.mockResolvedValueOnce({
      glAccountId: 'gl-legacy',
    });
    const r = await resolveDockageRateGlAccount('tenant-1', 'rate-1', 'loc-1');
    expect(r).toBe('gl-loc');
  });

  it('falls back to legacy FK', async () => {
    (mockPrisma as any).dockageRateGlMapping.findFirst.mockResolvedValueOnce(null);
    (mockPrisma as any).dockageRate.findFirst.mockResolvedValueOnce({
      glAccountId: 'gl-legacy',
    });
    const r = await resolveDockageRateGlAccount('tenant-1', 'rate-1', 'loc-1');
    expect(r).toBe('gl-legacy');
  });
});

describe('getMissingGlAccountWarnings', () => {
  it('returns empty array when no QBO-connected locations', async () => {
    (mockPrisma as any).location.findMany = vi.fn().mockResolvedValue([]);
    const r = await getMissingGlAccountWarnings('tenant-1');
    expect(r).toEqual([]);
  });

  it('does NOT flag a product when its category has a per-location mapping', async () => {
    (mockPrisma as any).location.findMany = vi.fn().mockResolvedValue([
      { id: 'loc-1', name: 'Marina A' },
    ]);
    (mockPrisma as any).product = {
      findFirst: vi.fn(),
      findMany: vi.fn().mockResolvedValue([
        {
          id: 'p-1',
          name: 'Bait',
          trackInventory: false,
          productCategoryId: 'cat-1',
        },
      ]),
    };
    (mockPrisma as any).productGlMapping.findMany.mockResolvedValueOnce([]);
    (mockPrisma as any).productCategoryGlMapping.findMany.mockResolvedValue([
      {
        productCategoryId: 'cat-1',
        revenueGlAccountId: 'gl-cat-rev',
        cogsGlAccountId: null,
        inventoryAssetGlAccountId: null,
      },
    ]);
    (mockPrisma as any).productCategory = {
      findMany: vi.fn().mockResolvedValue([{ id: 'cat-1', name: 'Bait & Tackle' }]),
    };
    (mockPrisma as any).dockageRate.findMany.mockResolvedValueOnce([]);
    (mockPrisma as any).serviceFee.findMany.mockResolvedValueOnce([]);

    const r = await getMissingGlAccountWarnings('tenant-1');
    expect(r).toHaveLength(1);
    const productItems = r[0].items.filter((i) => i.kind === 'product');
    expect(productItems).toHaveLength(0);
  });

  it('flags products and dockage with missing per-location mappings', async () => {
    (mockPrisma as any).location.findMany = vi.fn().mockResolvedValue([
      { id: 'loc-1', name: 'Marina A' },
    ]);
    (mockPrisma as any).product = {
      findFirst: vi.fn(),
      findMany: vi.fn().mockResolvedValue([
        {
          id: 'p-1',
          name: 'Bait',
          trackInventory: true,
          revenueGlAccountId: null,
          cogsGlAccountId: null,
          inventoryAssetGlAccountId: null,
          productCategoryId: null,
          productCategory: null,
        },
      ]),
    };
    (mockPrisma as any).productCategory = {
      findMany: vi.fn().mockResolvedValue([]),
    };
    (mockPrisma as any).dockageRate.findMany.mockResolvedValueOnce([
      { id: 'r-1', slipType: '30ft' },
    ]);
    (mockPrisma as any).serviceFee.findMany.mockResolvedValueOnce([]);

    const r = await getMissingGlAccountWarnings('tenant-1');
    expect(r).toHaveLength(1);
    expect(r[0].locationName).toBe('Marina A');
    const kinds = r[0].items.map((i) => i.kind).sort();
    expect(kinds).toEqual(['dockage_rate', 'product']);
    const product = r[0].items.find((i) => i.kind === 'product')!;
    expect(product.missing).toEqual(
      expect.arrayContaining(['revenue', 'cogs', 'inventoryAsset']),
    );
  });
});
