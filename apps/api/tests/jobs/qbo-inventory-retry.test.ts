import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockPrisma } from '../setup.js';

// The sweep depends on retryFailedQboInventorySyncs which lives in routes/inventory.
// Mock that out so we don't have to construct full inventory state.
vi.mock('../../src/routes/inventory.js', () => ({
  retryFailedQboInventorySyncs: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  (mockPrisma as any).qboInventorySyncRef = {
    findUnique: vi.fn(),
    findMany: vi.fn().mockResolvedValue([]),
    upsert: vi.fn().mockResolvedValue({}),
    update: vi.fn(),
  };
});

describe('runQboInventoryRetrySweep', () => {
  it('returns early with zero counts when no tenants have due failed syncs', async () => {
    (mockPrisma as any).qboInventorySyncRef.findMany = vi.fn().mockResolvedValue([]);
    const inv = await import('../../src/routes/inventory.js');
    const sweep = await import('../../src/jobs/qbo-inventory-retry.js');

    const summary = await sweep.runQboInventoryRetrySweep(new Date('2026-04-28T12:00:00Z'));

    expect(summary).toEqual({
      tenantsScanned: 0,
      totalAttempted: 0,
      totalSucceeded: 0,
      totalFailed: 0,
      totalSkipped: 0,
    });
    expect(inv.retryFailedQboInventorySyncs).not.toHaveBeenCalled();
  });

  it('iterates every distinct tenant with due failed syncs and aggregates counts', async () => {
    const now = new Date('2026-04-28T12:00:00Z');
    (mockPrisma as any).qboInventorySyncRef.findMany = vi.fn().mockResolvedValue([
      { tenantId: 'tenant-a' },
      { tenantId: 'tenant-b' },
    ]);

    const inv = await import('../../src/routes/inventory.js');
    (inv.retryFailedQboInventorySyncs as any)
      .mockResolvedValueOnce({ attempted: 3, succeeded: 2, failed: 1, skipped: 0, details: [] })
      .mockResolvedValueOnce({ attempted: 1, succeeded: 0, failed: 0, skipped: 1, details: [] });

    const sweep = await import('../../src/jobs/qbo-inventory-retry.js');
    const summary = await sweep.runQboInventoryRetrySweep(now);

    expect(summary).toEqual({
      tenantsScanned: 2,
      totalAttempted: 4,
      totalSucceeded: 2,
      totalFailed: 1,
      totalSkipped: 1,
    });
    expect(inv.retryFailedQboInventorySyncs).toHaveBeenCalledTimes(2);
    expect(inv.retryFailedQboInventorySyncs).toHaveBeenNthCalledWith(1, 'tenant-a', { dueOnly: true, now });
    expect(inv.retryFailedQboInventorySyncs).toHaveBeenNthCalledWith(2, 'tenant-b', { dueOnly: true, now });
  });

  it('logs and continues when a tenant retry throws — does not abort the sweep', async () => {
    (mockPrisma as any).qboInventorySyncRef.findMany = vi.fn().mockResolvedValue([
      { tenantId: 'tenant-a' },
      { tenantId: 'tenant-b' },
    ]);
    const inv = await import('../../src/routes/inventory.js');
    (inv.retryFailedQboInventorySyncs as any)
      .mockRejectedValueOnce(new Error('QBO is having a bad day'))
      .mockResolvedValueOnce({ attempted: 2, succeeded: 2, failed: 0, skipped: 0, details: [] });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const sweep = await import('../../src/jobs/qbo-inventory-retry.js');
    const summary = await sweep.runQboInventoryRetrySweep();

    expect(summary.tenantsScanned).toBe(2);
    expect(summary.totalSucceeded).toBe(2);
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining('tenant-a'),
    );
    errSpy.mockRestore();
  });
});
