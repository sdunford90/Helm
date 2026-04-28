-- Migration: Card-Expiry Reminder Idempotency Table
--
-- Tracks which "saved card is about to expire" emails have already been
-- sent so the daily job is safe to rerun without double-sending.
-- The unique index on (tenantId, stripePaymentMethodId, expMonth, expYear,
-- window) ensures one row per card-expiry-month per window (30-day, 7-day).

CREATE TABLE "card_expiry_reminders" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "stripePaymentMethodId" TEXT NOT NULL,
    "stripeAccountId" TEXT,
    "brand" TEXT,
    "last4" TEXT,
    "expMonth" INTEGER NOT NULL,
    "expYear" INTEGER NOT NULL,
    "window" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reservedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "card_expiry_reminders_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "card_expiry_reminders_tenant_pm_expiry_window_key"
    ON "card_expiry_reminders"("tenantId", "stripePaymentMethodId", "expMonth", "expYear", "window");

CREATE INDEX "card_expiry_reminders_tenantId_idx"
    ON "card_expiry_reminders"("tenantId");

CREATE INDEX "card_expiry_reminders_customerId_idx"
    ON "card_expiry_reminders"("customerId");

ALTER TABLE "card_expiry_reminders"
    ADD CONSTRAINT "card_expiry_reminders_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "customers"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
