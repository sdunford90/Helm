-- Z-out refund-flow correctness (Task #320 round 5 review).
--
-- Adds `refundedAt` + `refundOfId` to pos_transactions so the refund
-- flow stops overwriting the original sale's tender (status). Without
-- this, every fully refunded sale lost its CASH/CARD/ACH classification,
-- which in turn broke Z-out tender totals, gross/net math, and the cash
-- drawer expected-cash formula.
--
-- Backfill strategy for legacy data:
--   1) For every existing row currently at status='REFUNDED' AND
--      totalCents > 0 we treat it as an "original" (the refund flow
--      previously overwrote its status). Set refundedAt = updatedAt
--      (best-effort timestamp; createdAt as fallback) and try to
--      recover its original tender by inspecting the matching negative
--      refund row in the same shift (same shiftId, refundTotal =
--      -original.total). When the negative row carries a usable
--      cardRail or stripePaymentIntentId, infer 'CARD'; otherwise infer
--      'CASH'. Inference is a best-effort recovery — newer rows written
--      after this migration land with explicit tender preserved.
--   2) For each negative refund row, populate refundOfId by matching
--      to a positive REFUNDED original in the same shift with equal
--      |totalCents|. Ambiguous matches (multiple candidates) are left
--      null; the application code tolerates this for legacy rows.

ALTER TABLE "pos_transactions"
  ADD COLUMN "refundedAt" TIMESTAMP(3),
  ADD COLUMN "refundOfId" TEXT;

CREATE INDEX "pos_transactions_refundOfId_idx" ON "pos_transactions"("refundOfId");

ALTER TABLE "pos_transactions"
  ADD CONSTRAINT "pos_transactions_refundOfId_fkey"
  FOREIGN KEY ("refundOfId") REFERENCES "pos_transactions"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Step 1: stamp refundedAt on legacy positive REFUNDED originals.
UPDATE "pos_transactions"
SET "refundedAt" = "createdAt"
WHERE "status" = 'REFUNDED' AND "totalCents" > 0;

-- Step 2: link refund rows back to their originals when an unambiguous
-- match exists in the same shift.
WITH candidates AS (
  SELECT
    r."id"   AS refund_id,
    o."id"   AS original_id,
    COUNT(*) OVER (PARTITION BY r."id") AS match_count
  FROM "pos_transactions" r
  JOIN "pos_transactions" o
    ON o."tenantId"   = r."tenantId"
   AND o."shiftId" IS NOT NULL
   AND o."shiftId"    = r."shiftId"
   AND o."status"     = 'REFUNDED'
   AND o."totalCents" = -r."totalCents"
   AND o."totalCents" > 0
  WHERE r."status" = 'REFUNDED'
    AND r."totalCents" < 0
)
UPDATE "pos_transactions" r
SET "refundOfId" = c.original_id
FROM candidates c
WHERE r."id" = c.refund_id
  AND c.match_count = 1;

-- Step 3: recover original tender on legacy positive REFUNDED rows.
-- When the matched refund row carries card metadata, the original was a
-- card sale; otherwise treat it as cash. Rows that couldn't be linked
-- in step 2 stay at status='REFUNDED' (the application falls back to
-- legacy behavior for them).
UPDATE "pos_transactions" o
SET "status" = CASE
    WHEN r."cardRail" IS NOT NULL OR r."stripePaymentIntentId" IS NOT NULL
      THEN 'CARD'
    ELSE 'CASH'
  END,
  "cardRail" = COALESCE(o."cardRail", r."cardRail")
FROM "pos_transactions" r
WHERE r."refundOfId" = o."id"
  AND o."status" = 'REFUNDED'
  AND o."totalCents" > 0;
