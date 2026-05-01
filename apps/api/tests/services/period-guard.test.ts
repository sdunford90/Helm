import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockPrisma } from '../setup.js';

vi.mock('../../src/services/period-guard.js', async (importOriginal) => {
  return await importOriginal();
});

let assertPeriodOpen: typeof import('../../src/services/period-guard.js').assertPeriodOpen;
let PeriodLockedError: typeof import('../../src/services/period-guard.js').PeriodLockedError;

beforeEach(async () => {
  vi.clearAllMocks();
  const mod = await import('../../src/services/period-guard.js');
  assertPeriodOpen = mod.assertPeriodOpen;
  PeriodLockedError = mod.PeriodLockedError;
});

// ─── assertPeriodOpen — happy path ───────────────────────────────────────────

describe('assertPeriodOpen — happy path', () => {
  it('resolves without throwing when no closed period overlaps the entry date', async () => {
    // mockPrisma.accountingPeriod.findFirst defaults to null (no closed period)
    mockPrisma.accountingPeriod.findFirst.mockResolvedValueOnce(null);

    await expect(
      assertPeriodOpen('tenant-1', 'loc-1', new Date('2024-06-15')),
    ).resolves.toBeUndefined();

    expect(mockPrisma.accountingPeriod.findFirst).toHaveBeenCalledTimes(1);
    expect(mockPrisma.accountingPeriod.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: 'tenant-1',
          locationId: 'loc-1',
          closedAt: { not: null },
        }),
      }),
    );
  });
});

// ─── assertPeriodOpen — blocked by closed period ─────────────────────────────

describe('assertPeriodOpen — blocked by closed period', () => {
  it('throws PeriodLockedError when a closed period covers the entry date', async () => {
    const periodStart = new Date('2024-01-01T00:00:00Z');
    mockPrisma.accountingPeriod.findFirst.mockResolvedValueOnce({
      id: 'period-jan-2024',
      periodStart,
    });

    await expect(
      assertPeriodOpen('tenant-1', 'loc-1', new Date('2024-01-15')),
    ).rejects.toThrow(PeriodLockedError);
  });

  it('error has periodLabel containing the period dates', async () => {
    const periodStart = new Date('2024-03-01T00:00:00Z');
    mockPrisma.accountingPeriod.findFirst.mockResolvedValueOnce({
      id: 'period-mar-2024',
      periodStart,
    });

    let caught: unknown;
    try {
      await assertPeriodOpen('tenant-1', 'loc-1', new Date('2024-03-15'));
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(PeriodLockedError);
    const lockedErr = caught as InstanceType<typeof PeriodLockedError>;
    expect(lockedErr.periodId).toBe('period-mar-2024');
    expect(lockedErr.periodLabel).toBeTruthy();
    // periodLabel is formatted as "Month Year"
    expect(lockedErr.periodLabel).toMatch(/march/i);
  });

  it('error message contains "closed" or "locked"', async () => {
    const periodStart = new Date('2024-05-01T00:00:00Z');
    mockPrisma.accountingPeriod.findFirst.mockResolvedValueOnce({
      id: 'period-may-2024',
      periodStart,
    });

    await expect(
      assertPeriodOpen('tenant-1', 'loc-1', new Date('2024-05-20')),
    ).rejects.toThrow(/closed|locked/i);
  });
});

// ─── assertPeriodOpen — boundary conditions ───────────────────────────────────

describe('assertPeriodOpen — boundary conditions', () => {
  it('throws for date at end of closed period (inclusive end boundary)', async () => {
    const periodStart = new Date('2024-01-01T00:00:00Z');
    // Simulates: period covers 2024-01-01 to 2024-01-31, closedAt is set
    mockPrisma.accountingPeriod.findFirst.mockResolvedValueOnce({
      id: 'period-jan-2024',
      periodStart,
    });

    // entryDate = 2024-01-31T23:59:59 — inside the period (boundary is inclusive)
    await expect(
      assertPeriodOpen('tenant-1', 'loc-1', new Date('2024-01-31T23:59:59Z')),
    ).rejects.toThrow(PeriodLockedError);
  });

  it('resolves for date just outside a closed period (day after period end)', async () => {
    // No matching closed period for 2024-02-01 — the period query returns null
    mockPrisma.accountingPeriod.findFirst.mockResolvedValueOnce(null);

    // entryDate = 2024-02-01T00:00:00 — outside the January period
    await expect(
      assertPeriodOpen('tenant-1', 'loc-1', new Date('2024-02-01T00:00:00Z')),
    ).resolves.toBeUndefined();
  });
});

// ─── assertPeriodOpen — missing table (fail open) ────────────────────────────

describe('assertPeriodOpen — missing table fails open', () => {
  it('resolves without throwing when Prisma throws P2021 (table does not exist)', async () => {
    const p2021 = Object.assign(new Error('P2021: The table `accounting_periods` does not exist'), {
      code: 'P2021',
    });
    mockPrisma.accountingPeriod.findFirst.mockRejectedValueOnce(p2021);

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(
      assertPeriodOpen('tenant-1', 'loc-1', new Date('2024-06-01')),
    ).resolves.toBeUndefined();

    expect(warnSpy).toHaveBeenCalled();
    expect(warnSpy.mock.calls[0][0]).toMatch(/period-guard/i);

    warnSpy.mockRestore();
  });

  it('resolves without throwing for any unexpected DB error (fail-open contract)', async () => {
    mockPrisma.accountingPeriod.findFirst.mockRejectedValueOnce(
      new Error('Connection refused'),
    );

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(
      assertPeriodOpen('tenant-1', 'loc-1', new Date('2024-06-01')),
    ).resolves.toBeUndefined();

    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

// ─── assertPeriodOpen — null/undefined locationId skips check ────────────────

describe('assertPeriodOpen — null/undefined locationId skips check', () => {
  it('resolves immediately without hitting the DB when locationId is null', async () => {
    await expect(
      assertPeriodOpen('tenant-1', null, new Date('2024-06-01')),
    ).resolves.toBeUndefined();

    expect(mockPrisma.accountingPeriod.findFirst).not.toHaveBeenCalled();
  });

  it('resolves immediately without hitting the DB when locationId is undefined', async () => {
    await expect(
      assertPeriodOpen('tenant-1', undefined, new Date('2024-06-01')),
    ).resolves.toBeUndefined();

    expect(mockPrisma.accountingPeriod.findFirst).not.toHaveBeenCalled();
  });

  it('resolves immediately without hitting the DB when locationId is empty string', async () => {
    await expect(
      assertPeriodOpen('tenant-1', '', new Date('2024-06-01')),
    ).resolves.toBeUndefined();

    expect(mockPrisma.accountingPeriod.findFirst).not.toHaveBeenCalled();
  });
});
