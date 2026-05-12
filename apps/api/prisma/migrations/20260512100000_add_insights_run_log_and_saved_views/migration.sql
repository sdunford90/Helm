-- R9 + R1 + R10: Universal Report Builder — run log, saved views, permissions.
--
-- Two new tables for the builder.
--
--   insights_run_log    One row per /api/insights/run call. Used as the
--                       audit feed for tenant admins (Compliance & Audit
--                       > Admin Actions surface, not built yet) and as
--                       the data source for the eventual cost-warning
--                       heuristics that will live in front of the
--                       engine.
--
--   saved_report_views  Persisted ReportSpec + display metadata.
--                       Indexed by (tenantId, userId) for the list view,
--                       plus a tenantId-only index for tenant-admin "all
--                       saved views" listings down the road.
--
-- Idempotent so a replay against an environment that already created the
-- tables or columns is a no-op.

CREATE TABLE IF NOT EXISTS "insights_run_log" (
  "id"             TEXT PRIMARY KEY,
  "tenantId"       TEXT NOT NULL,
  "userId"         TEXT,
  "specHash"       TEXT NOT NULL,
  "model"          TEXT NOT NULL,
  "rowCount"       INTEGER NOT NULL DEFAULT 0,
  "hasMore"        BOOLEAN NOT NULL DEFAULT false,
  "runtimeMs"      INTEGER NOT NULL DEFAULT 0,
  "warningCount"   INTEGER NOT NULL DEFAULT 0,
  "errorMessage"   TEXT,
  "specJson"       JSONB NOT NULL,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "insights_run_log_tenantId_idx"
  ON "insights_run_log" ("tenantId");
CREATE INDEX IF NOT EXISTS "insights_run_log_tenantId_createdAt_idx"
  ON "insights_run_log" ("tenantId", "createdAt");

CREATE TABLE IF NOT EXISTS "saved_report_views" (
  "id"          TEXT PRIMARY KEY,
  "tenantId"    TEXT NOT NULL,
  "userId"      TEXT,
  "name"        TEXT NOT NULL,
  "description" TEXT,
  "specJson"    JSONB NOT NULL,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "saved_report_views_tenantId_idx"
  ON "saved_report_views" ("tenantId");
CREATE INDEX IF NOT EXISTS "saved_report_views_tenantId_userId_idx"
  ON "saved_report_views" ("tenantId", "userId");

-- R10 permissions are a code-level concept that doesn't need a schema
-- migration. The `permissions` table (RolePermission) is keyed by a
-- (module, action) pair and already takes free-form strings, so the new
-- "reports:run-custom" + "reports:run-sensitive-fields" pair will be
-- inserted by the seed / role-defaults code, not by this migration.
