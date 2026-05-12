-- Task #320: True POS Z-out end-of-day close
--
-- Adds a manager-confirmed Z-report layer on top of the existing cashier
-- shift close: shifts gain declared-tender / paid-out columns plus a link
-- to the immutable ZReport that finalized them. ZReport carries a
-- per-(tenant, locationId) sequential Z number, the full snapshot JSON,
-- key totals as columns, and a pointer to the GL journal posted at
-- commit time.

-- ── Shift: declared non-cash tenders, paid-outs, ZReport link ────────────
ALTER TABLE "shifts"
  ADD COLUMN "declaredCheckCents" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "declaredOtherCents" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "paidOutsCents"      INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "zReportId"          TEXT;

-- Index used by the open-shift gate ("any prior CLOSED but not RECONCILED
-- shift at this location?") and by the Z-out manager landing list.
CREATE INDEX "shifts_tenantId_locationId_status_idx"
  ON "shifts"("tenantId", "locationId", "status");

-- ── ZReport: immutable end-of-day snapshot ──────────────────────────────
CREATE TABLE "z_reports" (
  "id"                 TEXT PRIMARY KEY,
  "tenantId"           TEXT NOT NULL,
  "locationId"         TEXT,
  "shiftId"            TEXT NOT NULL,
  "zNumber"            INTEGER NOT NULL,
  "generatedByUserId"  TEXT,
  "generatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lockedAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "glJournalId"        TEXT,
  "notes"              TEXT,
  "grossSalesCents"    INTEGER NOT NULL,
  "discountsCents"     INTEGER NOT NULL,
  "refundsCents"       INTEGER NOT NULL,
  "netSalesCents"      INTEGER NOT NULL,
  "taxCents"           INTEGER NOT NULL,
  "tipsCents"          INTEGER NOT NULL,
  "totalCents"         INTEGER NOT NULL,
  "cashExpectedCents"  INTEGER NOT NULL,
  "cashCountedCents"   INTEGER NOT NULL,
  "cashVarianceCents"  INTEGER NOT NULL,
  "snapshot"           JSONB NOT NULL
);

CREATE UNIQUE INDEX "z_reports_shiftId_key" ON "z_reports"("shiftId");
CREATE INDEX "z_reports_tenantId_idx" ON "z_reports"("tenantId");
CREATE INDEX "z_reports_tenantId_locationId_generatedAt_idx"
  ON "z_reports"("tenantId", "locationId", "generatedAt");
-- The (tenant, location, zNumber) unique constraint enforces gap-free
-- monotonic numbering per location at the database level. The Z-out
-- transaction picks the next number with `MAX(zNumber)+1` under
-- repeatable-read isolation; concurrent commits at the same location
-- collide on this index and the second one retries.
CREATE UNIQUE INDEX "z_reports_tenantId_locationId_zNumber_key"
  ON "z_reports"("tenantId", "locationId", "zNumber");

-- Shift → ZReport one-to-one. ON DELETE SET NULL so a manual ZReport
-- delete (admin tooling, not exposed in product) doesn't cascade-kill
-- the shift; ON UPDATE CASCADE for completeness.
CREATE UNIQUE INDEX "shifts_zReportId_key" ON "shifts"("zReportId");
ALTER TABLE "shifts"
  ADD CONSTRAINT "shifts_zReportId_fkey"
  FOREIGN KEY ("zReportId") REFERENCES "z_reports"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- ── Cash Over/Short GL account (5900) ───────────────────────────────────
-- Auto-heal target for tenants that already have a chart of accounts;
-- the seed and `gl-posting.ts::SYSTEM_ACCOUNT_DEFINITIONS` are also
-- updated so freshly provisioned tenants get the row at onboarding.
INSERT INTO "gl_accounts" ("id", "tenantId", "accountNumber", "name", "type", "isDeferredRevenue")
SELECT gen_random_uuid()::text, t."id", '5900', 'Cash Over/Short', 'EXPENSE', false
FROM "tenants" t
WHERE NOT EXISTS (
  SELECT 1 FROM "gl_accounts" a
  WHERE a."tenantId" = t."id" AND a."accountNumber" = '5900'
);
