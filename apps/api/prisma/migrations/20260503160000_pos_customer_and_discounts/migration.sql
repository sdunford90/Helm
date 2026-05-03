-- POS customer attachment + per-location auto-applied discounts
--
-- Adds:
--   1. pos_transactions.customerId               (nullable FK to customers)
--   2. pos_line_items.appliedDiscountId          (nullable FK to pos_discounts)
--      pos_line_items.discountSourceLabel        (snapshot of discount name)
--   3. PosDiscountKind enum                      (PERCENT | AMOUNT)
--   4. pos_discounts table                       (per-location config)
--   5. pos_discount_customers join table         (per-discount eligible customers)
--
-- Backwards compatible: every new column is nullable / default-safe and
-- nothing existing is altered. Old POS sales (anonymous, no discount) keep
-- working unchanged.

-- 1. Customer attachment on POS sales
ALTER TABLE "pos_transactions"
  ADD COLUMN IF NOT EXISTS "customerId" TEXT;

CREATE INDEX IF NOT EXISTS "pos_transactions_customerId_idx"
  ON "pos_transactions" ("customerId");

ALTER TABLE "pos_transactions"
  ADD CONSTRAINT "pos_transactions_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "customers"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- 3. Discount kind enum
DO $$ BEGIN
  CREATE TYPE "PosDiscountKind" AS ENUM ('PERCENT', 'AMOUNT');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- 4. Per-location auto-applied discount rules
CREATE TABLE IF NOT EXISTS "pos_discounts" (
  "id"                    TEXT NOT NULL,
  "tenantId"              TEXT NOT NULL,
  "locationId"            TEXT NOT NULL,
  "name"                  TEXT NOT NULL,
  "kind"                  "PosDiscountKind" NOT NULL,
  "value"                 INTEGER NOT NULL,
  "productCategoryId"     TEXT,
  "productId"             TEXT,
  "appliesToAllCustomers" BOOLEAN NOT NULL DEFAULT false,
  "active"                BOOLEAN NOT NULL DEFAULT true,
  "createdAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"             TIMESTAMP(3) NOT NULL,
  CONSTRAINT "pos_discounts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pos_discounts_locationId_fkey"
    FOREIGN KEY ("locationId") REFERENCES "locations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "pos_discounts_productCategoryId_fkey"
    FOREIGN KEY ("productCategoryId") REFERENCES "product_categories"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "pos_discounts_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "products"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "pos_discounts_tenantId_idx"
  ON "pos_discounts" ("tenantId");
CREATE INDEX IF NOT EXISTS "pos_discounts_locationId_active_idx"
  ON "pos_discounts" ("locationId", "active");
CREATE INDEX IF NOT EXISTS "pos_discounts_productCategoryId_idx"
  ON "pos_discounts" ("productCategoryId");
CREATE INDEX IF NOT EXISTS "pos_discounts_productId_idx"
  ON "pos_discounts" ("productId");

-- 5. Eligible-customer join table (only consulted when appliesToAllCustomers=false)
CREATE TABLE IF NOT EXISTS "pos_discount_customers" (
  "posDiscountId" TEXT NOT NULL,
  "customerId"    TEXT NOT NULL,
  CONSTRAINT "pos_discount_customers_pkey" PRIMARY KEY ("posDiscountId", "customerId"),
  CONSTRAINT "pos_discount_customers_posDiscountId_fkey"
    FOREIGN KEY ("posDiscountId") REFERENCES "pos_discounts"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "pos_discount_customers_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "customers"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "pos_discount_customers_customerId_idx"
  ON "pos_discount_customers" ("customerId");

-- 2. Audit fields on POS line items for the auto-applied discount.
-- discountCents already exists — we just add the trail of WHICH discount won.
ALTER TABLE "pos_line_items"
  ADD COLUMN IF NOT EXISTS "appliedDiscountId"   TEXT,
  ADD COLUMN IF NOT EXISTS "discountSourceLabel" TEXT;

ALTER TABLE "pos_line_items"
  ADD CONSTRAINT "pos_line_items_appliedDiscountId_fkey"
  FOREIGN KEY ("appliedDiscountId") REFERENCES "pos_discounts"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
