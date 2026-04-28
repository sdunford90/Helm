import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockPrisma } from '../setup.js';

import {
  startQboInventoryResyncJob,
  getQboInventoryResyncJob,
  sweepStaleQboInventoryResyncJobs,
  _resetQboInventoryResyncJobs,
} from '../../src/services/qbo-inventory-resync-jobs.js';
import type { QboInventoryRetryResult, QboInventoryRetryProgress } from '../../src/routes/inventory.js';

const TENANT = 'test-tenant-id';

const detail = (
  overrides: Partial<QboInventoryRetryResult['details'][number]> = {},
): QboInventoryRetryResult['details'][number] => ({
  sourceType: 'product',
  sourceId: 'p-1',
  qboType: 'Item',
  status: 'succeeded',
  ...overrides,
});

// ---------------------------------------------------------------------------
// In-memory simulation of the two persisted tables. Wired into mockPrisma so
// the service runs through its real Prisma calls but state lives in JS Maps,
// keeping tests fast and self-contained.
//
// Crucially, the store is shared across "calls" inside a test, so we can also
// simulate the multi-replica / post-restart case where a different code path
// reads a job another path created.
// ---------------------------------------------------------------------------

interface JobRow {
  id: string;
  tenantId: string;
  status: string;
  total: number;
  processed: number;
  attempted: number;
  succeeded: number;
  failed: number;
  skipped: number;
  startedAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
  error: string | null;
}

interface DetailRow {
  id: string;
  jobId: string;
  sequence: number;
  sourceType: string;
  sourceId: string;
  qboType: string;
  status: string;
  error: string | null;
  createdAt: Date;
}

const jobsStore = new Map<string, JobRow>();
const detailsStore: DetailRow[] = [];
let idCounter = 0;
const nextId = (prefix: string) => `${prefix}-${++idCounter}`;

const matches = (row: any, where: Record<string, any>): boolean => {
  for (const [k, v] of Object.entries(where)) {
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      if ('lt' in v && !(row[k] instanceof Date && row[k] < v.lt)) return false;
      if ('not' in v && row[k] === v.not) return false;
      if ('in' in v && !v.in.includes(row[k])) return false;
    } else if (row[k] !== v) {
      return false;
    }
  }
  return true;
};

beforeEach(() => {
  jobsStore.clear();
  detailsStore.length = 0;
  idCounter = 0;
  vi.clearAllMocks();

  mockPrisma.qboInventoryResyncJob.create = vi.fn(async ({ data }: any) => {
    const now = new Date();
    const row: JobRow = {
      id: data.id ?? nextId('job'),
      tenantId: data.tenantId,
      status: data.status ?? 'running',
      total: data.total ?? 0,
      processed: data.processed ?? 0,
      attempted: data.attempted ?? 0,
      succeeded: data.succeeded ?? 0,
      failed: data.failed ?? 0,
      skipped: data.skipped ?? 0,
      startedAt: data.startedAt ?? now,
      updatedAt: data.updatedAt ?? now,
      completedAt: data.completedAt ?? null,
      error: data.error ?? null,
    };
    jobsStore.set(row.id, row);
    return row;
  });

  mockPrisma.qboInventoryResyncJob.update = vi.fn(async ({ where, data }: any) => {
    const row = jobsStore.get(where.id);
    if (!row) throw new Error(`No job ${where.id}`);
    Object.assign(row, data);
    if (!data.updatedAt) row.updatedAt = new Date();
    return row;
  });

  mockPrisma.qboInventoryResyncJob.updateMany = vi.fn(async ({ where, data }: any) => {
    let count = 0;
    for (const row of jobsStore.values()) {
      if (matches(row, where)) {
        Object.assign(row, data);
        count++;
      }
    }
    return { count };
  });

  mockPrisma.qboInventoryResyncJob.findFirst = vi.fn(async ({ where }: any) => {
    for (const row of jobsStore.values()) {
      if (matches(row, where)) return row;
    }
    return null;
  });

  mockPrisma.qboInventoryResyncJob.deleteMany = vi.fn(async ({ where }: any = {}) => {
    let count = 0;
    for (const [id, row] of jobsStore) {
      if (!where || matches(row, where)) {
        jobsStore.delete(id);
        count++;
      }
    }
    return { count };
  });

  mockPrisma.qboInventoryResyncJobDetail.create = vi.fn(async ({ data }: any) => {
    const row: DetailRow = {
      id: data.id ?? nextId('detail'),
      jobId: data.jobId,
      sequence: data.sequence,
      sourceType: data.sourceType,
      sourceId: data.sourceId,
      qboType: data.qboType,
      status: data.status,
      error: data.error ?? null,
      createdAt: new Date(),
    };
    detailsStore.push(row);
    return row;
  });

  mockPrisma.qboInventoryResyncJobDetail.findMany = vi.fn(async ({ where, orderBy }: any) => {
    const rows = detailsStore.filter((d) => d.jobId === where.jobId);
    if (orderBy?.sequence === 'asc') rows.sort((a, b) => a.sequence - b.sequence);
    return rows;
  });

  mockPrisma.qboInventoryResyncJobDetail.deleteMany = vi.fn(async () => {
    const count = detailsStore.length;
    detailsStore.length = 0;
    return { count };
  });
});

