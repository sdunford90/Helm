-- Convert slip_contracts calendar columns from timestamp(3) to date.
-- timestamp::date truncates the time portion without consulting any
-- session timezone, so existing UTC-midnight values map cleanly to the
-- same calendar day. Each ALTER is guarded by an information_schema
-- check so a retry on partial completion stays idempotent.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'slip_contracts'
      AND column_name = 'startDate'
      AND data_type <> 'date'
  ) THEN
    ALTER TABLE "slip_contracts"
      ALTER COLUMN "startDate" TYPE date
      USING "startDate"::date;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'slip_contracts'
      AND column_name = 'endDate'
      AND data_type <> 'date'
  ) THEN
    ALTER TABLE "slip_contracts"
      ALTER COLUMN "endDate" TYPE date
      USING "endDate"::date;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'slip_contracts'
      AND column_name = 'signedAt'
      AND data_type <> 'date'
  ) THEN
    ALTER TABLE "slip_contracts"
      ALTER COLUMN "signedAt" TYPE date
      USING "signedAt"::date;
  END IF;
END $$;
