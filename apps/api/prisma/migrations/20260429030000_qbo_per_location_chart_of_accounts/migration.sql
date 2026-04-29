-- Migration: Per-location chart of accounts pulled from QuickBooks Online
--
-- Adds:
--   * GlAccount.locationId, source enum, isActive flag
--   * Location.qboLastChartOfAccountsSyncAt
--   * product_gl_mappings, product_category_gl_mappings,
--     dockage_rate_gl_mappings, service_fee_gl_mappings
--
-- Also performs a one-time data migration that copies each existing
-- tenant-level GL FK on products / categories / dockage rates / service fees
-- into a per-location mapping row for every active location whose chart of
-- accounts has a matching account number (or matching qboAccountId).

-- ── enum: GlAccountSource ───────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'GlAccountSource') THEN
    CREATE TYPE "GlAccountSource" AS ENUM ('MANUAL', 'QBO');
  END IF;
END $$;

-- ── gl_accounts: per-location columns ───────────────────────────────
ALTER TABLE "gl_accounts" ADD COLUMN IF NOT EXISTS "locationId" TEXT;
ALTER TABLE "gl_accounts" ADD COLUMN IF NOT EXISTS "source"     "GlAccountSource" NOT NULL DEFAULT 'MANUAL';
ALTER TABLE "gl_accounts" ADD COLUMN IF NOT EXISTS "isActive"   BOOLEAN NOT NULL DEFAULT true;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'gl_accounts' AND constraint_name = 'gl_accounts_locationId_fkey'
  ) THEN
    ALTER TABLE "gl_accounts"
      ADD CONSTRAINT "gl_accounts_locationId_fkey"
      FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "gl_accounts_locationId_idx" ON "gl_accounts"("locationId");

-- ── locations: chart-of-accounts last-sync timestamp ────────────────
ALTER TABLE "locations" ADD COLUMN IF NOT EXISTS "qboLastChartOfAccountsSyncAt" TIMESTAMP(3);

-- ── product_gl_mappings ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "product_gl_mappings" (
  "id"                        TEXT NOT NULL,
  "tenantId"                  TEXT NOT NULL,
  "productId"                 TEXT NOT NULL,
  "locationId"                TEXT NOT NULL,
  "revenueGlAccountId"        TEXT,
  "cogsGlAccountId"           TEXT,
  "inventoryAssetGlAccountId" TEXT,
  "createdAt"                 TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"                 TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "product_gl_mappings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "product_gl_mappings_productId_locationId_key"
  ON "product_gl_mappings"("productId", "locationId");
CREATE INDEX IF NOT EXISTS "product_gl_mappings_tenantId_idx"   ON "product_gl_mappings"("tenantId");
CREATE INDEX IF NOT EXISTS "product_gl_mappings_locationId_idx" ON "product_gl_mappings"("locationId");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'product_gl_mappings_productId_fkey') THEN
    ALTER TABLE "product_gl_mappings" ADD CONSTRAINT "product_gl_mappings_productId_fkey"
      FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'product_gl_mappings_locationId_fkey') THEN
    ALTER TABLE "product_gl_mappings" ADD CONSTRAINT "product_gl_mappings_locationId_fkey"
      FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'product_gl_mappings_revenueGlAccountId_fkey') THEN
    ALTER TABLE "product_gl_mappings" ADD CONSTRAINT "product_gl_mappings_revenueGlAccountId_fkey"
      FOREIGN KEY ("revenueGlAccountId") REFERENCES "gl_accounts"("id") ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'product_gl_mappings_cogsGlAccountId_fkey') THEN
    ALTER TABLE "product_gl_mappings" ADD CONSTRAINT "product_gl_mappings_cogsGlAccountId_fkey"
      FOREIGN KEY ("cogsGlAccountId") REFERENCES "gl_accounts"("id") ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'product_gl_mappings_inventoryAssetGlAccountId_fkey') THEN
    ALTER TABLE "product_gl_mappings" ADD CONSTRAINT "product_gl_mappings_inventoryAssetGlAccountId_fkey"
      FOREIGN KEY ("inventoryAssetGlAccountId") REFERENCES "gl_accounts"("id") ON DELETE SET NULL;
  END IF;
END $$;

