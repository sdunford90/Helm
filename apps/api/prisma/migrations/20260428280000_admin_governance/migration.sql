-- Admin governance & compliance: roles, audit log, tenant export & delete.

-- New enums --------------------------------------------------------------

CREATE TYPE "AdminRole" AS ENUM ('SUPERUSER', 'BILLING_ADMIN', 'READ_ONLY_SUPPORT');
CREATE TYPE "TenantExportStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED');
CREATE TYPE "TenantDeletionStatus" AS ENUM ('PENDING', 'CANCELLED', 'COMPLETED', 'FAILED');

-- User.adminRole sub-role for PLATFORM_ADMIN users -----------------------

ALTER TABLE "users" ADD COLUMN "adminRole" "AdminRole";

-- Backfill existing PLATFORM_ADMIN users to SUPERUSER so they don't lose
-- access immediately. New admins should be created READ_ONLY_SUPPORT and
-- promoted explicitly.
UPDATE "users"
   SET "adminRole" = 'SUPERUSER'
 WHERE "role" = 'PLATFORM_ADMIN'
   AND "adminRole" IS NULL;

-- Admin audit log --------------------------------------------------------

CREATE TABLE "admin_audit_logs" (
  "id"             TEXT NOT NULL,
  "actorUserId"    TEXT NOT NULL,
  "actorEmail"     TEXT NOT NULL,
  "actorName"      TEXT,
  "actorAdminRole" TEXT,
  "action"         TEXT NOT NULL,
  "targetTenantId" TEXT,
  "targetType"     TEXT,
  "targetId"       TEXT,
  "detailsJson"    JSONB,
  "ipAddress"      TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "admin_audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "admin_audit_logs_createdAt_idx"      ON "admin_audit_logs" ("createdAt");
CREATE INDEX "admin_audit_logs_actorUserId_idx"    ON "admin_audit_logs" ("actorUserId");
CREATE INDEX "admin_audit_logs_targetTenantId_idx" ON "admin_audit_logs" ("targetTenantId");
CREATE INDEX "admin_audit_logs_action_idx"         ON "admin_audit_logs" ("action");

-- Tenant exports ---------------------------------------------------------

CREATE TABLE "tenant_exports" (
  "id"               TEXT NOT NULL,
  "tenantId"         TEXT NOT NULL,
  "requestedById"    TEXT NOT NULL,
  "requestedByEmail" TEXT NOT NULL,
  "status"           "TenantExportStatus" NOT NULL DEFAULT 'PENDING',
  "storageKey"       TEXT,
  "downloadToken"    TEXT NOT NULL,
  "fileSizeBytes"    INTEGER,
  "rowCounts"        JSONB,
  "errorMsg"         TEXT,
  "startedAt"        TIMESTAMP(3),
  "completedAt"      TIMESTAMP(3),
  "expiresAt"        TIMESTAMP(3),
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "localBlob"        BYTEA,
  CONSTRAINT "tenant_exports_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tenant_exports_downloadToken_key" ON "tenant_exports" ("downloadToken");
CREATE INDEX        "tenant_exports_tenantId_idx"      ON "tenant_exports" ("tenantId");
CREATE INDEX        "tenant_exports_status_idx"        ON "tenant_exports" ("status");
CREATE INDEX        "tenant_exports_createdAt_idx"     ON "tenant_exports" ("createdAt");

-- Tenant deletions -------------------------------------------------------

CREATE TABLE "tenant_deletions" (
  "id"               TEXT NOT NULL,
  "tenantId"         TEXT NOT NULL,
  "requestedById"    TEXT NOT NULL,
  "requestedByEmail" TEXT NOT NULL,
  "scheduledFor"     TIMESTAMP(3) NOT NULL,
  "status"           "TenantDeletionStatus" NOT NULL DEFAULT 'PENDING',
  "cancelledAt"      TIMESTAMP(3),
  "cancelledById"    TEXT,
  "completedAt"      TIMESTAMP(3),
  "errorMsg"         TEXT,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tenant_deletions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tenant_deletions_tenantId_key"         ON "tenant_deletions" ("tenantId");
CREATE INDEX        "tenant_deletions_status_scheduled_idx" ON "tenant_deletions" ("status", "scheduledFor");
CREATE INDEX        "tenant_deletions_tenantId_idx"         ON "tenant_deletions" ("tenantId");
