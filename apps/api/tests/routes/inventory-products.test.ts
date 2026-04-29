import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { mockPrisma } from '../setup.js';

let app: any;

beforeEach(async () => {
  vi.clearAllMocks();
  const mod = await import('../../src/index.js');
  app = mod.default;
});

// Product fixture for the post-collapse schema. After
// 20260429080000_inventory_category_only_gl, products no longer carry
// per-product GL FKs — those columns and the ProductGlMapping table were
// dropped. productCategoryId is now NOT NULL.
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
  beforeEach(() => {
    // Default: any locationId the route validates is owned by the test
    // tenant. Individual tests override this to exercise the 404 path.
    mockPrisma.location.findFirst.mockResolvedValue({ id: 'loc-1' } as any);
  });

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
    // No per-(category, location) resolution should run when locationId is omitted.
    expect(mockPrisma.productCategoryGlMapping.findMany).not.toHaveBeenCalled();
  });

  it('attaches effective GL fields from the per-(category, location) mapping', async () => {
    mockPrisma.product.findMany.mockResolvedValue([buildProduct()]);
    mockPrisma.product.count.mockResolvedValue(1);

    // Single resolution rung now: category-per-location mapping. There is
    // no per-product override anymore (table dropped), and no tenant-wide
    // category default (columns dropped).
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
    expect(res.body.data[0].effectiveRevenueGlAccountId).toBe('gl-rev-cat');
    expect(res.body.data[0].effectiveCogsGlAccountId).toBe('gl-cogs-cat');
    expect(res.body.data[0].effectiveInventoryAssetGlAccountId).toBe('gl-inv-cat');

    // Confirm the where clause includes the location-OR-null filter.
    const findManyCall = mockPrisma.product.findMany.mock.calls[0][0];
    expect(JSON.stringify(findManyCall.where)).toContain('"locationId":"loc-1"');
    expect(JSON.stringify(findManyCall.where)).toContain('"locationId":null');

    // Confirm the per-location category resolver scoped its lookup correctly.
    expect(mockPrisma.productCategoryGlMapping.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: 'test-tenant-id',
          locationId: 'loc-1',
          productCategoryId: { in: ['cat-1'] },
        }),
      }),
    );
  });

  it('returns null effective fields when the category has no per-location mapping', async () => {
    // Product belongs to a category that hasn't been mapped at this
    // location. The collapsed resolver has no fallback — surfacing null
    // here is what drives the "Unconfigured GL" warning banners.
    mockPrisma.product.findMany.mockResolvedValue([buildProduct()]);
    mockPrisma.product.count.mockResolvedValue(1);
    mockPrisma.productCategoryGlMapping.findMany.mockResolvedValue([]);
    mockPrisma.location.findUnique.mockResolvedValue({
      qboAccessToken: null,
      qboRealmId: null,
    } as any);

    const res = await request(app).get('/api/inventory/products?locationId=loc-1');

    expect(res.status).toBe(200);
    expect(res.body.data[0].effectiveRevenueGlAccountId).toBeNull();
    expect(res.body.data[0].effectiveCogsGlAccountId).toBeNull();
    expect(res.body.data[0].effectiveInventoryAssetGlAccountId).toBeNull();
  });

  it('returns 404 when locationId belongs to another tenant', async () => {
    // Override the default findFirst mock so the tenant-scoped lookup
    // returns no row — simulating a foreign locationId. The route must
    // refuse before any product/effective-GL queries fire.
    mockPrisma.location.findFirst.mockResolvedValue(null as any);

    const res = await request(app).get('/api/inventory/products?locationId=loc-other-tenant');

    expect(res.status).toBe(404);
    expect(mockPrisma.product.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.productCategoryGlMapping.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.location.findUnique).not.toHaveBeenCalled();
  });
});

describe('POST /api/inventory/products', () => {
  it('rejects a create with no productCategoryId (schema validation)', async () => {
    // After the collapse, productCategoryId is required at the Zod layer
    // so the route never even reaches a category lookup — and definitely
    // never creates a row.
    const res = await request(app)
      .post('/api/inventory/products')
      .send({
        sku: 'X1',
        name: 'Anchor',
        costCents: 100,
        priceCents: 200,
        // productCategoryId intentionally omitted
      });

    expect(res.status).toBe(400);
    expect(mockPrisma.product.create).not.toHaveBeenCalled();
  });

  it('rejects a create when the supplied productCategoryId is foreign to the tenant', async () => {
    // findFirst returns null → "category not found for this tenant" → 400.
    mockPrisma.productCategory.findFirst.mockResolvedValue(null as any);

    const res = await request(app)
      .post('/api/inventory/products')
      .send({
        sku: 'X2',
        name: 'Cleat',
        costCents: 100,
        priceCents: 200,
        productCategoryId: '00000000-0000-0000-0000-000000000000',
      });

    expect(res.status).toBe(400);
    expect(mockPrisma.product.create).not.toHaveBeenCalled();
  });
});
