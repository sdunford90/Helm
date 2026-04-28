-- Migration: persist QBO inventory re-sync jobs so they survive an API restart.
-- The "Retry all failed QBO inventory syncs" job used to live in an in-memory
-- Map in a single API process. If the API restarted (deploy, crash, scale
-- event) mid-run the snapshot was lost and the polling endpoint started
-- returning 404, leaving the UI with no way to recover. Persisting the job
-- state lets multiple replicas serve the same poll endpoint and lets a fresh
-- process either resume or cleanly mark the orphaned job as failed.

CREATE TABLE IF NOT EXISTS "qbo_inventory_resync_jobs" (
  "id"          TEXT NOT NULL,
  "tenantId"    TEXT NOT NULL,
  "status"      TEXT NOT NULL DEFAULT 'running',
  "total"       INTEGER NOT NULL DEFAULT 0,
  "processed"   INTEGER NOT NULL DEFAULT 0,
  "attempted"   INTEGER NOT NULL DEFAULT 0,
  "succeeded"   INTEGER NOT NULL DEFAULT 0,
  "failed"      INTEGER NOT NULL DEFAULT 0,
  "skipped"     INTEGER NOT NULL DEFAULT 0,
  "startedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "error"       TEXT,

  CONSTRAINT "qbo_inventory_resync_jobs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "qbo_inventory_resync_jobs_tenantId_idx"
  ON "qbo_inventory_resync_jobs" ("tenantId");

-- Used by the periodic stale-running sweep to find abandoned jobs whose owning
-- API process disappeared without flipping status to 'succeeded' or 'failed'.
CREATE INDEX IF NOT EXISTS "qbo_inventory_resync_jobs_status_updatedAt_idx"
  ON "qbo_inventory_resync_jobs" ("status", "updatedAt");

CREATE TABLE IF NOT EXISTS "qbo_inventory_resync_job_details" (
  "id"         TEXT NOT NULL,
  "jobId"      TEXT NOT NULL,
  "sequence"   INTEGER NOT NULL,
  "sourceType" TEXT NOT NULL,
  "sourceId"   TEXT NOT NULL,
  "qboType"    TEXT NOT NULL,
  "status"     TEXT NOT NULL,
  "error"      TEXT,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "qbo_inventory_resync_job_details_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "qbo_inventory_resync_job_details_jobId_sequence_idx"
  ON "qbo_inventory_resync_job_details" ("jobId", "sequence");

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'qbo_inventory_resync_job_details_jobId_fkey'
      AND table_name = 'qbo_inventory_resync_job_details'
  ) THEN
    ALTER TABLE "qbo_inventory_resync_job_details"
      ADD CONSTRAINT "qbo_inventory_resync_job_details_jobId_fkey"
      FOREIGN KEY ("jobId") REFERENCES "qbo_inventory_resync_jobs"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
