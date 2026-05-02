-- Migration: store the Stripe PaymentIntent id on each POS card sale
--
-- POS card-not-present (and Terminal) sales create a PaymentIntent on the
-- connected account, but the resulting `pos_transactions` row didn't store
-- the PI id. End-of-day GL reconciliation, refund flows, and Stripe dispute
-- matching had to be done by amount + timestamp, which is fragile when
-- multiple sales for the same amount happen close together.
--
-- Adding `stripePaymentIntentId` (nullable, mirrors the existing column on
-- payments / reservations) lets us store Stripe's id at sale time and use
-- it as the join key for refunds and reconciliation. Null for non-card
-- sales (cash/ACH/charge) and for legacy rows from before this migration.

ALTER TABLE "pos_transactions"
  ADD COLUMN IF NOT EXISTS "stripePaymentIntentId" TEXT;

-- Also persist the *connected Stripe account* the PaymentIntent was created
-- against. Without this, the refund handler would have to re-resolve the
-- account via shift → location at refund time, which is non-deterministic
-- when the sale carried no shift, or when location ↔ Stripe-account mappings
-- change between sale and refund. Storing the account at sale time guarantees
-- refunds always hit the same connected account that captured the original
-- charge. Null for non-card sales and legacy pre-migration rows.
ALTER TABLE "pos_transactions"
  ADD COLUMN IF NOT EXISTS "stripeAccountId" TEXT;
