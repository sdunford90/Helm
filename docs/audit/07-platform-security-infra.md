# 07 — Platform, Security & Infrastructure Audit

Scope: authN/authZ, multi-tenant isolation, API and webhook security, secrets, PCI and PII, jobs, CI/CD, Docker, migrations, observability, test health and code health.
Branch: `claude/helm-marina-platform-8Io6M` @ `c2c9124`. Date: 2026-10-26.
Method: I read the code, ran install, typecheck, tests, `db push` and seed, and **ran the API against a local Postgres 16 and probed it live**. Findings marked **[VERIFIED LIVE]** were reproduced with curl against a running server.

Severity: **P0** = launch blocker, **P1** = must fix before paying customers or at scale, **P2** = hardening. Effort: **S** < 1 day, **M** 1–5 days, **L** > 1 week.

---

## 0. Executive summary

The platform is **not deployable, and it is not safe to expose to the internet in its current state**. Five problems drive that verdict:

1. **Auth fails open.** `clerkAuth()` skips authentication completely whenever `NODE_ENV !== "production"`. Nothing in the Dockerfile, compose, `.env.example` (`NODE_ENV="development"`) or Replit config sets production. Any deployment made the way the repo describes runs **with no authentication**. [VERIFIED LIVE: unauthenticated `GET /api/customers` and `GET /api/payments` return full PII and financial rows.]
2. **Cross-tenant data leak through the BI API, even in production mode.** The Prisma tenant extension overwrites the API key's `tenantId` with the tenant resolved from the `Host` header. A key from tenant A plus `Host: victim.gethelm.com` returns the victim's customers, invoices, payments and contracts. [VERIFIED LIVE with `NODE_ENV=production`.]
3. **RBAC is broken in both directions.** About 20 `requireRole("admin"|"manager"|"accounting")` checks can never match the schema's enum roles (`MARINA_OWNER`…), so those routes 403 for everyone. Meanwhile ~85% of routes (payments, refunds, invoice void, POS refund, customers, contracts) have **no role check at all**, so a `DOCK_STAFF`, `POS_CASHIER` or `PORTAL_USER` can refund money. `requirePlatformAdmin` queries a non-existent column (`clerk_id`), so the whole admin API returns 500.
4. **Unauthenticated tenant-mutation endpoints.** `/api/onboarding/*` (the Stripe Connect OAuth callback included) and `POST /api/tenants` have no auth and do no OAuth `state` validation. Today they crash because they use snake_case field names that don't exist. Once someone fixes the field names, anyone can attach their own Stripe account to any tenant, which diverts that marina's payments.
5. **Nothing builds or ships.** API `tsc` has 444 errors and web has 588. CI runs `npm ci`, but there is no `package-lock.json`, so every job fails at install. The Dockerfiles `COPY package-lock.json tsconfig.json` (neither exists) and use invalid `2>/dev/null || true` syntax in `COPY`. The deploy workflow pushes images to GHCR but deploys them nowhere. `.replit` deploys only the static web app. There is no Stripe webhook endpoint, no migration history, no workers process, and Sentry is never initialised.

Bottom line: before go-to-market, budget roughly **3–5 engineer-weeks of platform/security work** (Section 11) on top of feature completion.

---

## 1. Architecture summary

### 1.1 Tenancy model — **incoherent; three different models coexist in the code**
| Where | Model implied |
|---|---|
| `apps/api/prisma/schema.prisma`, `lib/prisma.ts` | **Shared DB, shared schema, row-level `tenantId`**, auto-scoped by a Prisma `$extends` query hook driven by `AsyncLocalStorage` (`tenantStore`). This is the model the running code actually uses. |
| `routes/onboarding.ts:74-75` | Creates a **Postgres schema per tenant** (`CREATE SCHEMA tenant_<uuid_with_underscores>`) via `$executeRawUnsafe`, then never uses it. |
| `tools/migrate-all.ts:124` | **Schema-per-tenant** migration runner: it runs `prisma migrate deploy` with `?schema=tenant_<uuid-with-hyphens>`. The naming differs from onboarding, and there is no `prisma/migrations` dir, so it migrates nothing. `.env.example` also has `NEON_API_KEY`, which hints at a DB-per-tenant plan. |
| `replit.md` | "use `prisma db push` (not migrations)". |

**Recommendation:** formally adopt shared-schema with row-level `tenantId`. Delete `tools/migrate-all.ts` and the `CREATE SCHEMA` call. Back the app-layer scoping with **Postgres Row-Level Security** (a `SET app.tenant_id` per transaction) as defence in depth.

### 1.2 Auth model
- Staff auth is **Clerk** (`@clerk/express@1.7.77` `requireAuth()` + `getAuth()`). An internal `users` row (`clerkUserId`, `tenantId`, `role` enum) links a Clerk user to one tenant. A user can belong to several tenants (one row per tenant).
- Tenant resolution comes from the **`Host` header**: the subdomain (first label when there are 3 or more labels) or `customDomain`. Every user lookup is `{clerkUserId, tenantId: req.tenantId}`.
- Platform admin: `requirePlatformAdmin()` (broken, see A-3).
- Machine access: BI API keys (`ApiKey.keyHash` = sha256 of `helm_…`).
- Boater/portal auth: **none**. `apps/portal` is 100% mock data. The `PORTAL_USER` role exists, but no portal-scoped API does.
- Widgets: send `x-helm-tenant-id`, which the server **ignores**. They call staff-authenticated endpoints (`/api/rentals/reservations`, `/api/transient`), so they cannot work.
- User provisioning: the Clerk webhook only creates users when `public_metadata.tenant_id` is set, and **no code ever sets it**. Team "invite" creates a `users` row with `clerkUserId = null`, which can never log in. In practice, **seeded users are the only users who can ever authenticate**.

### 1.3 Deployment model — **undefined**
- `.replit` `deploymentTarget = "static"` deploys only `apps/web/dist`. No API, workers, DB migration or Redis.
- `docker-compose.yml` defines postgres, redis, api, web and worker. The images don't build (Section 9), and the `worker` runs `dist/jobs/renewal-job.js`, a module that only exports functions, so it exits immediately and restart-loops.
- `deploy.yml` builds and pushes to GHCR, but has **no deploy step** (no target, no migration, no environment, no secrets).
- There is no IaC, no environment separation (staging/prod), no domain/TLS/wildcard-subdomain plan, and no custom-domain certificate story. Host-based tenancy requires wildcard DNS and TLS plus on-demand certificates for custom domains.

---

## 2. Build / typecheck / test results (actual numbers)

