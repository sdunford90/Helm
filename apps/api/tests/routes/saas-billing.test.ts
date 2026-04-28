import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { mockPrisma } from '../setup.js';

// ---------------------------------------------------------------------------
// Stripe SDK + Clerk middleware mocks
// ---------------------------------------------------------------------------

const stripeCustomersCreate = vi.fn();
const stripeCheckoutCreate = vi.fn();
const stripeBillingPortalCreate = vi.fn();
const stripeSubscriptionsRetrieve = vi.fn();

vi.mock('../../src/lib/stripe.js', () => ({
  stripe: null,
  requireStripe: vi.fn(() => ({
    customers: { create: stripeCustomersCreate },
    checkout: { sessions: { create: stripeCheckoutCreate } },
    billingPortal: { sessions: { create: stripeBillingPortalCreate } },
    subscriptions: { retrieve: stripeSubscriptionsRetrieve },
  })),
}));

// Force the request through as a known tenant + user with access to all
// locations of that tenant so the location-scoped ACL succeeds for our
// owned location, and fails for a "stranger" location.
const TENANT_ID = 'tenant-billing-1';
const OWNED_LOCATION_ID = 'loc-owned-1';
const FOREIGN_LOCATION_ID = 'loc-foreign-99';

vi.mock('../../src/middleware/auth.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    clerkAuth: () => [
      (req: any, _res: any, next: any) => {
        req.auth = { userId: 'user-1' };
        req.tenantId = TENANT_ID;
        req.user = {
          id: 'user-1',
          tenantId: TENANT_ID,
          role: 'MARINA_OWNER',
          allowedLocationIds: null, // null = all locations of tenant
        };
        next();
      },
    ],
    requireLocationAccess: (req: any, locationId: string) => {
      const allowed: string[] | null = req.user?.allowedLocationIds ?? null;
      if (allowed === null) return true;
      return allowed.includes(locationId);
    },
    filterByAllowedLocations: (_req: any, where: Record<string, unknown>) => where,
  };
});

let app: any;

beforeEach(async () => {
  vi.clearAllMocks();
  process.env.APP_URL = 'https://test.gethelm.com';

  mockPrisma.location.findUnique.mockReset();
  mockPrisma.location.update.mockReset();
  mockPrisma.location.findMany.mockReset();
  mockPrisma.saasTier.findUnique.mockReset();
  mockPrisma.saasTier.findMany.mockReset();

  const mod = await import('../../src/index.js');
  app = mod.default;
});

const mockOwnedLocation = (overrides: Record<string, unknown> = {}) => ({
  id: OWNED_LOCATION_ID,
  tenantId: TENANT_ID,
  name: 'Owned Marina',
  saasTierId: null,
  stripeCustomerId: null,
  stripeSubscriptionId: null,
  subscriptionStatus: null,
  gracePeriodStartedAt: null,
  ...overrides,
});

describe('GET /api/saas-billing/locations', () => {
  it('returns one row per location with subscription summary fields', async () => {
    mockPrisma.location.findMany.mockResolvedValue([
      {
        id: 'loc-1',
        name: 'Main Harbor',
        active: true,
        saasTierId: 'tier-pro',
        stripeCustomerId: 'cus_abc',
        stripeSubscriptionId: 'sub_abc',
        subscriptionStatus: 'active',
        gracePeriodStartedAt: null,
      },
      {
        id: 'loc-2',
        name: 'Fuel Dock',
        active: true,
        saasTierId: null,
        stripeCustomerId: null,
        stripeSubscriptionId: null,
        subscriptionStatus: null,
        gracePeriodStartedAt: null,
      },
    ] as any);

    const res = await request(app).get('/api/saas-billing/locations');
    expect(res.status).toBe(200);
    expect(res.body.locations).toHaveLength(2);
    expect(res.body.locations[0]).toMatchObject({
      id: 'loc-1',
      name: 'Main Harbor',
      hasSubscription: true,
      hasStripeCustomer: true,
      subscriptionStatus: 'active',
    });
    expect(res.body.locations[1].hasSubscription).toBe(false);
  });
});

describe('GET /api/saas-billing/locations/:locationId/status', () => {
  it('returns 404 when the location belongs to another tenant', async () => {
    mockPrisma.location.findUnique.mockResolvedValue(
      mockOwnedLocation({ id: FOREIGN_LOCATION_ID, tenantId: 'other-tenant' }) as any,
    );
    const res = await request(app).get(
      `/api/saas-billing/locations/${FOREIGN_LOCATION_ID}/status`,
    );
    expect(res.status).toBe(404);
  });

  it('returns subscription details when there is an active stripe subscription', async () => {
    mockPrisma.location.findUnique.mockResolvedValue(
      mockOwnedLocation({
        saasTierId: 'tier-pro',
        stripeCustomerId: 'cus_abc',
        stripeSubscriptionId: 'sub_abc',
        subscriptionStatus: 'active',
      }) as any,
    );
    stripeSubscriptionsRetrieve.mockResolvedValue({
      id: 'sub_abc',
      status: 'active',
      cancel_at_period_end: false,
      items: { data: [{ current_period_end: 1800000000 }] },
    });

    const res = await request(app).get(
      `/api/saas-billing/locations/${OWNED_LOCATION_ID}/status`,
    );
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      locationId: OWNED_LOCATION_ID,
      saasTierId: 'tier-pro',
      subscription: { id: 'sub_abc', status: 'active' },
    });
    expect(stripeSubscriptionsRetrieve).toHaveBeenCalledWith('sub_abc');
  });

  it('returns subscription:null when location has no stripe subscription', async () => {
    mockPrisma.location.findUnique.mockResolvedValue(mockOwnedLocation() as any);
    const res = await request(app).get(
      `/api/saas-billing/locations/${OWNED_LOCATION_ID}/status`,
    );
    expect(res.status).toBe(200);
    expect(res.body.subscription).toBeNull();
    expect(stripeSubscriptionsRetrieve).not.toHaveBeenCalled();
  });
});

