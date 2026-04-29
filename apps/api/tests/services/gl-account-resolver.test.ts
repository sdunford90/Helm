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

  // Defaults: every per-location mapping table returns nothing. Each test
  // overrides the relevant ones. The legacy productGlMapping table was
  // dropped by 20260429080000_inventory_category_only_gl, so it's not
  // mocked here anymore.
  (mockPrisma as any).location.findUnique = vi.fn().mockResolvedValue({
    id: 'loc-1',
    qboAccessToken: null,
    qboRealmId: null,
  });
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

describe('resolveProductGlAccounts (collapsed, single-rung)', () => {
  it('returns the per-(category, location) mapping with source=category_default', async () => {
    (mockPrisma as any).product = {
      findFirst: vi.fn().mockResolvedValue({
        id: 'p-1',
        productCategoryId: 'cat-1',
      }),
      findMany: vi.fn().mockResolvedValue([]),
    };
    (mockPrisma as any).productCategoryGlMapping.findFirst.mockResolvedValueOnce({
      revenueGlAccountId: 'gl-cat-loc',
      cogsGlAccountId: 'gl-cogs-loc',
      inventoryAssetGlAccountId: 'gl-inv-loc',
    });

    const r = await resolveProductGlAccounts('tenant-1', 'p-1', 'loc-1');

    expect(r.revenueGlAccountId).toBe('gl-cat-loc');
    expect(r.cogsGlAccountId).toBe('gl-cogs-loc');
    expect(r.inventoryAssetGlAccountId).toBe('gl-inv-loc');
    expect(r.source).toBe('category_default');
    // Only one query into the category mapping table — no fallback rung
    // exists anymore.
    expect(
      (mockPrisma as any).productCategoryGlMapping.findFirst,
    ).toHaveBeenCalledTimes(1);
  });

  it('returns nulls with source=unmapped when the category has no mapping at this location', async () => {
    (mockPrisma as any).product = {
      findFirst: vi.fn().mockResolvedValue({
        id: 'p-1',
        productCategoryId: 'cat-1',
      }),
      findMany: vi.fn().mockResolvedValue([]),
    };
    (mockPrisma as any).productCategoryGlMapping.findFirst.mockResolvedValueOnce(null);

    const r = await resolveProductGlAccounts('tenant-1', 'p-1', 'loc-1');

    expect(r.revenueGlAccountId).toBe(null);
    expect(r.cogsGlAccountId).toBe(null);
    expect(r.inventoryAssetGlAccountId).toBe(null);
    expect(r.source).toBe('unmapped');
  });

  it('returns unmapped when the product is not found', async () => {
    (mockPrisma as any).product = {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
    };

    const r = await resolveProductGlAccounts('tenant-1', 'p-missing', 'loc-1');

    expect(r.source).toBe('unmapped');
    expect(r.revenueGlAccountId).toBe(null);
    // No category lookup attempted when the product itself is missing.
    expect(
      (mockPrisma as any).productCategoryGlMapping.findFirst,
    ).not.toHaveBeenCalled();
  });

  it('returns unmapped when no locationId is provided (resolution requires a location)', async () => {
    (mockPrisma as any).product = {
      findFirst: vi.fn().mockResolvedValue({
        id: 'p-1',
        productCategoryId: 'cat-1',
      }),
      findMany: vi.fn().mockResolvedValue([]),
    };

    const r = await resolveProductGlAccounts('tenant-1', 'p-1', null);

    expect(r.source).toBe('unmapped');
    expect(
      (mockPrisma as any).productCategoryGlMapping.findFirst,
    ).not.toHaveBeenCalled();
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
          productCategoryId: 'cat-uncategorized',
        },
      ]),
    };
    // No category mapping at this location → missing all 3 slots for an
    // inventory-tracked product.
    (mockPrisma as any).productCategoryGlMapping.findMany.mockResolvedValue([]);
    (mockPrisma as any).productCategory = {
      findMany: vi.fn().mockResolvedValue([
        { id: 'cat-uncategorized', name: 'Uncategorized' },
      ]),
    };
    (mockPrisma as any).dockageRate.findMany.mockResolvedValueOnce([
      { id: 'r-1', slipType: '30ft' },
    ]);
    (mockPrisma as any).serviceFee.findMany.mockResolvedValueOnce([]);

    const r = await getMissingGlAccountWarnings('tenant-1');
    expect(r).toHaveLength(1);
    expect(r[0].locationName).toBe('Marina A');
    const kinds = r[0].items.map((i) => i.kind).sort();
    // Product missing all 3 slots; category missing revenue; dockage missing 1.
    expect(kinds).toEqual(['category', 'dockage_rate', 'product']);
    const product = r[0].items.find((i) => i.kind === 'product')!;
    expect(product.missing).toEqual(
      expect.arrayContaining(['revenue', 'cogs', 'inventoryAsset']),
    );
  });
});
