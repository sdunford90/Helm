import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest';
import request from 'supertest';

// Lock down task #196's fix to the QBO OAuth callback: every error path
// must redirect the popup back to /oauth-complete with success=false and a
// sanitized reason code. The route must NEVER respond with a JSON 4xx body
// or a 401 — that would leave the OAuth popup stuck on a JSON page with no
// usable error UI for the operator. It must also never sit behind Clerk
// auth, because Intuit's top-level cross-origin redirect cannot reliably
// carry our session cookie.

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

import {
  handleCallback,
  handleCallbackForLocation,
} from '../../src/services/qbo-sync.js';

let app: any;

beforeAll(() => {
  process.env.APP_SECRET = 'test-secret-for-qbo-callback-tests';
  process.env.APP_URL = 'http://localhost:5000';
});

beforeEach(async () => {
  vi.clearAllMocks();
  const mod = await import('../../src/index.js');
  app = mod.default;
});

function expectFailureRedirect(
  res: request.Response,
  reason: string,
  opts: { locationId?: string } = {},
) {
  expect(res.status).toBe(302);
  // Must be a redirect (not a JSON body).
  expect(res.headers.location).toBeDefined();
  expect(res.body).toEqual({});
  const location = res.headers.location!;
  expect(location).toContain('/oauth-complete');
  const url = new URL(location);
  expect(url.pathname).toBe('/oauth-complete');
  expect(url.searchParams.get('provider')).toBe('qbo');
  expect(url.searchParams.get('success')).toBe('false');
  expect(url.searchParams.get('reason')).toBe(reason);
  if (opts.locationId !== undefined) {
    expect(url.searchParams.get('locationId')).toBe(opts.locationId);
  } else {
    expect(url.searchParams.has('locationId')).toBe(false);
  }
}

describe('GET /api/qbo/callback — error paths always redirect (task #196)', () => {
  it('redirects with reason=missing_params when query is empty', async () => {
    const res = await request(app).get('/api/qbo/callback');

    expectFailureRedirect(res, 'missing_params');
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(400);
    expect(vi.mocked(handleCallback)).not.toHaveBeenCalled();
    expect(vi.mocked(handleCallbackForLocation)).not.toHaveBeenCalled();
  });

  it('redirects with reason=missing_params when only some params are present', async () => {
    const res = await request(app)
      .get('/api/qbo/callback')
      .query({ code: 'auth-code-only' });

    expectFailureRedirect(res, 'missing_params');
  });

  it('redirects with reason=invalid_state for a forged state token', async () => {
    const res = await request(app)
      .get('/api/qbo/callback')
      .query({ code: 'c', realmId: 'r', state: 'forged.token.value' });

    expectFailureRedirect(res, 'invalid_state');
    expect(vi.mocked(handleCallback)).not.toHaveBeenCalled();
    expect(vi.mocked(handleCallbackForLocation)).not.toHaveBeenCalled();
  });

  it('redirects with reason=token_exchange_failed when the QBO token exchange throws', async () => {
    const { issueOAuthState } = await import('../../src/lib/oauth-state.js');
    const state = issueOAuthState('test-tenant-id');
    vi.mocked(handleCallback).mockRejectedValueOnce(new Error('intuit 500'));

    const res = await request(app)
      .get('/api/qbo/callback')
      .query({ code: 'c', realmId: 'r', state });

    expectFailureRedirect(res, 'token_exchange_failed');
  });

  it('preserves locationId on token-exchange failure when state had one', async () => {
    const { issueOAuthState } = await import('../../src/lib/oauth-state.js');
    const state = issueOAuthState('test-tenant-id', { locationId: 'loc-with-error' });
    vi.mocked(handleCallbackForLocation).mockRejectedValueOnce(new Error('intuit 500'));

    const res = await request(app)
      .get('/api/qbo/callback')
      .query({ code: 'c', realmId: 'r', state });

    expectFailureRedirect(res, 'token_exchange_failed', { locationId: 'loc-with-error' });
  });

  it('the route never returns 401 even though the request carries no Clerk session', async () => {
    // Intuit redirects the popup via a top-level cross-origin navigation
    // that cannot reliably carry our Clerk session cookie. The callback
    // therefore MUST be mounted before any auth middleware. Hitting the
    // route with no Authorization header and no cookie must not surface a
    // 401 — it must always reach the redirect handler.
    const res = await request(app).get('/api/qbo/callback');

    expect(res.status).not.toBe(401);
    expect(res.status).toBe(302);
  });

  it('reason codes are sanitized — only known codes are surfaced to the popup', async () => {
    // The handler maps internal failures to a fixed set of codes. Only
    // these codes should ever appear in the redirect.
    const ALLOWED = new Set([
      'missing_params',
      'invalid_state',
      'token_exchange_failed',
      'unexpected_error',
    ]);

    const cases: Array<{ query: Record<string, string> | undefined; setup?: () => void }> = [
      { query: undefined },
      { query: { code: 'c', realmId: 'r', state: 'forged' } },
    ];

    for (const c of cases) {
      c.setup?.();
      const res = c.query
        ? await request(app).get('/api/qbo/callback').query(c.query)
        : await request(app).get('/api/qbo/callback');
      expect(res.status).toBe(302);
      const reason = new URL(res.headers.location!).searchParams.get('reason');
      expect(reason).not.toBeNull();
      expect(ALLOWED.has(reason!)).toBe(true);
    }
  });
});
