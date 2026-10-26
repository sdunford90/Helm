# 11 — Authorization (RBAC/ABAC) & Enterprise Security Program

**Scope:** (1) how authorization works today, endpoint by endpoint; (2) the granular permission system Helm should have; (3) a phased enterprise security roadmap.
**Not in scope (see `07-platform-security-infra.md`):** CORS/helmet/headers, the vulnerability inventory outside authorization, infrastructure hardening, dependency CVEs, logging plumbing. Where a finding here overlaps an infra finding, this doc covers only the **authorization** side.
**Method:** I read `apps/api/src/middleware/*`, `lib/prisma.ts`, `prisma/schema.prisma`, every file in `apps/api/src/routes/`, the staff UI shell (`AppLayout.tsx`, `ModulesContext.tsx`, `App.tsx`, `Settings.tsx`), the portal, admin and widgets apps, `public/sw.js`, the Dockerfile and compose file. No source files were changed.

---

## 0. Executive summary

Helm has **authentication** (Clerk) but almost no **authorization**. The one rule that holds in production is "a Clerk user who has a `User` row in this tenant can call nearly every staff endpoint." The shipped container doesn't set `NODE_ENV=production`, so production runs without even that rule.

| # | Headline | Sev |
|---|---|---|
| 1 | `Dockerfile.api` / `docker-compose.yml` never set `NODE_ENV=production`. Without it, `clerkAuth()` skips Clerk, so every request runs as the tenant's oldest user, and unknown hosts fall back to the first tenant. | **P0** |
| 2 | **~303 mounted endpoints; only 19 role checks work** (all in `settings.ts`). 12 `requireRole()` calls use lowercase roles and reject everyone. One router (`email-automation`) isn't mounted. Refunds, voids, GL, pricing, customer PII, deletes and exports get no role check at all. | **P0** |
| 3 | Unauthenticated `/api/onboarding/:tenantId/*` lets anyone point **any tenant's Stripe Connect account** at their own Stripe account (`stripe/callback`), overwrite branding, and seed the GL. | **P0** |
| 4 | BI API keys work across tenants. `bi-api.ts` sets `req.tenantId` from the key, but the Prisma extension rewrites `where.tenantId` to the **hostname's** tenant. A key from tenant A sent to `B.gethelm.com/api/bi/customers` returns B's customers, including driver's-licence numbers and dates of birth. | **P0** |
| 5 | `PORTAL_USER` (boaters) live in the same `User` table and pass the same `clerkAuth()`. A boater with a login gets the whole staff API, refunds included. | **P0** (design) |
| 6 | Payment refunds have no role check, no limit and no cumulative tracking. A `PARTIALLY_REFUNDED` payment can be refunded again and again. POS takes client-supplied `unitPriceCents` and unlimited `discountCents`. | **P0** |
| 7 | Deactivated users keep access: `clerkAuth()` never checks `user.active`. | **P1** |
| 8 | Managers can invite new users as `MARINA_OWNER`, so they can promote themselves. Role changes, settings changes and admin actions write no audit log. | **P1** |
| 9 | Impersonation signs tokens with a hard-coded fallback secret. It records no reason, gets no consent and writes no audit trail, and nothing validates the token. `requirePlatformAdmin` queries a field that doesn't exist (500 on every admin call). The admin SPA has no auth at all. | **P1** |
| 10 | No location dimension anywhere. `User`, `Slip`, `Invoice` and `Payment` have no `locationId`, so multi-marina portfolios can't restrict staff to a site. | **P1** (feature gap) |
| 11 | The UI does no role-based gating. The only toggle (`rentals`) lives in `localStorage`. `/api/auth/me` returns a permission list nothing uses. The help centre says 2FA is enforced for Admin/Accounting, which is false. | **P1** |
| 12 | The service worker caches **every** `GET /api/*` response in Cache Storage. The cache isn't keyed by user and isn't cleared on logout, which is a real risk on shared dock tablets and POS devices. | **P1** |

**Recommendation:** fix the P0s first (≈2 engineer-weeks; they block any paying customer). Then replace `requireRole(enum)` with a **permission-key** system (`requirePermission('payments.refund', …)`). It should have tenant-customizable roles, location-scoped assignments, policy limits (refund caps, discount %), approval workflows, and server-delivered effective permissions for the UI. Enforcement lives in a transport-agnostic command layer, so the planned AI assistant, the MCP server and the public API apply exactly the same rules as the UI. The AI acts *as the user*, within the intersection of the user's permissions and the tenant AI policy. Postgres RLS sits underneath as a tenant-isolation backstop. Sections 3–5 give the design.

---

## 1. Current authorization model

### 1.1 Request pipeline (as built)

```
app.use(cors())                      index.ts:53   (wide open, see doc 07)
app.use(helmet()); express.json()
app.use(tenantMiddleware)            tenant.ts:198  Host → Tenant, tenantStore.run({tenantId})
  bypass: /api/health /api/admin /api/onboarding /api/auth/webhook   tenant.ts:184
  if no match && NODE_ENV!=='production' → FIRST tenant              tenant.ts:223-225
router-level / route-level:
  clerkAuth()                        auth.ts:32
    NODE_ENV!=='production' → no Clerk; user = oldest User of tenant; role ?? "admin"   auth.ts:34-53
    prod → requireAuth(); User.findFirst({clerkUserId, tenantId})   auth.ts:71-76   (no `active` check)
  requireRole(...strings)            auth.ts:104   exact string match against enum value
  requirePlatformAdmin()             auth.ts:121   where {clerk_id, role:"platform_admin"} → Prisma validation error
Prisma $extends                      prisma.ts:69   injects tenantId for models in TENANT_SCOPED_MODELS
```

**Identity model.** `User` (schema.prisma:308) is **per-tenant**: `{tenantId, email, role: UserRole, clerkUserId?, active}`. It has no unique constraint on `(tenantId, clerkUserId)` or `(tenantId, email)`, no `locationId`, no MFA flag and no last-login. Platform admins are `User` rows with a `tenantId`. Portal users (boaters) are `User` rows with `PORTAL_USER`, and nothing links them to a `Customer`.

**Roles.** `UserRole` = `PLATFORM_ADMIN, MARINA_OWNER, MARINA_MANAGER, DOCK_STAFF, POS_CASHIER, ACCOUNTING, PORTAL_USER` (schema.prisma:18). The enum is fixed: tenants can't customize it, and each user has exactly one role.

**Tenant isolation.** This is the only real authorization boundary, and it has holes:
- **Not auto-scoped (20 tenant-bearing models):** `AchReturn, ApiKey, Chargeback, CollectionsAccount, CommunicationPreference, ConciergeVendor, DeferredSchedule, GlAccount, GlEntry, InsuranceRecord, Location, MeterReading, NpsSurvey, ProcessedWebhook, PromoCode, ReferralPartner, RenewalBatch, RentalAutomationEvent, SecurityDeposit, SlipContract`. These depend on handlers adding `tenantId` by hand, and several don't (e.g. `contracts.ts:950` `slipContract.findFirst({ where: { id: contractId } })`).
- **Listed as scoped but have no `tenantId` column (7):** `PosLineItem, DockWalkItem, PricingRule, PricingCalendarOverride, DemandSurgeTier, AlgorithmicSuggestion, AnnouncementDelivery`. Any *top-level* query on these throws `Unknown argument tenantId` at runtime. Nested includes/writes don't go through the extension and still work. Phantom names: `POSTransaction, FuelDispense, Rental, Contract, CancellationRule`.
- **The extension overwrites** `where.tenantId` with the context tenant (`prisma.ts:104`, spread order). That is why the BI API key leaks across tenants (finding R-04).
- With no tenant context (workers, jobs, `/api/admin`, `/api/onboarding`) everything is unscoped. That's acceptable for system jobs, but there's no "system actor" principal or audit trail for them.

**Location.** `Location` exists (schema.prisma:274) and only the admin API manages it. Only 8 models have an optional `locationId` (`LeadForm, Lead, WaitlistEntry, CancellationPolicy, RentalProduct, RampTicket, Shift, Inventory`), and it's taken straight from the request body. Nothing filters by location. `Slip`, `Invoice`, `Payment`, `SlipContract`, `PosTransaction` and `Customer` have no location at all.

**Frontend.** `apps/web` has no route guards and no role checks. `AppLayout.tsx:253-254` hides only `/rentals`, and only when the `localStorage` module flag is off (`ModulesContext.tsx:3-23`). `/api/auth/me` returns a static role→permission list (`routes/auth.ts:290, 400`) that no app calls. The Team settings page (`Settings.tsx:88-93, 161-168`) shows **mock** users with per-location assignments and a role/permission matrix that the backend doesn't implement. The help centre (`data/help-articles.ts:103`) says "Admin and Accounting roles require two-factor authentication (TOTP)". Nothing enforces that.

**Portal (`apps/portal`).** It's a Clerk-wrapped mock with no API calls. The API has no portal endpoints and no `Customer↔identity` link, so "own records only" isn't modeled anywhere.

**Admin (`apps/admin`).** No Clerk provider. `fetch('/api/admin/...')` sends no bearer token (`TenantDetail.tsx:6-13`). Its only protection is the server-side `requirePlatformAdmin`, which is broken.

**Widgets (`apps/widgets`).** These are public embeds, but they POST to **staff** endpoints: `/api/rentals/reservations` (`RentalBookingWidget.tsx:231`), `/api/transient` (`TransientBookingWidget.tsx:244`) and `/api/lead-forms/:formId/submit` (`LeadFormWidget.tsx:125`). They send an `x-helm-tenant-id` header the API ignores. They only work in dev-bypass mode. The risk is that someone "fixes" them by removing auth from the staff routes.

**BI API keys (`routes/bi-api.ts:27-83`).** `Authorization: Bearer helm_…` → SHA-256 → `ApiKey.findFirst({keyHash})` → revocation check → `req.tenantId = apiKey.tenantId`. Problems:
- `tenantStore` isn't re-entered, so tenant isolation breaks (R-04).
- `scope` (`TENANT|PORTFOLIO`) is stored and never enforced.
- No expiry, no name/prefix, no per-resource scopes, no IP allow-list, no rate limit.
- No endpoints to create, list, rotate or revoke keys. The Settings page shows mock keys.
- Responses are full rows: `/customers` returns `dlNumber, dob, dlPhotoUrl, stripeCustomerId`.

### 1.2 Endpoint authorization table

Legend:
- **Auth:** `C` = `clerkAuth()` (prod: Clerk session + any `User` row in the tenant, active or not; **non-prod and the current Docker image: no auth**). `C!` = bare `clerkAuth` reference instead of `clerkAuth()`: Express calls it as middleware, it returns an array and never calls `next()`, so **the request hangs**. `PA` = `requirePlatformAdmin` (throws → 500). `K` = BI API key. `—` = none.
- **Roles:** `any` = any tenant user, including `PORTAL_USER` and deactivated users. `✗lc` = lowercase role list that **rejects everyone**. Named enum roles = works.
- **Loc:** location scoping. **No endpoint has any**, so the column is omitted. Assume "No" for every row.
- **Sens:** `$` money movement, `FIN` financial read, `PII`, `CFG` config/integration, `DEL` destructive, `X` bulk export, `AUTHZ` changes access.

#### Platform, identity, tenant

| Method | Path (`/api/…`) | Auth | Roles | Sens | Notes |
|---|---|---|---|---|---|
| GET | health | — | — | | |
| POST | auth/webhook | Svix sig | — | AUTHZ | creates/deactivates users; verifies `JSON.stringify(req.body)` (re-serialised; brittle) |
| POST | auth/sync-session | C | any | AUTHZ | create path unreachable in prod (C already requires a row) |
| GET | auth/me | C | any | | returns unused static permission list |
| POST | auth/switch-tenant | C | any | | checks `active` membership ✔ (the only place that checks) |
| POST | tenants | **—** | — | CFG | **unauthenticated tenant creation** |
| GET | tenants/:id | C | any | CFG | **cross-tenant read** (Tenant is unscoped; no `id === req.tenantId` check) |
| PUT | tenants/:id | C | ✗lc `admin` | CFG | if "fixed", also cross-tenant write |
| POST | tenants/:id/stripe/connect | C | ✗lc | CFG $ | passes tenant id as Stripe account id (bug) |
| POST | tenants/:id/qbo/connect | C | ✗lc | CFG | state = tenantId (no CSRF) |
| POST | onboarding/start | **—** | — | CFG | creates tenant + MARINA_OWNER; `$executeRawUnsafe` CREATE SCHEMA |
| POST | onboarding/:tenantId/branding | **—** | — | CFG | **any tenant, unauthenticated** |
| POST | onboarding/:tenantId/stripe | **—** | — | CFG $ | `state=tenantId` |
| GET | onboarding/:tenantId/stripe/callback | **—** | — | **$ CFG** | **attacker's Stripe code → victim tenant's `stripeAccountId`** |
| POST | onboarding/:tenantId/qbo | **—** | — | CFG | |
| GET | onboarding/:tenantId/qbo/callback | **—** | — | CFG | links any realm to any tenant; tokens discarded |
| POST | onboarding/:tenantId/chart-of-accounts | **—** | — | FIN | seeds GL for any tenant |
| GET | onboarding/:tenantId/status | **—** | — | CFG | tenant-existence/integration oracle |
| * | admin/* (22 routes: queues pause/unpause/status; tenants list/get/create/update/**impersonate**/lock/unlock; billing overview/invoices/generate/tiers; analytics; support tickets; tenant locations CRUD) | PA | broken (500) | CFG $ DEL AUTHZ | `locations/:locationId` update/delete ignores `:id` (admin.ts:925, 944); impersonation has no audit, uses a hard-coded fallback secret (admin.ts:319) |

