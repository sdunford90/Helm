-- Migration: Move inventory store from in-memory to the database.
-- Adds the columns that the inventory route was tracking on its
-- in-memory product/PO/adjustment objects, and creates new tables for
-- purchase order line items, inventory adjustments and physical count
-- sessions so all inventory mutations can persist.

-- ── Product: extra fields used by the inventory route ─────────────────────
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "category" TEXT;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "reorderPoint" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "qoh" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "active" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "revenueGlAccountId" TEXT;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'products_revenueGlAccountId_fkey' AND table_name = 'products') THEN
    ALTER TABLE "products" ADD CONSTRAINT "products_revenueGlAccountId_fkey"
      FOREIGN KEY ("revenueGlAccountId") REFERENCES "gl_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- ── PurchaseOrder: free-form vendor name, notes, updatedAt ────────────────
ALTER TABLE "purchase_orders" ADD COLUMN IF NOT EXISTS "vendorName" TEXT;
ALTER TABLE "purchase_orders" ADD COLUMN IF NOT EXISTS "notes" TEXT;
ALTER TABLE "purchase_orders" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- ── PoLineItem: line items on a PurchaseOrder ─────────────────────────────
CREATE TABLE IF NOT EXISTS "po_line_items" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "purchaseOrderId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "productName" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "unitCostCents" INTEGER NOT NULL,
  "receivedQty" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "po_line_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "po_line_items_tenantId_idx" ON "po_line_items"("tenantId");
CREATE INDEX IF NOT EXISTS "po_line_items_purchaseOrderId_idx" ON "po_line_items"("purchaseOrderId");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'po_line_items_purchaseOrderId_fkey' AND table_name = 'po_line_items') THEN
    ALTER TABLE "po_line_items" ADD CONSTRAINT "po_line_items_purchaseOrderId_fkey"
      FOREIGN KEY ("purchaseOrderId") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'po_line_items_productId_fkey' AND table_name = 'po_line_items') THEN
    ALTER TABLE "po_line_items" ADD CONSTRAINT "po_line_items_productId_fkey"
      FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- ── InventoryCountSession: physical count sessions ────────────────────────
CREATE TABLE IF NOT EXISTS "inventory_count_sessions" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "startedBy" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'in_progress',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "inventory_count_sessions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "inventory_count_sessions_tenantId_idx" ON "inventory_count_sessions"("tenantId");

-- ── InventoryCountItem: per-product variance row inside a count ───────────
CREATE TABLE IF NOT EXISTS "inventory_count_items" (
  "id" TEXT NOT NULL,
  "countSessionId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "productName" TEXT NOT NULL,
  "expectedQty" INTEGER NOT NULL,
  "actualQty" INTEGER NOT NULL,
  "variance" INTEGER NOT NULL,
  CONSTRAINT "inventory_count_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "inventory_count_items_countSessionId_idx" ON "inventory_count_items"("countSessionId");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'inventory_count_items_countSessionId_fkey' AND table_name = 'inventory_count_items') THEN
    ALTER TABLE "inventory_count_items" ADD CONSTRAINT "inventory_count_items_countSessionId_fkey"
      FOREIGN KEY ("countSessionId") REFERENCES "inventory_count_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'inventory_count_items_productId_fkey' AND table_name = 'inventory_count_items') THEN
    ALTER TABLE "inventory_count_items" ADD CONSTRAINT "inventory_count_items_productId_fkey"
      FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- ── InventoryAdjustment: every change to product.qoh ──────────────────────
CREATE TABLE IF NOT EXISTS "inventory_adjustments" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "productName" TEXT NOT NULL,
  "quantityChange" INTEGER NOT NULL,
  "quantityBefore" INTEGER NOT NULL,
  "quantityAfter" INTEGER NOT NULL,
  "reason" TEXT NOT NULL,
  "notes" TEXT,
  "staffName" TEXT,
  "countSessionId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "qboJournalEntryId" TEXT,
  "qboSyncedAt" TIMESTAMP(3),
  "qboSyncError" TEXT,
  "qboSyncErrorAt" TIMESTAMP(3),
  CONSTRAINT "inventory_adjustments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "inventory_adjustments_tenantId_idx" ON "inventory_adjustments"("tenantId");
CREATE INDEX IF NOT EXISTS "inventory_adjustments_productId_idx" ON "inventory_adjustments"("productId");
CREATE INDEX IF NOT EXISTS "inventory_adjustments_countSessionId_idx" ON "inventory_adjustments"("countSessionId");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'inventory_adjustments_productId_fkey' AND table_name = 'inventory_adjustments') THEN
    ALTER TABLE "inventory_adjustments" ADD CONSTRAINT "inventory_adjustments_productId_fkey"
      FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'inventory_adjustments_countSessionId_fkey' AND table_name = 'inventory_adjustments') THEN
    ALTER TABLE "inventory_adjustments" ADD CONSTRAINT "inventory_adjustments_countSessionId_fkey"
      FOREIGN KEY ("countSessionId") REFERENCES "inventory_count_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