-- ── product_category_gl_mappings ────────────────────────────────────
CREATE TABLE IF NOT EXISTS "product_category_gl_mappings" (
  "id"                        TEXT NOT NULL,
  "tenantId"                  TEXT NOT NULL,
  "productCategoryId"         TEXT NOT NULL,
  "locationId"                TEXT NOT NULL,
  "revenueGlAccountId"        TEXT,
  "cogsGlAccountId"           TEXT,
  "inventoryAssetGlAccountId" TEXT,
  "createdAt"                 TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"                 TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "product_category_gl_mappings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "product_category_gl_mappings_categoryId_locationId_key"
  ON "product_category_gl_mappings"("productCategoryId", "locationId");
CREATE INDEX IF NOT EXISTS "product_category_gl_mappings_tenantId_idx"   ON "product_category_gl_mappings"("tenantId");
CREATE INDEX IF NOT EXISTS "product_category_gl_mappings_locationId_idx" ON "product_category_gl_mappings"("locationId");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'product_category_gl_mappings_categoryId_fkey') THEN
    ALTER TABLE "product_category_gl_mappings" ADD CONSTRAINT "product_category_gl_mappings_categoryId_fkey"
      FOREIGN KEY ("productCategoryId") REFERENCES "product_categories"("id") ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'product_category_gl_mappings_locationId_fkey') THEN
    ALTER TABLE "product_category_gl_mappings" ADD CONSTRAINT "product_category_gl_mappings_locationId_fkey"
      FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'product_category_gl_mappings_revenueGlAccountId_fkey') THEN
    ALTER TABLE "product_category_gl_mappings" ADD CONSTRAINT "product_category_gl_mappings_revenueGlAccountId_fkey"
      FOREIGN KEY ("revenueGlAccountId") REFERENCES "gl_accounts"("id") ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'product_category_gl_mappings_cogsGlAccountId_fkey') THEN
    ALTER TABLE "product_category_gl_mappings" ADD CONSTRAINT "product_category_gl_mappings_cogsGlAccountId_fkey"
      FOREIGN KEY ("cogsGlAccountId") REFERENCES "gl_accounts"("id") ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'product_category_gl_mappings_inventoryAssetGlAccountId_fkey') THEN
    ALTER TABLE "product_category_gl_mappings" ADD CONSTRAINT "product_category_gl_mappings_inventoryAssetGlAccountId_fkey"
      FOREIGN KEY ("inventoryAssetGlAccountId") REFERENCES "gl_accounts"("id") ON DELETE SET NULL;
  END IF;
END $$;

-- ── dockage_rate_gl_mappings ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "dockage_rate_gl_mappings" (
  "id"            TEXT NOT NULL,
  "tenantId"      TEXT NOT NULL,
  "dockageRateId" TEXT NOT NULL,
  "locationId"    TEXT NOT NULL,
  "glAccountId"   TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "dockage_rate_gl_mappings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "dockage_rate_gl_mappings_rateId_locationId_key"
  ON "dockage_rate_gl_mappings"("dockageRateId", "locationId");
CREATE INDEX IF NOT EXISTS "dockage_rate_gl_mappings_tenantId_idx"   ON "dockage_rate_gl_mappings"("tenantId");
CREATE INDEX IF NOT EXISTS "dockage_rate_gl_mappings_locationId_idx" ON "dockage_rate_gl_mappings"("locationId");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'dockage_rate_gl_mappings_rateId_fkey') THEN
    ALTER TABLE "dockage_rate_gl_mappings" ADD CONSTRAINT "dockage_rate_gl_mappings_rateId_fkey"
      FOREIGN KEY ("dockageRateId") REFERENCES "dockage_rates"("id") ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'dockage_rate_gl_mappings_locationId_fkey') THEN
    ALTER TABLE "dockage_rate_gl_mappings" ADD CONSTRAINT "dockage_rate_gl_mappings_locationId_fkey"
      FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'dockage_rate_gl_mappings_glAccountId_fkey') THEN
    ALTER TABLE "dockage_rate_gl_mappings" ADD CONSTRAINT "dockage_rate_gl_mappings_glAccountId_fkey"
      FOREIGN KEY ("glAccountId") REFERENCES "gl_accounts"("id") ON DELETE SET NULL;
  END IF;
END $$;