### 2.1 Commands that worked
```bash
cd /home/user/Helm
PUPPETEER_SKIP_DOWNLOAD=1 npx -y pnpm@9 install          # OK, 13.6s (pnpm 9.15.9)
(cd packages/shared-types && npx tsc)                     # OK
(cd packages/ui-kit && npx tsc)                           # OK
(cd apps/api && npx prisma generate)                      # OK (Prisma 6.19.2)
for a in api web portal admin widgets; do (cd apps/$a && npx tsc --noEmit -p .); done
(cd apps/api && npx vitest run)
# Local DB (as root, postgres binaries need a non-root owner):
P=/usr/lib/postgresql/16/bin; D=<scratch>/pg
chown -R postgres $D; su -s /bin/bash postgres -c "$P/initdb -D $D/data -U helm --auth=trust && $P/pg_ctl -D $D/data -o '-p 5433 -k $D' -l $D/log start"
$P/createdb -h 127.0.0.1 -p 5433 -U helm helm
export DATABASE_URL="postgresql://helm@127.0.0.1:5433/helm?schema=public"
(cd apps/api && npx prisma db push --skip-generate && npx prisma db seed)   # both OK
(cd apps/api && API_PORT=3101 npx tsx src/index.ts)                         # boots; used for live probes
(cd apps/<app> && npx vite build)                                           # web/portal/admin/widgets bundle OK (no typecheck)
```

### 2.2 Typecheck (`tsc --noEmit -p`)
| App | Errors | Top categories / root causes |
|---|---|---|
| **api** | **444** | TS2322 ×178 (mostly `string \| string[]` → `string`: **`@types/express@5` installed against `express@4`**, which accounts for ~347 of the errors); TS2339 ×116 / TS2551 ×31 / TS2353 ×37 / TS2561 ×13: **code doesn't match the Prisma schema** (missing models `emailTemplate`, `automationRule`, `emailAutomationLog`, `contract`, `processed_webhooks`, `gLAccount`; snake_case fields `tenant_id`, `first_name`, `stripe_account_id`, `fiscal_year_end`; `Tenant.active` doesn't exist; role `"platform_admin"` vs enum `PLATFORM_ADMIN`); TS18047 null-safety ×25; `Sentry.expressRequestHandler` doesn't exist in Sentry v8. Worst files: rentals.ts 110, reports.ts 40, customers.ts 34, pos.ts 26, email-automation.ts 21. |
| **web** | **588** | TS2339 ×423, almost all `.value`/`.style`/`.checked` on `EventTarget`: **`tsconfig.base.json` has `lib: ["ES2022"]` with no `DOM`**. TS2812 ×46 (same cause). TS2304 ×37 missing names/imports. The `paths` in `apps/web/tsconfig.json` point to `../../../packages/...` (one level too many). |
| portal | 10 | missing `vite/client` types (`import.meta.env`), missing `Megaphone` import, style-fn misuse in Messages.tsx |
| admin | 1 | TS6306: `tsconfig.node.json` lacks `composite: true` (so `tsc` aborts before checking anything) |
| widgets | 2 | unused vars (`noUnusedLocals`) |
| tools | 0 | — |

Consequence: every `build` script (`tsc && vite build`, and API `tsc`) **fails**, so `turbo build`, CI, Docker and the Replit deploy (`pnpm --filter @helm/web build`) all fail. Vite alone bundles fine, because it doesn't typecheck.

### 2.3 Tests (`apps/api`, vitest 2.1.9)
**22 files: 8 passed, 14 failed. 139 tests: 88 passed, 51 failed, plus 11 unhandled errors. 37.8s.**

Failure causes:
- **`src/index.ts:107` calls `app.listen()` at import time**, giving `EADDRINUSE :3001` ×11 when test files run in parallel. Fix: export `app` and listen in a separate `server.ts`.
- **Missing test factories** in `tests/helpers.ts` (`buildInsuranceRecord`, `buildTenant`, `buildRentalProduct`, `buildRampTicket`, `buildAuditLogEntry`, `buildAnnouncement`, `buildShift`, `buildDockWalk`, …, about 20 functions). The tests were written against helpers that were never committed.
- `vi.mock` of `gl-posting.js` omits `postManualJournalEntry`; mock prisma lacks some delegates (`Cannot read properties of undefined (reading 'mockResolvedValue')`).
- **concierge/transient tests time out (30s)** because of the real bug A-5 (`clerkAuth` passed un-invoked, so the request hangs forever).
- compliance/gl-posting service tests 100% fail.

**Structural problem:** `tests/setup.ts` mocks **both Prisma and auth**. `requireRole` is mocked to always pass and `tenantStore.run` is a no-op. So the suite **cannot detect any authZ, RBAC or tenant-isolation bug**. All the P0s in this report pass the test suite. There are no integration tests against a real DB, no frontend tests, and CI runs tests with `continue-on-error: true`.

### 2.4 DB
`prisma db push` and `prisma db seed` **both succeed** on a clean Postgres 16 (1 tenant "Bayshore Marina" / subdomain `bayshore`, 6 users, 20 slips, 15 customers, 42 invoices, 37 payments, …). There is **no `prisma/migrations` directory**, so there is no migration history (see I-1). `packages/database` is an empty shell: its `main: src/index.ts` doesn't exist, it has no schema, and its `db:*` scripts would fail.

---

## 3. Route security table

Legend: Auth = how `clerkAuth` is applied; Role = RBAC present; Zod = request validation present (✓ most handlers / ◐ some / ✗ none).
"Role broken" = uses lowercase `admin`/`manager`/`accounting`, which never matches the `UserRole` enum, so it **always 403s in production** (and in dev unless the DB has no users).

