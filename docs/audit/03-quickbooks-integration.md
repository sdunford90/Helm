# 03 — QuickBooks Online Integration Audit

**Scope:** Helm ⇄ QuickBooks Online (QBO) sync, end to end: OAuth, entity sync, webhooks, the Helm GL that feeds it, jobs/workers, and the staff-app UI.
**Date:** 2026-10-26 · **Method:** I read the code end to end and ran `tsc --noEmit` on `apps/api`. I checked the code against the QBO Accounting API, using the Intuit spec-backed API tools for the Invoice and Payment create schemas (`?minorversion=75`) and Intuit/third-party notices for platform changes. No source files were modified.

**Severity:** P0 = launch blocker · P1 = must fix before broad rollout · P2 = should fix.
**Effort:** S ≤ 1 day · M = 2–5 days · L = 1–3 weeks.

---

## TL;DR

**The QBO integration does not work today and cannot be turned on safely.** The service code does make real HTTP calls to Intuit (`fetch` to the correct OAuth and v3 hosts), but:

1. **It does not compile against the schema.** The `Tenant` model has only `qboRealmId` (`schema.prisma:257`). The service reads and writes `qboAccessToken`, `qboRefreshToken`, `qboTokenExpiresAt`, `qboConnectedAt` and `qboLastSyncAt`, and none of these columns exist. `tsc` reports TS2353 at `qbo-sync.ts:80,110,263`. At runtime Prisma throws on the first token read or write, so tokens are never stored.
2. **Every `/api/qbo/*` route is unreachable.** The router requires roles `"admin"`/`"manager"` (`routes/qbo.ts:20`), but `UserRole` only has `MARINA_OWNER`, `MARINA_MANAGER`, `ACCOUNTING`, etc. (`schema.prisma:18-26`). It also wraps the OAuth **callback** and the Intuit **webhook** in Clerk auth (`qbo.ts:19`), which Intuit's redirect and webhook POSTs can never satisfy.
3. **There are four separate, conflicting "connect QuickBooks" implementations** (`routes/qbo.ts`, `routes/settings.ts:452`, `routes/onboarding.ts:206`, `routes/tenants.ts:115`). Two redirect to `/api/callbacks/qbo`, which does not exist. One is unauthenticated, throws away the tokens, and writes a field that does not exist (`qbo_realm_id`). None of them validates OAuth `state`.
4. **The UI is all mock.** The Settings "QuickBooks Online — Connected, Realm 12345678, Last sync Mar 25" card is hard-coded, and its Sync/Disconnect buttons only show a toast (`Settings.tsx:993-1009`). GL Account Mapping is hard-coded and never saved. `ChartOfAccounts` shows mock `qboLinked` flags.
5. **No background sync exists.** The `qbo-sync` BullMQ worker is an empty stub (`workers/index.ts:221-229`). The enqueue on invoice issue is commented out (`invoices.ts:485-486`). The worker process never starts anyway (no entry point in package.json, Dockerfiles or compose).
6. **If it were wired up, it would corrupt the books.** Invoice lines send `item.totalCents`, which does not exist (it is `extendedCents`), so `Amount` becomes `NaN`, then `null`, and QBO rejects every invoice. `syncPayment` has no "already synced" guard, so every Sync Now re-creates every payment in QBO. A payment synced before its invoice becomes a SalesReceipt, which double-counts revenue. Sales tax is not sent. GL account numbers in `gl-posting.ts` disagree with both chart-of-accounts seeds, so Helm's own GL posts deferred revenue to *Tips Payable* and security deposits to *Sales Tax Payable*.
7. **Webhooks use the legacy `eventNotifications` payload.** Intuit made the move to CloudEvents mandatory (deadline 15 May 2026, reportedly extended to 31 Jul 2026). Even with the auth problem fixed, this handler would receive nothing usable.

**Recommendation:** treat QBO as a **rebuild on top of the parts that work**: the endpoint constants, the request shapes for Customer/Invoice/Payment/JournalEntry, and the general refresh-on-401 idea. The recommended design for a marina is **invoice-level AR sync** (Customer + Invoice + Payment + CreditMemo/RefundReceipt), plus **daily summary SalesReceipts or JournalEntries** for POS/fuel/transient, **Stripe payouts as QBO Deposits with a fee line**, and **deferred-revenue recognition as monthly JournalEntries**. Run it all through an outbox and queue with idempotency keys. Estimated effort: about 4–6 engineer-weeks to a production-grade v1, plus Intuit's app-review lead time.

---

## 1) How the sync works today

### 1.1 Narrative

**Connecting.** In the staff app, the only live connect button is in **Onboarding step 4** (`apps/web/src/pages/Onboarding.tsx:413-428`).
- It POSTs to `/api/onboarding/:tenantId/qbo`, opens the returned Intuit URL in a new tab, and **immediately sets `qboConnected = true`** without waiting for anything.
- Intuit redirects to `/api/onboarding/:tenantId/qbo/callback` (`onboarding.ts:240-289`). That handler exchanges the code for tokens, **discards the tokens**, and then calls `prisma.tenant.update({ data: { qbo_realm_id } })`. The snake_case field does not exist (TS2561 at `onboarding.ts:285`), so the update throws and the realm is never saved.
- The Settings page shows a static "Connected" badge whatever the real state.

**The "real" service.** `apps/api/src/services/qbo-sync.ts` holds the substantive implementation:
- OAuth URL builder, code exchange, and refresh (correct Intuit endpoints: `appcenter.intuit.com/connect/oauth2` and `oauth.platform.intuit.com/oauth2/v1/tokens/bearer`).
- A `qboRequest` helper with refresh-on-401.
- `syncCustomer`, `syncInvoice`, `syncPayment`, `postJournalEntry`, `syncAll`, a webhook handler, `disconnect` and `getStatus`.

It is exposed only via `apps/api/src/routes/qbo.ts`, mounted at `/api/qbo` (`index.ts:92`). That router is unreachable because of the role mismatch, and the callback and webhook are behind Clerk auth.

**Syncing.** If a caller did reach `POST /api/qbo/sync`, `syncAll` would run **inside the HTTP request**:
- It loads every customer, then every invoice (any status, including DRAFT and VOID), then every COMPLETED payment.
- It fires them at QBO in batches of 50 concurrent requests (`Promise.allSettled`).
- Each entity call does a create (or a GET for SyncToken, then a sparse update when a `qbo*Id` is already stored).
- Failures go only to `console.error`.
- At the end it writes `qboLastSyncAt`, which does not exist, so the route returns 500 even after all the work is done.

**Settings "Sync Now" API.** `POST /api/settings/qbo/sync` (`settings.ts:506-541`) does no syncing. It stamps `invoiceTemplateJson.qboLastSync = now` and returns `{ syncing: true }`.

**Background.** A `qbo-sync` queue exists (`lib/queue.ts:21,37`) and a worker is registered (`workers/index.ts:221-229`), but the worker body is `console.log` plus a TODO. Nothing enqueues to it; the only producer is commented out at `invoices.ts:485-486`.

**QBO → Helm.** `handleQboWebhook` (`qbo-sync.ts:692-796`):
- Re-reads changed Customers and Invoices from QBO.
- Overwrites Helm `firstName/lastName/email/phone`, and Helm `balanceCents`/`status=PAID` from QBO `Balance`.
- Does not post the matching Helm payment or GL entry.
- Payment events are only audit-logged.
- It expects the legacy `eventNotifications` payload.

**Helm's internal GL** (`gl-posting.ts`, `deferred-revenue.ts`) is separate from QBO:
- Invoices, payments, refunds, voids, ACH returns and deferred recognition write `GlEntry` rows with Helm `GlAccount` ids.
- `GlAccount.qboAccountId` exists (`schema.prisma:795`), but nothing populates it or reads it.
- `GlEntry` has no QBO export marker.
- `postJournalEntry` in qbo-sync (`:548`) is never called. It would send Helm account UUIDs as QBO `AccountRef` values.

### 1.2 Data flow (as built vs. as intended)

