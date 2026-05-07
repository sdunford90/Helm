-- Per-location opt-in to "Charge to A/R" at the POS counter (replaces the
-- legacy "Charge to Slip" button). Defaults off so behavior is unchanged
-- for existing locations until an admin enables it in Settings.
ALTER TABLE "locations"
  ADD COLUMN "posChargeToARAllowed" BOOLEAN NOT NULL DEFAULT false;

-- Link a POS sale to the A/R invoice it produced (only set for
-- CHARGE_TO_AR sales; null for cash/card/ACH/legacy).
ALTER TABLE "pos_transactions"
  ADD COLUMN "invoiceId" TEXT;

ALTER TABLE "pos_transactions"
  ADD CONSTRAINT "pos_transactions_invoiceId_fkey"
  FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "pos_transactions_invoiceId_idx" ON "pos_transactions"("invoiceId");
