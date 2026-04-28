import { describe, it, expect, beforeEach, vi } from 'vitest';
import '../setup.js';

import {
  startQboInventoryResyncJob,
  getQboInventoryResyncJob,
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

beforeEach(() => {
  _resetQboInventoryResyncJobs();
  vi.clearAllMocks();
});

describe('startQboInventoryResyncJob', () => {
  it('returns a running job snapshot synchronously and isolates jobs by tenant', async () => {
    const runner = vi.fn(async (
      _tenantId: string,
      _onProgress: QboInventoryRetryProgress | undefined,
    ): Promise<QboInventoryRetryResult> => {
      // Simulate a slow QBO call that does not complete before the caller polls.
      await new Promise((r) => setTimeout(r, 50));
      return { attempted: 0, succeeded: 0, failed: 0, skipped: 0, details: [] };
    });

    const job = await startQboInventoryResyncJob(TENANT, runner);

    expect(job.jobId).toMatch(/[0-9a-f-]{36}/);
    expect(job.status).toBe('running');
    expect(job.tenantId).toBe(TENANT);
    expect(getQboInventoryResyncJob(job.jobId, TENANT)).toBe(job);
    // Tenant isolation: another tenant cannot read the job.
    expect(getQboInventoryResyncJob(job.jobId, 'other-tenant')).toBeUndefined();
  });

  it('records progress snapshots from onProgress callbacks during the run', async () => {
    let triggerNext: (() => void) | null = null;
    const runner = vi.fn(async (
      _tenantId: string,
      onProgress: QboInventoryRetryProgress | undefined,
    ): Promise<QboInventoryRetryResult> => {
      // First record finishes immediately.
      onProgress?.({
        total: 3,
        processed: 1,
        attempted: 1,
        succeeded: 1,
        failed: 0,
        skipped: 0,
        lastDetail: detail({ sourceId: 'a' }),
      });
      // Second record waits on the test to advance.
      await new Promise<void>((resolve) => { triggerNext = resolve; });
      onProgress?.({
        total: 3,
        processed: 2,
        attempted: 2,
        succeeded: 1,
        failed: 1,
        skipped: 0,
        lastDetail: detail({ sourceId: 'b', status: 'failed', error: 'boom' }),
      });
      onProgress?.({
        total: 3,
        processed: 3,
        attempted: 2,
        succeeded: 1,
        failed: 1,
        skipped: 1,
        lastDetail: detail({ sourceId: 'c', status: 'skipped', error: 'gone' }),
      });
      return {
        attempted: 2,
        succeeded: 1,
        failed: 1,
        skipped: 1,
        details: [
          detail({ sourceId: 'a' }),
          detail({ sourceId: 'b', status: 'failed', error: 'boom' }),
          detail({ sourceId: 'c', status: 'skipped', error: 'gone' }),
        ],
      };
    });

    const job = await startQboInventoryResyncJob(TENANT, runner);

    // Allow the runner's first progress emit to fire.
    await new Promise((r) => setTimeout(r, 0));
    let snap = getQboInventoryResyncJob(job.jobId, TENANT);
    expect(snap?.status).toBe('running');
    expect(snap?.total).toBe(3);
    expect(snap?.processed).toBe(1);
    expect(snap?.succeeded).toBe(1);
    expect(snap?.details.length).toBe(1);

    // Release the second emit and let the loop settle.
    triggerNext?.();
    await new Promise((r) => setTimeout(r, 10));

    snap = getQboInventoryResyncJob(job.jobId, TENANT);
    expect(snap?.status).toBe('succeeded');
    expect(snap?.processed).toBe(3);
    expect(snap?.attempted).toBe(2);
    expect(snap?.succeeded).toBe(1);
    expect(snap?.failed).toBe(1);
    expect(snap?.skipped).toBe(1);
    expect(snap?.details).toHaveLength(3);
    expect(snap?.completedAt).not.toBeNull();
  });

  it('marks the job failed when the retry loop throws', async () => {
    const runner = vi.fn(async (): Promise<QboInventoryRetryResult> => {
      throw new Error('QBO down');
    });

    const job = await startQboInventoryResyncJob(TENANT, runner);
    await new Promise((r) => setTimeout(r, 10));

    const snap = getQboInventoryResyncJob(job.jobId, TENANT);
    expect(snap?.status).toBe('failed');
    expect(snap?.error).toBe('QBO down');
    expect(snap?.completedAt).not.toBeNull();
  });

  it('handles a zero-failure run (loop never emits progress) by reconciling counts on completion', async () => {
    const runner = vi.fn(async (): Promise<QboInventoryRetryResult> => ({
      attempted: 0,
      succeeded: 0,
      failed: 0,
      skipped: 0,
      details: [],
    }));

    const job = await startQboInventoryResyncJob(TENANT, runner);
    await new Promise((r) => setTimeout(r, 10));

    const snap = getQboInventoryResyncJob(job.jobId, TENANT);
    expect(snap?.status).toBe('succeeded');
    expect(snap?.total).toBe(0);
    expect(snap?.processed).toBe(0);
    expect(snap?.attempted).toBe(0);
    expect(snap?.details).toEqual([]);
  });
});

describe('getQboInventoryResyncJob', () => {
  it('returns undefined for unknown ids', () => {
    expect(getQboInventoryResyncJob('does-not-exist', TENANT)).toBeUndefined();
  });
});
