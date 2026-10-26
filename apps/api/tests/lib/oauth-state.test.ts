import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import crypto from 'node:crypto';

// In-memory fake for the two tables the OAuth state code touches.
const db = vi.hoisted(() => {
  const states = new Map<string, any>();
  const users: any[] = [];
  return {
    states,
    users,
    prisma: {
      oAuthState: {
        create: async ({ data }: any) => {
          const row = { id: `st_${states.size + 1}_${Math.random()}`, createdAt: new Date(), ...data };
          states.set(row.id, row);
          return row;
        },
        findUnique: async ({ where }: any) =>
          [...states.values()].find((r) => r.stateHash === where.stateHash) ?? null,
        deleteMany: async ({ where }: any) => {
          let count = 0;
          for (const [id, r] of states) {
            const match = where.id ? r.id === where.id : where.expiresAt ? r.expiresAt < where.expiresAt.lt : false;
            if (match) {
              states.delete(id);
              count++;
            }
          }
          return { count };
        },
      },
      user: {
        findFirst: async ({ where }: any) =>
          users.find(
            (u) =>
              u.id === where.id &&
              u.tenantId === where.tenantId &&
              u.active === where.active &&
              u.role === where.role,
          ) ?? null,
      },
    },
  };
});

vi.mock('../../src/lib/prisma.js', () => ({
  prisma: db.prisma,
  tenantStore: { run: (_ctx: any, fn: any) => fn(), exit: (fn: any) => fn() },
}));

const qboSync = vi.hoisted(() => ({
  handleCallback: vi.fn().mockResolvedValue(undefined),
  handleQboWebhook: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../src/services/qbo-sync.js', () => ({
  ...qboSync,
  syncAll: vi.fn(),
  syncCustomer: vi.fn(),
  syncInvoice: vi.fn(),
  getStatus: vi.fn(),
  disconnect: vi.fn(),
}));

import {
  createOAuthState,
  consumeOAuthState,
  OAUTH_STATE_TTL_MS,
} from '../../src/lib/oauth-state.js';
import qboRouter, { verifyIntuitSignature } from '../../src/routes/qbo.js';

const binding = { tenantId: 'tenant-a', userId: 'owner-a' };

beforeEach(() => {
  db.states.clear();
  db.users.length = 0;
  db.users.push({ id: 'owner-a', tenantId: 'tenant-a', active: true, role: 'MARINA_OWNER' });
  qboSync.handleCallback.mockClear();
  qboSync.handleQboWebhook.mockClear();
  vi.useRealTimers();
});

describe('OAuth state', () => {
  it('is a random nonce that does not contain the tenant id, stored only as a hash', async () => {
    const state = await createOAuthState('qbo', binding);
    expect(state).not.toContain('tenant-a');
    expect(state.length).toBeGreaterThanOrEqual(40);
    const [row] = [...db.states.values()];
    expect(row.stateHash).not.toBe(state);
    expect(row.stateHash).toBe(crypto.createHash('sha256').update(state).digest('hex'));
    expect(row).toMatchObject({ tenantId: 'tenant-a', userId: 'owner-a', provider: 'qbo' });
  });

  it('verifies and returns the server-side binding', async () => {
    const state = await createOAuthState('stripe_connect', binding);
    await expect(consumeOAuthState('stripe_connect', state)).resolves.toEqual(binding);
  });

  it('is single-use (replay rejected)', async () => {
    const state = await createOAuthState('qbo', binding);
    expect(await consumeOAuthState('qbo', state)).toEqual(binding);
    expect(await consumeOAuthState('qbo', state)).toBeNull();
  });

  it('rejects unknown, tampered, malformed and tenant-id states', async () => {
    const state = await createOAuthState('qbo', binding);
    expect(await consumeOAuthState('qbo', `${state.slice(0, -1)}x`)).toBeNull();
    expect(await consumeOAuthState('qbo', 'tenant-a')).toBeNull();
    expect(await consumeOAuthState('qbo', `tenant-a:${'a'.repeat(64)}`)).toBeNull();
    expect(await consumeOAuthState('qbo', undefined)).toBeNull();
    expect(await consumeOAuthState('qbo', ['x'])).toBeNull();
  });

  it('rejects a state issued for another provider (and burns it)', async () => {
    const state = await createOAuthState('qbo', binding);
    expect(await consumeOAuthState('stripe_connect', state)).toBeNull();
    expect(await consumeOAuthState('qbo', state)).toBeNull();
  });

  it('rejects expired states', async () => {
    vi.useFakeTimers();
    const state = await createOAuthState('qbo', binding);
    vi.setSystemTime(Date.now() + OAUTH_STATE_TTL_MS + 1000);
    expect(await consumeOAuthState('qbo', state)).toBeNull();
  });
});

