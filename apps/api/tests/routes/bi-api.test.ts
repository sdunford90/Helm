import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createHash } from 'node:crypto';

// Real AsyncLocalStorage + a fake Prisma that records the tenant context each
// query ran under.
const h = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { AsyncLocalStorage } = require('node:async_hooks');
  const tenantStore = new AsyncLocalStorage();
  const seen: { ctxTenant?: string; whereTenant?: string }[] = [];
  const keyHash = (k: string) => require('node:crypto').createHash('sha256').update(k).digest('hex');
  const prisma = {
    tenant: {
      findFirst: vi.fn(async () => ({ id: 'tenant-victim', name: 'Victim', subdomain: 'victim' })),
    },
    apiKey: {
      findFirst: vi.fn(async ({ where }: any) =>
        where.keyHash === keyHash('helm_key_for_tenant_a')
          ? { id: 'k1', tenantId: 'tenant-a', scope: 'TENANT', revokedAt: null }
          : null,
      ),
      update: vi.fn(async () => ({})),
    },
    customer: {
      findMany: vi.fn(async ({ where }: any) => {
        seen.push({ ctxTenant: tenantStore.getStore()?.tenantId, whereTenant: where.tenantId });
        return [];
      }),
      count: vi.fn(async () => 0),
    },
  };
  return { tenantStore, prisma, seen };
});

vi.mock('../../src/lib/prisma.js', () => ({ prisma: h.prisma, tenantStore: h.tenantStore }));

type TenantModule = typeof import('../../src/middleware/tenant.js');
const { tenantMiddleware, shouldBypassTenant } = await vi.importActual<TenantModule>(
  '../../src/middleware/tenant.js',
);
const { default: biRouter } = await import('../../src/routes/bi-api.js');

function app() {
  const a = express();
  a.use(tenantMiddleware);
  a.use('/api/bi', biRouter);
  return a;
}

beforeEach(() => {
  h.seen.length = 0;
  h.prisma.tenant.findFirst.mockClear();
});

describe('BI API tenant isolation', () => {
  it('/api/bi bypasses Host-based tenant resolution', () => {
    expect(shouldBypassTenant('/api/bi/customers')).toBe(true);
    expect(shouldBypassTenant('/api/bin')).toBe(false);
  });

  it("scopes every query to the API key's tenant, whatever the Host header says", async () => {
    const res = await request(app())
      .get('/api/bi/customers')
      .set('Host', 'victim.gethelm.com')
      .set('Authorization', 'Bearer helm_key_for_tenant_a');

    expect(res.status).toBe(200);
    expect(h.prisma.tenant.findFirst).not.toHaveBeenCalled();
    expect(h.seen).toEqual([{ ctxTenant: 'tenant-a', whereTenant: 'tenant-a' }]);
  });

  it('rejects unknown keys', async () => {
    const res = await request(app())
      .get('/api/bi/customers')
      .set('Authorization', `Bearer helm_${createHash('sha256').update('x').digest('hex')}`);
    expect(res.status).toBe(401);
    expect(h.seen).toHaveLength(0);
  });
});
