-- Per-location toggle controlling whether the POS counter exposes the ACH
-- payment button. Defaults to false so existing locations behave identically
-- to a fresh marina (Cash, Card, Charge to Slip only) until an admin opts in.
ALTER TABLE "locations"
  ADD COLUMN "posAchEnabled" BOOLEAN NOT NULL DEFAULT false;
