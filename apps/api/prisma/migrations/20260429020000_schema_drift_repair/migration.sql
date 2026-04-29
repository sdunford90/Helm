-- Migration: Repair schema drift between dev and prod
--
-- The dev database had drifted ahead of the migration history (extra
-- tables/columns added via direct schema push without an accompanying
-- SQL migration). Prod replays migrations from scratch and was therefore
-- missing 7 tables and 16 columns the Prisma client expects, causing
-- runtime errors such as `column locations.transientEnabled does not exist`.
--
-- Every change uses IF NOT EXISTS / DO blocks so this migration is a
-- no-op on environments (like dev) that already have the objects.

-- ── locations: feature flags + branding + per-location QBO ───────────
ALTER TABLE "locations" ADD COLUMN IF NOT EXISTS "rentalsEnabled"      BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "locations" ADD COLUMN IF NOT EXISTS "transientEnabled"    BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "locations" ADD COLUMN IF NOT EXISTS "autoExecuteRenewals" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "locations" ADD COLUMN IF NOT EXISTS "brandingJson"        JSONB;
ALTER TABLE "locations" ADD COLUMN IF NOT EXISTS "logoUrl"             TEXT;
ALTER TABLE "locations" ADD COLUMN IF NOT EXISTS "qboAccessToken"      TEXT;
ALTER TABLE "locations" ADD COLUMN IF NOT EXISTS "qboRefreshToken"     TEXT;
ALTER TABLE "locations" ADD COLUMN IF NOT EXISTS "qboRealmId"          TEXT;
ALTER TABLE "locations" ADD COLUMN IF NOT EXISTS "qboTokenExpiresAt"   TIMESTAMP(3);
ALTER TABLE "locations" ADD COLUMN IF NOT EXISTS "qboConnectedAt"      TIMESTAMP(3);

-- ── invoices: optional per-location attribution ─────────────────────
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "locationId" TEXT;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'invoices_locationId_fkey'
      AND table_name = 'invoices') THEN
    ALTER TABLE "invoices" ADD CONSTRAINT "invoices_locationId_fkey"
      FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "invoices_locationId_idx" ON "invoices" ("locationId");

-- ── rental_products: tax class default ──────────────────────────────
ALTER TABLE "rental_products" ADD COLUMN IF NOT EXISTS "taxClass" TEXT DEFAULT 'Tax Exempt';

-- ── email_templates ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "email_templates" (
    "id"        TEXT NOT NULL,
    "tenantId"  TEXT NOT NULL,
    "name"      TEXT NOT NULL,
    "subject"   TEXT NOT NULL,
    "htmlBody"  TEXT NOT NULL DEFAULT '',
    "category"  TEXT NOT NULL DEFAULT 'billing',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "variables" JSONB NOT NULL DEFAULT '[]'::jsonb,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_templates_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "email_templates_tenantId_idx" ON "email_templates" ("tenantId");

-- ── automation_rules ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "automation_rules" (
    "id"           TEXT NOT NULL,
    "tenantId"     TEXT NOT NULL,
    "name"         TEXT NOT NULL,
    "trigger"      TEXT NOT NULL,
    "enabled"      BOOLEAN NOT NULL DEFAULT true,
    "delayMinutes" INTEGER NOT NULL DEFAULT 0,
    "templateId"   TEXT NOT NULL,
    "channels"     JSONB NOT NULL DEFAULT '["email"]'::jsonb,
    "conditions"   JSONB,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "automation_rules_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "automation_rules_tenantId_idx"           ON "automation_rules" ("tenantId");
CREATE INDEX IF NOT EXISTS "automation_rules_tenantId_trigger_idx"   ON "automation_rules" ("tenantId", "trigger");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'automation_rules_templateId_fkey'
      AND table_name = 'automation_rules') THEN
    ALTER TABLE "automation_rules" ADD CONSTRAINT "automation_rules_templateId_fkey"
      FOREIGN KEY ("templateId") REFERENCES "email_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- ── rental_units ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "rental_units" (
    "id"              TEXT NOT NULL,
    "rentalProductId" TEXT NOT NULL,
    "name"            TEXT NOT NULL,
    "serialNumber"    TEXT,
    "status"          TEXT NOT NULL DEFAULT 'AVAILABLE',
    "notes"           TEXT,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rental_units_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "rental_units_rentalProductId_idx" ON "rental_units" ("rentalProductId");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'rental_units_rentalProductId_fkey'
      AND table_name = 'rental_units') THEN
    ALTER TABLE "rental_units" ADD CONSTRAINT "rental_units_rentalProductId_fkey"
      FOREIGN KEY ("rentalProductId") REFERENCES "rental_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- ── rental_time_slots ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "rental_time_slots" (
    "id"         TEXT NOT NULL,
    "tenantId"   TEXT NOT NULL,
    "locationId" TEXT,
    "name"       TEXT NOT NULL,
    "startTime"  TEXT NOT NULL,
    "endTime"    TEXT NOT NULL,
    "sortOrder"  INTEGER NOT NULL DEFAULT 0,
    "active"     BOOLEAN NOT NULL DEFAULT true,
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rental_time_slots_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "rental_time_slots_tenantId_idx" ON "rental_time_slots" ("tenantId");

