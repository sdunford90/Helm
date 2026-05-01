-- Migration: Enterprise accounting controls
--
-- Adds costing methods, tax provider selection, accounting period locking,
-- inventory lot tracking (FIFO), and reconciliation alert tracking.
--
-- New enums: CostingMethod, TaxProvider
-- New tables: accounting_periods, inventory_lots, reconciliation_alerts
-- Altered tables: locations, gl_entries, product_categories, products,
--                 purchase_orders, po_line_items

-- ─── New Enums ────────────────────────────────────────────────────────────────

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CostingMethod') THEN
    CREATE TYPE "CostingMethod" AS ENUM ('FIFO', 'WAC');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'TaxProvider') THEN
    CREATE TYPE "TaxProvider" AS ENUM ('INTERNAL', 'AVALARA', 'TAXJAR');
  END IF;
END $$;

-- ─── locations ────────────────────────────────────────────────────────────────

ALTER TABLE "locations"
  ADD COLUMN IF NOT EXISTS "accountingSetupComplete"     BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "accountingSetupCompletedAt"  TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "accountingSetupStep"         INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "accountingGracePeriodEndsAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "taxProvider"                 "TaxProvider" NOT NULL DEFAULT 'INTERNAL',
  ADD COLUMN IF NOT EXISTS "bankGlAccountId"             TEXT;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'locations'
      AND constraint_name = 'locations_bankGlAccountId_fkey'
  ) THEN
    ALTER TABLE "locations"
      ADD CONSTRAINT "locations_bankGlAccountId_fkey"
      FOREIGN KEY ("bankGlAccountId") REFERENCES "gl_accounts"("id") ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "locations_bankGlAccountId_idx"
  ON "locations"("bankGlAccountId");

-- ─── gl_entries ───────────────────────────────────────────────────────────────

ALTER TABLE "gl_entries"
  ADD COLUMN IF NOT EXISTS "locationId" TEXT,
  ADD COLUMN IF NOT EXISTS "entryDate"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX IF NOT EXISTS "gl_entries_tenantId_locationId_idx"
  ON "gl_entries"("tenantId", "locationId");

CREATE INDEX IF NOT EXISTS "gl_entries_tenantId_locationId_entryDate_idx"
  ON "gl_entries" ("tenantId", "locationId", "entryDate");

-- ─── product_categories ───────────────────────────────────────────────────────

ALTER TABLE "product_categories"
  ADD COLUMN IF NOT EXISTS "costingMethod"    "CostingMethod" NOT NULL DEFAULT 'WAC',
  ADD COLUMN IF NOT EXISTS "isFuelCategory"   BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "taxCategoryLabel" TEXT;

-- ─── products ─────────────────────────────────────────────────────────────────

ALTER TABLE "products"
  ADD COLUMN IF NOT EXISTS "averageCostCents" INTEGER;

-- ─── purchase_orders ──────────────────────────────────────────────────────────

ALTER TABLE "purchase_orders"
  ADD COLUMN IF NOT EXISTS "receivedAt"       TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "receivedByUserId" TEXT;

-- ─── po_line_items ────────────────────────────────────────────────────────────

ALTER TABLE "po_line_items"
  ADD COLUMN IF NOT EXISTS "receivedAt"        TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "unitCostAtReceipt" INTEGER;

-- ─── accounting_periods ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "accounting_periods" (
    "id"             TEXT NOT NULL,
    "tenantId"       TEXT NOT NULL,
    "locationId"     TEXT NOT NULL,
    "periodStart"    TIMESTAMP(3) NOT NULL,
    "periodEnd"      TIMESTAMP(3) NOT NULL,
    "closedAt"       TIMESTAMP(3),
    "closedByUserId" TEXT,
    "notes"          TEXT,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounting_periods_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "accounting_periods_locationId_periodStart_key"
  ON "accounting_periods"("locationId", "periodStart");

CREATE INDEX IF NOT EXISTS "accounting_periods_tenantId_locationId_idx"
  ON "accounting_periods"("tenantId", "locationId");

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'accounting_periods'
      AND constraint_name = 'accounting_periods_locationId_fkey'
  ) THEN
    ALTER TABLE "accounting_periods"
      ADD CONSTRAINT "accounting_periods_locationId_fkey"
      FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE CASCADE;
  END IF;
END $$;

-- ─── inventory_lots ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "inventory_lots" (
    "id"              TEXT NOT NULL,
    "tenantId"        TEXT NOT NULL,
    "productId"       TEXT NOT NULL,
    "locationId"      TEXT NOT NULL,
    "qtyRemaining"    INTEGER NOT NULL,
    "unitCostCents"   INTEGER NOT NULL,
    "receivedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "purchaseOrderId" TEXT,

    CONSTRAINT "inventory_lots_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "inventory_lots_tenantId_idx"
  ON "inventory_lots"("tenantId");

CREATE INDEX IF NOT EXISTS "inventory_lots_productId_locationId_receivedAt_idx"
  ON "inventory_lots"("productId", "locationId", "receivedAt");

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'inventory_lots'
      AND constraint_name = 'inventory_lots_productId_fkey'
  ) THEN
    ALTER TABLE "inventory_lots"
      ADD CONSTRAINT "inventory_lots_productId_fkey"
      FOREIGN KEY ("productId") REFERENCES "products"("id");
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'inventory_lots'
      AND constraint_name = 'inventory_lots_locationId_fkey'
  ) THEN
    ALTER TABLE "inventory_lots"
      ADD CONSTRAINT "inventory_lots_locationId_fkey"
      FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE CASCADE;
  END IF;
END $$;

-- ─── reconciliation_alerts ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "reconciliation_alerts" (
    "id"               TEXT NOT NULL,
    "tenantId"         TEXT NOT NULL,
    "locationId"       TEXT NOT NULL,
    "categoryId"       TEXT NOT NULL,
    "helmValueCents"   INTEGER NOT NULL,
    "qbValueCents"     INTEGER NOT NULL,
    "deltaCents"       INTEGER NOT NULL,
    "detectedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt"       TIMESTAMP(3),
    "resolvedByUserId" TEXT,
    "notes"            TEXT,

    CONSTRAINT "reconciliation_alerts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "reconciliation_alerts_tenantId_locationId_resolvedAt_idx"
  ON "reconciliation_alerts"("tenantId", "locationId", "resolvedAt");

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'reconciliation_alerts'
      AND constraint_name = 'reconciliation_alerts_locationId_fkey'
  ) THEN
    ALTER TABLE "reconciliation_alerts"
      ADD CONSTRAINT "reconciliation_alerts_locationId_fkey"
      FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'reconciliation_alerts'
      AND constraint_name = 'reconciliation_alerts_categoryId_fkey'
  ) THEN
    ALTER TABLE "reconciliation_alerts"
      ADD CONSTRAINT "reconciliation_alerts_categoryId_fkey"
      FOREIGN KEY ("categoryId") REFERENCES "product_categories"("id");
  END IF;
END $$;