#### Settings & team (the only role-checked router)

| Method | Path | Auth | Roles | Sens |
|---|---|---|---|---|
| GET/PUT | settings/marina | C | OWNER, MANAGER | CFG |
| GET/PUT | settings/branding | C | OWNER, MANAGER | CFG |
| GET/PUT | settings/billing | C | OWNER, MANAGER, ACCOUNTING | CFG $ (tax rate, late fees, invoice numbering) |
| GET | settings/stripe | C | OWNER, MANAGER | CFG |
| POST | settings/stripe/connect, /disconnect | C | OWNER | CFG $ |
| GET | settings/qbo | C | OWNER, MANAGER, ACCOUNTING | CFG |
| POST | settings/qbo/connect, /disconnect | C | OWNER | CFG |
| POST | settings/qbo/sync | C | OWNER, MANAGER, ACCOUNTING | FIN |
| GET | settings/team | C | OWNER, MANAGER | PII |
| POST | settings/team/invite | C | OWNER, **MANAGER** | **AUTHZ**: manager may invite `MARINA_OWNER` (settings.ts:61-69, 572) |
| PUT | settings/team/:userId/role | C | OWNER | AUTHZ: no last-owner guard, no audit |
| DELETE | settings/team/:userId | C | OWNER | AUTHZ DEL: sets `active=false`, which `clerkAuth` ignores |
| GET/PUT | settings/notifications | C | OWNER, MANAGER | CFG |

#### Customers, boats, CRM

