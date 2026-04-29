-- Migration: Retire the legacy single-account rental product GL field
--
-- The tenant-wide `RentalProduct.glAccountId` column and the matching
-- `PUT /api/settings/catalog/rental-products/:id/gl-account` endpoint have
-- been replaced by the per-location `rental_product_gl_mappings` table.
-- The UI now writes only through the per-location editor, and every server-
-- side reader has moved to `resolveRentalProductGlAccounts` (which already
-- ignores the legacy field for QBO-connected locations to prevent cross-
-- realm bleed).
--
-- Drop the foreign key, index, and column. Idempotent so it is safe to
-- replay on environments where the column is already gone.

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'rental_products'
      AND constraint_name = 'rental_products_glAccountId_fkey'
  ) THEN
    ALTER TABLE "rental_products" DROP CONSTRAINT "rental_products_glAccountId_fkey";
  END IF;
END $$;

DROP INDEX IF EXISTS "rental_products_glAccountId_idx";

ALTER TABLE "rental_products" DROP COLUMN IF EXISTS "glAccountId";