| Mount | File | Auth | Role checks | Zod | Public / notes |
|---|---|---|---|---|---|
| `/api/health` | health.ts | none | – | – | Public. Liveness only; no DB/Redis check. |
| `/api/auth` | auth.ts | per-route `...clerkAuth()` | none | ◐ | `POST /webhook` public (svix). `/sync-session`, `/me`, `/switch-tenant`. |
| `/api/tenants` | tenants.ts | per-route; **`POST /` has none** | `requireRole("admin")` **broken** | ✓ | **`POST /` unauthenticated tenant creation.** `GET /:id` returns **any** tenant by id (cross-tenant). |
| `/api/onboarding` | onboarding.ts | **none (bypasses tenant mw too)** | none | ◐ | **Entire router public**: branding, Stripe/QBO OAuth start + callback, chart-of-accounts, status for *any* `:tenantId`. |
| `/api/admin` | admin.ts | `requirePlatformAdmin()` **broken (500)** | platform | ✗ none | 23 routes, zero zod; impersonation with a hard-coded fallback secret. |
| `/api/slips` | slips.ts | router.use | **none** | ✓ | |
| `/api/customers` | customers.ts | router.use | **none** | ✓ | |
| `/api/invoices` | invoices.ts | router.use | **none** (void/finalize/send open to all roles) | ◐ | |
| `/api/payments` | payments.ts | router.use | **none** (refund open to all roles) | ✓ | No Stripe idempotency keys. |
| `/api/leads` | leads.ts | router.use | none | ✓ | |
| `/api/lead-forms` | lead-forms.ts | `authedRouter` mounted at `/` **before** the public route | none | ✓ | Intended-public `POST /:embedKey/submit` is **shadowed by auth** (302 in prod). reCAPTCHA fails open. |
| `/api/waitlist` | waitlist.ts | router.use | none | ✓ | |
| `/api/boats` | boats.ts | router.use | none | ✓ | |
| `/api/dock-walks` | dock-walks.ts | router.use | none | ✓ | |
| `/api/pos` | pos.ts | router.use | **none** (refund, product delete, shift close) | ✓ | |
| `/api/rentals` | rentals.ts | router.use | none | ✓ | Widget calls `POST /reservations`, which is auth-gated. |
| `/api/reports` | reports.ts | router.use | **broken** (`admin,manager,accounting`) | ✗ (40 routes, no zod) | Entire reports module 403s in prod. |
| `/api/announcements` | announcements.ts | router.use | none | ✓ | Mass email/SMS by any role. |
| `/api/contracts` | contracts.ts | router.use (line 163) | none | ✓ | `POST /esign-webhook` sits behind staff auth, and looks up the contract **without a tenant filter** (cross-tenant). |
| `/api/settings` | settings.ts | per-route | ✓ enum roles (correct) | ✓ | The only router with correct RBAC. Manager can invite an `MARINA_OWNER` (escalation). |
| `/api/transient` | transient.ts | **`clerkAuth` passed un-invoked**, so requests **hang forever** | none | ✓ | Widget target. |
| `/api/ramp` | ramp.ts | **un-invoked**, hangs | none | ✓ | |
| `/api/concierge` | concierge.ts | **un-invoked**, hangs | none | ✓ | `PATCH /vendors/:id` cross-tenant (no tenant filter). |
| `/api/audit-log` | audit-log.ts | router.use | **broken** | ✓ | Unreachable in prod. |
| `/api/bi` | bi-api.ts | API key (own middleware) | scope stored, never enforced | ✓ | **Cross-tenant via Host header** (T-1). No rate limit. |
| `/api/insurance` | insurance.ts | router.use | **broken** on 3 routes | ✓ | |
| `/api/fuel` | fuel.ts | router.use | **broken** on 3 routes | ✓ | |
| `/api/qbo` | qbo.ts | router.use + **broken** role | broken | ◐ | `POST /webhook` (Intuit) sits behind staff auth, so it's unreachable. Signature check fails open when env unset. |
| `/api/storage` | storage.ts | router.use | none (any role can delete any tenant file) | ✓ | Key-prefix check OK. |
| `/api/inventory` | inventory.ts | router.use | none | ✓ | |
| `/api/communication-prefs` | communication-prefs.ts | per-route `clerkAuth()` | none | ✓ | Customer ownership verified. |
| *(not mounted)* | email-automation.ts | – | – | – | **Router is never mounted in index.ts.** Dead code. |
| *(missing)* | — | — | — | — | **No Stripe webhook endpoint exists at all.** |

Global middleware (`index.ts:53-59`): `cors()` with **no origin restriction** (verified `Access-Control-Allow-Origin: *`), `helmet()`, `express.json()` (default 100 kB limit, verified 413), tenant middleware. Not present: **no rate limiting**, no `trust proxy`, no request logging, no request IDs, no `clerkMiddleware()`, no Sentry, no graceful shutdown.

---

## 4. AuthN / AuthZ findings

