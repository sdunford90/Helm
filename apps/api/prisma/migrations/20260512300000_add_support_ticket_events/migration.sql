-- A10 — Per-ticket audit/timeline rows.
--
-- Internal notes, status changes, and assignment changes all land here in
-- chronological order so the right-pane detail view in admin Support has
-- a single source of truth.

CREATE TABLE IF NOT EXISTS "support_ticket_events" (
  "id"          TEXT PRIMARY KEY,
  "ticketId"    TEXT NOT NULL,
  "actorUserId" TEXT,
  "actorEmail"  TEXT,
  "kind"        TEXT NOT NULL,
  "body"        TEXT,
  "status"      TEXT,
  "assignedTo"  TEXT,
  "internal"    BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "support_ticket_events_ticket_created_idx"
  ON "support_ticket_events" ("ticketId", "createdAt");
