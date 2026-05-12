-- Task #320 review fix: add the two new asset accounts the Z-out journal
-- posts tender splits against — ACH Clearing (1015) and Undeposited
-- Funds (1020) for declared check/other. Backfilled here so existing
-- tenants don't trip "UNCONFIGURED_GL_ACCOUNT" on first Z-out; new
-- tenants get them via DEFAULT_GL_ACCOUNTS at provisioning.

INSERT INTO "gl_accounts" ("id", "tenantId", "accountNumber", "name", "type", "isDeferredRevenue")
SELECT gen_random_uuid()::text, t."id", '1015', 'ACH Clearing', 'ASSET', false
FROM "tenants" t
WHERE NOT EXISTS (
  SELECT 1 FROM "gl_accounts" a
  WHERE a."tenantId" = t."id" AND a."accountNumber" = '1015'
);

INSERT INTO "gl_accounts" ("id", "tenantId", "accountNumber", "name", "type", "isDeferredRevenue")
SELECT gen_random_uuid()::text, t."id", '1020', 'Undeposited Funds', 'ASSET', false
FROM "tenants" t
WHERE NOT EXISTS (
  SELECT 1 FROM "gl_accounts" a
  WHERE a."tenantId" = t."id" AND a."accountNumber" = '1020'
);