| ID | File:line | Issue | Exploit / failure | Fix | Sev | Eff |
|---|---|---|---|---|---|---|
| **A-1** | `middleware/auth.ts:34-53` | Dev bypass: when `NODE_ENV !== "production"`, no token check. The request runs as the **first user of the Host-resolved tenant** (role = whatever that user is), or as `"dev-user"`/`"admin"` if the tenant has no users. | Docker/compose/Replit never set `NODE_ENV=production`, and `.env.example` sets `development`. **Any deploy is fully unauthenticated.** [VERIFIED LIVE: `curl /api/customers` returns 15 customers with emails, phones and addresses; `/api/payments` returns payment rows; `/api/auth/me` returns user "Lisa Chen (ACCOUNTING)".] Combined with the tenant fallback (T-4) and Host-header selection, an attacker can choose any tenant. | Invert it so the bypass requires an explicit `AUTH_DEV_BYPASS=true` **and** `NODE_ENV==="development"`. Refuse to boot if the bypass flag is set while `CLERK_SECRET_KEY` is a live key. Set `ENV NODE_ENV=production` in Dockerfile.api. Add a startup assertion of required env vars (zod-validated config). | **P0** | S |
| **A-2** | all `requireRole("admin"…)` calls: `tenants.ts:81,99,117`, `qbo.ts:20`, `audit-log.ts:38`, `reports.ts:8`, `insurance.ts:168,268,409`, `fuel.ts:103,156,205`, `email-automation.ts:128` | Role strings `admin`/`manager`/`accounting` don't exist. The schema enum is `PLATFORM_ADMIN, MARINA_OWNER, MARINA_MANAGER, DOCK_STAFF, POS_CASHIER, ACCOUNTING, PORTAL_USER`. | Reports, audit log, QBO, tenant settings and fuel pricing are **unreachable for every user in production** (403). [VERIFIED LIVE: `/api/reports/revenue` and `/api/audit-log` return 403.] | Export a typed `Role` enum from `@prisma/client` and make `requireRole(...roles: UserRole[])` typed so strings can't drift. Replace all call sites. | **P0** | S |
| **A-3** | `middleware/auth.ts:136-137` | `requirePlatformAdmin` queries `where: { clerk_id, role: "platform_admin" }`. The schema column is **`clerkUserId`** (as `clerkAuth` uses correctly, line 71) and the role is `PLATFORM_ADMIN`. | Prisma throws "Unknown argument `clerk_id`", so **every `/api/admin/*` request returns 500**. The admin app is non-functional. (Without a Clerk key it fails even earlier: "Publishable key is missing", 500.) | `where: { clerkUserId, role: "PLATFORM_ADMIN", active: true }`. Better: keep platform admins in a separate `platform_admins` table or Clerk org, not as a role on a tenant-bound user row. | **P0** | S |
| **A-4** | ~25 routers (table §3) | **No RBAC on most write paths**: refunds (`payments.ts:447`, `pos.ts:534`), invoice void/finalize (`invoices.ts:420,511`), announcements (mass SMS/email), customer delete, contract terminate, storage delete. | Any authenticated user (`DOCK_STAFF`, `POS_CASHIER`, and `PORTAL_USER` once the portal exists) can refund payments to cards, void invoices and blast SMS (Twilio cost and TCPA exposure). That breaks separation of duties for a financial product. | Define a permission matrix (`getPermissionsForRole` in auth.ts already sketches one) and enforce `requirePermission("payments:refund")` per route. Add tests. | **P0** | M |
| **A-5** | `transient.ts:65,106,…`, `ramp.ts:54,…`, `concierge.ts:87,…` (23 routes) | `clerkAuth` is passed as a function reference instead of `...clerkAuth()`. Express calls it as middleware, it returns an array and never calls `next()`. | **Every request to /api/transient, /api/ramp and /api/concierge hangs until the socket times out** (verified live: curl timeout; vitest 30s timeouts). That ties up connections (cheap DoS), and the transient widget can never work. | Replace with `...clerkAuth()`. Add an ESLint rule or typed wrapper. | **P0** | S |
| **A-6** | `middleware/auth.ts:71-76` | `clerkAuth` doesn't check `user.active`. The Clerk `user.deleted` webhook and `DELETE /settings/team/:id` only set `active=false`. | A removed or terminated employee keeps full access as long as their Clerk session or user exists. | Add `active: true` to the lookup. Also revoke Clerk sessions on removal via the Clerk Backend API. | **P0** | S |
| **A-7** | `@clerk/express` `requireAuth()` (auth.ts:57, 123) | `requireAuth` **redirects (302 to `/`)** on failure instead of 401. No `authorizedParties`. `acceptsToken: "any"` is the library default. | The SPA's fetch gets a 302 to `/` (index.html), producing JSON parse errors and confusing UX. Without `authorizedParties`, session tokens minted for other origins on the same Clerk instance are accepted. | Use `app.use(clerkMiddleware({ authorizedParties: [...] }))`, then a custom guard that returns 401 JSON when `!getAuth(req).userId`. | P1 | S |
| **A-8** | No user-provisioning path | The Clerk webhook needs `public_metadata.tenant_id`, which nothing sets. Team invite (`settings.ts:572`) creates a row with `clerkUserId=null`, and nothing links it on first login. `/auth/sync-session` can't create users in prod, because `clerkAuth` 403s first. | **No real customer can ever log in** except users seeded with a `clerkUserId`. That blocks onboarding a first paying marina. | Use Clerk Invitations (Backend API) carrying `public_metadata.{tenant_id, role, user_id}`. On `user.created`, link by invitation id or verified email. Make `(tenantId, email)` and `(tenantId, clerkUserId)` unique. | **P0** | M |
| **A-9** | `settings.ts:60-68, 572` | `MARINA_MANAGER` may invite a user with role `MARINA_OWNER`. | Privilege escalation from manager to owner (owner can change roles, connect Stripe and remove the real owner). | Only allow inviting roles ≤ the inviter's own role. Owner-only for OWNER/ACCOUNTING. | P1 | S |
| **A-10** | `admin.ts:298-335` | Impersonation token: HMAC with fallback secret `"helm-impersonation-dev-key"`. No verifier exists anywhere, no audit log entry, no expiry enforcement. | If wired up later as is, anyone can forge impersonation tokens using the public default secret. | Remove until it can be designed properly: Clerk "actor tokens" or impersonation sessions, mandatory audit, short TTL, banner in UI. | P1 | M |
| **A-11** | `routes/tenants.ts:61-76`, `85-88` | `GET /api/tenants/:id` returns any tenant row by id. `PUT /:id` updates `where: {id: req.params.id}`, which is not bound to `req.tenantId`. | An authenticated user of tenant A reads tenant B's `stripeAccountId`, `qboRealmId`, branding and settings (and future QBO tokens, since the full row is returned). Once A-2 is fixed, an A admin can modify B. | Drop `:id`. Operate on `req.tenantId` only, with an explicit `select` allow-list. | **P0** | S |
| **A-12** | `routes/tenants.ts:31` | `POST /api/tenants` is unauthenticated (it only needs some Host that resolves to a tenant). | Anyone can create tenants or squat subdomains. (Currently crashes on the non-existent `settings` field.) | Remove, since onboarding should be the single, authenticated path. | **P0** | S |

---

## 5. Multi-tenant isolation findings

**How scoping works (`lib/prisma.ts:61-142`):** the `$allOperations` hook reads `tenantStore` (AsyncLocalStorage set in `tenant.ts:77`) and, for models in `TENANT_SCOPED_MODELS`, does `where = {...where, tenantId}`, `data = {...data, tenantId}`, and `upsert.create = {...}`.

Coverage check:
- Covered operations: findUnique(+OrThrow), findFirst(+OrThrow), findMany, count, aggregate, groupBy, create, createMany, update, updateMany, delete, deleteMany, upsert (where + create).
- **Not covered:**
  - `createManyAndReturn` / `updateManyAndReturn` (Prisma 6 operations) — not in the operation list, so they insert/return without a `tenantId` filter.
  - `upsert.update` — the `where` and `create` are scoped, but the `update` payload is not; a nested upsert can still set fields without the guard.
  - **`$queryRaw` / `$queryRawUnsafe` / `$executeRaw(Unsafe)`** — raw SQL bypasses the extension entirely. Used in `tools/migrate-all.ts` and `onboarding.ts:75`.
  - **Relation (nested) reads/writes** — `include`/`select` of a relation and nested `create`/`connect` are executed as part of the parent operation; the extension only rewrites the top-level `where`/`data`, so nested relational filters are not tenant-scoped. Isolation on reads relies on the parent row already being tenant-bound.
  - Models missing from `TENANT_SCOPED_MODELS` but carrying `tenantId` (below).