describe('POST /api/saas-billing/locations/:locationId/checkout', () => {
  it('creates a Stripe customer (with locationId metadata) and a checkout session', async () => {
    const tierId = '11111111-1111-1111-1111-111111111111';
    mockPrisma.location.findUnique.mockResolvedValue(mockOwnedLocation() as any);
    mockPrisma.saasTier.findUnique.mockResolvedValue({
      id: tierId,
      name: 'Professional',
      stripePriceId: 'price_pro',
    } as any);
    stripeCustomersCreate.mockResolvedValue({ id: 'cus_new' });
    stripeCheckoutCreate.mockResolvedValue({
      id: 'cs_test_123',
      url: 'https://checkout.stripe.com/c/test',
    });

    const res = await request(app)
      .post(`/api/saas-billing/locations/${OWNED_LOCATION_ID}/checkout`)
      .send({ tierId });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      url: 'https://checkout.stripe.com/c/test',
      sessionId: 'cs_test_123',
    });

    // Stripe Customer carries the locationId.
    expect(stripeCustomersCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          tenantId: TENANT_ID,
          locationId: OWNED_LOCATION_ID,
        }),
      }),
    );
    // Subscription metadata must also tag location for webhook routing.
    expect(stripeCheckoutCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        subscription_data: {
          metadata: expect.objectContaining({
            tenantId: TENANT_ID,
            locationId: OWNED_LOCATION_ID,
            tierId,
          }),
        },
      }),
    );
    // Newly-created customer was persisted onto the location.
    expect(mockPrisma.location.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: OWNED_LOCATION_ID },
        data: { stripeCustomerId: 'cus_new' },
      }),
    );
  });

  it('rejects an invalid tierId (non-uuid) with a 4xx', async () => {
    mockPrisma.location.findUnique.mockResolvedValue(mockOwnedLocation() as any);
    const res = await request(app)
      .post(`/api/saas-billing/locations/${OWNED_LOCATION_ID}/checkout`)
      .send({ tierId: 'not-a-uuid' });
    // The express error middleware turns the zod failure into a 4xx.
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(stripeCheckoutCreate).not.toHaveBeenCalled();
  });

  it('refuses to start checkout when the location already has a subscription', async () => {
    mockPrisma.location.findUnique.mockResolvedValue(
      mockOwnedLocation({
        stripeCustomerId: 'cus_x',
        stripeSubscriptionId: 'sub_x',
      }) as any,
    );
    const res = await request(app)
      .post(`/api/saas-billing/locations/${OWNED_LOCATION_ID}/checkout`)
      .send({ tierId: '11111111-1111-1111-1111-111111111111' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ALREADY_SUBSCRIBED');
    expect(stripeCheckoutCreate).not.toHaveBeenCalled();
  });
});

describe('POST /api/saas-billing/locations/:locationId/portal', () => {
  it('400s when the location has no stripe customer yet', async () => {
    mockPrisma.location.findUnique.mockResolvedValue(mockOwnedLocation() as any);
    const res = await request(app).post(
      `/api/saas-billing/locations/${OWNED_LOCATION_ID}/portal`,
    );
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('NO_CUSTOMER');
  });

  it('opens a Stripe billing portal session for the location customer', async () => {
    mockPrisma.location.findUnique.mockResolvedValue(
      mockOwnedLocation({ stripeCustomerId: 'cus_loc' }) as any,
    );
    stripeBillingPortalCreate.mockResolvedValue({ url: 'https://billing.stripe.com/p/test' });
    const res = await request(app).post(
      `/api/saas-billing/locations/${OWNED_LOCATION_ID}/portal`,
    );
    expect(res.status).toBe(200);
    expect(res.body.url).toBe('https://billing.stripe.com/p/test');
    expect(stripeBillingPortalCreate).toHaveBeenCalledWith(
      expect.objectContaining({ customer: 'cus_loc' }),
    );
  });
});

describe('Legacy aliases require locationId', () => {
  it('GET /status without locationId 400s', async () => {
    const res = await request(app).get('/api/saas-billing/status');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('LOCATION_ID_REQUIRED');
  });

  it('POST /checkout without locationId 400s', async () => {
    const res = await request(app)
      .post('/api/saas-billing/checkout')
      .send({ tierId: '11111111-1111-1111-1111-111111111111' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('LOCATION_ID_REQUIRED');
  });
});