```
                         AS BUILT (today)
 Staff UI ──POST /api/onboarding/:t/qbo──► Intuit authorize ──► /onboarding/:t/qbo/callback
   │                                                               └─ exchanges code, DROPS tokens,
   │                                                                  writes nonexistent qbo_realm_id ✗
   ├─ Settings "Sync Now" ──(no API call; toast only)
   └─ Settings API /settings/qbo/sync ──► writes qboLastSync timestamp only (fake)

 /api/qbo/* (qbo-sync.ts) ── 403 for every real user (role mismatch) ✗
     if reachable: syncAll() in-request ─► 50 parallel POSTs ─► QBO v3
           Customer: create/update            (no dedupe vs existing QBO customers)
           Invoice:  create/update            (Amount = NaN → rejected) ✗
           Payment:  create EVERY run         (duplicates) ✗
     webhook ◄── Intuit (legacy payload; behind Clerk auth) ✗

 Invoice issue ─► gl-posting.postInvoice ─► GlEntry (Helm only) ─╳─► QBO (no export path)
 qbo-sync BullMQ worker: stub; worker process never started ✗
```

```
                         INTENDED (recommended, see §5/§8)
 Domain event (invoice issued/voided, payment captured/refunded, ACH return, payout paid,
 deferred recognized, POS day closed)
   └─► QboOutbox row (same DB tx) ─► dispatcher ─► BullMQ qbo-sync (per-realm limiter)
         └─► worker: ensure refs (Customer/Item/Account/TaxCode) ─► POST with Requestid
               └─► QboSyncRecord {helmType, helmId, qboType, qboId, syncToken, status, error}
 Intuit CloudEvents webhook ─► verify HMAC on raw body ─► enqueue CDC pull for realm
 Nightly: CDC reconcile + AR balance diff + token health check ─► Integration Health UI
```

---

## 2) Entity mapping table

| Helm entity | QBO entity | Direction | Trigger today | Idempotency key today | Status |
|---|---|---|---|---|---|
| Tenant | Company (realm) | link | OAuth callback (4 variants) | `Tenant.qboRealmId` (not unique) | **Broken.** Tokens not storable; realm save crashes in onboarding |
| Customer | Customer | Helm→QBO (create/update); QBO→Helm (webhook update of name/email/phone) | `syncAll`, `POST /qbo/sync/customer/:id`, lazily before invoice/payment | `Customer.qboCustomerId`, stored *after* create (not atomic) | **Partially coded, unreachable.** No dedupe against existing QBO customers; DisplayName collisions; BillAddr never sent (reads nonexistent `addressLine1`; schema has `addressJson`) |
| Invoice + InvoiceLineItem | Invoice + SalesItemLine | Helm→QBO; QBO→Helm (Balance/PAID via webhook) | `syncAll`, `POST /qbo/sync/invoice/:id`; issue-time enqueue commented out | `Invoice.qboInvoiceId` (after create) | **Broken.** `Amount = item.totalCents/100` = NaN; no ItemRef (`qboItemId` not on line items); no tax; syncs DRAFT/VOID |
| Payment (linked to invoice) | Payment w/ LinkedTxn→Invoice | Helm→QBO | `syncAll` (COMPLETED only) | **None.** `qboPaymentId` written but never checked | **Broken.** Duplicate on every run; `PaymentMethodRef.value:"CreditCard"` is a name, not an Id; no DepositToAccountRef |
| Payment (no invoice / invoice not yet synced) | SalesReceipt | Helm→QBO | `syncAll` | none | **Broken.** Double-counts revenue when the invoice later syncs; no ItemRef |
| Refund (`postRefund`) | RefundReceipt / CreditMemo + Refund | — | — | — | **Missing** |
| Invoice void (`postVoid`) | Invoice `?operation=void` | — | — | — | **Missing** (re-sync would sparse-update a voided Helm invoice as a live QBO invoice) |
| Credit / adjustment | CreditMemo | — | — | — | **Missing** (worker TODO mentions `credit_memo`) |
| ACH return (`postAchReturn`) | Payment delete/void or JournalEntry + fee invoice | — | — | — | **Missing** |
| Chargeback | JournalEntry / Expense | — | — | — | **Missing** |
| Security deposit (`postSecurityDeposit`) | JournalEntry or SalesReceipt to liability Item | — | — | `SecurityDeposit.qboLiabilityEntryId` (unused) | **Missing** |
| Deferred revenue recognition | JournalEntry (monthly) | — | `recognizeDeferred` never scheduled | `DeferredEntry.glEntryId` (Helm only) | **Missing** |
| POS / fuel / retail / transient / rentals | SalesReceipt (daily summary) | — | — | — | **Missing** (`PosTransaction`, `FuelDispense`, `TransientBooking` never touched) |
| Stripe payout + processing fees | Deposit (from Undeposited Funds) w/ negative fee line, or Transfer + Expense | — | — | — | **Missing** (no payout handling anywhere in API) |
| Product / service / slip type | Item (Service/NonInventory) | — | Manual text `SlipContract.qboItemId` | — | **Missing.** `qboItemId` is wrongly copied into `InvoiceLineItem.glAccountId` (`billing.ts:129`) |
| GlAccount | Account | — | — | `GlAccount.qboAccountId` (never set) | **Missing.** UI "QBO Linked" column is mock |
| Tax rate / exemption | TaxCode / TaxRate (non-AST) or AST `TxnTaxDetail` | — | — | — | **Missing.** `Customer.taxExempt` not mapped to QBO `Taxable=false` |
| Location (multi-location tenants) | Class or Department (Location) | — | — | — | **Missing** |
| Generic GL journal (`postJournalEntry`) | JournalEntry | Helm→QBO | never called | none | **Dead code.** Uses Helm account UUIDs as `AccountRef` |
| QBO Payment received in QBO | (Helm Payment) | QBO→Helm | webhook (audit log only) | — | **Stub** |

---

## 3) OAuth & security

### 3.1 How tokens are obtained, stored, refreshed and revoked today

| Concern | Today | Correct QBO behaviour |
|---|---|---|
| Authorize URL / scope | `appcenter.intuit.com/connect/oauth2`, `com.intuit.quickbooks.accounting` (correct, `qbo-sync.ts:7,185`) | Same. Add `openid email profile` only if you need the "Sign in with Intuit" / user-info flow for app review. |
| Token URL / Basic auth | Correct (`qbo-sync.ts:8,46-48,199-211`) | — |
| State/CSRF | Random hex generated, **never stored** (`qbo.ts:33-36` TODO). Other routes use the bare tenantId as state (`settings.ts:468`, `tenants.ts:122`, `onboarding.ts:229`). Callback trusts `state.split(":")[0]` as tenantId (`qbo.ts:63`). | Store a one-time nonce bound to tenant + user, TTL 10 min. Verify it on callback; reject mismatches. |
| Callback reachability | Behind Clerk + nonexistent roles (`qbo.ts:19-20`). Two routes point at `/api/callbacks/qbo`, which does not exist. Onboarding callback is fully unauthenticated (tenant middleware bypass `/api/onboarding`, `tenant.ts:25`; no `clerkAuth` in onboarding router). | One public `/api/integrations/qbo/callback` on a single, registered host (e.g. `api.gethelm.com`), not per-tenant subdomains. Authenticate by state nonce; redirect the browser back to the Settings UI. |
| Token storage | Columns don't exist. Code assumes **plaintext** columns on `Tenant`. | A separate `QboConnection` table: `tenantId @unique`, `realmId @unique`, `accessTokenEnc`, `refreshTokenEnc`, `accessExpiresAt`, `refreshExpiresAt` (`x_refresh_token_expires_in`), `status`, `connectedByUserId`, `lastRefreshAt`, `lastError`. Encrypt with AES-256-GCM via KMS/envelope key; never return tokens to clients. |
| Refresh | Refresh when <5 min left (`:123`), plus once on 401 (`:159`). **No lock**: `syncAll` fires 50 concurrent requests, each can refresh simultaneously with the same refresh token. Intuit rotates refresh tokens; losing the race yields `invalid_grant` and the code then **wipes the tokens** (`:259-268`). | Single-flight refresh per realm (Postgres advisory lock or Redis `SET NX` lock). Always persist the newest `refresh_token`. Distinguish `invalid_grant` (needs re-auth) from 5xx or network errors (retry). Do not wipe on transient 400s. |
| Refresh-token expiry | Not tracked (`x_refresh_token_expires_in` ignored). | Refresh tokens have a rolling 100-day life; access tokens last 60 min. Track and alert; see §8. Intuit has also announced hard caps on refresh-token lifetime (reported Feb 2027 / Oct 2028 depending on scope) and made a **Reconnect URL** mandatory. |
| Disconnect / revoke | Nulls DB fields only (`qbo-sync.ts:802-814`; `settings.ts:484-501` nulls realmId only). **No call to Intuit revoke** (`https://developer.api.intuit.com/v2/oauth2/tokens/revoke`). Leaves `qboCustomerId`/`qboInvoiceId` in place. | Call revoke, mark connection `DISCONNECTED`, keep mapping rows but scope them by `realmId` so reconnecting to a *different* company can never reuse stale IDs. |
| Disconnect URL (Intuit-initiated) | None. | Intuit requires a Disconnect URL. When a user disconnects from the QBO App Center, Helm must mark the connection disconnected. |
| Webhook signature | Optional: skipped if `QBO_WEBHOOK_VERIFIER_TOKEN` is unset (fail-open, `qbo.ts:194`). HMAC is computed over `JSON.stringify(req.body)` after `express.json()` re-serialises it, not over the raw bytes (`qbo.ts:195-198`). String compare is not constant-time. The env var is not in `.env.example`. | Mount the webhook with `express.raw({type:'application/json'})`. HMAC-SHA256 the raw body with the verifier token, base64-encode, `crypto.timingSafeEqual`. Reject if the token is unset. Respond 200 within about 3 s and process asynchronously. |
| Webhook tenancy | `req.tenantId` comes from the request **host**. The Prisma extension then force-injects that tenant into Customer/Invoice queries (`lib/prisma.ts:94-105`), overriding the realm-derived `effectiveTenantId`. | Bypass host-based tenant middleware for the webhook. Resolve tenant by `realmId` (unique) and run each event inside `tenantStore.run({tenantId})`. |
| Environment | `QBO_ENVIRONMENT` defaults to sandbox (`qbo-sync.ts:38`) and is not in `.env.example`; neither are `APP_URL` or the verifier token. | Required env vars validated at boot. Production keys only after Intuit review. |
| Information leakage | Onboarding callback returns the **entire tenant row** and raw Intuit error bodies to the browser (`onboarding.ts:278,288`). `qboRequest` logs full error bodies plus URLs (`qbo-sync.ts:167`). | Return a redirect. Log `intuit_tid` (response header) and fault codes only. |

