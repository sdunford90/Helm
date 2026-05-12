-- Normalize legacy "no override" sentinels in products.taxClass to NULL.
-- The resolver in apps/api/src/services/product-defaults.ts treats
-- empty strings, pure whitespace, and the literal "Standard" / "standard"
-- (case-insensitive, trimmed) as "no per-product override", but rows
-- created before that resolver existed still carry those values, which
-- makes the inventory list / product modal look like an override is set
-- when it isn't. NULL them out so the UI matches the runtime behavior.
--
-- Idempotent: re-running this is a no-op once the legacy values are gone.
UPDATE "products"
SET "taxClass" = NULL
WHERE "taxClass" IS NOT NULL
  AND LOWER(TRIM("taxClass")) IN ('', 'standard');
