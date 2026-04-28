-- Migration: Per-refund history table for partial/full refunds
--
-- `Payment.refundedCents` (added in 20260428240000_payment_refunded_cents) is
-- a fast-running total used for remaining-balance checks. This migration adds
-- the underlying ledger so the UI can show every refund as its own line —
-- date, amount, reason, and who issued it. Each row is created inside the
-- same transaction that bumps `refundedCents`; the rollback path deletes the
-- row if the external Stripe refund call fails.
--
-- Backfill: existing payments whose `refundedCents` > 0 (mostly produced by
-- the previous migration's conservative full-amount backfill or by refunds
-- issued before this table existed) get a single synthetic refund row so the
-- expandable history isn't empty for those payments. The synthetic row is
-- marked `source = 'BACKFILL'` and `reason = 'Refunded before per-refund
-- history was tracked'` so it's distinguishable from refunds issued through
-- the new code path. `createdAt` is set to the payment's `createdAt` so the
-- backfilled row sorts correctly relative to any subsequent partial refunds.

CREATE TABLE "payment_refunds" (
    "id"             TEXT        NOT NULL,
    "tenantId"       TEXT        NOT NULL,
    "paymentId"      TEXT        NOT NULL,
    "amountCents"    INTEGER     NOT NULL,
    "reason"         TEXT,
    "userId"         TEXT,
    "userName"       TEXT,
    "stripeRefundId" TEXT,
    "isFullRefund"   BOOLEAN     NOT NULL DEFAULT false,
    "source"         TEXT,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_refunds_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "payment_refunds_tenantId_idx" ON "payment_refunds"("tenantId");
CREATE INDEX "payment_refunds_paymentId_createdAt_idx" ON "payment_refunds"("paymentId", "createdAt");

ALTER TABLE "payment_refunds"
    ADD CONSTRAINT "payment_refunds_paymentId_fkey"
    FOREIGN KEY ("paymentId") REFERENCES "payments"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill one synthetic row per already-refunded payment so the new
-- expandable UI isn't empty for legacy data. We use gen_random_uuid()
-- (available on Postgres 13+, which Prisma requires) for the primary key.
INSERT INTO "payment_refunds" (
    "id", "tenantId", "paymentId", "amountCents", "reason",
    "userId", "userName", "stripeRefundId", "isFullRefund",
    "source", "createdAt"
)
SELECT
    gen_random_uuid()::text,
    p."tenantId",
    p."id",
    p."refundedCents",
    'Refunded before per-refund history was tracked',
    NULL,
    NULL,
    NULL,
    p."refundedCents" >= p."amountCents",
    'BACKFILL',
    p."createdAt"
FROM "payments" p
WHERE p."refundedCents" > 0;
