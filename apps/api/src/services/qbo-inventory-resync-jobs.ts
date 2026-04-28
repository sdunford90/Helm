import { prisma } from "../lib/prisma.js";
import {
  retryFailedQboInventorySyncs,
  type QboInventoryRetryResult,
} from "../routes/inventory.js";

/**
 * Persisted job registry for "Retry all failed QBO inventory syncs". The retry
 * loop walks every failed sync ref one at a time and waits on the QuickBooks
 * API for each one, which can stretch into minutes for tenants with hundreds
 * of failures. Running it inside a single request blocks the HTTP socket for
 * that whole window and leaves the UI with no way to show progress.
 *
 * Instead, the POST endpoint kicks off the retry asynchronously and returns a
 * `jobId`. The Settings UI polls a GET endpoint with that id to render a live
 * "Retried 14 of 87 — 12 succeeded, 2 still failing" counter and, when the
 * job completes, the final breakdown.
 *
 * Why DB-backed instead of in-memory:
 *
 * - **Survives an API restart.** A deploy, crash, or scale event used to wipe
 *   the in-memory `Map` and the polling endpoint started returning 404 for a
 *   job that was actually still half-done in the previous process. The UI had
 *   no signal beyond a generic "Re-sync failed". Persisting to Postgres lets
 *   the GET endpoint keep returning a meaningful snapshot, and the periodic
 *   sweep below flips orphaned `running` rows to `failed` with a clear
 *   "interrupted by API restart" message so the UI can prompt the user to try
 *   again.
 * - **Multiple replicas see the same job.** If replica A starts the job and
 *   the load balancer routes the next poll to replica B, B can read the row
 *   from the shared DB instead of returning 404.
 *
 * Completed jobs are pruned after `JOB_TTL_MS` to keep the table small.
 */

const JOB_TTL_MS = 60 * 60 * 1000; // 1 hour after completion
const HEARTBEAT_INTERVAL_MS = 15_000; // bump updatedAt while the runner is active
const STALE_RUNNING_THRESHOLD_MS = 60_000; // 4× heartbeat → mark abandoned
const SWEEP_INTERVAL_MS = 30_000; // how often background sweep runs

export interface QboInventoryResyncJob {
  jobId: string;
  tenantId: string;
  status: "running" | "succeeded" | "failed";
  total: number;
  processed: number;
  attempted: number;
  succeeded: number;
  failed: number;
  skipped: number;
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
  error: string | null;
  details: QboInventoryRetryResult["details"];
}

type JobRow = {
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
};

type DetailRow = {
  jobId: string;
  sequence: number;
  sourceType: string;
  sourceId: string;
  qboType: string;
  status: string;
  error: string | null;
};

// Track per-process heartbeats so we can stop them on completion or test reset.
const activeHeartbeats = new Map<string, NodeJS.Timeout>();
let sweepTimer: NodeJS.Timeout | null = null;

function toIsoOrNull(d: Date | null): string | null {
  return d ? d.toISOString() : null;
}

function toJobSnapshot(row: JobRow, details: DetailRow[]): QboInventoryResyncJob {
  return {
    jobId: row.id,
    tenantId: row.tenantId,
    status: row.status as QboInventoryResyncJob["status"],
    total: row.total,
    processed: row.processed,
    attempted: row.attempted,
    succeeded: row.succeeded,
    failed: row.failed,
    skipped: row.skipped,
    startedAt: row.startedAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    completedAt: toIsoOrNull(row.completedAt),
    error: row.error,
    details: details
      .slice()
      .sort((a, b) => a.sequence - b.sequence)
      .map((d) => ({
        sourceType: d.sourceType,
        sourceId: d.sourceId,
        qboType: d.qboType,
        status: d.status as "succeeded" | "failed" | "skipped",
        ...(d.error ? { error: d.error } : {}),
      })),
  };
}

