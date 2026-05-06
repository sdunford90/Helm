-- Per-tenant + per-location outbound email sender configuration.
--
-- Lets each marina send customer-facing email FROM their own verified
-- Resend domain (e.g. billing@app.tracktheturn.com) instead of the
-- shared noreply@gethelm.com fallback. Resolution order at send time:
-- location override → tenant default → noreply@gethelm.com.
--
-- Also adds three "last failure" columns on tenant so the Settings
-- "Email sending" health row can show why a recent send failed
-- without operators having to dig through worker logs.

ALTER TABLE "tenants"
  ADD COLUMN "emailFromDomain"           TEXT,
  ADD COLUMN "emailFromAddress"          TEXT,
  ADD COLUMN "emailFromName"             TEXT,
  ADD COLUMN "emailReplyTo"              TEXT,
  ADD COLUMN "lastEmailFailureAt"        TIMESTAMP(3),
  ADD COLUMN "lastEmailFailureRecipient" TEXT,
  ADD COLUMN "lastEmailFailureReason"    TEXT;

ALTER TABLE "locations"
  ADD COLUMN "emailFromDomain"  TEXT,
  ADD COLUMN "emailFromAddress" TEXT,
  ADD COLUMN "emailFromName"    TEXT,
  ADD COLUMN "emailReplyTo"     TEXT;
