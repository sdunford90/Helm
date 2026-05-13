-- Plan 5 — Location pins for the GL accounts used by POS Z-out.
--
-- Previously pos-zout.ts looked these up by hardcoded account number
-- (1000, 1010, 1015, 2210, 5900). On QBO-imported charts those numbers
-- don't exist (accountNumber is "QBO-NN"), so the lookup either fell
-- through to auto-create at tenant-wide scope or returned the wrong
-- location's row. With explicit FK pins per Location, the resolver
-- prefers the pin and only walks the legacy number path for non-QBO
-- tenants.

ALTER TABLE "locations"
  ADD COLUMN IF NOT EXISTS "cashGlAccountId"             TEXT,
  ADD COLUMN IF NOT EXISTS "stripeClearingGlAccountId"   TEXT,
  ADD COLUMN IF NOT EXISTS "achClearingGlAccountId"      TEXT,
  ADD COLUMN IF NOT EXISTS "tipsPayableGlAccountId"      TEXT,
  ADD COLUMN IF NOT EXISTS "cashOverShortGlAccountId"    TEXT;

ALTER TABLE "locations"
  ADD CONSTRAINT "locations_cashGlAccountId_fkey"
  FOREIGN KEY ("cashGlAccountId") REFERENCES "gl_accounts"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "locations"
  ADD CONSTRAINT "locations_stripeClearingGlAccountId_fkey"
  FOREIGN KEY ("stripeClearingGlAccountId") REFERENCES "gl_accounts"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "locations"
  ADD CONSTRAINT "locations_achClearingGlAccountId_fkey"
  FOREIGN KEY ("achClearingGlAccountId") REFERENCES "gl_accounts"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "locations"
  ADD CONSTRAINT "locations_tipsPayableGlAccountId_fkey"
  FOREIGN KEY ("tipsPayableGlAccountId") REFERENCES "gl_accounts"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "locations"
  ADD CONSTRAINT "locations_cashOverShortGlAccountId_fkey"
  FOREIGN KEY ("cashOverShortGlAccountId") REFERENCES "gl_accounts"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "locations_cashGlAccountId_idx"
  ON "locations" ("cashGlAccountId");
CREATE INDEX IF NOT EXISTS "locations_stripeClearingGlAccountId_idx"
  ON "locations" ("stripeClearingGlAccountId");
CREATE INDEX IF NOT EXISTS "locations_achClearingGlAccountId_idx"
  ON "locations" ("achClearingGlAccountId");
CREATE INDEX IF NOT EXISTS "locations_tipsPayableGlAccountId_idx"
  ON "locations" ("tipsPayableGlAccountId");
CREATE INDEX IF NOT EXISTS "locations_cashOverShortGlAccountId_idx"
  ON "locations" ("cashOverShortGlAccountId");
