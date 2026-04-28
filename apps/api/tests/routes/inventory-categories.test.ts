import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { mockPrisma } from '../setup.js';

let app: any;

beforeEach(async () => {
  vi.clearAllMocks();
  const mod = await import('../../src/index.js');
  app = mod.default;
});

const buildCategory = (overrides: any = {}) => ({
  id: 'cat-1',
  tenantId: 'test-tenant-id',
  name: 'Provisions',
  defaultRevenueGlAccountId: 'gl-rev-1',
  defaultCogsGlAccountId: 'gl-cogs-1',
  defaultInventoryAssetGlAccountId: 'gl-inv-1',
  defaultTaxCategory: 'food',
  taxable: true,
  active: true,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

describe('GET /api/inventory/categories', () => {
  it('returns active categories by default', async () => {
    mockPrisma.productCategory.findMany.mockResolvedValue([buildCategory()]);
    const res = await request(app).get('/api/inventory/categories');
    expect(res.status).toBe(200);
    expect(res.body.categories).toHaveLength(1);
    expect(mockPrisma.productCategory.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { active: true } }),
    );
  });

  it('includes inactive when ?includeInactive=true', async () => {
    mockPrisma.productCategory.findMany.mockResolvedValue([
      buildCategory(),
      buildCategory({ id: 'cat-2', name: 'Old', active: false }),
    ]);
    const res = await request(app).get('/api/inventory/categories?includeInactive=true');
    expect(res.status).toBe(200);
    expect(res.body.categories).toHaveLength(2);
    expect(mockPrisma.productCategory.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: {} }),
    );
  });
});

describe('POST /api/inventory/categories', () => {
  it('creates a category with GL & tax defaults', async () => {
    const created = buildCategory({ id: 'cat-new' });
    mockPrisma.productCategory.create.mockResolvedValue(created);
    const res = await request(app)
      .post('/api/inventory/categories')
      .send({
        name: 'Provisions',
        defaultRevenueGlAccountId: '11111111-1111-1111-1111-111111111111',
        defaultCogsGlAccountId: '22222222-2222-2222-2222-222222222222',
        defaultInventoryAssetGlAccountId: '33333333-3333-3333-3333-333333333333',
        defaultTaxCategory: 'food',
        taxable: true,
      });
    expect(res.status).toBe(201);
    expect(res.body.id).toBe('cat-new');
    expect(mockPrisma.productCategory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: 'Provisions',
          defaultTaxCategory: 'food',
          taxable: true,
        }),
      }),
    );
  });

  it('rejects payload without a name', async () => {
    const res = await request(app)
      .post('/api/inventory/categories')
      .send({ taxable: true });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(mockPrisma.productCategory.create).not.toHaveBeenCalled();
  });
});

describe('PUT /api/inventory/categories/:id', () => {
  it('updates fields the caller supplied', async () => {
    mockPrisma.productCategory.findFirst.mockResolvedValue(buildCategory());
    mockPrisma.productCategory.update.mockResolvedValue(
      buildCategory({ defaultTaxCategory: 'fuel', taxable: false }),
    );
    const res = await request(app)
      .put('/api/inventory/categories/cat-1')
      .send({ defaultTaxCategory: 'fuel', taxable: false });
    expect(res.status).toBe(200);
    expect(res.body.defaultTaxCategory).toBe('fuel');
    expect(res.body.taxable).toBe(false);
    expect(mockPrisma.productCategory.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'cat-1' },
        data: expect.objectContaining({ defaultTaxCategory: 'fuel', taxable: false }),
      }),
    );
  });

  it('returns 404 when the category does not exist', async () => {
    mockPrisma.productCategory.findFirst.mockResolvedValue(null);
    const res = await request(app)
      .put('/api/inventory/categories/nope')
      .send({ name: 'X' });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/inventory/categories/:id', () => {
  it('soft-deletes by flipping active to false', async () => {
    mockPrisma.productCategory.findFirst.mockResolvedValue(buildCategory());
    mockPrisma.productCategory.update.mockResolvedValue(buildCategory({ active: false }));
    const res = await request(app).delete('/api/inventory/categories/cat-1');
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/deactivated/i);
    expect(mockPrisma.productCategory.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ active: false }) }),
    );
  });
});

describe('GET /api/inventory/gl-accounts', () => {
  it('filters by tenantId + single type', async () => {
    mockPrisma.glAccount.findMany.mockResolvedValue([
      { id: 'gl-rev-1', accountNumber: '4000', name: 'Sales', type: 'REVENUE', subType: null },
    ]);
    const res = await request(app).get('/api/inventory/gl-accounts?type=REVENUE');
    expect(res.status).toBe(200);
    expect(res.body.accounts).toHaveLength(1);
    expect(mockPrisma.glAccount.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: expect.any(String),
          active: true,
          type: { in: ['REVENUE'] },
        }),
      }),
    );
  });

  it('supports comma-separated type filter and stays tenant-scoped', async () => {
    mockPrisma.glAccount.findMany.mockResolvedValue([]);
    await request(app).get('/api/inventory/gl-accounts?type=EXPENSE,COGS');
    expect(mockPrisma.glAccount.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: expect.any(String),
          type: { in: ['EXPENSE', 'COGS'] },
        }),
      }),
    );
  });
});

describe('GET /api/inventory/tax-categories', () => {
  it('always includes "general" plus tenant-scoped TaxRate categories', async () => {
    mockPrisma.taxRate.findMany.mockResolvedValue([
      { category: 'food' },
      { category: 'fuel' },
    ]);
    const res = await request(app).get('/api/inventory/tax-categories');
    expect(res.status).toBe(200);
    expect(res.body.categories).toEqual(expect.arrayContaining(['general', 'food', 'fuel']));
    expect(mockPrisma.taxRate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: expect.any(String) }),
      }),
    );
  });
});
