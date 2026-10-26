# Helm — Go-to-Market Audit & Launch Roadmap

*Prepared 2026-10-26 from 13 parallel deep-dive audits of the `sdunford90/helm` codebase (commit `ae2e111`), live runs against a local Postgres 16 + Redis, and external market research. Every claim below traces to a detailed report in this folder (file:line references live there). The most consequential findings were re-verified by hand.*

---

## 1. Executive summary

**What Helm is.** An ambitious all-in-one marina platform: ~65k lines of TypeScript across 5 apps (staff web app, boater portal, platform admin, embeddable booking widgets, API) and a 60-model Postgres schema covering slips, contracts, transient bookings, waitlist, CRM, invoicing, payments, GL/deferred revenue, QuickBooks, boat rentals with dynamic pricing, POS, fuel, inventory, dry-stack/ramp, concierge, dock walks, insurance AI, announcements, reports, and SaaS administration.

**Where it actually is.** Helm is a **well-designed clickable prototype on top of a mostly sound data model**, not a working product. Specifically:

- **The UI runs on mock data.** A one-line bug (`useApi` paths include `/api` and the client prefixes `/api` again → `/api/api/...`) makes nearly every request 404, and pages silently fall back to hard-coded `MOCK_*` arrays. Many save/pay/sign buttons write only to local state or show "success" on failure. *(06, verified)*
- **None of the core daily workflows completes end to end**: check in a transient boater, take a POS payment, create & send an invoice, sign a contract, book a rental. *(06)*
- **Nothing in the background ever runs.** No worker process is started anywhere; no scheduler is ever called. So: no emails/SMS, no recurring billing, no revenue recognition, no renewals, no QuickBooks sync. *(03, 07, 12, verified)*
- **QuickBooks sync is a stub** and would corrupt books if switched on as written. *(03, verified)*
- **Security is not launch-safe.** Docker images don't set `NODE_ENV=production`, which silently disables authentication and falls back to the first tenant — verified live: unauthenticated requests return full customer and payment data. Several cross-tenant leaks exist even in production mode, ~85% of routes have no role check, and onboarding OAuth callbacks could let an attacker redirect a marina's Stripe payouts. *(07, 11, verified)*
- **Build/CI is broken**: 444 TS errors in the API, 588 in web (56 real after a tsconfig fix); CI uses `npm` in a `pnpm` repo; 51/139 tests fail and the suite mocks the DB and auth, so it can't catch any of the above. *(07)*

**What's genuinely good** (keep it): integer-cents money columns, a double-entry GL poster that rejects unbalanced journals, a reasonable domain model for slips/contracts/invoices, Zod validation on most bodies, clean Vite bundles (64 kB gzip), a thoughtful UI design language, and correct real Intuit endpoints in the QBO service. `prisma db push` + seed work on a clean database.

**Bottom line.** A **focused v1** — slips, contracts, transient booking, invoicing, payments, QuickBooks, portal pay, email notifications, a read-only AI copilot, and enterprise-grade security foundations — is realistic in **~5–6 months with 4 engineers + 1 product designer** (≈90–110 engineer-weeks). Rentals, the action-taking AI, work orders, and the broad integration catalog follow in the two releases after. Launching "everything" at once would mean launching a wide, broken product into a market where Dockwa and Storable Marine are well-funded incumbents.

---

## 2. The 21 findings that matter most

