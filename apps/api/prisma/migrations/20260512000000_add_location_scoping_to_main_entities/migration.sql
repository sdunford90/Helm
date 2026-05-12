-- Task #339: add a concrete locationId to the operational tables that the
-- top-right location picker needs to filter on. Customer / Boat / SlipContract
-- did not previously carry a location; Lead and Invoice already do.
--
-- Columns are added nullable so this migration is non-blocking. A
-- best-effort backfill below derives the location from each row's strongest
-- existing relation. Rows that can't be derived stay NULL and the API
-- middleware treats NULL rows as "tenant-wide visible" — operators can
-- assign a location later from the UI without a downtime window.

ALTER TABLE "customers" ADD COLUMN "locationId" TEXT;
ALTER TABLE "boats" ADD COLUMN "locationId" TEXT;
ALTER TABLE "slip_contracts" ADD COLUMN "locationId" TEXT;

ALTER TABLE "customers"
  ADD CONSTRAINT "customers_locationId_fkey"
  FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "boats"
  ADD CONSTRAINT "boats_locationId_fkey"
  FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "slip_contracts"
  ADD CONSTRAINT "slip_contracts_locationId_fkey"
  FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "customers_tenantId_locationId_idx" ON "customers" ("tenantId", "locationId");
CREATE INDEX "boats_tenantId_locationId_idx" ON "boats" ("tenantId", "locationId");
CREATE INDEX "slip_contracts_tenantId_locationId_idx" ON "slip_contracts" ("tenantId", "locationId");
CREATE INDEX "leads_tenantId_locationId_idx" ON "leads" ("tenantId", "locationId");

-- ── Backfill ───────────────────────────────────────────────────────────────

-- SlipContract → from slip.locationId (most reliable: a contract is anchored
-- to exactly one slip, and slips already carry the location).
UPDATE "slip_contracts" sc
SET "locationId" = s."locationId"
FROM "slips" s
WHERE sc."slipId" = s."id" AND s."locationId" IS NOT NULL;

-- Boat → from the most recent ACTIVE/DRAFT contract's slip location.
UPDATE "boats" b
SET "locationId" = sub."locationId"
FROM (
  SELECT DISTINCT ON (sc."boatId") sc."boatId", s."locationId"
  FROM "slip_contracts" sc
  JOIN "slips" s ON s."id" = sc."slipId"
  WHERE sc."boatId" IS NOT NULL AND s."locationId" IS NOT NULL
  ORDER BY sc."boatId", sc."startDate" DESC
) sub
WHERE b."id" = sub."boatId";

-- Customer → most recent contract's slip.locationId, then fallback to most
-- recent invoice.locationId, then fallback to tenant's first active location.
UPDATE "customers" c
SET "locationId" = sub."locationId"
FROM (
  SELECT DISTINCT ON (sc."customerId") sc."customerId", s."locationId"
  FROM "slip_contracts" sc
  JOIN "slips" s ON s."id" = sc."slipId"
  WHERE s."locationId" IS NOT NULL
  ORDER BY sc."customerId", sc."startDate" DESC
) sub
WHERE c."id" = sub."customerId" AND c."locationId" IS NULL;

UPDATE "customers" c
SET "locationId" = sub."locationId"
FROM (
  SELECT DISTINCT ON (i."customerId") i."customerId", i."locationId"
  FROM "invoices" i
  WHERE i."locationId" IS NOT NULL
  ORDER BY i."customerId", i."issuedDate" DESC
) sub
WHERE c."id" = sub."customerId" AND c."locationId" IS NULL;

-- Final fallback: stamp tenant's oldest active location so the row at least
-- becomes visible to single-location tenants without manual intervention.
UPDATE "customers" c
SET "locationId" = sub."id"
FROM (
  SELECT DISTINCT ON ("tenantId") "id", "tenantId"
  FROM "locations"
  WHERE "active" = true
  ORDER BY "tenantId", "createdAt" ASC
) sub
WHERE c."tenantId" = sub."tenantId" AND c."locationId" IS NULL;

-- Same chain for Boats: customer's location as a fallback.
UPDATE "boats" b
SET "locationId" = c."locationId"
FROM "customers" c
WHERE b."customerId" = c."id" AND b."locationId" IS NULL AND c."locationId" IS NOT NULL;

-- Lead backfill: tenant default location for leads that lack one.
UPDATE "leads" l
SET "locationId" = sub."id"
FROM (
  SELECT DISTINCT ON ("tenantId") "id", "tenantId"
  FROM "locations"
  WHERE "active" = true
  ORDER BY "tenantId", "createdAt" ASC
) sub
WHERE l."tenantId" = sub."tenantId" AND l."locationId" IS NULL;

-- Invoice backfill: derive from the linked contract's slip location for any
-- invoice that still lacks one. (Invoices already had a nullable column.)
UPDATE "invoices" i
SET "locationId" = sub."locationId"
FROM (
  SELECT DISTINCT ili."invoiceId", s."locationId"
  FROM "invoice_line_items" ili
  JOIN "slip_contracts" sc ON sc."id" = ili."sourceId" AND ili."sourceType" = 'CONTRACT'
  JOIN "slips" s ON s."id" = sc."slipId"
  WHERE s."locationId" IS NOT NULL
) sub
WHERE i."id" = sub."invoiceId" AND i."locationId" IS NULL;
