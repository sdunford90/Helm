-- Task #338: Expand DockageRate with plan-name, billing cadence, and a
-- seasonal rate slot so a single rate plan can drive monthly, quarterly,
-- annual, or seasonal contracts. Effective-date columns
-- (effectiveFrom/effectiveTo) already exist; the contract picker and
-- billing engine consult them now.
--
-- Idempotent so it can replay on environments where some columns/types
-- already exist.

-- BillingCadence enum
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'BillingCadence'
  ) THEN
    CREATE TYPE "BillingCadence" AS ENUM ('MONTHLY','QUARTERLY','ANNUAL','SEASONAL');
  END IF;
END $$;

-- New columns
ALTER TABLE "dockage_rates"
  ADD COLUMN IF NOT EXISTS "name" TEXT,
  ADD COLUMN IF NOT EXISTS "seasonalRateCents" INTEGER,
  ADD COLUMN IF NOT EXISTS "billingCadence" "BillingCadence" NOT NULL DEFAULT 'MONTHLY';