| Method | Path | Auth | Roles | Sens |
|---|---|---|---|---|
| GET | customers | C | any | PII (search on email/phone) |
| GET | customers/:id | C | any | **PII full** (DOB, DL#, DL photo URL, emergency contact) |
| POST/PUT | customers, customers/:id | C | any | PII |
| DELETE | customers/:id | C | any | DEL (soft) |
| GET | customers/:id/timeline, /balance | C | any | PII FIN |
| POST | customers/:id/merge, /undo-merge | C | any | DEL (irreversible after 15 min) |
| GET/PUT | communication-prefs/:customerId(, /check) | C | any | PII (consent records) |
| GET | boats, boats/expiring-compliance, boats/:id, boats/:id/compliance | C | any | PII |
| POST/PUT/DELETE | boats, boats/:id; POST boats/:id/safety-inspection | C | any | DEL |
| GET/POST/PUT/DELETE | leads (stats, list, :id, create, update, stage, **convert**, delete) | C | any | PII DEL |
| GET/POST/PUT/DELETE | lead-forms (list, :id, create, update, delete) | C | any | CFG |
| POST | lead-forms/:embedKey/submit | **C** (intended public) | any | **broken**: `authedRouter.use(clerkAuth)` runs for every request through `/` (lead-forms.ts:94-95, 222) |
| GET/POST/PUT/DELETE | waitlist (list, :id, create, update, delete, notify-next, :id/accept, :id/expire) | C | any | PII; `accept` assigns a slip |
| GET/POST/PUT/DELETE | announcements (list, stats, :id, create, update, delete, **:id/send**, :id/deliveries, :id/duplicate) | C | any | PII; **mass SMS/email to all customers** |
| * | email-automation/* (12) | C | mixed (works) | **router not mounted in index.ts** |

#### Slips, contracts, operations

| Method | Path | Auth | Roles | Sens |
|---|---|---|---|---|
| GET | slips/dock-map, slips, slips/:id | C | any | |
| POST/PUT | slips, slips/:id | C | any | $ (`flatFeeCents`, `kwhRateCents`) |
| DELETE | slips/:id | C | any | DEL |
| POST | slips/:id/qr-code | C | any | |
| GET | contracts/expiring, contracts, contracts/:id, contracts/:id/signature-status | C | any | PII $ |
| POST/PUT | contracts, contracts/:id | C | any | $ (`rateCents`, deposit) |
| POST | contracts/:id/terminate | C | any | $ DEL (`penaltyOverrideCents`: anyone can waive) |
| POST | contracts/:id/renew | C | any | $ (`newRateCents`) |
| POST | contracts/:id/send-for-signature, bulk-send-for-signature | C | any | $ PII |
| POST | contracts/esign-webhook | **C** (intended public) | any | **no signature check; unscoped `findFirst` by id → would let anyone mark any tenant's contract signed if made public** (contracts.ts:934-955) |
| GET/POST/PUT | dock-walks (list, issues, :id, create, update, items, items/:itemId, :id/complete), pump-outs | C | any | |
| GET/POST/PUT | insurance/upload, customer/:customerId, :id | C | any | PII (policy docs) |
| GET | insurance/compliance, review-queue | C | ✗lc | PII |
| PUT | insurance/:id/review | C | ✗lc | |
| * | transient/* (8: availability, list, :id, create, check-in, check-out, overstay, delete) | **C!** | hangs | $ DEL |
| * | ramp/* (5: stats, tickets, tickets/:id, create, passes/validate) | **C!** | hangs | $ |
| * | concierge/* (10: requests CRUD, quote, approve, complete; vendors CRUD) | **C!** | hangs | $ |

#### Billing, payments, POS, inventory, fuel, rentals

| Method | Path | Auth | Roles | Sens |
|---|---|---|---|---|
| GET | invoices, invoices/:id | C | any | FIN PII |
| POST/PUT | invoices, invoices/:id | C | any | $ (`unitPriceCents` may be negative) |
| POST | invoices/:id/finalize, /send | C | any | $ |
| POST | invoices/:id/void | C | any | **$ DEL** (no period lock) |
| GET | payments, payments/:id | C | any | FIN |
| POST | payments | C | any | **$** (records cash/check/charge) |
| POST | payments/:id/refund | C | any | **$**: no cap; repeated partials can exceed the original (payments.ts:446-560) |
| GET/POST/PUT/DELETE | pos/products(, :id) | C | any | $ (price, **cost**) |
| POST | pos/transactions | C | any | **$**: client `unitPriceCents` + unlimited `discountCents`; unknown productIds accepted (pos.ts:27-32, 371) |
| GET | pos/transactions(, :id) | C | any | FIN |
| POST | pos/transactions/:id/refund | C | any | **$** |
| GET/PUT | pos/inventory(, :productId) | C | any | |
| GET | pos/shifts; POST pos/shifts/open, pos/shifts/:id/close | C | any | $ (any user can close any drawer) |
| GET | pos/reports/daily | C | any | FIN |
| * | inventory/* (19: products CRUD, adjustments, counts, purchase-orders create/receive/cancel, labels, **valuation**, reorder-alerts) | C | any | $ FIN (cost/valuation) DEL |
| GET | fuel/types, sales, deliveries, tank-levels | C | any | |
| POST | fuel/sales | C | any | $ |
| PUT | fuel/types/:id/price | C | ✗lc | $ |
| POST | fuel/deliveries | C | ✗lc | $ |
| GET | fuel/reports | C | ✗lc | FIN |
| * | rentals/* (19: products CRUD, pricing rules, calendar overrides, reservations CRUD/check-in/check-out/cancel, pricing suggestions approve, cancellation policies) | C | any | $ (rates, deposits, AI-price approval) |

#### Finance, reports, integrations, data

| Method | Path | Auth | Roles | Sens |
|---|---|---|---|---|
| GET | reports/* (40: occupancy, revenue, ar-aging, collections, deferred-revenue, gl-summary, customer-activity, lead-conversion, rental-utilization, pos-sales, dock-walk-summary, waitlist, compliance, tax-liability, inventory, electricity, transient, rental-marketing, dynamic-pricing, fuel, ramp, concierge, shift-reconciliation, tips, security-deposits, chargebacks, announcements, audit-summary, referral-attribution, insurance-compliance, pnl, balance-sheet, trial-balance, cash-flow, vacancy-history, contract-expiry-calendar, rate-increase-impact, customer-lifetime-value, dock-walk-violations, rent-roll) | C | ✗lc | FIN PII X | 100% unreachable in prod, including for ACCOUNTING |
| GET | audit-log, audit-log/export, record/:type/:id, user/:userId | C | ✗lc | X | unreachable |
| * | qbo/* (8: authorize, **callback**, sync, sync/customer/:id, sync/invoice/:id, status, disconnect, **webhook**) | C | ✗lc | CFG FIN | callback trusts `state` for tenantId (qbo.ts:66); webhook behind user auth, so broken |
| POST | storage/presign-upload | C | any | | no content-type allow-list |
| GET | storage/presign-download/* | C | any | **PII**: any staff can fetch any tenant file (DL photos, contracts) |
| DELETE | storage/* | C | any | DEL |
| GET | storage/usage | C | any | |
| GET | bi/customers, invoices, payments, slips, contracts, reservations, transactions, gl-entries | K | scope ignored | **X PII FIN**: cross-tenant (R-04) |

**Totals.** ~315 route handlers, ~303 mounted. 19 have a working role check (6%), 0 have location scoping, 12 have a role check that blocks everyone, 23 hang (`C!`), and 17 are public by accident or design (onboarding ×8, tenants POST, health, auth/webhook, plus the intended-public lead/esign/qbo webhooks, which are currently broken).

### 1.3 Findings

Effort: S ≤ 2 days, M ≤ 2 weeks, L > 2 weeks.

**Cross-reference to doc 07.** Several of these were found independently by the infra audit, which verified them against a running instance. Treat the doc 07 IDs as canonical for the infra fix, and use this table for the authorization design consequence:

| This doc | Doc 07 |
|---|---|
| R-01 | A-1 |
| R-02 | A-2, A-4 |
| R-04 | §0 item 2 / §5 |
| R-08 | A-6 |
| R-09 | A-9 |
| R-11 | A-3, A-10 |
| R-12 | A-5 |
| R-14 | A-11, A-12 |

Doc 07 also covers A-7 (Clerk `requireAuth` 302 / missing `authorizedParties`) and A-8 (no working user-provisioning/invite path), which this doc doesn't repeat. A-8 matters for the `Membership` model in §3.3: invitations should create `Membership(status=INVITED)` carrying the role assignments, and get linked to the `Identity` on first verified login.

| ID | Sev | Eff | Location | Finding | Fix |
|---|---|---|---|---|---|
| R-01 | **P0** | S | `Dockerfile.api` (no `ENV NODE_ENV`), `docker-compose.yml:53-55`, `middleware/auth.ts:34-53`, `tenant.ts:223` | A production image runs with dev bypass: no auth, everyone acts as the tenant's oldest user, and unknown hosts map to the first tenant. The `?? "admin"` fallback (auth.ts:45) passes the lowercase checks whenever a tenant has no users. | Invert the guard: bypass only when `HELM_DEV_AUTH_BYPASS=1` **and** `NODE_ENV==='development'`, and refuse to boot if the flag is set and `NODE_ENV==='production'`. Set `ENV NODE_ENV=production` in the image. Delete the tenant fallback outside `development`. |
| R-02 | **P0** | M | all routers | No authorization on money, PII, destructive and config endpoints (table above). Role strings don't match the enum (auth.ts:104 plus 12 call sites). | Interim (S): replace `requireRole` with a typed `requireRole(...UserRole[])` (TS enum, compile-time). Map the 12 lowercase calls. Add role gates on refund, void, payments, GL, pricing, delete, export and settings. Target: §3 `requirePermission`. |
| R-03 | **P0** | S | `onboarding.ts:110-410`, `tenant.ts:184` | Unauthenticated per-tenant onboarding mutations, including Stripe Connect account substitution through `stripe/callback`, so customer payments go to an attacker. | Require Clerk auth + `MARINA_OWNER` of the `:tenantId`. Replace `state=tenantId` with a random, single-use, server-stored state bound to user+tenant (10-min TTL). Only `POST /start` stays public, behind CAPTCHA, email verification and rate limiting. |
| R-04 | **P0** | S | `bi-api.ts:63-64`, `prisma.ts:104` | BI key → cross-tenant read because the context tenant overrides the key's tenant. | In `authenticateApiKey`: reject when `apiKey.tenantId !== req.tenantId` (host), or bypass host resolution for `/api/bi` and run `tenantStore.run({tenantId: apiKey.tenantId})`. Also flip the extension to **reject** conflicting tenantIds instead of overwriting them. Enforce scopes, project an explicit `select`, and drop DL#/DOB. |
| R-05 | **P0** | M | `schema.prisma:308`, `auth.ts:71` | Portal users (and any `User` row) get full staff API access. | Split principals: staff `Membership` vs `CustomerAccount` (portal identity linked to `Customer`). Every staff route requires `principal.kind==='staff'`. Portal routes live under `/api/portal/*` with `customerId` ownership checks. |
| R-06 | **P0** | S | `payments.ts:446-560`, `pos.ts:533` | Refunds: no permission, no cap, partial refunds repeatable past the original amount, cash refunds need no approval. | Track `refundedCents` per payment (or a `Refund` table) and enforce `sum ≤ amount`. Add the `payments.refund` permission + `refund.max_cents` limit + approval (§3.6). Use an idempotency key. |
| R-07 | **P0** | S | `pos.ts:27-32, 360-372` | POS price override and unlimited discounts from the client. Products not found in the tenant are accepted at a client-chosen price. | Server price from `Product`. Overrides need `pos.price.override` and discounts are capped by `discount.max_percent`. Reject unknown products. |
| R-08 | P1 | S | `auth.ts:71-76`, `settings.ts:647-668` | Deactivated users keep access. Removal doesn't revoke Clerk sessions. | Add `active: true` to the lookup. On deactivate, call Clerk `users.banUser` or revoke sessions. |
| R-09 | P1 | S | `settings.ts:61-69, 572` | Manager can invite an Owner, so privilege escalation. | Rule: you may only grant roles whose permission set ⊆ your own (§3.4 "no escalation"). |
| R-10 | P1 | S | `settings.ts` (0 audit writes), `admin.ts` | No audit trail for role/team/settings/integration changes, impersonation, lock/unlock or logins. | Central `audit()` with actor, impersonator, permission, decision and before/after; write-once table (§5). |
| R-11 | P1 | M | `admin.ts:298-344`, `auth.ts:121-158`, `apps/admin` | Impersonation: hard-coded fallback secret, no reason, no consent, no expiry enforcement, no consumer. Platform admin lookup broken. Admin SPA has no auth. Platform admins are tenant-scoped `User` rows. | Separate `PlatformUser` identity (own Clerk instance/org, SSO + hardware-key MFA). Impersonation per §3.9. Delete the HMAC token. |
| R-12 | P1 | S | `routes/ramp.ts:54…`, `transient.ts:65…`, `concierge.ts:87…` | `clerkAuth` passed uncalled, so 23 endpoints hang (accidental fail-closed). Someone will "fix" them by deleting the middleware. | `router.use(...clerkAuth())` + permissions. Add a lint rule (§3.7) that **every** route declares a permission or `public()`. |
| R-13 | P1 | S | `lead-forms.ts:94-227`, `contracts.ts:934`, `qbo.ts:50-75, 179` | Intended-public endpoints are wrongly placed behind user auth. Their designs have no signature, state or tenant checks (esign webhook, QBO callback/webhook). | Move to `/api/public/*` and `/api/webhooks/*` routers mounted **before** auth. Verify provider signatures over the **raw body**. Resolve tenant from a verified object, not from the request. |
| R-14 | P1 | S | `routes/tenants.ts:31, 61` | Unauthenticated `POST /tenants`; cross-tenant `GET /tenants/:id`. | Remove `POST /tenants` (onboarding owns creation). Replace `/:id` with `/current`. |
| R-15 | P1 | S | `lib/prisma.ts:17-55` | 20 tenant models not auto-scoped; 7 listed models have no `tenantId` (runtime errors); raw SQL and nested writes bypass scoping. | Generate the list from the DMMF at boot (`Prisma.dmmf` → models with `tenantId`). Fail closed when tenant context is missing for a tenant model (except an explicit `systemContext()`). Add Postgres RLS underneath it (§3.12), required before AI/MCP data access ships. |
| R-16 | P1 | M | `apps/web/public/sw.js:52-90` | All API GETs cached, not partitioned by user, kept after logout. | Don't cache `/api/*` by default. Allow-list offline datasets (dock-walk route sheet) into IndexedDB, encrypted with a session-derived key, and wipe on logout and on user switch. |
| R-17 | P1 | S | `storage.ts:85-145` | No per-category authorization on files (DL photos, insurance, contracts); any staff can delete files. | `files.<category>.view/delete` permissions; store `File` rows with owner/record linkage; short-TTL presigned URLs (≤5 min). |
| R-18 | P1 | M | schema (no `locationId` on core models) | Multi-marina operators can't scope staff by site. | Add `locationId` to Slip/Dock, Contract, Invoice, Payment, PosTransaction, Reservation, TransientBooking, Product/Inventory, FuelTank, DockWalk, Shift (backfill to a default location per tenant). |
| R-19 | P1 | S | `ModulesContext.tsx`, `AppLayout.tsx:253`, `Settings.tsx:88-168`, `help-articles.ts:103` | UI gating is cosmetic, per-browser, and claims controls that don't exist (2FA, per-location). | Server-driven `effectivePermissions` + `entitlements` (§3.8). Fix the help copy until MFA is enforced. |
| R-20 | P2 | S | `settings.ts:610-640` | No last-owner protection; owners can demote each other silently. | Require ≥1 active Owner. Owner-to-Owner changes need step-up MFA and send a notification. |
| R-21 | P2 | S | `schema.prisma:308-324` | No unique `(tenantId, clerkUserId)` / `(tenantId, email)`, so duplicate memberships make `findFirst` nondeterministic. | Add unique indexes as part of the Membership migration. |
| R-22 | P2 | S | `widgets/*` | Public widgets call staff endpoints. | Public booking endpoints with server-side price calculation, CAPTCHA/rate limits and tenant from the widget's publishable key. |
| R-23 | P2 | S | `contracts.ts:79, 576` | Termination penalty waiver, rate changes and renewal rate overrides need no special permission. | `contracts.penalty.waive`, `contracts.rate.override` + limits/approval. |
| R-24 | P2 | S | `index.ts` | `email-automation` router not mounted (dead code with its own role logic). | Mount behind permissions or delete. |

---

## 2. What good looks like: comparable vertical SaaS

Based on each vendor's public help-centre documentation as I understand it. Re-verify the specifics before using them in sales material.

| Vendor | Model | Takeaways for Helm |
|---|---|---|
| **Toast** (restaurant POS) | Jobs/"permission sets" with dozens of toggles grouped by area (POS, manager, back-office, setup). Employees can hold several jobs, each with a different wage and access. Sensitive POS actions (void, comp, discount, reopen check, no-sale drawer open) prompt **manager approval by passcode/card swipe on the same device**. Multi-location groups share or override configs. | Approval *at the point of action*, by a second person, on a shared device. Per-job (= per-role-per-location) assignment. |
| **Square** | Default + custom **permission sets** (custom on paid plans). Team members are assigned to locations, and devices can run in "team passcode" mode. Point-of-sale vs dashboard permissions are separate. | Two surfaces (front-of-house device vs back office) with separate permissions. Passcode/PIN fast-switch on shared devices. Per-location assignment. |
| **Lightspeed** (Retail X/R-series, Restaurant) | Customizable **user roles** with granular permissions (discount limits, refunds, price edits, cost visibility). Users are restricted to outlets/stores. | Show/hide **cost & margin** as a permission. Discount % caps per role. |
| **ServiceTitan** (field services) | Very granular role permissions (hundreds of toggles). **Business units** scope data and reporting. Pricebook edits, discounts and invoice edits after export are separately controlled. | Org-unit scoping (≈ Helm Location/Location Group). "Edit after close/export" as its own permission. |
| **Mindbody** (fitness/wellness) | Staff **permission groups** with a long list of toggles, per-location access, and some per-staff settings (e.g. what a front-desk user can see about a client's billing). | Granular PII visibility (client contact/billing info). Templates that tenants then edit. |
| **Cloudbeds** (hotels; closest operational analogue to transient slips) | Customizable **user roles** across properties; permissions for rate/folio adjustments, refunds, reports and night-audit/day-close actions. | Day-close/night-audit lock; folio adjustments after close need elevated rights. Multi-property users. |
| **Storable** (SiteLink/storEDGE; self-storage, the closest vertical to marinas) | Corporate-defined **user roles** per facility. Restrictions on rate overrides, fee waivers, refunds and discounts, plus **time-of-day login restrictions** and corporate/site separation for multi-facility operators. | Portfolio ("corporate") control with site staff limited to their facility. Fee-waiver limits. Login-hour windows. |

**Common pattern:** system templates → tenant-editable custom roles → assigned **per location** → monetary/percentage **limits** → **manager override at the point of sale** → audit. None of the leaders makes operators choose from a fixed enum. Helm can stand out by adding ABAC conditions (limits, time/IP/device), dual control with a clean approval UX, PII field masking, and enterprise identity (SSO/SCIM). Marina software competitors (e.g. Dockwa, Molo, DockMaster) don't market granular controls heavily, so this is a real enterprise differentiator.

---

## 3. Target permission system

### 3.1 Principles

1. **Permission keys, not roles, in code.** Code checks only `resource.action[.qualifier]`. Roles are tenant data.
2. **Deny by default.** Every route declares a permission or is explicitly `public()` / `webhook()`. CI fails otherwise.
3. **RBAC for coarse grants, ABAC for conditions.** Roles grant permissions; policies add conditions (location, amount limits, time, IP, device, MFA freshness, record state such as "period closed").
4. **Scope = tenant → location group → location.** An assignment grants a role *at* a scope.
5. **Explicit deny beats allow.** Overrides can remove a single permission from one user.
6. **No escalation.** A user can only grant permissions (and limits) they hold themselves, at scopes they hold.
7. **Separation of duties** is configurable (requester ≠ approver; preparer ≠ poster).
8. **Server is the source of truth.** The UI only reflects the effective set the server computes.
9. **Everything that changes access, or uses an elevated right, is audited.**
10. **One enforcement point, many entry points.** Authorization lives in a transport-agnostic **service/command layer**. Express middleware, the AI assistant's tool layer, the public REST API, OAuth apps, the MCP server, webhooks and background jobs all call the *same* `authorize()` / `executeCommand()`, so the rules are identical everywhere (§3.7, §3.11).
11. **An AI agent is never more powerful than the human it acts for**, and is often less (§3.11).
12. **Defence in depth for tenancy.** Application scoping, plus Postgres row-level security underneath it (§3.12).

### 3.2 Concepts

```
Principal  = StaffMembership | CustomerAccount (portal) | ApiClient (key/OAuth app) | PlatformUser | System(job)
             | ServiceIdentity (per-tenant background AI agent / automation)
             each optionally wrapped in a Delegation { via: "ai_assistant" | "mcp" | "oauth_app", agentRunId }
             → effective = principal's permissions ∩ channel ceiling ∩ tenant AI policy   (§3.11)
Permission = static catalog entry (code-owned):  key, module, risk, supportsLimits[], supportsScope
Role       = tenant-owned bundle of (permission, effect, constraints); may be cloned from a SystemRoleTemplate
Assignment = (membership, role, scope: TENANT | LOCATION_GROUP | LOCATION, validFrom/To)
Override   = (membership, permission, ALLOW|DENY, scope?, constraints?, expiresAt, reason)
PolicyLimit= numeric/enum caps keyed by limitKey at role or membership level (refund.max_cents …)
AccessPolicy = conditions on login/session/action: time windows, IP CIDRs, trusted device, MFA
ApprovalPolicy = when an action needs a second person, and who may approve
Entitlement = module on/off from SaaS tier/add-ons (server-side; replaces localStorage modules)
```

**Effective decision** for `(principal, permission, context{locationId, amountCents, percent, record})`:

```
entitled(module) ∧
( ∃ assignment covering context.location granting permission  ∨  override ALLOW covering location )
∧ ¬ override DENY covering location
∧ AccessPolicy(time, ip, device, mfaAge) satisfied
→ then evaluate limits: value ≤ min(applicable limits)  → ALLOW
                         value > limit ∧ ApprovalPolicy exists → REQUIRE_APPROVAL
                         else → DENY
→ obligations: field masks (pii, cost), audit level
```

When roles conflict on limits, the **most permissive** limit across the user's granting roles wins (union semantics, like Toast/Square), unless an override limit is set. That override always wins and is usually tighter.

### 3.3 Data model (Prisma)

```prisma
// ── Identity ──────────────────────────────────────────────────────────────
model Identity {                       // one per human, global
  id            String   @id @default(uuid())
  clerkUserId   String   @unique
  email         String
  displayName   String?
  createdAt     DateTime @default(now())
  memberships   Membership[]
}

enum MembershipKind   { STAFF CONTRACTOR }
enum MembershipStatus { INVITED ACTIVE SUSPENDED DEACTIVATED }

model Membership {                     // replaces per-tenant User for staff
  id             String           @id @default(uuid())
  tenantId       String
  identityId     String
  kind           MembershipKind   @default(STAFF)
  status         MembershipStatus @default(INVITED)
  legacyRole     UserRole?        // kept during migration only
  employeeCode   String?          // payroll/badge id
  posPinHash     String?          // argon2; for shared-device fast switch
  authzVersion   Int              @default(1)   // bump on any access change → cache bust
  mfaEnrolledAt  DateTime?
  lastLoginAt    DateTime?
  lastLoginIp    String?
  scimExternalId String?
  createdAt      DateTime         @default(now())
  updatedAt      DateTime         @updatedAt
  identity       Identity         @relation(fields: [identityId], references: [id])
  assignments    RoleAssignment[]
  overrides      PermissionOverride[]
  @@unique([tenantId, identityId])
  @@index([tenantId, status])
}

model CustomerAccount {                // portal identity, never a staff principal
  id          String   @id @default(uuid())
  tenantId    String
  identityId  String
  customerId  String
  relation    String   @default("PRIMARY") // PRIMARY | AUTHORIZED_USER | CO_OWNER
  status      String   @default("ACTIVE")
  @@unique([tenantId, identityId, customerId])
}

// ── Scope ─────────────────────────────────────────────────────────────────
model LocationGroup {                  // "Florida marinas", "Region North"
  id        String @id @default(uuid())
  tenantId  String
  name      String
  locations LocationGroupMember[]
}
model LocationGroupMember {
  groupId    String
  locationId String
  @@id([groupId, locationId])
}

// ── Catalog & roles ──────────────────────────────────────────────────────
model Permission {                     // seeded from code on deploy; read-only in UI
  key            String  @id           // "payments.refund"
  module         String                // "billing" — ties to entitlements
  resource       String
  action         String
  description    String
  risk           String                // LOW | MEDIUM | HIGH | CRITICAL
  limitKeys      String[]              // ["refund.max_cents"]
  scopeable      Boolean @default(true) // false for tenant-global (e.g. settings.billing.manage)
  dependsOn      String[]              // "invoices.void" requires "invoices.view"
  deprecatedAt   DateTime?
}

model Role {
  id              String   @id @default(uuid())
  tenantId        String?              // null = system template
  key             String               // "harbor_master"
  name            String
  description     String?
  isTemplate      Boolean  @default(false)
  templateId      String?              // cloned from
  templateVersion Int?                 // for "template updated — review changes" prompts
  isLocked        Boolean  @default(false) // Owner role: not editable / deletable
  archivedAt      DateTime?
  createdBy       String?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  permissions     RolePermission[]
  limits          PolicyLimit[]
  @@unique([tenantId, key])
}

enum Effect { ALLOW DENY }

model RolePermission {
  roleId        String
  permissionKey String
  effect        Effect  @default(ALLOW)
  conditions    Json?   // optional ABAC: {"ownRecordsOnly":true} | {"statusIn":["DRAFT"]}
  @@id([roleId, permissionKey])
}

enum ScopeType { TENANT LOCATION_GROUP LOCATION }

model RoleAssignment {
  id              String    @id @default(uuid())
  tenantId        String
  membershipId    String
  roleId          String
  scopeType       ScopeType
  locationId      String?
  locationGroupId String?
  validFrom       DateTime  @default(now())
  validUntil      DateTime? // seasonal staff
  grantedBy       String
  reason          String?
  createdAt       DateTime  @default(now())
  @@index([tenantId, membershipId])
  @@unique([membershipId, roleId, scopeType, locationId, locationGroupId])
}

model PermissionOverride {
  id            String    @id @default(uuid())
  tenantId      String
  membershipId  String
  permissionKey String
  effect        Effect
  scopeType     ScopeType @default(TENANT)
  locationId    String?
  conditions    Json?
  expiresAt     DateTime? // temporary elevation ("cover for GM this weekend")
  grantedBy     String
  reason        String
  createdAt     DateTime  @default(now())
  @@index([tenantId, membershipId])
}

model PolicyLimit {                    // numeric caps
  id           String  @id @default(uuid())
  tenantId     String
  roleId       String?                 // one of roleId / membershipId
  membershipId String?
  locationId   String?
  limitKey     String                  // "refund.max_cents", "discount.max_percent"
  value        Decimal
  period       String?                 // null | "per_txn" | "per_shift" | "per_day"
  @@index([tenantId, limitKey])
}

// ── Conditions, approvals, devices ───────────────────────────────────────
model AccessPolicy {
  id           String  @id @default(uuid())
  tenantId     String
  roleId       String?
  membershipId String?
  type         String  // TIME_WINDOW | IP_ALLOWLIST | TRUSTED_DEVICE_REQUIRED | MFA_REQUIRED | GEOFENCE
  config       Json    // {"tz":"America/New_York","days":[1..7],"from":"06:00","to":"20:00"}
  enforcement  String  @default("BLOCK") // BLOCK | REQUIRE_APPROVAL | LOG_ONLY
}

model ApprovalPolicy {
  id                  String  @id @default(uuid())
  tenantId            String
  actionKey           String  // permission key, e.g. "payments.refund"
  condition           Json    // {"amountCentsGt": 20000} | {"periodClosed": true} | {"percentGt": 15}
  approverPermission  String  // "approvals.refund.approve"
  minApprovers        Int     @default(1)
  requireDistinct     Boolean @default(true) // approver ≠ requester
  allowSameDevicePin  Boolean @default(true)  // Toast-style manager PIN on the terminal
  ttlMinutes          Int     @default(30)
  active              Boolean @default(true)
}

model ApprovalRequest {
  id            String   @id @default(uuid())
  tenantId      String
  locationId    String?
  actionKey     String
  payload       Json     // canonical action input
  payloadHash   String   // sha256(canonical JSON) — approval bound to exact action
  requestedBy   String
  reason        String?
  status        String   // PENDING | APPROVED | DENIED | EXPIRED | CONSUMED | CANCELLED
  decidedBy     String?
  decidedAt     DateTime?
  decisionNote  String?
  expiresAt     DateTime
  consumedAt    DateTime?
  createdAt     DateTime @default(now())
  @@index([tenantId, status])
}

model TrustedDevice {                   // POS terminals, dock tablets, office PCs
  id           String    @id @default(uuid())
  tenantId     String
  locationId   String?
  name         String
  kind         String    // POS | TABLET | DESKTOP | KIOSK
  publicKey    String    // WebAuthn/device-bound key, or mTLS cert fingerprint
  sharedDevice Boolean   @default(false) // enables PIN fast-switch; short idle timeout
  registeredBy String
  lastSeenAt   DateTime?
  revokedAt    DateTime?
}

model TenantSecurityPolicy {
  tenantId              String  @id
  mfaRequired           String  @default("PRIVILEGED") // NONE | PRIVILEGED | ALL
  mfaMethods            String[] @default(["totp","webauthn"])
  idleTimeoutMin        Int     @default(30)
  sharedDeviceIdleMin   Int     @default(5)
  absoluteSessionHours  Int     @default(12)
  stepUpMaxAgeMin       Int     @default(10)  // for CRITICAL permissions
  ipAllowlist           String[]              // tenant-wide back-office restriction
  ssoEnforced           Boolean @default(false)
  allowSupportAccess    Boolean @default(false) // impersonation consent default
  piiExportRequiresApproval Boolean @default(true)
}

// ── Platform support access ──────────────────────────────────────────────
model SupportAccessGrant {              // customer consent for "log in as"
  id          String   @id @default(uuid())
  tenantId    String
  grantedBy   String   // membershipId (owner/admin)
  mode        String   // READ_ONLY | FULL
  ticketRef   String?
  expiresAt   DateTime
  revokedAt   DateTime?
}
model ImpersonationSession {
  id              String   @id @default(uuid())
  platformUserId  String
  tenantId        String
  targetMembershipId String
  grantId         String?  // null only for break-glass
  breakGlass      Boolean  @default(false)
  reason          String
  ticketRef       String
  mode            String   // READ_ONLY | FULL
  startedAt       DateTime @default(now())
  expiresAt       DateTime
  endedAt         DateTime?
}

// ── Entitlements ─────────────────────────────────────────────────────────
model TenantEntitlement {
  tenantId  String
  module    String   // slips, contracts, billing, pos, fuel, rentals, transient, ramp, concierge, service, storage, bi_api, sso, scim, audit_stream
  enabled   Boolean
  source    String   // TIER | ADDON | TRIAL | PLATFORM_OVERRIDE
  limits    Json?    // {"locations":3,"apiKeys":5}
  @@id([tenantId, module])
}
```

**`AuditLog` upgrade (replace the current model):** `actorType (STAFF|CUSTOMER|API_CLIENT|PLATFORM|SYSTEM)`, `actorId`, `impersonationSessionId?`, `approvalRequestId?`, `permissionKey?`, `decision (ALLOW|DENY|APPROVAL_REQUIRED)`, `locationId?`, `recordType`, `recordId`, `action`, `before Json?`, `after Json?`, `reason?`, `requestId`, `ip`, `userAgent`, `deviceId?`, `createdAt`, `prevHash`, `hash` (per-tenant hash chain). Make the table append-only: revoke UPDATE/DELETE from the app DB role, or use a trigger. Keep 1 year hot and 7 years in archive (financial).

**`ApiKey` upgrade:** `name, prefix (first 8 chars, shown), keyHash (HMAC-SHA256 with server pepper), scopes String[] (e.g. bi:read, customers:read, invoices:write), locationIds String[], ipAllowlist String[], expiresAt, createdBy, lastUsedAt, lastUsedIp, revokedAt, rotatedFromId, graceUntil`.

### 3.4 Permission catalog (v1)

Format: `key`. Risk: L/M/H/C. **Limits** are policy-limit keys the permission honours. The catalog lives in code (`packages/authz/catalog.ts`), is seeded into `Permission` on deploy, and is versioned.

**Customers & CRM**

| Key | Risk | Notes / limits |
|---|---|---|
| customers.view | L | name, boat, slip, balance |
| customers.contact.view | M | email/phone/address (masked otherwise) |
| customers.pii.view_full | H | DOB, DL#, DL photo, emergency contact, unmasked |
| customers.create / customers.edit | M | |
| customers.deactivate | M | |
| customers.merge | H | |
| customers.delete_erase | C | GDPR/CCPA erasure workflow |
| customers.credit_limit.edit | H | |
| customers.ach_block.edit | H | |
| customers.tax_exempt.edit | H | exemption certificates |
| customers.notes.private.view | M | |
| boats.view / boats.edit / boats.delete | L/M/M | |
| insurance.view / insurance.review / insurance.override_compliance | M/M/H | |
| leads.view / leads.edit / leads.convert / leads.delete | L/L/M/M | |
| leads.forms.manage | M | |
| waitlist.view / waitlist.edit / waitlist.offer / waitlist.reorder_priority | L/L/M/H | reorder = fairness-sensitive |
| communications.send.individual | M | |
| communications.send.bulk | H | limit: `bulk_send.max_recipients` |
| communications.templates.manage | M | |
| communications.consent.override | H | |

**Slips, contracts, operations**

| Key | Risk | Notes / limits |
|---|---|---|
| slips.view / slips.map.view | L | |
| slips.manage | M | create/edit dimensions, amenities |
| slips.rates.edit | H | |
| slips.delete | H | |
| slips.assign | M | assign/move a vessel |
| slips.hold_override | H | double-book/override holds |
| contracts.view | L | |
| contracts.create / contracts.edit_draft | M | |
| contracts.rate.override | H | limit `rate_override.max_percent` |
| contracts.send_for_signature | M | |
| contracts.sign_on_behalf | C | wet-ink/phone consent; needs reason + upload |
| contracts.renew / contracts.renew.bulk | M/H | |
| contracts.terminate | H | |
| contracts.penalty.waive | H | limit `penalty_waive.max_cents` |
| transient.view / transient.book / transient.check_in_out | L/M/L | |
| transient.overstay.charge / transient.fee.waive | M/H | limit `fee_waive.max_cents` |
| dockwalks.perform / dockwalks.manage / dockwalks.violations.issue | L/M/M | |
| pumpouts.log | L | |
| meters.read.record / meters.read.edit_past | L/H | |
| ramp.tickets.sell / ramp.passes.validate / ramp.passes.comp | L/L/M | |
| concierge.requests.manage / concierge.quotes.approve / concierge.vendors.manage | L/M/M | |
| service.workorders.view / .create / .estimate.approve / .close (future service module) | L/M/M/M | |
| storage.units.manage (dry-stack/rack, future) | M | |

**Billing & money**

| Key | Risk | Notes / limits |
|---|---|---|
| invoices.view | M | |
| invoices.create / invoices.edit_draft | M | |
| invoices.finalize / invoices.send | M | |
| invoices.line.credit | H | negative lines; limit `credit.max_cents` |
| invoices.void | H | |
| invoices.void.after_close | C | voids in a closed day/period |
| invoices.late_fee.waive | M | limit `late_fee_waive.max_cents` |
| invoices.write_off | H | limit `write_off.max_cents` |
| payments.view | M | |
| payments.record.card | M | Stripe; card never touches Helm |
| payments.record.cash_check | M | |
| payments.record.offline_card | H | Terminal store-and-forward |
| payments.refund | H | limits `refund.max_cents`, `refund.daily_max_cents` |
| payments.refund.over_limit | C | bypasses the limit (normally approval) |
| payments.refund.to_different_method | C | cash refund for card payment, etc. |
| payments.methods.manage_on_file | H | add/remove saved cards/ACH for a customer |
| payments.autopay.manage | M | |
| deposits.view / deposits.release / deposits.apply | M/H/H | |
| collections.manage / chargebacks.respond | H/H | |
| pricing.rules.manage | H | dynamic pricing, calendars |
| pricing.ai_suggestions.approve | H | |
| pricing.override | H | limit `price_override.max_percent` (down), `price_override.max_up_percent` |
| discounts.apply | M | limit `discount.max_percent`, `discount.max_cents` |
| promos.manage | M | |
| tax.exempt.apply | H | |
| daily_close.perform / daily_close.reopen | M/C | |

**POS, fuel, inventory, rentals**

| Key | Risk | Notes / limits |
|---|---|---|
| pos.sell | L | |
| pos.price.override | H | limit `price_override.max_percent` |
| pos.discount.apply | M | limit `discount.max_percent` |
| pos.void_line / pos.void_ticket | M/H | |
| pos.refund | H | limit `refund.max_cents` |
| pos.no_sale.open_drawer | M | |
| pos.charge_to_account | M | limit `house_charge.max_cents` |
| pos.shift.open_own / pos.shift.close_own | L | |
| pos.shift.close_any / pos.shift.variance.approve | H | limit `drawer_variance.max_cents` |
| pos.tips.adjust | H | |
| fuel.sell / fuel.price.edit / fuel.deliveries.record / fuel.tank.adjust | L/H/M/H | |
| inventory.view / inventory.edit / inventory.adjust / inventory.count | L/M/H/M | limit `adjust.max_units` |
| inventory.cost.view | M | hides cost/margin/valuation everywhere |
| purchasing.po.create / purchasing.po.approve / purchasing.po.receive | M/H/M | limit `po.approve.max_cents` |
| rentals.view / rentals.book / rentals.check_in_out | L/M/L | |
| rentals.products.manage / rentals.damage.charge / rentals.deposit.release | M/M/H | |

**Finance, reports & data**

| Key | Risk | Notes / limits |
|---|---|---|
| reports.operational.view | L | occupancy, dock walks, waitlist |
| reports.sales.view | M | POS/fuel/rental sales |
| reports.financial.view | H | P&L, balance sheet, trial balance, cash flow, AR aging, deferred revenue |
| reports.payroll_tips.view | H | |
| reports.portfolio.view | H | cross-location rollups (requires multi-location scope) |
| gl.accounts.view / gl.accounts.manage | M/H | |
| gl.entries.view | H | |
| gl.post_manual | C | SoD: cannot approve own |
| gl.post_manual.approve | C | |
| gl.period.close / gl.period.reopen | H/C | |
| integrations.qbo.sync | M | |
| data.export | H | CSV/BI exports; limit `export.max_rows`; may require approval |
| data.export.pii | C | export including contact/PII columns |
| audit.view / audit.export | H/H | |

**Administration**

| Key | Risk | Notes / limits |
|---|---|---|
| settings.profile.manage | M | marina profile, hours, branding |
| settings.billing.manage | H | tax rates, late fees, invoice numbering |
| settings.integrations.manage | C | Stripe, QBO, Twilio, e-sign; step-up MFA |
| settings.payments.payout_account | C | owner-only by default; step-up MFA + email notice |
| settings.security.manage | C | MFA policy, session policy, IP allow-lists, SSO |
| settings.locations.manage | H | |
| users.view | M | |
| users.invite / users.deactivate | H | no-escalation rule applies |
| users.roles.assign | C | |
| roles.manage | C | create/edit custom roles |
| users.impersonate.within_tenant | C | owner "view as" (read-only) for troubleshooting roles |
| apikeys.manage / oauth_apps.manage | C | |
| support_access.grant | H | consent to Helm support |
| devices.manage | H | register POS/tablets |
| approvals.refund.approve, approvals.discount.approve, approvals.void.approve, approvals.export.approve, approvals.gl.approve | H | approver capabilities, scoped by location |
| tenant.delete | C | owner only, step-up, 7-day cool-off |

**AI assistant & agents** (details in §3.11; every AI action *also* requires the underlying business permission):

| Key | Risk | Notes / limits |
|---|---|---|
| ai.assistant.use | L | chat, navigation help, drafting; no data access beyond what the user can already read |
| ai.data.query | M | natural-language questions over tenant data; results pass through the same field masks |
| ai.data.query.financial | H | NL questions touching `reports.financial.*` data (still requires that permission) |
| ai.actions.propose | L | agent may prepare actions for the user to confirm (default for all AI users) |
| ai.actions.execute | M | agent may execute confirmed actions on the user's behalf |
| ai.actions.auto_approve.low_risk | M | agent may execute LOW-risk actions without a per-action click (e.g. create customer, add note, book a slip at list price) |
| ai.actions.auto_approve.medium_risk | H | same for MEDIUM risk; off in every template |
| ai.bulk_operations | H | agent actions over > N records (limit `ai.bulk.max_records`) |
| ai.bulk_communications | H | agent-initiated email/SMS to > N recipients (limit `ai.bulk_comms.max_recipients`); always confirmation + TCPA/consent check |
| ai.communications.send_individual | M | agent sends a single email/SMS to a customer |
| ai.export | H | agent produces downloadable files (also requires `data.export`) |
| ai.agents.manage | C | create/configure background agents (service identities), their schedules and scopes |
| ai.agents.approve_runs | H | approve actions queued by background agents |
| ai.policy.manage | C | edit the tenant AI policy (§3.11.2) |
| ai.transcripts.view_all | H | read other users' assistant conversations (privacy-sensitive; audited) |

**Portal (customer principal, separate namespace, never mixable with staff roles):** `portal.account.view`, `portal.invoices.view_pay`, `portal.payment_methods.manage`, `portal.boats.manage`, `portal.insurance.upload`, `portal.reservations.manage`, `portal.concierge.request`, `portal.authorized_users.manage`. All are implicitly constrained to `customerId ∈ principal.customerIds`.

**API scopes (keys/OAuth):** `bi:read`, `customers:read`, `customers:write`, `invoices:read`, `invoices:write`, `payments:read`, `reservations:read`, `reservations:write`, `slips:read`, `webhooks:manage`. Each maps to a set of catalog keys. The key's creator must hold them (no escalation).

### 3.5 System role templates

Tenants **clone** templates into their own roles and edit them. Templates are versioned: when Helm adds a permission to a template, tenants see "Template updated: review 3 new permissions" and nothing is auto-granted. The `Owner` role is locked: it can't be edited and is always held by ≥1 member.

Legend: ● full, ◐ limited (limit shown), ○ view only, blank = none.

| Capability | Owner | GM | Harbor Master | Dockhand | Fuel Attendant | Cashier | Rental Desk | Service Writer | Bookkeeper | RO Auditor |
|---|---|---|---|---|---|---|---|---|---|---|
| customers.view / contact.view | ● | ● | ● | ○ name only | ○ name | ● | ● | ● | ● | ○ |
| customers.pii.view_full | ● | ● | | | | | ◐ DL for rental | | | |
| customers.merge / delete_erase | ● | ◐ merge | | | | | | | | |
| slips.view / map | ● | ● | ● | ● | ○ | ○ | | ○ | ○ | ○ |
| slips.assign / transient.book | ● | ● | ● | ◐ transient only | | | | | | |
| slips.rates.edit / pricing.rules.manage | ● | ● | | | | | | | | |
| contracts.create / send | ● | ● | ● | | | | | | | ○ |
| contracts.rate.override | ● | ◐ 10% | ◐ 5% | | | | | | | |
| contracts.penalty.waive | ● | ◐ $500 | | | | | | | | |
| contracts.sign_on_behalf | ● | ● | | | | | | | | |
| dockwalks.perform / violations | ● | ● | ● | ● | | | | | | ○ |
| fuel.sell | ● | ● | ● | ● | ● | ● | | | | |
| fuel.price.edit | ● | ● | | | | | | | | |
| pos.sell | ● | ● | ● | ◐ | ● | ● | ● | ● | | |
| pos.discount.apply | ● | ◐ 25% | ◐ 15% | | ◐ 5% | ◐ 10% | ◐ 10% | ◐ 10% | | |
| pos.price.override | ● | ◐ 25% | ◐ 10% | | | approval | approval | ◐ 10% | | |
| pos.void_ticket / refund | ● | ◐ $1,000 | ◐ $250 | | approval | approval | approval | ◐ $250 | | |
| pos.shift.close_own / close_any | ● | ● / ● | ● / ● | | ● | ● | ● | | ○ | ○ |
| rentals.book / check_in_out | ● | ● | ● | ◐ check-in | | | ● | | | ○ |
| rentals.damage.charge / deposit.release | ● | ● | ● | | | | ◐ $200 | | | |
| service.workorders.* | ● | ● | ○ | | | | | ● | ○ | ○ |
| invoices.view / create / finalize | ● | ● | ◐ create | | | | | ◐ create | ● | ○ |
| invoices.void | ● | ● | | | | | | | ◐ pre-close | |
| invoices.void.after_close | ● | approval | | | | | | | approval | |
| payments.record.* | ● | ● | ● | | ● | ● | ● | ● | ● | |
| payments.refund | ● | ◐ $2,000 | ◐ $250 | | | | | | ◐ $5,000 | |
| invoices.write_off | ● | ◐ $500 | | | | | | | ◐ $1,000 | |
| deposits.release | ● | ● | | | | | | | ● | |
| reports.operational.view | ● | ● | ● | | | | ○ | ○ | ● | ○ |
| reports.sales.view | ● | ● | ● | | ○ own shift | ○ own shift | ○ | | ● | ○ |
| reports.financial.view | ● | ● | | | | | | | ● | ○ |
| inventory.cost.view | ● | ● | | | | | | ● | ● | ○ |
| gl.post_manual | ● | | | | | | | | ● (SoD) | |
| gl.period.close | ● | | | | | | | | ● | |
| data.export / data.export.pii | ● / ● | ● / approval | | | | | | | ● / approval | ● / |
| audit.view | ● | ● | | | | | | | ● | ● |
| settings.integrations.manage / payout_account | ● | | | | | | | | | |
| settings.security.manage | ● | | | | | | | | | |
| users.invite / roles.assign | ● | ◐ ≤ own | | | | | | | | |
| roles.manage | ● | | | | | | | | | |
| approvals.* | ● | ● | ◐ ≤$500 | | | | | | ◐ gl/void | |
| ai.assistant.use / ai.data.query | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● |
| ai.actions.propose / execute | ● | ● | ● | ◐ propose | ◐ propose | ◐ propose | ● | ● | ● | |
| ai.actions.auto_approve.low_risk | ● | ● | | | | | | | | |
| ai.bulk_communications | ● | ◐ ≤500 | | | | | | | | |
| ai.agents.manage / ai.policy.manage | ● | | | | | | | | | |

Default access policies on templates: Dockhand, Fuel Attendant, Cashier and Rental Desk use `TRUSTED_DEVICE_REQUIRED` + shared-device PIN mode, with a `TIME_WINDOW` equal to operating hours ± 1 h. Owner, GM and Bookkeeper have `MFA_REQUIRED`. RO Auditor has `validUntil` set by default (time-boxed engagement) and `MFA_REQUIRED`.

### 3.6 Approvals, dual control and limits

**Flow** (same API for web and POS):

1. A handler calls `authz.check('payments.refund', { locationId, amountCents: 45000, record })`.
2. The result is `REQUIRE_APPROVAL` with `{ policyId, approverPermission }`. The API returns **`409 approval_required`** with `{ approvalRequestId?, policy, eligibleApprovers? }`. The original request is **not** executed.
3. The client offers one of two paths:
   - **(a) On-device manager override** (Toast-style): the manager enters their PIN or taps a badge/WebAuthn key on the same terminal. `POST /api/approvals {actionKey, payload, approverPin}` approves synchronously if the approver holds `approvals.refund.approve` at that location and isn't the requester.
   - **(b) Remote request:** creates a `PENDING` `ApprovalRequest`. The approver is notified by push/SMS/email and approves in the app, with step-up MFA if the action is CRITICAL.
4. The client retries the original call with header `Helm-Approval: <approvalRequestId>`. The server checks `payloadHash` matches, status is `APPROVED`, it hasn't expired and it isn't consumed. Then it executes and marks the request `CONSUMED` in the same transaction.
5. Audit records requester, approver, policy and both decisions.

**Built-in policy conditions:**
- `amountCentsGt` and `percentGt`.
- `periodClosed`: the record's business date is before the last `daily_close`, or the GL period is closed.
- `outsideHours`, `untrustedDevice`.
- `cumulativePerShiftGt` / `perDayGt`, evaluated from a running ledger, e.g. a cashier's refunds today.
- `recordCreatedByRequester`: SoD, e.g. a manual journal posted by the same user.
- `targetIsSelf`: refunding your own account, changing your own role.

**Default policies shipped with every tenant (editable):** refunds > $250 · discounts > 15% · price overrides > 10% · any void after day close · write-offs > $100 · deposit release > $1,000 · manual GL entries (always) · PII export (always) · bulk SMS > 500 recipients · payout account change (owner + 24-hour cool-off + email to all owners).

### 3.7 Enforcement API: service/command layer first, middleware second

Package: `packages/authz` (shared types + catalog + evaluator), `apps/api/src/authz/*`, `apps/api/src/commands/*`.

**Hard requirement: every permission check must be callable outside Express.** Today all logic sits in route handlers, which take `req`/`res`. The target layers are:

```
 Express routes ─┐
 AI tool layer ──┤
 Public REST/OAuth┤──►  Command layer  executeCommand(principal, "payments.refund", input, opts)
 MCP server ─────┤        1. validate input (zod, shared schema)
 Webhooks/jobs ──┘        2. load record(s) + derive context {locationId, amountCents, periodClosed…}
                          3. authorize(principal, action, ctx)  ← packages/authz (pure, no req/res)
                          4. ALLOW → run in tenant tx (SET LOCAL app.tenant_id …) → audit → emit event
                             REQUIRE_APPROVAL → create/consume ApprovalRequest
                             DENY → typed ForbiddenError {permission, reason}
```

```ts
// packages/authz — transport-agnostic
export interface Principal { kind: "staff"|"customer"|"api_client"|"platform"|"system"|"service";
  tenantId: string; id: string; delegation?: Delegation; deviceId?: string; mfaAt?: Date; sessionId?: string }
export interface Delegation { via: "ai_assistant"|"mcp"|"oauth_app"|"background_agent"; agentRunId: string;
  onBehalfOf?: string /* membershipId */; confirmation?: { kind: "per_action"|"plan"; at: Date; actionHash: string } }

