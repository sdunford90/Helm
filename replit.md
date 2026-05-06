# Helm Marina Management Platform

Helm is a full-stack marina management platform designed to streamline marina operations for users.

## Run & Operate

To set up and run the application:

1.  `pnpm install`
2.  `pnpm --filter @helm/shared-types build && pnpm --filter @helm/ui-kit build`
3.  `pnpm db:generate`
4.  `pnpm db:migrate:deploy` (or `pnpm db:migrate:dev` for new migrations)
5.  Start apps:
    *   Web app: `pnpm --filter @helm/web dev` (port 5000)
    *   API server: `pnpm --filter @helm/api dev` (port 3001)
    *   Admin app: `pnpm --filter @helm/admin dev` (port 3003)

**Required Environment Variables:**
*   `DATABASE_URL` (auto-set by Replit)
*   `CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`
*   `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
*   `ANTHROPIC_API_KEY`
*   `R2_*` (Cloudflare R2 credentials)
*   `RESEND_API_KEY`
*   `TWILIO_*`
*   `REDIS_URL`

## Stack

*   **Frontend**: React 18, Vite, React Router, Clerk (auth), lucide-react (icons)
*   **Backend**: Express, Prisma ORM, Clerk Express, Stripe, BullMQ, Redis
*   **Database**: PostgreSQL
*   **Auth**: Clerk
*   **Package Manager**: pnpm (using `workspace:*` protocol)
*   **Build Tool**: Turborepo

## Where things live

*   **Web Dashboard**: `apps/web` (React, Vite)
*   **API**: `apps/api` (Express, Prisma)
*   **Admin Panel**: `apps/admin` (React, Vite)
*   **Customer Portal**: `apps/portal` (React, Vite)
*   **Embeddable Widgets**: `apps/widgets` (React, Vite)
*   **Shared Types**: `packages/shared-types`
*   **UI Component Library**: `packages/ui-kit`
*   **Database Schema**: `apps/api/prisma/schema.prisma`
*   **Prisma Migrations**: `apps/api/prisma/migrations/`
*   **Platform Documentation**: `docs/` (e.g., `docs/accounting-setup-sop.md`)

## Architecture decisions

*   **Monorepo with Turborepo**: Manages multiple intertwined applications and packages efficiently, enabling shared code and streamlined builds.
*   **Clerk for Authentication**: Offloads authentication complexity, supporting multi-tenancy and various user roles (marina staff, customers, platform admins).
*   **Prisma ORM**: Provides type-safe database access and a robust migration system, prioritizing schema evolution over manual SQL.
*   **Host-header based SPA serving**: A single `frontend-server` Express app serves multiple React SPAs based on the request `Host` header, simplifying deployment for `web` and `admin` clients.
*   **Tenant-scoped data with Location granularity**: Core data is tenant-scoped, with additional per-location controls for features like accounting, product settings, and user access, enabling flexible marina configurations.

## Product

*   **Marina Management Dashboard**: Comprehensive tools for managing slips, contracts, invoices, and customer relations.
*   **Customer Self-Service Portal**: Allows customers to view their boats, invoices, make payments, and submit concierge requests.
*   **Platform Admin Panel**: Centralized control for managing tenants, platform users, system settings, and audit logs.
*   **Integrated Payment Processing**: Utilizes Stripe for secure payment handling, including terminal and card-not-present transactions.
*   **QuickBooks Integration**: Synchronizes financial data including vendors, bills, inventory, and posting accounts for accurate accounting.
*   **Rental System**: Manages rental products, units, time slots, and reservations with dynamic pricing.
*   **Dock Walk Inspections**: Mobile-first tool for slip-by-slip inspections with photo capture and issue flagging.
*   **Automated Communication**: Features like card expiry reminders and scheduled reports keep users informed.

## User preferences

_Populate as you build_

## Gotchas

*   **pnpm required**: Must use `pnpm` for package management due to `workspace:*` protocol.
*   **Prisma Migrations**: Always use `pnpm db:migrate:dev` for schema changes; avoid `prisma db push` on shared databases.
*   **Stripe Integration**: `stripe` object can be `null` if `STRIPE_SECRET_KEY` is not set; use `requireStripe()` helper.
*   **Redis/BullMQ**: Optional; API starts without `REDIS_URL` but queue-based features will be disabled.
*   **CORS for R2**: Ensure R2 bucket CORS policy (`apps/api/r2-cors.json`) is correctly applied for file uploads to work.
*   **Platform Admin bypass**: `requirePlatformAdmin()` middleware skips Clerk auth in non-production environments.
*   **QBO Integration**: QBO-connected locations require specific GL account mappings; legacy fallbacks are suppressed.

## Pointers

*   **Turborepo Docs**: [https://turbo.build/repo/docs](https://turbo.build/repo/docs)
*   **Prisma Docs**: [https://www.prisma.io/docs/](https://www.prisma.io/docs/)
*   **Clerk Docs**: [https://clerk.com/docs](https://clerk.com/docs)
*   **Stripe Docs**: [https://stripe.com/docs](https://stripe.com/docs)
*   **BullMQ Docs**: [https://docs.bullmq.io/](https://docs.bullmq.io/)
*   **Cloudflare R2 Docs**: [https://developers.cloudflare.com/r2/](https://developers.cloudflare.com/r2/)
*   **React Docs**: [https://react.dev/](https://react.dev/)