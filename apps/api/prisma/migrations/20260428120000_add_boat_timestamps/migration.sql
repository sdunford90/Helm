-- Migration: Give Boat its own createdAt / updatedAt columns.
-- Backfills existing rows using the earliest "Boat CREATED" audit-log entry
-- when one exists, falling back to NOW() otherwise.

ALTER TABLE "boats" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3);
ALTER TABLE "boats" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);

-- Backfill createdAt from the earliest matching audit-log row, when present.
UPDATE "boats" b
SET "createdAt" = a."createdAt"
FROM (
  SELECT "recordId", MIN("createdAt") AS "createdAt"
  FROM "audit_logs"
  WHERE "recordType" = 'Boat' AND "action" = 'CREATED'
  GROUP BY "recordId"
) a
WHERE a."recordId" = b."id" AND b."createdAt" IS NULL;

-- Anything still NULL falls back to now().
UPDATE "boats" SET "createdAt" = CURRENT_TIMESTAMP WHERE "createdAt" IS NULL;

-- Backfill updatedAt from the latest audit-log entry of any action, when
-- present; otherwise mirror createdAt.
UPDATE "boats" b
SET "updatedAt" = a."updatedAt"
FROM (
  SELECT "recordId", MAX("createdAt") AS "updatedAt"
  FROM "audit_logs"
  WHERE "recordType" = 'Boat'
  GROUP BY "recordId"
) a
WHERE a."recordId" = b."id" AND b."updatedAt" IS NULL;

UPDATE "boats" SET "updatedAt" = "createdAt" WHERE "updatedAt" IS NULL;

-- Lock the columns down now that every row has a value.
ALTER TABLE "boats" ALTER COLUMN "createdAt" SET NOT NULL;
ALTER TABLE "boats" ALTER COLUMN "createdAt" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "boats" ALTER COLUMN "updatedAt" SET NOT NULL;
