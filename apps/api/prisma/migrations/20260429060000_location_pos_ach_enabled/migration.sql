-- Per-location toggle controlling whether the POS counter exposes the ACH
-- payment button. Defaults to false so existing locations behave identically
-- to a fresh marina (Cash, Card, Charge to Slip only) until an admin opts in.
--
-- IF NOT EXISTS guard makes this safe to retry: an earlier production deploy
-- partially applied this migration (column landed) and then failed for an
-- unrelated reason, leaving _prisma_migrations marked failed (P3009). Without
-- the guard, retrying crashes with 42701 (duplicate column).
ALTER TABLE "locations"
  ADD COLUMN IF NOT EXISTS "posAchEnabled" BOOLEAN NOT NULL DEFAULT false;
