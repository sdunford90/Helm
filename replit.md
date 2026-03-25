# Helm Marina Management Platform

## Overview
Helm is a full-stack marina management platform built as a TypeScript monorepo using Turborepo and pnpm workspaces.

## Architecture

### Monorepo Structure
- **apps/web** — Main marina management dashboard (React + Vite, port 5000)
- **apps/api** — Backend REST API (Express + Prisma + TypeScript, port 3001)
- **apps/admin** — Platform admin panel for tenant/location management (React + Vite, port 3002)
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
- **API Server**: `pnpm --filter @helm/api dev` → port 3001 (Express/Prisma backend)
- **Admin App**: `pnpm --filter @helm/admin dev` → port 3002 (platform admin panel)

## Key Implementation Notes
- `requirePlatformAdmin()` middleware bypasses Clerk auth in development (NODE_ENV !== "production") — production requires a real `platform_admin` role user
- Tenant dev bypass in `apps/api/src/middleware/tenant.ts` uses `findFirst({ orderBy: { createdAt: 'asc' } })` for localhost
- Redis/BullMQ conditional on `REDIS_URL` being set; Stripe conditional on `STRIPE_SECRET_KEY`
- `localStorage` key `helm_payment_types` shared between Settings.tsx and POS.tsx for payment method sync
- Default seeded tenant: "Helm Marina" (ID: 77acef35-1a12-414b-a726-feea7a6193d9)

## Database Models (key)
- `Tenant` → has many `Location`, `User`
- `Location` → id, tenantId, name, address, city, state, zip, phone, timezone, active
- `SaasTier` → pricing tiers (monthlyFeeCents, perLocationFeeCents, achFeeRate, cardFeeRate)

## Notes
- The `workspace:*` protocol requires pnpm (not npm)
- `packages/ui-kit/tsconfig.json` has been configured with `lib: ["ES2022", "DOM", "DOM.Iterable"]`
- The `Concierge` icon from lucide-react was replaced with `Bell` in `AppLayout.tsx`
- Prisma schema lives in `apps/api/prisma/schema.prisma`
- The app shows a Clerk auth error when `VITE_CLERK_PUBLISHABLE_KEY` is not set
