-- AlterTable
ALTER TABLE "locations" ADD COLUMN "rampEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "locations" ADD COLUMN "conciergeEnabled" BOOLEAN NOT NULL DEFAULT true;
