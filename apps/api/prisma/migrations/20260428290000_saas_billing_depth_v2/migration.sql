-- SaaS billing depth v2: address code review findings
--   1. Plan-change proration becomes a line on the next monthly invoice
--      (via new prorationCents column) instead of a separate invoice row.
--   2. Refunds are only allowed on paid invoices (enforced in code).
--   3. Trial-extension coupons mutate tenant.gracePeriodStartedAt at apply
--      time (no schema change needed; we just stop emitting them as a
--      discount during invoice generation).

ALTER TABLE "saas_invoices"
  ADD COLUMN IF NOT EXISTS "prorationCents" INTEGER NOT NULL DEFAULT 0;
