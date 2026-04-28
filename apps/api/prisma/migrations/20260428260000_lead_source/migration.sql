-- Migration: Lead source as a first-class field
--
-- Adds a LeadSource enum + `source` / `sourceDetail` columns to leads so
-- walk-ins, phone calls, and other in-person leads are first-class
-- citizens alongside web/UTM-attributed leads. Existing leads are
-- backfilled to the most likely source based on the digital-attribution
-- fields they carry today.

CREATE TYPE "LeadSource" AS ENUM (
    'WEBSITE',
    'REFERRAL',
    'WALK_IN',
    'PHONE',
    'SOCIAL_MEDIA',
    'EMAIL',
    'OTHER'
);

ALTER TABLE "leads"
    ADD COLUMN "source" "LeadSource" NOT NULL DEFAULT 'OTHER',
    ADD COLUMN "sourceDetail" TEXT;

-- Backfill: WEBSITE wins when there's any digital-form / UTM signal,
-- REFERRAL takes precedence when a referral code is present (more specific).
UPDATE "leads"
   SET "source" = 'WEBSITE'
 WHERE ("sourceFormId" IS NOT NULL OR "utmSource" IS NOT NULL)
   AND "source" = 'OTHER';

UPDATE "leads"
   SET "source" = 'REFERRAL'
 WHERE "referralCode" IS NOT NULL;

CREATE INDEX "leads_source_idx" ON "leads"("source");
