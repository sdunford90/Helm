# Helm Marina Management Platform
A full-stack marina management platform for efficient operations and customer self-service.

Helm is a full-stack marina management platform designed to streamline marina operations for users.

## Run & Operate

To set up and run the application:

1.  `pnpm install`
2.  `pnpm --filter @helm/shared-types build && pnpm --filter @helm/ui-kit build`
3.  `pnpm db:generate`
4.  `pnpm db:migrate:deploy` (use `pnpm db:migrate:dev --name <change>` for new migrations)
5.  Start apps:
    *   Web app (Marina Dashboard): `pnpm --filter @helm/web dev` (port 5000)
    *   API server: `pnpm --filter @helm/api dev` (port 3001)
    *   Admin app: `pnpm --filter @helm/admin dev` (port 3003)

**Required Environment Variables:**
*   `DATABASE_URL` (auto-set by Replit)
*   `CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` (Clerk authentication)
*   `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` (Stripe payments)
*   `ANTHROPIC_API_KEY` (AI features)
*   `R2_*` (Cloudflare R2 storage credentials)
*   `RESEND_API_KEY` (Email)
*   `TWILIO_*` (SMS)
*   `REDIS_URL` (Redis/Upstash for queues)

## Stack

*   **Frontend**: React 18, Vite, React Router, Clerk (auth), lucide-react (icons)
*   **Backend**: Express, Prisma ORM, Clerk Express, Stripe, BullMQ, Redis
*   **Database**: PostgreSQL
*   **Auth**: Clerk
*   **Package Manager**: pnpm (using `workspace:*` protocol)
*   **Build Tool**: Turborepo
*   **ORM**: Prisma (v6.x, uses `$extends`)

## Where things live

*   **Web Dashboard**: `apps/web` (Main marina management dashboard)
*   **API**: `apps/api` (Backend REST API)
*   **Admin Panel**: `apps/admin` (Platform administration panel)
*   **Customer Portal**: `apps/portal` (React, Vite)
*   **Embeddable Widgets**: `apps/widgets` (React, Vite)
*   **Shared Types**: `packages/shared-types` (Source of truth for types)
*   **UI Component Library**: `packages/ui-kit`
*   **Database Schema**: `apps/api/prisma/schema.prisma` (Source of truth for DB schema)
*   **Prisma Migrations**: `apps/api/prisma/migrations/`
*   **Canonical R2 CORS policy**: `apps/api/r2-cors.json`
*   **Platform Documentation**: `docs/`
    *   Accounting Setup SOP: `docs/accounting-setup-sop.md`
    *   QuickBooks Setup: `docs/quickbooks-setup-and-testing.md`
    *   Admin Subdomain Deployment: `docs/admin-subdomain-deployment.md`

## Architecture decisions

*   **Monorepo with Turborepo & pnpm**: Manages multiple intertwined applications and packages efficiently, enabling shared code and streamlined builds.
*   **Clerk for Authentication**: Offloads authentication complexity, supporting multi-tenancy and various user roles (marina staff, customers, platform admins).
*   **Prisma ORM**: Provides type-safe database access and a robust migration system, prioritizing schema evolution over manual SQL.
*   **Host-header based SPA serving**: A single `frontend-server` Express app serves multiple React SPAs based on the request `Host` header, simplifying deployment for `web` and `admin` clients.
*   **Micro-frontend approach for apps**: `apps/web`, `apps/admin`, `apps/portal` are distinct React applications, enabling independent development and deployment.
*   **Tenant-scoped data with Location granularity**: Core data is tenant-scoped, with additional per-location controls for features like accounting, product settings, and user access, enabling flexible marina configurations.
*   **Redis/BullMQ for background jobs**: Handles asynchronous tasks like email sending, reports, and Stripe webhooks, improving API responsiveness.
*   **Tenant-aware middleware**: Centralized logic (`apps/api/src/middleware/tenant.ts`) scopes API requests to the correct marina tenant, excluding platform-wide admin routes.
*   **Lease-based idempotency for scheduled tasks**: Critical for ensuring "at-most-once" execution of jobs like card expiry reminders, even with concurrent workers or restarts.
*   **Per-tenant/per-location email sender**: Customer-facing mail resolves its FROM via `apps/api/src/lib/email-sender.ts` (location override → tenant override → `noreply@gethelm.com`); `sendEmail()` throws `EmailSendError` on failure and records the last failure on `Tenant.lastEmailFailure*`, surfaced in Settings → Email.

