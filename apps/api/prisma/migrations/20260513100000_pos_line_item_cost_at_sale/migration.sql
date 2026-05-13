-- Plan 3 — Record per-line cost at sale time so Z-out can post COGS.
--
-- Prior to this column, POS sales decremented qtyOnHand but never captured
-- the cost basis of the units that left. Z-out posted revenue per category
-- but had no way to also debit COGS / credit Inventory Asset, which meant
-- COGS expense was silently missing from the P&L. This column lets the
-- existing Z-out journal carry both legs.

ALTER TABLE "pos_line_items"
  ADD COLUMN IF NOT EXISTS "costAtSaleCents" INTEGER;
