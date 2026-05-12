-- Migration: Backfill Product.locationId so no inventory product is left
-- tenant-wide (locationId IS NULL). Pairs with the API change in
-- apps/api/src/routes/inventory.ts that drops the
-- `OR locationId IS NULL` clause from the products list — without this
-- backfill, legacy unassigned products would simply disappear from every
-- marina's inventory page after deploy (Task #340).
--
-- Per-tenant primary location selection rule (matches Task #340 spec):
--   1. The Location model has no primary/default boolean today, so we
--      pick the OLDEST location by createdAt (deterministic tie-break
--      on id). No active/inactive preference — strictly oldest, as the
--      task requires.
--   2. Hard invariant after this migration: zero rows in `products`
--      may have locationId IS NULL. If a tenant has zero Location rows,
--      we surface that as an actionable error and FAIL the migration —
--      the task acceptance criteria require "none remain unassigned",
--      and silently leaving rows behind would let the leak persist
--      under the new strict API filter.
--
-- Idempotent: re-running is a no-op because the UPDATE only touches
-- rows where locationId IS NULL.

-- ─── Step 1: Backfill (oldest location by createdAt per tenant) ───────────

WITH primary_locations AS (
  SELECT DISTINCT ON (l."tenantId")
    l."tenantId" AS tenant_id,
    l."id"       AS location_id,
    l."name"     AS location_name
  FROM "locations" l
  ORDER BY
    l."tenantId",
    l."createdAt" ASC,         -- oldest by createdAt (per Task #340)
    l."id" ASC                 -- deterministic tie-break
),
updated AS (
  UPDATE "products" p
     SET "locationId" = pl.location_id,
         "updatedAt"  = NOW()
    FROM primary_locations pl
   WHERE p."locationId" IS NULL
     AND p."tenantId"   = pl.tenant_id
  RETURNING p."tenantId" AS tenant_id, pl.location_id, pl.location_name
)
SELECT
  tenant_id,
  location_id,
  location_name,
  COUNT(*) AS products_assigned
INTO TEMP TABLE _backfill_summary
FROM updated
GROUP BY tenant_id, location_id, location_name
ORDER BY tenant_id;

-- ─── Step 2: Per-tenant NOTICE audit log ──────────────────────────────────
-- RAISE NOTICE output is captured by `prisma migrate deploy` and shown in
-- deploy logs, so the per-tenant summary is preserved for post-deploy
-- review (tenant id, chosen location, count of rows updated).

DO $$
DECLARE
  rec RECORD;
  total_updated BIGINT := 0;
BEGIN
  FOR rec IN
    SELECT tenant_id, location_id, location_name, products_assigned
      FROM _backfill_summary
     ORDER BY tenant_id
  LOOP
    RAISE NOTICE
      'backfill_product_location: tenant=% chose location=% (%) — assigned % product(s)',
      rec.tenant_id, rec.location_id, rec.location_name, rec.products_assigned;
    total_updated := total_updated + rec.products_assigned;
  END LOOP;
  RAISE NOTICE
    'backfill_product_location: total products assigned = %', total_updated;
END $$;

DROP TABLE _backfill_summary;

-- ─── Step 3: Hard invariant — fail the migration if anything remains. ────
-- Surfaces a precise list of offending tenants so a human can either
-- create the missing Location row(s) and re-run, or hard-delete the
-- orphan products before retrying.

DO $$
DECLARE
  remaining BIGINT;
  rec RECORD;
  detail TEXT := '';
BEGIN
  SELECT COUNT(*) INTO remaining
    FROM "products"
   WHERE "locationId" IS NULL;

  IF remaining > 0 THEN
    FOR rec IN
      SELECT "tenantId" AS tenant_id, COUNT(*) AS n
        FROM "products"
       WHERE "locationId" IS NULL
       GROUP BY "tenantId"
       ORDER BY "tenantId"
    LOOP
      detail := detail
        || E'\n  - tenant ' || COALESCE(rec.tenant_id::text, '<NULL>')
        || ': ' || rec.n || ' product(s) still unassigned';
    END LOOP;
    RAISE EXCEPTION
      E'backfill_product_location FAILED: % product row(s) still have NULL locationId (Task #340 invariant). Likely cause: tenant has zero Location rows. Affected:%\nFix: create the tenant''s primary Location (or hard-delete the orphan products) and re-run the migration.',
      remaining, detail;
  END IF;
END $$;
