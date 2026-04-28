import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest';
import request from 'supertest';
import crypto from 'node:crypto';

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
  handleQboWebhook,
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

describe('POST /api/qbo/webhook — Intuit delivery (no Clerk session)', () => {
  const VERIFIER = 'test-qbo-verifier-token';

  function sign(payload: unknown): string {
    return crypto
      .createHmac('sha256', VERIFIER)
      .update(JSON.stringify(payload))
      .digest('base64');
  }

  beforeEach(() => {
    process.env.QBO_WEBHOOK_VERIFIER_TOKEN = VERIFIER;
  });

  it('accepts a properly-signed Intuit delivery without any auth header and dispatches to the handler', async () => {
    const payload = {
      eventNotifications: [
        {
          realmId: '9341454319936129',
          dataChangeEvent: {
            entities: [
              { name: 'Customer', id: '123', operation: 'Update', lastUpdated: '2026-04-28T12:00:00Z' },
            ],
          },
        },
      ],
    };

    const res = await request(app)
      .post('/api/qbo/webhook')
      .set('intuit-signature', sign(payload))
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    // Crucially: the request carried no Clerk session and no marina subdomain,
    // and we still reached the handler. This is what Intuit deliveries look like.
    expect(vi.mocked(handleQboWebhook)).toHaveBeenCalledOnce();
    expect(vi.mocked(handleQboWebhook)).toHaveBeenCalledWith(payload);
  });

  it('responds 200 to Intuit before the entity processing finishes', async () => {
    // Intuit retries on slow deliveries. Make handleQboWebhook hang and
    // assert the route still returns 200 quickly without awaiting it.
    let resolveHandler: (() => void) | undefined;
    const handlerStarted = new Promise<void>((startResolve) => {
      vi.mocked(handleQboWebhook).mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolveHandler = resolve;
            startResolve();
          }),
      );
    });

    const payload = {
      eventNotifications: [
        {
          realmId: 'realm-slow-sync',
          dataChangeEvent: {
            entities: [
              { name: 'Invoice', id: '999', operation: 'Update', lastUpdated: '2026-04-28T12:00:00Z' },
            ],
          },
        },
      ],
    };

    const res = await request(app)
      .post('/api/qbo/webhook')
      .set('intuit-signature', sign(payload))
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });

    // Handler was kicked off but is still pending — the response was returned
    // without awaiting it.
    await handlerStarted;
    expect(vi.mocked(handleQboWebhook)).toHaveBeenCalledOnce();
    expect(resolveHandler).toBeDefined();

    // Let the background processing finish so we don't leak the pending promise.
    resolveHandler?.();
  });

  it('still returns 200 to Intuit when background processing throws', async () => {
    // Errors from the deferred handler must not surface as 5xx — otherwise
    // Intuit will retry deliveries we already accepted.
    vi.mocked(handleQboWebhook).mockRejectedValueOnce(new Error('downstream QBO API failure'));
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const payload = {
      eventNotifications: [
        {
          realmId: 'realm-error',
          dataChangeEvent: { entities: [] },
        },
      ],
    };

    const res = await request(app)
      .post('/api/qbo/webhook')
      .set('intuit-signature', sign(payload))
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });

    // Wait a tick so the background promise rejection runs and is logged.
    await new Promise((resolve) => setImmediate(resolve));
    expect(vi.mocked(handleQboWebhook)).toHaveBeenCalledOnce();
    expect(consoleSpy).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it('rejects requests with a missing Intuit-Signature header', async () => {
    const res = await request(app)
      .post('/api/qbo/webhook')
      .send({ eventNotifications: [] });

    expect(res.status).toBe(401);
    expect(vi.mocked(handleQboWebhook)).not.toHaveBeenCalled();
  });

  it('rejects requests with a forged Intuit-Signature', async () => {
    const payload = { eventNotifications: [{ realmId: 'r', dataChangeEvent: { entities: [] } }] };
    const res = await request(app)
      .post('/api/qbo/webhook')
      .set('intuit-signature', 'not-a-real-signature')
      .send(payload);

    expect(res.status).toBe(401);
    expect(vi.mocked(handleQboWebhook)).not.toHaveBeenCalled();
  });

  it('refuses delivery when the verifier token is not configured', async () => {
    delete process.env.QBO_WEBHOOK_VERIFIER_TOKEN;

    const res = await request(app)
      .post('/api/qbo/webhook')
      .set('intuit-signature', 'anything')
      .send({ eventNotifications: [] });

    expect(res.status).toBe(500);
    expect(vi.mocked(handleQboWebhook)).not.toHaveBeenCalled();
  });
});
