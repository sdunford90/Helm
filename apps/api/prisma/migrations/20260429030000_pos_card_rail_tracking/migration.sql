-- Migration: track POS card payment rail (Terminal vs. CNP) and CNP fallback reason
--
-- Adds two nullable columns to pos_transactions so reports can show how often
-- card sales were processed via Stripe Terminal vs. card-not-present (keyed),
-- and for keyed sales whether it was a silent fallback (no reader detected /
-- discovery failed) or an explicit cashier choice.
--
-- Both columns are nullable strings — null for non-card sales (cash/ACH/charge)
-- and for legacy rows from before this migration.

ALTER TABLE "pos_transactions"
  ADD COLUMN IF NOT EXISTS "cardRail" TEXT;

ALTER TABLE "pos_transactions"
  ADD COLUMN IF NOT EXISTS "cnpFallbackReason" TEXT;

-- Help the per-day/per-range card-mix report scan recent rows efficiently.
CREATE INDEX IF NOT EXISTS "pos_transactions_tenantId_createdAt_idx"
  ON "pos_transactions" ("tenantId", "createdAt");
