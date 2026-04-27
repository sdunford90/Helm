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
3. Generate Prisma client: `pnpm db:generate`
4. Apply migrations: `pnpm db:migrate:deploy`  (or `pnpm db:migrate:dev` to create a new one after editing schema.prisma)
5. Start web app: `pnpm --filter @helm/web dev` (port 5000)
6. Start API: `pnpm --filter @helm/api dev` (port 3001)

## Schema changes
Versioned migrations live in `apps/api/prisma/migrations/`. Workflow:
  - Edit `apps/api/prisma/schema.prisma`.
  - Run `pnpm db:migrate:dev --name <change>` locally. Prisma generates a new
    timestamped migration folder, applies it to your dev DB, and regenerates
    the client.
  - Commit both the schema edit and the new migration folder.
  - CI and prod apply migrations via `prisma migrate deploy` (see
    `Dockerfile.api` — runs before the server starts).
  - Do NOT use `prisma db push` except on an isolated dev DB for quick
    iteration; it doesn't record history and can't be rolled back.

## Workflows
- **Start application**: `pnpm --filter @helm/web dev` → port 5000 (marina dashboard)
- **API Server**: `pnpm --filter @helm/api dev` → port 3001 (REST API)
- **Admin App**: `pnpm --filter @helm/admin dev` → port 3003 (platform admin)

## Notes
- The `workspace:*` protocol requires pnpm (not npm)
- Prisma is at v6.x — uses `$extends` query extensions (NOT deprecated `$use` middleware)
- Prisma schema lives in `apps/api/prisma/schema.prisma`; schema changes go through versioned migrations (see "Schema changes" above)
- `apps/api/src/lib/stripe.ts` exports `stripe` as `Stripe | null` — guard with `requireStripe()` helper
- Redis/BullMQ is optional — null when `REDIS_URL` is not set; API starts fine without it
- `requirePlatformAdmin()` middleware skips Clerk auth in `NODE_ENV !== "production"` (dev bypass)
- Default dev tenant: ID `77acef35-1a12-414b-a726-feea7a6193d9` ("Helm Marina")
- `apps/admin/vite.config.ts` sets `host: '0.0.0.0'`, `strictPort: true`, `port: 3003`
- `apps/admin/tsconfig.json` references `tsconfig.node.json` (both files present)
- The app shows a Clerk auth error when `VITE_CLERK_PUBLISHABLE_KEY` is not set

## Recently completed features (Apr 2026)
- **Email Automation** — `EmailTemplate` + `AutomationRule` Prisma models added and pushed to DB. Route registered at `/api/email-automation/*`. Frontend (`EmailAutomation.tsx`) now fetches real rules/templates/logs from API; falls back to defaults when DB is empty. Toggle persists to DB for UUID-based rules.
- **Reports generate endpoint** — `POST /api/reports/generate` added to `reports.ts`. Maps `reportId` to the correct sub-endpoint and returns a success envelope so the UI toast works.
- **Portal — Announcements** — `GET /api/portal/announcements` added to `portal.ts`. `Announcements.tsx` now fetches from API with loading/empty states.
- **Portal — My Boats** — `MyBoats.tsx` wired to existing `GET /api/portal/boats`. Shows real vessel data with live registration expiry checks.
- **Portal — Concierge Requests** — `GET|POST /api/portal/concierge` added to `portal.ts`. `ConciergeRequests.tsx` loads and submits real requests with loading/empty states.
- **Portal — Waitlist Status** — `GET /api/portal/waitlist` added to `portal.ts`. `WaitlistStatus.tsx` shows real waitlist entries; shows "Not on waitlist" empty state when none exist.
- **Catalog — Dockage Rates & Service Fees** — Migrated from JSON blob on `Tenant.invoiceTemplateJson` to proper `DockageRate` and `ServiceFee` Prisma models (with `locationId` FK → `Location`, `effectiveFrom/To` for time-based rates, `FeeType` enum for flat/percent). Full CRUD via `GET|POST|PUT|DELETE /api/settings/catalog/dockage-rates[/:id]` and `/service-fees[/:id]`, all location-scoped. `GET /api/settings/locations` added for the catalog location picker. Settings.tsx catalog tab wired to individual per-row API calls instead of bulk JSON array saves.
- **Location-scoped settings** — `Location` model extended with: `qboRealmId/AccessToken/RefreshToken/TokenExpiresAt/ConnectedAt` (each property has its own QBO company), `autoExecuteRenewals` (renewal behavior per dock), `logoUrl` + `brandingJson` (per-location branding). QBO API routes now accept `locationId` param — `GET /api/settings/qbo?locationId=`, `POST /api/settings/qbo/connect|disconnect|sync` accept `{ locationId }` body. `GET|PUT /api/settings/locations/:id` added for full per-location settings CRUD. Settings UI has new **Locations** tab with sidebar property list, editable location form (name, address, timezone, logo, renewal toggle, feature flags), and per-location QuickBooks connect/disconnect/sync card.