| ID | File:line | Issue | Failure scenario | Fix | Sev | Eff |
|---|---|---|---|---|---|---|
| **T-1** | `bi-api.ts:46-66`, `tenant.ts:77`, `lib/prisma.ts:83` | The API-key middleware sets `req.tenantId = apiKey.tenantId`, but it runs **after** `tenantMiddleware` has already called `tenantStore.run({tenantId: <Host-resolved tenant>})` for the whole request. The Prisma extension reads the store, not `req.tenantId`, so BI queries are scoped to **the tenant named in the Host header**, not the key's tenant. | **Cross-tenant data disclosure, works in production.** [VERIFIED LIVE with `NODE_ENV=production`, `CLERK_SECRET_KEY` set: a tenant-A `ApiKey` + `Host: bayshore.gethelm.com` returned Bayshore's customers (names, emails, phones, addresses). The same key with its own Host returned an empty set.] `/api/bi` exposes customers, invoices, payments, slips and contracts. | Do not run `tenantStore` from Host for `/api/bi`. In the API-key middleware, run the handler inside `tenantStore.run({tenantId: apiKey.tenantId}, …)`, and make the extension read `req`-less context from the store only. Add a test that a key cannot read another tenant via Host. | **P0** | M |
| **T-2** | `lib/prisma.ts:17-55` | **20 models have a `tenantId` column but are absent from `TENANT_SCOPED_MODELS`**, so they are never auto-scoped: `AchReturn, ApiKey, Chargeback, CollectionsAccount, CommunicationPreference, ConciergeVendor, DeferredSchedule, GlAccount, GlEntry, InsuranceRecord, Location, MeterReading, NpsSurvey, ProcessedWebhook, PromoCode, ReferralPartner, RenewalBatch, RentalAutomationEvent, SecurityDeposit, SlipContract`. Most routes *do* add `tenantId` manually, but several do not (T-3). | Any route that queries one of these by id alone leaks across tenants. There is no defence-in-depth: a single missed `where` clause is a breach. | Derive the scoped-model set from the Prisma DMMF (every model whose fields include `tenantId`) instead of a hand-maintained list. Fail loudly if a scoped model is queried with no tenant in context. Add Postgres RLS underneath. | **P0** | M |
| **T-3** | `contracts.ts:947,981` (`/esign-webhook`), `concierge.ts:351,364` (`PATCH /vendors/:id`), `admin.ts:924,944` (location update/delete — platform-admin, still cross-tenant), `insurance.ts:110` (`findUnique` by id post-create), `communication-prefs.ts:185` (`findUnique` by composite key, no tenant) | These query/update `SlipContract`, `ConciergeVendor`, `Location`, `InsuranceRecord`, `CommunicationPreference` **by id with no tenant filter**, and the model is unscoped (T-2). | Concrete cross-tenant paths: the e-sign webhook updates a contract's signed-document URL and status for **any** contractId in the system; `PATCH /api/concierge/vendors/:id` edits another tenant's vendor. Because the e-sign webhook has no signature verification (W-2), this is remotely exploitable. | Add `tenantId: req.tenantId` to every `where`, and fix T-2 so the extension would catch these anyway. For webhooks, resolve tenant from the verified payload, then scope. | **P0** | M |
| **T-4** | `tenant.ts:33-36` | Dev fallback: when no tenant matches the Host, it loads the oldest tenant. Guarded by `NODE_ENV !== "production"`, i.e. the same unset-NODE_ENV problem as A-1. | In a misconfigured prod (NODE_ENV unset), **every unmatched hostname silently resolves to the first tenant**, so requests to the bare domain or a typo'd subdomain operate on a real marina's data. | Remove the fallback, or gate it behind the explicit dev flag from A-1. In prod, unmatched host = 404. | **P0** | S |
| **T-5** | `lib/prisma.ts:17-55` | Five entries in `TENANT_SCOPED_MODELS` are **not real Prisma models**: `CancellationRule, Contract, FuelDispense, POSTransaction, Rental`. Seven entries (`AlgorithmicSuggestion, DemandSurgeTier, DockWalkItem, PosLineItem, PricingCalendarOverride, PricingRule, AnnouncementDelivery`) **have no `tenantId` column**, so injecting `tenantId` into their `where`/`data` makes Prisma throw. | The list is stale and partly wrong, which is why routes touching those models either error or were rewritten to avoid the extension. Confirms the hand-maintained list is unmaintainable. | Replace with DMMF-derived set (T-2). For child models (`PosLineItem`, `InvoiceLineItem`, `DockWalkItem`, `DeferredEntry`, `AnnouncementDelivery`), add a real `tenantId` column + index, or always scope through the parent in a transaction. | P1 | M |
| **T-6** | `tenant.ts:20-24` | Tenant is chosen from the `Host` header with no allow-list. Subdomain = first label when ≥3 labels. | Header is attacker-controllable. With auth working, a cross-tenant request still 403s at the user lookup, so this is defence-in-depth rather than a direct breach — but combined with A-1/T-4 it is the selection mechanism for choosing a victim. Also, 2-label custom domains (`app.bayshoremarina.com` has 3 labels so it works; a bare `marina.com` would be mis-parsed). | Resolve tenant from a verified mapping (DB), reject unknown hosts, and never trust a `x-helm-tenant-id`-style header (widgets send one; server already ignores it — keep it that way). | P1 | S |
| **T-7** | schema.prisma (child models) | `InvoiceLineItem, PosLineItem, DockWalkItem, DeferredEntry, AnnouncementDelivery` carry no `tenantId`. Cross-tenant reads are prevented only if the parent query is scoped. | A raw or mis-scoped query on a line-item table returns rows across tenants. | Denormalise `tenantId` onto child tables (common multi-tenant practice) and index it. | P2 | M |

**Net:** tenant isolation currently depends on (a) auth working, which it doesn't by default (A-1), and (b) every developer remembering to add `tenantId` to every `where`, with a scoping list that is stale and incomplete. This is the single biggest risk area for a multi-tenant SaaS. Recommend app-layer scoping (fixed) **plus** Postgres RLS as a hard backstop before launch.

---

## 6. Public endpoint & webhook findings