const settle = () => new Promise((r) => setTimeout(r, 10));

describe('startQboInventoryResyncJob', () => {
  it('persists a running job snapshot synchronously and isolates jobs by tenant', async () => {
    const runner = vi.fn(async (
      _tenantId: string,
      _opts: { dueOnly?: boolean; now?: Date } | undefined,
      _onProgress: QboInventoryRetryProgress | undefined,
    ): Promise<QboInventoryRetryResult> => {
      // Slow QBO call that doesn't complete before the caller polls.
      await new Promise((r) => setTimeout(r, 50));
      return { attempted: 0, succeeded: 0, failed: 0, skipped: 0, details: [] };
    });

    const job = await startQboInventoryResyncJob(TENANT, runner);

    expect(job.jobId).toBeTruthy();
    expect(job.status).toBe('running');
    expect(job.tenantId).toBe(TENANT);

    const fetched = await getQboInventoryResyncJob(job.jobId, TENANT);
    expect(fetched?.jobId).toBe(job.jobId);
    expect(fetched?.status).toBe('running');

    // Tenant isolation: another tenant cannot read the job.
    expect(await getQboInventoryResyncJob(job.jobId, 'other-tenant')).toBeUndefined();

    // Let the slow runner finish so its final write doesn't race the next test.
    await new Promise((r) => setTimeout(r, 80));
    await _resetQboInventoryResyncJobs();
  });

  it('records progress snapshots from onProgress callbacks during the run', async () => {
    let triggerNext: (() => void) | null = null;
    const runner = vi.fn(async (
      _tenantId: string,
      _opts: { dueOnly?: boolean; now?: Date } | undefined,
      onProgress: QboInventoryRetryProgress | undefined,
    ): Promise<QboInventoryRetryResult> => {
      onProgress?.({
        total: 3, processed: 1, attempted: 1, succeeded: 1, failed: 0, skipped: 0,
        lastDetail: detail({ sourceId: 'a' }),
      });
      await new Promise<void>((resolve) => { triggerNext = resolve; });
      onProgress?.({
        total: 3, processed: 2, attempted: 2, succeeded: 1, failed: 1, skipped: 0,
        lastDetail: detail({ sourceId: 'b', status: 'failed', error: 'boom' }),
      });
      onProgress?.({
        total: 3, processed: 3, attempted: 2, succeeded: 1, failed: 1, skipped: 1,
        lastDetail: detail({ sourceId: 'c', status: 'skipped', error: 'gone' }),
      });
      return {
        attempted: 2, succeeded: 1, failed: 1, skipped: 1,
        details: [
          detail({ sourceId: 'a' }),
          detail({ sourceId: 'b', status: 'failed', error: 'boom' }),
          detail({ sourceId: 'c', status: 'skipped', error: 'gone' }),
        ],
      };
    });

    const job = await startQboInventoryResyncJob(TENANT, runner);
    await settle();

    let snap = await getQboInventoryResyncJob(job.jobId, TENANT);
    expect(snap?.status).toBe('running');
    expect(snap?.total).toBe(3);
    expect(snap?.processed).toBe(1);
    expect(snap?.succeeded).toBe(1);
    expect(snap?.details.length).toBe(1);

    triggerNext?.();
    await settle();

    snap = await getQboInventoryResyncJob(job.jobId, TENANT);
    expect(snap?.status).toBe('succeeded');
    expect(snap?.processed).toBe(3);
    expect(snap?.attempted).toBe(2);
    expect(snap?.succeeded).toBe(1);
    expect(snap?.failed).toBe(1);
    expect(snap?.skipped).toBe(1);
    expect(snap?.details).toHaveLength(3);
    expect(snap?.completedAt).not.toBeNull();

    await _resetQboInventoryResyncJobs();
  });

  it('marks the job failed when the retry loop throws', async () => {
    const runner = vi.fn(async (): Promise<QboInventoryRetryResult> => {
      throw new Error('QBO down');
    });

    const job = await startQboInventoryResyncJob(TENANT, runner);
    await settle();

    const snap = await getQboInventoryResyncJob(job.jobId, TENANT);
    expect(snap?.status).toBe('failed');
    expect(snap?.error).toBe('QBO down');
    expect(snap?.completedAt).not.toBeNull();

    await _resetQboInventoryResyncJobs();
  });

  it('handles a zero-failure run (loop never emits progress) by reconciling counts on completion', async () => {
    const runner = vi.fn(async (): Promise<QboInventoryRetryResult> => ({
      attempted: 0, succeeded: 0, failed: 0, skipped: 0, details: [],
    }));

    const job = await startQboInventoryResyncJob(TENANT, runner);
    await settle();

    const snap = await getQboInventoryResyncJob(job.jobId, TENANT);
    expect(snap?.status).toBe('succeeded');
    expect(snap?.total).toBe(0);
    expect(snap?.processed).toBe(0);
    expect(snap?.attempted).toBe(0);
    expect(snap?.details).toEqual([]);

    await _resetQboInventoryResyncJobs();
  });
});

