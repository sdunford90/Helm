-- Add active and description to gl_accounts table
ALTER TABLE "gl_accounts" ADD COLUMN IF NOT EXISTS "active" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "gl_accounts" ADD COLUMN IF NOT EXISTS "description" TEXT;

-- Add glAccountId to products table (POS)
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "glAccountId" TEXT;
ALTER TABLE "products" ADD CONSTRAINT IF NOT EXISTS "products_glAccountId_fkey"
  FOREIGN KEY ("glAccountId") REFERENCES "gl_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Add glAccountId to rental_products table
ALTER TABLE "rental_products" ADD COLUMN IF NOT EXISTS "glAccountId" TEXT;
ALTER TABLE "rental_products" ADD CONSTRAINT IF NOT EXISTS "rental_products_glAccountId_fkey"
  FOREIGN KEY ("glAccountId") REFERENCES "gl_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
