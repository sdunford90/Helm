import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest';
import request from 'supertest';

// Lock down task #196's fix: removing Clerk auth from the QBO OAuth
// callback must NOT have accidentally opened the rest of the QBO surface.
// /authorize, /sync, /status, /disconnect, /pull etc. must still require
// authentication. We override the global setup.ts mock for clerkAuth to
// actually enforce auth for this file, then assert each authenticated
// route returns 401 for an unauthenticated request while the public
// callback still works.

vi.mock('../../src/services/qbo-sync.js', () => ({
  getAuthorizationUrl: vi.fn().mockResolvedValue('https://qbo.example.com/auth'),
  handleCallback: vi.fn().mockResolvedValue(undefined),
  handleCallbackForLocation: vi.fn().mockResolvedValue(undefined),
  syncAll: vi.fn().mockResolvedValue({ synced: 0, failed: 0 }),
  syncCustomer: vi.fn().mockResolvedValue(undefined),
  syncInvoice: vi.fn().mockResolvedValue(undefined),
  getStatus: vi.fn().mockResolvedValue({ connected: false }),
  disconnect: vi.fn().mockResolvedValue(undefined),
  disconnectLocation: vi.fn().mockResolvedValue(undefined),
  handleQboWebhook: vi.fn().mockResolvedValue(undefined),
  pullVendorsAndBillsForTenant: vi.fn().mockResolvedValue({
    vendors: { created: 0, updated: 0, skipped: 0 },
    bills: { created: 0, updated: 0, skipped: 0 },
    endpoints: [],
  }),
}));

// Override the auth mock from setup.ts so clerkAuth actually rejects
// requests without an Authorization header. requireRole / etc. stay
// permissive so we're isolating the auth gate.
vi.mock('../../src/middleware/auth.js', () => ({
  clerkAuth: () => [
    (req: any, res: any, next: any) => {
      if (!req.headers.authorization) {
        res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
        return;
      }
      req.userId = 'test-user-id';
      req.userRole = 'MARINA_OWNER';
      req.userRecord = {
        id: 'test-user-id',
        clerk_id: 'test-clerk-user',
        tenant_id: 'test-tenant-id',
        role: 'MARINA_OWNER',
        email: 'admin@test.com',
      };
      req.allowedLocationIds = null;
      next();
    },
  ],
  requireRole: (..._roles: string[]) => (_req: any, _res: any, next: any) => next(),
  requirePlatformAdmin: () => [
    (req: any, res: any, next: any) => {
      if (!req.headers.authorization) {
        res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
        return;
      }
      req.userId = 'test-user-id';
      req.userRole = 'PLATFORM_ADMIN';
      req.userAdminRole = 'SUPERUSER';
      next();
    },
  ],
  requireAdminRole: (..._roles: string[]) => (_req: any, _res: any, next: any) => next(),
  ADMIN_ROLES: ['SUPERUSER', 'BILLING_ADMIN', 'READ_ONLY_SUPPORT'] as const,
  isAdminRole: (v: unknown) =>
    typeof v === 'string' && ['SUPERUSER', 'BILLING_ADMIN', 'READ_ONLY_SUPPORT'].includes(v),
  isLocationBypassRole: (role: string | undefined | null) =>
    !!role && ['PLATFORM_ADMIN', 'TENANT_ADMIN', 'MARINA_OWNER'].includes(role),
  loadAllowedLocationIds: async () => null,
  filterByAllowedLocations: (_req: any, baseWhere: Record<string, unknown>) => baseWhere,
  requireLocationAccess: () => true,
  assertAuthConfigOrExit: () => {},
}));

let app: any;

beforeAll(() => {
  process.env.APP_SECRET = 'test-secret-for-qbo-auth-gating';
  process.env.APP_URL = 'http://localhost:5000';
});

beforeEach(async () => {
  vi.clearAllMocks();
  const mod = await import('../../src/index.js');
  app = mod.default;
});

describe('Authenticated /api/qbo routes still require Clerk auth (task #196 regression guard)', () => {
  it('GET /api/qbo/authorize returns 401 without an Authorization header', async () => {
    const res = await request(app).get('/api/qbo/authorize');

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
  });

  it('POST /api/qbo/sync returns 401 without an Authorization header', async () => {
    const res = await request(app).post('/api/qbo/sync').send({});

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
  });

  it('GET /api/qbo/status returns 401 without an Authorization header', async () => {
    const res = await request(app).get('/api/qbo/status');

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
  });

  it('POST /api/qbo/disconnect returns 401 without an Authorization header', async () => {
    const res = await request(app).post('/api/qbo/disconnect').send({});

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
  });

  it('POST /api/qbo/pull returns 401 without an Authorization header', async () => {
    const res = await request(app).post('/api/qbo/pull').send({});

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
  });

  it('the same routes succeed (not 401) when an Authorization header is present', async () => {
    // Sanity check that our overridden mock isn't just blanket-401ing
    // everything. With a header, /authorize should reach the handler and
    // return the auth URL.
    const res = await request(app)
      .get('/api/qbo/authorize')
      .set('authorization', 'Bearer test-token');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ url: 'https://qbo.example.com/auth' });
  });

  it('GET /api/qbo/callback remains public (does NOT return 401 without auth)', async () => {
    // The whole point of task #196: the OAuth callback must be reachable
    // without a Clerk session, because Intuit's top-level cross-origin
    // redirect cannot carry our cookie. Verify the callback router is
    // mounted before the auth gate so an unauthenticated request reaches
    // the redirect handler instead of the 401 wall.
    const res = await request(app).get('/api/qbo/callback');

    expect(res.status).not.toBe(401);
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('/oauth-complete');
    expect(res.headers.location).toContain('success=false');
  });
});
