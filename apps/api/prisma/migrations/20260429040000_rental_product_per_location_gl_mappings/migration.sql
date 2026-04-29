-- Migration: Per-location GL mappings for rental products
--
-- Adds rental_product_gl_mappings so each RentalProduct can have a
-- revenue/COGS/inventory account assigned per location, mirroring the
-- existing product_gl_mappings table. The legacy tenant-wide
-- RentalProduct.glAccountId column is preserved as a fallback.

CREATE TABLE IF NOT EXISTS "rental_product_gl_mappings" (
  "id"                        TEXT NOT NULL,
  "tenantId"                  TEXT NOT NULL,
  "rentalProductId"           TEXT NOT NULL,
  "locationId"                TEXT NOT NULL,
  "revenueGlAccountId"        TEXT,
  "cogsGlAccountId"           TEXT,
  "inventoryAssetGlAccountId" TEXT,
  "createdAt"                 TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"                 TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "rental_product_gl_mappings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "rental_product_gl_mappings_rentalProductId_locationId_key"
  ON "rental_product_gl_mappings"("rentalProductId", "locationId");
CREATE INDEX IF NOT EXISTS "rental_product_gl_mappings_tenantId_idx"   ON "rental_product_gl_mappings"("tenantId");
CREATE INDEX IF NOT EXISTS "rental_product_gl_mappings_locationId_idx" ON "rental_product_gl_mappings"("locationId");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'rental_product_gl_mappings_rentalProductId_fkey') THEN
    ALTER TABLE "rental_product_gl_mappings" ADD CONSTRAINT "rental_product_gl_mappings_rentalProductId_fkey"
      FOREIGN KEY ("rentalProductId") REFERENCES "rental_products"("id") ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'rental_product_gl_mappings_locationId_fkey') THEN
    ALTER TABLE "rental_product_gl_mappings" ADD CONSTRAINT "rental_product_gl_mappings_locationId_fkey"
      FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'rental_product_gl_mappings_revenueGlAccountId_fkey') THEN
    ALTER TABLE "rental_product_gl_mappings" ADD CONSTRAINT "rental_product_gl_mappings_revenueGlAccountId_fkey"
      FOREIGN KEY ("revenueGlAccountId") REFERENCES "gl_accounts"("id") ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'rental_product_gl_mappings_cogsGlAccountId_fkey') THEN
    ALTER TABLE "rental_product_gl_mappings" ADD CONSTRAINT "rental_product_gl_mappings_cogsGlAccountId_fkey"
      FOREIGN KEY ("cogsGlAccountId") REFERENCES "gl_accounts"("id") ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'rental_product_gl_mappings_inventoryAssetGlAccountId_fkey') THEN
    ALTER TABLE "rental_product_gl_mappings" ADD CONSTRAINT "rental_product_gl_mappings_inventoryAssetGlAccountId_fkey"
      FOREIGN KEY ("inventoryAssetGlAccountId") REFERENCES "gl_accounts"("id") ON DELETE SET NULL;
  END IF;
END $$;
