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
