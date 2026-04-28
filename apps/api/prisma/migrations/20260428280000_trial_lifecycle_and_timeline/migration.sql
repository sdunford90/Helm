-- Trial onboarding tracker + at-risk save-play timeline.
--
-- 1. Adds TRIAL to the TenantStatus enum so trial tenants are first-class
--    in lifecycle queries (the admin "Trials" view filters on this).
-- 2. Adds trial lifecycle columns + admin assignment column to tenants.
-- 3. Adds the tenant_timeline_events table that records platform-admin
--    save-play actions, nudge sends, and assignments.

-- ── 1. Enum value ─────────────────────────────────────────────────────────
ALTER TYPE "TenantStatus" ADD VALUE IF NOT EXISTS 'TRIAL';

-- ── 2. Tenant columns ─────────────────────────────────────────────────────
ALTER TABLE "tenants"
  ADD COLUMN "trialStartedAt"      TIMESTAMP(3),
  ADD COLUMN "trialEndsAt"         TIMESTAMP(3),
  ADD COLUMN "assignedAdminUserId" TEXT;

-- ── 3. Timeline / save-play log ───────────────────────────────────────────
CREATE TABLE "tenant_timeline_events" (
  "id"           TEXT NOT NULL,
  "tenantId"     TEXT NOT NULL,
  "adminUserId"  TEXT,
  "type"         TEXT NOT NULL,
  "summary"      TEXT NOT NULL,
  "metadataJson" JSONB,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "tenant_timeline_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "tenant_timeline_events_tenantId_createdAt_idx"
  ON "tenant_timeline_events"("tenantId", "createdAt");

ALTER TABLE "tenant_timeline_events"
  ADD CONSTRAINT "tenant_timeline_events_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
