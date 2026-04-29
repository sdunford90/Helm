-- Migration: Collapse inventory GL to per-location ProductCategoryGlMapping ONLY
--
-- Before: GL accounts for an inventory product resolved through a 4-rung chain:
--   1. ProductGlMapping     (per-product per-location override)
--   2. ProductCategoryGlMapping (per-category per-location default)
--   3. Product.{revenue,cogs,inventoryAsset}GlAccountId        (legacy tenant-wide product FK)
--   4. ProductCategory.default{Revenue,Cogs,InventoryAsset}GlAccountId (legacy tenant-wide category FK)
--
-- After: ONE source of truth — ProductCategoryGlMapping(productCategoryId,
-- locationId). Every inventory product belongs to exactly one ProductCategory
-- (productCategoryId is now NOT NULL with a per-tenant "Uncategorized" fallback).
-- Posting consumers fail loudly when a category has no mapping for the
-- target location.
--
-- This migration must be safe to replay (P3009 recovery): every step is
-- guarded with IF EXISTS / IF NOT EXISTS / ON CONFLICT DO NOTHING so partial
-- application leaves the system in a forward-compatible state.

-- ─── Step 1: Seed an "Uncategorized" ProductCategory per tenant ──────────────
-- The unique index on (tenantId, name) makes ON CONFLICT a no-op when the row
-- already exists. We also reactivate any soft-deleted Uncategorized rows so a
-- prior cleanup doesn't leave the seed orphaned and unselectable.

-- The legacy default*GlAccountId columns are dropped in Step 6, so the
-- INSERT only references columns that survive past this migration. On a
-- replay (P3009), the dropped columns are gone entirely; the INSERT below
-- still works because it never names them.
INSERT INTO "product_categories" (
  "id", "tenantId", "name",
  "defaultTaxCategory", "taxable", "active",
  "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid(), t."id", 'Uncategorized',
  NULL, true, true,
  NOW(), NOW()
FROM "tenants" t
ON CONFLICT ("tenantId", "name") DO NOTHING;

UPDATE "product_categories"
   SET "active" = true, "updatedAt" = NOW()
 WHERE "name" = 'Uncategorized'
   AND "active" = false;

-- ─── Step 2: Backfill Product.productCategoryId to Uncategorized ─────────────
-- Any product with a NULL productCategoryId gets pointed at its tenant's
-- Uncategorized seed so the upcoming NOT NULL constraint succeeds. Existing
-- categorizations are preserved.

UPDATE "products" p
   SET "productCategoryId" = c."id",
       "updatedAt" = NOW()
  FROM "product_categories" c
 WHERE p."productCategoryId" IS NULL
   AND c."tenantId" = p."tenantId"
   AND c."name" = 'Uncategorized';

-- ─── Step 3: Backfill ProductCategoryGlMapping in priority order ─────────────
-- Each pass uses ON CONFLICT (productCategoryId, locationId) DO NOTHING so a
-- higher-priority source wins. Slot-level merging across products in the
-- same category isn't attempted — the first matching (cat, loc) row inserts
-- whatever slots it has, lower-priority sources fill (cat, loc) pairs that
-- nothing higher up touched. Operators can refine via the per-location
-- editor in Settings → Categories.

-- Priority 1: existing ProductGlMapping rows (per-product per-location overrides).
-- For each (categoryId, locationId) without a category mapping yet, take the
-- first product mapping (lowest createdAt for determinism) for any product in
-- that category at that location.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'product_gl_mappings') THEN
    INSERT INTO "product_category_gl_mappings" (
      "id", "tenantId", "productCategoryId", "locationId",
      "revenueGlAccountId", "cogsGlAccountId", "inventoryAssetGlAccountId",
      "createdAt", "updatedAt"
    )
    SELECT DISTINCT ON (p."productCategoryId", pgm."locationId")
      gen_random_uuid(), pgm."tenantId", p."productCategoryId", pgm."locationId",
      pgm."revenueGlAccountId", pgm."cogsGlAccountId", pgm."inventoryAssetGlAccountId",
      NOW(), NOW()
    FROM "product_gl_mappings" pgm
    JOIN "products" p ON p."id" = pgm."productId"
    WHERE p."productCategoryId" IS NOT NULL
      AND (
        pgm."revenueGlAccountId" IS NOT NULL
        OR pgm."cogsGlAccountId" IS NOT NULL
        OR pgm."inventoryAssetGlAccountId" IS NOT NULL
      )
    ORDER BY p."productCategoryId", pgm."locationId", pgm."createdAt"
    ON CONFLICT ("productCategoryId", "locationId") DO NOTHING;
  END IF;
