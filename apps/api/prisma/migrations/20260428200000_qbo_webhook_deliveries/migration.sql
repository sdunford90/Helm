-- Migration: persist accepted Intuit QuickBooks Online webhook deliveries.
-- The QBO webhook receiver responds 200 to Intuit immediately and processes
-- entities in the background, so any error in the dispatcher is silently
-- dropped (Intuit will not retry). Saving each accepted delivery with its
-- raw payload + signature + status lets operators review FAILED rows and
-- trigger a replay.

CREATE TABLE IF NOT EXISTS "qbo_webhook_deliveries" (
  "id"          TEXT NOT NULL,
  "realmId"     TEXT NOT NULL,
  "tenantId"    TEXT,
  "locationId"  TEXT,
  "signature"   TEXT NOT NULL,
  "payloadJson" JSONB NOT NULL,
  "status"      TEXT NOT NULL DEFAULT 'PENDING',
  "attempts"    INTEGER NOT NULL DEFAULT 0,
  "lastError"   TEXT,
  "receivedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processedAt" TIMESTAMP(3),
  CONSTRAINT "qbo_webhook_deliveries_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "qbo_webhook_deliveries_status_receivedAt_idx"
  ON "qbo_webhook_deliveries"("status", "receivedAt");

CREATE INDEX IF NOT EXISTS "qbo_webhook_deliveries_tenantId_status_idx"
  ON "qbo_webhook_deliveries"("tenantId", "status");

CREATE INDEX IF NOT EXISTS "qbo_webhook_deliveries_realmId_idx"
  ON "qbo_webhook_deliveries"("realmId");
