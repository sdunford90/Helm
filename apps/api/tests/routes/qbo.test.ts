import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest';
import request from 'supertest';

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
}));

import {
  handleCallback,
  handleCallbackForLocation,
} from '../../src/services/qbo-sync.js';

let app: any;

beforeAll(() => {
  process.env.APP_SECRET = 'test-secret-for-qbo-route-tests';
  process.env.APP_URL = 'http://localhost:5000';
});

beforeEach(async () => {
  vi.clearAllMocks();
  const mod = await import('../../src/index.js');
  app = mod.default;
});

describe('GET /api/qbo/callback — location routing', () => {
  it('calls handleCallbackForLocation when state embeds a locationId', async () => {
    const { issueOAuthState } = await import('../../src/lib/oauth-state.js');
    const state = issueOAuthState('test-tenant-id', { locationId: 'loc-abc' });

    const res = await request(app)
      .get('/api/qbo/callback')
      .query({ code: 'auth-code-123', realmId: 'realm-999', state });

    expect(res.status).toBe(302);
    expect(vi.mocked(handleCallbackForLocation)).toHaveBeenCalledOnce();
    expect(vi.mocked(handleCallbackForLocation)).toHaveBeenCalledWith(
      'auth-code-123',
      'realm-999',
      'loc-abc',
      'test-tenant-id',
    );
    expect(vi.mocked(handleCallback)).not.toHaveBeenCalled();
  });

  it('calls handleCallback (tenant-level) when state has no locationId', async () => {
    const { issueOAuthState } = await import('../../src/lib/oauth-state.js');
    const state = issueOAuthState('test-tenant-id');

    const res = await request(app)
      .get('/api/qbo/callback')
      .query({ code: 'auth-code-456', realmId: 'realm-111', state });

    expect(res.status).toBe(302);
    expect(vi.mocked(handleCallback)).toHaveBeenCalledOnce();
    expect(vi.mocked(handleCallback)).toHaveBeenCalledWith(
      'auth-code-456',
      'realm-111',
      'test-tenant-id',
    );
    expect(vi.mocked(handleCallbackForLocation)).not.toHaveBeenCalled();
  });

  it('returns 400 for a forged/invalid state token', async () => {
    const res = await request(app)
      .get('/api/qbo/callback')
      .query({ code: 'code', realmId: 'realm', state: 'forged.token' });

    expect(res.status).toBe(400);
    expect(vi.mocked(handleCallback)).not.toHaveBeenCalled();
    expect(vi.mocked(handleCallbackForLocation)).not.toHaveBeenCalled();
  });

  it('redirect URL includes locationId when state had one', async () => {
    const { issueOAuthState } = await import('../../src/lib/oauth-state.js');
    const state = issueOAuthState('test-tenant-id', { locationId: 'loc-redirect' });

    const res = await request(app)
      .get('/api/qbo/callback')
      .query({ code: 'c', realmId: 'r', state });

    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('locationId=loc-redirect');
    expect(res.headers.location).toContain('provider=qbo');
    expect(res.headers.location).toContain('success=true');
  });
});