END $$;

-- Priority 2: legacy per-product fields × (cat × every location in tenant).
-- Build the (cat, loc) cross product and seed any pair still without a
-- mapping using the first product (by createdAt) in that category that has
-- non-null legacy GL fields. Wrapped in EXECUTE so a replay (after the
-- columns have been dropped in Step 6) just no-ops instead of erroring on
-- "column does not exist" at parse time.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'products' AND column_name = 'revenueGlAccountId'
  ) THEN
    EXECUTE $sql$
      INSERT INTO "product_category_gl_mappings" (
        "id", "tenantId", "productCategoryId", "locationId",
        "revenueGlAccountId", "cogsGlAccountId", "inventoryAssetGlAccountId",
        "createdAt", "updatedAt"
      )
      SELECT DISTINCT ON (p."productCategoryId", l."id")
        gen_random_uuid(), l."tenantId", p."productCategoryId", l."id",
        p."revenueGlAccountId", p."cogsGlAccountId", p."inventoryAssetGlAccountId",
        NOW(), NOW()
      FROM "products" p
      JOIN "locations" l ON l."tenantId" = p."tenantId"
      WHERE p."productCategoryId" IS NOT NULL
        AND (
          p."revenueGlAccountId" IS NOT NULL
          OR p."cogsGlAccountId" IS NOT NULL
          OR p."inventoryAssetGlAccountId" IS NOT NULL
        )
      ORDER BY p."productCategoryId", l."id", p."createdAt"
      ON CONFLICT ("productCategoryId", "locationId") DO NOTHING;
    $sql$;
  END IF;
END $$;

-- Priority 3: legacy ProductCategory.default* fields × every location in tenant.
-- For (cat, loc) pairs nothing else has filled, copy the category's tenant-wide
-- defaults to seed each location. Same EXECUTE guard as Priority 2 so a
-- replay after Step 6 dropped the columns is a no-op instead of a parse
-- error.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'product_categories' AND column_name = 'defaultRevenueGlAccountId'
  ) THEN
    EXECUTE $sql$
      INSERT INTO "product_category_gl_mappings" (
        "id", "tenantId", "productCategoryId", "locationId",
        "revenueGlAccountId", "cogsGlAccountId", "inventoryAssetGlAccountId",
        "createdAt", "updatedAt"
      )
      SELECT
        gen_random_uuid(), c."tenantId", c."id", l."id",
        c."defaultRevenueGlAccountId", c."defaultCogsGlAccountId", c."defaultInventoryAssetGlAccountId",
        NOW(), NOW()
      FROM "product_categories" c
      JOIN "locations" l ON l."tenantId" = c."tenantId"
      WHERE
        c."defaultRevenueGlAccountId" IS NOT NULL
        OR c."defaultCogsGlAccountId" IS NOT NULL
        OR c."defaultInventoryAssetGlAccountId" IS NOT NULL
      ON CONFLICT ("productCategoryId", "locationId") DO NOTHING;
    $sql$;
  END IF;
END $$;

-- ─── Step 4: Lock down Product.productCategoryId as NOT NULL ─────────────────
-- The legacy ON DELETE SET NULL behaviour is incompatible with NOT NULL —
-- swap to RESTRICT so deleting a category that still has products is rejected
-- (matches the soft-delete-only API behaviour). Drop + re-add wrapped in a
-- guard so a half-applied retry doesn't crash.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'products' AND column_name = 'productCategoryId' AND is_nullable = 'YES'
  ) THEN
    ALTER TABLE "products" ALTER COLUMN "productCategoryId" SET NOT NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'products' AND constraint_name = 'products_productCategoryId_fkey'
  ) THEN
    ALTER TABLE "products" DROP CONSTRAINT "products_productCategoryId_fkey";
  END IF;
END $$;

-- Guard the re-add so a replay doesn't trip the "constraint already exists"
-- error if the previous run completed past this point but failed later.
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

-- ─── Step 5: Drop the per-product GL mapping table ───────────────────────────
-- Drops the table along with its indexes and FKs (the FKs land on
-- product_gl_mappings, not on the parent rows, so a CASCADE drop is safe).

DROP TABLE IF EXISTS "product_gl_mappings" CASCADE;

-- ─── Step 6: Drop legacy GL columns from products and product_categories ────
-- Each column has an FK pointing at gl_accounts; drop the FK first then the
-- column. All guarded with IF EXISTS so a re-run after partial completion
-- finishes cleanly.

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