### 3.2 Findings: OAuth & security

| # | File:line | Problem | Failure scenario | Fix | Sev | Eff |
|---|---|---|---|---|---|---|
| S1 | `schema.prisma:248-271`; `qbo-sync.ts:76-117,260-266,680-683` | Token/expiry/lastSync columns don't exist; TS2353 errors | First connect: token store throws, nothing persists. `syncAll` 500s at the end. | Add a `QboConnection` model (above) and a migration. Remove the `as any` casts. | P0 | M |
| S2 | `routes/qbo.ts:19-20` | `requireRole("admin","manager")`; real roles are `MARINA_OWNER`/`MARINA_MANAGER`/`ACCOUNTING` | Every QBO endpoint 403s in prod (and in dev unless the tenant has no users) | Use the actual enum roles. Gate connect/disconnect to `MARINA_OWNER`. | P0 | S |
| S3 | `routes/qbo.ts:19,50-75,179-213` | Callback and webhook behind Clerk auth | Intuit redirect has no Clerk bearer, so 401. Intuit webhooks are always 401. | Split into a public router (callback, webhook, disconnect-URL) and an authed router. | P0 | S |
| S4 | `qbo.ts:33-36,63`; `settings.ts:468`; `tenants.ts:122`; `onboarding.ts:229,240` | No state validation; tenant taken from attacker-controllable state/path | **Account-linking CSRF:** an attacker completes OAuth with *their own* QBO company and lands the callback on a victim tenant id. The victim's invoices and customers sync into the attacker's books (customer PII exfiltration). The onboarding variant needs no login at all. | Server-side nonce `{tenantId,userId,exp}`, single use. Callback derives tenant from the nonce only. | P0 | S |
| S5 | `settings.ts:452-541`, `onboarding.ts:206-289`, `tenants.ts:115-135`, `qbo.ts` | Four divergent connect flows; two redirect to a nonexistent `/api/callbacks/qbo`; the onboarding one drops tokens | Whichever button a user clicks, the result is a 404, a crash, or "connected" with no tokens | Delete three of them; keep one service and one public callback. Onboarding and Settings both call the same `/api/integrations/qbo/connect`. | P0 | S |
| S6 | `qbo-sync.ts:119-129,237-285,618-622` | No single-flight refresh; tokens wiped on any 400/401 from the token endpoint | 50 parallel requests refresh at once, the losers get `invalid_grant`, and the tenant is silently disconnected mid-sync | Per-realm lock and re-read after acquiring it. Wipe only on `invalid_grant`. Emit a "reconnect required" alert. | P0 | S |
| S7 | `qbo-sync.ts:107-115`; schema | Tokens would be stored in plaintext on `Tenant` (selected by many routes, e.g. `settings.ts:424` loads the whole row) | Any tenant read path or log or DB dump leaks live QBO bearer tokens | Separate table and field-level encryption (KMS). Never `findUnique` the whole row into responses. | P0 | M |
| S8 | `routes/qbo.ts:186-204` | Fail-open signature check, re-serialised body, non-constant-time compare | Spoofed webhooks set any Helm invoice to PAID (`qbo-sync.ts:763-770`) | Raw-body HMAC, `timingSafeEqual`, mandatory token | P0 | S |
| S9 | `qbo-sync.ts:692-700`; `qbo.ts:183` | Legacy `eventNotifications` shape; Intuit's CloudEvents migration deadline has passed | No webhook events are processed even after S3/S8 are fixed | Implement the CloudEvents envelope (`type`, `intuitaccountid`/realm, entity id), or skip webhooks in v1 and rely on CDC polling (§8) | P1 | M |
| S10 | `qbo-sync.ts:802-814`; `settings.ts:484-501` | No Intuit token revoke; stale `qbo*Id` survive a reconnect to a different realm | Reconnect to a new company makes updates hit wrong or nonexistent Ids (`Object Not Found` 610), or worse, valid Ids in the new company | Call revoke. Key all mappings by `(realmId, helmType, helmId)`. | P1 | S |
| S11 | `schema.prisma:257` | `qboRealmId` not unique | Two tenants link the same company; the webhook's `findFirst` picks one arbitrarily | `@unique` on `QboConnection.realmId` | P1 | S |
| S12 | `onboarding.ts:240-289` | Unauthenticated callback returns the full tenant record and Intuit error body | Data disclosure | Remove the endpoint (S5) | P0 | S |
| S13 | `.env.example:14-17` | Missing `QBO_ENVIRONMENT`, `QBO_WEBHOOK_VERIFIER_TOKEN`, `APP_URL`, token-encryption key | Prod silently runs against **sandbox** (`qbo-sync.ts:38` default) | Boot-time env validation (zod) | P1 | S |

---

## 4) Reliability (retries, rate limits, errors, observability)

