-- Plan 17 — In-app notifications backing the bell icon across web/portal/admin.

CREATE TABLE IF NOT EXISTS "notifications" (
  "id"                       TEXT PRIMARY KEY,
  "tenantId"                 TEXT,
  "audienceUserId"           TEXT,
  "audiencePortalCustomerId" TEXT,
  "audienceAdminUserId"      TEXT,
  "kind"                     TEXT NOT NULL,
  "title"                    TEXT NOT NULL,
  "body"                     TEXT,
  "linkUrl"                  TEXT,
  "readAt"                   TIMESTAMP(3),
  "createdAt"                TIMESTAMP(3) NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "notifications_audienceUserId_readAt_createdAt_idx"
  ON "notifications" ("audienceUserId", "readAt", "createdAt");
CREATE INDEX IF NOT EXISTS "notifications_audiencePortalCustomerId_readAt_createdAt_idx"
  ON "notifications" ("audiencePortalCustomerId", "readAt", "createdAt");
CREATE INDEX IF NOT EXISTS "notifications_audienceAdminUserId_readAt_createdAt_idx"
  ON "notifications" ("audienceAdminUserId", "readAt", "createdAt");
CREATE INDEX IF NOT EXISTS "notifications_tenantId_createdAt_idx"
  ON "notifications" ("tenantId", "createdAt");
