-- Migration: SaaS Billing Depth
--
-- Adds coupons, redemptions, refunds, and plan-change tracking for the
-- platform's own SaaS subscription billing, plus extends saas_invoices
-- with discount, refund, dunning, and write-off fields.

-- ── 1. Extend saas_invoices ────────────────────────────────────────────────
ALTER TABLE "saas_invoices"
  ADD COLUMN "discountCents"      INTEGER       NOT NULL DEFAULT 0,
  ADD COLUMN "refundedCents"      INTEGER       NOT NULL DEFAULT 0,
  ADD COLUMN "dueDate"            TIMESTAMP(3),
  ADD COLUMN "failedAttempts"     INTEGER       NOT NULL DEFAULT 0,
  ADD COLUMN "lastAttemptAt"      TIMESTAMP(3),
  ADD COLUMN "nextRetryAt"        TIMESTAMP(3),
  ADD COLUMN "dunningPaused"      BOOLEAN       NOT NULL DEFAULT FALSE,
  ADD COLUMN "pausedUntil"        TIMESTAMP(3),
  ADD COLUMN "writeOffAt"         TIMESTAMP(3),
  ADD COLUMN "writeOffReason"     TEXT,
  ADD COLUMN "couponRedemptionId" TEXT,
  ADD COLUMN "planChangeId"       TEXT;

CREATE INDEX "saas_invoices_status_idx" ON "saas_invoices"("status");

-- ── 2. Coupon enums ────────────────────────────────────────────────────────
CREATE TYPE "SaasCouponDiscountType" AS ENUM ('PERCENT', 'FIXED', 'TRIAL_EXTENSION');
CREATE TYPE "SaasCouponDuration"     AS ENUM ('ONCE', 'REPEATING');

-- ── 3. saas_coupons ────────────────────────────────────────────────────────
CREATE TABLE "saas_coupons" (
  "id"             TEXT                       NOT NULL,
  "code"           TEXT                       NOT NULL,
  "name"           TEXT                       NOT NULL,
  "discountType"   "SaasCouponDiscountType"   NOT NULL,
  "discountValue"  INTEGER                    NOT NULL,
  "duration"       "SaasCouponDuration"       NOT NULL DEFAULT 'ONCE',
  "durationCycles" INTEGER,
  "maxRedemptions" INTEGER,
  "active"         BOOLEAN                    NOT NULL DEFAULT TRUE,
  "notes"          TEXT,
  "createdAt"      TIMESTAMP(3)               NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3)               NOT NULL,

  CONSTRAINT "saas_coupons_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "saas_coupons_code_key" ON "saas_coupons"("code");

-- ── 4. saas_coupon_redemptions ─────────────────────────────────────────────
CREATE TABLE "saas_coupon_redemptions" (
  "id"                   TEXT         NOT NULL,
  "couponId"             TEXT         NOT NULL,
  "tenantId"             TEXT         NOT NULL,
  "active"               BOOLEAN      NOT NULL DEFAULT TRUE,
  "cyclesRemaining"      INTEGER,
  "redeemedAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastAppliedAt"        TIMESTAMP(3),
  "lastAppliedInvoiceId" TEXT,

  CONSTRAINT "saas_coupon_redemptions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "saas_coupon_redemptions_couponId_fkey"
    FOREIGN KEY ("couponId") REFERENCES "saas_coupons"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "saas_coupon_redemptions_couponId_tenantId_key"
  ON "saas_coupon_redemptions"("couponId", "tenantId");
CREATE INDEX "saas_coupon_redemptions_tenantId_idx"
  ON "saas_coupon_redemptions"("tenantId");

-- ── 5. saas_invoice_refunds ────────────────────────────────────────────────
CREATE TABLE "saas_invoice_refunds" (
  "id"            TEXT         NOT NULL,
  "saasInvoiceId" TEXT         NOT NULL,
  "amountCents"   INTEGER      NOT NULL,
  "reason"        TEXT         NOT NULL,
  "notes"         TEXT,
  "createdBy"     TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "saas_invoice_refunds_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "saas_invoice_refunds_saasInvoiceId_fkey"
    FOREIGN KEY ("saasInvoiceId") REFERENCES "saas_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "saas_invoice_refunds_saasInvoiceId_idx"
  ON "saas_invoice_refunds"("saasInvoiceId");

-- ── 6. saas_plan_changes ───────────────────────────────────────────────────
CREATE TABLE "saas_plan_changes" (
  "id"                 TEXT         NOT NULL,
  "tenantId"           TEXT         NOT NULL,
  "fromTierId"         TEXT,
  "toTierId"           TEXT         NOT NULL,
  "prorationCents"     INTEGER      NOT NULL,
  "effectiveAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "appliedToInvoiceId" TEXT,
  "createdBy"          TEXT,
  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "saas_plan_changes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "saas_plan_changes_tenantId_idx" ON "saas_plan_changes"("tenantId");
