-- Migration: Per-location AR / Cash / Deferred Revenue posting accounts
--
-- Adds three nullable GlAccount FKs to `locations` so each marina property
-- can pin the chart-of-accounts row used for invoice A/R, payment cash /
-- undeposited funds, and deferred-revenue postings. gl-posting.ts and
-- qbo-sync.ts prefer these over the legacy tenant-wide account-number
-- lookup so multi-property tenants whose locations file separate QBO books
-- don't post into the wrong realm.

ALTER TABLE "locations"
  ADD COLUMN IF NOT EXISTS "arGlAccountId"               TEXT,
  ADD COLUMN IF NOT EXISTS "undepositedFundsGlAccountId" TEXT,
  ADD COLUMN IF NOT EXISTS "deferredRevenueGlAccountId"  TEXT;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'locations'
      AND constraint_name = 'locations_arGlAccountId_fkey'
  ) THEN
    ALTER TABLE "locations"
      ADD CONSTRAINT "locations_arGlAccountId_fkey"
      FOREIGN KEY ("arGlAccountId") REFERENCES "gl_accounts"("id") ON DELETE SET NULL;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'locations'
      AND constraint_name = 'locations_undepositedFundsGlAccountId_fkey'
  ) THEN
    ALTER TABLE "locations"
      ADD CONSTRAINT "locations_undepositedFundsGlAccountId_fkey"
      FOREIGN KEY ("undepositedFundsGlAccountId") REFERENCES "gl_accounts"("id") ON DELETE SET NULL;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'locations'
      AND constraint_name = 'locations_deferredRevenueGlAccountId_fkey'
  ) THEN
    ALTER TABLE "locations"
      ADD CONSTRAINT "locations_deferredRevenueGlAccountId_fkey"
      FOREIGN KEY ("deferredRevenueGlAccountId") REFERENCES "gl_accounts"("id") ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "locations_arGlAccountId_idx"
  ON "locations"("arGlAccountId");
CREATE INDEX IF NOT EXISTS "locations_undepositedFundsGlAccountId_idx"
  ON "locations"("undepositedFundsGlAccountId");
CREATE INDEX IF NOT EXISTS "locations_deferredRevenueGlAccountId_idx"
  ON "locations"("deferredRevenueGlAccountId");
