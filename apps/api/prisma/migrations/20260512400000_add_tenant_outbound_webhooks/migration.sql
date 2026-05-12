-- A8 — Tenant outbound webhook destinations + delivery log.
--
-- A tenant registers a destination URL + signing secret and the events it
-- cares about. Every emission writes a delivery row with attempt count and
-- last response. Retry policy lives in the BullMQ job that runs over
-- nextRetryAt; this migration only sets up the storage.

CREATE TABLE IF NOT EXISTS "webhook_destinations" (
  "id"                  TEXT PRIMARY KEY,
  "tenantId"            TEXT NOT NULL,
  "name"                TEXT NOT NULL,
  "url"                 TEXT NOT NULL,
  "signingSecret"       TEXT NOT NULL,
  "events"              TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "enabled"             BOOLEAN NOT NULL DEFAULT TRUE,
  "lastSuccessAt"       TIMESTAMP(3),
  "lastFailureAt"       TIMESTAMP(3),
  "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
  "disabledAt"          TIMESTAMP(3),
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  "updatedAt"           TIMESTAMP(3) NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "webhook_destinations_tenantId_idx"
  ON "webhook_destinations" ("tenantId");

CREATE TABLE IF NOT EXISTS "webhook_deliveries" (
  "id"              TEXT PRIMARY KEY,
  "destinationId"   TEXT NOT NULL REFERENCES "webhook_destinations"("id") ON DELETE CASCADE,
  "event"           TEXT NOT NULL,
  "payloadJson"     JSONB NOT NULL,
  "status"          TEXT NOT NULL DEFAULT 'PENDING',
  "httpStatus"      INTEGER,
  "responseSnippet" TEXT,
  "attempts"        INTEGER NOT NULL DEFAULT 0,
  "nextRetryAt"     TIMESTAMP(3),
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  "deliveredAt"     TIMESTAMP(3)
);
CREATE INDEX IF NOT EXISTS "webhook_deliveries_destination_created_idx"
  ON "webhook_deliveries" ("destinationId", "createdAt");
CREATE INDEX IF NOT EXISTS "webhook_deliveries_status_next_retry_idx"
  ON "webhook_deliveries" ("status", "nextRetryAt");
