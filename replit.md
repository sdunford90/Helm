# Helm Marina Management Platform

## Overview
Helm is a full-stack marina management platform built as a TypeScript monorepo using Turborepo and pnpm workspaces.

## Architecture

### Monorepo Structure
- **apps/web** — Main marina management dashboard (React + Vite, port 5000)
- **apps/api** — Backend REST API (Express + Prisma + TypeScript, port 3001)
- **apps/admin** — Platform admin panel (React + Vite, port 3003)
- **apps/portal** — Customer self-service portal (React + Vite)
- **apps/widgets** — Embeddable widgets (React + Vite)
- **packages/shared-types** — Shared TypeScript types across apps
- **packages/ui-kit** — Shared React UI component library
- **packages/database** — Prisma schema and database utilities
- **tools** — Turborepo utilities including multi-DB migration tooling

### Tech Stack
- **Frontend**: React 18, Vite, React Router, Clerk (auth), lucide-react icons
- **Backend**: Express, Prisma ORM, Clerk Express, Stripe, BullMQ, Redis
- **Database**: PostgreSQL (Replit managed)
- **Auth**: Clerk (requires CLERK_PUBLISHABLE_KEY and CLERK_SECRET_KEY)
- **Package Manager**: pnpm (workspace:* protocol)
- **Build System**: Turborepo

## Environment Variables Required
See `.env.example` for the full list. Key variables:
- `DATABASE_URL` — PostgreSQL connection (auto-set by Replit)
- `CLERK_PUBLISHABLE_KEY` / `CLERK_SECRET_KEY` — Clerk auth
- `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` — Payments
- `ANTHROPIC_API_KEY` — AI features (insurance)
- `R2_*` — Cloudflare R2 storage
- `RESEND_API_KEY` — Email
- `TWILIO_*` — SMS
- `REDIS_URL` — Redis/Upstash for queues

## Development Setup
1. Install dependencies: `pnpm install`
2. Build shared packages: `pnpm --filter @helm/shared-types build && pnpm --filter @helm/ui-kit build`
3. Generate Prisma client: `cd apps/api && npx prisma generate`
4. Push DB schema: `cd apps/api && npx prisma db push`
5. Start web app: `pnpm --filter @helm/web dev` (port 5000)
6. Start API: `pnpm --filter @helm/api dev` (port 3001)

## Workflows
- **Start application**: `pnpm --filter @helm/web dev` → port 5000 (marina dashboard)
- **API Server**: `pnpm --filter @helm/api dev` → port 3001 (REST API)
- **Admin App**: `pnpm --filter @helm/admin dev` → port 3003 (platform admin)

## Notes
- The `workspace:*` protocol requires pnpm (not npm)
- Prisma is at v6.x — uses `$extends` query extensions (NOT deprecated `$use` middleware)
- Prisma schema lives in `apps/api/prisma/schema.prisma`; use `npx prisma db push` (not migrations)
- `apps/api/src/lib/stripe.ts` exports `stripe` as `Stripe | null` — guard with `requireStripe()` helper
- Redis/BullMQ is optional — null when `REDIS_URL` is not set; API starts fine without it
- `requirePlatformAdmin()` middleware skips Clerk auth in `NODE_ENV !== "production"` (dev bypass)
- Default dev tenant: ID `77acef35-1a12-414b-a726-feea7a6193d9` ("Helm Marina")
- `apps/admin/vite.config.ts` sets `host: '0.0.0.0'`, `strictPort: true`, `port: 3003`
- `apps/admin/tsconfig.json` references `tsconfig.node.json` (both files present)
- The app shows a Clerk auth error when `VITE_CLERK_PUBLISHABLE_KEY` is not set
