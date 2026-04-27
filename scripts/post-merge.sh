#!/bin/bash
set -e

pnpm install --frozen-lockfile

pnpm --filter @helm/api exec prisma migrate deploy