-- ── service_fee_gl_mappings ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "service_fee_gl_mappings" (
  "id"           TEXT NOT NULL,
  "tenantId"     TEXT NOT NULL,
  "serviceFeeId" TEXT NOT NULL,
  "locationId"   TEXT NOT NULL,
  "glAccountId"  TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "service_fee_gl_mappings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "service_fee_gl_mappings_feeId_locationId_key"
  ON "service_fee_gl_mappings"("serviceFeeId", "locationId");
CREATE INDEX IF NOT EXISTS "service_fee_gl_mappings_tenantId_idx"   ON "service_fee_gl_mappings"("tenantId");
CREATE INDEX IF NOT EXISTS "service_fee_gl_mappings_locationId_idx" ON "service_fee_gl_mappings"("locationId");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'service_fee_gl_mappings_feeId_fkey') THEN
    ALTER TABLE "service_fee_gl_mappings" ADD CONSTRAINT "service_fee_gl_mappings_feeId_fkey"
      FOREIGN KEY ("serviceFeeId") REFERENCES "service_fees"("id") ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'service_fee_gl_mappings_locationId_fkey') THEN
    ALTER TABLE "service_fee_gl_mappings" ADD CONSTRAINT "service_fee_gl_mappings_locationId_fkey"
      FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'service_fee_gl_mappings_glAccountId_fkey') THEN
    ALTER TABLE "service_fee_gl_mappings" ADD CONSTRAINT "service_fee_gl_mappings_glAccountId_fkey"
      FOREIGN KEY ("glAccountId") REFERENCES "gl_accounts"("id") ON DELETE SET NULL;
  END IF;
END $$;

-- ── data migration: copy existing tenant-level GL FKs into per-location
--    mapping rows. For each (entity, location), look up the location's GL
--    account by qboAccountId first (preferred when both sides have a QBO
--    link), then by accountNumber. We only insert when an existing row is
--    missing, so this is idempotent.
-- ──────────────────────────────────────────────────────────────────────

-- Helper view: resolve a tenant-level GlAccount.id to the equivalent account
-- in a particular location's chart (matching by qboAccountId or
-- accountNumber).  Implemented inline as a CTE in each insert.