-- ── reservations: link to time slot / unit + waiver / notes ─────────
ALTER TABLE "reservations" ADD COLUMN IF NOT EXISTS "damageWaiverCents" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "reservations" ADD COLUMN IF NOT EXISTS "notes"             TEXT;
ALTER TABLE "reservations" ADD COLUMN IF NOT EXISTS "timeSlotId"        TEXT;
ALTER TABLE "reservations" ADD COLUMN IF NOT EXISTS "unitId"            TEXT;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'reservations_timeSlotId_fkey'
      AND table_name = 'reservations') THEN
    ALTER TABLE "reservations" ADD CONSTRAINT "reservations_timeSlotId_fkey"
      FOREIGN KEY ("timeSlotId") REFERENCES "rental_time_slots"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'reservations_unitId_fkey'
      AND table_name = 'reservations') THEN
    ALTER TABLE "reservations" ADD CONSTRAINT "reservations_unitId_fkey"
      FOREIGN KEY ("unitId") REFERENCES "rental_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- ── dockage_rates ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "dockage_rates" (
    "id"                   TEXT NOT NULL,
    "tenantId"             TEXT NOT NULL,
    "locationId"           TEXT NOT NULL,
    "slipType"             TEXT NOT NULL,
    "monthlyRateCents"     INTEGER NOT NULL,
    "quarterlyRateCents"   INTEGER,
    "annualRateCents"      INTEGER,
    "electricityMode"      "ElectricityMode" NOT NULL DEFAULT 'METERED',
    "electricityRateCents" INTEGER,
    "glAccountId"          TEXT,
    "taxClass"             TEXT DEFAULT 'Standard',
    "active"               BOOLEAN NOT NULL DEFAULT true,
    "effectiveFrom"        TIMESTAMP(3),
    "effectiveTo"          TIMESTAMP(3),
    "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dockage_rates_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "dockage_rates_tenantId_idx"   ON "dockage_rates" ("tenantId");
CREATE INDEX IF NOT EXISTS "dockage_rates_locationId_idx" ON "dockage_rates" ("locationId");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'dockage_rates_locationId_fkey'
      AND table_name = 'dockage_rates') THEN
    ALTER TABLE "dockage_rates" ADD CONSTRAINT "dockage_rates_locationId_fkey"
      FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- ── service_fees ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "service_fees" (
    "id"          TEXT NOT NULL,
    "tenantId"    TEXT NOT NULL,
    "locationId"  TEXT NOT NULL,
    "name"        TEXT NOT NULL,
    "feeType"     "FeeType" NOT NULL DEFAULT 'FLAT',
    "amountCents" INTEGER,
    "pct"         DOUBLE PRECISION,
    "glAccountId" TEXT,
    "taxClass"    TEXT DEFAULT 'Tax Exempt',
    "active"      BOOLEAN NOT NULL DEFAULT true,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_fees_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "service_fees_tenantId_idx"   ON "service_fees" ("tenantId");
CREATE INDEX IF NOT EXISTS "service_fees_locationId_idx" ON "service_fees" ("locationId");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'service_fees_locationId_fkey'
      AND table_name = 'service_fees') THEN
    ALTER TABLE "service_fees" ADD CONSTRAINT "service_fees_locationId_fkey"
      FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- ── portal_messages ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "portal_messages" (
    "id"         TEXT NOT NULL,
    "tenantId"   TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "sender"     TEXT NOT NULL,
    "staffName"  TEXT,
    "content"    TEXT NOT NULL,
    "read"       BOOLEAN NOT NULL DEFAULT false,
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "portal_messages_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "portal_messages_tenantId_customerId_idx"
  ON "portal_messages" ("tenantId", "customerId");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'portal_messages_tenantId_fkey'
      AND table_name = 'portal_messages') THEN
    ALTER TABLE "portal_messages" ADD CONSTRAINT "portal_messages_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'portal_messages_customerId_fkey'
      AND table_name = 'portal_messages') THEN
    ALTER TABLE "portal_messages" ADD CONSTRAINT "portal_messages_customerId_fkey"
      FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
