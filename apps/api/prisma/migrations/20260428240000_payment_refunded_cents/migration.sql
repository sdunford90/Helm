-- Migration: Track partial-refund history per payment
--
-- Adds `refundedCents` to `payments` so multiple partial refunds against the
-- same payment add up correctly and refund handlers can validate against the
-- remaining (not original) balance instead of the original amount on every
-- call. Backfills existing rows: fully-refunded payments get the full amount,
-- partially-refunded payments get the full amount as a conservative default
-- (we have no per-refund ledger yet, so prior partials are treated as having
-- exhausted the balance — this keeps over-refund safe).

ALTER TABLE "payments"
  ADD COLUMN "refundedCents" INTEGER NOT NULL DEFAULT 0;

UPDATE "payments"
  SET "refundedCents" = "amountCents"
  WHERE "status" IN ('REFUNDED', 'PARTIALLY_REFUNDED');
