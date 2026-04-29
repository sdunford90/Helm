-- Admin operational support tools: tenant notes & platform-admin audit events.

CREATE TABLE "admin_audit_events" (
    "id" TEXT NOT NULL,
    "adminUserId" TEXT,
    "adminEmail" TEXT,
    "tenantId" TEXT,
    "action" TEXT NOT NULL,
    "metadataJson" JSONB,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_audit_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "admin_audit_events_tenantId_createdAt_idx" ON "admin_audit_events"("tenantId", "createdAt");
CREATE INDEX "admin_audit_events_adminUserId_idx" ON "admin_audit_events"("adminUserId");
CREATE INDEX "admin_audit_events_action_idx" ON "admin_audit_events"("action");

CREATE TABLE "tenant_notes" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "authorEmail" TEXT,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_notes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "tenant_notes_tenantId_createdAt_idx" ON "tenant_notes"("tenantId", "createdAt");
