-- Task #320 round 6 review fixes:
--   1. Add per-location Z-report recipient list so the email endpoint
--      can fall back to a configured manager distribution list instead
--      of always requiring a manually entered recipient.
--   2. Add a partial unique index on z_reports(tenantId, zNumber) for
--      rows where locationId IS NULL. The composite unique
--      (tenantId, locationId, zNumber) doesn't cover NULL locationId
--      in Postgres because NULLs are treated as distinct, which means
--      two concurrent Z-outs against a null-location tenant could land
--      duplicate zNumbers. The partial unique closes that race.

ALTER TABLE "locations"
  ADD COLUMN "zReportRecipients" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

CREATE UNIQUE INDEX "z_reports_tenantId_zNumber_null_location_uq"
  ON "z_reports"("tenantId", "zNumber")
  WHERE "locationId" IS NULL;
