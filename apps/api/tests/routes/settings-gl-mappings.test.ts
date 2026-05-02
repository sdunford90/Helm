import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { mockPrisma } from '../setup.js';

let app: any;

beforeEach(async () => {
  vi.clearAllMocks();
  const mod = await import('../../src/index.js');
  app = mod.default;

  (mockPrisma as any).dockageRate = {
    findFirst: vi.fn(),
    findMany: vi.fn().mockResolvedValue([]),
  };
  (mockPrisma as any).serviceFee = {
    findFirst: vi.fn(),
    findMany: vi.fn().mockResolvedValue([]),
  };
  (mockPrisma as any).glAccount = {
    ...(mockPrisma as any).glAccount,
    findFirst: vi.fn(),
  };
  // The legacy productGlMapping table + per-product PUT endpoint were
  // dropped in 20260429080000_inventory_category_only_gl. All inventory
  // GL editing now flows through the per-(category, location) mapping
  // below.
  (mockPrisma as any).productCategoryGlMapping = {
    findMany: vi.fn().mockResolvedValue([]),
    upsert: vi.fn().mockResolvedValue({ id: 'pcm-1' }),
  };
  (mockPrisma as any).dockageRateGlMapping = {
    findMany: vi.fn().mockResolvedValue([]),
    findUnique: vi.fn().mockResolvedValue(null),
    upsert: vi.fn().mockResolvedValue({ id: 'drm-1', glAccountId: null }),
  };
  (mockPrisma as any).serviceFeeGlMapping = {
    findMany: vi.fn().mockResolvedValue([]),
    findUnique: vi.fn().mockResolvedValue(null),
    upsert: vi.fn().mockResolvedValue({ id: 'sfm-1', glAccountId: null }),
  };
});

describe('PUT /api/settings/catalog/dockage-rates/:id/gl-mappings/:locationId', () => {
  it('rejects when GL account belongs to a different location', async () => {
    (mockPrisma as any).dockageRate.findFirst.mockResolvedValue({
      id: 'rate-1',
      locationId: 'loc-A',
    });
    (mockPrisma as any).glAccount.findFirst.mockResolvedValue({
      id: 'gl-other',
      locationId: 'loc-B',
    });

    const res = await request(app)
      .put('/api/settings/catalog/dockage-rates/rate-1/gl-mappings/loc-A')
      .send({ glAccountId: 'gl-other' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/different location/);
    expect((mockPrisma as any).dockageRateGlMapping.upsert).not.toHaveBeenCalled();
  });

  it('rejects when dockage rate is for a different location than the URL', async () => {
    (mockPrisma as any).dockageRate.findFirst.mockResolvedValue({
      id: 'rate-1',
      locationId: 'loc-A',
    });

    const res = await request(app)
      .put('/api/settings/catalog/dockage-rates/rate-1/gl-mappings/loc-B')
      .send({ glAccountId: null });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/does not belong/);
  });

  it('upserts mapping when GL account is in the right location', async () => {
    (mockPrisma as any).dockageRate.findFirst.mockResolvedValue({
      id: 'rate-1',
      locationId: 'loc-A',
    });
    (mockPrisma as any).glAccount.findFirst.mockResolvedValue({
      id: 'gl-loc-a',
      locationId: 'loc-A',
    });

    const res = await request(app)
      .put('/api/settings/catalog/dockage-rates/rate-1/gl-mappings/loc-A')
      .send({ glAccountId: 'gl-loc-a' });

    expect(res.status).toBe(200);
    expect((mockPrisma as any).dockageRateGlMapping.upsert).toHaveBeenCalledTimes(1);
  });

  it('rejects a tenant-wide GL account when the location is QBO-connected', async () => {
    (mockPrisma as any).dockageRate.findFirst.mockResolvedValue({
      id: 'rate-1',
      locationId: 'loc-A',
    });
    (mockPrisma as any).glAccount.findFirst.mockResolvedValue({
      id: 'gl-tenant',
      locationId: null,
    });
    // QBO-connected location → tenant-wide accounts must be rejected.
    (mockPrisma as any).location.findUnique.mockResolvedValue({
      qboAccessToken: 'tok',
      qboRealmId: 'realm-1',
    });

    const res = await request(app)
      .put('/api/settings/catalog/dockage-rates/rate-1/gl-mappings/loc-A')
      .send({ glAccountId: 'gl-tenant' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/different location/);
    expect((mockPrisma as any).dockageRateGlMapping.upsert).not.toHaveBeenCalled();
  });

  it('accepts a tenant-wide GL account when the location is NOT QBO-connected', async () => {
    (mockPrisma as any).dockageRate.findFirst.mockResolvedValue({
      id: 'rate-1',
      locationId: 'loc-A',
    });
    (mockPrisma as any).glAccount.findFirst.mockResolvedValue({
      id: 'gl-tenant',
      locationId: null,
    });
    // Location has no QBO connection → tenant-wide legacy chart is allowed.
    (mockPrisma as any).location.findUnique.mockResolvedValue({
      qboAccessToken: null,
      qboRealmId: null,
    });

    const res = await request(app)
      .put('/api/settings/catalog/dockage-rates/rate-1/gl-mappings/loc-A')
      .send({ glAccountId: 'gl-tenant' });

    expect(res.status).toBe(200);
    expect((mockPrisma as any).dockageRateGlMapping.upsert).toHaveBeenCalledTimes(1);
  });
});
