import { randomUUID } from "node:crypto";
import {
  retryFailedQboInventorySyncs,
  type QboInventoryRetryResult,
} from "../routes/inventory.js";

/**
 * In-memory job registry for "Retry all failed QBO inventory syncs". The retry
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
 * Jobs are kept in-process (matching the existing in-memory inventory data)
 * and aged out after `JOB_TTL_MS` so old jobs don't leak memory.
 */

const JOB_TTL_MS = 60 * 60 * 1000; // 1 hour after completion

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

const jobs = new Map<string, QboInventoryResyncJob>();

function pruneOldJobs(now: number = Date.now()): void {
  for (const [id, job] of jobs) {
    if (job.completedAt && now - new Date(job.completedAt).getTime() > JOB_TTL_MS) {
      jobs.delete(id);
    }
  }
}

/**
 * Create a new resync job for the tenant and start it running. Resolves with
 * the initial job snapshot synchronously so the caller can return `{ jobId,
 * total }` to the client immediately.
 *
 * The actual retry runs inside a fire-and-forget Promise; progress is recorded
 * onto the job record after every processed ref so polling reflects real-time
 * progress.
 */
export async function startQboInventoryResyncJob(
  tenantId: string,
  runner: (
    tenantId: string,
    onProgress: Parameters<typeof retryFailedQboInventorySyncs>[1],
  ) => Promise<QboInventoryRetryResult> = retryFailedQboInventorySyncs,
): Promise<QboInventoryResyncJob> {
  pruneOldJobs();

  const jobId = randomUUID();
  const now = new Date().toISOString();
  const job: QboInventoryResyncJob = {
    jobId,
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
    completedAt: null,
    error: null,
    details: [],
  };
  jobs.set(jobId, job);

  // Fire-and-forget. The caller has already received the jobId; failures
  // surface through the polling endpoint via job.status === "failed".
  void (async () => {
    try {
      const result = await runner(tenantId, (snapshot) => {
        job.total = snapshot.total;
        job.processed = snapshot.processed;
        job.attempted = snapshot.attempted;
        job.succeeded = snapshot.succeeded;
        job.failed = snapshot.failed;
        job.skipped = snapshot.skipped;
        job.details.push(snapshot.lastDetail);
        job.updatedAt = new Date().toISOString();
      });
      // Final reconciliation in case the loop never emitted (zero failed refs).
      job.total = Math.max(job.total, result.details.length);
      job.processed = result.details.length;
      job.attempted = result.attempted;
      job.succeeded = result.succeeded;
      job.failed = result.failed;
      job.skipped = result.skipped;
      job.status = "succeeded";
      job.completedAt = new Date().toISOString();
      job.updatedAt = job.completedAt;
    } catch (err) {
      job.status = "failed";
      job.error = err instanceof Error ? err.message : String(err);
      job.completedAt = new Date().toISOString();
      job.updatedAt = job.completedAt;
    }
  })();

  return job;
}

/**
 * Look up a job by id. Returns undefined if the job doesn't exist (already
 * pruned or unknown id). The caller should map that to a 404.
 */
export function getQboInventoryResyncJob(
  jobId: string,
  tenantId: string,
): QboInventoryResyncJob | undefined {
  const job = jobs.get(jobId);
  if (!job || job.tenantId !== tenantId) return undefined;
  return job;
}

/** Test helper — clears the in-memory job registry. */
export function _resetQboInventoryResyncJobs(): void {
  jobs.clear();
}