async function pruneOldJobs(now: number = Date.now()): Promise<void> {
  try {
    const cutoff = new Date(now - JOB_TTL_MS);
    await prisma.qboInventoryResyncJob.deleteMany({
      where: { completedAt: { lt: cutoff, not: null } },
    });
  } catch (err) {
    console.warn(
      `[qbo-resync] prune failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Mark any `running` job whose `updatedAt` hasn't moved within the staleness
 * window as `failed`. Called once on API startup (in case the previous process
 * died mid-run) and on a 30s interval (so a crashed runner in one replica is
 * cleaned up by another replica).
 *
 * The error message is deliberately user-facing — it surfaces in the Settings
 * UI's "Re-sync failed" toast and tells the operator to retry.
 */
export async function sweepStaleQboInventoryResyncJobs(
  now: number = Date.now(),
): Promise<number> {
  try {
    const cutoff = new Date(now - STALE_RUNNING_THRESHOLD_MS);
    const completedAt = new Date(now);
    const result = await prisma.qboInventoryResyncJob.updateMany({
      where: { status: "running", updatedAt: { lt: cutoff } },
      data: {
        status: "failed",
        error: "Re-sync interrupted by API restart — please run it again.",
        completedAt,
        updatedAt: completedAt,
      },
    });
    return result.count ?? 0;
  } catch (err) {
    console.warn(
      `[qbo-resync] sweep failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return 0;
  }
}

/**
 * Wire up the recovery sweep. Called once from the API entrypoint so a fresh
 * process clears any orphaned `running` rows from a crashed predecessor and a
 * timer keeps the table healthy in multi-replica deploys.
 */
export function initQboInventoryResyncJobs(): void {
  void sweepStaleQboInventoryResyncJobs();
  if (sweepTimer) return; // idempotent for tests / hot reload
  sweepTimer = setInterval(() => {
    void sweepStaleQboInventoryResyncJobs();
  }, SWEEP_INTERVAL_MS);
  // Don't keep the event loop alive just for the sweep.
  if (typeof sweepTimer.unref === "function") sweepTimer.unref();
}

function startHeartbeat(jobId: string): void {
  // Touch updatedAt every HEARTBEAT_INTERVAL_MS so the staleness sweep doesn't
  // mistake a slow QBO call (no progress events for a while) for an orphaned
  // job. Stops as soon as the runner finalises the job.
  const timer = setInterval(() => {
    void (async () => {
      try {
        await prisma.qboInventoryResyncJob.updateMany({
          where: { id: jobId, status: "running" },
          data: { updatedAt: new Date() },
        });
      } catch (err) {
        console.warn(
          `[qbo-resync] heartbeat failed for ${jobId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    })();
  }, HEARTBEAT_INTERVAL_MS);
  if (typeof timer.unref === "function") timer.unref();
  activeHeartbeats.set(jobId, timer);
}

function stopHeartbeat(jobId: string): void {
  const timer = activeHeartbeats.get(jobId);
  if (timer) {
    clearInterval(timer);
    activeHeartbeats.delete(jobId);
  }
}

/**
 * Create a new resync job for the tenant and start it running. Resolves with
 * the initial job snapshot synchronously so the caller can return `{ jobId,
 * total }` to the client immediately.
 *
 * The actual retry runs inside a fire-and-forget Promise; progress is recorded
 * onto the persisted job + appended as detail rows after every processed ref
 * so polling reflects real-time progress and a different replica (or a fresh
 * process after a restart) can read the same snapshot.
 */
export async function startQboInventoryResyncJob(
  tenantId: string,
  runner: (
    tenantId: string,
    opts: Parameters<typeof retryFailedQboInventorySyncs>[1],
    onProgress: Parameters<typeof retryFailedQboInventorySyncs>[2],
  ) => Promise<QboInventoryRetryResult> = retryFailedQboInventorySyncs,
): Promise<QboInventoryResyncJob> {
  await pruneOldJobs();

  const now = new Date();
  const created: JobRow = await prisma.qboInventoryResyncJob.create({
    data: {
      tenantId,
      status: "running",
      total: 0,
      processed: 0,
      attempted: 0,
      succeeded: 0,
      failed: 0,
      skipped: 0,
      startedAt: now,
      updatedAt: now,
    },
  });

  const snapshot = toJobSnapshot(created, []);
  startHeartbeat(created.id);

  // Fire-and-forget. The caller has already received the jobId; failures
  // surface through the polling endpoint via job.status === "failed".
  void (async () => {
    let sequence = 0;
    try {
      const result = await runner(tenantId, {}, async (snap) => {
        sequence += 1;
        try {
          await prisma.qboInventoryResyncJobDetail.create({
            data: {
              jobId: created.id,
              sequence,
              sourceType: snap.lastDetail.sourceType,
              sourceId: snap.lastDetail.sourceId,
              qboType: snap.lastDetail.qboType,
              status: snap.lastDetail.status,
              error: snap.lastDetail.error ?? null,
            },
          });
          await prisma.qboInventoryResyncJob.update({
            where: { id: created.id },
            data: {
              total: snap.total,
              processed: snap.processed,
              attempted: snap.attempted,
              succeeded: snap.succeeded,
              failed: snap.failed,
              skipped: snap.skipped,
              updatedAt: new Date(),
            },
          });
        } catch (err) {
          // A flaky DB write must not break the retry loop — the runner
          // continues and the next progress event will reconcile counts.
          console.warn(
            `[qbo-resync] progress write failed for ${created.id}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      });

      // Final reconciliation: covers zero-failure runs (loop never emitted)
      // and ensures the totals match the runner's authoritative result.
      const completedAt = new Date();
      await prisma.qboInventoryResyncJob.update({
        where: { id: created.id },
        data: {
          total: Math.max(result.details.length, 0),
          processed: result.details.length,
          attempted: result.attempted,
          succeeded: result.succeeded,
          failed: result.failed,
          skipped: result.skipped,
          status: "succeeded",
          completedAt,
          updatedAt: completedAt,
          error: null,
        },
      });
    } catch (err) {
      const completedAt = new Date();
      const message = err instanceof Error ? err.message : String(err);
      try {
        await prisma.qboInventoryResyncJob.update({
          where: { id: created.id },
          data: {
            status: "failed",
            error: message,
            completedAt,
            updatedAt: completedAt,
          },
        });
      } catch (writeErr) {
        console.warn(
          `[qbo-resync] failure write lost for ${created.id}: ${writeErr instanceof Error ? writeErr.message : String(writeErr)}`,
        );
      }
    } finally {
      stopHeartbeat(created.id);
    }
  })();

  return snapshot;
}

/**
 * Look up a job by id. Returns undefined if the job doesn't exist (already
 * pruned or unknown id) or belongs to another tenant. The caller should map
 * that to a 404.
 *
 * Reads from Postgres so any replica — and any process that started after the
 * job began — sees the latest snapshot.
 */
export async function getQboInventoryResyncJob(
  jobId: string,
  tenantId: string,
): Promise<QboInventoryResyncJob | undefined> {
  const row: JobRow | null = await prisma.qboInventoryResyncJob.findFirst({
    where: { id: jobId, tenantId },
  });
  if (!row) return undefined;
  const details: DetailRow[] = await prisma.qboInventoryResyncJobDetail.findMany({
    where: { jobId },
    orderBy: { sequence: "asc" },
  });
  return toJobSnapshot(row, details);
}

/**
 * Test helper — clears persisted jobs, stops any heartbeats, and stops the
 * background sweep timer so test files don't leak intervals across runs.
 */
export async function _resetQboInventoryResyncJobs(): Promise<void> {
  for (const timer of activeHeartbeats.values()) clearInterval(timer);
  activeHeartbeats.clear();
  if (sweepTimer) {
    clearInterval(sweepTimer);
    sweepTimer = null;
  }
  try {
    await prisma.qboInventoryResyncJobDetail.deleteMany({});
    await prisma.qboInventoryResyncJob.deleteMany({});
  } catch {
    // Tests may mock prisma without these methods; ignore.
  }
}