export function authorize(p: Principal, action: PermissionKey, ctx: AuthzContext): Promise<Decision>;
export type Decision =
  | { effect: "ALLOW"; obligations: Obligations }
  | { effect: "REQUIRE_APPROVAL"; policyId: string; approverPermission: PermissionKey }
  | { effect: "REQUIRE_CONFIRMATION"; reason: "ai_policy"|"risk"; summary: string }   // AI channel only
  | { effect: "DENY"; reason: string };

// apps/api/src/commands — one file per business action, used by every transport
export const refundPayment = defineCommand({
  key: "payments.refund",
  input: RefundInput,                                    // zod, also exported as JSON Schema for AI/MCP tools
  risk: "HIGH",
  context: async (input, db) => { const p = await db.payment.findUniqueOrThrow({ where: { id: input.paymentId } });
                                  return { locationId: p.locationId, amountCents: input.amountCents ?? p.amountCents, record: p }; },
  run: async (input, ctx, db) => { /* Stripe refund, GL reversal, refundedCents += … */ },
  audit: (input, result) => ({ recordType: "Payment", recordId: input.paymentId, action: "REFUNDED" }),
});
```

- **Express** becomes a thin adapter: `router.post("/:id/refund", http(refundPayment, req => ({ paymentId: req.params.id, ...req.body })))`.
- **AI tools / MCP / public API** register the *same* command objects. The tool schema is generated from `input`, and the tool's description includes `key` and `risk`. A model can't call a tool that skips `authorize()`, because the only tools exposed are commands.
- **Reads** use query objects (`defineQuery`) that apply `locationFilter()` and `shape()` field masks the same way. NL data questions (AI) are answered **only** through these query objects or a permission-aware semantic layer. Raw SQL from a model is never run against the primary DB.
- **CI contract tests:** for every command, the same role × action matrix runs through the HTTP adapter **and** the tool adapter, and must produce identical decisions.

The Express-facing sugar is kept for simple routes:

```ts
// Route declaration — static part (permission + how to find the location)
router.post(
  "/:id/void",
  requirePermission("invoices.void", {
    location: fromRecord("invoice", (req) => req.params.id),   // loads invoice.locationId (cached on req)
    attributes: async (req, rec) => ({ periodClosed: await isClosed(rec.issuedDate, rec.locationId) }),
  }),
  handler,
);

