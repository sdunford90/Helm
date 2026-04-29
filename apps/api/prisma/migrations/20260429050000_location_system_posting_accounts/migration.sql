-- Per-location SYSTEM posting account pins (Task #222). Mirrors
-- 20260429040000_location_posting_accounts. All nullable; QBO-connected
-- locations require pins, non-QBO fall back via type-matched chart row.

ALTER TABLE "locations"
  ADD COLUMN IF NOT EXISTS "defaultRevenueGlAccountId"   TEXT,
  ADD COLUMN IF NOT EXISTS "salesTaxGlAccountId"         TEXT,
  ADD COLUMN IF NOT EXISTS "earlyTerminationGlAccountId" TEXT,
  ADD COLUMN IF NOT EXISTS "achReturnFeeGlAccountId"     TEXT;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'locations'
      AND constraint_name = 'locations_defaultRevenueGlAccountId_fkey'
  ) THEN
    ALTER TABLE "locations"
      ADD CONSTRAINT "locations_defaultRevenueGlAccountId_fkey"
      FOREIGN KEY ("defaultRevenueGlAccountId") REFERENCES "gl_accounts"("id") ON DELETE SET NULL;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'locations'
      AND constraint_name = 'locations_salesTaxGlAccountId_fkey'
  ) THEN
    ALTER TABLE "locations"
      ADD CONSTRAINT "locations_salesTaxGlAccountId_fkey"
      FOREIGN KEY ("salesTaxGlAccountId") REFERENCES "gl_accounts"("id") ON DELETE SET NULL;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'locations'
      AND constraint_name = 'locations_earlyTerminationGlAccountId_fkey'
  ) THEN
    ALTER TABLE "locations"
      ADD CONSTRAINT "locations_earlyTerminationGlAccountId_fkey"
      FOREIGN KEY ("earlyTerminationGlAccountId") REFERENCES "gl_accounts"("id") ON DELETE SET NULL;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'locations'
      AND constraint_name = 'locations_achReturnFeeGlAccountId_fkey'
  ) THEN
    ALTER TABLE "locations"
      ADD CONSTRAINT "locations_achReturnFeeGlAccountId_fkey"
      FOREIGN KEY ("achReturnFeeGlAccountId") REFERENCES "gl_accounts"("id") ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "locations_defaultRevenueGlAccountId_idx"
  ON "locations"("defaultRevenueGlAccountId");
CREATE INDEX IF NOT EXISTS "locations_salesTaxGlAccountId_idx"
  ON "locations"("salesTaxGlAccountId");
CREATE INDEX IF NOT EXISTS "locations_earlyTerminationGlAccountId_idx"
  ON "locations"("earlyTerminationGlAccountId");
CREATE INDEX IF NOT EXISTS "locations_achReturnFeeGlAccountId_idx"
  ON "locations"("achReturnFeeGlAccountId");
