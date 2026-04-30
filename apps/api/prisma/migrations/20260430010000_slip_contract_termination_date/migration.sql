-- Add a dedicated terminationDate column to slip_contracts so early
-- terminations no longer overwrite the scheduled endDate. Nullable + DATE
-- to match the other calendar columns on this table.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'slip_contracts'
      AND column_name = 'terminationDate'
  ) THEN
    ALTER TABLE "slip_contracts"
      ADD COLUMN "terminationDate" date;
  END IF;
END $$;

-- Backfill: pre-existing TERMINATED rows had the termination date stored in
-- endDate (the original scheduled end was overwritten and is unrecoverable).
-- Copy it into the new column so it isn't lost. New terminations write
-- terminationDate directly and leave endDate alone.
UPDATE "slip_contracts"
   SET "terminationDate" = "endDate"
 WHERE "status" = 'TERMINATED'
   AND "terminationDate" IS NULL
   AND "endDate" IS NOT NULL;
