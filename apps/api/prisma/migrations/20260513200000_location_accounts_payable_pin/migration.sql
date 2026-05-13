-- Plan 4 — Accounts-payable GL pin per location.
--
-- PO receipts now post DR Inventory Asset (from per-category mapping) and
-- CR this account. Required so receiving a PO debits inventory and credits
-- AP in a single balanced journal — historically AP was implicit and
-- inventory receipts were silent on the GL.

ALTER TABLE "locations"
  ADD COLUMN IF NOT EXISTS "accountsPayableGlAccountId" TEXT;

ALTER TABLE "locations"
  ADD CONSTRAINT "locations_accountsPayableGlAccountId_fkey"
  FOREIGN KEY ("accountsPayableGlAccountId") REFERENCES "gl_accounts"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "locations_accountsPayableGlAccountId_idx"
  ON "locations" ("accountsPayableGlAccountId");
