import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createTestApp } from '../helpers.js';
import { mockPrisma } from '../setup.js';
import { queues } from '../../src/lib/queue.js';

const qboSyncQueue = queues['qbo-sync'] as { add: ReturnType<typeof vi.fn> };

let app: Express;

beforeAll(async () => {
  app = await createTestApp();
});

beforeEach(() => {
  vi.clearAllMocks();
  // Reset all prisma mocks back to default vi.fn() state.
  Object.values(mockPrisma).forEach((model) => {
    if (typeof model === 'object' && model !== null) {
      Object.values(model).forEach((fn) => {
        if (typeof fn === 'function' && 'mockReset' in fn) {
          (fn as any).mockReset();
        }
      });
    }
  });
  qboSyncQueue.add.mockReset();
  qboSyncQueue.add.mockResolvedValue({ id: 'job-1' } as any);
});

// ---------------------------------------------------------------------------
// POST /api/accounting/sync-health/sync-all-unsynced
// ---------------------------------------------------------------------------
//
// The bulk re-sync endpoint loops over every unsynced ISSUED/PAID invoice
// for the tenant, gates each on per-location QBO connection (with a tenant
// fallback), and enqueues a `sync-invoice` job per connected one. The
// response shape `{ enqueued, skipped, total }` drives the UI's "X queued,
// Y skipped" toast in the Failed Syncs panel.
describe('POST /api/accounting/sync-health/sync-all-unsynced', () => {
  function setLocationConnected(locationId: string, connected: boolean) {
    // isLocationQboConnected reads location.findUnique({ select: { qboAccessToken, qboRealmId }})
    // and returns true iff both are set. We thread the per-location
    // result through findUnique's per-call mock so a single test can
    // express different connection states for different locations.
    mockPrisma.location.findUnique.mockImplementationOnce(({ where }: any) => {
      if (where?.id !== locationId) {
        return Promise.resolve(null);
      }
      return Promise.resolve(
        connected
          ? { qboAccessToken: 'tok', qboRealmId: 'realm' }
          : { qboAccessToken: null, qboRealmId: null },
      );
    });
  }

  it('returns enqueued/skipped/total split correctly for mixed connected and disconnected locations', async () => {
    // Three invoices: one at a connected location, one at a
    // disconnected location, one with NO location at all (which should
    // try the tenant-level fallback). The tenant has no realmId, so the
    // disconnected and no-location ones must be counted as skipped.
    mockPrisma.invoice.findMany.mockResolvedValue([
      { id: 'inv-connected', locationId: 'loc-A' },
      { id: 'inv-disconnected', locationId: 'loc-B' },
      { id: 'inv-no-location', locationId: null },
    ] as any);

    setLocationConnected('loc-A', true);
    setLocationConnected('loc-B', false);
    // Tenant fallback returns no realmId — "no QBO connection anywhere".
    mockPrisma.tenant.findUnique.mockResolvedValue({ qboRealmId: null } as any);

    const res = await request(app)
      .post('/api/accounting/sync-health/sync-all-unsynced')
      .send({});

    expect(res.status).toBe(200);
    expect(res.body).toEqual(
      expect.objectContaining({
        enqueued: 1,
        skipped: 2,
        skippedNoConnection: 2,
        enqueueFailed: 0,
        total: 3,
      }),
    );
    expect(qboSyncQueue.add).toHaveBeenCalledTimes(1);
    expect(qboSyncQueue.add).toHaveBeenCalledWith(
      'sync-invoice',
      { tenantId: 'test-tenant-id', invoiceId: 'inv-connected' },
    );
  });

  it('uses the tenant-level qboRealmId fallback to enqueue invoices on disconnected locations', async () => {
    // Two invoices both on disconnected locations, but the tenant DOES
    // have a realmId pinned. Both should be enqueued through the
    // fallback. (Multi-location marinas with one shared QBO realm rely
    // on this branch.)
    mockPrisma.invoice.findMany.mockResolvedValue([
      { id: 'inv-1', locationId: 'loc-X' },
      { id: 'inv-2', locationId: 'loc-Y' },
    ] as any);
    setLocationConnected('loc-X', false);
    setLocationConnected('loc-Y', false);
    mockPrisma.tenant.findUnique.mockResolvedValue({ qboRealmId: 'realm-tenant' } as any);

    const res = await request(app)
      .post('/api/accounting/sync-health/sync-all-unsynced')
      .send({});

    expect(res.status).toBe(200);
    expect(res.body).toEqual(
      expect.objectContaining({ enqueued: 2, skipped: 0, total: 2 }),
    );
    expect(qboSyncQueue.add).toHaveBeenCalledTimes(2);
    // Tenant-level lookup must only fire once even though two invoices
    // need the fallback — the route caches the tenant connection state.
    expect(mockPrisma.tenant.findUnique).toHaveBeenCalledTimes(1);
  });

  it('returns zeros when there are no unsynced invoices', async () => {
    mockPrisma.invoice.findMany.mockResolvedValue([]);

    const res = await request(app)
      .post('/api/accounting/sync-health/sync-all-unsynced')
      .send({});

    expect(res.status).toBe(200);
    expect(res.body).toEqual(
      expect.objectContaining({ enqueued: 0, skipped: 0, total: 0 }),
    );
    expect(qboSyncQueue.add).not.toHaveBeenCalled();
  });

  it('only selects invoices with status IN ("ISSUED","PAID") and qboInvoiceId IS NULL, scoped to the caller tenant', async () => {
    // Pin the where-clause shape so a future change can't accidentally
    // start enqueuing draft invoices or invoices already synced — both
    // would silently corrupt QBO from the bulk button.
    mockPrisma.invoice.findMany.mockResolvedValue([]);

    await request(app)
      .post('/api/accounting/sync-health/sync-all-unsynced')
      .send({});

    expect(mockPrisma.invoice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: 'test-tenant-id',
          qboInvoiceId: null,
          status: { in: ['ISSUED', 'PAID'] },
        }),
      }),
    );
  });

  it('counts enqueue failures separately from connection skips and still returns 200', async () => {
    // Both invoices are on connected locations so neither would be a
    // "skippedNoConnection" — but Redis explodes for the second one.
    // The route MUST keep going, surface the failure via enqueueFailed,
    // and still return 200 so the operator gets a usable summary.
    mockPrisma.invoice.findMany.mockResolvedValue([
      { id: 'inv-ok', locationId: 'loc-A' },
      { id: 'inv-redis-down', locationId: 'loc-A' },
    ] as any);
    setLocationConnected('loc-A', true);
    // Note: the route caches per-location lookup, so loc-A is only
    // resolved once even though there are two invoices on it.

    qboSyncQueue.add
      .mockResolvedValueOnce({ id: 'job-1' } as any)
      .mockRejectedValueOnce(new Error('redis down'));
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await request(app)
      .post('/api/accounting/sync-health/sync-all-unsynced')
      .send({});

    expect(res.status).toBe(200);
    expect(res.body).toEqual(
      expect.objectContaining({
        enqueued: 1,
        enqueueFailed: 1,
        skippedNoConnection: 0,
        // Aggregate "skipped" must roll up enqueueFailed too — that's
        // what the UI shows the operator.
        skipped: 1,
        total: 2,
      }),
    );
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Role-gating parity with /sync-health/retry
// ---------------------------------------------------------------------------
//
// Both endpoints sit behind the same Failed Syncs panel and operators
// expect the same access policy: any role allowed to retry a single
// invoice should also be allowed to bulk-retry all of them. requireRole
// is mocked through to a no-op in tests/setup.ts, so the role list isn't
// observable at runtime — pin it at the source level instead so a
// future drift between the two routes fails this test loudly.
describe('Role-gating parity: sync-all-unsynced vs sync-health/retry', () => {
  it('declares the exact same requireRole(...) list as /sync-health/retry', async () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const accountingPath = resolve(here, '../../src/routes/accounting.ts');
    const src = await readFile(accountingPath, 'utf-8');

    // Each route's requireRole(...) call sits between the route path
    // and the async handler. Anchor on the route path string so the
    // match is unambiguous, and capture the full role list verbatim.
    const retryMatch = src.match(
      /"\/sync-health\/retry"[\s\S]*?requireRole\(([^)]*)\)/,
    );
    const bulkMatch = src.match(
      /"\/sync-health\/sync-all-unsynced"[\s\S]*?requireRole\(([^)]*)\)/,
    );

    expect(retryMatch).not.toBeNull();
    expect(bulkMatch).not.toBeNull();

    const retryRoles = retryMatch![1].replace(/\s+/g, '');
    const bulkRoles = bulkMatch![1].replace(/\s+/g, '');
    expect(bulkRoles).toBe(retryRoles);
    // Sanity: the role list isn't empty (e.g. requireRole() with no args
    // would technically match but would expose the bulk endpoint to
    // every authenticated user).
    expect(retryRoles.length).toBeGreaterThan(0);
  });
});