## Product

*   **Marina Management Dashboard**: Comprehensive tools for managing slips, contracts, invoices, and customer relations.
*   **Customer Self-Service Portal**: Allows customers to view their boats, invoices, make payments, and submit concierge requests.
*   **Platform Admin Panel**: Centralized control for managing tenants, platform users, system settings, and audit logs.
*   **Integrated Payment Processing**: Utilizes Stripe for secure payment handling, including terminal and card-not-present transactions.
*   **QuickBooks Integration**: Synchronizes financial data including vendors, bills, inventory, and posting accounts for accurate accounting.
*   **Rental System**: Manages rental products, units, time slots, and reservations with dynamic pricing.
*   **Dock Walk Inspections**: Mobile-first tool for slip-by-slip inspections with photo capture and issue flagging.
*   **Automated Communication**: Features like card expiry reminders and scheduled reports keep users informed via Email & SMS.
*   **Configurable Pricing & Catalog**: Define dockage rates, service fees, and products per location.
*   **Reporting & Analytics**: Generate various reports including occupancy, revenue, and POS card rail mix.
*   **User & Location Permissions**: Granular control over user access to specific locations and platform features.
*   **Audit Logging**: Comprehensive logging of administrator actions for governance and compliance.

## User preferences

_Populate as you build_

## Gotchas

*   **pnpm required**: Must use `pnpm` for package management due to `workspace:*` protocol; npm will not work.
*   **Prisma Migrations**: Always use `pnpm db:migrate:dev` for schema changes; avoid `prisma db push` on shared databases.
*   **Stripe Integration**: `stripe` object in `apps/api/src/lib/stripe.ts` can be `null` if `STRIPE_SECRET_KEY` is not set; always use `requireStripe()` helper.
*   **Redis/BullMQ**: Optional; API starts without `REDIS_URL` but queue-based features will be disabled.
*   **CORS for R2**: Ensure R2 bucket CORS policy (`apps/api/r2-cors.json`) is correctly applied for file uploads to work. Bucket-admin permissions are required for configuration.
*   **Platform Admin bypass**: `requirePlatformAdmin()` middleware skips Clerk auth in non-production environments for development bypass.
*   **QBO Integration**: QBO-connected locations require specific GL account mappings; legacy fallbacks are suppressed.
*   **Production Seeding**: When `NODE_ENV=production`, `pnpm db:seed:prod` requires `HELM_PROD_SEED_CONFIRM=yes` for non-empty databases.
*   **Helmet CSP allow-list**: `apps/api/src/index.ts` configures helmet with an explicit CSP that whitelists Clerk (`*.clerk.accounts.dev`, `*.clerk.com`), Stripe (`js.stripe.com`, `*.stripe.com`), Cloudflare Turnstile, and Google Fonts. Default helmet CSP is too strict and blocks Clerk script load → blank SPA in prod.

## Pointers

*   **Turborepo Docs**: [https://turbo.build/repo/docs](https://turbo.build/repo/docs)
*   **Prisma Docs**: [https://www.prisma.io/docs/](https://www.prisma.io/docs/)
*   **Clerk Docs**: [https://clerk.com/docs](https://clerk.com/docs)
*   **Stripe Docs**: [https://stripe.com/docs](https://stripe.com/docs)
*   **BullMQ Docs**: [https://docs.bullmq.io/](https://docs.bullmq.io/)
*   **Cloudflare R2 Docs**: [https://developers.cloudflare.com/r2/](https://developers.cloudflare.com/r2/)
*   **React Docs**: [https://react.dev/](https://react.dev/)
*   **Express Docs**: [https://expressjs.com/](https://expressjs.com/)
*   **PostgreSQL Docs**: [https://www.postgresql.org/docs/](https://www.postgresql.org/docs/)

