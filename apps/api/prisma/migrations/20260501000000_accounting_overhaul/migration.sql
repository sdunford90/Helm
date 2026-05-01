-- AlterTable: Location — add QBO per-location fields and rental GL mode
ALTER TABLE "locations" ADD COLUMN IF NOT EXISTS "qboRealmId" TEXT;
ALTER TABLE "locations" ADD COLUMN IF NOT EXISTS "qboAccessToken" TEXT;
ALTER TABLE "locations" ADD COLUMN IF NOT EXISTS "qboRefreshToken" TEXT;
ALTER TABLE "locations" ADD COLUMN IF NOT EXISTS "qboTokenExpiresAt" TIMESTAMP(3);
ALTER TABLE "locations" ADD COLUMN IF NOT EXISTS "qboConnected" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "locations" ADD COLUMN IF NOT EXISTS "qboCompanyName" TEXT;
ALTER TABLE "locations" ADD COLUMN IF NOT EXISTS "qboLastSync" TIMESTAMP(3);
ALTER TABLE "locations" ADD COLUMN IF NOT EXISTS "rentalGlMode" TEXT NOT NULL DEFAULT 'SINGLE';

-- AlterTable: products — add categoryId and costingMethod
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "categoryId" TEXT;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "costingMethod" TEXT NOT NULL DEFAULT 'WAC';

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "AccountMappingType" AS ENUM ('SYSTEM_ACCOUNT', 'REVENUE_STREAM', 'PAYMENT_METHOD');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "CostingMethod" AS ENUM ('WAC', 'FIFO');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "RentalGlMode" AS ENUM ('SINGLE', 'PER_PRODUCT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "FiscalPeriodStatus" AS ENUM ('OPEN', 'CLOSED', 'LOCKED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "PurchaseOrderStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'PARTIAL', 'RECEIVED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- CreateTable: fiscal_periods
CREATE TABLE IF NOT EXISTS "fiscal_periods" (
  "id"        TEXT NOT NULL,
  "tenantId"  TEXT NOT NULL,
  "name"      TEXT NOT NULL,
  "startDate" TIMESTAMP(3) NOT NULL,
  "endDate"   TIMESTAMP(3) NOT NULL,
  "status"    TEXT NOT NULL DEFAULT 'OPEN',
  "closedBy"  TEXT,
  "closedAt"  TIMESTAMP(3),
  "lockedBy"  TEXT,
  "lockedAt"  TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "fiscal_periods_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "fiscal_periods_tenantId_idx" ON "fiscal_periods"("tenantId");
ALTER TABLE "fiscal_periods" ADD CONSTRAINT "fiscal_periods_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable: dockage_rates
CREATE TABLE IF NOT EXISTS "dockage_rates" (
  "id"                    TEXT NOT NULL,
  "tenantId"              TEXT NOT NULL,
  "locationId"            TEXT NOT NULL,
  "slipType"              TEXT NOT NULL,
  "monthlyRateCents"      INTEGER NOT NULL,
  "quarterlyRateCents"    INTEGER,
  "annualRateCents"       INTEGER,
  "electricityMode"       TEXT NOT NULL DEFAULT 'METERED',
  "electricityRateCents"  INTEGER,
  "glRevenueAccountId"    TEXT,
  "active"                BOOLEAN NOT NULL DEFAULT true,
  "createdAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "dockage_rates_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "dockage_rates_tenantId_idx" ON "dockage_rates"("tenantId");
CREATE INDEX IF NOT EXISTS "dockage_rates_locationId_idx" ON "dockage_rates"("locationId");
ALTER TABLE "dockage_rates" ADD CONSTRAINT "dockage_rates_locationId_fkey"
  FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "dockage_rates" ADD CONSTRAINT "dockage_rates_glRevenueAccountId_fkey"
  FOREIGN KEY ("glRevenueAccountId") REFERENCES "gl_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable: service_fees
CREATE TABLE IF NOT EXISTS "service_fees" (
  "id"          TEXT NOT NULL,
  "tenantId"    TEXT NOT NULL,
  "locationId"  TEXT NOT NULL,
  "name"        TEXT NOT NULL,
  "amountCents" INTEGER NOT NULL,
  "glAccountId" TEXT,
  "active"      BOOLEAN NOT NULL DEFAULT true,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "service_fees_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "service_fees_tenantId_idx" ON "service_fees"("tenantId");
CREATE INDEX IF NOT EXISTS "service_fees_locationId_idx" ON "service_fees"("locationId");
ALTER TABLE "service_fees" ADD CONSTRAINT "service_fees_locationId_fkey"
  FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "service_fees" ADD CONSTRAINT "service_fees_glAccountId_fkey"
  FOREIGN KEY ("glAccountId") REFERENCES "gl_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable: product_categories
CREATE TABLE IF NOT EXISTS "product_categories" (
  "id"                  TEXT NOT NULL,
  "tenantId"            TEXT NOT NULL,
  "locationId"          TEXT NOT NULL,
  "name"                TEXT NOT NULL,
  "glRevenueAccountId"  TEXT,
  "glCogsAccountId"     TEXT,
  "costingMethod"       TEXT NOT NULL DEFAULT 'WAC',
  "active"              BOOLEAN NOT NULL DEFAULT true,
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "product_categories_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "product_categories_tenantId_idx" ON "product_categories"("tenantId");
CREATE INDEX IF NOT EXISTS "product_categories_locationId_idx" ON "product_categories"("locationId");
ALTER TABLE "product_categories" ADD CONSTRAINT "product_categories_locationId_fkey"
  FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "product_categories" ADD CONSTRAINT "product_categories_glRevenueAccountId_fkey"
  FOREIGN KEY ("glRevenueAccountId") REFERENCES "gl_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "product_categories" ADD CONSTRAINT "product_categories_glCogsAccountId_fkey"
  FOREIGN KEY ("glCogsAccountId") REFERENCES "gl_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ForeignKey: products.categoryId → product_categories
ALTER TABLE "products" ADD CONSTRAINT "products_categoryId_fkey"
  FOREIGN KEY ("categoryId") REFERENCES "product_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable: account_mappings
CREATE TABLE IF NOT EXISTS "account_mappings" (
  "id"               TEXT NOT NULL,
  "tenantId"         TEXT NOT NULL,
  "locationId"       TEXT NOT NULL,
  "mappingType"      TEXT NOT NULL,
  "sourceKey"        TEXT NOT NULL,
  "glAccountId"      TEXT NOT NULL,
  "glCogsAccountId"  TEXT,
  "availablePOS"     BOOLEAN NOT NULL DEFAULT true,
  "availableBilling" BOOLEAN NOT NULL DEFAULT true,
  "active"           BOOLEAN NOT NULL DEFAULT true,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "account_mappings_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "account_mappings_locationId_mappingType_sourceKey_key"
  ON "account_mappings"("locationId", "mappingType", "sourceKey");
CREATE INDEX IF NOT EXISTS "account_mappings_tenantId_idx" ON "account_mappings"("tenantId");
CREATE INDEX IF NOT EXISTS "account_mappings_locationId_idx" ON "account_mappings"("locationId");
ALTER TABLE "account_mappings" ADD CONSTRAINT "account_mappings_locationId_fkey"
  FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "account_mappings" ADD CONSTRAINT "account_mappings_glAccountId_fkey"
  FOREIGN KEY ("glAccountId") REFERENCES "gl_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "account_mappings" ADD CONSTRAINT "account_mappings_glCogsAccountId_fkey"
  FOREIGN KEY ("glCogsAccountId") REFERENCES "gl_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable: account_mapping_audit_logs
CREATE TABLE IF NOT EXISTS "account_mapping_audit_logs" (
  "id"             TEXT NOT NULL,
  "tenantId"       TEXT NOT NULL,
  "locationId"     TEXT NOT NULL,
  "userId"         TEXT NOT NULL,
  "userName"       TEXT NOT NULL,
  "mappingSection" TEXT NOT NULL,
  "mappingLabel"   TEXT NOT NULL,
  "fieldChanged"   TEXT NOT NULL,
  "oldAccountName" TEXT,
  "oldAccountId"   TEXT,
  "newAccountName" TEXT,
  "newAccountId"   TEXT,
  "changedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "account_mapping_audit_logs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "account_mapping_audit_logs_tenantId_idx" ON "account_mapping_audit_logs"("tenantId");
CREATE INDEX IF NOT EXISTS "account_mapping_audit_logs_locationId_idx" ON "account_mapping_audit_logs"("locationId");
ALTER TABLE "account_mapping_audit_logs" ADD CONSTRAINT "account_mapping_audit_logs_locationId_fkey"
  FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable: purchase_orders
CREATE TABLE IF NOT EXISTS "purchase_orders" (
  "id"           TEXT NOT NULL,
  "tenantId"     TEXT NOT NULL,
  "locationId"   TEXT NOT NULL,
  "vendorId"     TEXT,
  "vendorName"   TEXT,
  "status"       TEXT NOT NULL DEFAULT 'DRAFT',
  "expectedDate" TIMESTAMP(3),
  "notes"        TEXT,
  "totalCents"   INTEGER NOT NULL DEFAULT 0,
  "createdBy"    TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "purchase_orders_tenantId_idx" ON "purchase_orders"("tenantId");
CREATE INDEX IF NOT EXISTS "purchase_orders_locationId_idx" ON "purchase_orders"("locationId");
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_locationId_fkey"
  FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable: purchase_order_items
CREATE TABLE IF NOT EXISTS "purchase_order_items" (
  "id"               TEXT NOT NULL,
  "purchaseOrderId"  TEXT NOT NULL,
  "productId"        TEXT NOT NULL,
  "quantityOrdered"  INTEGER NOT NULL,
  "quantityReceived" INTEGER NOT NULL DEFAULT 0,
  "unitCostCents"    INTEGER NOT NULL,
  "extendedCents"    INTEGER NOT NULL,
  CONSTRAINT "purchase_order_items_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_purchaseOrderId_fkey"
  FOREIGN KEY ("purchaseOrderId") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable: inventory_receipts
CREATE TABLE IF NOT EXISTS "inventory_receipts" (
  "id"              TEXT NOT NULL,
  "tenantId"        TEXT NOT NULL,
  "locationId"      TEXT NOT NULL,
  "purchaseOrderId" TEXT NOT NULL,
  "receivedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "receivedBy"      TEXT,
  "glJournalId"     TEXT,
  "notes"           TEXT,
  CONSTRAINT "inventory_receipts_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "inventory_receipts_tenantId_idx" ON "inventory_receipts"("tenantId");
CREATE INDEX IF NOT EXISTS "inventory_receipts_locationId_idx" ON "inventory_receipts"("locationId");
ALTER TABLE "inventory_receipts" ADD CONSTRAINT "inventory_receipts_locationId_fkey"
  FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_receipts" ADD CONSTRAINT "inventory_receipts_purchaseOrderId_fkey"
  FOREIGN KEY ("purchaseOrderId") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable: inventory_receipt_items
CREATE TABLE IF NOT EXISTS "inventory_receipt_items" (
  "id"               TEXT NOT NULL,
  "receiptId"        TEXT NOT NULL,
  "productId"        TEXT NOT NULL,
  "quantityReceived" INTEGER NOT NULL,
  "unitCostCents"    INTEGER NOT NULL,
  CONSTRAINT "inventory_receipt_items_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "inventory_receipt_items" ADD CONSTRAINT "inventory_receipt_items_receiptId_fkey"
  FOREIGN KEY ("receiptId") REFERENCES "inventory_receipts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_receipt_items" ADD CONSTRAINT "inventory_receipt_items_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable: inventory_layers (FIFO cost layers)
CREATE TABLE IF NOT EXISTS "inventory_layers" (
  "id"                TEXT NOT NULL,
  "tenantId"          TEXT NOT NULL,
  "locationId"        TEXT NOT NULL,
  "productId"         TEXT NOT NULL,
  "receiptId"         TEXT NOT NULL,
  "quantityRemaining" INTEGER NOT NULL,
  "unitCostCents"     INTEGER NOT NULL,
  "receivedAt"        TIMESTAMP(3) NOT NULL,
  CONSTRAINT "inventory_layers_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "inventory_layers_tenantId_idx" ON "inventory_layers"("tenantId");
CREATE INDEX IF NOT EXISTS "inventory_layers_productId_receivedAt_idx" ON "inventory_layers"("productId", "receivedAt");
ALTER TABLE "inventory_layers" ADD CONSTRAINT "inventory_layers_receiptId_fkey"
  FOREIGN KEY ("receiptId") REFERENCES "inventory_receipts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_layers" ADD CONSTRAINT "inventory_layers_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable: tax_rates
CREATE TABLE IF NOT EXISTS "tax_rates" (
  "id"           TEXT NOT NULL,
  "tenantId"     TEXT NOT NULL,
  "jurisdiction" TEXT NOT NULL,
  "taxClass"     TEXT NOT NULL,
  "rate"         DOUBLE PRECISION NOT NULL,
  "active"       BOOLEAN NOT NULL DEFAULT true,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tax_rates_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "tax_rates_tenantId_jurisdiction_taxClass_key"
  ON "tax_rates"("tenantId", "jurisdiction", "taxClass");
CREATE INDEX IF NOT EXISTS "tax_rates_tenantId_idx" ON "tax_rates"("tenantId");
