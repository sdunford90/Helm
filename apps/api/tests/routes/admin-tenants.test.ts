import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { mockPrisma } from '../setup.js';

vi.mock('../../src/middleware/auth.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    requirePlatformAdmin: () => [
      (req: any, _res: any, next: any) => {
        req.auth = { userId: 'admin-1' };
        req.user = { id: 'admin-1', role: 'PLATFORM_ADMIN' };
        next();
      },
    ],
  };
});

let app: any;

beforeEach(async () => {
  vi.clearAllMocks();

  mockPrisma.tenant.findUnique.mockReset();
  // Cast: prisma.tenant in setup has only findFirst/findUnique/update — add create on the fly.
  (mockPrisma.tenant as any).create = vi.fn();
  mockPrisma.location.create.mockReset();
  mockPrisma.user.create.mockReset();
  mockPrisma.saasTier.findUnique.mockReset();

  const mod = await import('../../src/index.js');
  app = mod.default;
});

describe('POST /api/admin/tenants — create-tenant flow', () => {
  it('400s when required fields are missing', async () => {
    const res = await request(app).post('/api/admin/tenants').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/required/i);
  });

  it('400s on a malformed subdomain', async () => {
    const res = await request(app).post('/api/admin/tenants').send({
      name: 'Cove',
      subdomain: 'BAD UPPER',
      adminEmail: 'a@b.co',
      initialLocation: { name: 'Main' },
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/subdomain/i);
  });

  it('400s on a malformed email', async () => {
    const res = await request(app).post('/api/admin/tenants').send({
      name: 'Cove',
      subdomain: 'cove',
      adminEmail: 'not-an-email',
      initialLocation: { name: 'Main' },
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/email/i);
  });

  it('400s when initialLocation is missing', async () => {
    const res = await request(app).post('/api/admin/tenants').send({
      name: 'Cove',
      subdomain: 'cove',
      adminEmail: 'a@b.co',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/initial location/i);
  });

  it('409s on a taken subdomain', async () => {
    mockPrisma.tenant.findUnique.mockResolvedValue({ id: 'existing' } as any);
    const res = await request(app).post('/api/admin/tenants').send({
      name: 'Cove',
      subdomain: 'cove',
      adminEmail: 'a@b.co',
      initialLocation: { name: 'Main' },
    });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/taken/i);
  });

  it('400s on an unknown saasTierId', async () => {
    mockPrisma.tenant.findUnique.mockResolvedValue(null);
    mockPrisma.saasTier.findUnique.mockResolvedValue(null);
    const res = await request(app).post('/api/admin/tenants').send({
      name: 'Cove',
      subdomain: 'cove',
      adminEmail: 'a@b.co',
      saasTierId: 'tier-bogus',
      initialLocation: { name: 'Main' },
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/SaaS tier/i);
  });

  it('creates tenant + initial location (with saasTierId) + admin user atomically', async () => {
    mockPrisma.tenant.findUnique.mockResolvedValue(null);
    mockPrisma.saasTier.findUnique.mockResolvedValue({ id: 'tier-pro' } as any);

    const createdTenant = { id: 'tenant-new', name: 'Sunset Cove', subdomain: 'sunset' };
    const createdLocation = { id: 'loc-new', name: 'Main Harbor' };
    (mockPrisma.tenant as any).create.mockResolvedValue(createdTenant);
    mockPrisma.location.create.mockResolvedValue(createdLocation as any);
    mockPrisma.user.create.mockResolvedValue({ id: 'user-new' } as any);

    const res = await request(app).post('/api/admin/tenants').send({
      name: 'Sunset Cove',
      subdomain: 'sunset',
      adminEmail: 'owner@sunsetcove.com',
      saasTierId: 'tier-pro',
      initialLocation: {
        name: 'Main Harbor',
        timezone: 'America/New_York',
        city: 'Annapolis',
        state: 'MD',
      },
    });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      id: 'tenant-new',
      name: 'Sunset Cove',
      initialLocation: { id: 'loc-new', name: 'Main Harbor' },
    });

    // Tenant create has NO saasTierId — that lives on the location now.
    expect((mockPrisma.tenant as any).create).toHaveBeenCalledWith({
      data: { name: 'Sunset Cove', subdomain: 'sunset' },
    });
    // Location create gets the saasTierId.
    expect(mockPrisma.location.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: 'tenant-new',
          name: 'Main Harbor',
          saasTierId: 'tier-pro',
        }),
      }),
    );
    // Initial admin user gets MARINA_OWNER role.
    expect(mockPrisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: 'tenant-new',
          email: 'owner@sunsetcove.com',
          role: 'MARINA_OWNER',
        }),
      }),
    );
  });
});

// ===========================================================================
// Admin per-location billing actions — tests the contract the admin UI
// (TenantDetail.tsx Locations tab) depends on for "Start Checkout" and
// "Open Stripe Portal" buttons.
// ===========================================================================

describe('GET /api/admin/billing/tiers — response shape contract', () => {
  it('returns { tiers: [...] } so the admin UI can read res.tiers', async () => {
    mockPrisma.saasTier.findMany.mockResolvedValue([
      {
        id: 'tier-1',
        name: 'Pro',
        monthlyFeeCents: 19900,
        perLocationFeeCents: 0,
        achFeeRate: 0.5,
        cardFeeRate: 2.9,
        storageLimitGb: 100,
        _count: { tenants: 3 },
      },
    ] as any);

    const res = await request(app).get('/api/admin/billing/tiers');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(false);
    expect(Array.isArray(res.body.tiers)).toBe(true);
    expect(res.body.tiers[0]).toMatchObject({
      id: 'tier-1',
      name: 'Pro',
      tenantCount: 3,
    });
  });
});

describe('POST /api/admin/locations/:locationId/billing/checkout', () => {
  it('404s when the location does not exist', async () => {
    mockPrisma.location.findUnique.mockResolvedValue(null);
    const res = await request(app)
      .post('/api/admin/locations/loc-missing/billing/checkout')
      .send({ tierId: '00000000-0000-0000-0000-000000000001' });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });

  it('409s when the location already has a subscription', async () => {
    mockPrisma.location.findUnique.mockResolvedValue({
      id: 'loc-A',
      tenantId: 'tenant-A',
      name: 'Pier A',
      saasTierId: 'tier-1',
      stripeCustomerId: 'cus_x',
      stripeSubscriptionId: 'sub_x',
      subscriptionStatus: 'active',
      gracePeriodStartedAt: null,
    } as any);
    const res = await request(app)
      .post('/api/admin/locations/loc-A/billing/checkout')
      .send({ tierId: '00000000-0000-0000-0000-000000000001' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ALREADY_SUBSCRIBED');
  });
});

describe('POST /api/admin/locations/:locationId/billing/portal', () => {
  it('400s when the location has no Stripe customer yet', async () => {
    mockPrisma.location.findUnique.mockResolvedValue({
      id: 'loc-B',
      tenantId: 'tenant-B',
      name: 'Pier B',
      saasTierId: null,
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      subscriptionStatus: null,
      gracePeriodStartedAt: null,
    } as any);
    const res = await request(app)
      .post('/api/admin/locations/loc-B/billing/portal')
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('NO_CUSTOMER');
  });
});