| # | File:line | Problem | Failure scenario | Fix | Sev | Eff |
|---|---|---|---|---|---|---|
| R1 | `workers/index.ts:221-229`; `invoices.ts:485-486`; no worker entry point | Queue worker is a stub; nothing enqueues; worker process never runs | No automatic sync of anything, ever | Build the job catalog in §8 and add a `worker` service to Docker/compose | P0 | L |
| R2 | `qbo-sync.ts:602-686`; `qbo.ts:81-97` | Full sync runs synchronously inside an HTTP request, with no pagination or cursor | A tenant with 3k customers and 20k invoices hits proxy/request timeouts; a partial run leaves no resumable state | Enqueue a job; return 202 plus a job id; page through records; resume from checkpoints | P0 | M |
| R3 | `qbo-sync.ts:607,618-622` | 50 concurrent requests per batch; no rate limiter | QBO allows 500 req/min per realm and 10 concurrent requests per realm. Batches of 50 trigger HTTP 429 (`ThrottleExceeded`) at once, and these are counted as failures. | BullMQ group/limiter per realm: max 8 concurrent, about 400/min. Use the `/batch` endpoint (≤30 ops per call, max 40 batch req/min per realm) for backfills. | P0 | M |
| R4 | `qbo-sync.ts:135-172` | No handling for 429/5xx/timeouts; no `Requestid` header; errors are opaque strings | Transient 503s become permanent failures. A retried POST after a network timeout creates a **duplicate** Invoice or Payment in QBO. | Retry 429/5xx with exponential backoff plus jitter (honor `Retry-After`). Send `Requestid: <stable uuid per logical op>` on every POST so QBO dedupes replays. 15 s fetch timeout. Parse `Fault.Error[].code/Detail` and capture the `intuit_tid` header. | P0 | M |
| R5 | `qbo-sync.ts:440-542` | `syncPayment` never checks `qboPaymentId` | Each `syncAll` creates every payment again. Customers show as overpaid, cash is overstated, and duplicate Undeposited Funds pile up. (The mock support ticket "QuickBooks sync duplicating invoices", `apps/admin/src/pages/Support.tsx:24`, describes exactly this.) | Idempotency via a `QboSyncRecord` unique `(realmId, helmType, helmId)`, checked before create. Payments are immutable once synced (changes become void + recreate, or refund). | P0 | S |
| R6 | `qbo-sync.ts:337-343,422-427,493-498` | Create-then-store-Id is not atomic | Crash or timeout after the QBO create but before the DB update: the next run creates a second copy | Write a `PENDING` sync record with a pre-generated `Requestid` first, then reuse the same `Requestid` on retry (QBO returns the original response) | P0 | S |
| R7 | `qbo-sync.ts:324-334,409-419` | Read-then-write SyncToken without handling stale-token error (5010) | A concurrent edit in QBO causes a permanent failure | On 5010, re-GET and retry once. For Helm-authoritative docs, consider blocking edits in QBO. | P2 | S |
| R8 | `qbo-sync.ts:327,334,…` | `minorversion=73` hard-coded | Intuit ignores versions below 75 since 1 Aug 2025, so behaviour silently follows v75 | One constant `QBO_MINOR_VERSION=75`; contract-test against v75 | P2 | S |
| R9 | `qbo-sync.ts:628,650,672,787-792`; `auditLog` | Failures only `console.error`; audit log records success only; webhook errors swallowed | No user ever learns an invoice failed to sync. Books drift silently. | Persist per-entity `status`, `lastError`, `attempts`, `nextAttemptAt` in `QboSyncRecord`. Dead-letter after N attempts. Show this in the UI (§8.5). Send to Sentry with tags `tenantId/realmId/intuit_tid`. | P0 | M |
| R10 | `qbo-sync.ts:231-234` | Initial sync fired-and-forgotten inside the API process after callback | API restart mid-sync loses the work silently; it also competes with request handling | Enqueue `qbo.initial-sync`, and require mapping setup to finish before the first sync (see §5) | P1 | S |
| R11 | `qbo-sync.ts:749-778` | Webhook overwrites Helm `balanceCents`/`status` from QBO without a Helm payment or GL entry | Staff record a check in QBO: Helm shows PAID, Helm's GL still shows AR open, and the AR aging and GL summary disagree. Also lets QBO undo Helm-originated state. | Pick a single system of record for AR (Helm, see §5). Inbound changes create a "QBO-originated payment" Helm Payment through the normal posting path, or raise a reconciliation exception for staff to approve. | P1 | M |
| R12 | `lib/queue.ts:30-32` | No `defaultJobOptions` (attempts, backoff, removeOnComplete/Fail) | Failed jobs are lost after one attempt, and Redis memory grows unbounded | See §8.2 | P1 | S |
| R13 | No reconciliation | Nothing compares Helm AR/GL with QBO | Drift is found only by the marina's accountant at month end | Nightly AR-by-customer and invoice balance diff; CDC pull; exceptions list | P1 | M |
| R14 | Tests: only `tests/setup.ts:114` mocks the queue; `tests/services/gl-posting.test.ts` mocks account lookups | Zero QBO tests; GL tests mock away the account-number mismatch (G2) | Regressions undetected | Contract tests with recorded sandbox fixtures; nock-style tests for 401/429/5010/duplicate `Requestid`; a GL test against seeded accounts | P1 | M |
| R15 | App Partner Program metering | Since late 2025, QBO API **reads** count against tiered data-out quotas (the free Builder tier is capped at 500k reads/month); writes are not metered | Read-heavy designs (GET-before-every-update, full re-reads in webhooks) burn quota across all tenants; 429s on token refresh once the budget is exhausted have been reported | Prefer CDC over per-entity GETs; cache SyncTokens from write responses; budget reads per tenant | P2 | S |

---

## 5) Accounting design critique and recommended target design

### 5.1 What exists

Helm runs its **own double-entry GL** (`GlEntry`/`GlAccount`) and *also* tries to push **documents** (Customer/Invoice/Payment) to QBO. There is no defined system of record and no mapping layer, and the two models overlap in contradictory ways: invoices are document-synced, but the GL would be journal-synced (dead code). Doing both would double-post revenue in QBO.

### 5.2 Findings: GL / accounting correctness