| ID | File:line | Issue | Failure / exploit | Fix | Sev | Eff |
|---|---|---|---|---|---|---|
| **W-1** | *missing* | **There is no Stripe webhook endpoint.** `lib/stripe.ts` has no `constructEvent`; `services/webhook.ts` (idempotency) is never called; `STRIPE_WEBHOOK_SECRET` in `.env.example` is unused. | Payments never reconcile: `payment_intent.succeeded`, `charge.refunded`, ACH `charge.failed`/returns, disputes and Connect account events are never processed. ACH settlement (`payments.ts:389` comment "GL posting happens when payment settles (webhook)") never happens, so revenue and GL are wrong. | Add `POST /api/webhooks/stripe` mounted with `express.raw({type:'application/json'})` **before** the global `express.json()`, verify with `stripe.webhooks.constructEvent`, resolve tenant from the Connect account / metadata, then `checkAndMarkProcessed`. | **P0** | M |
| **W-2** | `contracts.ts:933-1000` | `/esign-webhook` has **no signature verification** and looks up the contract with no tenant scope (T-3). | Anyone who can reach the API can mark any contract "signed" with an attacker-supplied `signedDocumentUrl`, forging executed slip agreements. | Verify the provider's HMAC/signature, resolve tenant from the verified payload, scope the lookup. Move off staff-auth mount. | **P0** | M |
| **W-3** | `qbo.ts:180-210` | QBO webhook signature check **fails open**: `if (webhookVerifierToken) { … }` — when `QBO_WEBHOOK_VERIFIER_TOKEN` is unset, it skips verification and processes the payload. Also it sits behind `clerkAuth`+role (line 19-20), so Intuit's unauthenticated POST can never reach it. | Unverified/forged QBO notifications processed when env missing; and in normal config the endpoint is unreachable, so QBO sync is broken either way. | Require the token (refuse to boot without it). Mount webhook on a public, signature-verified sub-router outside the staff-auth router. | P1 | S |
| **W-4** | `auth.ts:30-65` | Clerk svix webhook verifies over `JSON.stringify(req.body)` (re-serialised after `express.json()`), not the **raw** body. svix signs the raw bytes; re-serialisation reorders keys/whitespace and **breaks verification** for any non-trivial payload. | Legitimate Clerk webhooks fail signature → users never provisioned/updated/deactivated. (It's mounted under the tenant-bypass prefix, which is correct.) | Capture the raw body for this route (`express.raw`) and pass the exact bytes to `wh.verify`. | P1 | S |
| **W-5** | `index.ts:53` | `cors()` with no config → `Access-Control-Allow-Origin: *` (verified). | Any website can call the API with a user's browser. With cookie-based Clerk sessions this is CSRF-adjacent; with bearer tokens the main risk is data exf/abuse from malicious sites. | Restrict to known app origins (web/portal/admin + tenant custom domains), `credentials: true`, explicit methods/headers. Widgets' embed origins need a separate, read/submit-only CORS policy. | P1 | S |
| **W-6** | no rate limiting anywhere | No `express-rate-limit`/WAF on login-adjacent, webhook, BI, or **public lead-form submit** endpoints. | Credential stuffing against Clerk, brute force of API keys/embedKeys, lead-form spam, Twilio/Resend cost amplification via announcements. | Add `express-rate-limit` (Redis store) globally + stricter per-route limits on public/submit/webhook endpoints. Set `trust proxy` so client IPs are correct behind nginx/Cloudflare. | P1 | M |
| **W-7** | `lead-forms.ts:95,222` | The intended-public `POST /:embedKey/submit` is registered **after** `router.use("/", authedRouter)` where `authedRouter.use(...clerkAuth())`. Express matches the auth router first. | In production the public form submit redirects (302) to Clerk instead of accepting leads. [VERIFIED LIVE: prod-mode submit → 302.] The embeddable lead-capture product doesn't work. | Mount the public route on the base `router` **before** the authed sub-router, or split into two routers mounted public-first. | P1 | S |
| **W-8** | `lead-forms.ts:252-262` | reCAPTCHA **fails open**: no `RECAPTCHA_SECRET_KEY` → returns `true`. Also no score threshold for v3. | Lead-form spam / junk leads by default (the key is blank in `.env.example`). | Require the secret in prod; verify `success` and (v3) `score ≥ 0.5`; rate-limit by IP. | P2 | S |
| **W-9** | `onboarding.ts` Stripe/QBO OAuth (`:tenantId/stripe`, `/stripe/callback`, `/qbo`, `/qbo/callback`) and `tenants.ts:99,117` | Entire onboarding router is unauthenticated and **bypasses tenant middleware** (`tenant.ts:33` BYPASS_PREFIXES includes `/api/onboarding`). OAuth `state` is just the `tenantId` and is never validated on callback. | Once the snake_case field bugs are fixed, an attacker completes a Stripe Connect OAuth for themselves and the callback writes **their** `stripeAccountId` onto any `:tenantId`, redirecting that marina's payouts; same for QBO realm. No CSRF `state` protection on the OAuth flow. | Require auth + owner role on all onboarding mutations. Generate a signed, single-use `state` bound to tenant+user+nonce; verify on callback. | **P0** | M |
| **W-10** | `index.ts:55` | `express.json()` global 100 kB limit applies to **all** routes incl. webhooks and PDF/base64 uploads. Verified 413 at 200 kB. | Not a vuln, but large legit payloads (base64 insurance docs, invoice attachments) will 413. Conversely no stricter cap on public endpoints. | Per-route body limits: small (8–16 kB) on public submit/webhook, larger only where needed; keep raw parser for Stripe. | P2 | S |

---

## 7. Data protection / PCI / secrets

| ID | Evidence | Issue | Impact | Fix | Sev | Eff |
|---|---|---|---|---|---|---|
| **D-1** | `services/qbo-sync.ts:92-111`, schema `Tenant.qboAccessToken/qboRefreshToken`, `stripeAccountId` | OAuth access/refresh tokens and connected-account ids are stored **in plaintext** columns on `tenants`. `tenants.ts:61` returns the whole row to authenticated users (A-11). | A DB dump or the cross-tenant read (A-11) exposes long-lived QBO tokens (full accounting access) and Stripe Connect ids. | Encrypt at rest (app-level envelope encryption with a KMS data key, or `pgcrypto`). Never select token columns in tenant-facing responses. Rotate any tokens that existed. | P1 | M |
| **D-2** | `.replit:430` | A Clerk **publishable** key is committed (`pk_test_…`). Publishable keys are public by design, so low risk — but it signals secrets-in-repo hygiene. Confirm no secret key is in git history. | Low direct risk; process risk. | Move all config to the secret manager; add secret scanning (gitleaks) to CI. | P2 | S |
| **D-3** | PCI scope | Card data: widgets reference `@stripe/react-stripe-js` (client-side tokenisation) and the server uses PaymentIntents, so **raw PAN never touches the server** — good. But there is Stripe **Terminal** (`services/stripe-terminal.ts`) and ACH (`ach-handler.ts`, bank data via Stripe). No PAN/CVV found in code or DB (checked). | With correct Stripe Elements/Terminal usage the merchant is **SAQ A / SAQ A-EP**-eligible, not full SAQ D. But that depends on never logging card data and on CSP on payment pages. | Document PCI posture; add a strict CSP on payment pages; ensure no card/bank data is logged (see D-4); complete the correct SAQ. Confirm ACH account numbers are never stored outside Stripe. | P1 | M |
| **D-4** | `lib/sms.ts:46`, `lib/email.ts`, `error.ts:48`, 20 `console.*` sites | Errors and payloads logged to stdout with no redaction; dev error handler returns raw messages (and **Prisma errors leak file paths, query args and schema** — verified: `/api/tenants` 500 returned source path + query shape). No structured logging, no PII scrubbing. | PII/financial data and internal structure end up in logs (and in API responses in non-prod). | Structured logger (pino) with redaction; never echo Prisma errors to clients; ensure `NODE_ENV=production` so error.ts hides internals (depends on A-1). | P1 | S |
| **D-5** | `lib/storage.ts:375-397` | R2 presigned **upload** URLs are keyed `tenantId/category/filename` (good), and download/delete enforce the `tenantId/` prefix at the route (`storage.ts:99,133`). But any authenticated user of a tenant can presign-download/delete **any** file of that tenant regardless of record ownership, and there's no per-record ACL. | Intra-tenant over-broad file access (e.g. POS cashier downloads insurance docs). Acceptable short-term; tighten later. | Bind file keys to records and check record ownership/role before presigning. | P2 | M |
| **D-6** | no GDPR/CCPA | No data-export or hard-delete path. `DELETE /api/customers/:id` only sets `status=INACTIVE` (soft). No retention policy, no audit of exports. | Can't honour CCPA/GDPR access/deletion requests; blocker for some B2B customers and CA/EU boaters. | Build per-tenant and per-data-subject export + verified hard-delete (cascade), with audit. | P1 | L |
| **D-7** | `admin.ts:319` | Impersonation HMAC fallback secret hard-coded (also A-10). | Public default secret. | Remove / redesign (A-10). | P1 | S |

---

## 8. Jobs & workers

Setup: BullMQ 5 over ioredis; `lib/queue.ts` defines 7 queues. `workers/index.ts` defines 5 Workers (email, sms, automation, qbo-sync stub, billing). `jobs/renewal-job.ts` is a separate worker. Schedulers: `scheduleAlgorithmicPricing` (Sun 0:00), `scheduleTenantLifecycle` (daily 06:00), `scheduleAutoRenewChecks`.

| ID | File:line | Issue | Impact | Fix | Sev | Eff |
|---|---|---|---|---|---|---|
| **J-1** | `lib/queue.ts:9-11` | `new IORedis(REDIS_URL)` runs at import with `maxRetriesPerRequest:null`. Contrary to `replit.md` ("Redis is optional — null when unset"), the code is **not** optional: importing any route that enqueues (e.g. `invoices.ts`, `announcements.ts`) connects to Redis. Default `redis://localhost:6379`. | Without Redis, the API still boots (lazy connect), but any enqueue (send invoice, announcements, ACH email, renewals) throws/hangs. No graceful degradation. In my live run Redis was present; with it absent these paths fail. | Make the queue layer truly optional (null-guard enqueues) **or** declare Redis a hard dependency and fail fast at boot if unreachable. Pick one and document it. | P1 | S |
| **J-2** | no worker in deploy | `workers/index.ts` is never started by any process in `.replit` or a working Docker service (compose's `worker` runs `renewal-job.js`, which only exports functions and exits → restart loop). Schedulers (`schedule*`) are **never called** anywhere. | **Background jobs never run in any environment**: no emails, SMS, renewals, deferred-revenue recognition, tenant lifecycle, or algorithmic pricing. Jobs enqueue to Redis and sit there. | Add an entry `src/workers/main.ts` that starts all workers and registers the repeatable schedulers; run it as its own process/service (compose `worker`, a Replit worker, or a separate container). | **P0** | M |
| **J-3** | `workers/index.ts:116-117`, `jobs/tenant-lifecycle.ts:101` | Worker code uses fields that don't exist (`customer.tenant_id`, `first_name`; `tenant.active`). These are among the 444 tsc errors. | The automation and billing workers would throw at runtime even if started. | Fix field names to camelCase; they'd be caught by a green typecheck. | P1 | S |
| **J-4** | workers never set `tenantStore` | Workers call `prisma.customer.findFirst({where:{id, tenant_id}})` manually, but the extension only scopes when `tenantStore` is set. Jobs run with **no tenant context**, so the extension passes queries through unscoped. | Workers rely entirely on manual `tenantId` in every query. A missed filter = cross-tenant write in a background job (e.g. sending one tenant's announcement to another's customers). | Wrap each job body in `tenantStore.run({tenantId}, …)` using the job's `data.tenantId`. | P1 | M |
| **J-5** | `workers/index.ts:20` email/automation | No idempotency on email/SMS/announcement jobs; no dedupe `jobId`. BullMQ retries (and multi-instance) can double-send. Refunds/payments have no Stripe idempotency key (`payments.ts:335`, `stripe-terminal.ts:68`). | Duplicate customer emails/SMS; **double refunds / double charges** under retry or concurrent requests. | Pass deterministic `jobId` for enqueue dedupe; pass Stripe `idempotencyKey` (e.g. `refund:<paymentId>`), store processed ids. | P1 | M |
| **J-6** | multi-instance | Repeatable schedulers use BullMQ `repeat`, which is safe across instances (one delayed job). But nothing guarantees a single scheduler registration, and `tenant-lifecycle` iterates all tenants in one job (no per-tenant isolation/locking). | At scale, one slow tenant blocks the daily lifecycle run; a failure aborts the rest (no per-tenant try/catch in some loops). | Fan out per-tenant jobs; add per-job concurrency and failure isolation; use a single "scheduler" deployment or BullMQ's job scheduler to avoid duplicate repeat registration. | P2 | M |

---

## 9. CI/CD, Docker, deployment, migrations

| ID | File:line | Issue | Impact | Fix | Sev | Eff |
|---|---|---|---|---|---|---|
| **C-1** | `ci.yml:25,28,58,88` | CI uses `cache: npm` and `npm ci`, but the repo is **pnpm** with `pnpm-lock.yaml` and `workspace:*` deps. There is **no `package-lock.json`**. | **Every CI job fails at install.** No lint/typecheck/test/build/docker gate actually runs. | Use `pnpm/action-setup` + `cache: pnpm` + `pnpm install --frozen-lockfile`; replace `npx turbo` with `pnpm turbo`. | **P0** | S |
| **C-2** | `ci.yml:72` | `test` step has `continue-on-error: true`. | Even once CI installs, tests never block merges — matches the 51 failing tests sitting on the branch. | Remove it once the suite is green and deterministic; make it required. | P1 | S |
| **C-3** | `Dockerfile.api:13,37`, `Dockerfile.web:13,37,93,117` | `COPY package.json package-lock.json turbo.json tsconfig.json ./` — **`package-lock.json` and root `tsconfig.json` don't exist** (it's `tsconfig.base.json`); `RUN npm ci` with no lockfile; `COPY … node_modules … 2>/dev/null || true` is **not valid COPY syntax** (COPY has no shell). | **Docker images don't build.** | Rewrite as a pnpm workspace build: `corepack enable`, copy `pnpm-lock.yaml`/`pnpm-workspace.yaml`, `pnpm install --frozen-lockfile`, `pnpm --filter @helm/api build`; copy `tsconfig.base.json`; drop the invalid COPY lines; prune to prod with `pnpm deploy`. | **P0** | M |
| **C-4** | `Dockerfile.api` | No `ENV NODE_ENV=production`. | Ties directly to A-1: the container would run with the auth bypass on. Also Prisma client/`puppeteer` (chromium, heavy) shipped without the browser; PDF generation will fail in `node:20-alpine` (needs chromium + libs). | Set `NODE_ENV=production`; install chromium in the image or switch PDF to a service; run `prisma generate` in build (present) and `migrate deploy` at release. | **P0** | M |
| **C-5** | `deploy.yml` | Builds and pushes images to GHCR but has **no deploy step** — no target env, no `migrate deploy`, no secret injection, no health gate, no rollback. `.replit` deploys only static web. | There is **no path from a merge to a running API/worker/DB**. Migrations never applied. | Add a real deploy (Fly/Render/ECS/K8s): run `prisma migrate deploy`, roll API + worker, health-check, rollback on failure. Separate staging/prod. | **P0** | L |
| **C-6** | `docker-compose.yml:234` | `worker` service runs `dist/jobs/renewal-job.js` (exports only) → exits → `restart: unless-stopped` loop. DB creds hard-coded (`helm/helmpassword`). | Worker never processes jobs; weak default creds if ever used beyond local. | Point at the new `workers/main.js`; use env/secret for creds. | P1 | S |
| **I-1** | `apps/api/prisma` (no `migrations/`), `replit.md` | **No migration history.** `replit.md` says use `prisma db push`. `tools/migrate-all.ts` runs `prisma migrate deploy` against per-tenant schemas that don't exist and that use a different naming scheme than onboarding's `CREATE SCHEMA`. | No reproducible, reviewable schema evolution; `db push` on a shared prod DB risks data loss and has no rollback. `migrate-all.ts` is dead/incoherent. | Adopt `prisma migrate` with a committed `migrations/` dir; run `migrate deploy` in release (C-5). Delete `migrate-all.ts` and the `CREATE SCHEMA` call, or commit fully to DB-per-tenant (much larger effort) — but not both. | **P0** | M |
| **I-2** | `packages/database` | Package is an empty stub (`main` file missing, no schema, scripts would fail); schema actually lives in `apps/api/prisma`. | Confusing ownership; `db:migrate:all` script in root points at the broken tool. | Either make `packages/database` the real home of the schema+client and have the API import it, or delete the package. | P2 | S |
| **I-3** | `turbo.json`, no `lint` scripts | `turbo lint` is in CI, but **no package defines a `lint` script** and there's no ESLint config. `turbo build` depends on `^build`, but web/api builds fail (Section 2). | `turbo lint` is a no-op; there is no linting at all. | Add ESLint + a `lint` script per package; wire into CI. | P2 | M |

---

## 10. Observability & ops

| ID | Evidence | Issue | Impact | Fix | Sev | Eff |
|---|---|---|---|---|---|---|
| **O-1** | `lib/sentry.ts` never imported in `index.ts`; `initSentry`/handlers unused | **Sentry is wired but never initialised**; `sentryRequestHandler`/`sentryErrorHandler` are never mounted. Also `Sentry.expressRequestHandler` doesn't exist in `@sentry/node@8` (tsc error). | **No error tracking in any environment.** The one observability integration is dead. | Call `initSentry()` first in `index.ts`; use Sentry v8 `setupExpressErrorHandler(app)`; add release/traces; scrub PII. | P1 | S |
| **O-2** | `routes/health.ts` | Health check returns `{status:"ok"}` without checking DB or Redis. | Load balancers consider the app healthy while DB/Redis are down; bad deploys pass health gates. | Add readiness probe that pings Postgres and Redis; keep a cheap liveness probe separate. | P1 | S |
| **O-3** | 20 `console.*`, no logger | No structured logs, no request IDs, no correlation of tenant/user, no log levels. | Hard to debug multi-tenant incidents; PII in plaintext logs (D-4). | pino with per-request child logger (requestId, tenantId, userId), redaction. | P1 | S |
| **O-4** | audit coverage | `auditLog.create` exists in ~20 files, but **18 routers never write audit logs**, including `admin`, `auth`, `settings`, `qbo`, `tenants`, `onboarding`, `storage`, `bi-api`. No audit on login, impersonation, role change, Stripe/QBO connect, API-key use, or platform-admin actions. Audit writes are best-effort (not transactional with the mutation) and store no IP for most. | Incomplete audit trail — a compliance and incident-response gap for a financial multi-tenant product. | Centralise audit in a helper invoked for all privileged/financial mutations, within the same transaction; capture actor, IP, tenant, before/after. | P1 | M |
| **O-5** | none | No backups/DR, no PITR policy, no metrics (Prometheus/OTel), no alerting, no uptime monitoring, no runbooks. | No recovery story for a SaaS holding customer financial data. | Managed Postgres with PITR + tested restores; metrics + alerts; on-call runbooks. | P1 | L |

---

## 11. Prioritized fix list

### P0 — launch blockers (nothing ships or is safe until these are done)
1. **A-1 / C-4 / T-4** Kill the fail-open auth bypass; require an explicit dev flag; set `NODE_ENV=production` in the image; validate required env at boot. *(S)*
2. **A-2 / A-3** Fix RBAC role strings to the real enum and fix `requirePlatformAdmin` (`clerkUserId`, `PLATFORM_ADMIN`). *(S)*
3. **A-4** Add role/permission checks to all financial/mutating routes (refunds, void, announcements, deletes). *(M)*
4. **A-5** Fix `clerkAuth` → `...clerkAuth()` in transient/ramp/concierge (stops the hangs). *(S)*
5. **A-6 / A-8** Enforce `active:true`; build a working user-provisioning/invite flow so real customers can log in. *(M)*
6. **A-11 / A-12** Remove `GET/PUT/POST /api/tenants` by-id/unauth paths; operate on `req.tenantId`. *(S)*
7. **T-1 / T-2 / T-3** Fix BI-API Host-header cross-tenant leak; DMMF-derive the scoped-model set; add tenant filters to the unscoped by-id queries. Add RLS. *(M–L)*
8. **W-1 / W-2 / W-9** Add a verified Stripe webhook (raw body); verify the e-sign webhook and scope it; lock down and `state`-protect onboarding OAuth. *(M)*
9. **J-2** Actually run the workers + schedulers as a deployed process. *(M)*
10. **C-1 / C-3 / C-5 / I-1** Make CI (pnpm), Docker, a real deploy, and migrations work end-to-end. *(M–L)*
11. **Typecheck to zero** (fix `@types/express`→4, add `DOM` lib, align code to schema): required for any build. *(M)* — see §2.2.

### P1 — before paying customers / scale
A-7, A-9, A-10, T-5, T-6, W-3, W-4, W-5, W-6, D-1, D-3, D-4, D-6, J-1, J-3, J-4, J-5, C-2, C-6, O-1, O-2, O-3, O-4, O-5. Plus: repair the test suite (real DB integration tests that can detect authZ/tenant bugs; remove `continue-on-error`).

### P2 — hardening
T-7, W-8, W-10, D-2, D-5, J-6, I-2, I-3, and ESLint/lint wiring.

### Suggested sequencing
- **Week 1:** typecheck to zero + CI/Docker (pnpm) green; A-1/A-2/A-3/A-5 (fast, high-impact auth fixes).
- **Week 2:** A-4/A-6/A-8 RBAC + provisioning; T-1/T-2/T-3 tenant isolation + RLS; real integration tests for auth/tenancy.
- **Week 3:** W-1/W-2/W-9 webhooks + onboarding; J-2/J-4/J-5 workers; migrations + a real deploy target; Sentry/logging/health.
- **Week 4–5:** D-1/D-3/D-6 secrets/PCI/GDPR; observability/backups/runbooks; remaining P1s.

### Things that genuinely work today (don't re-do)
- `prisma db push` + seed on a clean Postgres 16.
- The Prisma `$extends` auto-scoping mechanism itself (sound where the model list is correct and auth is on).
- Zod validation on most tenant-facing route bodies; `settings.ts` RBAC (correct enum roles).
- Vite bundles of all four frontends.
- svix import, Stripe client guard pattern, storage key-prefix checks, webhook idempotency service (just unused).