router.post(
  "/:id/refund",
  requirePermission("payments.refund", {
    location: fromRecord("payment", (r) => r.params.id),
    attributes: (req) => ({ amountCents: req.body.amountCents }),
    approval: "honor",       // honors Helm-Approval header; 409 approval_required otherwise
  }),
  handler,
);

router.get("/customers/:id", requirePermission("customers.view", { location: anyAssigned() }), async (req, res) => {
  const c = await repo.customer.get(req.params.id);
  res.json(shape("Customer", c, req.authz));      // field-level masking by obligations
});

// In-handler checks for data-dependent rules
await req.authz.assert("discounts.apply", { locationId, percent: 18 });   // throws ForbiddenError | ApprovalRequired
if (req.authz.can("inventory.cost.view", { locationId })) { … }

// List endpoints: location filter injected from effective scope
const where = { ...req.authz.locationFilter("slips.view") }; // { locationId: { in: [...] } } or {} for tenant-wide

// Public & webhook routes must be explicit
router.post("/webhooks/stripe", publicRoute({ reason: "stripe-signed" }), verifyStripe(), handler);
```

**Supporting pieces:**
- `authenticate()` resolves a **Principal** `{kind, tenantId, membershipId|customerAccountId|apiClientId|platformUserId, impersonation?, deviceId?, mfaAt, sessionId}` and runs `tenantStore.run(...)`. Every request has exactly one principal. Non-staff principals are rejected on staff routers automatically.
- `requirePermission` attaches `req.authz` (a `DecisionContext`), writes a DENY audit record on 403 (rate-limited) and sets `X-Helm-Authz-Version`.
- **Route coverage lint:** a boot-time check walks `app._router.stack` and fails startup (and CI) if any route lacks `requirePermission`, `publicRoute` or `webhookRoute` metadata. A generated `docs/api-permissions.md` matrix is a CI artifact.
- **Prisma guard:** the tenant extension becomes fail-closed. A tenant model queried without context throws unless inside `systemContext(jobName, fn)`, which also sets `actorType=SYSTEM` for auditing.
- **Response shaping:** `shape(type, record, authz)` uses a per-type field policy (`Customer.dlNumber: requires customers.pii.view_full, mask: last4`; `Product.costCents: requires inventory.cost.view, mask: omit`). Shaping happens server-side. Prisma `select` builders omit columns the caller can't see, so they're never loaded.

**Evaluation engine.** Use a hand-rolled evaluator over compiled bitsets: fast and simple to audit. Keep the option of **Cedar** (AWS, open-source, expressive and analysable) or **OpenFGA/SpiceDB** (Zanzibar-style relationships) if per-record sharing appears later (e.g. "this broker sees these 12 customers"). Don't adopt OPA/Rego for the hot path; Rego is harder for this team to own. For now, an internal policy evaluator with Cedar-compatible semantics is the pragmatic choice.

**Caching:**
- `compileEffective(membershipId)` → `{ authzVersion, tenantVersion, perLocation: Map<locationId, Bitset>, tenantWide: Bitset, limits, policies }`.
- L1: in-process LRU (TTL 60 s). L2: Redis key `authz:{tenantId}:{membershipId}:{authzVersion}:{tenantVersion}` (TTL 10 min).
- `Membership.authzVersion` is bumped on any assignment/override change. `Tenant.authzVersion` is bumped on role edits, policies or entitlements. Because the version is in the key, stale entries simply expire.
- Pub/sub `authz:invalidate` broadcasts to instances so L1 is purged immediately for revocations (deactivate, role removal).
- Never put permissions in the JWT. Clerk session claims carry `tenantId`, `membershipId` and `authzVersion` only, and revocation must not wait for token expiry.

### 3.8 Frontend gating

- `GET /api/me/access` returns:
  ```json
  { "authzVersion": 42, "principal": {"kind":"staff","membershipId":"…"},
    "locations": [{"id":"L1","name":"Main Marina"},{"id":"L2","name":"North Basin"}],
    "permissions": { "*": ["customers.view","reports.operational.view"], "L1": ["pos.refund","…"], "L2": ["…"] },
    "limits": { "L1": {"refund.max_cents":25000,"discount.max_percent":15} },
    "entitlements": {"rentals":true,"fuel":false,"bi_api":true},
    "fieldMasks": {"Customer":["dob","dlNumber"],"Product":["costCents"]},
    "session": {"idleTimeoutMin":5,"sharedDevice":true,"mfaFreshUntil":"…"} }
  ```
- React: `<AccessProvider>` with `useCan('pos.refund', { locationId })`, `<Can perm="reports.financial.view">…</Can>`, `useLimit('discount.max_percent')` (the discount input shows "max 15%, manager approval above"), and a route-level `requirePerm` on `<Route>`. A nav item shows only if its module is entitled **and** some permission in its module is held.
- `ModulesContext`/`localStorage` is replaced by `entitlements`.
- **Staleness:** the API echoes `X-Helm-Authz-Version`. If it's greater than the client's version, the client refetches `/me/access`. A 403 with `code: PERMISSION_DENIED` triggers a refetch once. Optionally, an SSE/WebSocket `access.changed` event is pushed on revocation.
- **Approval UX:** a shared `<ApprovalPrompt>` modal handles `409 approval_required` (PIN pad, or "send to manager").
- The **Roles editor** in Settings is generated from the catalog: grouped by module, with risk badges, dependency auto-checks, limit inputs, a "compare with template" diff, a "who has this permission?" reverse lookup, and a **"View as role"** preview (read-only impersonation of a role).

### 3.9 Sessions, devices, impersonation, break-glass

- **Session policy** (from `TenantSecurityPolicy`, enforced by API middleware using Clerk session `iat`/`lastActive`, not just the UI): idle 30 min back-office, 5 min on shared devices, 12 h absolute. **Step-up** re-authentication (WebAuthn/TOTP within `stepUpMaxAgeMin`) for CRITICAL permissions.
- **Shared devices (POS, dock tablets):** the device registers once (an owner/GM scans a QR code, which creates a `TrustedDevice` with a WebAuthn/device key). After that, staff **fast-switch with a 4–6 digit PIN** scoped to that device and location. Each PIN unlock creates a short-lived sub-session attributed to that membership. Lock on idle. PINs are useless off-device. This mirrors Toast/Square and is essential at the fuel dock.
- **Time/IP/geo:** `AccessPolicy` is evaluated at session start and per request. Enforcement modes are BLOCK, REQUIRE_APPROVAL (e.g. after-hours refund) or LOG_ONLY.
- **Impersonation (platform → tenant):**
  - Only `PlatformUser` (separate identity pool, SSO + hardware-key MFA) holding `platform.support.impersonate`.
  - It requires a ticket reference and a reason, plus an active `SupportAccessGrant` (the tenant owner clicks "Allow Helm support access for 72 h, read-only/full"), **unless break-glass**.
  - Default READ_ONLY. FULL needs the grant mode FULL.
  - Hard-blocked while impersonating, even in FULL: payout/bank changes, integrations, users/roles, security settings, PII export, API keys.
  - TTL 60 min; a persistent red banner in the UI; every request is audited with `impersonationSessionId`; the tenant owner gets a notification and a session report.
- **In-tenant "view as":** owners can preview a role's or a user's access read-only for troubleshooting (`users.impersonate.within_tenant`). It's audited and can never mutate.
- **Break-glass:**
  - **Platform:** two-person rule (a second platform admin approves). Allowed only for an incident (P1 sev) or a legal hold. Auto-pages security, max 4 h, mandatory post-incident review, and the tenant is notified within 72 h unless legally barred.
  - **Tenant:** a sealed emergency Owner credential (e.g. a recovery code printed at onboarding) for when SSO is down. Using it alerts all owners and forces a password/SSO review.

### 3.10 Migration from enum roles

| Step | What | Risk control |
|---|---|---|
| M0 (week 0–1) | Fix R-01…R-08 (P0/P1 quick wins). Typed `requireRole(UserRole…)`. Add gates on money/PII/destructive routes using the enum. | Ship behind tests: one authz test per route (`supertest` matrix role × route → expected status). |
| M1 | Land `packages/authz` catalog + `requirePermission`, backed by a **static enum→permissions map** (the template table above). Annotate all ~300 routes. Turn on the route-coverage lint. | No schema change yet; behaviour equals enum mapping. |
| M2 | Schema: `Identity`, `Membership`, `CustomerAccount`, `Role`, `RolePermission`, `RoleAssignment`, `PermissionOverride`, `PolicyLimit`, `TenantEntitlement`, `LocationGroup`, and `locationId` on core models (backfill a default `Location` per tenant). Seed templates. **Backfill:** each `User` → `Identity` (dedupe on `clerkUserId`) + `Membership(legacyRole)` + `RoleAssignment(template clone of legacyRole, scope TENANT)`. `PORTAL_USER` rows → `CustomerAccount` (match by email to `Customer`; unmatched rows queued for manual review), never a `Membership`. `PLATFORM_ADMIN` → `PlatformUser`. | Evaluator runs in **shadow mode**: compute both decisions and log mismatches for 2 weeks; enum stays authoritative. |
| M3 | Flip to DB-backed evaluator. Ship the Roles editor (clone/customize), per-user overrides, location-scoped assignments, limits, `/me/access` + UI gating. Drop `ModulesContext`. | Feature flag per tenant; kill-switch back to enum map. |
| M4 | Approvals + devices/PIN + access policies + session policies + step-up. | Pilot with 2–3 multi-location design partners. |
| M5 | Impersonation v2, break-glass, audit hash chain/streaming, SCIM role mapping (§4). Remove `User.role`/`UserRole` enum. | Data migration verified by count reconciliation. |
| Cross-cutting | **Command layer (§3.7)**: start in M1 by extracting money/PII routes into `commands/*`, so the AI assistant (doc 14) launches only on commands, never on route handlers. **RLS (§3.12)**: enable in M2 alongside the `tenantId` backfill on child tables, and **before** any AI data-query or MCP feature ships. **AI permissions/policy (§3.11)**: ship with the assistant's first write-capable release. Read-only assistant first, gated by `ai.assistant.use` + `ai.data.query`. | AI writes stay behind a flag until command-layer contract tests pass. |

### 3.11 AI assistant and agents

Companion to `14-agentic-ai-architecture.md`. This section defines the **authorization contract** that design must satisfy.

#### 3.11.1 Acting as the user

- An interactive assistant session runs as `Principal{kind:"staff", id: membershipId, delegation:{via:"ai_assistant", agentRunId}}`. Every tool call goes through `executeCommand` → `authorize` with that principal, the same location context, limits, approvals and field masks as the human clicking the button.
- **Effective AI permission = user's effective permissions ∩ AI channel ceiling ∩ tenant AI policy.** Intersection only, never union. The agent can never gain a permission the user lacks, a higher limit, or wider location scope.
- To use a business action via AI, the user needs both the business permission (e.g. `payments.refund`) **and** the AI capability (`ai.actions.execute`, plus `ai.bulk_*` where applicable).
- **Session constraints carry over.** If the user's session is expired, outside their time window, on an untrusted device or lacks fresh MFA, the agent's call fails the same way. Step-up MFA prompts surface in the chat UI. The agent can't satisfy them.
- **Approvals are never bypassed by AI.** `REQUIRE_APPROVAL` decisions create the same `ApprovalRequest` with `requestedBy = user` and `via = ai_assistant`. The agent can't approve anything, even if the user holds `approvals.*`: approval is a human act in the approval UI, with step-up for CRITICAL. The requester-≠-approver rule treats "user via AI" as the user.
- **Field masks apply before the model sees data.** Masked fields (DL#, DOB, cost/margin) are never placed in the model context. Unmasked PII sent to the model provider is minimised, and the AI sub-processor goes in the DPA (§4).

#### 3.11.2 Tenant AI policy (`TenantAiPolicy`)

| Setting | Default | Effect |
|---|---|---|
| `enabled` | true (Starter: read-only) | master switch |
| `maxAutoRisk` | `LOW` | highest command risk that may run without per-action confirmation, for users holding `ai.actions.auto_approve.*` |
| `confirmationMode` | `PER_ACTION` | `PER_ACTION` (confirm each write) or `PLAN` (confirm a reviewed multi-step plan with a diff; each step is still authorized separately) |
| `blockedActions` | `[settings.*, users.*, roles.manage, apikeys.manage, settings.payments.payout_account, gl.period.*, tenant.delete, customers.delete_erase]` | never available via AI regardless of role |
| `alwaysConfirm` | `[payments.refund, invoices.void, contracts.terminate, communications.send.*, data.export*]` | always need explicit confirmation, even at LOW risk |
| `aiApprovalThresholds` | inherit | optional **stricter** thresholds for AI-initiated actions (e.g. refund approval at $50 via AI vs $250 manual). Effective threshold = min(manual, AI). |
| `bulk.maxRecords` / `bulkComms.maxRecipients` | 25 / 0 | above this, needs `ai.bulk_*` + confirmation + preview sample; comms re-check consent (`CommunicationPreference`) and quiet hours |
| `rateLimits` | 60 writes/h/user, 500/day/tenant | velocity caps; breach pauses the agent and alerts the owner |
| `dataQuery.allowFinancial` | true | gate NL questions on financial data (still needs `reports.financial.view`) |
| `transcriptRetentionDays` | 90 | privacy; viewable by others only with `ai.transcripts.view_all` |
| `providers` / `residency` | Helm default | model provider/region allow-list (Enterprise) |

**Precedence:** tenant `blockedActions` > role/override DENY > AI policy ceiling > role permissions and limits > approval policies (AI thresholds tighter) > confirmation rules. Any layer can restrict. Only roles can grant.

**Risk tiers** come from the command definition (`risk`) and can be raised dynamically by context: amount over limit, bulk count, a record in a closed period, an external send. LOW examples: create customer, add boat, add note, draft invoice, book rental at list price, schedule a dock walk. MEDIUM: finalize/send an invoice, single customer SMS, check-in/out, apply a discount within limit. HIGH/CRITICAL: refunds, voids, write-offs, rate overrides, bulk comms, exports. These are never auto-approved.

#### 3.11.3 Confirmation, provenance, prompt-injection containment

- A **confirmation token** binds to `actionHash = sha256(command key + canonical input)`. It's single-use, expires in 5 min, and is issued by the UI after the human clicks "Confirm". The command layer verifies the hash, so a model can't confirm a different action than the one shown.
- **Untrusted content can't escalate.** Text from emails, lead-form submissions, documents, OCR'd insurance PDFs or customer messages is tagged as untrusted input. When the run's context contains untrusted content, auto-approve is disabled for that run (`maxAutoRisk` drops to NONE), and external sends require confirmation.
- **Audit**: every AI-originated action records `actorType=STAFF`, `via=ai_assistant`, `agentRunId`, `toolCallId`, `confirmationId`, and a model/provider version. Each action links to the transcript. Owners can filter the audit log by "performed by AI".
- **Kill switches:** per-user, per-tenant and platform-wide "pause AI actions". Also an automatic pause on anomaly (velocity, repeated DENYs, bulk spikes).

#### 3.11.4 Background agents = per-tenant service identities

Some agents run without a human in the loop: nightly collections reminders, insurance-expiry chasing, waitlist offers, dynamic-pricing suggestions, renewal batches. They run as **service identities**, never as a borrowed human session.

```prisma
model ServiceIdentity {
  id            String    @id @default(uuid())
  tenantId      String                       // always tenant-scoped; no cross-tenant agents
  name          String                       // "Collections reminder agent"
  kind          String                       // AI_AGENT | AUTOMATION | INTEGRATION
  ownerMembershipId String                   // accountable human; agent deactivates if owner loses ai.agents.manage
  status        String    @default("ACTIVE") // ACTIVE | PAUSED | DISABLED
  scopeType     ScopeType @default(TENANT)
  locationIds   String[]
  authzVersion  Int       @default(1)
  createdAt     DateTime  @default(now())
  assignments   ServiceRoleAssignment[]      // roles like humans, but templates restricted (no CRITICAL perms)
  @@index([tenantId])
}
model ServiceRoleAssignment { serviceIdentityId String; roleId String; locationId String?; @@id([serviceIdentityId, roleId]) }
model AgentRun {
  id String @id @default(uuid())
  tenantId String
  principalKind String        // staff | service
  principalId String
  trigger String              // chat | schedule | event
  status String               // RUNNING | WAITING_APPROVAL | DONE | FAILED | KILLED
  untrustedInput Boolean @default(false)
  startedAt DateTime @default(now())
  endedAt DateTime?
  actionsCount Int @default(0)
}
model TenantAiPolicy { tenantId String @id; config Json; version Int @default(1); updatedBy String; updatedAt DateTime @updatedAt }
```

- **Creation rules.** A service identity is created by someone holding `ai.agents.manage`. Its permissions must be ⊆ the creator's (no escalation) and can't include CRITICAL permissions or `blockedActions`. Default role templates for agents: "Reminder Agent" (read invoices/customers, `communications.send.individual` within consent), "Waitlist Agent", "Pricing Analyst" (`pricing.ai_suggestions` *create* only, never approve).
- **Credentials.** Short-lived tokens (≤15 min) minted by the job runner from a workload credential. No static API keys. Token claims: `{tenantId, serviceIdentityId, agentRunId}`. Runs execute inside `tenantStore.run` + RLS session settings for that tenant only.
- **Approvals.** Anything above the agent's limits, or any HIGH-risk action, is queued as an `ApprovalRequest` for humans with `ai.agents.approve_runs` / the relevant `approvals.*`. Background agents never auto-execute HIGH/CRITICAL.
- **Lifecycle.** When the owner membership is deactivated, or loses `ai.agents.manage`, the agent is **paused**. Agents appear in the Users screen with a distinct badge, last-run time and full audit.
- **Platform-level agents** (e.g. a Helm support/ops agent) are `PlatformUser`-class principals subject to §3.9 impersonation rules: tenant consent, read-only by default, and audited.

### 3.12 Postgres row-level security (defence in depth)

The Prisma extension is a convenience layer, not a security boundary. It's bypassed by raw SQL, nested writes, a forgotten model in the list, and by any future service, BI connector or AI query path. Add RLS so the **database** refuses cross-tenant rows.

1. **Roles.** The app connects as `helm_app` (NOBYPASSRLS, not table owner). Migrations run as `helm_owner`. Platform/admin jobs use `helm_platform` with `BYPASSRLS`, only from the admin service and audited. Read replicas/BI use `helm_readonly` (RLS enforced).
2. **Policies** on every tenant-bearing table (generated by a migration script from the DMMF, the same source as the Prisma list):
   ```sql
   ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
   ALTER TABLE invoices FORCE ROW LEVEL SECURITY;
   CREATE POLICY tenant_isolation ON invoices
     USING      ("tenantId" = current_setting('app.tenant_id', true)::uuid)
     WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)::uuid);
   ```
   Child tables without `tenantId` (`InvoiceLineItem`, `PosLineItem`, `DockWalkItem`, `PricingRule`, …) either get a denormalised `tenantId` column (preferred: simpler policies, better indexes) or an `EXISTS` policy through the parent.
3. **Setting the context.** Every request/command/agent run executes inside an interactive transaction that begins with `SELECT set_config('app.tenant_id', $1, true)`. Also set `app.principal_id`, `app.via` and `app.location_ids` for audit triggers and optional location policies. With PgBouncer in transaction mode, `set_config(..., true)` (transaction-local) is safe. Session-level `SET` is not. In Prisma, wrap via a `$extends` client that runs each operation in `$transaction([setConfig, op])`, or use a per-request tx. Benchmark the overhead (usually small); batching reads in one tx helps.
4. **Missing context fails closed.** `current_setting('app.tenant_id', true)` is NULL → no rows match → empty results and writes rejected.
5. **Optional location RLS** for the strictest tenants: `USING ("locationId" = ANY (string_to_array(current_setting('app.location_ids', true), ',')::uuid[]) OR current_setting('app.location_ids', true) = '*')`. Keep primary location enforcement in the authz layer (it needs per-permission nuance). RLS location policies are a backstop for read-heavy paths like AI data queries and BI.
6. **Tests.** A CI suite connects as `helm_app` with tenant A's context and asserts zero rows or a rejected write for tenant B on every table. It fails if any tenant table lacks `FORCE ROW LEVEL SECURITY`.
7. **Audit immutability** uses the same mechanism: `REVOKE UPDATE, DELETE ON audit_logs FROM helm_app`.

---

## 4. Enterprise security roadmap

Phases are cumulative. "Launch" = first paying single-site marinas. "Growth" = multi-location operators / mid-market. "Enterprise" = portfolio groups (e.g. Suntex/Safe Harbor-scale), private-equity owners, municipalities.

### Phase 0 — Stop-ship (≈2–3 weeks, before any real customer data)

| Item | Detail |
|---|---|
| Authz P0s | R-01…R-07 above, plus doc-07 P0s. |
| Secrets out of code | Remove the hard-coded impersonation secret (admin.ts:319) and the compose DB password. Secrets go in a managed secret store (AWS Secrets Manager / Doppler / Fly/Render secrets). Rotate anything that ever shipped. |
| Tokens encrypted | QBO access/refresh tokens, Twilio/e-sign keys and webhook secrets encrypted at the application layer (see Phase 1 envelope encryption; at minimum AES-256-GCM with a KMS-held key now). They're currently planned as plaintext `Tenant.qboAccessToken`. |
| Card data design lock | Card entry **only** via Stripe Payment Element/Checkout (web, portal, widgets) and **Stripe Terminal** (POS). No PAN/CVC fields, logs or proxies in Helm. ACH via Stripe Financial Connections (no raw account/routing numbers). |
| Backups | Managed Postgres with PITR enabled (7–14 days) and daily snapshots copied to a second region. |
| GitHub hygiene | Branch protection, required review, secret scanning + push protection, Dependabot alerts. |

### Phase 1 — Launch-ready (SMB GA; target 6–10 weeks after Phase 0)

| Domain | Deliverable |
|---|---|
| **Identity** | Clerk MFA (TOTP + WebAuthn/passkeys) **enforced** for Owner/GM/Bookkeeper and anyone with a CRITICAL permission; optional for others; tenant can require for all. Breached-password check, bot protection on sign-up, email verification. Make the help-centre MFA claim true. |
| **Authorization** | M1–M3 of §3.10: permission catalog, templates, custom roles, location scope, `/me/access`. |
| **Sessions** | Server-enforced idle/absolute timeouts. Revoke sessions on deactivate/role downgrade. Shared-device PIN mode for POS/fuel. Fix the service-worker cache (R-16). |
| **Audit log** | Central `audit()`, append-only, covering auth events (login, MFA change, failed login), access changes, money actions, exports, settings and integrations. In-app viewer + CSV export (permissioned). |
| **API keys v1** | Named, prefixed (`helm_live_…`), hashed with a pepper, scoped (§3.4), expiring (default 1 y), shown once, rotate with overlap grace (7 d), last-used tracking, revocation UI. |
| **Encryption** | TLS 1.2+ everywhere, HSTS. At rest: cloud-provider volume/DB encryption (baseline). **Envelope encryption** for secrets/tokens: per-tenant data key (DEK) wrapped by a KMS key (AWS KMS/GCP KMS), cached in memory, with rotation that rewraps DEKs yearly. |
| **Field-level PII encryption** | `Customer.dlNumber`, `dob`, `emergencyContactJson`, insurance policy numbers, DL photo objects. App-layer AES-GCM with per-tenant DEKs. Blind index (HMAC) for exact-match search on DL#. Masking via `shape()`. DL photos in a private bucket with SSE-KMS and ≤5 min presigned URLs. |
| **Rate limiting / abuse** | Per-IP and per-principal limits (Redis token bucket) on auth, public widgets, onboarding, exports and the BI API. CAPTCHA (Turnstile) on public forms and sign-up. CDN/WAF (Cloudflare or AWS WAF) with managed rules and bot management on public endpoints. |
| **AppSec pipeline** | Dependabot (or Renovate) + `pnpm audit` gate; **SAST** via GitHub CodeQL (free for public, GHAS for private) or Semgrep CI with the TS/Express rules plus custom rules ("route without requirePermission", "prisma query on tenant model in systemContext"); secret scanning (GitHub push protection + gitleaks pre-commit); container scan (Trivy) on images; IaC scan (Checkov) if Terraform. Snyk is a reasonable all-in-one alternative if budget allows. |
| **PCI DSS** | Target **SAQ A** for Helm's card-not-present flows: all card fields in Stripe-hosted iframes/redirect, with the merchant-of-record being each marina's Stripe Connect account. Card-present via Stripe Terminal readers (data encrypted in the reader; Helm never sees PAN). Keep the payment pages' script inventory minimal and integrity-controlled, because PCI DSS v4 requirements 6.4.3/11.6.1 (or the SAQ A eligibility criterion that replaced them) concern scripts on payment pages. Public widgets that embed payment should render the **Stripe Payment Element inside a Helm-hosted iframe**, or redirect to Stripe Checkout, so a marina's own website isn't pulled into SAQ A-EP. Any design where Helm JS builds or posts card data pushes Helm toward **SAQ A-EP**: avoid it. As a platform, Helm is a *service provider* to marinas, so confirm the right SAQ/AOC (often SAQ D-Service Provider scoped very narrowly, or a documented "no CHD" attestation) with a QSA once volume warrants. Provide marinas a PCI responsibility matrix. |
| **Vulnerability disclosure** | `/.well-known/security.txt`, `security@` alias, a public VDP page (safe harbor, scope, SLA: acknowledge in 3 business days). |
| **Incident response** | Written IR plan (roles, severity matrix, comms templates, customer notification within 72 h per GDPR / state breach laws), on-call rotation (PagerDuty/Opsgenie), quarterly tabletop. |
| **Status page** | Hosted (Instatus/Atlassian Statuspage/Better Stack) with component-level status (API, Payments, POS sync, Portal, Integrations) and email/SMS subscription. |
| **Backups/DR** | **RPO ≤ 15 min, RTO ≤ 4 h** for launch. PITR + cross-region snapshot copies + object storage versioning and replication. Restore drill quarterly, documented. |
| **Tenant isolation v2** | Postgres RLS with `FORCE ROW LEVEL SECURITY` on all tenant tables, `helm_app` NOBYPASSRLS role, transaction-local `app.tenant_id` (§3.12), cross-tenant CI suite. |
| **AI governance (if the assistant launches)** | Command-layer-only tools, AI permissions + tenant AI policy, confirmation tokens, AI audit attribution, kill switches, per-tenant service identities for background agents (§3.11). Add the AI model provider to the sub-processor list, with a no-training/zero-retention agreement. |
| **Privacy basics** | Privacy policy, DPA template (marina = controller, Helm = processor), sub-processor list (Clerk, Stripe, Twilio, AWS, QBO/Intuit, e-sign, OCR/AI vendors), tenant self-serve **data export** (full ZIP: CSV/JSON + files), customer-level access/erasure workflow (`customers.delete_erase` with retention exceptions for financial records). |

### Phase 2 — Growth / mid-market (≈ quarter after launch)

| Domain | Deliverable |
|---|---|
| **Authorization** | M4: approvals and dual control, devices, time/IP policies, step-up, in-tenant "view as", impersonation v2 with customer consent. |
| **SOC 2 Type I** | Adopt **Vanta or Drata** (both integrate with AWS/GCP, GitHub, Clerk/Okta, HRIS, MDM). Write policies (InfoSec, Access Control, Change Mgmt, Vendor Mgmt, BC/DR, IR, Data Classification/Retention). Employee MDM, background checks, security training. Pick an auditor (e.g. Prescient, Johanson, A-LIGN; boutique firms are cheaper). Type I is a point-in-time audit, typically 2–4 months from kickoff. Trust Services Criteria: Security plus **Availability** and **Confidentiality**; add Processing Integrity later given the financial ledger. |
| **Pen test** | Third-party application pen test (authenticated, multi-tenant and authz focus, including IDOR across tenants/locations, payment flows and the POS offline queue) before the SOC 2 Type I report. Then annually and after major changes. Share a summary letter with prospects. |
| **Logging & SIEM export** | Structured JSON logs with request/principal/tenant IDs to a central store (Datadog/Better Stack/Grafana Loki). Security alerting: impossible travel, refund spikes, mass export, repeated 403s, key used from a new IP. **Tenant audit streaming**: webhook/S3/Splunk HEC/Datadog destinations for enterprise customers (an Enterprise SKU feature). |
| **Webhooks & integrations** | Outbound webhooks signed with HMAC + timestamp (replay window), per-endpoint secrets with rotation. Inbound webhooks verified over the raw body (Stripe, Svix/Clerk, Intuit, e-sign). |
| **Data lifecycle** | Retention schedule (financial 7 y, PII minimised after the relationship ends + N years configurable, DL images purged after verification if not needed). Tenant **offboarding**: export → 30-day grace → crypto-shred (destroy the tenant DEK) → backup expiry ≤ 35 days, then a deletion certificate. |
| **Uptime SLA** | Internal SLO 99.9% monthly for API/portal. Publish a 99.9% SLA with service credits for paid tiers once 2 quarters of data support it. Multi-AZ DB, zero-downtime deploys, POS offline mode as a resilience feature. |
| **Vendor risk** | Sub-processor reviews (SOC 2 reports for Clerk, Stripe, Twilio, cloud), DPAs signed with each. |

### Phase 3 — Enterprise-ready (≈ 6–12 months after launch)

| Domain | Deliverable |
|---|---|
| **SSO** | SAML 2.0 + OIDC per tenant, with domain verification, JIT provisioning, IdP-initiated + SP-initiated login, and **SSO enforcement** (password login disabled for the domain, break-glass owner excepted). Option A: **Clerk Enterprise SSO** (stays on one vendor; check the per-connection pricing and that the needed IdPs are supported). Option B: **WorkOS** (SSO + Directory Sync + Admin Portal for customer self-setup; mature SCIM; per-connection pricing) alongside or instead of Clerk for enterprise tenants. Recommendation: keep Clerk for SMB auth. Add WorkOS **only if** Clerk's SCIM/directory-sync support doesn't meet requirements at the time (verify current Clerk capabilities). Avoid running two session systems unless necessary. |
| **SCIM 2.0** | Users/Groups provisioning & de-provisioning (Okta, Entra ID, Google). IdP **group → Helm role + location** mapping (`ScimGroupMapping {tenantId, externalGroupId, roleId, scopeType, locationId}`). Deprovisioning revokes sessions within 1 min. Manual role edits are blocked for SCIM-managed users when the tenant chooses "IdP is source of truth". |
| **SOC 2 Type II** | Observation window of 3–6 months for the first report (12 months thereafter), starting right after Type I, so the report lands ~9–12 months after Vanta/Drata kickoff. Continuous control monitoring stays in Vanta/Drata. |
| **OAuth for third-party apps** | OAuth 2.1 authorization-code + PKCE. App registration (`OAuthApp {tenantScope, redirectUris, scopes}`), consent screen listing scopes, refresh-token rotation with reuse detection, per-app rate limits, tenant admin can revoke, marketplace review process. Replaces customers sharing API keys with integrators. |
| **Data residency** | Region-pinned tenants (US default; Canada and EU/UK as the first non-US regions, given Canadian marinas). Requires a per-region DB/storage/queue stack, a region-aware routing layer (subdomain → region), region-scoped sub-processors and backups. Design tenant→region routing now (a `Tenant.region` column) even if only US exists. |
| **Customer-managed keys (optional)** | BYOK via the customer's KMS key wrapping their tenant DEKs. Only for the largest accounts. |
| **Bug bounty** | Upgrade the VDP to a private then public program (HackerOne/Bugcrowd/Intigriti) once triage capacity exists. |
| **Advanced** | RLS location policies for the strictest tenants (tenant RLS itself ships in Phase 1). Per-tenant encryption contexts. Anomaly detection on financial actions (refund/discount patterns per staff, a known fraud vector in POS). Annual DR failover test across regions (enterprise **RPO ≤ 5 min, RTO ≤ 1 h**). ISO 27001 if selling to EU/UK enterprises. Security questionnaire library (SIG Lite/CAIQ) and a public **Trust Center** (Vanta/Drata/SafeBase). |

### Roadmap at a glance

```
Phase 0  Stop-ship        R-01..R-08 · secrets · token encryption · Stripe-only card capture · PITR · GH secret scanning
Phase 1  Launch-ready     Permissions v1 (catalog, templates, custom roles, locations) · MFA enforcement · sessions/shared devices
                          audit log · scoped API keys · Postgres RLS · command layer + AI permissions/policy · envelope + field-level encryption · WAF/rate limits · SAST/SCA/secret scan
                          SAQ A · VDP · IR plan · status page · RPO15m/RTO4h · DPA/export
Phase 2  Growth           approvals/dual control · time/IP/device · impersonation v2 · SOC 2 Type I (Vanta/Drata) · pen test
                          SIEM/audit streaming · signed webhooks · retention & crypto-shred offboarding · 99.9% SLA
Phase 3  Enterprise       SSO (SAML/OIDC) + enforcement · SCIM + group→role/location mapping · SOC 2 Type II · OAuth apps
                          data residency (CA/EU) · BYOK · bug bounty · location RLS · RPO5m/RTO1h · Trust Center
```

### Packaging suggestion

| Capability | Starter | Pro (multi-location) | Enterprise |
|---|---|---|---|
| Template roles | ✔ | ✔ | ✔ |
| Custom roles, per-user overrides, limits | edit limits only | ✔ | ✔ |
| Location groups / portfolio roles | — | ✔ | ✔ |
| Approval workflows | defaults | ✔ custom | ✔ + SoD rules |
| Time/IP/device policies | device PIN | ✔ | ✔ |
| Audit log | 90 d in-app | 1 y + export | 7 y + streaming to SIEM |
| SSO / SCIM | — | — | ✔ |
| API keys / OAuth apps | 1 key | scoped keys | OAuth apps + IP allow-lists |
| Data residency, BYOK, custom DPA, SLA credits | — | — | ✔ |

---

## 5. Immediate next actions (ordered)

1. Set `NODE_ENV=production` in `Dockerfile.api`; make the dev bypass opt-in and refuse to boot it in prod (R-01).
2. Lock down `/api/onboarding/:tenantId/*` and the OAuth `state` handling (R-03); delete `POST /api/tenants`; replace `GET /api/tenants/:id` with `/current` (R-14).
3. Fix the BI API tenant context and enforce key↔host tenant equality (R-04); trim PII from the BI responses.
4. Add `active` to `clerkAuth`; block `PORTAL_USER` (and anything non-staff) from staff routers (R-05, R-08).
5. Typed `requireRole`, remap the 12 lowercase checks, and gate refunds/voids/payments/POS overrides/deletes/exports/settings with enum roles as an interim (R-02, R-06, R-07).
6. Cumulative refund accounting + server-side POS pricing (R-06, R-07).
7. Extract money/PII actions into a `commands/*` layer with `authorize()` callable without Express, so the AI assistant (doc 14), MCP and the public API reuse it (§3.7, §3.11). Enable Postgres RLS (§3.12) before any AI data access.
8. Write the route-by-role authz test matrix; it becomes the regression suite for the permission-system migration.
9. Start §3.10 M1 (catalog + `requirePermission` over a static map) and the route-coverage lint.
