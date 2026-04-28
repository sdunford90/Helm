import { describe, it, expect, beforeAll } from 'vitest';

beforeAll(() => {
  process.env.APP_SECRET = 'test-secret-for-oauth-state-e2e';
});

describe('issueOAuthState / verifyOAuthState', () => {
  it('round-trips tenantId and locationId through sign/verify', async () => {
    const { issueOAuthState, verifyOAuthState } = await import('../../src/lib/oauth-state.js');

    const tenantId = 'tenant-abc';
    const locationId = 'loc-xyz';

    const token = issueOAuthState(tenantId, { locationId });
    const verified = verifyOAuthState(token);

    expect(verified.tenantId).toBe(tenantId);
    expect(verified.locationId).toBe(locationId);
    expect(typeof verified.nonce).toBe('string');
    expect(verified.nonce).toBeTruthy();
    expect(verified.expiresAt).toBeInstanceOf(Date);
    expect(verified.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('returns undefined locationId when none was issued', async () => {
    const { issueOAuthState, verifyOAuthState } = await import('../../src/lib/oauth-state.js');

    const token = issueOAuthState('tenant-abc');
    const verified = verifyOAuthState(token);

    expect(verified.tenantId).toBe('tenant-abc');
    expect(verified.locationId).toBeUndefined();
  });

  it('each call produces a distinct nonce', async () => {
    const { issueOAuthState, verifyOAuthState } = await import('../../src/lib/oauth-state.js');

    const t1 = issueOAuthState('tenant-abc', { locationId: 'loc-1' });
    const t2 = issueOAuthState('tenant-abc', { locationId: 'loc-1' });

    const v1 = verifyOAuthState(t1);
    const v2 = verifyOAuthState(t2);

    expect(v1.nonce).not.toBe(v2.nonce);
  });

  it('rejects a tampered token', async () => {
    const { issueOAuthState, verifyOAuthState } = await import('../../src/lib/oauth-state.js');

    const token = issueOAuthState('tenant-abc', { locationId: 'loc-xyz' });
    const [body, sig] = token.split('.');
    const tampered = `${body}.${sig.slice(0, -3)}xxx`;

    expect(() => verifyOAuthState(tampered)).toThrow('Invalid state signature');
  });

  it('rejects a token with only one segment', async () => {
    const { verifyOAuthState } = await import('../../src/lib/oauth-state.js');

    expect(() => verifyOAuthState('invalidsinglepart')).toThrow('Invalid state token format');
  });
});