describe('getQboInventoryResyncJob', () => {
  it('returns undefined for unknown ids', async () => {
    expect(await getQboInventoryResyncJob('does-not-exist', TENANT)).toBeUndefined();
  });

  it('reads jobs the calling process did not create (multi-replica polling)', async () => {
    // Simulate replica A creating the row directly in the shared DB.
    const now = new Date();
    await mockPrisma.qboInventoryResyncJob.create({
      data: {
        id: 'shared-job-1',
        tenantId: TENANT,
        status: 'running',
        total: 5,
        processed: 2,
        attempted: 2,
        succeeded: 2,
        failed: 0,
        skipped: 0,
        startedAt: now,
        updatedAt: now,
      },
    });
    await mockPrisma.qboInventoryResyncJobDetail.create({
      data: {
        jobId: 'shared-job-1', sequence: 1,
        sourceType: 'product', sourceId: 'p-a', qboType: 'Item', status: 'succeeded',
      },
    });

    // Replica B (this process) has no in-memory state but can still read it.
    const snap = await getQboInventoryResyncJob('shared-job-1', TENANT);
    expect(snap).toBeDefined();
    expect(snap?.status).toBe('running');
    expect(snap?.processed).toBe(2);
    expect(snap?.details).toHaveLength(1);
    expect(snap?.details[0].sourceId).toBe('p-a');

    await _resetQboInventoryResyncJobs();
  });
});

describe('sweepStaleQboInventoryResyncJobs', () => {
  it('flips abandoned running jobs to failed with a clear message after an API restart', async () => {
    // Simulate a job left running by the previous process, with an updatedAt
    // far enough in the past to look stale.
    const stale = new Date(Date.now() - 5 * 60_000); // 5 minutes ago
    await mockPrisma.qboInventoryResyncJob.create({
      data: {
        id: 'orphan-1',
        tenantId: TENANT,
        status: 'running',
        total: 10,
        processed: 4,
        attempted: 4,
        succeeded: 3,
        failed: 1,
        skipped: 0,
        startedAt: stale,
        updatedAt: stale,
      },
    });

    // And a fresh running job from the current process — should NOT be touched.
    const fresh = new Date();
    await mockPrisma.qboInventoryResyncJob.create({
      data: {
        id: 'fresh-1',
        tenantId: TENANT,
        status: 'running',
        total: 0,
        processed: 0,
        attempted: 0,
        succeeded: 0,
        failed: 0,
        skipped: 0,
        startedAt: fresh,
        updatedAt: fresh,
      },
    });

    const swept = await sweepStaleQboInventoryResyncJobs();
    expect(swept).toBe(1);

    const orphan = await getQboInventoryResyncJob('orphan-1', TENANT);
    expect(orphan?.status).toBe('failed');
    expect(orphan?.error).toMatch(/interrupted/i);
    expect(orphan?.completedAt).not.toBeNull();
    // Counters before the crash are preserved so the UI can still show what
    // had succeeded / failed before the restart.
    expect(orphan?.processed).toBe(4);
    expect(orphan?.succeeded).toBe(3);

    const stillFresh = await getQboInventoryResyncJob('fresh-1', TENANT);
    expect(stillFresh?.status).toBe('running');

    await _resetQboInventoryResyncJobs();
  });

  it('is a no-op when there are no stale jobs', async () => {
    const swept = await sweepStaleQboInventoryResyncJobs();
    expect(swept).toBe(0);
  });
});
