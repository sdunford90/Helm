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
  - `createManyAndReturn`, `upd