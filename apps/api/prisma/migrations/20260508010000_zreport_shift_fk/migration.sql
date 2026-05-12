-- Task #320 review fix: replace the optional shifts.zReportId column with
-- a real FK on z_reports.shiftId → shifts.id, so the one-to-one
-- relationship is database-enforced. The original migration carried the
-- FK on the wrong side (shifts.zReportId nullable, no FK on z_reports);
-- this migration moves the constraint to the canonical side and drops
-- the redundant column.

-- Drop the old shift-side join: FK first, then unique index, then column.
ALTER TABLE "shifts" DROP CONSTRAINT IF EXISTS "shifts_zReportId_fkey";
DROP INDEX  IF EXISTS "shifts_zReportId_key";
ALTER TABLE "shifts" DROP COLUMN IF EXISTS "zReportId";

-- Add the proper FK from z_reports.shiftId → shifts.id. The unique index
-- on shiftId already exists from the prior migration so the relation
-- stays one-to-one. RESTRICT on delete keeps the immutable Z-report
-- history intact even if someone tries to remove the underlying shift.
ALTER TABLE "z_reports"
  ADD CONSTRAINT "z_reports_shiftId_fkey"
  FOREIGN KEY ("shiftId") REFERENCES "shifts"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
