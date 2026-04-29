-- Migration: Custom roles & per-tenant role permissions
--
-- Adds two tables (`custom_roles`, `role_permissions`) and a nullable
-- `customRoleId` FK on `users`. Mirrors the Prisma models that have
-- existed for several iterations but were never captured in a migration
-- (the dev database was kept in sync via direct schema push). Production
-- replays migrations from scratch and was missing all three objects,
-- causing seeds to fail with `column users.customRoleId does not exist`.

-- ── custom_roles ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "custom_roles" (
    "id"          TEXT NOT NULL,
    "tenantId"    TEXT NOT NULL,
    "name"        TEXT NOT NULL,
    "description" TEXT,
    "color"       TEXT NOT NULL DEFAULT '#64748B',
    "isSystem"    BOOLEAN NOT NULL DEFAULT false,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "custom_roles_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "custom_roles_tenantId_idx" ON "custom_roles" ("tenantId");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'custom_roles_tenantId_fkey'
      AND table_name = 'custom_roles') THEN
    ALTER TABLE "custom_roles" ADD CONSTRAINT "custom_roles_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- ── role_permissions ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "role_permissions" (
    "id"        TEXT NOT NULL,
    "roleId"    TEXT NOT NULL,
    "module"    TEXT NOT NULL,
    "canView"   BOOLEAN NOT NULL DEFAULT false,
    "canCreate" BOOLEAN NOT NULL DEFAULT false,
    "canEdit"   BOOLEAN NOT NULL DEFAULT false,
    "canDelete" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "role_permissions_roleId_module_key"
  ON "role_permissions" ("roleId", "module");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'role_permissions_roleId_fkey'
      AND table_name = 'role_permissions') THEN
    ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_roleId_fkey"
      FOREIGN KEY ("roleId") REFERENCES "custom_roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- ── users.customRoleId ─────────────────────────────────────────────────
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "customRoleId" TEXT;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'users_customRoleId_fkey'
      AND table_name = 'users') THEN
    ALTER TABLE "users" ADD CONSTRAINT "users_customRoleId_fkey"
      FOREIGN KEY ("customRoleId") REFERENCES "custom_roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
