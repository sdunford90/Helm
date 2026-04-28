-- Migration: Product Categories with GL & tax defaults
--
-- Adds a `product_categories` table that owns default GL accounts (revenue,
-- COGS, inventory asset) and a default tax category for inventory items.
-- Adds a nullable `productCategoryId` FK to `products` so each product can
-- inherit those defaults; per-product columns continue to act as overrides.
--
-- Backwards-compatible: legacy `products.category` (free-text) and
-- `products.taxClass` columns are kept; existing products without a category
-- assigned behave exactly as before.

-- ── product_categories table ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "product_categories" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "defaultRevenueGlAccountId" TEXT,
    "defaultCogsGlAccountId" TEXT,
    "defaultInventoryAssetGlAccountId" TEXT,
    "defaultTaxCategory" TEXT,
    "taxable" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_categories_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "product_categories_tenantId_idx" ON "product_categories"("tenantId");
CREATE UNIQUE INDEX IF NOT EXISTS "product_categories_tenantId_name_key" ON "product_categories"("tenantId", "name");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'product_categories_defaultRevenueGlAccountId_fkey'
      AND table_name = 'product_categories') THEN
    ALTER TABLE "product_categories" ADD CONSTRAINT "product_categories_defaultRevenueGlAccountId_fkey"
      FOREIGN KEY ("defaultRevenueGlAccountId") REFERENCES "gl_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'product_categories_defaultCogsGlAccountId_fkey'
      AND table_name = 'product_categories') THEN
    ALTER TABLE "product_categories" ADD CONSTRAINT "product_categories_defaultCogsGlAccountId_fkey"
      FOREIGN KEY ("defaultCogsGlAccountId") REFERENCES "gl_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'product_categories_defaultInventoryAssetGlAccountId_fkey'
      AND table_name = 'product_categories') THEN
    ALTER TABLE "product_categories" ADD CONSTRAINT "product_categories_defaultInventoryAssetGlAccountId_fkey"
      FOREIGN KEY ("defaultInventoryAssetGlAccountId") REFERENCES "gl_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- ── products.productCategoryId ───────────────────────────────────────────────
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "productCategoryId" TEXT;

CREATE INDEX IF NOT EXISTS "products_productCategoryId_idx" ON "products"("productCategoryId");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'products_productCategoryId_fkey'
      AND table_name = 'products') THEN
    ALTER TABLE "products" ADD CONSTRAINT "products_productCategoryId_fkey"
      FOREIGN KEY ("productCategoryId") REFERENCES "product_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
