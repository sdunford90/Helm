import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest';
import request from 'supertest';
import { mockPrisma } from '../setup.js';

// Lock down task #196's fix to the onboarding wizard's QBO callback at
// GET /api/onboarding/:tenantId/qbo/callback. Like the post-onboarding
// callback at /api/qbo/callback, every error path must redirect the popup
// to /oauth-complete with success=false and a sanitized reason code —
// never JSON 4xx — so the wizard's popup gets a usable error UI.

let app: any;

beforeAll(() => {
  process.env.APP_SECRET = 'test-secret-for-onboarding-qbo-callback';
  process.env.APP_URL = 'http://localhost:5000';
  process.env.QBO_CLIENT_ID = 'test-qbo-client-id';
  process.env.QBO_CLIENT_SECRET = 'test-qbo-client-secret';
});

beforeEach(async () => {
  vi.clearAllMocks();
  (mockPrisma as any).location.findFirst = vi.fn();
  (mockPrisma as any).location.update = vi.fn().mockResolvedValue({ id: 'loc-1' });
  mockPrisma.tenant.update = vi.fn().mockResolvedValue({ id: 'test-tenant-id' }) as any;

  const mod = await import('../../src/index.js');
  app = mod.default;
});

function expectFailureRedirect(
  res: request.Response,
  reason: string,
  opts: { locationId?: string } = {},
) {
  expect(res.status).toBe(302);
  expect(res.body).toEqual({});
  const location = res.headers.location!;
  expect(location).toBeDefined();
  const url = new URL(location);
  expect(url.pathname).toBe('/oauth-complete');
  expect(url.searchParams.get('provider')).toBe('qbo');
  expect(url.searchParams.get('success')).toBe('false');
  expect(url.searchParams.get('reason')).toBe(reason);
  if (opts.locationId !== undefined) {
    expect(url.searchParams.get('locationId')).toBe(opts.locationId);
  }
}

describe('GET /api/onboarding/:tenantId/qbo/callback — error paths always redirect (task #196)', () => {
  const TENANT_ID = 'test-tenant-id';

  it('redirects with reason=missing_code when authorization code is absent', async () => {
    const res = await request(app).get(`/api/onboarding/${TENANT_ID}/qbo/callback`);

    expectFailureRedirect(res, 'missing_code');
    expect(res.status).not.toBe(401);
  });

  it('redirects with reason=missing_realm when realmId is absent', async () => {
    const res = await request(app)
      .get(`/api/onboarding/${TENANT_ID}/qbo/callback`)
      .query({ code: 'auth-code' });

    expectFailureRedirect(res, 'missing_realm');
  });

  it('redirects with reason=missing_state when state is absent', async () => {
    const res = await request(app)
      .get(`/api/onboarding/${TENANT_ID}/qbo/callback`)
      .query({ code: 'auth-code', realmId: 'realm-1' });

    expectFailureRedirect(res, 'missing_state');
  });

  it('redirects with reason=invalid_state when the state token is forged', async () => {
    const res = await request(app)
      .get(`/api/onboarding/${TENANT_ID}/qbo/callback`)
      .query({ code: 'auth-code', realmId: 'realm-1', state: 'forged.state' });

    expectFailureRedirect(res, 'invalid_state');
  });

  it('redirects with reason=tenant_mismatch when state was issued for a different tenant', async () => {
    const { issueOAuthState } = await import('../../src/lib/oauth-state.js');
    const state = issueOAuthState('a-different-tenant');

    const res = await request(app)
      .get(`/api/onboarding/${TENANT_ID}/qbo/callback`)
      .query({ code: 'auth-code', realmId: 'realm-1', state });

    expectFailureRedirect(res, 'tenant_mismatch');
  });

  it('redirects with reason=location_mismatch when the embedded location no longer belongs to the tenant', async () => {
    const { issueOAuthState } = await import('../../src/lib/oauth-state.js');
    const state = issueOAuthState(TENANT_ID, { locationId: 'loc-stale' });
    (mockPrisma as any).location.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .get(`/api/onboarding/${TENANT_ID}/qbo/callback`)
      .query({ code: 'auth-code', realmId: 'realm-1', state });

    expectFailureRedirect(res, 'location_mismatch', { locationId: 'loc-stale' });
  });

  it('redirects with reason=token_exchange_failed when the QBO token exchange returns an error response', async () => {
    const { issueOAuthState } = await import('../../src/lib/oauth-state.js');
    const state = issueOAuthState(TENANT_ID);

    const fetchSpy = vi.spyOn(globalThis, 'fetch' as any).mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => 'invalid_grant',
    } as any);

    try {
      const res = await request(app)
        .get(`/api/onboarding/${TENANT_ID}/qbo/callback`)
        .query({ code: 'auth-code', realmId: 'realm-1', state });

      expectFailureRedirect(res, 'token_exchange_failed');
      // No tenant write happened because the token exchange failed.
      expect(mockPrisma.tenant.update).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('every error response is a 302 redirect to /oauth-complete — never a JSON 4xx body', async () => {
    // Sanity sweep: regardless of which error path we trip, the response
    // must be a redirect with a usable reason. The popup never sees JSON.
    const cases: Array<{ query?: Record<string, string> }> = [
      { query: undefined },
      { query: { code: 'c' } },
      { query: { code: 'c', realmId: 'r' } },
      { query: { code: 'c', realmId: 'r', state: 'forged' } },
    ];

    for (const c of cases) {
      const req = request(app).get(`/api/onboarding/${TENANT_ID}/qbo/callback`);
      const res = c.query ? await req.query(c.query) : await req;

      expect(res.status).toBe(302);
      expect(res.body).toEqual({});
      const url = new URL(res.headers.location!);
      expect(url.pathname).toBe('/oauth-complete');
      expect(url.searchParams.get('provider')).toBe('qbo');
      expect(url.searchParams.get('success')).toBe('false');
      // reason is always present and is one of the known sanitized codes.
      const reason = url.searchParams.get('reason');
      expect(reason).not.toBeNull();
      expect([
        'missing_code',
        'missing_realm',
        'missing_state',
        'invalid_state',
        'tenant_mismatch',
        'location_mismatch',
        'token_exchange_failed',
        'unexpected_error',
      ]).toContain(reason);
    }
  });
});
