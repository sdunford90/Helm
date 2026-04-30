#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT_DIR="$(pwd)"

API_PORT="${API_PORT:-3001}"
HEALTH_URL="http://localhost:${API_PORT}/api/health"

echo "[deploy-run] starting in $ROOT_DIR (api port=${API_PORT})"

cd apps/api

if [ "${HELM_PROD_FORCE_RESET:-}" = "yes" ]; then
  # Defense-in-depth: even when the operator flips the reset flag on, refuse
  # to drop the schema if the database already contains tenants. This makes
  # accidentally leaving HELM_PROD_FORCE_RESET=yes between deploys non-fatal
  # for real customer data — the script will fall through to a normal
  # `migrate deploy` instead of a destructive reset.
  TENANT_COUNT=$(node -e "
    const { PrismaClient } = require('@prisma/client');
    (async () => {
      const p = new PrismaClient();
      try {
        const c = await p.tenant.count();
        console.log(c);
      } catch (e) {
        // tenants table may not exist yet (truly fresh DB) — treat as 0
        console.log(0);
      } finally {
        await p.\$disconnect();
      }
    })();
  " 2>/dev/null || echo 0)

  if [ "$TENANT_COUNT" -gt 0 ]; then
    echo "[deploy-run] HELM_PROD_FORCE_RESET=yes but database has ${TENANT_COUNT} tenant(s) — REFUSING to reset, falling back to migrate deploy"
    npx prisma migrate deploy
  else
    echo "[deploy-run] HELM_PROD_FORCE_RESET=yes and database is empty — resetting schema"
    npx prisma migrate reset --force --skip-seed
  fi
else
  # One-shot recovery for migration 20260429060000_location_pos_ach_enabled.
  # An earlier production deploy partially applied this migration: the column
  # landed on the table, then prisma marked the migration as failed for an
  # unrelated reason. Every subsequent deploy then crashes with P3009 because
  # prisma refuses to apply new migrations while a failed row exists.
  #
  # The migration SQL has been made idempotent (ADD COLUMN IF NOT EXISTS), so
  # if we just clear the failed marker, the next migrate deploy will re-run it
  # successfully and life moves on. We scope the rollback to this single
  # migration name so we never auto-clear a different operator-review-worthy
  # failure.
  STUCK_MIGRATION="20260429060000_location_pos_ach_enabled"
  STUCK_FAILED=$(node -e "
    const { PrismaClient } = require('@prisma/client');
    (async () => {
      const p = new PrismaClient();
      try {
        const rows = await p.\$queryRawUnsafe(
          \`SELECT 1 FROM \"_prisma_migrations\" WHERE migration_name = '${STUCK_MIGRATION}' AND finished_at IS NULL\`
        );
        console.log(rows.length > 0 ? 'yes' : 'no');
      } catch (e) {
        console.log('no');
      } finally {
        await p.\$disconnect();
      }
    })();
  " 2>/dev/null || echo no)

  if [ "$STUCK_FAILED" = "yes" ]; then
    echo "[deploy-run] detected failed migration ${STUCK_MIGRATION} — rolling it back so the (now-idempotent) SQL can re-run"
    npx prisma migrate resolve --rolled-back "${STUCK_MIGRATION}" || \
      echo "[deploy-run] WARNING: rolled-back resolve returned non-zero — proceeding to migrate deploy anyway"
  fi

  # One-shot recovery for migration 20260429080000_inventory_category_only_gl.
  # Step 4 of that migration runs `ALTER TABLE products ALTER COLUMN
  # productCategoryId SET NOT NULL`, which fails on production databases with
  # orphan products (products whose owning tenant row was deleted — there is
  # no FK on products.tenantId, so the original Step 1 Uncategorized seed
  # never covered those tenant ids and Step 2's UPDATE silently left them
  # NULL).
  #
  # Steps 1-3 of the original SQL DID succeed (categories seeded for live
  # tenants, non-orphan products backfilled, ProductCategoryGlMapping
  # populated), so the table state is forward-compatible with treating it as
  # applied. The follow-up migration 20260430120000_finish_inventory_category
  # _only_gl_backfill is designed to re-run Steps 1-6 idempotently, this
  # time including orphan tenant ids in the seed. Marking the original
  # --applied unblocks Prisma so the follow-up can run and finish the job.
  # Detection is intentionally narrow — we only auto-recover this specific
  # failure mode (Step 4's NOT NULL on products.productCategoryId). If the
  # original migration failed for a different reason, the operator still
  # owns the recovery, since marking it --applied would let the follow-up
  # drop product_gl_mappings and legacy GL columns without preserving the
  # earlier steps' work. We require:
  #   • a row exists for this migration name,
  #   • finished_at IS NULL (failed, not in-progress is also captured but
  #     concurrent deploys aren't a concern on autoscale single-revision),
  #   • rolled_back_at IS NULL (operator hasn't already intervened),
  #   • logs match the exact NOT NULL signature we're recovering from.
  STUCK_INVENTORY_GL="20260429080000_inventory_category_only_gl"
  INVENTORY_GL_FAILED=$(node -e "
    const { PrismaClient } = require('@prisma/client');
    (async () => {
      const p = new PrismaClient();
      try {
        const rows = await p.\$queryRawUnsafe(
          \`SELECT 1 FROM \"_prisma_migrations\"
            WHERE migration_name = '${STUCK_INVENTORY_GL}'
              AND finished_at IS NULL
              AND rolled_back_at IS NULL
              AND logs IS NOT NULL
              AND logs ILIKE '%productCategoryId%'
              AND logs ILIKE '%null values%'\`
        );
        console.log(rows.length > 0 ? 'yes' : 'no');
      } catch (e) {
        console.log('no');
      } finally {
        await p.\$disconnect();
      }
    })();
  " 2>/dev/null || echo no)

  if [ "$INVENTORY_GL_FAILED" = "yes" ]; then
    echo "[deploy-run] detected failed migration ${STUCK_INVENTORY_GL} (Step 4 NOT NULL on productCategoryId) — marking it --applied so the follow-up backfill migration can run"
    npx prisma migrate resolve --applied "${STUCK_INVENTORY_GL}" || \
      echo "[deploy-run] WARNING: applied resolve returned non-zero — proceeding to migrate deploy anyway"
  fi

  echo "[deploy-run] applying pending migrations"
  npx prisma migrate deploy
fi

# Run the seed and classify the outcome:
#   exit 0                                 → seeded successfully
#   exit !=0 + "Refusing to seed" in log   → expected (non-empty prod), continue silently
#   exit !=0 otherwise                     → real bootstrap defect, log loudly but continue
#                                            so the API still comes up and an operator
#                                            can investigate via the admin console
SEED_LOG="$(mktemp)"
SEED_EXIT=0
NODE_ENV=production npx prisma db seed >"$SEED_LOG" 2>&1 || SEED_EXIT=$?
cat "$SEED_LOG"

if [ "$SEED_EXIT" -ne 0 ]; then
  if grep -q "Refusing to seed" "$SEED_LOG"; then
    echo "[deploy-run] seed skipped (database is non-empty — expected on subsequent boots)"
  else
    echo "[deploy-run] !!! SEED FAILED with exit code ${SEED_EXIT} — see log above. Starting API anyway so the failure is observable."
  fi
fi
rm -f "$SEED_LOG"

# Idempotent post-deploy fixups (admin identity, demo tenant domain, …).
# Reads HELM_PLATFORM_ADMIN_* and HELM_DEMO_TENANT_CUSTOM_DOMAIN. Safe to
# run on every deploy: no-op once the desired values are in place.
echo "[deploy-run] running post-deploy fixups"
NODE_ENV=production npx tsx scripts/post-deploy-fixup.ts || \
  echo "[deploy-run] WARNING: post-deploy fixup returned non-zero — continuing"

cd "$ROOT_DIR"

echo "[deploy-run] starting API on :${API_PORT}"
(cd apps/api && NODE_ENV=production node dist/index.js) &
API_PID=$!

echo "[deploy-run] waiting up to 60s for API health at ${HEALTH_URL}"
for i in $(seq 1 30); do
  if curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then
    echo "[deploy-run] API is ready (after ${i} attempts)"
    break
  fi
  if ! kill -0 "$API_PID" 2>/dev/null; then
    echo "[deploy-run] FATAL: API process died before becoming ready"
    exit 1
  fi
  sleep 2
done

if ! curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then
  echo "[deploy-run] WARNING: API never reported healthy; starting frontend anyway"
fi

echo "[deploy-run] starting frontend-server in foreground"
exec node apps/frontend-server/server.js
