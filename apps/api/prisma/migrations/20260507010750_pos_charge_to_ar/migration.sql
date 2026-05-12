-- Per-location opt-in to "Charge to A/R" at the POS counter (replaces the
-- legacy "Charge to Slip" button). Defaults off so behavior is unchanged
-- for existing locations until an admin enables it in Settings.
--
-- This migration is written idempotently so it can be safely re-run after
-- a partial failure (Prisma marks the migration row failed in
-- _prisma_migrations and re-attempts on the next `migrate deploy` once an
-- operator clears the failed row).
ALTER TABLE "locations"
  ADD COLUMN IF NOT EXISTS "posChargeToARAllowed" BOOLEAN NOT NULL DEFAULT false;

-- Link a POS sale to the A/R invoice it produced (only set for
-- CHARGE_TO_AR sales; null for cash/card/ACH/legacy).
ALTER TABLE "pos_transactions"
  ADD COLUMN IF NOT EXISTS "invoiceId" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pos_transactions_invoiceId_fkey'
  ) THEN
    ALTER TABLE "pos_transactions"
      ADD CONSTRAINT "pos_transactions_invoiceId_fkey"
      FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "pos_transactions_invoiceId_idx"
  ON "pos_transactions"("invoiceId");
