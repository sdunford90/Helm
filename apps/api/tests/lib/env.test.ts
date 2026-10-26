import { describe, it, expect, afterEach } from 'vitest';
import { validateEnv, isDevAuthBypassEnabled, EnvError, buildCorsOptions } from '../../src/lib/env.js';

const PROD_REQUIRED = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://x@y/z',
  CLERK_SECRET_KEY: 'sk_live_x',
  CLERK_PUBLISHABLE_KEY: 'pk_live_x',
};

describe('validateEnv', () => {
  it('accepts a complete production config', () => {
    const env = validateEnv(PROD_REQUIRED);
    expect(env.NODE_ENV).toBe('production');
    expect(env.HELM_DEV_AUTH_BYPASS).toBe(false);
  });

  it('fails fast when production is missing required vars', () => {
    expect(() => validateEnv({ NODE_ENV: 'production' })).toThrow(EnvError);
    try {
      validateEnv({ NODE_ENV: 'production', DATABASE_URL: 'x' });
    } catch (err) {
      const msg = (err as Error).message;
      expect(msg).toContain('CLERK_SECRET_KEY');
      expect(msg).toContain('CLERK_PUBLISHABLE_KEY');
      expect(msg).not.toContain('DATABASE_URL is required');
    }
  });

  it('treats empty strings as missing', () => {
    expect(() => validateEnv({ ...PROD_REQUIRED, CLERK_SECRET_KEY: '' })).toThrow(/CLERK_SECRET_KEY/);
  });

  it('refuses HELM_DEV_AUTH_BYPASS in production', () => {
    expect(() => validateEnv({ ...PROD_REQUIRED, HELM_DEV_AUTH_BYPASS: 'true' })).toThrow(
      /HELM_DEV_AUTH_BYPASS/,
    );
  });

  it('does not require Clerk/DB outside production and allows the dev bypass', () => {
    const env = validateEnv({ NODE_ENV: 'development', HELM_DEV_AUTH_BYPASS: 'true' });
    expect(env.HELM_DEV_AUTH_BYPASS).toBe(true);
  });

  it('keeps Stripe/QBO optional in production', () => {
    const env = validateEnv(PROD_REQUIRED);
    expect(env.STRIPE_SECRET_KEY).toBeUndefined();
    expect(env.QBO_CLIENT_ID).toBeUndefined();
  });
});

describe('buildCorsOptions', () => {
  const check = (opts: ReturnType<typeof buildCorsOptions>, origin: string | undefined) =>
    new Promise<boolean | undefined>((resolve) => {
      if (typeof opts.origin === 'boolean') return resolve(opts.origin);
      opts.origin(origin, (_e, allow) => resolve(allow));
    });

  it('allows only configured origins', async () => {
    const opts = buildCorsOptions(['https://app.gethelm.com', 'https://admin.gethelm.com/'], false);
    expect(await check(opts, 'https://app.gethelm.com')).toBe(true);
    expect(await check(opts, 'https://admin.gethelm.com')).toBe(true);
    expect(await check(opts, 'https://evil.example')).toBe(false);
  });

  it('allows no cross-origin access when unconfigured (unless dev bypass)', async () => {
    expect(await check(buildCorsOptions([], false), 'https://evil.example')).toBe(false);
    expect(await check(buildCorsOptions([], true), 'https://anything.local')).toBe(true);
  });
});

describe('isDevAuthBypassEnabled', () => {
  const saved = { NODE_ENV: process.env.NODE_ENV, flag: process.env.HELM_DEV_AUTH_BYPASS };
  afterEach(() => {
    process.env.NODE_ENV = saved.NODE_ENV;
    if (saved.flag === undefined) delete process.env.HELM_DEV_AUTH_BYPASS;
    else process.env.HELM_DEV_AUTH_BYPASS = saved.flag;
  });

  it('is off unless the flag is explicitly set (NODE_ENV alone never disables auth)', () => {
    delete process.env.HELM_DEV_AUTH_BYPASS;
    process.env.NODE_ENV = 'development';
    expect(isDevAuthBypassEnabled()).toBe(false);
    process.env.NODE_ENV = '';
    expect(isDevAuthBypassEnabled()).toBe(false);
  });

  it('is on with the flag outside production', () => {
    process.env.HELM_DEV_AUTH_BYPASS = 'true';
    process.env.NODE_ENV = 'development';
    expect(isDevAuthBypassEnabled()).toBe(true);
  });

  it('throws (refuses) with the flag in production', () => {
    process.env.HELM_DEV_AUTH_BYPASS = 'true';
    process.env.NODE_ENV = 'production';
    expect(() => isDevAuthBypassEnabled()).toThrow(EnvError);
  });
});
