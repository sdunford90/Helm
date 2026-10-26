import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { mockPrisma } from '../setup';

// tests/setup.ts mocks the auth middleware globally (every route test runs as
// an "admin"). Here we exercise the REAL middleware, with Clerk replaced by a
// controllable fake.
const clerkState: { userId: string | null } = { userId: 'clerk_user_1' };
vi.mock('@clerk/express', () => ({
  clerkMiddleware: () => (_req: any, _res: any, next: any) => next(),
  getAuth: () => ({ userId: clerkState.userId }),
  requireAuth: () => (_req: any, _res: any, next: any) => next(),
}));

type AuthModule = typeof import('../../src/middleware/auth.js');
let auth: AuthModule;

const userFindFirst = vi.fn();

function buildApp(...chain: any[]) {
  const app = express();
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.tenantId = 'tenant-a';
    next();
  });
  app.get('/staff', ...chain, (req: Request, res: Response) => {
    res.json({ userId: req.userId, role: req.userRole });
  });
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ error: err.message });
  });
  return app;
}

function user(overrides: Record<string, unknown> = {}) {
  return {
    id: 'u1',
    tenantId: 'tenant-a',
    clerkUserId: 'clerk_user_1',
    email: 'u1@test.com',
    role: 'MARINA_MANAGER',
    active: true,
    ...overrides,
  };
}

const savedEnv = { ...process.env };

beforeEach(async () => {
  auth = await vi.importActual<AuthModule>('../../src/middleware/auth.js');
  (mockPrisma.user as any).findFirst = userFindFirst;
  userFindFirst.mockReset();
  clerkState.userId = 'clerk_user_1';
  process.env.CLERK_SECRET_KEY = 'sk_test_x';
  process.env.CLERK_PUBLISHABLE_KEY = 'pk_test_x';
  delete process.env.HELM_DEV_AUTH_BYPASS;
  process.env.NODE_ENV = 'test';
});

afterEach(() => {
  process.env = { ...savedEnv };
});

describe('clerkAuth — fail closed', () => {
  it('returns 401 JSON (no redirect) when there is no Clerk session', async () => {
    clerkState.userId = null;
    const res = await request(buildApp(...auth.clerkAuth())).get('/staff');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHORIZED');
    expect(userFindFirst).not.toHaveBeenCalled();
  });

  it('does NOT bypass auth just because NODE_ENV is not production', async () => {
    clerkState.userId = null;
    process.env.NODE_ENV = 'development';
    const res = await request(buildApp(...auth.clerkAuth())).get('/staff');
    expect(res.status).toBe(401);
  });

  it('returns 401 when Clerk is not configured (instead of letting requests through)', async () => {
    delete process.env.CLERK_SECRET_KEY;
    const res = await request(buildApp(...auth.clerkAuth())).get('/staff');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('AUTH_NOT_CONFIGURED');
  });

  it('refuses the dev bypass when NODE_ENV=production', async () => {
    process.env.NODE_ENV = 'production';
    process.env.HELM_DEV_AUTH_BYPASS = 'true';
    userFindFirst.mockResolvedValue(user({ role: 'MARINA_OWNER' }));
    const res = await request(buildApp(...auth.clerkAuth())).get('/staff');
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/HELM_DEV_AUTH_BYPASS/);
    expect(res.body.userId).toBeUndefined();
  });

  it('allows the explicit dev bypass outside production', async () => {
    process.env.NODE_ENV = 'development';
    process.env.HELM_DEV_AUTH_BYPASS = 'true';
    clerkState.userId = null;
    userFindFirst.mockResolvedValue(user({ role: 'MARINA_OWNER' }));
    const res = await request(buildApp(...auth.clerkAuth())).get('/staff');
    expect(res.status).toBe(200);
    expect(res.body.role).toBe('MARINA_OWNER');
  });
});

describe('clerkAuth — user checks', () => {
  it('accepts an active staff user of the tenant', async () => {
    userFindFirst.mockResolvedValue(user());
    const res = await request(buildApp(...auth.clerkAuth())).get('/staff');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ userId: 'u1', role: 'MARINA_MANAGER' });
    expect(userFindFirst).toHaveBeenCalledWith({
      where: { clerkUserId: 'clerk_user_1', tenantId: 'tenant-a' },
    });
  });

  it('rejects a user that is not a member of the tenant', async () => {
    userFindFirst.mockResolvedValue(null);
    const res = await request(buildApp(...auth.clerkAuth())).get('/staff');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('TENANT_MISMATCH');
  });

  it('rejects inactive (deactivated) users', async () => {
    userFindFirst.mockResolvedValue(user({ active: false }));
    const res = await request(buildApp(...auth.clerkAuth())).get('/staff');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('USER_INACTIVE');
  });

  it('rejects PORTAL_USER on staff routes', async () => {
    userFindFirst.mockResolvedValue(user({ role: 'PORTAL_USER' }));
    const res = await request(buildApp(...auth.clerkAuth())).get('/staff');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('STAFF_ONLY');
  });
});

describe('requireRole', () => {
  it('allows listed enum roles and rejects others', async () => {
    userFindFirst.mockResolvedValue(user({ role: 'DOCK_STAFF' }));
    const denied = await request(
      buildApp(...auth.clerkAuth(), auth.requireRole('MARINA_OWNER', 'MARINA_MANAGER')),
    ).get('/staff');
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe('FORBIDDEN');

    userFindFirst.mockResolvedValue(user({ role: 'ACCOUNTING' }));
    const allowed = await request(
      buildApp(...auth.clerkAuth(), auth.requireRole(...auth.FINANCE_ROLES)),
    ).get('/staff');
    expect(allowed.status).toBe(200);
  });

  it('is typed: lowercase role strings do not compile', () => {
    const apiRoot = path.resolve(__dirname, '../..');
    const tsc = path.join(apiRoot, 'node_modules/.bin/tsc');
    // Throws (non-zero exit) if the fixture's @ts-expect-error lines are unused.
    expect(() =>
      execFileSync(tsc, ['--noEmit', '-p', 'tests/types/tsconfig.json'], {
        cwd: apiRoot,
        stdio: 'pipe',
      }),
    ).not.toThrow();
  }, 60_000);
});

describe('requirePlatformAdmin', () => {
  function adminApp() {
    const app = express();
    app.get('/admin', ...auth.requirePlatformAdmin(), (req: Request, res: Response) => {
      res.json({ role: req.userRole });
    });
    return app;
  }

  it('queries clerkUserId + PLATFORM_ADMIN + active', async () => {
    userFindFirst.mockResolvedValue(user({ role: 'PLATFORM_ADMIN' }));
    const res = await request(adminApp()).get('/admin');
    expect(res.status).toBe(200);
    expect(userFindFirst).toHaveBeenCalledWith({
      where: { clerkUserId: 'clerk_user_1', role: 'PLATFORM_ADMIN', active: true },
    });
  });

  it('403s when the user is not a platform admin', async () => {
    userFindFirst.mockResolvedValue(null);
    const res = await request(adminApp()).get('/admin');
    expect(res.status).toBe(403);
  });

  it('401s without a session', async () => {
    clerkState.userId = null;
    const res = await request(adminApp()).get('/admin');
    expect(res.status).toBe(401);
  });
});
