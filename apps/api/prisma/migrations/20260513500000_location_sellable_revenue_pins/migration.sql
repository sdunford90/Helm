-- Plan 6 — Sellable-thing revenue pins per location.
--
-- Each pin tells the GL resolver where to credit revenue for that kind of
-- sale. Falls back to defaultRevenueGlAccountId when null. Surfaced by the
-- Accounting Completeness report so operators know which streams are still
-- landing in the default bucket.

ALTER TABLE "locations"
  ADD COLUMN IF NOT EXISTS "transientRevenueGlAccountId"   TEXT,
  ADD COLUMN IF NOT EXISTS "rampRevenueGlAccountId"        TEXT,
  ADD COLUMN IF NOT EXISTS "conciergeRevenueGlAccountId"   TEXT,
  ADD COLUMN IF NOT EXISTS "fuelRevenueGlAccountId"        TEXT,
  ADD COLUMN IF NOT EXISTS "electricityRevenueGlAccountId" TEXT;

ALTER TABLE "locations"
  ADD CONSTRAINT "locations_transientRevenueGlAccountId_fkey"
  FOREIGN KEY ("transientRevenueGlAccountId") REFERENCES "gl_accounts"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "locations"
  ADD CONSTRAINT "locations_rampRevenueGlAccountId_fkey"
  FOREIGN KEY ("rampRevenueGlAccountId") REFERENCES "gl_accounts"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "locations"
  ADD CONSTRAINT "locations_conciergeRevenueGlAccountId_fkey"
  FOREIGN KEY ("conciergeRevenueGlAccountId") REFERENCES "gl_accounts"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "locations"
  ADD CONSTRAINT "locations_fuelRevenueGlAccountId_fkey"
  FOREIGN KEY ("fuelRevenueGlAccountId") REFERENCES "gl_accounts"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "locations"
  ADD CONSTRAINT "locations_electricityRevenueGlAccountId_fkey"
  FOREIGN KEY ("electricityRevenueGlAccountId") REFERENCES "gl_accounts"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "locations_transientRevenueGlAccountId_idx"
  ON "locations" ("transientRevenueGlAccountId");
CREATE INDEX IF NOT EXISTS "locations_rampRevenueGlAccountId_idx"
  ON "locations" ("rampRevenueGlAccountId");
CREATE INDEX IF NOT EXISTS "locations_conciergeRevenueGlAccountId_idx"
  ON "locations" ("conciergeRevenueGlAccountId");
CREATE INDEX IF NOT EXISTS "locations_fuelRevenueGlAccountId_idx"
  ON "locations" ("fuelRevenueGlAccountId");
CREATE INDEX IF NOT EXISTS "locations_electricityRevenueGlAccountId_idx"
  ON "locations" ("electricityRevenueGlAccountId");
