import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { mockPrisma } from '../setup.js';

let app: any;

beforeEach(async () => {
  vi.clearAllMocks();
  const mod = await import('../../src/index.js');
  app = mod.default;
});

const buildProduct = (overrides: any = {}) => ({
  id: 'prod-1',
  tenantId: 'test-tenant-id',
  name: 'Bilge Cleaner',
  sku: 'BC-001',
  barcode: '0001',
  category: '',
  productCategoryId: 'cat-1',
  costCents: 500,
  priceCents: 999,
  taxClass: 'standard',
  reorderPoint: 5,
  trackInventory: true,
  qoh: 25,
  cogsGlAccountId: null,
  revenueGlAccountId: null,
  inventoryAssetGlAccountId: null,
  locationId: null,
  qboItemId: null,
  qboItemSyncedAt: null,
  qboItemSyncError: null,
  qboItemSyncErrorAt: null,
  active: true,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  ...overrides,
});

describe('GET /api/inventory/products', () => {
  it('returns products without effective GL fields when no locationId', async () => {
    mockPrisma.product.findMany.mockResolvedValue([buildProduct()]);
    mockPrisma.product.count.mockResolvedValue(1);

    const res = await request(app).get('/api/inventory/products');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].id).toBe('prod-1');
    // Effective fields are only attached in single-location mode.
    expect(res.body.data[0].effectiveRevenueGlAccountId).toBeUndefined();
    expect(res.body.data[0].effectiveCogsGlAccountId).toBeUndefined();
    expect(res.body.data[0].effectiveInventoryAssetGlAccountId).toBeUndefined();
    // No per-location resolution should run when locationId is omitted.
    expect(mockPrisma.productGlMapping.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.productCategoryGlMapping.findMany).not.toHaveBeenCalled();
  });

  it('filters by locationId (OR location/null) and attaches effective GL fields', async () => {
    mockPrisma.product.findMany.mockResolvedValue([buildProduct()]);
    mockPrisma.product.count.mockResolvedValue(1);

    // Per-location product override wins over the category default.
    mockPrisma.productGlMapping.findMany.mockResolvedValue([
      {
        productId: 'prod-1',
        revenueGlAccountId: 'gl-rev-loc',
        cogsGlAccountId: null,
        inventoryAssetGlAccountId: null,
      },
    ]);
    mockPrisma.productCategoryGlMapping.findMany.mockResolvedValue([
      {
        productCategoryId: 'cat-1',
        revenueGlAccountId: 'gl-rev-cat',
        cogsGlAccountId: 'gl-cogs-cat',
        inventoryAssetGlAccountId: 'gl-inv-cat',
      },
    ]);
    mockPrisma.location.findUnique.mockResolvedValue({
      qboAccessToken: null,
      qboRealmId: null,
    } as any);

    const res = await request(app).get('/api/inventory/products?locationId=loc-1');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].effectiveRevenueGlAccountId).toBe('gl-rev-loc');
    // Falls back to category mapping when no per-product override.
    expect(res.body.data[0].effectiveCogsGlAccountId).toBe('gl-cogs-cat');
    expect(res.body.data[0].effectiveInventoryAssetGlAccountId).toBe('gl-inv-cat');

    // Confirm the where clause includes the location-OR-null filter.
    const findManyCall = mockPrisma.product.findMany.mock.calls[0][0];
    expect(JSON.stringify(findManyCall.where)).toContain('"locationId":"loc-1"');
    expect(JSON.stringify(findManyCall.where)).toContain('"locationId":null');

    // Confirm the per-location resolver scoped its lookups correctly.
    expect(mockPrisma.productGlMapping.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: 'test-tenant-id',
          locationId: 'loc-1',
          productId: { in: ['prod-1'] },
        }),
      }),
    );
  });

  it('falls back to legacy productCategory.default* when no overrides exist (non-QBO location)', async () => {
    // No per-product or per-category mappings; product has no legacy FKs;
    // category has tenant-wide defaults. The route must surface those
    // category defaults as the effective fields, matching the per-product
    // resolver's chain.
    const p = buildProduct({
      productCategoryId: 'cat-1',
      revenueGlAccountId: null,
      cogsGlAccountId: null,
      inventoryAssetGlAccountId: null,
    });
    mockPrisma.product.findMany.mockResolvedValue([p]);
    mockPrisma.product.count.mockResolvedValue(1);
    mockPrisma.productGlMapping.findMany.mockResolvedValue([]);
    mockPrisma.productCategoryGlMapping.findMany.mockResolvedValue([]);
    mockPrisma.productCategory.findMany.mockResolvedValue([
      {
        id: 'cat-1',
        defaultRevenueGlAccountId: 'gl-rev-default',
        defaultCogsGlAccountId: 'gl-cogs-default',
        defaultInventoryAssetGlAccountId: 'gl-inv-default',
      },
    ] as any);
    mockPrisma.location.findUnique.mockResolvedValue({
      qboAccessToken: null,
      qboRealmId: null,
    } as any);

    const res = await request(app).get('/api/inventory/products?locationId=loc-1');

    expect(res.status).toBe(200);
    expect(res.body.data[0].effectiveRevenueGlAccountId).toBe('gl-rev-default');
    expect(res.body.data[0].effectiveCogsGlAccountId).toBe('gl-cogs-default');
    expect(res.body.data[0].effectiveInventoryAssetGlAccountId).toBe('gl-inv-default');
  });

  it('suppresses legacy tenant-wide FKs when the location is QBO-connected', async () => {
    // Product has legacy tenant-wide GL FKs but no per-location override,
    // and the location is connected to QBO. Those legacy FKs likely point at
    // a different realm's chart, so they must NOT leak through as the
    // effective accounts.
    const p = buildProduct({
      productCategoryId: null,
      revenueGlAccountId: 'gl-legacy-rev',
      cogsGlAccountId: 'gl-legacy-cogs',
      inventoryAssetGlAccountId: 'gl-legacy-inv',
    });
    mockPrisma.product.findMany.mockResolvedValue([p]);
    mockPrisma.product.count.mockResolvedValue(1);
    mockPrisma.productGlMapping.findMany.mockResolvedValue([]);
    mockPrisma.location.findUnique.mockResolvedValue({
      qboAccessToken: 'tok',
      qboRealmId: 'realm-1',
    } as any);

    const res = await request(app).get('/api/inventory/products?locationId=loc-1');

    expect(res.status).toBe(200);
    expect(res.body.data[0].effectiveRevenueGlAccountId).toBeNull();
    expect(res.body.data[0].effectiveCogsGlAccountId).toBeNull();
    expect(res.body.data[0].effectiveInventoryAssetGlAccountId).toBeNull();
  });

  it('also suppresses legacy productCategory.default* on QBO-connected locations', async () => {
    // QBO-connected location, no overrides, only legacy category defaults
    // exist. They must NOT bleed through — they likely reference a different
    // realm's chart, same gating as the legacy product FKs.
    const p = buildProduct({
      productCategoryId: 'cat-1',
      revenueGlAccountId: null,
      cogsGlAccountId: null,
      inventoryAssetGlAccountId: null,
    });
    mockPrisma.product.findMany.mockResolvedValue([p]);
    mockPrisma.product.count.mockResolvedValue(1);
    mockPrisma.productGlMapping.findMany.mockResolvedValue([]);
    mockPrisma.productCategoryGlMapping.findMany.mockResolvedValue([]);
    mockPrisma.productCategory.findMany.mockResolvedValue([
      {
        id: 'cat-1',
        defaultRevenueGlAccountId: 'gl-rev-default',
        defaultCogsGlAccountId: 'gl-cogs-default',
        defaultInventoryAssetGlAccountId: 'gl-inv-default',
      },
    ] as any);
    mockPrisma.location.findUnique.mockResolvedValue({
      qboAccessToken: 'tok',
      qboRealmId: 'realm-1',
    } as any);

    const res = await request(app).get('/api/inventory/products?locationId=loc-1');

    expect(res.status).toBe(200);
    expect(res.body.data[0].effectiveRevenueGlAccountId).toBeNull();
    expect(res.body.data[0].effectiveCogsGlAccountId).toBeNull();
    expect(res.body.data[0].effectiveInventoryAssetGlAccountId).toBeNull();
  });
});