| # | File:line | Problem | Failure scenario | Fix | Sev | Eff |
|---|---|---|---|---|---|---|
| G1 | `qbo-sync.ts:382-392` | `Amount: item.totalCents/100` (field doesn't exist; it is `extendedCents`), `UnitPrice` ignores `discountCents`, no `ItemRef` (line items have no `qboItemId`) | `NaN` serialises to `null` and QBO rejects with a validation fault. If fixed naively, QBO requires `Amount == Qty×UnitPrice` (error 6070), and lines land on the default item's income account, not the right revenue account. | Map each line to an Item via the mapping table. Send `Qty`, `UnitPrice`, `Amount=extendedCents/100`. Send a discount via `DiscountLineDetail` or net into the price. | P0 | M |
| G2 | `gl-posting.ts:85-96` vs `prisma/seed/gl-accounts.ts:7-31` vs `onboarding.ts:309-327` | Hard-coded account numbers disagree with both seeds. AR = 1200 (seed: 1100); Deferred = 2400 (seed: **Tips Payable**; onboarding: **Sales Tax Payable**); Security deposits = 2300 (seed: **Sales Tax Payable**; onboarding: Tips Payable); General revenue 4500 = *Retail Revenue*; 1000/4000 missing | Seeded tenants: `postInvoice` throws "GL account 1200 not found", so **invoice issue fails**. Onboarding-seeded tenants (if the seed ran; it also has field-name bugs, `onboarding.ts:333`): deferred revenue is credited to Sales Tax Payable. If exported to QBO, the liabilities are misstated. | Replace number conventions with a per-tenant **posting-role map** (`AR`, `UNDEPOSITED_FUNDS`, `STRIPE_CLEARING`, `DEFERRED_REVENUE`, `SALES_TAX_PAYABLE`, `DEPOSITS_HELD`, `PROCESSING_FEES`, revenue by charge type). Each role maps to a Helm GlAccount *and* a QBO Account. Validate completeness before enabling sync. | P0 | M |
| G3 | `gl-posting.ts:132-153`; `deferred-revenue.ts:29` | Line tax is credited to **revenue** (and to deferred revenue, then recognized as revenue) | Sales tax collected is overstated as income and Sales Tax Payable is understated, which is a tax-filing error for every marina | Credit `taxCents` to Sales Tax Payable by jurisdiction; defer only `extendedCents` | P0 | S |
| G4 | `qbo-sync.ts:394-403` | No tax on QBO invoices (`TxnTaxDetail`/`TaxCodeRef` absent); `Customer.taxExempt` not mapped | QBO invoice total ≠ Helm total (Helm includes tax). Payments overapply (unapplied credits). For US companies on **Automated Sales Tax** QBO may compute its *own* tax, so the amounts differ again. | Detect AST (`Preferences.TaxPrefs` / company region). **US AST:** send `TxnTaxDetail.TxnTaxCodeRef` = `TAX`/`NON` per line plus a ship-from/ship-to address, and accept that QBO computes the tax, *or* (preferred for parity) post tax as a separate line to a "Sales Tax (Helm-calculated)" item mapped to a liability account, with lines marked `NON`. **Non-AST/manual:** map Helm tax rates to QBO `TaxCode`s and set `TxnTaxCodeRef` plus `TotalTax`. Map `taxExempt` to `Taxable=false` + `TaxExemptionReasonId`. | P0 | M |
| G5 | `qbo-sync.ts:466-541` | Payment for a not-yet-synced invoice becomes a **SalesReceipt** | The invoice later syncs too, so revenue is counted twice and the invoice stays open in QBO forever | Payment job depends on the invoice job: if the invoice is unsynced, enqueue the invoice first, or delay with backoff. SalesReceipts only for true cash sales. | P0 | S |
| G6 | `qbo-sync.ts:487-491` | `PaymentMethodRef.value` set to a name ("CreditCard"/"ACH") | QBO rejects the reference (`Object Not Found`/invalid ref) | Query and cache `PaymentMethod` ids per realm (or create "Stripe Card"/"Stripe ACH"); store them in the mapping | P0 | S |
| G7 | `qbo-sync.ts:469-484` | No `DepositToAccountRef` | Defaults to Undeposited Funds, which is *correct* for Stripe, but nothing ever clears it (no Deposit), so UF grows forever and bank reconciliation is impossible | Explicitly map to UF (or a "Stripe Clearing" bank account). Sync Stripe **payouts** as QBO `Deposit` linking the payments, plus a negative line for Stripe fees to a Processing Fees expense account. | P0 | M |
| G8 | `gl-posting.ts:174-178` | Card, ACH and cash-equivalents all debit "Bank" (1010) at capture | Helm GL claims cash is in the bank days before the Stripe payout; fees are never booked | Debit Stripe Clearing at capture; on payout, debit Bank (net) + Fees and credit Clearing (gross) | P1 | M |
| G9 | Missing | Voids, refunds, partial refunds, ACH returns, chargebacks, write-offs not propagated | Helm voids an invoice and QBO still shows it open. A refunded payment stays received in QBO. AR and cash are overstated. | Void, then `POST invoice?operation=void` (keeps an audit trail). Refund of an applied payment becomes a `RefundReceipt` (or `CreditMemo` + `RefundReceipt`). ACH return voids the QBO Payment (`payment?operation=void`), and the R-code fee becomes an invoice. Chargeback becomes a JE (or Expense) to a Chargebacks account. Write-off becomes a CreditMemo to Bad Debt. | P0 | L |
| G10 | `qbo-sync.ts:634-638` | `syncAll` pushes DRAFT and VOID invoices | Drafts appear as real AR in QBO | Only push `ISSUED`+ statuses; void handling per G9 | P0 | S |
| G11 | `qbo-sync.ts:300-307` | Customer create with no dedupe; DisplayName must be unique across Customer/Vendor/Employee | Two "John Smith"s, or a marina whose QBO already has its customers: error 6240 "Duplicate Name Exists" or duplicate customers | On first connect, a **match step**: query QBO customers (by email, then DisplayName) and propose matches in the UI. On create, use DisplayName `"{First} {Last} ({helmCustomerNo})"` and retry with a suffix on 6240. Store `qboCustomerId`. | P0 | M |
| G12 | `billing.ts:129`; `contracts.ts:43,58` | `contract.qboItemId` (free-text QBO Item id) is stuffed into `InvoiceLineItem.glAccountId` (FK to GlAccount) | FK violation or a random account; recurring billing fails or posts to the wrong revenue account | Separate concerns: `ChargeType → {glAccountId, qboItemId}` mapping; the contract references a ChargeType | P0 | S |
| G13 | `deferred-revenue.ts:94`; jobs | `recognizeDeferred` never scheduled; `createDeferredSchedule` opens its own `prisma.$transaction` inside the caller's tx (`deferred-revenue.ts:67` called from `invoices.ts:473`, `billing.ts:249`) | Deferred never recognized, so the P&L understates revenue on annual/seasonal slips (the biggest revenue line at most marinas). Nested transactions give partial writes or deadlocks. | Monthly job (§8). Accept a `tx` param. In QBO, post one recognition JE per tenant per month (Dr Deferred / Cr Slip Revenue by class). | P0 | M |
| G14 | `qbo-sync.ts:548-596` | `postJournalEntry` sends Helm UUIDs as `AccountRef`; `TxnDate` = now; no link to `GlEntry` | If ever wired up: every JE fails with an invalid reference | Map role → `qboAccountId`; date from the source; store the QBO JE id on a `QboSyncRecord` for the journal | P1 | S |
| G15 | `qbo-sync.ts:401` | `DocNumber` sent, but QBO only honours it when the company has Custom transaction numbers on; collisions with QBO-native invoices | Duplicate invoice numbers, or numbers silently ignored | Read `Preferences.SalesFormsPrefs.CustomTxnNumbers`. Prefix Helm numbers (e.g. `H-1001`). Use `include=allowduplicatedocnum` only intentionally. | P2 | S |
| G16 | Missing | No Class/Location mapping | Multi-location operators can't get P&L by marina | Map `Location` → QBO Class (or Department/Location) on every line/txn | P2 | M |
| G17 | `qbo-sync.ts:310-318`; `schema.prisma:416` | Address read from nonexistent `addressLine1…`; actual field is `addressJson` | `BillAddr` is never sent; AST cannot compute tax without an address | Map from `addressJson` | P1 | S |

### 5.3 Invoice-level sync vs. daily summary journal entries: which fits a marina?

| | Invoice-level document sync | Daily/periodic summary JEs |
|---|---|---|
| AR & aging in QBO | Real customer AR and aging in QBO, so the accountant can collect and statement from QBO | AR is a single control-account balance; no per-customer detail in QBO |
| Volume / rate limits | Fine for slip billing (hundreds to low thousands of invoices a month); bad for POS/fuel (thousands of small tickets a day) | Very low volume; trivially within limits |
| Sales tax | Can carry line tax codes; works with AST | Tax must be journaled to the liability; QBO sales-tax center won't reflect it (manual filing from Helm reports) |
| Edit/void propagation | Must handle void/refund/credit per document | Corrections appear as adjusting JEs in later periods |
| Accountant expectations | Marinas' bookkeepers usually expect customers and invoices in QBO for slip holders | Accountants accept summaries for retail/fuel |
| Duplication risk | High unless idempotency is solid | Low (one JE per tenant per day, keyed by date) |

**Recommendation: hybrid, with Helm as the system of record for AR and operations, and QBO as the books of record.**

1. **Slip/contract, storage, service and other billed AR (Helm invoices).** Document-level sync: `Customer`, then `Invoice` (lines → Items mapped per charge type → Income accounts; Class = location; tax per §G4). Payments become `Payment` linked to the Invoice, deposited to **Undeposited Funds**.
2. **Payments.** Card and ACH via Stripe become `Payment` to UF. Each **Stripe payout** becomes a QBO `Deposit` that groups the linked Payments plus a negative fee line (Processing Fees expense), so the deposit amount equals the bank line and bank feeds reconcile automatically. Cash and check payments go to UF and are grouped by the staff "bank deposit" batch.
3. **POS, fuel, retail, transient walk-ups, ramp, rentals paid at the counter.** One **daily summary `SalesReceipt` per location** (lines per Item/revenue category, tax line(s), payment-method split) deposited to UF, or a daily JE if the marina prefers. Fuel COGS/inventory remain in Helm or are a periodic JE.
4. **Deferred revenue (annual/seasonal prepaid slips).** Invoice lines for deferred contracts map to an Item whose income account is the **Deferred Revenue liability**. A **monthly recognition JournalEntry** (Dr Deferred Revenue / Cr Slip Revenue, per class) is generated from `DeferredEntry` rows and keyed `(tenant, YYYY-MM)`.
5. **Security deposits.** Item mapped to a "Customer Deposits Held" liability. Release/apply becomes a CreditMemo applied to the invoice, or a RefundReceipt.
6. **Corrections.** Void → `invoice?operation=void`. Refund → `RefundReceipt`. Credit → `CreditMemo`. ACH return → `payment?operation=void` + R-fee invoice. Chargeback → JE.
7. **Do NOT also push Helm `GlEntry` rows to QBO** for anything already sent as documents. Helm's internal GL stays as an operational sub-ledger and drives the reconciliation report.
8. **Inbound (QBO → Helm).** Limited to (a) detecting QBO-side payments or edits on Helm-originated invoices, which raise reconciliation exceptions or are imported as Helm payments, and (b) customer contact updates (optional, conflict rules). No silent overwrites of Helm balances.

Mapping UI prerequisites before the first sync: Income/liability/fee/UF accounts per role, Items per charge type (auto-create offered), PaymentMethods, Tax mode (AST vs manual, with tax code mapping), Class per Location, a customer-match review, and a **sync start date** (do not backfill historical invoices by default; offer opening-AR import instead).

---

## 6) Intuit production-readiness checklist

| Requirement (Intuit production keys / App Store listing) | Status | Notes / action |
|---|---|---|
| Production keys require completing the **app assessment / security questionnaire** in the developer portal | ❌ Not started | Allow 1–4 weeks. Covers TLS, token encryption at rest, secure storage of client secret, logging, pen-test or vuln scanning, incident contacts. |
| Production redirect URI(s) registered, HTTPS, exact match | ❌ | Single host (`https://api.gethelm.com/api/integrations/qbo/callback`); per-tenant subdomains are not practical |
| **Launch URL** (opens Helm from QBO App Center / the user is sent to log in, then connect) | ❌ | Add `/integrations/qbo/launch` that routes to login and then Settings → Integrations |
| **Disconnect URL** (Intuit calls it or sends the user there when they disconnect in QBO) | ❌ | Mark connection disconnected, show a reconnect banner |
| **Reconnect URL** (now mandatory app setting) | ❌ | Route straight into a fresh OAuth flow for that tenant |
| Privacy policy, EULA/Terms, support URL, host domain | ❓ | Product/legal |
| State/CSRF protection on OAuth | ❌ | S4 |
| Tokens encrypted at rest; client secret in a secret manager | ❌ | S7, S13 |
| Refresh-token handling: store latest, handle `invalid_grant`, proactive refresh | ❌ | S6, §8.3 |
| Revoke tokens on user disconnect | ❌ | S10 |
| Error handling shows user-friendly messages, logs `intuit_tid` | ❌ | R4, R9 |
| Respect throttling (500/min/realm, 10 concurrent, batch 40/min) with backoff | ❌ | R3 |
| `minorversion=75` | ⚠️ 73 hard-coded (silently upgraded) | R8 |
| Webhooks: CloudEvents format, verifier-token HMAC on raw body, 200 OK fast | ❌ | S8, S9 |
| "Connect to QuickBooks" button uses Intuit-branded button assets and naming ("QuickBooks Online"; not implying Intuit endorsement) | ❌ | Settings/Onboarding use generic buttons |
| Users can see what is synced and errors (reviewers test a happy path and a failure path) | ❌ | §8.5 |
| No duplicate-data creation on retry (reviewers flag duplicates) | ❌ | R5, R6, `Requestid` |
| Sandbox end-to-end test across US company types (AST on/off, multicurrency off) | ❌ | Build a test matrix with 2–3 sandbox companies |
| App Partner Program tier chosen (read metering) | ❌ | R15 |

---

## 7) Prioritized fix/build list

**Phase 0: make it safe (and hide it until ready).** Week 1.
1. Remove or feature-flag every QBO entry point in the UI. Replace the hard-coded "Connected" card with real `/status` data (Settings.tsx:993-1009). Stop Onboarding marking connected on window open (Onboarding.tsx:426-428). *(P0, S)*
2. Delete the duplicate connect/callback routes (`settings.ts:452-541`, `onboarding.ts:206-289`, `tenants.ts:115-135`). Fix role names and split public/authed routers (S2, S3, S5, S12). *(P0, S)*

**Phase 1: foundation.** About 1.5 weeks.
3. Schema: `QboConnection` (encrypted tokens, unique realm), `QboSyncRecord` (realmId, helmType, helmId, qboType, qboId, syncToken, requestId, status, attempts, lastError, lastSyncedAt; unique `(realmId, helmType, helmId)`), `QboMapping` (role/chargeType/paymentMethod/taxCode/location → QBO id), `QboOutbox`. *(P0, M)*
4. OAuth rebuild: nonce state, single public callback, encryption, single-flight refresh, revoke, Disconnect/Launch/Reconnect URLs (S1, S4, S6, S7, S10, S11). *(P0, M)*
5. `QboClient`: minorversion 75, `Requestid`, timeout, typed Fault parsing, 429/5xx backoff, per-realm limiter, `intuit_tid` logging, batch support (R3, R4, R8). *(P0, M)*
6. Fix Helm GL posting first, since QBO mirrors it: posting-role map replacing hard-coded numbers (G2), tax to liability (G3), Stripe clearing (G8), `qboItemId`/`glAccountId` separation (G12), deferred tx and scheduling (G13). *(P0, M)*

**Phase 2: v1 sync.** About 2 weeks.
7. Mapping & setup wizard: accounts per role, Items per charge type (auto-create), PaymentMethods, tax mode (AST vs manual) and codes, Classes, customer match review, sync start date (G4, G6, G11, G16). *(P0, L)*
8. Outbox producers in invoice issue/void, payment capture/refund, ACH return and payout handlers. Workers for Customer/Invoice/Payment/Void/RefundReceipt/CreditMemo with dependency ordering (G1, G5, G9, G10, R5, R6). *(P0, L)*
9. Stripe payout → QBO Deposit with fee line (G7). *(P0, M)*
10. Monthly deferred-recognition JE; daily POS/fuel summary SalesReceipt (G13, §5.3). *(P1, M)*
11. Integration Health UI plus error log and retry (§8.5, R9). *(P0, M)*

**Phase 3: hardening and review.** About 1 week, plus Intuit lead time.
12. Nightly reconciliation (AR by customer, open invoice balances) and CDC pull; CloudEvents webhook as an accelerator only (R11, R13, S9). *(P1, M)*
13. Tests: contract fixtures, failure-mode tests, GL-with-real-seed tests (R14). *(P1, M)*
14. Intuit security questionnaire, branding, production keys (§6). *(P0, M + external wait)*
15. Class/location, DocNumber prefs, SyncToken conflict handling, read-metering budget (G15, G16, R7, R15). *(P2, S–M)*

---

## 8) Scheduling & job design for QBO

### 8.0 Current state (confirmed)

- `workers/index.ts:221-229`: the `qbo-sync` worker body is `console.log` plus a TODO.
- No `schedule*` function is ever called: `scheduleAlgorithmicPricing` (`jobs/algorithmic-pricing.ts:186`), `scheduleAutoRenewChecks` (`jobs/renewal-job.ts:86`), `scheduleTenantLifecycle` (`jobs/tenant-lifecycle.ts:231`).
- `apps/api/src/workers/index.ts` has no script in `apps/api/package.json`, no `CMD` in `Dockerfile.api`, and no service in `docker-compose*.yml`, so **no worker process ever runs**.
- `recognizeDeferred()` (`services/deferred-revenue.ts:94`) has no caller.
- The workers query snake_case fields that don't exist: `tenant.active` (`workers/index.ts:101`), `tenant_id`/`first_name` (`:116-117`). These are TS2353/TS2561 errors and would throw at runtime.
- `lib/queue.ts:30-32` creates queues with no default job options.

### 8.1 What should trigger sync

| Mechanism | Use for | Why |
|---|---|---|
| **Event-driven enqueue (primary)** via a transactional **outbox** | Invoice issued/voided, payment completed/refunded, ACH return, chargeback, deposit applied/released, customer created/updated (only once linked), Stripe `payout.paid` | Near-real-time books. The outbox row is written in the *same DB transaction* as the Helm change, so no event is lost if Redis is down. A dispatcher moves rows into BullMQ. |
| **Scheduled batch** | Daily POS/fuel summary per location (after the location's local close), monthly deferred-recognition JE, nightly retry of stuck items | These are period aggregates by nature |
| **Nightly reconciliation** | Compare Helm open invoices and AR by customer against QBO (`query` + CDC), list exceptions | Safety net for anything missed; required before trusting the integration |
| **CDC pull** (`GET /v3/company/{realm}/cdc?entities=Invoice,Payment,Customer,CreditMemo&changedSince=…`, ≤30-day lookback, max 1,000 objects per entity per response) | Detect QBO-side edits, payments and deletes on Helm-originated records | More reliable than webhooks (given the CloudEvents migration and the delivery issues Intuit has acknowledged); cheaper in read quota than per-entity GETs |
| **Webhook (accelerator only)** | CloudEvents notification triggers an immediate CDC pull for that realm (debounced) | Never processed inline; never trusted for data, just a "go look" signal |
| **Manual "Sync now"** | Enqueues `qbo.retry-failed` plus `qbo.outbox-drain` for the tenant | Not a full re-push of everything |

### 8.2 Job catalog

General BullMQ settings:
- `defaultJobOptions: { attempts: 8, backoff: { type: 'exponential', delay: 30_000 }, removeOnComplete: { age: 7*86400, count: 5000 }, removeOnFail: false }`.
- Per-realm throttling: BullMQ Pro *groups*, or OSS with a Redis token-bucket keyed `qbo:rl:{realmId}` (450 tokens/min) plus a semaphore of 8 concurrent per realm. Global worker concurrency 20–30.
- On a 429, `job.moveToDelayed(now + Retry-After|60s)` without consuming an attempt (BullMQ `RateLimitError` / `Worker.RateLimitError()`).

| Job name | Queue | Schedule | Fan-out | Dedupe `jobId` | Concurrency / limits | Retries / backoff | Dead-letter & alert |
|---|---|---|---|---|---|---|---|
| `qbo.outbox-dispatch` | `qbo-control` | every 15 s (job scheduler) | global; reads `QboOutbox` where `status=PENDING` `FOR UPDATE SKIP LOCKED` | `outbox-dispatch` (singleton) | 1 | n/a (next tick) | Alert if oldest PENDING > 15 min |
| `qbo.push.customer` | `qbo-sync` | event | per entity | `cust:{realmId}:{customerId}` | per-realm limiter | 8 × exp(30 s) → ~2 h | After final attempt: `QboSyncRecord.status=FAILED`, error shown in UI; Sentry |
| `qbo.push.invoice` | `qbo-sync` | event | per entity; first ensures the customer (enqueues and waits via flow/parent-child) | `inv:{realmId}:{invoiceId}:{version}` | same | same; validation faults (4xx non-429) → **no retry**, FAILED immediately with message | same |
| `qbo.void.invoice` | `qbo-sync` | event | per entity; depends on push.invoice | `void:{realmId}:{invoiceId}` | same | same | same |
| `qbo.push.payment` | `qbo-sync` | event | per entity; depends on the invoice being synced (parent job) | `pay:{realmId}:{paymentId}` | same | same | same |
| `qbo.push.refund` / `qbo.push.creditmemo` / `qbo.void.payment` (ACH return) | `qbo-sync` | event | per entity | `refund:{realmId}:{refundId}` etc. | same | same | same |
| `qbo.push.deposit` (Stripe payout) | `qbo-sync` | Stripe `payout.paid` webhook | per payout; waits for all linked payments | `dep:{realmId}:{payoutId}` | same | same; if linked payments are unsynced, delay 10 min, max 24 h | Alert: payout not posted within 24 h |
| `qbo.daily-summary` | `qbo-sync` | `0 3 * * *` **per tenant TZ**: the scheduler runs hourly and enqueues tenants whose local time is 03:00 | per tenant × location | `daily:{realmId}:{locationId}:{YYYY-MM-DD}` | same | same | Alert if previous day missing by 09:00 local |
| `deferred.recognize` (Helm GL) | `deferred-revenue` | `15 2 1 * *` + daily catch-up | per tenant | `defrec:{tenantId}:{YYYY-MM}` | 4 | 5 × exp(5 min) | Alert on any failure (P&L impact) |
| `qbo.push.deferred-je` | `qbo-sync` | after `deferred.recognize` completes (flow child) | per tenant | `defje:{realmId}:{YYYY-MM}` | same | same | same |
| `qbo.token-refresh` | `qbo-control` | `*/10 * * * *` | per connection where `accessExpiresAt < now+15 min` **or** `lastRefreshAt < now-24h` (keeps the 100-day window rolling for idle tenants) | `refresh:{realmId}:{10-min bucket}` | 5; per-realm lock | 5 × exp(1 min); `invalid_grant` → no retry | `invalid_grant` → `status=REAUTH_REQUIRED`, email owner + in-app banner |
| `qbo.reauth-warning` | `qbo-control` | `0 14 * * *` | per connection where `refreshExpiresAt` within 30/14/7/1 days (or a hard-cap date approaching), or `REAUTH_REQUIRED` | `reauth:{realmId}:{date}` | 5 | 3 | Email + banner; Slack/PagerDuty to Helm support if >3 days in REAUTH_REQUIRED |
| `qbo.cdc-pull` | `qbo-sync` | every 30 min + webhook-triggered (debounced 60 s) | per connected realm | `cdc:{realmId}:{30-min bucket}` (webhook: `cdc:{realmId}:wh`, with `delay` 60 s; a duplicate add is a no-op) | same | 5 × exp(1 min) | Stores `cdcCursor`; alert if cursor older than 25 days (CDC lookback is 30 days) |
| `qbo.reconcile` | `qbo-sync` | `0 4 * * *` per tenant TZ | per realm | `recon:{realmId}:{date}` | same; uses `query` with paging (`STARTPOSITION/MAXRESULTS 1000`) | 3 | Exceptions written to `QboReconException`; email digest if count > 0 |
| `qbo.retry-failed` | `qbo-control` | `0 */6 * * *` + manual | per realm | `retry:{realmId}:{6h bucket}` | 1 per realm | n/a | Re-enqueues FAILED items whose error is retryable or whose mapping was since fixed |
| `qbo.initial-setup` | `qbo-sync` | on connect | per realm: loads Accounts, Items, TaxCodes, PaymentMethods, Classes, Preferences, CompanyInfo (into a cache) and customer match candidates | `setup:{realmId}:{connectionId}` | same | 5 | Wizard shows failure |
| `qbo.backfill` (optional) | `qbo-sync` | manual from wizard | per realm; uses `/batch` (30 ops) | `backfill:{realmId}:{range}` | ≤ 30 batch req/min | resumable checkpoints | Progress bar in UI |

Dead-letter:
- Keep failed jobs (`removeOnFail:false`) **and** mirror the state to `QboSyncRecord.status=FAILED` with `lastErrorCode`, `lastErrorMessage` and `intuitTid`. The DB is the user-visible DLQ; BullMQ is not.
- A Bull Board admin view (already partly in `routes/admin.ts:43`) gives platform staff a view.
- Alert channels: Sentry (per-error), a daily email digest to marina owner/accounting role, and a Helm-ops pager when >5% of a realm's jobs fail in 1 h or any realm is in REAUTH_REQUIRED for >72 h.

### 8.3 Token-refresh scheduling

- Access tokens last 60 min. `QboClient` refreshes **on demand** if `<5 min` remain, under a per-realm lock: `pg_advisory_xact_lock(hash(realmId))`, or Redis `SET qbo:lock:{realmId} NX PX 30000`. After acquiring the lock, re-read the row; if another worker already refreshed, use its token.
- `qbo.token-refresh` keeps tokens warm and, importantly, refreshes **at least once every 24 h for every connection**. This rolls the 100-day refresh-token window so idle tenants (seasonal marinas in winter) don't silently expire.
- Persist `x_refresh_token_expires_in` as `refreshExpiresAt` and always store the newest `refresh_token` returned. Intuit may rotate it, and the old one dies soon after.
- Classify errors: `invalid_grant` → REAUTH_REQUIRED, no retry. 5xx/timeout → retry; keep the connection ACTIVE. Treat bursts of `invalid_grant` across *many* realms as a likely Intuit outage (Intuit's docs note `invalid_grant` can appear during outages): page Helm ops before mass-disconnecting.
- Re-auth alerts at 30/14/7/1 days before `refreshExpiresAt`, or before any announced hard-expiry date, and immediately on REAUTH_REQUIRED. The banner deep-links to the Reconnect flow.

### 8.4 Multi-instance safety

- Run **schedulers in exactly one place**. Use BullMQ **Job Schedulers** (`queue.upsertJobScheduler(id, { pattern, tz }, template)`, BullMQ ≥ 5.16; the repo has `^5.71.1`) instead of legacy `repeat` options. `upsertJobScheduler` is idempotent by id, so calling it from every instance at boot is safe: no duplicate schedules, and changed cron patterns replace the old one. Replace the `repeat:` usages in `jobs/algorithmic-pricing.ts:188` and `jobs/tenant-lifecycle.ts:236`.
- Per-tenant-timezone jobs: one global hourly scheduler (`qbo.tz-tick`) enqueues per-tenant jobs whose local hour matches. This avoids N per-tenant schedulers.
- Workers are horizontally scalable. Correctness comes from deterministic `jobId`s (BullMQ ignores a duplicate add while the job exists), the DB unique `(realmId, helmType, helmId)` on `QboSyncRecord`, `Requestid` on every QBO POST, and per-realm locks for refresh and for "create-if-not-exists" on Customer/Item.
- Outbox dispatch uses `SELECT … FOR UPDATE SKIP LOCKED`, so multiple dispatchers are safe.
- Graceful shutdown: `worker.close()` waits for active jobs (already present, `workers/index.ts:265-276`). Set `lockDuration` ≥ 60 s for QBO jobs, and keep the stalled-job checker on.

### 8.5 Sync status / health UI spec (Settings → Integrations → QuickBooks Online)

1. **Connection card.** Company name and realm (from CompanyInfo), environment (Sandbox/Production badge), connected by and date, status (Connected / Reconnect required / Disconnected / Syncing paused). Refresh-token expiry countdown when < 30 days. Buttons: Reconnect, Disconnect (with revoke), Pause sync. Uses the Intuit-branded connect button.
2. **Setup checklist** (blocks enabling sync until complete): Account mappings per posting role; Items per charge type; Payment methods; Tax mode and codes; Classes/locations; Customer matching (N matched / N new / N conflicts); Sync start date.
3. **Health summary.** Last successful push, last CDC pull, last reconciliation; counts of Pending / Synced (24 h) / Failed / Needs attention; oldest pending age; next scheduled daily summary and deferred JE.
4. **Activity & error log.** Table of `QboSyncRecord`, filterable by entity type and status. Columns: Helm record (link), QBO doc (deep link `https://app.qbo.intuit.com/app/invoice?txnId=…`), action, status, attempts, last error (human message mapped from Fault code, e.g. "Duplicate customer name. Rename or link to the existing QBO customer"), `intuit_tid` (copy). Row actions: Retry, Link to existing QBO record, Skip/Ignore (with reason, audit-logged).
5. **Reconciliation tab.** Exceptions from `qbo.reconcile` (invoice balance mismatch, payment in QBO not in Helm, voided in QBO, deleted in QBO), each with Resolve actions.
6. **Per-record badges.** On InvoiceDetail, CustomerDetail and payment rows, a small "QBO: Synced / Pending / Failed" chip with a tooltip and a Retry action.
7. **Chart of Accounts** (`ChartOfAccounts.tsx`). Replace mock `qboLinked` with real `GlAccount.qboAccountId` mappings and a "Map to QBO account" picker fed from the cached QBO Account list. Also fix the API shape mismatch: the page expects an array, but `/api/reports/gl-summary` returns `{period, accounts}` (`reports.ts:155-177`).
8. **Notifications.** In-app banner plus email to MARINA_OWNER and ACCOUNTING roles on REAUTH_REQUIRED, on daily failures > 0, and on missing daily summary or payout deposit.

API endpoints backing this: `GET /api/integrations/qbo/status`, `GET /api/integrations/qbo/sync-records?status=&type=&cursor=`, `POST /api/integrations/qbo/sync-records/:id/retry`, `POST …/:id/link`, `GET/PUT /api/integrations/qbo/mappings`, `GET /api/integrations/qbo/reference/{accounts|items|taxcodes|paymentmethods|classes}`, `GET /api/integrations/qbo/reconciliation`, `POST /api/integrations/qbo/pause|resume`.

### 8.6 File-level implementation steps

1. **`apps/api/prisma/schema.prisma`**: add `QboConnection`, `QboSyncRecord`, `QboMapping`, `QboOutbox`, `QboReconException`; `PostingRole` enum; `ChargeType` (glAccountId, qboItemId); remove `Tenant.qboRealmId` after migrating. Create the first migration (no `prisma/migrations` directory exists today).
2. **`apps/api/src/lib/crypto.ts`** (new): AES-256-GCM `encrypt/decrypt` with a key from the secret manager (`QBO_TOKEN_KEY`).
3. **`apps/api/src/lib/env.ts`** (new): zod-validated env (`QBO_CLIENT_ID/SECRET`, `QBO_ENVIRONMENT`, `QBO_REDIRECT_URI`, `QBO_WEBHOOK_VERIFIER_TOKEN`, `QBO_TOKEN_KEY`, `APP_URL`, `REDIS_URL`); update `.env.example`.
4. **`apps/api/src/integrations/qbo/client.ts`** (new, replaces `qboRequest` in `services/qbo-sync.ts:135-172`): base URL by env, `minorversion=75`, `Requestid`, timeout, Fault parsing, 429/5xx classification, per-realm rate limiter (Redis token bucket), `batch()`, `query()` paging, `cdc()`.
5. **`apps/api/src/integrations/qbo/auth.ts`** (new, replaces `qbo-sync.ts:178-285,802-844`): nonce state (Redis, 10-min TTL), code exchange, single-flight refresh with lock, revoke, status.
6. **`apps/api/src/integrations/qbo/mappers/*.ts`** (new): `customer.ts`, `invoice.ts`, `payment.ts`, `refund.ts`, `creditmemo.ts`, `deposit.ts`, `salesreceipt.ts`, `journalentry.ts`. Pure functions from Helm row plus mappings to a QBO payload, unit-tested.
7. **`apps/api/src/integrations/qbo/sync.ts`** (new, supersedes `services/qbo-sync.ts:291-686`): `pushEntity(type,id)` with `QboSyncRecord` create-PENDING → POST → SYNCED/FAILED, dependency checks, void/refund ops.
8. **`apps/api/src/integrations/qbo/outbox.ts`** (new): `enqueueQbo(tx, type, id, action)` helper. Call it inside the existing transactions in `routes/invoices.ts:440-484` (replacing the commented line 485-486) and the void tx at `:539-545`, in `routes/payments.ts` (capture `:391`, refund `:515`), `services/billing.ts:236-260,325`, `services/ach-handler.ts:105`, and the Stripe webhook payout handler (new case in `services/webhook.ts`).
9. **`apps/api/src/routes/integrations-qbo.ts`** (new): public sub-router (`/callback`, `/webhook` with `express.raw`, `/disconnect-notify`, `/launch`) mounted **before** `express.json()` and excluded from `tenantMiddleware` (`middleware/tenant.ts:25` bypass list); authed sub-router for status, mappings, sync-records and retry, with roles `MARINA_OWNER`/`ACCOUNTING`. Delete `routes/qbo.ts` and the QBO blocks in `routes/settings.ts:419-541`, `routes/onboarding.ts:206-289` and `routes/tenants.ts:115-135`; update `index.ts:37,92`.
10. **`apps/api/src/services/gl-posting.ts`**: replace `ACCOUNTS` constants (`:85-96`) with a `resolveRole(tenantId, role)` lookup; post tax to Sales Tax Payable (`:132-153`); Stripe clearing for card/ACH (`:174-178`). **`services/deferred-revenue.ts`**: accept `tx` (`:67`), exclude tax (`:29`). **`services/billing.ts:129`**: use the ChargeType's glAccountId. **`routes/onboarding.ts:297-350` + `prisma/seed/gl-accounts.ts`**: a single shared chart-of-accounts template that seeds the role map.
11. **`apps/api/src/lib/queue.ts`**: add `qbo-control` queue; `defaultJobOptions`; export `upsertSchedulers()` that registers all job schedulers (§8.2) plus the existing pricing, renewal and lifecycle ones via `upsertJobScheduler`.
12. **`apps/api/src/workers/index.ts`**: fix snake_case queries (`:101,116-117`); replace the stub (`:221-229`) with processors from `integrations/qbo/jobs/*.ts`; add a `deferred-revenue` worker calling `recognizeDeferred`; call `upsertSchedulers()` at startup; wire `RateLimitError` handling.
13. **Runtime**: `apps/api/package.json`: add `"worker": "node dist/workers/index.js"` and `"worker:dev": "tsx watch src/workers/index.ts"`. `Dockerfile.api`: same image, separate command. `docker-compose.yml`: add a `worker` service (same env, `command: pnpm --filter @helm/api worker`), plus a healthcheck that pings Redis and the queue.
14. **Frontend**: `apps/web/src/pages/Settings.tsx:993-1009` becomes a real connection card and health panel (§8.5). `Settings.tsx:214-260,536-620` becomes mappings loaded and saved via `/api/integrations/qbo/mappings` (the current save posts to a nonexistent `PUT /api/settings`). `ChartOfAccounts.tsx:18-51,129-134` gets real data and a QBO mapping picker. `Contracts.tsx:655-692` "GL / Billing Mapping" selects a ChargeType from the API (today its fields are stripped by `UpdateContractSchema`, `contracts.ts:46-59`). `Onboarding.tsx:413-428` redirects into OAuth and reflects the real callback result.
15. **Tests**: `apps/api/tests/integrations/qbo/*.test.ts` for mappers (golden payloads), the client (401 refresh single-flight, 429 delay, 5010 retry, `Requestid` reuse), the outbox (event → one sync record), and webhook HMAC (raw body). Plus a GL posting test against the real seed chart.

---

*Sources consulted for platform facts:* Intuit QuickBooks API spec via the Intuit Developer tools (Invoice/Payment create schemas, CDC endpoint, minorversion 75 examples); [Intuit developer blog: minor version 75 baseline](https://blogs.intuit.com/?p=34635); [Codat: QBO minor versions update](https://docs.codat.io/updates/250219-qbo-minor-versions-update); [Apideck: QBO 2025–2026 changes (CloudEvents deadline/extension, refresh-token caps, read metering)](https://www.apideck.com/blog/ai-built-accounting-integrations-maintenance); [Intuit developer blog: CloudEvents webhook migration](https://blogs.intuit.com/?p=35371). Rate limits, OAuth token lifetimes, `Requestid`, batch and CDC limits are per the Intuit developer documentation as known at the time of writing; re-verify against developer.intuit.com before implementation.
