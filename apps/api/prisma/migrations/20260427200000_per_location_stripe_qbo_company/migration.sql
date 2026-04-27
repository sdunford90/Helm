-- AlterTable
ALTER TABLE "locations" ADD COLUMN "qboCompanyName" TEXT;
ALTER TABLE "locations" ADD COLUMN "stripeAccountId" TEXT;
ALTER TABLE "locations" ADD COLUMN "stripeOnboardingComplete" BOOLEAN NOT NULL DEFAULT false;