describe('GET /api/qbo/callback', () => {
  function app() {
    const a = express();
    a.use('/api/qbo', qboRouter);
    return a;
  }

  it('connects the tenant bound to the state, ignoring any tenant in the URL', async () => {
    const state = await createOAuthState('qbo', binding);
    const res = await request(app()).get('/api/qbo/callback').query({
      code: 'auth-code',
      realmId: 'realm-1',
      state,
      tenantId: 'tenant-victim',
    });
    expect(res.status).toBe(200);
    expect(qboSync.handleCallback).toHaveBeenCalledWith('auth-code', 'realm-1', 'tenant-a');
  });

  it('rejects a callback with a forged state (no user auth needed to reach it)', async () => {
    const res = await request(app())
      .get('/api/qbo/callback')
      .query({ code: 'c', realmId: 'r', state: 'tenant-victim:deadbeef' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_STATE');
    expect(qboSync.handleCallback).not.toHaveBeenCalled();
  });

  it('rejects when the user who started the flow is no longer an active owner', async () => {
    const state = await createOAuthState('qbo', binding);
    db.users[0].active = false;
    const res = await request(app()).get('/api/qbo/callback').query({ code: 'c', realmId: 'r', state });
    expect(res.status).toBe(403);
    expect(qboSync.handleCallback).not.toHaveBeenCalled();
  });
});

describe('QBO webhook signature', () => {
  const token = 'verifier-token';
  const body = Buffer.from('{"eventNotifications":[{"realmId":"1"}]}');
  const sign = (b: Buffer, t = token) => crypto.createHmac('sha256', t).update(b).digest('base64');

  it('accepts a valid HMAC over the raw body', () => {
    expect(verifyIntuitSignature(body, sign(body), token)).toBe(true);
  });

  it('rejects bad signatures, re-serialised bodies and missing inputs', () => {
    expect(verifyIntuitSignature(body, sign(body, 'other'), token)).toBe(false);
    expect(verifyIntuitSignature(Buffer.from(`${body} `), sign(body), token)).toBe(false);
    expect(verifyIntuitSignature(body, undefined, token)).toBe(false);
    expect(verifyIntuitSignature(body, 'short', token)).toBe(false);
  });

  it('refuses everything when the verifier token is unset', () => {
    expect(verifyIntuitSignature(body, sign(body), undefined)).toBe(false);
  });

  it('webhook route: 503 without token, 401 on bad sig, 200 on good sig (raw body)', async () => {
    const a = express();
    a.use('/api/qbo/webhook', express.raw({ type: '*/*' }));
    a.use('/api/qbo', qboRouter);

    const saved = process.env.QBO_WEBHOOK_VERIFIER_TOKEN;
    delete process.env.QBO_WEBHOOK_VERIFIER_TOKEN;
    const r1 = await request(a)
      .post('/api/qbo/webhook')
      .set('content-type', 'application/json')
      .set('intuit-signature', sign(body))
      .send(body.toString("utf8"));
    expect(r1.status).toBe(503);

    process.env.QBO_WEBHOOK_VERIFIER_TOKEN = token;
    const r2 = await request(a)
      .post('/api/qbo/webhook')
      .set('content-type', 'application/json')
      .set('intuit-signature', sign(body, 'wrong'))
      .send(body.toString("utf8"));
    expect(r2.status).toBe(401);

    const r3 = await request(a)
      .post('/api/qbo/webhook')
      .set('content-type', 'application/json')
      .set('intuit-signature', sign(body))
      .send(body.toString("utf8"));
    expect(r3.status).toBe(200);
    expect(qboSync.handleQboWebhook).toHaveBeenCalledTimes(1);

    if (saved === undefined) delete process.env.QBO_WEBHOOK_VERIFIER_TOKEN;
    else process.env.QBO_WEBHOOK_VERIFIER_TOKEN = saved;
  });
});
