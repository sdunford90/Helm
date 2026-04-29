#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT_DIR="$(pwd)"

echo "[deploy-run] starting in $ROOT_DIR"

cd apps/api

if [ "${HELM_PROD_FORCE_RESET:-}" = "yes" ]; then
  echo "[deploy-run] HELM_PROD_FORCE_RESET=yes — resetting prod schema (DESTRUCTIVE)"
  npx prisma migrate reset --force --skip-seed
else
  echo "[deploy-run] applying pending migrations"
  npx prisma migrate deploy
fi

echo "[deploy-run] running seed (best-effort; skipped on non-empty prod DB)"
NODE_ENV=production npx prisma db seed || echo "[deploy-run] seed skipped (non-empty DB or seed error)"

cd "$ROOT_DIR"

echo "[deploy-run] starting API on :3001"
(cd apps/api && NODE_ENV=production node dist/index.js) &
API_PID=$!

echo "[deploy-run] waiting up to 60s for API health"
for i in $(seq 1 30); do
  if curl -fsS http://localhost:3001/api/health >/dev/null 2>&1; then
    echo "[deploy-run] API is ready (after ${i} attempts)"
    break
  fi
  if ! kill -0 "$API_PID" 2>/dev/null; then
    echo "[deploy-run] FATAL: API process died before becoming ready"
    exit 1
  fi
  sleep 2
done

if ! curl -fsS http://localhost:3001/api/health >/dev/null 2>&1; then
  echo "[deploy-run] WARNING: API never reported healthy; starting frontend anyway"
fi

echo "[deploy-run] starting frontend-server in foreground"
exec node apps/frontend-server/server.js
