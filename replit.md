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
- Active dev tenant: ID `c4c0cfe7-5d62-4348-a6e4-753ffa93c1c6` ("Bayshore Marina") — has 20 slips, 45 customers, 42 contracts, 126 invoices, 3 locations
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
- **Locations seeded** — 3 locations added to live DB (Main Marina, North Dock, South Cove), all 20 Bayshore Marina slips distributed across them by dockId. `apps/api/prisma/seed/locations.ts` idempotent module added; imported in `seed.ts`.
- **Invoice send email fixed** — `POST /api/invoices/:id/send` previously queued a job with flat fields the email worker couldn't interpret. Now queues `{ type: "invoice", to, data: { customerName, invoiceNumber, amount, dueDate, portalUrl } }` matching the worker's expected schema.
- **InvoiceDetail.tsx fully wired** — Complete rewrite: API response fields mapped to display types (`invoiceNumber→number`, `issuedDate→issued`, `lineItems→lines` with cents, `DRAFT→Draft` status, etc.). Finalize/Send/Void/Download PDF buttons all have `onClick` handlers with loading states, disabled states, and toast notifications. `onPaid` callback triggers invoice refetch. GL Entries section hidden when empty.
- **Contract e-sign emails** — `POST /api/contracts/:id/send-for-signature` and `POST /api/contracts/bulk-send-for-signature` now call `sendEmail()` after updating DB, sending the signer a branded HTML email with a "Review & Sign" link. Errors are caught and logged without blocking the API response.
- **Rental System Expansion (May 2026)** — Added `RentalUnit` and `RentalTimeSlot` Prisma models (pushed via `prisma db push`). `Reservation` expanded with `unitId`, `timeSlotId`, `damageWaiverCents`, `notes` fields. New API routes: `GET|POST|PATCH|DELETE /api/rentals/products/:id/units` (unit CRUD), `GET|POST|PATCH|DELETE /api/rentals/time-slots` (time slot CRUD). `calculateDynamicPrice` now returns `baseRentalCents`, `damageWaiverCents`, and grand total. Reservation creation stores unit and time-slot references and applies slot times. Frontend: Settings tab now has **Time Slots** and **Units** management sub-tabs. New Reservation wizard Step 2 shows operator-defined time slot chips (falls back to raw time inputs if none configured). Step 3 shows DB units as selectable cards (mandatory if units configured). Price breakdown panel shows damage waiver line. Fixed `TENANT_SCOPED_MODELS` in `prisma.ts` to remove models without `tenantId` columns (`PricingRule`, `PricingCalendarOverride`, `DemandSurgeTier`, `AlgorithmicSuggestion`, `CancellationRule`) and add `RentalTimeSlot`.
- **Per-user Location restrictions** — `UserLocation` join table added (with backfill mapping every existing user to all of their tenant's locations). `clerkAuth` and `requirePlatformAdmin` middleware now populate `req.allowedLocationIds` (`null` for bypass roles `PLATFORM_ADMIN` / `TENANT_ADMIN` / `MARINA_OWNER`, otherwise the array of allowed location ids). New helpers `filterByAllowedLocations(req, where, opts?)` and `requireLocationAccess(req, locationId)` in `auth.ts`. Guards applied to: `/api/locations` list + features, `/api/settings/locations` GET/PUT + qbo/stripe connect/disconnect/sync, `/api/pos/shifts` (list + open) and all payment / reader / payment-intent endpoints, `/api/slips` (list, dock-map, get, create, update, delete — `locationId` added to slip create/update schemas), `/api/rentals/time-slots` and `/api/reservations` via the time slot's location, and `/api/reports` (occupancy, revenue, pos-sales, shift-reconciliation) via a `locationFilter()` helper that intersects `?locationId=` with the allowed list. Settings team API: `GET /api/settings/team` returns `locationIds`; `POST /api/settings/team/invite` accepts and persists `locationIds` and writes an `INVITE` audit log; new `PUT /api/settings/team/:userId` accepts `role` + `locationIds`, replaces `UserLocation` rows in a `$transaction`, and writes an `UPDATE` audit log. Settings.tsx invite + edit modals now use location IDs (not names), the team table renders chips from `locationIds` (with "All locations" badge for bypass roles and "No locations" warning when restricted users have none), and `ModulesContext`'s `/api/locations` fetch is automatically filtered server-side so the location switcher only shows allowed properties. Tests: `apps/api/tests/routes/user-locations.test.ts` covers team list, invite (success / invalid location / duplicate), and update (success / invalid location / self-role-change / not-found).
- **Reports Scheduler** — `ScheduledReport` Prisma model added (id, tenantId, reportId, reportName, frequency, format, recipients, status, nextRun, lastRun). `GET|POST|PUT|DELETE /api/reports/schedules[/:id]` added. BullMQ `report-scheduler` queue + worker added to `workers/index.ts`; when a schedule fires it sends a branded HTML email to all recipients and re-enqueues itself for the next interval. Reports.tsx Scheduled Reports tab now loads from API, shows Format column, toggles Active/Paused via API, and has a functional "Add Schedule" modal (report picker, frequency selector, format selector, recipients textarea).
- **QBO Inventory Sync (Apr 2026)** — One-way sync from app → QuickBooks for inventory items, receiving bills, COGS, and adjustments. New Prisma additions: `Vendor` model (per-tenant, with `qboVendorId`), `QboInventorySyncRef` table (keyed by `tenantId+sourceType+sourceId`) for in-memory inventory state that doesn't have a Prisma row, plus QBO sync metadata + `cogsGlAccountId`/`inventoryAssetGlAccountId`/`locationId` columns on `Product` and `qboBillId`/`vendorId`/`locationId`/`poNumber` on `PurchaseOrder` (migration `20260428000000_qbo_inventory_sync`). Tenant-scoped models list updated to include `Vendor` and `QboInventorySyncRef`. New service functions in `qbo-sync.ts`: `syncInventoryItem`, `syncVendor`, `syncReceivingBill`, `postInventoryAdjustmentJournal` (skips `received`/`sold`; debits COGS or Inventory Asset based on direction), `voidQboInvoice`, `voidQboPayment`, `getInventorySyncStatus`, `getProductSyncStatus`. Inventory routes (`POST /products`, `PUT /products/:id`, `POST /products/:id/qbo-sync`, `POST /adjustments`, `PUT /counts/:id/complete`, `PUT /purchase-orders/:id/receive`) trigger best-effort QBO pushes; failures captured into per-record sync error fields without blocking local mutations. New `/api/inventory/vendors` CRUD (DB-backed). New `GET /api/settings/qbo/inventory-status` summary endpoint. Settings.tsx shows an "Inventory Sync to QuickBooks" card (counts of synced items/bills/adjustments + recent errors). Inventory.tsx shows per-product QBO sync status (Synced/Pending/Error badge) and a "Sync now" cloud button. Invoice void (`POST /invoices/:id/void`) and full payment refund (`POST /payments/:id/refund`) propagate to QBO via `voidQboInvoice`/`voidQboPayment` so auto-posted COGS reverses there too. 11 new vitest cases in `tests/services/qbo-sync.test.ts` cover GL-account validation, adjustment short-circuits, idempotency, void no-ops, and status aggregation.
- **QBO Pull-Back of Vendors & Bills (Apr 2026)** — Two-way sync: changes made directly in QuickBooks (Vendor / Bill) flow back into Helm. Migration `20260428100000_qbo_pull_tracking` adds `qboLastVendorPullAt` / `qboLastBillPullAt` watermark columns to both `Tenant` and `Location`. New service functions in `qbo-sync.ts`: `applyQboVendor` and `applyQboBill` (idempotent upsert by `qboVendorId` / `qboBillId`, write `QBO_VENDOR_PULLED` / `QBO_BILL_PULLED` audit log entries with the changed-field diff, and create a stub Vendor when a Bill references an unknown vendor — audited as `QBO_VENDOR_STUB_CREATED`); `pullVendorsFromQbo` / `pullBillsFromQbo` (paged QBO query API using `Metadata.LastUpdatedTime > <watermark>`, max 50 pages × 100 rows); `pullVendorsAndBillsForTenant` (iterates tenant-level + per-location QBO connections). `handleQboWebhook` was rewritten to resolve realmId via Location first then Tenant and now dispatches Vendor/Bill events in addition to Customer/Invoice/Payment. New `POST /api/qbo/pull` endpoint triggers a manual pull. 8 new vitest cases cover create/update by external id, stub-vendor creation, no-op skip, empty-endpoint short-circuit, and route-level summary response.
