-- Migration: Finish the inventory-category-only-GL backfill on databases
-- where 20260429080000_inventory_category_only_gl failed at Step 4
-- (`ALTER TABLE "products" ALTER COLUMN "productCategoryId" SET NOT NULL`).
--
-- Root cause of the original failure:
--   The original Step 1 only inserted an "Uncategorized" ProductCategory for
--   each row in `tenants`. There is NO foreign key on `products.tenantId`
--   (verified against pg_constraint), so any product whose owning tenant
--   row had been deleted (orphan products) never had an Uncategorized seed
--   created and Step 2's UPDATE … FROM "product_categories" JOIN found no
--   row to point them at. They stayed NULL, and the SET NOT NULL in Step 4
--   blew up with `column "productCategoryId" of relation "products"
--   contains null values`.
--
-- This migration:
--   1. Seeds Uncategorized for every distinct tenantId actually present in
--      `products` (the UNION with `tenants` keeps the original behaviour
--      for tenants with no products).
--   2. Backfills any remaining NULL productCategoryId rows.
--   3. Re-attempts the SET NOT NULL.
--   4. Re-attempts the FK swap to ON DELETE RESTRICT.
--   5. Re-attempts the legacy table/column drops.
--
-- Every step is guarded with IF EXISTS / IF NOT EXISTS / ON CONFLICT so it
-- is a NO-OP on databases where 20260429080000 already completed cleanly.

-- ─── Step 1: Seed Uncategorized for every tenantId referenced by products ──

INSERT INTO "product_categories" (
  "id", "tenantId", "name",
  "defaultTaxCategory", "taxable", "active",
  "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid(), tid, 'Uncategorized',
  NULL, true, true,
  NOW(), NOW()
FROM (
  SELECT "id" AS tid FROM "tenants"
  UNION
  SELECT DISTINCT "tenantId" AS tid
    FROM "products"
   WHERE "productCategoryId" IS NULL
     AND "tenantId" IS NOT NULL
) src
ON CONFLICT ("tenantId", "name") DO NOTHING;

UPDATE "product_categories"
   SET "active" = true, "updatedAt" = NOW()
 WHERE "name" = 'Uncategorized'
   AND "active" = false;

-- ─── Step 2: Backfill any remaining NULL productCategoryId rows ────────────

UPDATE "products" p
   SET "productCategoryId" = c."id",
       "updatedAt" = NOW()
  FROM "product_categories" c
 WHERE p."productCategoryId" IS NULL
   AND c."tenantId" = p."tenantId"
   AND c."name" = 'Uncategorized';

-- Defensive sanity check — fail loudly with a useful message if any row is
-- still NULL after the seed + backfill (e.g. a product whose tenantId is
-- itself NULL, which would indicate deeper data corruption that this
-- migration should not silently paper over).
DO $$
DECLARE
  remaining BIGINT;
BEGIN
  SELECT COUNT(*) INTO remaining
    FROM "products"
   WHERE "productCategoryId" IS NULL;
  IF remaining > 0 THEN
    RAISE EXCEPTION
      'Cannot apply NOT NULL: % product row(s) still have a NULL productCategoryId after the Uncategorized backfill. Inspect: SELECT id, tenantId FROM products WHERE "productCategoryId" IS NULL;',
      remaining;
  END IF;
END $$;

-- ─── Step 3: Lock down Product.productCategoryId as NOT NULL ──────────────

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'products' AND column_name = 'productCategoryId' AND is_nullable = 'YES'
  ) THEN
    ALTER TABLE "products" ALTER COLUMN "productCategoryId" SET NOT NULL;
  END IF;
END $$;

-- ─── Step 4: Re-add FK with ON DELETE RESTRICT (matches soft-delete API) ──

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'products' AND constraint_name = 'products_productCategoryId_fkey'
  ) THEN
    -- Inspect the FK's delete action; only swap if it's still SET NULL.
    IF EXISTS (
      SELECT 1
        FROM pg_constraint
       WHERE conname = 'products_productCategoryId_fkey'
         AND conrelid = 'products'::regclass
         AND confdeltype <> 'r'  -- 'r' = RESTRICT
    ) THEN
      ALTER TABLE "products" DROP CONSTRAINT "products_productCategoryId_fkey";
    END IF;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'products' AND constraint_name = 'products_productCategoryId_fkey'
  ) THEN
    ALTER TABLE "products"
      ADD CONSTRAINT "products_productCategoryId_fkey"
      FOREIGN KEY ("productCategoryId") REFERENCES "product_categories"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- ─── Step 5: Drop the per-product GL mapping table ────────────────────────

DROP TABLE IF EXISTS "product_gl_mappings" CASCADE;

-- ─── Step 6: Drop legacy GL columns (FKs first, then columns) ─────────────

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE table_name = 'products' AND constraint_name = 'products_revenueGlAccountId_fkey') THEN
    ALTER TABLE "products" DROP CONSTRAINT "products_revenueGlAccountId_fkey";
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE table_name = 'products' AND constraint_name = 'products_cogsGlAccountId_fkey') THEN
    ALTER TABLE "products" DROP CONSTRAINT "products_cogsGlAccountId_fkey";
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE table_name = 'products' AND constraint_name = 'products_inventoryAssetGlAccountId_fkey') THEN
    ALTER TABLE "products" DROP CONSTRAINT "products_inventoryAssetGlAccountId_fkey";
  END IF;
END $$;

ALTER TABLE "products" DROP COLUMN IF EXISTS "revenueGlAccountId";
ALTER TABLE "products" DROP COLUMN IF EXISTS "cogsGlAccountId";
ALTER TABLE "products" DROP COLUMN IF EXISTS "inventoryAssetGlAccountId";

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE table_name = 'product_categories' AND constraint_name = 'product_categories_defaultRevenueGlAccountId_fkey') THEN
    ALTER TABLE "product_categories" DROP CONSTRAINT "product_categories_defaultRevenueGlAccountId_fkey";
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE table_name = 'product_categories' AND constraint_name = 'product_categories_defaultCogsGlAccountId_fkey') THEN
    ALTER TABLE "product_categories" DROP CONSTRAINT "product_categories_defaultCogsGlAccountId_fkey";
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE table_name = 'product_categories' AND constraint_name = 'product_categories_defaultInventoryAssetGlAccountId_fkey') THEN
    ALTER TABLE "product_categories" DROP CONSTRAINT "product_categories_defaultInventoryAssetGlAccountId_fkey";
  END IF;
END $$;

ALTER TABLE "product_categories" DROP COLUMN IF EXISTS "defaultRevenueGlAccountId";
ALTER TABLE "product_categories" DROP COLUMN IF EXISTS "defaultCogsGlAccountId";
ALTER TABLE "product_categories" DROP COLUMN IF EXISTS "defaultInventoryAssetGlAccountId";
