-- Task #353 — Move Early Termination Fee and ACH Return Fee out of the
-- per-location posting-account pins (Location.earlyTerminationGlAccountId,
-- Location.achReturnFeeGlAccountId) into per-location, system-managed
-- ServiceFee products. Operators edit fee amount + GL + tax class on the
-- fee product instead of pinning a GL account on the location.
--
-- Steps:
--  1. Add ServiceFeeKind enum and `kind` column on service_fees.
--  2. Backfill one EARLY_TERMINATION_FEE and one ACH_RETURN_FEE row per
--     existing location, copying the GL account from the legacy pin into
--     ServiceFee.glAccountId AND a per-location ServiceFeeGlMapping row
--     so QBO-connected resolution still finds it.
--  3. Enforce at-most-one per (location, system kind) via partial unique.
--  4. Drop the FK constraints + columns from `locations`.

-- ── 1. Enum + kind column ──────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE "ServiceFeeKind" AS ENUM ('STANDARD', 'EARLY_TERMINATION_FEE', 'ACH_RETURN_FEE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "service_fees"
  ADD COLUMN IF NOT EXISTS "kind" "ServiceFeeKind" NOT NULL DEFAULT 'STANDARD';

-- ── 2. Backfill system fee rows per location ───────────────────────────────

INSERT INTO "service_fees"
  (id, "tenantId", "locationId", name, "feeType", "amountCents", pct,
   "glAccountId", "taxClass", active, "createdAt", "updatedAt", kind)
SELECT
  gen_random_uuid()::text,
  l."tenantId",
  l.id,
  'Early Termination Fee',
  'FLAT',
  0,
  NULL,
  l."earlyTerminationGlAccountId",
  'Tax Exempt',
  TRUE,
  NOW(),
  NOW(),
  'EARLY_TERMINATION_FEE'
FROM "locations" l
WHERE NOT EXISTS (
  SELECT 1 FROM "service_fees" sf
  WHERE sf."locationId" = l.id AND sf.kind = 'EARLY_TERMINATION_FEE'
);

INSERT INTO "service_fees"
  (id, "tenantId", "locationId", name, "feeType", "amountCents", pct,
   "glAccountId", "taxClass", active, "createdAt", "updatedAt", kind)
SELECT
  gen_random_uuid()::text,
  l."tenantId",
  l.id,
  'ACH Return Fee',
  'FLAT',
  2500,
  NULL,
  l."achReturnFeeGlAccountId",
  'Tax Exempt',
  TRUE,
  NOW(),
  NOW(),
  'ACH_RETURN_FEE'
FROM "locations" l
WHERE NOT EXISTS (
  SELECT 1 FROM "service_fees" sf
  WHERE sf."locationId" = l.id AND sf.kind = 'ACH_RETURN_FEE'
);

-- Mirror the GL pin into ServiceFeeGlMapping so QBO-connected resolution
-- (which only consults the per-location mapping table) keeps working.
INSERT INTO "service_fee_gl_mappings"
  (id, "tenantId", "serviceFeeId", "locationId", "glAccountId",
   "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  sf."tenantId",
  sf.id,
  sf."locationId",
  sf."glAccountId",
  NOW(),
  NOW()
FROM "service_fees" sf
WHERE sf.kind IN ('EARLY_TERMINATION_FEE', 'ACH_RETURN_FEE')
  AND sf."glAccountId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "service_fee_gl_mappings" m
    WHERE m."serviceFeeId" = sf.id AND m."locationId" = sf."locationId"
  );

-- ── 3. At-most-one system fee of each kind per location ────────────────────

CREATE UNIQUE INDEX IF NOT EXISTS "service_fees_locationId_kind_unique"
  ON "service_fees" ("locationId", "kind")
  WHERE "kind" <> 'STANDARD';

-- ── 4. Drop the legacy pin FKs + columns ──────────────────────────────────

ALTER TABLE "locations"
  DROP CONSTRAINT IF EXISTS "locations_earlyTerminationGlAccountId_fkey";
ALTER TABLE "locations"
  DROP CONSTRAINT IF EXISTS "locations_achReturnFeeGlAccountId_fkey";

ALTER TABLE "locations"
  DROP COLUMN IF EXISTS "earlyTerminationGlAccountId";
ALTER TABLE "locations"
  DROP COLUMN IF EXISTS "achReturnFeeGlAccountId";
