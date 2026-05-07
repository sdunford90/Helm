-- Adds an optional idempotency token to Payment so the manual record-payment
-- route can pre-write a PENDING stub before calling Stripe without
-- duplicating rows under client retries. Mirrors Stripe's PaymentIntent
-- idempotency key.
ALTER TABLE "payments" ADD COLUMN "idempotencyKey" TEXT;

CREATE UNIQUE INDEX "payments_tenantId_idempotencyKey_key"
  ON "payments"("tenantId", "idempotencyKey");
