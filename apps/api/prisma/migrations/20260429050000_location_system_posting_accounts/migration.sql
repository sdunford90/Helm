-- Migration: Per-location SYSTEM posting accounts (default revenue, sales
-- tax payable, early-termination income, ACH return fee).
--
-- Mirrors `20260429040000_location_posting_accounts` (A/R, undeposited funds,
-- deferred revenue) for the four account-number fallbacks gl-posting.ts used
-- to silently lean on (4500, 2400, 4700, 4600). Without these pins, multi-
-- property tenants whose per-location QBO charts share account numbers
-- across realms either threw "GL account 4500 not found for tenant …"
-- (because the seeded chart only contains 4010-4100) or, worse, picked a
-- row bound to a different QBO realm and silently mis-routed the entry.
--
-- All four columns are nullable. gl-account-resolver.ts'
-- `resolveLocationSystemPostingAccount` enforces the contract per slot:
--   * pinned column wins;
--   * QBO-connected locations REQUIRE the pin (else throw
--     UNCONFIGURED_GL_MAPPING);
--   * non-QBO locations fall back to the legacy account-number lookup so
--     single-chart tenants keep posting unchanged.

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
