-- Migration: Add locationId to security_deposits so postSecurityDeposit /
-- releaseSecurityDeposit always credit/debit the originating marina's
-- bank and security-deposits-held accounts under its per-location chart
-- of accounts.
--
-- The column is nullable so existing rows that pre-date the change keep
-- working; legacy callers that don't pass a locationId fall through to
-- the previous tenant-wide account lookup behaviour.
--
-- We backfill from the linked contract's slip's locationId in the same
-- migration so multi-marina tenants don't have a window where deposits
-- are unattributed.

ALTER TABLE "security_deposits"
  ADD COLUMN IF NOT EXISTS "locationId" TEXT;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'security_deposits_locationId_fkey'
  ) THEN
    ALTER TABLE "security_deposits"
      ADD CONSTRAINT "security_deposits_locationId_fkey"
      FOREIGN KEY ("locationId") REFERENCES "locations"("id")
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "security_deposits_locationId_idx"
  ON "security_deposits"("locationId");

-- Backfill: for any existing deposit whose contract -> slip has a
-- locationId, copy it onto the deposit row.  Deposits with no contract
-- (rare / legacy) stay null and fall back to the tenant-wide chart at
-- posting time.
UPDATE "security_deposits" sd
SET "locationId" = s."locationId"
FROM "slip_contracts" c
JOIN "slips" s ON s."id" = c."slipId"
WHERE sd."contractId" = c."id"
  AND sd."locationId" IS NULL
  AND s."locationId" IS NOT NULL;