| # | Finding | Impact | Report |
|---|---|---|---|
| 1 | Auth + tenant fail **open** whenever `NODE_ENV≠production`; Docker/compose never set it | Anyone can read/write the first tenant's data. **Verified live.** | 07 A-1, 11 R-01 |
| 2 | BI API key from tenant A + Host header of tenant B returns B's customers (incl. DL numbers, DOB) — **in production mode** | Cross-tenant PII leak. **Verified live.** | 07 T-1, 11 R-04 |
| 3 | Tenant auto-scoping list (`lib/prisma.ts:17`) misses 20 tenant models (SlipContract, GL, PromoCode, SecurityDeposit, InsuranceRecord, ApiKey…) and lists 7 models with no `tenantId` (crash every pricing-rule query) | Leaks + crashes | 07, 04, verified |
| 4 | Unauthenticated onboarding OAuth callbacks with `state = tenantId` | Attacker links their Stripe/QBO to a victim marina → **payout diversion** | 07 W-9, 11 R-03, 03 |
| 5 | Client chooses the Stripe account and the price on transient/ramp bookings and POS | Money to the wrong tenant; customers set their own price | 02, 05, 08 |
| 6 | ~85% of routes lack role checks (refund, void, delete, export); 12 checks use non-existent lowercase roles → 403 for everyone (all reports, audit log, QBO, fuel); boaters (`PORTAL_USER`) pass the staff API guard | Any login can refund/void; reports unusable | 07, 11 |
| 7 | `/api/api` double prefix + `MOCK_*` fallbacks + fake success toasts | The app *looks* finished but saves nothing. **Verified.** | 06 |
| 8 | No worker entrypoint; schedulers never called; compose worker runs an exports-only file and crash-loops | No email, SMS, billing, renewals, recognition, sync | 03, 07, 12, verified |
| 9 | Every email/SMS producer sends a payload the worker can't read | Even with workers, nothing delivers | 12 |
| 10 | QBO: no token columns, routes unreachable, 4 duplicate connect flows, fake "Connected" UI, payments not idempotent (duplicate on every sync), invoice amounts `NaN`, tax not sent | Books corrupted if enabled | 03, verified |
| 11 | No Stripe webhook endpoint; no idempotency keys; balance checks outside transactions; partial refunds can be re-refunded in full | Double charges, lost ACH returns/disputes | 02 |
| 12 | Sales tax is effectively 0% on invoices (settings key mismatch), POS hard-codes 7%, GL books tax as revenue | Wrong tax collected and reported. **Verified.** | 02, 12 |
| 13 | Recurring billing ignores billing cycle (annual contract billed 12×), never runs; proration off by a day across DST | Wrong bills | 02, 05 |
| 14 | Auto-charge fires for any customer with a card on file regardless of the tenant's auto-charge setting | Charging without opt-in. **Verified.** | 12 |
| 15 | Tenant-lifecycle job locks a marina out of Helm if **any one boater** is past due | Would lock every marina once workers start. **Verified.** | 02, 05, 08 |
| 16 | Auto-renew batch drops its own filters → renews contracts that opted out | Unwanted contracts and charges | 02, 05 |
| 17 | Transient availability ignores annual/seasonal contracts; no overlap lock; inclusive date compare; no timezone | Guaranteed double-bookings | 05 |
| 18 | E-signature is fake (columns don't exist, no consent/hash/audit trail) | Contracts not legally defensible | 05 |
| 19 | Rentals: ~16/19 endpoints 500 on every call; four disagreeing pricing engines; widget prices client-side | Module ~15% built | 04 |
| 20 | No SMS consent/STOP handling, no unsubscribe links, no 10DLC registration | TCPA/CAN-SPAM exposure ($500–$1,500 per text) | 12, 08 |
| 21 | Audit log page shows 15 fake entries (fake IPs, real-looking names) as genuine history when its API 403s; only 48% of mutations are logged | Misleading audit trail; compliance failure | 10 |

---

## 3. Recommended v1 scope

A focused v1 aimed at the ideal first customer from the competitive research (09): **independent marinas and small groups (2–10 sites), ~75–300 slips, mixing annual/seasonal slips with transient, with a store/fuel dock**, in Florida/Gulf, Great Lakes, and inland lakes, sold during the Oct–Feb renewal season.

| Module | v1 | Notes |
|---|---|---|
| Slips & dock map, boats, customers, CRM/leads, waitlist | **IN** | Add date-ranged slip allocation and boat-fit checks |
| Slip contracts, renewals, e-signature | **IN** | Real e-sign (native, ESIGN/UETA-compliant, or Dropbox Sign/DocuSign) |
| Transient booking window (staff + public widget) | **IN** | Server-side pricing, holds, Stripe |
| Invoicing, recurring billing, payments (card + ACH), autopay, AR | **IN** | The money loop must be bulletproof |
| Sales tax (configurable, incl. FL dockage) & surcharging (state rules) | **IN** | Parity with Dockwa/Molo |
| GL, deferred revenue, QuickBooks Online sync | **IN** | Rebuilt per 03 §7–8 |
| Boater portal (pay, sign, renew, update boat/COI, autopay) | **IN** | Highest switching-cost reducer after data import |
| Insurance/COI tracking with AI extraction | **IN** | Unique differentiator; staff-review step |
| Email notifications (transactional + announcements) | **IN** | SMS behind consent + 10DLC, enabled when registered |
| Reports (≈8 core, CSV export) | **IN** | Rent roll, AR aging, occupancy, revenue, deferred, tax, payments, renewals |
| POS (narrowed: charge-to-account, cash, external card, Z report) | **IN** | Stripe Terminal v1.1 |
| Fuel | **IN as POS products** | Dedicated fuel module later |
| Dock walks (online) | **IN** | Offline mode later; capture meter readings here |
| Metered electric billing | **IN (manual readings)** | IoT ingestion later |
| Data import (CSV + Molo/DockMaster/Dockwa templates, card-vault migration) | **IN** | #1 switching barrier per 09 |
| AI copilot — read-only Q&A | **IN** | Phases 0–1 of 14; differentiator |
| Boat rentals & dynamic pricing | **OUT → v1.1** | 6–9 ew rebuild (04 §9); server-side off-switch for v1 |
| AI actions (create/bill/message) | **v1.1–v1.2** | Phases 2–3 of 14, gated on money fixes |
| Inventory/POs, dry stack, ramp, concierge | **OUT** | Stop marketing dry stack until built |
| Work orders / service yard | **v1.2** | Top post-launch module (Dockwa shipped it Jul 2026) |
| BI API, portfolio dashboard | **OUT → v1.1** | After RLS and scoped keys |

---

## 4. Foundational architecture decisions

These are made once and underpin every workstream. They are the "do it right" calls that turn a prototype into an enterprise platform.

1. **Tenancy: shared schema + Postgres row-level security.** Delete the per-schema code paths (`tools/migrate-all.ts`, onboarding `CREATE SCHEMA`). Add `tenantId` to all child tables, generate the Prisma scoping list from the DMMF (fail closed on unknown models), and enforce RLS with a `NOBYPASSRLS` app role and `SET LOCAL app.tenant_id` per transaction. *(07, 11 §3.12, 14)*
2. **A domain command layer.** Move business logic out of Express handlers into typed commands (`zod` input, permission key, risk tier, `dryRun`, `execute`, idempotency key, audit, outbox). REST, the AI agent, the public API, MCP, and jobs all call the same commands — identical rules everywhere. *(14 §1, 11 §3)*
3. **Granular permissions (RBAC + limits).** ~180 `resource.action` permission keys, 10 cloneable role templates, custom roles, per-user overrides, location-scoped assignments, approval thresholds/dual control, field masking, PIN user-switching on shared devices. One `authorize()` used by every entry point. *(11)*
4. **Transactional outbox + BullMQ with Job Schedulers.** Every side effect (email, SMS, QBO, webhooks) is written to an outbox row in the same DB transaction; dedicated worker and scheduler processes; deterministic job IDs; dead-letter mirrored to the DB so users can see failures. *(03 §8, 12 Part C)*
5. **One money & pricing library.** Integer cents, one rounding policy, one proration function, one tax engine (TaxRate table, jurisdictions, exemptions), one pricing pipeline for slips/transient/rentals, and a stored **price breakdown snapshot** on every invoice line/booking so any number can be explained. *(02, 04, 10)*
6. **Layered configuration registry.** Platform → tenant → location → product/slip type/segment → record, typed with zod, versioned, audited, draft/publish, server-enforced feature flags tied to SaaS tier. ~210 settings catalogued in 12. *(12)*
7. **Notification platform.** 68-event catalog, channel matrix, template editor with merge fields and branding, timing rules, quiet hours, preference center, consent ledger, delivery webhooks, suppression. *(12)*
8. **Integration framework.** Connection model, encrypted credential vault (envelope encryption), mapping tables, sync runs/errors, outbound webhooks (Standard Webhooks via Svix), versioned `/v1` public API with scoped keys and OAuth apps, marketplace UI. QBO becomes connector #1. *(13 §5)*
9. **Enterprise audit log.** Append-only, hash-chained, captures actor (user/system/API key/AI-on-behalf-of/impersonator), before/after diff, reason, request id, IP/UA; per-record history tab; export/SIEM streaming. *(10, 11)*
10. **AI agent architecture.** Agent acts *as the user*, tools generated from domain commands, tenant/user only from the session, proposals frozen and confirmed by a human, untrusted-content spotlighting, compliance enforced inside send commands, cross-tenant canary tests blocking CI. *(14)*

---

## 5. Phased roadmap

Effort is in engineer-weeks (ew), from the per-report estimates, de-duplicated where reports overlap. Assumes 4 full-stack engineers + 1 product designer; phases overlap where dependencies allow.

### Phase 0 — Stop-ship & stabilize (weeks 1–2, ≈8–10 ew)

Goal: the codebase is safe, builds, deploys, and shows the truth.

**Security stop-ship** (07 §11, 11 §5)
- [ ] Remove the `NODE_ENV` auth/tenant bypass; require an explicit `HELM_DEV_AUTH_BYPASS` flag; set production env in images; zod-validate env at boot and fail closed.
- [ ] Fix `requireRole` strings to the enum; fix `requirePlatformAdmin` (`clerkUserId`, `PLATFORM_ADMIN`); `...clerkAuth()` in transient/ramp/concierge (stops the hangs); reject `PORTAL_USER` and inactive users on staff routes.
- [ ] Lock down `/api/onboarding/*` and `/api/tenants/*`; nonce-based OAuth `state` everywhere; delete the 3 duplicate QBO connect flows.
- [ ] Fix the BI-API tenant context; correct the Prisma scoping list (generated, fail-closed) as a stopgap until RLS.
- [ ] Never accept price, total, or Stripe account from the client (transient, ramp, POS).
- [ ] Interim role guards on all money/destructive routes; refund cap via `refundedCents`.
- [ ] Guard the seed script (it `deleteMany()`s all tenants) so it can never run against production.

**Defuse dormant traps before any worker runs** (02, 05, 12)
- [ ] Rewrite the tenant-lifecycle trigger to use the *SaaS subscription*, not boater invoices.
- [ ] Fix the auto-renew filter; disable auto-approve.
- [ ] Respect the tenant auto-charge setting.
- [ ] Turn off every fake "connected/sent/signed" UI claim (QBO card, e-sign send, waitlist "notified").

**Truth in the UI** (06)
- [ ] Fix `/api/api`; unwrap `{data, pagination}`; delete all `MOCK_*` fallbacks; real error states; per-route error boundaries; remove fake success toasts (PaymentModal etc.).
- [ ] Import `ui-kit/global.css` (activates the 190 responsive classes that currently do nothing).

**Build & delivery** (07 §9)
- [ ] Typecheck to zero (`@types/express@4`, DOM lib, schema drift).
- [ ] CI on pnpm; remove `continue-on-error`; Dockerfiles fixed; a real deploy target (staging + prod); first Prisma migration baseline (stop using `db push`).
- [ ] Server-side module entitlements; switch rentals/inventory/ramp/concierge/BI off for v1.

**Exit:** green CI, deployable staging, no known P0 security issue, the UI shows real (possibly empty) data.

### Phase 1 — Platform foundations (weeks 2–8, ≈22–28 ew)

Goal: the enterprise skeleton every feature hangs on.

- [ ] **RLS** on all tenant tables + `tenantId` on child tables + cross-tenant CI test suite. *(11 §3.12, 14)*
- [ ] **Domain command layer** (`packages/domain`): bus, `ExecutionContext`, `withTenantTx`, idempotency, outbox, audit writer; extract customers, boats, slips, contracts, invoices, payments first. *(14 §9 Phase 0)*
- [ ] **Permissions v1**: catalog, role templates, custom roles, location scoping, limits; `/me/access` for the UI; shadow-mode rollout from enum roles (M0–M5). *(11)*
- [ ] **Audit log v2**: actor types, diffs, reasons, hash chain, per-record history UI, CSV export. *(10, 11)*
- [ ] **Workers & schedulers**: worker + scheduler processes in Docker/compose; `upsertJobScheduler`; outbox dispatcher; DLQ mirrored to DB; health checks; Sentry actually initialized; structured logging. *(03 §8, 07, 12)*
- [ ] **Money library**: cents, rounding, single proration, TaxRate model + tax engine v2 (incl. FL dockage), sequential per-tenant invoice numbers, quantity/rounding rules. *(02, 10)*
- [ ] **Configuration registry v1** + rebuilt Settings IA (Organization & Locations, Branding, Slips, Transient, Contracts, Billing, Taxes, Payments, Fees, Notifications, Portal, Integrations, Users & Permissions, Data & Privacy). *(12)*
- [ ] **Location as a real scope**: `locationId` on slips, contracts, invoices, payments, products, users' assignments. *(11 R-18, 12)*
- [ ] **Security baseline**: MFA enforcement, session policy, encrypted secrets/tokens (KMS envelope), dependency/secret/SAST scanning, WAF/rate limits on public endpoints, PITR backups (RPO 15 min / RTO 4 h). *(11 §4 Phases 0–1)*
- [ ] **Frontend data layer**: TanStack Query client, typed API contracts generated from one source (shared types currently drift from Prisma). *(06, 02 DM-12)*

### Phase 2 — The core marina money loop (weeks 6–16, ≈36–44 ew)

Goal: a marina can run slips, contracts, transient, billing, payments, and accounting on Helm.

**Slips, contracts, booking** (05 Phases 1–4)
- [ ] `SlipAllocation` (half-open date ranges, Postgres exclusion constraint) used by contracts, transient, holds, maintenance, seasonal releases; shared `fitsSlip`.
- [ ] Contract state machine; immutable terms + amendments; term types (annual/seasonal/monthly), per-foot pricing, installment plans; contract templates with versioned PDF + SHA-256.
- [ ] **Booking window**: public availability/quote/hold/book API, server-side quotes with tax, holds that expire, PaymentIntent on the tenant's Connect account, webhook-confirmed bookings, cancellation policies & refunds, staff availability Gantt with drag-to-assign.
- [ ] **E-signature**: ESIGN/UETA consent, signer auth, document hash, tamper-evident PDF, event audit trail, executed copy emailed, countersign.

**Billing & payments** (02 §9)
- [ ] Persisted `ContractBillingSchedule` generated at signing; idempotent daily invoicer in tenant timezone; meter-reading billing.
- [ ] Stripe webhook endpoint (raw body, Connect, durable idempotency) for PI/ACH/refund/dispute/payout/account events; ACH returns; chargebacks.
- [ ] Payment safety: idempotency keys, atomic balances, no payments on drafts, partial allocation, credits, refund semantics.
- [ ] SetupIntent card/ACH on file (Financial Connections), autopay toggle, dunning & late fees (configurable), surcharging per state law.
- [ ] Invoice lifecycle UI end to end: create → finalize → send → pay → void/credit; escaped PDF; A/R aging; statements.

**Accounting & QuickBooks** (03 §7–8)
- [ ] GL posting-role map (replace hard-coded account numbers), tax to liability, Stripe clearing account, journal headers & period lock, deferred revenue with real service periods + nightly recognition.
- [ ] QBO v1: `QboConnection` (encrypted), `QboSyncRecord`, `QboMapping`, `QboOutbox`; `QboClient` (minorversion 75, `Requestid`, backoff, per-realm limiter); mapping wizard; invoice-level sync for AR; payout → Deposit with fee line; daily POS/fuel summary; monthly deferred JE; nightly reconciliation + CDC; integration health UI; Intuit production review.

### Phase 3 — Launch readiness (weeks 12–20, ≈24–30 ew)

- [ ] **Boater portal**: invite/magic-link auth tied to `Customer`; pay, autopay, sign, renew, waitlist offers, boats, COI upload, away dates. *(05 Phase 5)*
- [ ] **Renewals & waitlist** workflows with notice cadences and portal acceptance. *(05)*
- [ ] **Notifications v1**: event catalog, templates, timing rules, preference center, consent ledger, unsubscribe/one-click headers, Resend/Twilio delivery webhooks, suppression; 10DLC ISV registration (SMS on when approved). *(12)*
- [ ] **Data import**: CSV + competitor templates (Molo, DockMaster, Dockwa, MarinaOffice), validation preview, Stripe card-vault migration support. *(09)*
- [ ] **Onboarding**: sales-assisted provisioning, guided setup checklist (locations, docks/slips, rates, tax, Stripe, QBO, users). *(08)*
- [ ] **Reports**: 8 core reports, CSV, correct definitions (occupancy, RevPAF/ADR by location). *(08, 10)*
- [ ] **POS (narrowed)**, **dock walks (online + meter readings)**, **insurance AI** (Claude PDF extraction with staff review, expiry reminders). *(08)*
- [ ] **IA/UX**: Today board, unified bookings calendar, one contract wizard, one payment panel, Customer 360, Cmd+K, accessibility to WCAG 2.1 AA (required by municipal marinas). *(06, 09)*
- [ ] **AI copilot — Phase 1 (read-only)**: chat panel, ~30 read tools, metrics catalog on a replica, evals, cross-tenant canaries in CI. *(14)*
- [ ] **Compliance & ops**: PCI SAQ A attestation, DPA + subprocessor list, tenant data export, vulnerability disclosure page, incident response plan, status page, third-party pen test, SOC 2 Type I kickoff (Vanta/Drata). *(11 §4)*

**Launch gate:** 10–15 design-partner marinas live for ≥30 days with zero P0 incidents, books reconciling in QBO nightly, ≥90% golden-task accuracy on AI reads, pen test findings closed.

### Release 1.1 (≈ months 7–9)

- **Rentals & dynamic pricing rebuild** (04 §9): resource vs product model, rate cards, add-ons, shared pricing pipeline, availability service with exclusion constraint, public API + Stripe + deposits + waivers + GL, then UIs; algorithmic pricing fixed and behind approvals. Then boat club credits, gift cards, weather bulk-cancel.
- **AI Phase 2**: low-risk actions with confirm cards (create customer/boat/lead, draft invoice, assign slip, draft messages).
- **Stripe Terminal** for POS; offline dock walks; BI API + portfolio dashboard on RLS + scoped keys.
- **Integrations (6-month set, 13 §7)**: Snag-A-Slip, FuelCloud, meter ingestion (EKM), access control via Seam, NWS/NOAA weather & tides, Xero, Sage Intacct, Avalara, HubSpot/Mailchimp, Slack/Teams, Zapier, outbound webhooks + `/v1` API GA.

### Release 1.2+ (≈ months 9–14)

- **Work orders / service yard / haul-out scheduling** (top missing module; 08).
- **AI Phases 3–4**: financial and messaging actions with dual control; background agents (AR follow-up, waitlist matching, weather cancellations, anomaly sentinel); MCP server; portal assistant.
- **Enterprise identity**: SSO (SAML/OIDC), SCIM with IdP-group → role/location mapping, SOC 2 Type II, data residency, customer-managed keys.
- Dry stack, inventory/POs, NetSuite/Business Central, Google Things to Do/Viator for rentals, LPR/Verkada.

---

## 6. Workstream tracks (the owner's specific asks)

### 6.1 Scheduled jobs & QuickBooks — *03 §8*
- Today: no worker or scheduler runs anywhere; QBO worker is a TODO; `recognizeDeferred` never called.
- Target: separate worker + single-elected scheduler processes; BullMQ `upsertJobScheduler` (idempotent across instances); transactional outbox; 17-job QBO catalog (outbox dispatch every 15 s, event-driven pushes with dependency ordering, Stripe payout deposits, daily summaries at 03:00 tenant-local, monthly deferred JE, token refresh every 10 min + daily keep-alive so seasonal marinas don't hit the 100-day refresh expiry, re-auth warnings at 30/14/7/1 days, CDC pull every 30 min, nightly reconciliation, 6-hourly retry of failed items). Per-realm rate limiting (≤450/min, ≤8 concurrent). User-visible sync health and error inbox.
- Estimate: 4–6 ew + Intuit review lead time.

### 6.2 Enterprise security & granular user permissions — *07, 11*
- Phase 0 stop-ship → Phase 1 launch baseline (permissions v1, MFA, RLS, audit, encryption, scanning, WAF, PCI SAQ A, DPA, backups) → Phase 2 growth (approvals, SOC 2 Type I, pen test, SIEM streaming) → Phase 3 enterprise (SSO, SCIM, SOC 2 Type II, residency, CMK, bug bounty).
- Permission model: ~180 keys like `invoices.void`, `payments.refund` (with `$` limit), `pricing.override` (with % limit), `customers.pii.view_full`, `data.export`; role templates (Owner, GM, Harbor Master, Dockhand, Fuel Attendant, Cashier, Rental Desk, Service Writer, Bookkeeper, Read-only Auditor); custom roles; location scoping; manager-PIN approvals at the counter; remote approvals; field masking; consent-based, audited impersonation; break-glass with two-person approval.

### 6.3 Every calculation & audit logging — *02, 04, 10*
- `10-calculations-and-audit-logs.md` catalogs **~95 calculations** (file:line, formula, units, rounding, duplicate agreement, configurable vs hard-coded, edge cases, test coverage, verdict). The "Wrong" verdicts were confirmed by running the edge cases in Node.
- Wrong or broken today:
  - **Recurring billing:** ignores the billing cycle (a $3,000/quarter contract bills $9,000), and billing days 29–31 skip short months.
  - **Proration:** two proration functions disagree by $32 on $1,000 in a daylight-saving server timezone.
  - **Tax:** invoice tax is 0% (and would be 700% if hand-configured); POS is a flat 7%; fuel has no tax.
  - **Ledger:**
    - three conflicting chart-of-accounts schemes (account 2400 means three different things);
    - tax booked as revenue;
    - one-sided termination entries;
    - deferred revenue includes tax and spreads 12 months over 13 entries.
  - **Point of sale:** the daily report subtracts refunds twice (a $100 sale fully refunded shows −$200); shift-close variance is wrong after a partial refund.
  - **Credits and refunds:** applying part of a credit discards the remainder; repeated partial refunds can exceed the payment.
  - **Rentals:** algorithmic pricing suggests $0; rental pricing exists in 5 places that disagree; a 1-day rental across the DST change bills 2 days.
  - **Dates in US time zones:** the widget picks the wrong weekday and `formatDate` shows dates one day early.
  - **Smaller errors:** "NPS" is really a mean score; dollar inputs lose a cent on values like 1.005.
  - **Mock KPIs:** the dashboard always shows mock numbers.
- **Not implemented anywhere:** per-foot dockage, promo codes, late fees.
- **Audit log today:**
  - only **74 of 155 mutating endpoints (48%)** write an audit row;
  - no IP/user agent, no reasons, no hash chain, and rows are mutable;
  - not logged at all: impersonation, role changes, tax/billing settings, Stripe/QBO connect, logins, exports;
  - in production the audit API always 403s, and the page then displays **15 fake entries as real history**.
- **Fix:**
  - one money library (integer cents + decimal.js for rates, banker's rounding for allocations, half-up line-level tax after discounts, timezone-aware dates);
  - versioned rate/tax rules plus a rule-by-rule price-breakdown snapshot on every line and booking;
  - golden-number tests (DST, leap year, Pacific/Hawaii, partial and short months);
  - an append-only `audit_events` store, written in the same transaction, hash-chained per tenant and anchored daily to write-once storage;
  - retention of 7 years for money events and 3 years for others.

### 6.4 Per-marina configurability & notifications — *12*
- Today: settings are stored but no business logic reads them; most behavior is hard-coded (30-day terms, invoice numbering, 3% platform fee, $25 ACH fee, +1-year renewals, 7% POS tax, USD/feet/gallons, brand color 768×). No notification is ever delivered.
- Target: layered configuration registry (~210 settings), custom fields, document/contract/invoice templates with merge fields, approval workflows, per-slip-type document requirements, localization; notification platform with 68 events, 6 channels, templates, timing offsets, quiet hours, digests, preference center, consent ledger, delivery tracking.

### 6.5 Integrations ecosystem — *13*
- Launch: integration framework + vault, `/v1` API, outbound webhooks, QBO rebuilt, NetSuite (design partner), GL export file for municipal ERPs, Stripe hardening (payouts, surcharging, Apple/Google Pay, ACH verification), FuelCloud, Snag-A-Slip, Twilio 10DLC, tax engine v2, SSO/SCIM, bulk export.
- 6 months: meters (EKM, MarineSync), access control (Seam → Brivo/Kisi/Avigilon Alta), weather/tides (NWS/NOAA), Sage Intacct, Xero, Avalara, HubSpot, Mailchimp, Slack/Teams, Zapier, DocuSign, Stripe Identity, waivers.
- 12 months: Business Central, Salesforce, ADP/Gusto/When I Work, Google Things to Do, Viator, Verkada/LPR, Power BI, ARI PartSmart.
- Budget partner-program costs (Intuit Silver ≈$300/mo → Gold ≈$1,700/mo; Xero A$35–1,445/mo; Sage Intacct ≈$2,500/yr).

### 6.6 Agentic AI copilot — *14*
- The assistant can do anything the logged-in user can do — create customers, book, bill, email/text, answer data questions — through the same domain commands as the UI.
- Guardrails: tenant & user only from the session (never model-supplied); RLS + scoped Prisma + per-tenant conversation storage; permissions = user ∩ AI channel ceiling ∩ tenant AI policy; frozen, hashed proposals with server-computed confirm cards ("Create invoice #1042 for John Smith, $1,250.00, due Nov 30"); no auto-approve for financial/messaging/destructive; dual control above thresholds; the AI can never approve; untrusted customer content spotlighted and taint-tracked; TCPA/CAN-SPAM inside the send commands; full audit as "user via AI"; kill switches and spend caps; cross-tenant canary evals blocking CI.
- Models: `claude-sonnet-5-5` main loop, `claude-haiku-5-5` routing/screening, `claude-opus-5-5` multi-step plans. Est. $0.05–0.08 per task (to validate in beta).
- Phases: 0 prerequisites (6–8 ew, shared with Phase 1 above) → 1 read-only (5–6 ew, **v1**) → 2 low-risk actions (4–5 ew, v1.1) → 3 financial & comms (6–8 ew, v1.2) → 4 background agents, MCP, portal assistant (6–8 ew).
- No marina competitor ships an action-taking copilot today.

---

## 7. Positioning, pricing & GTM (from 09)

- **Market:** Dockwa leads (~4,000 marinas; PE-backed 2026; shipped work orders Jul 2026); Storable Marine (Molo + Stellar) wins large groups (Suntex 72 sites); DockMaster is deep but dated (migration target); low end is commoditizing at ~$5/slip.
- **Helm's wedge:** one customer record and one ledger across slips + transient + rentals/boat club + store/fuel; dynamic pricing for slips *and* rentals; AI COI extraction; native accounting with deferred revenue + clean QBO; a real AI copilot that takes actions; modern UX; transparent pricing.
- **Pricing hypothesis:** per rentable unit with monthly minimums — Starter $4/unit ($199 min), Pro $6/unit ($399 min), Portfolio ~$7/unit ($1,500 min); add-ons (Rentals & Club, Service, AI actions); embedded payments at interchange + 0.4–0.6% (payments may become 40–50% of revenue); optional guest-paid booking fee; never commission the marina's direct bookings.
- **Channels:** design-partner program (10–15 marinas), off-season sales (Oct–Feb), AMI / Marina Dock Age / MOAA / regional associations, comparison content ("Molo/DockMaster alternative"), partners (Snag-A-Slip, pedestal-metering vendors, gate-access vendors, marine insurance brokers).
- **Must-have before selling:** frictionless migration (data + saved cards), WCAG 2.1 AA for municipal buyers, state-correct sales tax and surcharging.

---

## 8. Effort & team

| Phase | Calendar | Engineer-weeks |
|---|---|---|
| 0 Stop-ship & stabilize | wk 1–2 | 8–10 |
| 1 Platform foundations | wk 2–8 | 22–28 |
| 2 Core money loop | wk 6–16 | 36–44 |
| 3 Launch readiness (incl. AI read-only) | wk 12–20 | 24–30 |
| **v1 GA total** | **~5–6 months** | **≈90–110** |
| 1.1 (rentals, AI actions, 6-mo integrations) | +3 months | ≈45–55 |
| 1.2+ (work orders, AI phases 3–4, enterprise identity) | +4–5 months | ≈50–65 |

Recommended team: 4 senior full-stack TypeScript engineers (one with payments/accounting depth, one with security/infra), 1 product designer, a part-time QA/automation engineer from Phase 2, and fractional compliance support (SOC 2 platform + counsel for e-sign, TCPA, surcharging, sales tax). Estimates come from the per-area reports and should be re-baselined after Phase 0, when the true state of each module is visible without mock data.

---

## 9. Decisions needed from the owner

1. **Approve the focused v1 scope** in §3 (especially: rentals to v1.1; inventory, dry stack, ramp, concierge out).
2. **Tenancy model:** confirm shared schema + RLS (recommended) and retire the per-schema/Neon path.
3. **E-signature:** native ESIGN/UETA implementation vs. Dropbox Sign/DocuSign (recommended: native for contracts, DocuSign as an enterprise option).
4. **Payments strategy:** Stripe Connect only for v1 (recommended); confirm platform take-rate and surcharging stance.
5. **Accounting design:** invoice-level QBO sync for AR + payout deposits + daily summaries + monthly deferred JE (recommended in 03 §5).
6. **AI policy defaults:** confirm that financial, messaging, and destructive AI actions always require human confirmation.
7. **Design partners:** identify 10–15 marinas for the beta; their feedback should re-rank Phases 2–3.
8. **Legal reviews to schedule:** e-sign consent, TCPA/10DLC, surcharging by state, sales tax on dockage/storage, DPA/privacy policy.

---

## 10. Report index

| # | Report | Scope |
|---|---|---|
| 02 | [Money, invoicing, payments](02-money-invoicing-payments.md) | Invoices, billing, Stripe, tax, GL, deferred revenue, rounding |
| 03 | [QuickBooks integration](03-quickbooks-integration.md) | QBO sync, OAuth, accounting design, **job/scheduler design (§8)** |
| 04 | [Rentals & dynamic pricing](04-rentals-dynamic-pricing.md) | Products, pricing engine, availability, widget, algorithmic pricing |
| 05 | [Slips, contracts, booking](05-slips-contracts-booking.md) | Slips, contracts, e-sign, renewals, transient, waitlist, leads, portal |
| 06 | [Frontend design & UX](06-frontend-design-ux.md) | Every page, routing, API contract table, booking/invoicing/contracts deep dives, IA redesign |
| 07 | [Platform, security, infra](07-platform-security-infra.md) | Auth, tenancy, webhooks, CI/CD, build/test results |
| 08 | [Operations modules](08-operations-modules.md) | POS, fuel, inventory, ramp, concierge, dock walks, insurance AI, comms, reports, onboarding |
| 09 | [Competitive research](09-competitive-research.md) | Competitors, feature matrix, pricing, GTM |
| 10 | [Calculations & audit logs](10-calculations-and-audit-logs.md) | Catalog of every calculation; audit coverage & target design |
| 11 | [RBAC & enterprise security](11-rbac-and-enterprise-security.md) | Endpoint authorization table, permission model, security roadmap, AI permissions |
| 12 | [Configurability & notifications](12-configurability-and-notifications.md) | Settings inventory & registry design; notification platform |
| 13 | [Integrations ecosystem](13-integrations-ecosystem.md) | Integration catalog, phasing, integration platform architecture |
| 14 | [Agentic AI architecture](14-agentic-ai-architecture.md) | AI copilot design, tools, guardrails, phases |
