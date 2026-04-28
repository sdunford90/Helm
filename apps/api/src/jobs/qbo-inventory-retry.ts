// ---------------------------------------------------------------------------
// QBO inventory retry sweep
//
// A scheduled in-process job that re-runs `retryFailedQboInventorySyncs` for
// every tenant that currently has at least one failing inventory sync ref
// whose backoff window has elapsed. Lives inside the API process because the
// retry logic depends on in-memory product / adjustment / purchase-order state
// owned by `apps/api/src/routes/inventory.ts`.
// ---------------------------------------------------------------------------

import { findTenantsWithDueFailedInventorySyncs, nextQuarterHour } from "../services/qbo-sync.js";
import { retryFailedQboInventorySyncs } from "../routes/inventory.js";

const SWEEP_INTERVAL_MS = 15 * 60 * 1000; // every 15 minutes (matches nextQuarterHour())

let sweepTimer: NodeJS.Timeout | null = null;
let initialDelayTimer: NodeJS.Timeout | null = null;
let running = false;

/**
 * Run the retry sweep once. Exposed for tests and to allow callers (e.g. the
 * Settings page) to trigger an immediate sweep without waiting for the cron.
 * Re-entrant calls are a no-op while a previous run is still in flight.
 */
export async function runQboInventoryRetrySweep(now: Date = new Date()): Promise<{
  tenantsScanned: number;
  totalAttempted: number;
  totalSucceeded: number;
  totalFailed: number;
  totalSkipped: number;
}> {
  if (running) {
    return { tenantsScanned: 0, totalAttempted: 0, totalSucceeded: 0, totalFailed: 0, totalSkipped: 0 };
  }
  running = true;
  const summary = { tenantsScanned: 0, totalAttempted: 0, totalSucceeded: 0, totalFailed: 0, totalSkipped: 0 };
  try {
    const tenantIds = await findTenantsWithDueFailedInventorySyncs(now);
    summary.tenantsScanned = tenantIds.length;

    for (const tenantId of tenantIds) {
      try {
        const result = await retryFailedQboInventorySyncs(tenantId, { dueOnly: true, now });
        summary.totalAttempted += result.attempted;
        summary.totalSucceeded += result.succeeded;
        summary.totalFailed += result.failed;
        summary.totalSkipped += result.skipped;
        if (result.attempted > 0) {
          console.log(
            `[qbo-inventory-retry] tenant=${tenantId} attempted=${result.attempted} succeeded=${result.succeeded} failed=${result.failed} skipped=${result.skipped}`,
          );
        }
      } catch (err) {
        console.error(
          `[qbo-inventory-retry] tenant=${tenantId} sweep failed: ${(err as Error).message}`,
        );
      }
    }
  } finally {
    running = false;
  }
  return summary;
}

/**
 * Start the recurring sweep. The first run is deferred until the next
 * quarter-hour boundary so the schedule lines up with the wall clock advertised
 * by `getInventorySyncStatus().nextAutomaticRetryAt`. Subsequent runs fire
 * every 15 minutes.
 *
 * Returns a stop function for tests.
 */
export function startQboInventoryRetrySchedule(): () => void {
  stopQboInventoryRetrySchedule();

  const now = new Date();
  const firstFireAt = nextQuarterHour(now);
  const initialDelayMs = Math.max(0, firstFireAt.getTime() - now.getTime());

  initialDelayTimer = setTimeout(() => {
    initialDelayTimer = null;
    void runQboInventoryRetrySweep().catch((err) => {
      console.error("[qbo-inventory-retry] sweep failed:", (err as Error).message);
    });
    sweepTimer = setInterval(() => {
      void runQboInventoryRetrySweep().catch((err) => {
        console.error("[qbo-inventory-retry] sweep failed:", (err as Error).message);
      });
    }, SWEEP_INTERVAL_MS);
    sweepTimer.unref();
  }, initialDelayMs);
  initialDelayTimer.unref();

  console.log(
    `[qbo-inventory-retry] scheduled — next sweep at ${firstFireAt.toISOString()}, then every ${SWEEP_INTERVAL_MS / 60000}min`,
  );

  return stopQboInventoryRetrySchedule;
}

export function stopQboInventoryRetrySchedule(): void {
  if (initialDelayTimer) {
    clearTimeout(initialDelayTimer);
    initialDelayTimer = null;
  }
  if (sweepTimer) {
    clearInterval(sweepTimer);
    sweepTimer = null;
  }
}
