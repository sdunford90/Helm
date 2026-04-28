-- Migration: Per-record retry backoff for QBO inventory sync refs.
-- Adds retryCount + nextRetryAt so a scheduled background worker can re-run
-- failed inventory pushes without hammering QuickBooks for permanently broken
-- records (e.g. missing GL account mapping).

ALTER TABLE "qbo_inventory_sync_refs" ADD COLUMN IF NOT EXISTS "retryCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "qbo_inventory_sync_refs" ADD COLUMN IF NOT EXISTS "nextRetryAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "qbo_inventory_sync_refs_tenantId_nextRetryAt_idx"
  ON "qbo_inventory_sync_refs"("tenantId", "nextRetryAt");
