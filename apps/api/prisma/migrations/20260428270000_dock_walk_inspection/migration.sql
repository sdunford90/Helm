-- Dock walk inspection enrichment.
-- Adds three nullable columns to dock_walk_items so the per-slip
-- inspector flow can record:
--   * boat_present     — was a boat actually in the slip at walk time
--   * expected_match   — did the boat in the slip match the expected boat
--                        from the active SlipContract (NULL when unknown
--                        or when no boat present)
--   * expected_boat_id — snapshot of the expected boat id at walk time,
--                        so historical walks survive later contract edits

ALTER TABLE "dock_walk_items"
  ADD COLUMN "boatPresent"    BOOLEAN,
  ADD COLUMN "expectedMatch"  BOOLEAN,
  ADD COLUMN "expectedBoatId" TEXT;
