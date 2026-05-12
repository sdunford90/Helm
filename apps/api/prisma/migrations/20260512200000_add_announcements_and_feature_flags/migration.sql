-- A12 + A6: Platform announcements (with dismissals) + per-tenant feature-flag overrides.
--
-- platform_announcements    Operator-controlled banners pushed across web /
--                           portal / admin. Audience is ALL, a tier id, or a
--                           role enum.
-- platform_announcement_dismissals  Per-user dismissal records so each user
--                                   can hide a banner without affecting
--                                   anyone else.
-- feature_flag_overrides    Sparse table of explicit per-tenant flag
--                           settings. Defaults live in code; this is the
--                           override layer + audit trail.
--
-- Idempotent.

CREATE TABLE IF NOT EXISTS "platform_announcements" (
  "id"            TEXT PRIMARY KEY,
  "severity"      TEXT NOT NULL DEFAULT 'INFO',
  "title"         TEXT NOT NULL,
  "body"          TEXT NOT NULL,
  "link"          TEXT,
  "audience"      TEXT NOT NULL DEFAULT 'ALL',
  "audienceValue" TEXT,
  "startsAt"      TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  "endsAt"        TIMESTAMP(3),
  "dismissable"   BOOLEAN NOT NULL DEFAULT TRUE,
  "createdBy"     TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "platform_announcements_startsAt_endsAt_idx"
  ON "platform_announcements" ("startsAt", "endsAt");

CREATE TABLE IF NOT EXISTS "platform_announcement_dismissals" (
  "id"             TEXT PRIMARY KEY,
  "announcementId" TEXT NOT NULL REFERENCES "platform_announcements"("id") ON DELETE CASCADE,
  "userId"         TEXT NOT NULL,
  "dismissedAt"    TIMESTAMP(3) NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS "platform_announcement_dismissals_announcement_user_unique"
  ON "platform_announcement_dismissals" ("announcementId", "userId");

CREATE TABLE IF NOT EXISTS "feature_flag_overrides" (
  "id"        TEXT PRIMARY KEY,
  "tenantId"  TEXT NOT NULL,
  "flag"      TEXT NOT NULL,
  "enabled"   BOOLEAN NOT NULL,
  "reason"    TEXT,
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS "feature_flag_overrides_tenant_flag_unique"
  ON "feature_flag_overrides" ("tenantId", "flag");
CREATE INDEX IF NOT EXISTS "feature_flag_overrides_tenantId_idx"
  ON "feature_flag_overrides" ("tenantId");
