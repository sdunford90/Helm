-- Migration: Drop legacy Product.glAccountId column
--
-- The 20260429080000_inventory_category_only_gl migration retired the per-
-- product Revenue/COGS/Inventory triple in favor of the per-(category,
-- location) ProductCategoryGlMapping table. This migration removes the last
-- surviving legacy field — `Product.glAccountId` — that pre-dated the triple
-- split and was still being read as a third-rung fallback in qbo-sync /
-- accounting sync-health. With this column gone, inventory GL is single-rung
-- ONLY: per-(category, location) mapping → null.
--
-- Why an extra backfill is needed BEFORE the DROP COLUMN:
-- The 20260429080000 backfill chain mapped (in priority order)
--   1) product_gl_mappings,
--   2) products.revenueGlAccountId / cogsGlAccountId / inventoryAssetGlAccountId,
--   3) product_categories.default*GlAccountId.
-- It never read the older single-column `products.glAccountId` field, which
-- code paths (qbo-sync.ts, accounting.ts) had been treating as an INCOME /
-- REVENUE-slot fallback. Tenants that ever set only this field — without
-- the triple, without product_gl_mappings, without category defaults — would
-- lose their revenue mapping when the column is dropped.
--
-- We therefore run one final REVENUE-slot backfill from products.glAccountId
-- across (category × every location in the tenant), filling only the slots
-- still NULL on the destination row. The whole step is gated on the column
-- still existing so a replay (after drop) is a clean no-op.
--
-- Idempotent (P3009-safe): every step is guarded with IF EXISTS so a partial
-- replay leaves the system in a forward-compatible state.

-- ─── Step 1: Backfill revenue slot from legacy products.glAccountId ──────────
-- Per (cat, loc) pick the earliest non-null product.glAccountId. Only fills
-- the destination row's revenue slot when it is currently NULL — never
-- overwrites a higher-priority value already set by 20260429080000 /
-- 20260430120000.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'products' AND column_name = 'glAccountId'
  ) THEN
    EXECUTE $sql$
      INSERT INTO "product_category_gl_mappings" (
        "id", "tenantId", "productCategoryId", "locationId",
        "revenueGlAccountId", "cogsGlAccountId", "inventoryAssetGlAccountId",
        "createdAt", "updatedAt"
      )
      SELECT
        gen_random_uuid(),
        l."tenantId",
        p."productCategoryId",
        l."id",
        (array_agg(p."glAccountId" ORDER BY p."createdAt")
          FILTER (WHERE p."glAccountId" IS NOT NULL))[1],
        NULL,
        NULL,
        NOW(), NOW()
      FROM "products" p
      JOIN "locations" l ON l."tenantId" = p."tenantId"
      WHERE p."productCategoryId" IS NOT NULL
        AND p."glAccountId" IS NOT NULL
      GROUP BY l."tenantId", p."productCategoryId", l."id"
      ON CONFLICT ("productCategoryId", "locationId") DO UPDATE SET
        "revenueGlAccountId" = COALESCE(
          "product_category_gl_mappings"."revenueGlAccountId",
          EXCLUDED."revenueGlAccountId"
        ),
        "updatedAt" = NOW()
      WHERE "product_category_gl_mappings"."revenueGlAccountId" IS NULL;
    $sql$;
  END IF;
END $$;

-- ─── Step 2: Drop the FK constraint ──────────────────────────────────────────
-- Existence guard so a prior partial run that already dropped it doesn't
-- error here.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'products' AND constraint_name = 'products_glAccountId_fkey'
  ) THEN
    ALTER TABLE "products" DROP CONSTRAINT "products_glAccountId_fkey";
  END IF;
END $$;

-- ─── Step 3: Drop the column ─────────────────────────────────────────────────
ALTER TABLE "products" DROP COLUMN IF EXISTS "glAccountId";