-- product_gl_mappings backfill --------------------------------------
INSERT INTO "product_gl_mappings"
  ("id", "tenantId", "productId", "locationId",
   "revenueGlAccountId", "cogsGlAccountId", "inventoryAssetGlAccountId",
   "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  p."tenantId",
  p."id",
  loc."id",
  rev_loc."id",
  cogs_loc."id",
  inv_loc."id",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "products" p
JOIN "locations" loc ON loc."tenantId" = p."tenantId" AND loc."active" = true
LEFT JOIN "gl_accounts" rev_src  ON rev_src."id"  = p."revenueGlAccountId"
LEFT JOIN "gl_accounts" cogs_src ON cogs_src."id" = p."cogsGlAccountId"
LEFT JOIN "gl_accounts" inv_src  ON inv_src."id"  = p."inventoryAssetGlAccountId"
LEFT JOIN "gl_accounts" rev_loc ON rev_loc."tenantId" = p."tenantId"
  AND rev_loc."locationId" = loc."id"
  AND (
    (rev_src."qboAccountId"  IS NOT NULL AND rev_loc."qboAccountId"  = rev_src."qboAccountId")
    OR (rev_src."accountNumber" IS NOT NULL AND rev_loc."accountNumber" = rev_src."accountNumber")
  )
LEFT JOIN "gl_accounts" cogs_loc ON cogs_loc."tenantId" = p."tenantId"
  AND cogs_loc."locationId" = loc."id"
  AND (
    (cogs_src."qboAccountId"  IS NOT NULL AND cogs_loc."qboAccountId"  = cogs_src."qboAccountId")
    OR (cogs_src."accountNumber" IS NOT NULL AND cogs_loc."accountNumber" = cogs_src."accountNumber")
  )
LEFT JOIN "gl_accounts" inv_loc ON inv_loc."tenantId" = p."tenantId"
  AND inv_loc."locationId" = loc."id"
  AND (
    (inv_src."qboAccountId"  IS NOT NULL AND inv_loc."qboAccountId"  = inv_src."qboAccountId")
    OR (inv_src."accountNumber" IS NOT NULL AND inv_loc."accountNumber" = inv_src."accountNumber")
  )
WHERE
  (p."revenueGlAccountId" IS NOT NULL OR p."cogsGlAccountId" IS NOT NULL OR p."inventoryAssetGlAccountId" IS NOT NULL)
  AND (rev_loc."id" IS NOT NULL OR cogs_loc."id" IS NOT NULL OR inv_loc."id" IS NOT NULL)
ON CONFLICT ("productId", "locationId") DO NOTHING;

-- product_category_gl_mappings backfill -----------------------------
INSERT INTO "product_category_gl_mappings"
  ("id", "tenantId", "productCategoryId", "locationId",
   "revenueGlAccountId", "cogsGlAccountId", "inventoryAssetGlAccountId",
   "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  c."tenantId",
  c."id",
  loc."id",
  rev_loc."id",
  cogs_loc."id",
  inv_loc."id",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "product_categories" c
JOIN "locations" loc ON loc."tenantId" = c."tenantId" AND loc."active" = true
LEFT JOIN "gl_accounts" rev_src  ON rev_src."id"  = c."defaultRevenueGlAccountId"
LEFT JOIN "gl_accounts" cogs_src ON cogs_src."id" = c."defaultCogsGlAccountId"
LEFT JOIN "gl_accounts" inv_src  ON inv_src."id"  = c."defaultInventoryAssetGlAccountId"
LEFT JOIN "gl_accounts" rev_loc ON rev_loc."tenantId" = c."tenantId"
  AND rev_loc."locationId" = loc."id"
  AND (
    (rev_src."qboAccountId"  IS NOT NULL AND rev_loc."qboAccountId"  = rev_src."qboAccountId")
    OR (rev_src."accountNumber" IS NOT NULL AND rev_loc."accountNumber" = rev_src."accountNumber")
  )
LEFT JOIN "gl_accounts" cogs_loc ON cogs_loc."tenantId" = c."tenantId"
  AND cogs_loc."locationId" = loc."id"
  AND (
    (cogs_src."qboAccountId"  IS NOT NULL AND cogs_loc."qboAccountId"  = cogs_src."qboAccountId")
    OR (cogs_src."accountNumber" IS NOT NULL AND cogs_loc."accountNumber" = cogs_src."accountNumber")
  )
LEFT JOIN "gl_accounts" inv_loc ON inv_loc."tenantId" = c."tenantId"
  AND inv_loc."locationId" = loc."id"
  AND (
    (inv_src."qboAccountId"  IS NOT NULL AND inv_loc."qboAccountId"  = inv_src."qboAccountId")
    OR (inv_src."accountNumber" IS NOT NULL AND inv_loc."accountNumber" = inv_src."accountNumber")
  )
WHERE
  (c."defaultRevenueGlAccountId" IS NOT NULL OR c."defaultCogsGlAccountId" IS NOT NULL OR c."defaultInventoryAssetGlAccountId" IS NOT NULL)
  AND (rev_loc."id" IS NOT NULL OR cogs_loc."id" IS NOT NULL OR inv_loc."id" IS NOT NULL)
ON CONFLICT ("productCategoryId", "locationId") DO NOTHING;

-- dockage_rate_gl_mappings backfill ---------------------------------
-- DockageRate is itself per-location, so we only seed a mapping for its
-- own location.
INSERT INTO "dockage_rate_gl_mappings"
  ("id", "tenantId", "dockageRateId", "locationId", "glAccountId", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  d."tenantId",
  d."id",
  d."locationId",
  ga_loc."id",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "dockage_rates" d
LEFT JOIN "gl_accounts" ga_src ON ga_src."id" = d."glAccountId"
LEFT JOIN "gl_accounts" ga_loc ON ga_loc."tenantId" = d."tenantId"
  AND ga_loc."locationId" = d."locationId"
  AND (
    (ga_src."qboAccountId"  IS NOT NULL AND ga_loc."qboAccountId"  = ga_src."qboAccountId")
    OR (ga_src."accountNumber" IS NOT NULL AND ga_loc."accountNumber" = ga_src."accountNumber")
  )
WHERE d."glAccountId" IS NOT NULL AND ga_loc."id" IS NOT NULL
ON CONFLICT ("dockageRateId", "locationId") DO NOTHING;

-- service_fee_gl_mappings backfill ----------------------------------
-- ServiceFee is itself per-location too.
INSERT INTO "service_fee_gl_mappings"
  ("id", "tenantId", "serviceFeeId", "locationId", "glAccountId", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  f."tenantId",
  f."id",
  f."locationId",
  ga_loc."id",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "service_fees" f
LEFT JOIN "gl_accounts" ga_src ON ga_src."id" = f."glAccountId"
LEFT JOIN "gl_accounts" ga_loc ON ga_loc."tenantId" = f."tenantId"
  AND ga_loc."locationId" = f."locationId"
  AND (
    (ga_src."qboAccountId"  IS NOT NULL AND ga_loc."qboAccountId"  = ga_src."qboAccountId")
    OR (ga_src."accountNumber" IS NOT NULL AND ga_loc."accountNumber" = ga_src."accountNumber")
  )
WHERE f."glAccountId" IS NOT NULL AND ga_loc."id" IS NOT NULL
ON CONFLICT ("serviceFeeId", "locationId") DO NOTHING;
