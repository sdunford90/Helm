-- Migration: QuickBooks Online inventory sync (items, bills, COGS, adjustments).
-- Adds qbo references to Product / PurchaseOrder, a new Vendor model, and a
-- generic QboInventorySyncRef table for sources that don't yet have a Prisma
-- record (e.g. in-memory inventory adjustments).

-- ── Product: GL accounts + QBO Item sync state ─────────────────────────────
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "locationId" TEXT;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "cogsGlAccountId" TEXT;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "inventoryAssetGlAccountId" TEXT;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "qboItemId" TEXT;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "qboItemSyncedAt" TIMESTAMP(3);
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "qboItemSyncError" TEXT;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "qboItemSyncErrorAt" TIMESTAMP(3);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'products_cogsGlAccountId_fkey' AND table_name = 'products') THEN
    ALTER TABLE "products" ADD CONSTRAINT "products_cogsGlAccountId_fkey"
      FOREIGN KEY ("cogsGlAccountId") REFERENCES "gl_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'products_inventoryAssetGlAccountId_fkey' AND table_name = 'products') THEN
    ALTER TABLE "products" ADD CONSTRAINT "products_inventoryAssetGlAccountId_fkey"
      FOREIGN KEY ("inventoryAssetGlAccountId") REFERENCES "gl_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'products_locationId_fkey' AND table_name = 'products') THEN
    ALTER TABLE "products" ADD CONSTRAINT "products_locationId_fkey"
      FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "products_locationId_idx" ON "products"("locationId");

-- ── Vendor model ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "vendors" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "email" TEXT,
  "phone" TEXT,
  "address" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "qboVendorId" TEXT,
  "qboVendorSyncedAt" TIMESTAMP(3),
  "qboVendorSyncError" TEXT,
  "qboVendorSyncErrorAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "vendors_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "vendors_tenantId_idx" ON "vendors"("tenantId");

-- ── PurchaseOrder: location, vendor FK, QBO Bill sync state ────────────────
ALTER TABLE "purchase_orders" ADD COLUMN IF NOT EXISTS "locationId" TEXT;
ALTER TABLE "purchase_orders" ADD COLUMN IF NOT EXISTS "poNumber" TEXT;
ALTER TABLE "purchase_orders" ADD COLUMN IF NOT EXISTS "qboBillId" TEXT;
ALTER TABLE "purchase_orders" ADD COLUMN IF NOT EXISTS "qboBillSyncedAt" TIMESTAMP(3);
ALTER TABLE "purchase_orders" ADD COLUMN IF NOT EXISTS "qboBillSyncError" TEXT;
ALTER TABLE "purchase_orders" ADD COLUMN IF NOT EXISTS "qboBillSyncErrorAt" TIMESTAMP(3);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'purchase_orders_locationId_fkey' AND table_name = 'purchase_orders') THEN
    ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_locationId_fkey"
      FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'purchase_orders_vendorId_fkey' AND table_name = 'purchase_orders') THEN
    ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_vendorId_fkey"
      FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "purchase_orders_locationId_idx" ON "purchase_orders"("locationId");

-- ── QboInventorySyncRef table ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "qbo_inventory_sync_refs" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "locationId" TEXT,
  "sourceType" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "qboType" TEXT NOT NULL,
  "qboId" TEXT,
  "lastSyncedAt" TIMESTAMP(3),
  "lastError" TEXT,
  "lastErrorAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "qbo_inventory_sync_refs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "qbo_inventory_sync_refs_tenantId_sourceType_sourceId_key"
  ON "qbo_inventory_sync_refs"("tenantId", "sourceType", "sourceId");
CREATE INDEX IF NOT EXISTS "qbo_inventory_sync_refs_tenantId_idx"
  ON "qbo_inventory_sync_refs"("tenantId");
