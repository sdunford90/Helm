-- Platform-wide settings persisted as a single row (id = 'singleton').
-- Loaded and saved by the admin Platform Settings page; only PLATFORM_ADMIN
-- can read or mutate.

CREATE TABLE "platform_settings" (
  "id"                  TEXT NOT NULL DEFAULT 'singleton',
  "defaultTier"         TEXT,
  "trialDurationDays"   INTEGER NOT NULL DEFAULT 14,
  "gracePeriodDays"     INTEGER NOT NULL DEFAULT 7,
  "autoLockAfterGrace"  BOOLEAN NOT NULL DEFAULT true,
  "achFeeRatePct"       DOUBLE PRECISION NOT NULL DEFAULT 0.8,
  "cardFeeRatePct"      DOUBLE PRECISION NOT NULL DEFAULT 2.9,
  "stripeConnectFeePct" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  "feeCapCents"         INTEGER NOT NULL DEFAULT 5000,
  "maintenanceMode"     BOOLEAN NOT NULL DEFAULT false,
  "maintenanceMessage"  TEXT NOT NULL DEFAULT 'We''re performing scheduled maintenance. We''ll be back shortly. Thank you for your patience.',
  "featureFlagsJson"    JSONB NOT NULL DEFAULT '{}'::jsonb,
  "updatedAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedBy"           TEXT,

  CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("id")
);

-- Seed the singleton row so GET works on a fresh DB.
INSERT INTO "platform_settings" ("id") VALUES ('singleton')
  ON CONFLICT ("id") DO NOTHING;
