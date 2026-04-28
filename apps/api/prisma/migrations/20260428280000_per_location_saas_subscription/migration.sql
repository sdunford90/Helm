-- Move SaaS subscription state from Tenant to Location.
-- Each marina (= Location) is now its own billable unit with its own Stripe
-- customer + subscription + tier. The matching Tenant columns are kept as
-- deprecated read-only mirrors during the transition.

-- 1. Add the new per-location billing columns.
ALTER TABLE "locations" ADD COLUMN "saasTierId"           TEXT;
ALTER TABLE "locations" ADD COLUMN "stripeCustomerId"     TEXT;
ALTER TABLE "locations" ADD COLUMN "stripeSubscriptionId" TEXT;
ALTER TABLE "locations" ADD COLUMN "subscriptionStatus"   TEXT;
ALTER TABLE "locations" ADD COLUMN "gracePeriodStartedAt" TIMESTAMP(3);

-- 2. FK + indexes.
ALTER TABLE "locations"
  ADD CONSTRAINT "locations_saasTierId_fkey"
  FOREIGN KEY ("saasTierId") REFERENCES "saas_tiers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "locations_stripeCustomerId_idx"     ON "locations"("stripeCustomerId");
CREATE INDEX "locations_stripeSubscriptionId_idx" ON "locations"("stripeSubscriptionId");

-- 3. Backfill: copy each tenant's existing subscription onto its first
--    (oldest by createdAt) location. Tenants with no locations get nothing
--    copied — the create-tenant flow now requires an initial location.
WITH primary_loc AS (
  SELECT DISTINCT ON ("tenantId")
    "id" AS "locationId",
    "tenantId"
  FROM "locations"
  ORDER BY "tenantId", "createdAt" ASC
)
UPDATE "locations" AS l
SET
  "saasTierId"           = t."saasTierId",
  "stripeCustomerId"     = t."stripeCustomerId",
  "stripeSubscriptionId" = t."stripeSubscriptionId",
  "gracePeriodStartedAt" = t."gracePeriodStartedAt"
FROM "tenants" AS t
JOIN primary_loc p ON p."tenantId" = t."id"
WHERE l."id" = p."locationId"
  AND (
    t."saasTierId"           IS NOT NULL OR
    t."stripeCustomerId"     IS NOT NULL OR
    t."stripeSubscriptionId" IS NOT NULL OR
    t."gracePeriodStartedAt" IS NOT NULL
  );
