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

    // Confirm the where clause filters strictly by the requested location.
    // Task #340: tenant-wide (locationId IS NULL) products are NO LONGER
    // unioned in here — that used to leak legacy unassigned products into
    // every marina's inventory list.
    const findManyCall = mockPrisma.product.findMany.mock.calls[0][0];
    expect(findManyCall.where.locationId).toBe('loc-1');
    expect(JSON.stringify(findManyCall.where)).not.toContain('"locationId":null');

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

  it('does not leak products from other locations or tenant-wide products (Task #340)', async () => {
    // Regression: in single-location mode the route used to OR in
    // `locationId IS NULL` — which leaked every legacy tenant-wide
    // product into every marina, AND would happily return another
    // location's products if the underlying query had been built loosely.
    // We exercise the where-clause shape directly here so a future
    // refactor can't reintroduce the leak even if the mock returns rows.
    mockPrisma.product.findMany.mockImplementation(async ({ where }: any) => {
      // Simulate Prisma honoring the strict where: only loc-1 matches.
      const all = [
        buildProduct({ id: 'prod-loc-A', locationId: 'loc-1' }),
        buildProduct({ id: 'prod-loc-B', locationId: 'loc-2' }),
        buildProduct({ id: 'prod-tenant-wide', locationId: null }),
      ];
      return all.filter((p) => p.locationId === where.locationId);
    });
    mockPrisma.product.count.mockResolvedValue(1);
    mockPrisma.productCategoryGlMapping.findMany.mockResolvedValue([]);
    mockPrisma.location.findUnique.mockResolvedValue({
      qboAccessToken: null,
      qboRealmId: null,
    } as any);

    const res = await request(app).get('/api/inventory/products?locationId=loc-1');

    expect(res.status).toBe(200);
    const ids = res.body.data.map((p: any) => p.id);
    expect(ids).toEqual(['prod-loc-A']);
    expect(ids).not.toContain('prod-loc-B');
    expect(ids).not.toContain('prod-tenant-wide');

    const findManyCall = mockPrisma.product.findMany.mock.calls[0][0];
    expect(findManyCall.where.locationId).toBe('loc-1');
    // Defensive: no OR clause that smuggles in null-location rows.
    expect(JSON.stringify(findManyCall.where)).not.toContain('"locationId":null');
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

  // Regression for task #295: the create endpoint used to backfill
  // `category.defaultTaxCategory` into `Product.taxClass`, which then went
  // stale the moment the category was edited. The new contract: the
  // override column stays NULL when no explicit override is sent (or when
  // the legacy "Standard" / empty-string sentinels are sent), and the
  // resolver inherits from the category at read time.
  it.each([
    [undefined],
    [null],
    [''],
    ['  '],
    ['Standard'],
    ['standard'],
    ['  STANDARD  '],
  ])('persists Product.taxClass=null when the create payload sends %j (no real override)', async (taxClass) => {
    mockPrisma.productCategory.findFirst.mockResolvedValue({
      defaultTaxCategory: 'food',
      taxable: true,
    } as any);
    mockPrisma.product.create.mockImplementation(async ({ data }: any) => ({
      ...buildProduct(),
      ...data,
    }));
    // tryPushProductToQbo (called from POST /products) writes the QBO-sync
    // error back via product.update; without a mock it returns undefined and
    // shapeProduct crashes. The QBO push itself fails (no locationId on the
    // fixture) but the route still 201s with the persisted row.
    mockPrisma.product.update.mockImplementation(async ({ where, data }: any) => ({
      ...buildProduct({ id: where.id }),
      ...data,
    }));

    const res = await request(app)
      .post('/api/inventory/products')
      .send({
        sku: 'X-NULL',
        name: 'Bait',
        costCents: 100,
        priceCents: 200,
        productCategoryId: '00000000-0000-0000-0000-000000000001',
        ...(taxClass === undefined ? {} : { taxClass }),
      });

    expect(res.status).toBe(201);
    const createArgs = mockPrisma.product.create.mock.calls[0][0] as any;
    expect(createArgs.data.taxClass).toBeNull();
  });

  it('persists a real per-product override verbatim on create', async () => {
    mockPrisma.productCategory.findFirst.mockResolvedValue({
      defaultTaxCategory: 'food',
      taxable: true,
    } as any);
    mockPrisma.product.create.mockImplementation(async ({ data }: any) => ({
      ...buildProduct(),
      ...data,
    }));
    mockPrisma.product.update.mockImplementation(async ({ where, data }: any) => ({
      ...buildProduct({ id: where.id }),
      ...data,
    }));

    const res = await request(app)
      .post('/api/inventory/products')
      .send({
        sku: 'X-OV',
        name: 'Champagne',
        costCents: 100,
        priceCents: 200,
        productCategoryId: '00000000-0000-0000-0000-000000000001',
        taxClass: 'luxury',
      });

    expect(res.status).toBe(201);
    const createArgs = mockPrisma.product.create.mock.calls[0][0] as any;
    expect(createArgs.data.taxClass).toBe('luxury');
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

describe('PUT /api/inventory/products/:id', () => {
  it('rejects an update payload with no productCategoryId (mirrors POST behavior)', async () => {
    // After the collapse, productCategoryId is REQUIRED on update too —
    // not just on create. Leaving it optional would let callers silently
    // mutate other fields without re-affirming the category that drives
    // GL resolution. Schema validation must reject before any prisma write.
    const res = await request(app)
      .put('/api/inventory/products/prod-1')
      .send({
        name: 'Renamed Anchor',
        priceCents: 1500,
        // productCategoryId intentionally omitted
      });

    expect(res.status).toBe(400);
    expect(mockPrisma.product.update).not.toHaveBeenCalled();
  });
});

describe('POST /api/inventory/products/:id/qbo-sync — strict GL mapping', () => {
  // Manual QBO push must surface the canonical
  //   `MISSING_GL_MAPPING: Missing GL mapping for category "{name}" at location "{name}"`
  // wording when the per-(category, location) row is absent — otherwise the
  // UI's deep-link to Settings → Categories has nothing to anchor on and
  // operators get a generic "missing GL account" error from QBO sync.

  it('returns the canonical MISSING_GL_MAPPING wording with category + location names when no per-(category, location) row exists', async () => {
    const product = buildProduct({
      id: 'prod-strict-1',
      productCategoryId: 'cat-1',
      locationId: 'loc-1',
      trackInventory: true,
    });
    // Both the route's initial findFirst AND the strict resolver's product
    // lookup go through prisma.product.findFirst. We make the same row
    // satisfy both call sites (Prisma mocks don't enforce select scopes,
    // so we attach productCategory.name in case the strict resolver picks it up).
    mockPrisma.product.findFirst.mockResolvedValue({
      ...product,
      productCategory: { name: 'Engine Parts' },
    } as any);
    // Strict resolver fetches the location name via location.findFirst.
    mockPrisma.location.findFirst.mockResolvedValue({ name: 'Marina Alpha' } as any);
    // No per-(category, location) row → strict resolver throws.
    mockPrisma.productCategoryGlMapping.findFirst.mockResolvedValue(null as any);
    // Route catches the throw and persists the message into qboItemSyncError.
    mockPrisma.product.update.mockResolvedValue(product as any);

    const res = await request(app).post('/api/inventory/products/prod-strict-1/qbo-sync');

    // The route surfaces sync errors as 502 with `{ success: false, error }`.
    expect(res.status).toBe(502);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/^MISSING_GL_MAPPING: Missing GL mapping for category "Engine Parts" at location "Marina Alpha"/);
    // The persisted error column also carries the canonical wording so the
    // background retry sweep + UI banner share one source of truth.
    const update = mockPrisma.product.update.mock.calls[0][0];
    expect(update.data.qboItemSyncError).toMatch(/^MISSING_GL_MAPPING:/);
  });

  it('returns the canonical wording when the product has no locationId at all', async () => {
    // A tracked-inventory product with no locationId can't be QBO-synced
    // (per-location chart). The route still surfaces this in the canonical
    // form so the UI deep-link is consistent across all reasons.
    const product = buildProduct({
      id: 'prod-strict-noloc',
      name: 'Anchor Chain',
      productCategoryId: 'cat-1',
      locationId: null,
      trackInventory: true,
    });
    mockPrisma.product.findFirst.mockResolvedValue(product as any);
    mockPrisma.product.update.mockResolvedValue(product as any);

    const res = await request(app).post('/api/inventory/products/prod-strict-noloc/qbo-sync');

    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/^MISSING_GL_MAPPING: Product "Anchor Chain" has no locationId set/);
  });
});
