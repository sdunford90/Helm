-- Task #274: Tie SlipContract back to its DockageRate "rate plan".
--
-- Adds an optional FK so the billing engine can resolve GL/tax from the
-- linked plan instead of re-deriving by (locationId, slipType) every run.
-- Locked-in `rateCents` on the contract remains authoritative for amount;
-- this column just makes the plan relationship explicit and auditable.
--
-- ON DELETE SET NULL: if a plan is removed/deactivated we don't want to
-- cascade-delete contracts. The UI shows them as "unlinked" so an
-- operator can re-pick a plan.

ALTER TABLE "slip_contracts"
  ADD COLUMN "dockageRateId" TEXT;

ALTER TABLE "slip_contracts"
  ADD CONSTRAINT "slip_contracts_dockageRateId_fkey"
  FOREIGN KEY ("dockageRateId") REFERENCES "dockage_rates"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "slip_contracts_dockageRateId_idx"
  ON "slip_contracts" ("dockageRateId");

-- Backfill existing contracts with their best-match active rate plan,
-- using the same (tenant, location, slipType) heuristic the billing
-- engine has been running ad-hoc. We pick the most recently updated
-- ACTIVE plan when multiple match. Rows where no plan exists (or where
-- the slip has no location/slipType) stay NULL and surface in the UI
-- as "unlinked" so an operator can pick one.
UPDATE "slip_contracts" sc
SET "dockageRateId" = dr.id
FROM "slips" s, "dockage_rates" dr
WHERE sc."slipId" = s.id
  AND s."locationId" IS NOT NULL
  AND s."slipType" IS NOT NULL
  AND dr."tenantId" = sc."tenantId"
  AND dr."locationId" = s."locationId"
  AND dr."slipType" = s."slipType"
  AND dr."active" = true
  AND dr.id = (
    SELECT dr2.id FROM "dockage_rates" dr2
    WHERE dr2."tenantId" = sc."tenantId"
      AND dr2."locationId" = s."locationId"
      AND dr2."slipType" = s."slipType"
      AND dr2."active" = true
    ORDER BY dr2."updatedAt" DESC
    LIMIT 1
  )
  AND sc."dockageRateId" IS NULL;
