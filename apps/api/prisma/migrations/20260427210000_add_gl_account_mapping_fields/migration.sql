-- Add active and description to gl_accounts table
ALTER TABLE "gl_accounts" ADD COLUMN IF NOT EXISTS "active" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "gl_accounts" ADD COLUMN IF NOT EXISTS "description" TEXT;

-- Add glAccountId to products table (POS)
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "glAccountId" TEXT;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'products_glAccountId_fkey' AND table_name = 'products'
  ) THEN
    ALTER TABLE "products" ADD CONSTRAINT "products_glAccountId_fkey"
      FOREIGN KEY ("glAccountId") REFERENCES "gl_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- Add glAccountId to rental_products table
ALTER TABLE "rental_products" ADD COLUMN IF NOT EXISTS "glAccountId" TEXT;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'rental_products_glAccountId_fkey' AND table_name = 'rental_products'
  ) THEN
    ALTER TABLE "rental_products" ADD CONSTRAINT "rental_products_glAccountId_fkey"
      FOREIGN KEY ("glAccountId") REFERENCES "gl_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
