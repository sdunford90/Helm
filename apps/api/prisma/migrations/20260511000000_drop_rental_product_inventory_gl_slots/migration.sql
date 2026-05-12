-- Migration: Treat rental products as non-inventory
--
-- Rental products are physical assets the marina lends out and gets back —
-- they are not consumable stock. The COGS and Inventory Asset slots on
-- `rental_product_gl_mappings` were holdovers from when rentals shared the
-- inventory product editor. Drop them; only Revenue is configurable now.
--
-- Idempotent so it is safe to replay on environments where the columns are
-- already gone.

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'rental_product_gl_mappings'
      AND constraint_name = 'rental_product_gl_mappings_cogsGlAccountId_fkey'
  ) THEN
    ALTER TABLE "rental_product_gl_mappings"
      DROP CONSTRAINT "rental_product_gl_mappings_cogsGlAccountId_fkey";
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'rental_product_gl_mappings'
      AND constraint_name = 'rental_product_gl_mappings_inventoryAssetGlAccountId_fkey'
  ) THEN
    ALTER TABLE "rental_product_gl_mappings"
      DROP CONSTRAINT "rental_product_gl_mappings_inventoryAssetGlAccountId_fkey";
  END IF;
END $$;

ALTER TABLE "rental_product_gl_mappings"
  DROP COLUMN IF EXISTS "cogsGlAccountId";

ALTER TABLE "rental_product_gl_mappings"
  DROP COLUMN IF EXISTS "inventoryAssetGlAccountId";
