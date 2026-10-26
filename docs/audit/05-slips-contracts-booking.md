# Audit 05: Slips, Contracts, Booking Window, Renewals, Waitlist, Leads, Portal

**Scope:** slip/dock inventory, slip contracts (annual/seasonal/monthly), e-signature, renewals, transient (nightly) bookings, waitlist, leads to customer conversion, boats, meter readings, insurance/COI compliance, customer portal, embeddable widgets. Also covers how contracts and bookings generate invoices. Invoice money math belongs to another audit.
**Method:** I read every file named in the brief and traced each flow end to end, from UI or widget to the route, then the service, then Prisma and the schema. I ran the existing tests for this scope (`API_PORT=0 npx vitest run ...`). No source files were changed.
**Date:** 2026-10-26

Severity: **P0** blocks launch, **P1** must fix before scaling or before paying customers rely on it, **P2** hardening or polish. Effort: **S** under 1 day, **M** 1 to 5 days, **L** more than 1 week.

---

## Executive summary

Of the three things the owner wants to be "super stable" (booking window, invoicing from contracts, contracts), **none currently works end to end**.

- **The booking window is not wired up.** Every `/api/transient` route hangs forever: `clerkAuth` is passed without being called (`transient.ts:65,106,141,160,214,250,286,315`), and the existing test times out, which confirms it. The public widget books against six hardcoded mock slips and posts the wrong payload to a staff-only endpoint. The availability query ignores annual and seasonal contracts entirely. The server never checks for overlaps, so double-booking is guaranteed. The client sends the price and the server trusts it.
- **Contracts never generate invoices.** `services/billing.ts` (`generateRecurringInvoices`) is imported by nothing, scheduled by nothing, and has no route. Even if it ran, it bills the full `rateCents` every month whatever the billing cycle (an ANNUAL contract would be billed 12 times). It also keeps billing past `endDate` and bills future-dated contracts.
- **E-signature is fake.** The `esign*` columns written by `contracts.ts:799-808` do not exist in the schema, so "Send for signature" throws on every call. The real DocuSign service (`services/esign.ts`) is dead code that targets non-existent models (`prisma.contract`, `prisma.notification`). No contract PDF, consent capture, document hash or signed-copy email exists anywhere. A contract becomes ACTIVE on creation without any signature.
- **Renewals are unreachable.** No route exposes the renewal engine. The worker container runs a module that only exports functions, so no job ever runs. If it did run, `autoRenewCheck` would renew every expiring contract, **including those with `autoRenew=false`** (`renewal-engine.ts:396-405`).
- **The customer portal is a static mockup.** Every page uses hardcoded arrays. There is no API for portal users, no link from a `User` to a `Customer`, and no way to sign, pay or book.
- **The staff web app shows mock data in production.** `lib/api.ts` prefixes `/api` and every caller also passes `/api/...`, so every request goes to `/api/api/...`, gets a 404, and the page silently falls back to `MOCK_*` arrays. Most create and edit actions only change local React state.
- **A cross-tenant data leak.** `getExpiringCompliance` returns insurance records (customer names, boats) for **all tenants**, because `InsuranceRecord` is missing from the tenant-scoping allowlist and the `_tenantId` argument is ignored (`compliance.ts:195-212`, `lib/prisma.ts:17-55`).
- **A business-ending job bug.** `tenant-lifecycle.ts:49-56` treats *any* past-due boater invoice as the marina's own Helm subscription being past due. It would move every real marina to GRACE_PERIOD within a day and LOCKED after 30 days, deactivating all staff users. The worker that runs it is not currently started, which is the only thing preventing this.

Realistic path: about 6 to 8 engineer-weeks to reach a defensible launch of annual/seasonal contracts, recurring invoicing and an owned booking widget, plus 3 to 4 more weeks for portal self-service. Section 9 has the ordered list.

---

## 1. What exists: inventory, working vs stubbed

| Area | API | Staff UI | Portal / Widget | Real status |
|---|---|---|---|---|
| Slip CRUD | `routes/slips.ts` CRUD, dock-map, QR | `Slips.tsx`, `DockMapSVG`, `SlipDetailPanel` | n/a | API works (no role checks). **UI is not connected**: wrong base path, Add sends `{}`, Edit is local-only, Assign uses non-existent `PATCH`. |
| Docks / locations | `Slip.dockId` is a free string. No Dock model. Slip has no `locationId`. | Dock map hardcodes docks A/B/C | n/a | **Missing** |
| Boat-to-slip fit | none | none (the widget filters mock data) | mock only | **Missing** |
| Meter readings | Schema plus read in `slips/:id`. **No create endpoint.** Billing reads the latest reading. | Read-only list | n/a | **Stub.** No water meters. |
| Contracts CRUD | `routes/contracts.ts` create, update, terminate, renew, expiring | `Contracts.tsx` | n/a | API partially works. UI create sends the wrong shape (400). Update and transfer call non-existent routes, and errors are swallowed. |
| Contract templates / documents | none | hardcoded `DOCKAGE_PRODUCTS`, `BILLING_ITEMS` | n/a | **Missing** |
| Contract to invoice schedule | `services/billing.ts` (never invoked) | n/a | n/a | **Dead code** |
| E-signature | `contracts.ts` send/bulk/webhook/status (crashes); `services/esign.ts` (dead) | `ESignatureFlow.tsx` | no `/sign` page | **Broken / fake** |
| Termination | `contracts.ts:536-668` | Contracts UI | n/a | Runs, but money and GL handling is wrong (see 4.x) |
| Slip move / amendment | none (UI calls `/api/contracts/transfer`, which does not exist) | transfer modal (local only) | n/a | **Missing** |
| Renewals | `services/renewal-engine.ts`, `jobs/renewal-job.ts`. No routes. Worker never started. | none | none | **Unreachable** |
| Transient bookings | `routes/transient.ts` | `Transient.tsx` (local-state only) | `widgets/transient-booking` (mock slips) | **Non-functional**: every route hangs |
| Transient pricing / rates | none | hardcoded $85 default | widget hardcoded rates | **Missing** |
| Waitlist | `routes/waitlist.ts` | `Waitlist.tsx` (list only, no offer/accept UI) | `portal/WaitlistStatus.tsx` (mock) | API works with bugs. No notifications, deposits or job. |
| Leads | `routes/leads.ts`, `services/lead-conversion.ts` | `Leads.tsx`, `LeadDetailPanel`, `ConversionWizard` | n/a | API works. UI stage change and conversion are not wired. |
| Lead forms | `routes/lead-forms.ts` | `LeadFormBuilder` | `widgets/lead-form` | **Public submit blocked by auth in prod.** Widget payload fails validation. |
| Customers / merge | `routes/customers.ts`, `services/customer-merge.ts` | `Customers.tsx`, `CustomerDetail.tsx`, `CustomerMerge` | n/a | API works. Undo-merge corrupts data. UI merge sends the wrong body. |
| Insurance / COI | `routes/insurance.ts`, `services/compliance.ts` | compliance badges | `portal/Insurance.tsx` (mock) | Review endpoints always 403. Cross-tenant leak. No holds enforced. |
| Communication prefs | `routes/communication-prefs.ts` | n/a | n/a | CRUD works. **Never consulted by any sender.** |
| Portal auth | Clerk provider only. `User` has no `customerId`. | n/a | no `SignedIn` guard | **Missing** |
| Background jobs | `workers/index.ts`, `jobs/*` | n/a | n/a | **Nothing runs** (compose worker runs `dist/jobs/renewal-job.js`, which only exports functions) |
| Tests | contracts 1/4 pass; transient 0/3 (one hangs); compliance and billing service tests fail | n/a | n/a | No tests for availability, overlap, renewals, waitlist, e-sign or billing cycles |

---

## 2. Slip & dock model

**SD-01. No Dock or Location relationship for slips.** P1, M.
`schema.prisma:508-533`: `Slip.dockId String?` is an unconstrained string, and Slip has no `locationId`, even though `Location` exists (`:274`) and Lead, Waitlist and Rental are location-aware. The dock map hardcodes `DOCKS = ['A','B','C']` (`DockMapSVG.tsx:54`).
*Failure:* a multi-location operator (the stated multi-tenant SaaS target) cannot separate inventory. Availability, renewals ("by dock") and reports group by typo-prone strings. The map cannot show dock D.
*Fix:* add `Dock {id, locationId, name, sortOrder, geometry}` and `Slip.locationId`/`dockId` as FKs. Add a unique index on `(tenantId, locationId, slipNumber)`. Render the map from dock geometry.

**SD-02. Slip dimensions are incomplete and mismatched with the UI.** P1, S.
The schema has `lengthFt`, `beamFt`, `depthFt`. The UI models `length, beam, draft, height` (`Slips.tsx:19-23`): `draft` maps to nothing and `height` (air draft or bridge clearance) has no column. `shorePower` is a free string (no amps, voltage or phase, number of pedestals, or connector type). There are no amenities (water, pump-out, cable, Wi-Fi, covered or uncovered, floating or fixed, side-tie vs. slip, mooring ball, lift). There is no `maxLoaFt` or overhang tolerance, which differs from slip length in real marinas.
*Fix:* add `maxLoaFt`, `maxBeamFt`, `minDepthMlwFt`, `airDraftFt`, `berthType` enum, `powerJson [{amps, volts, phase, count}]`, `amenities String[]`, and `liveaboardAllowed`.

**SD-03. No slip-to-boat fit validation anywhere.** P0 (booking window), M.
None of the paths compare boat LOA, beam or draft with the slip: contract create (`contracts.ts:343-483`), waitlist accept (`waitlist.ts:487-500`), lead conversion (`lead-conversion.ts:171-186`), transient create (`transient.ts:165-170`) and availability (`transient.ts:87-94`). The only fit logic is the widget's client-side filter over mock data (`TransientBookingWidget.tsx:176-181`).
*Failure:* a 52 ft, 16 ft-beam, 6 ft-draft boat books a 30 ft slip in 4 ft of water. That means physical damage, liability, and a cancellation on arrival.
*Fix:* a shared `fitsSlip(boat, slip, tolerance)` service, enforced server-side in all five paths and used to filter availability. Store tolerance per tenant (for example LOA ≤ slip + 10%).

**SD-04. Slip `status` is a single mutable flag used as truth for date-ranged occupancy.** P0, M.
`SlipStatus` (VACANT/OCCUPIED/MAINTENANCE/RESERVED) is overwritten by contract create (`contracts.ts:422-427`), termination (`:600-603`), transient check-in and out (`transient.ts:226-229`, `262-265`), cancel (`:327-332`), waitlist accept (`waitlist.ts:523`) and lead conversion (`lead-conversion.ts:205`).
*Failure:*
- A transient guest checks out of a slip that also has a seasonal holder, and the slip becomes VACANT.
- A contract dated to start next spring marks the slip OCCUPIED today.
- A contract that ends never frees the slip, because no job transitions ACTIVE to EXPIRED.
- A future-dated termination frees the slip immediately.
*Fix:* derive occupancy from date-ranged allocations (section 3, TB-03). Keep `status` only for MAINTENANCE/OUT_OF_SERVICE holds, which should themselves be date-ranged blocks.

**SD-05. No role-based access control on slip, contract, transient, waitlist, lead, boat or customer routes.** P0, S to M.
These routers use `clerkAuth()` only. `requireRole` is not applied, and the permission map in `auth.ts:418-475` is never enforced. Any authenticated user of the tenant can create or delete slips, terminate contracts or merge customers, including `PORTAL_USER` (boaters) and `POS_CASHIER`. Where `requireRole` *is* used (insurance), it checks `"admin","manager"`, which never match the `UserRole` enum values (`insurance.ts:168,268,409`). Those endpoints therefore 403 for everyone.
*Fix:* use enum role names and apply them per route. Portal users must go through a separate `/api/portal/*` router scoped to their own `customerId`.

**SD-06. Meter readings have no write path.** P1, M.
No route creates a `MeterReading`. `consumedKwh` and `amountCents` are stored denormalised with no validation (rollover, negative usage, estimated reads). `calculateElectricity` (`billing.ts:393-418`) takes only the latest reading this month and never marks it billed, so a second invoice run or a mid-month reading double-bills or skips. Water metering does not exist.
*Fix:* add `POST /slips/:id/meter-readings` (mobile dock-walk friendly). Compute `consumed = current - previous` server-side. Add `invoiceLineItemId` to the reading to prevent double billing. Add a `meterType` (ELECTRIC/WATER).

**SD-07. The dock map is N+1 and leaks every customer name to any role.** P2, S.
`slips.ts:115-171` runs one `boat.findUnique` per occupied slip. The compliance overlay ignores insurance `status` (a PENDING_REVIEW or REJECTED COI counts as ALL_GOOD).

**SD-08. Slip delete fails on history.** P2, S.
`slips.ts:462` hard-deletes. FK rows (old contracts, readings, dock-walk items) cause a P2003 error, which surfaces as a 500. Use soft-delete or archive. The same applies to boat delete (`boats.ts:351`).

---

## 3. Transient booking window

### End-to-end trace

Widget (`TransientBookingWidget.tsx`):
1. Uses `MOCK_SLIPS` (`:61-68`). It never calls `/availability`.
2. Computes the price client-side (`:183-188`).
3. Posts `{checkIn:'YYYY-MM-DD', guest:{...}, boat:{...}, pricing, slipId:'slip_a1'}` to `/api/transient` (`:244-252`).
4. Has a Stripe "placeholder" instead of card capture (`:558-573`).

API:
- `tenantMiddleware` resolves the tenant by hostname only (`tenant.ts:50-61`). The widget's `x-helm-tenant-id` header is ignored, so `api.helm.com` resolves to subdomain "api" and returns 404 in prod.
- `transient.ts` route: hangs (TB-01).
- With the hang fixed: 401 (staff auth), then 400 (zod: no `guestName`, `rateCents`, `totalCents`; `slipId` not a UUID; date not datetime).

There is no confirmation email (`bookingConfirmationHtml` in `lib/email.ts:203` is unused), no hold and no invoice.

### Findings

**TB-01. Every transient route hangs: `clerkAuth` is passed uncalled.** P0, S.
`transient.ts:65,106,141,160,214,250,286,315` pass `clerkAuth` (the factory) as middleware. Express calls it with `(req,res,next)`, it returns an array, and `next()` is never called. Reproduced: `tests/routes/transient.test.ts` "rejects booking on non-transient-capable slip" times out. The other two tests fail because `buildTransientBooking` does not exist in `tests/helpers.ts`.
*Fix:* `router.use(...clerkAuth())` for the staff routes, plus a separate public router (TB-02). Fix the test helpers.

**TB-02. No public booking API; the widget is a mock.** P0, L.
No unauthenticated availability, quote or book endpoint exists. Tenant resolution ignores the widget's tenant header.
*Fix:* `/api/public/:tenantSlug/transient/{availability,quote,hold,book}`. Use rate limiting, CAPTCHA, and CORS restricted to the tenant's registered domains (global `cors()` is currently wide open, `index.ts:53`). Use Stripe Payment Element with a PaymentIntent created server-side. Rebuild the widget against it.

**TB-03. Availability ignores contracts, seasonal vacancies, maintenance blocks and fit.** P0, L.
`transient.ts:73-94` excludes only slips with BOOKED/CHECKED_IN transient bookings, then filters on the *current* `slip.status IN (VACANT, RESERVED)`.
*Failure:*
- (a) A VACANT slip whose annual contract starts mid-stay shows as available, so the guest arrives to an occupied slip.
- (b) Every OCCUPIED slip is excluded, so seasonal holders who are away (the main source of transient inventory at most marinas) can never be resold.
- (c) RESERVED is treated as *available*.
- (d) No location or fit filtering.
- (e) OVERSTAY bookings are not counted as blocking, so a guest who overstays is double-booked.
*Fix:* introduce a single `SlipAllocation` (or interval) table (`slipId, startDate, endDate, kind: CONTRACT|TRANSIENT|HOLD|MAINTENANCE|RELEASE, sourceId`). Contracts write allocations for their term. Seasonal holders write RELEASE windows ("I'm away 6/1 to 6/14"). Availability = transient-capable ∩ fits ∩ no blocking allocation overlapping `[arrival, departure)`, plus RELEASE windows that cover the whole stay.

**TB-04. No server-side overlap check, no locking: double-booking is guaranteed.** P0, M.
`POST /api/transient` (`:158-209`) checks only that the slip exists and is transient-capable. Two guests can book the same slip and dates, sequentially or concurrently.
*Fix:* insert within a transaction that re-checks the overlap with `SELECT ... FOR UPDATE` on the slip row, or (best) a Postgres exclusion constraint. Prisma needs a raw-SQL migration for this:
```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE slip_allocations ADD CONSTRAINT no_overlap
  EXCLUDE USING gist (slip_id WITH =, daterange(start_date, end_date, '[)') WITH &&)
  WHERE (status IN ('HELD','BOOKED','CHECKED_IN','ACTIVE'));
```
Return 409 and re-quote alternatives on conflict.

**TB-05. Back-to-back stays conflict: inclusive boundary comparison.** P0, S.
`transient.ts:76-80` uses `checkIn <= dateTo AND checkOut >= dateFrom`, so a departure on 6/10 blocks an arrival on 6/10.
*Fix:* half-open intervals: `existing.start < requested.end AND existing.end > requested.start`. Store `arrivalDate`/`departureDate` as `@db.Date` (local marina dates), not instants.

**TB-06. Timezone and date-boundary bugs.** P0, M.
- The API requires `z.string().datetime()` (UTC instants, `:26-27,44-45`), while the UI and widget send `YYYY-MM-DD`.
- `new Date('2026-06-05')` parses as UTC midnight, but `isWeekend` uses local `getDay()` (`TransientBookingWidget.tsx:82-96`). In US timezones every night shifts one day earlier, so Friday-night premiums land on Thursday.
- Night count uses `Math.round(ms/86400000)` (`:76-80`, `Transient.tsx:163-165`). That is fine across DST only by luck.
- `Tenant.timezone` and `Location.timezone` are never used in business logic (only admin and onboarding echo them).
- Check-in overwrites `checkIn` with `new Date()` and check-out overwrites `checkOut` (`transient.ts:235,271`). The *reserved* dates are lost, so night counts, revenue reports and overstay detection become meaningless.
*Fix:* date-only columns for reserved arrival and departure. Keep separate `actualArrivalAt`/`actualDepartureAt` timestamps. Compute nights server-side as the difference of local dates in the location's timezone. Base check-in and check-out cut-off times on location settings.

**TB-07. Price tampering: the client supplies `rateCents` and `totalCents`.** P0, M.
`transient.ts:28-29,195-196` persist whatever the client sends. No rate engine exists: no per-foot-per-night rate, minimum nights, seasonal or holiday rates, weekend premium, minimum billable LOA, utility surcharge, or tax. The widget's rates are hardcoded constants.
*Fix:* `TransientRate` (location, season date range, $/ft/night, min LOA, min nights, DOW adjustments, holiday overrides, power add-on by amps). Add a server `quote()` that returns line items plus tax (via `tax-engine`) and an opaque `quoteId`. `book()` accepts only the `quoteId`.

**TB-08. Payment is not taken and funds can be misrouted.** P0, M.
- `createPaymentIntent` is called with a **client-supplied `stripeConnectedAccountId`** (`transient.ts:31,174-181`). A user can direct the charge to any connected account on the platform, including another tenant's.
- The PaymentIntent is never confirmed and has no payment method.
- The booking is saved as BOOKED regardless of payment.
- There is no webhook reconciliation. The currency is hardcoded `usd` and the platform fee is hardcoded at 3%.
*Fix:* derive the account from `tenant.stripeAccountId`. Create the PaymentIntent in `quote` or `hold`. Mark BOOKED only on `payment_intent.succeeded` (webhook, idempotent). Store deposit vs. balance.

**TB-09. No hold or expiry.** P1, M.
There is no "held for 10 minutes while paying" state, so concurrent checkouts race and abandoned carts never release.
*Fix:* a `HELD` allocation with `expiresAt`, plus a sweeper job (which requires that jobs actually run, see X-02).

**TB-10. Check-in, check-out and overstay have no money side.** P1, M.
- Check-in does not verify payment, insurance or registration.
- Check-out (`:248-281`) does not compute actual nights, extra-night charges, metered power or an invoice.
- Overstay (`:284-310`) has only a `TODO: Trigger overstay alert`.
- No job flags overdue departures automatically.
- `TransientBooking` has no `invoiceId` link, so transient revenue never reaches the ledger.
*Fix:* generate an invoice at booking (paid by the PaymentIntent) and an adjustment invoice at check-out. Add a scheduled overstay detector.

**TB-11. Cancellation has no policy, refund or audit.** P1, M.
`DELETE /:id` (`:313-345`) sets CANCELLED and sometimes VACANT. There is no refund via Stripe, no cancellation fee or window, and no audit log. The `CancellationPolicy` model exists but is only used for rentals.
*Fix:* attach a policy to the rate. Refund a computed amount through Stripe. Write an audit log entry.

**TB-12. Booking is not linked to customer or boat records.** P1, S.
Guests are free-text (`guestName`, `boatLength`). There is no customer find-or-create, so repeat transients, insurance capture and marketing are lost. `boatLength` is optional, so no fit check is possible.

**TB-13. The staff Transient page does not persist anything.** P0, S.
`Transient.tsx:159-188` creates bookings in local state with a default rate of $85. "Today" is hardcoded to `'2026-03-25'` (`:194`) and the revenue month to `'2026-03'` (`:200`). The page falls back to `MOCK_BOOKINGS` when the API fails, which it always does (X-01).

**TB-14. No calendar or Gantt view, no rack rate grid, no availability calendar for staff.** P1, L. See section 8.

---

## 4. Contracts & e-signature

### 4.1 Creation, terms, state machine

**CT-01. A contract is ACTIVE at creation, with no signature, deposit or first invoice.** P0, M.
`contracts.ts:417` defaults `status` to ACTIVE, and the client can set any status (`:39`). The slip is marked OCCUPIED (`:422-427`). The SecurityDeposit row is created as HELD (`:430-440`), but no charge or invoice is created: it claims money the marina never collected. The proration is calculated and returned (`:401-405,468-478`), but it is written only to the audit log and never invoiced.
*Fix:* lifecycle DRAFT, then PENDING_SIGNATURE, then SIGNED (deposit and first-invoice gate), then ACTIVE on `startDate` (job), then EXPIRING, then EXPIRED or RENEWED, with TERMINATED as a side exit. Enforce transitions in one service. Remove `status` from the create and update schemas.

**CT-02. Slip availability check is weak and racy.** P0, M.
- `contracts.ts:357-374` checks for an existing contract only if `slip.status === 'OCCUPIED'`.
- It ignores DRAFT, future-dated and EXPIRING contracts, and the date range.
- It ignores RESERVED and MAINTENANCE status.
- It runs outside the transaction.
*Failure:*
- Two staff members assign the same slip concurrently.
- A renewal successor plus a new contract both cover next season.
- A contract is created on a slip in MAINTENANCE.
*Fix:* allocation-based overlap check plus an exclusion constraint (TB-04), shared with transient bookings.

**CT-03. Terms model cannot express seasonal or per-foot contracts.** P0, M.
- The `BillingCycle` enum is MONTHLY/QUARTERLY/SEMI_ANNUAL/ANNUAL.
- There is no contract *term type* (ANNUAL/SEASONAL/MONTHLY/WINTER).
- There is no per-foot rate (`ratePerFtCents`, billable length = max(LOA, slip length)).
- There is no installment plan (for example a seasonal fee paid as 3 installments).
- There is no definition of what `rateCents` means (per cycle or per term).
- The UI offers "Seasonal" (`Contracts.tsx:467,647,890`), which the API zod enum rejects.
*Fix:* add `termType`, `pricingBasis (FLAT|PER_FOOT)`, `ratePerFtCents`, `billableLengthFt`, `totalContractCents`, `paymentPlan` (schedule JSON or child `ContractInstallment` rows). Snapshot the slip and boat dimensions at signing.

**CT-04. No templates or contract document.** P0, L.
There is no `ContractTemplate` model, no clause library and no merge fields. No PDF is generated (`lib/pdf.ts` has only invoice, collections and report templates). The `ESignatureFlow` UI promises `"{contractNumber}_slip_agreement.pdf"` (`ESignatureFlow.tsx:431-434`), but nothing produces it. There is also no human-readable contract number (`renewal-engine.ts:217` uses `id.slice(0,8)`).
*Fix:* `ContractTemplate {version, bodyHtml with merge fields, rules: liability waiver, insurance minimums, liveaboard addendum, hurricane plan}`. Render to PDF with `generatePdf` and store it immutably in R2 with a SHA-256. Add a contract-number sequence per tenant.

**CT-05. `PUT /contracts/:id` bypasses every rule.** P0, S.
`contracts.ts:487-532` lets staff change `status`, `rateCents`, `endDate`, `billingCycle` and `boatId` on a signed, active contract. There is no amendment record, no re-signature, no slip-status sync and no boat ownership check (the boatId may belong to another customer).
*Fix:* allow only non-material edits. Material changes create a `ContractAmendment` that requires signature. Validate the boat against the customer and against slip fit.

**CT-06. No job transitions ACTIVE to EXPIRING or EXPIRED.** P0, S.
Nothing in `src/` sets EXPIRING or EXPIRED. Expired contracts stay ACTIVE forever, so the slip stays OCCUPIED, billing (if it ran) continues, and "expiring" lists depend on staff remembering.
*Fix:* a daily job in each tenant's timezone.

**CT-07. Customer soft-delete ignores active contracts.** P2, S.
`customers.ts:366-401` sets INACTIVE with ACTIVE contracts still billing.

### 4.2 Contract to invoice schedule

**CI-01. Recurring contract invoicing never runs.** P0, M.
`generateRecurringInvoices` (`billing.ts:34`) is imported only by its test. It is not in any worker switch (`workers/index.ts` billing worker handles only `tenant-lifecycle`, `:238-252`), not scheduled, and has no route. Today **no slip contract produces any invoice**.
*Fix:* a daily per-tenant job driven by a persisted `ContractBillingSchedule` (CI-02). Make it idempotent with a unique `(contractId, periodStart)` key.

**CI-02. If it ran, billing would be wrong for every non-monthly contract.** P0, M.
- `billing.ts:43-48,107-133` selects all ACTIVE contracts with `billingAnchor <= today.getDate()` and bills **full `rateCents` every calendar month**. QUARTERLY, SEMI_ANNUAL and ANNUAL are ignored: an annual contract bills 12 times.
- It does not check `startDate <= periodEnd` (contracts starting next season are billed now) or `endDate >= periodStart` (bills after expiry).
- The deferred-revenue window is always the current month (`:252-253`), even for annual prepayments.
- Server-local time is used instead of tenant time.
- `invoiceNumber = INV-${Date.now().toString(36)}` (`:182`) can collide within a run.
*Fix:* at signing, generate an explicit schedule: periods from `startDate` to `endDate` at the billing cycle, with first-period proration and the last period truncated at `endDate`. Each row gets a status. The job invoices due rows. Termination and amendments rewrite future rows.

**CI-03. `sourceType` mismatch breaks contract billing history and termination washout.** P1, S.
Billing writes `sourceType: "CONTRACT"` (`billing.ts:131`). Contract detail queries `"SlipContract"` (`contracts.ts:313`), and termination looks for deferred schedules with `"SlipContract"` (`:621-630`). Billing history is always empty and termination never finds deferred revenue.
*Fix:* one constant, plus a FK `InvoiceLineItem.contractId`.

**CI-04. Two inconsistent proration functions.** P1, S.
`contracts.ts:128-159` uses 90, 182 and 365-day cycles and local `getDate()`. `billing.ts:432-449` uses days in the month. Neither handles the end-of-term partial period. (The math is for the invoicing agent. This finding is about the *single source of truth*.)

### 4.3 E-signature

**ES-01. Send-for-signature always throws.** P0, S (to stop the crash) / L (real e-sign).
`contracts.ts:799-808,885-894,970-984,1019-1031` read and write `esignRequestId`, `esignStatus`, `esignSentAt`, `esignSignerName`, `esignSignerEmail`, `esignSignedAt`, `esignSignedDocumentUrl`. **None exist on `SlipContract`** (`schema.prisma:535-565`). The `as Record<string, unknown>` cast hides it from TypeScript, and Prisma throws "Unknown argument" at runtime, which surfaces as a 500. Even when "sent", no email is sent and no provider is called: the request ID is `Math.random()`.

**ES-02. The esign webhook is unauthenticated in logic but blocked by auth in practice.** P0, S.
`POST /contracts/esign-webhook` (`:934-1009`) sits behind `router.use(...clerkAuth())` (`:163`), so in prod DocuSign gets 401. If moved out, it has no HMAC/Connect signature verification, and `findFirst({ where: { id: contractId } })` (`:947`) is not tenant-scoped. Anyone could POST `signature_request_signed` for any contract ID. Signing also never activates the contract or triggers the deposit or first invoice.

**ES-03. `services/esign.ts` is dead and wrong.** P1 (replace), L.
- It is never imported.
- It targets `prisma.contract`, `esignEnvelopeId`, `signedAt` and `prisma.notification`, none of which exist.
- AuditLog fields `entityType`/`entityId`/`details` do not exist (the schema uses `recordType`/`recordId`/`changedFieldsJson`, `schema.prisma:823-838`).
- It is hardcoded to `demo.docusign.net` (sandbox) at `:118,240,338,375`.
- It sends `documentBase64` *and* `remoteUrl`.
- It uses a static API key as a Bearer token (DocuSign requires OAuth JWT grant).
- The HelloSign branch uses the DocuSign URL shape.
- The "magic link" fallback (`:41-63`) points to `/sign/:id`, but no such page exists in web or portal.
- The signed PDF is "uploaded" with an unauthenticated `fetch PUT` to `R2_UPLOAD_URL` (`:256-262`) rather than `lib/storage.ts`.

**ES-04. Not legally sound as designed (ESIGN Act / UETA).** P0 for launch with contracts, L.
Missing pieces:
- **Consumer consent disclosure** (ESIGN §101(c)): a hardware/software requirements notice, the right to paper copies, the right to withdraw consent, and affirmative consent captured before signing.
- **Intent to sign**: an explicit "I agree / Sign" action tied to a specific document version.
- **Attribution and audit trail**: signer identity verification (email OTP at minimum), IP, user agent, and timestamps for sent, viewed, consented and signed.
- **Record integrity**: SHA-256 of the exact rendered PDF at send and at completion, and a tamper-evident PDF (a PAdES/PKI seal, or the provider's certificate of completion).
- **Record retention and access**: an immutable stored original, and the fully executed copy **emailed to all parties**.
- Countersignature by the marina.
- Multiple signers (co-owners).

Even with DocuSign, Helm must store the envelope ID, the certificate of completion, the document hash, and the signed PDF per contract version.
*Recommendation:* do not build a native signature engine for launch. Integrate DocuSign (JWT auth, Connect HMAC) or Dropbox Sign properly. Add a `ContractSignature` model `{contractVersionId, provider, envelopeId, status, signerEmail, signerName, ip, userAgent, consentAt, viewedAt, signedAt, documentSha256, signedPdfKey, certificateKey}` and an append-only `ContractEvent` log.

**ES-05. Bulk send uses the customer's email without checking it.** P2, S.
`contracts.ts:880` uses `contract.customer?.email || ""`, so a missing email still reports "sent".

### 4.4 Amendments, slip moves, termination

**AM-01. No amendments or slip moves.** P0, M.
The UI transfer calls `POST /api/contracts/transfer`, which does not exist (`Contracts.tsx:772,792`). Errors are swallowed (`.catch(() => {})`), so staff believe the move happened.
*Fix:* `POST /contracts/:id/move {newSlipId, effectiveDate, rateChange?}`. This ends the allocation on the old slip and starts it on the new one, re-checks fit and overlap, prorates both rates on the billing schedule, writes an amendment, and optionally re-signs.

**TM-01. Termination is financially wrong.** P0, M. `contracts.ts:536-668`:
- (a) The penalty posts a **single-sided GL credit** (`:606-618`) with no debit and no invoice to the customer. That unbalances the ledger, and only happens if the caller passes `glAccountId`.
- (b) Unearned deferred revenue is marked **RECOGNIZED** (`:632-637`), booking prepaid future months as income instead of refunding or crediting them. It also never matches anything because of CI-03.
- (c) Held security deposits are loaded (`:552`) but never released, applied or refunded.
- (d) No final prorated invoice or credit memo is produced for the partial period.
- (e) A future `terminationDate` frees the slip immediately (`:600-603`).
- (f) FORMULA ("months of rent") multiplies `rateCents`, which for a quarterly or annual contract is not a month.
- (g) No notice to the customer.
*Fix:* termination service: compute the earned-through date; issue a credit memo for prepaid unearned periods or a final invoice for the partial period; invoice the penalty as a line item; deposit disposition (apply to balance, refund the rest via Stripe); cancel future schedule rows; end the allocation at the effective date.

**RN-00. Single renewal also activates early and loses the deposit link.** P1, S.
`contracts.ts:672-761`: the successor is ACTIVE immediately while the predecessor (still in term) becomes RENEWED. Its start equals the old end, an overlapping day under inclusive logic. No overlap check, no signature, no new deposit or transfer of the existing SecurityDeposit.

---

## 5. Renewals & waitlist

### Renewals

**RW-01. The renewal engine is unreachable and the worker never runs.** P0, M.
- No route calls `createBatch`, `previewBatch` or `executeBatch`.
- `startRenewalWorker` and `scheduleAutoRenewChecks` are never invoked.
- `docker-compose.yml:90` runs `node dist/jobs/renewal-job.js`. That module only *exports* functions, so the process exits or idles and does nothing.
- `workers/index.ts` (email, sms, automation, billing workers) is not started by anything either.

**RW-02. Auto-renew renews contracts that opted out.** P0, S.
`renewal-engine.ts:382-390` finds `autoRenew: true, renewalBatchId: null` contracts, then calls `createBatch` with filters that contain **neither** condition (`:396-405`). The batch therefore includes *every* ACTIVE/EXPIRING contract ending in 30 days. It also re-links contracts already in another batch, and is auto-approved (`:408-415`).
*Failure:* a boater who gave notice of leaving is silently renewed for a year and billed.

**RW-03. Execute does not require approval and creates ACTIVE successors immediately.** P0, M.
- `executeBatch` accepts DRAFT batches (`:266`).
- Successors are created ACTIVE with `start = old end` and **end = start + 1 year regardless of term type** (`:291-293`). A seasonal Apr to Oct contract becomes Oct to Oct.
- The predecessor becomes RENEWED mid-term.
- No customer acceptance, no signature, no notice period, no new deposit.
- Successors keep `renewalBatchId = batchId` (`:314`), so a later preview of the batch shows both generations.
- One transaction for the whole batch, with no per-contract error isolation.

**RW-04. Renewal notices and e-sign emails are dropped.** P0, S.
`queues.email.add("renewal-esign", {...})` (`:354-361`) carries no `type`. The email worker switches on `job.data.type` (`workers/index.ts:23-52`), logs "Unknown email type" and returns. `contractRenewalNoticeHtml` (`lib/email.ts:349`) is never used. There is also no T-90/T-60/T-30 notice cadence and no portal "Review Renewal" page, although the email links to one.

**RW-05. Rate-increase model is too thin.** P1, M.
- `custom` sets every contract in the batch to the same rate (`:80-83`).
- `fixedDollar` is ambiguous (dollars or cents).
- There is no per-foot re-pricing to the new season's rate card.
- There are no per-contract overrides: `ContractPreviewItem.overrideRateCents` exists but is never persisted.
- There are no caps or rounding rules.
- The revenue delta sums per-cycle rates across mixed billing cycles (`:143-148,205-214`), so the dollar impact is meaningless.

**RW-06. No renewal offer workflow.** P1, L.
Market standard is: offer generated, then sent, then accepted or declined in the portal, then signed, then deposit, then successor activated on start date. Declined offers release the slip to the waitlist. Helm has none of these states. `RenewalBatch.status` is a free string.

### Waitlist

**WL-01. Queue position is racy and scoped incorrectly.** P1, S.
`waitlist.ts:222-231` uses `max(queuePosition)+1` without a lock or unique constraint, so concurrent adds create duplicates. When `slipType` is null, `slipType: undefined` drops the filter and takes the global max across all types. There is no location scoping (Waitlist has `locationId` but the queue ignores it). There is no reorder endpoint, and removed or expired entries leave gaps that are never compacted (the portal shows "#3").
*Fix:* order by `(priorityTier, depositPaidAt, createdAt)` rather than a stored integer, or use a transactional resequencing with a unique `(tenantId, locationId, slipType, queuePosition)` constraint.

**WL-02. Offers are not tied to a slip, not sent, and do not reserve anything.** P0 (if the waitlist is sold), M.
- `notify-next` (`:360-442`) puts the next WAITING entry on HOLD, but stores no `offeredSlipId`.
- It does not check that the entry's boat fits the vacated slip.
- It does not mark the slip held, and sends nothing ("In a real system, this would trigger an email/SMS", `:430-431`).
- Expiry is manual (`PUT /:id/expire`). No job enforces `holdExpiresAt`, so an offer can sit forever and block the queue.
- Auto-notify-next on expiry hardcodes 48 h (`:623`).
*Fix:* `WaitlistOffer {entryId, slipId, rate, expiresAt, status}`. Find the first entry that fits the vacated slip (length, beam, draft, location, slip type). Send an email/SMS with a portal accept link. Use an expiry job.

**WL-03. No deposits or priority.** P1, M.
`WaitlistEntry` has no deposit amount, payment, refundability or priority (for example members, existing tenants upsizing). There are no annual waitlist renewal fees, which are common at waitlisted marinas.

**WL-04. Accept creates an unsigned, uninvoiced ACTIVE contract with a racy slip check.** P0, S.
`waitlist.ts:487-551`: the slip check runs outside the transaction and only on status (CT-02). The contract is ACTIVE with no signature or invoice (CT-01). There is no boat fit check. Leads must be converted first, but there is no inline conversion. There is no portal self-accept. The staff UI has no offer or accept actions (`Waitlist.tsx`, list only).

---

## 6. Leads & conversion

**LD-01. Public lead-form submit is blocked in production.** P0, S.
`lead-forms.ts:222` mounts `authedRouter` (whose `router.use(...clerkAuth())` applies to *every* request entering it) **before** the public `POST /:embedKey/submit` (`:227`). In prod, anonymous submissions get 401. Also, `tenantMiddleware` returns 404 for a third-party host before the route runs, and the tenant extension injects the host tenant into `leadForm.findUnique({embedKey})` (`:240`).
*Fix:* register public routes first, on a separate router mounted under `/api/public` that bypasses tenant middleware. Resolve the tenant from `embedKey`.

**LD-02. The lead widget payload fails validation.** P0, S.
`LeadFormWidget.tsx:125-129` sends `boatLength` as a string (zod expects a number) and an extra `formType`. The reCAPTCHA token is the literal `"recaptcha-placeholder-token"` (`:122-123`), which fails when `RECAPTCHA_SECRET_KEY` is set, and with no secret configured, CAPTCHA is skipped entirely (`lead-forms.ts:71`). Spam is wide open: there is no rate limit.

**LD-03. Staff UI never calls conversion or stage APIs.** P1, S.
- `ConversionWizard` `onConvert` just closes the panel (`LeadDetailPanel.tsx:706`).
- Stage changes call `PUT /api/leads` with no `:id` (`Leads.tsx:309,552`) instead of `PUT /api/leads/:id/stage`.
- The activity feed is `MOCK_ACTIVITY` (`LeadDetailPanel.tsx:73,341`).

**LD-04. Conversion duplicates customers and creates unsigned ACTIVE contracts.** P1, S.
`lead-conversion.ts:120-133` always creates a new Customer with no email/phone dedupe against existing customers. The optional contract is ACTIVE with no fit, overlap, signature or invoice (`:171-208`), the same pattern as CT-01 and CT-02. Waitlist entries tied to the lead are not repointed to the new customer, so `waitlist accept` then fails with NO_CUSTOMER.

**LD-05. Customer merge undo corrupts data; UI merge sends the wrong body.** P1, M.
- `undoMerge` (`customer-merge.ts:320-349`) moves **all** boats, plus all contracts, invoices and payments created before the merge, from primary to secondary. That includes the primary customer's own original records.
- Merge does not move `CommunicationPreference` (unique constraint) or `Lead.customerId`, and does not reconcile two Stripe customers.
- The UI posts `{sourceCustomerId, selections}` to `/customers/${targetId}/merge` (`CustomerDetail.tsx:1042-1046`), but the API expects `{targetCustomerId, fieldChoices}` with `:id` as the *primary*. That is a 400, swallowed, so staff see "merged".
- Merge targets are `MOCK_TARGETS` (`CustomerMerge.tsx:23,234`).
*Fix:* record moved IDs in a `CustomerMergeLog` and undo exactly those.

**LD-06. Communication preferences are never enforced.** P1, S.
No sender (`workers/index.ts`, announcements, automation) checks `communication_preferences`. There is no SMS consent capture (TCPA) and no unsubscribe link handling.

---

## 7. Customer portal

**PT-01. The portal is a static mockup.** P0, L.
Every page uses hardcoded arrays: `Dashboard.tsx:26-32`, `Invoices.tsx:9`, `InvoiceDetail.tsx:24-60`, `PaymentMethods.tsx:15`, `MyBoats.tsx:14`, `Insurance.tsx:25`, `WaitlistStatus.tsx:14-34`, `Announcements.tsx:14`, `Messages.tsx:12`, `ConciergeRequests.tsx:26`. There is not one API call in `apps/portal/src`. The "Pay Now" button (`InvoiceDetail.tsx:243-258`) and the COI upload (`Insurance.tsx:132-160`) do nothing.

**PT-02. No boater authentication model.** P0, M.
- `ClerkProvider` is mounted, but there is no `<SignedIn>`/`<RedirectToSignIn>` guard: anyone can open the portal (`main.tsx`, `App.tsx`).
- `User` has no `customerId` (`schema.prisma:308-324`), so a PORTAL_USER cannot be mapped to their Customer.
- The Clerk `user.created` webhook assigns **DOCK_STAFF** to every new user that has `tenant_id` metadata (`auth.ts:88`). A boater invited this way becomes staff.
- No invite flow, magic-link, or "claim your account by email/phone" exists.
- Portal routes on the API do not exist.
*Fix:* `User.customerId` FK and a PORTAL_USER-only `/api/portal/*` router where every query is filtered by `req.customerId`. Add an invite and magic-link onboarding (Clerk email OTP) triggered from the customer record, a contract send or a booking confirmation.

**PT-03. Missing portal features (none exist even as mock): contracts, renewals, bookings, documents.** P0 for contracts and renewals, L.
There is no page to view or sign contracts, accept a renewal, accept a waitlist offer, book or modify a transient stay, see a slip assignment, set seasonal away dates (needed for TB-03 resale), or manage autopay. Emails already link to "Review Renewal" and "View Reservation" (`lib/email.ts:226,293,369`), which go nowhere.

**PT-04. Card on file and autopay are unbuilt.** P0, M.
`PaymentMethods.tsx` is mock. There is no SetupIntent flow and no stored default payment method. Billing auto-charge (`billing.ts:267-305`) relies on the Stripe customer's default method, and nothing sets one. `achBlocked` gates *card* charges too (`:269`).

---

## 7b. Insurance / COI compliance holds

**IN-01. Cross-tenant leak in expiring compliance.** P0, S.
`compliance.ts:204-212` queries `insuranceRecord.findMany` with no tenant filter. `InsuranceRecord` is not in `TENANT_SCOPED_MODELS` (`lib/prisma.ts:17-55`), so `GET /api/boats/expiring-compliance` returns **every tenant's** expiring policies with customer names.
The allowlist also omits `SlipContract` (it lists the non-existent "Contract"), `MeterReading`, `RenewalBatch`, `SecurityDeposit`, `InsuranceRecord`, `CommunicationPreference` and `InvoiceLineItem`. Any query on these that forgets an explicit `tenantId` is cross-tenant, as `contracts.ts:947` already is.
*Fix:* add the missing models now. Longer term, use Postgres RLS.

**IN-02. Insurance review endpoints are unusable.** P0, S.
`requireRole("admin","manager")` (`insurance.ts:168,268,409`) never matches the enum roles, so the dashboard, review queue and approve/reject return 403 for every real user. Uploaded COIs can never be approved.

**IN-03. The compliance score ignores status and coverage, and holds are never enforced.** P1, M.
- `calculateBoatCompliance` (`compliance.ts:84-104`) treats any latest record (PENDING_REVIEW, REJECTED) as VALID if not expired.
- It does not check the liability minimum (for example $300k to $500k), the marina named as additional insured, or vessel match (HIN).
- Nothing blocks contract activation, transient check-in, renewal or haul-out on NON_COMPLIANT.
- There is no `COMPLIANCE_HOLD` status.
- There is no expiry reminder job (the `expiry_reminder` email exists but nothing enqueues it).
- The customer-level score in `customers.ts:215-233` duplicates the logic with different rules.
*Fix:* per-tenant compliance rules (min liability, required docs by term type), a single evaluator, and holds applied at gate points (sign, activate, check-in, renew). Run reminder jobs at T-30/T-7/expired.

---

## 7c. Cross-cutting blockers that directly break these flows

**X-01. The staff app silently shows mock data.** P0, S.
`apps/web/src/lib/api.ts:1` sets `API_BASE='/api'`, and every hook passes `/api/...` (for example `Slips.tsx:745`, `Contracts.tsx:769`, `Transient.tsx:132`). Every request goes to `/api/api/*`, gets a 404, and the page falls back to `MOCK_*` (`Slips.tsx:749`, `Contracts.tsx:774`, `Customers.tsx:185`, `CustomerDetail.tsx:672`, ...).
Even with the path fixed:
- List endpoints return `{data, pagination}` while pages expect arrays.
- UI field names (`number`, `dock`, `length`) do not match the API (`slipNumber`, `dockId`, `lengthFt`).
- Raw `fetch()` calls send no Clerk token, so they get 401 in prod.
- Failed writes are swallowed (`.catch(()=>{})`, `catch { /* best-effort */ }`).
*Fix:* remove the mock fallbacks entirely (show empty and error states), fix the base path, add a typed API client generated from zod schemas, and never swallow write errors.

**X-02. No background jobs run at all.** P0, M.
Nothing starts `workers/index.ts`, `startRenewalWorker`, `scheduleTenantLifecycle` or `scheduleAlgorithmicPricing`. The compose worker command is wrong. Every time-based behaviour depends on jobs: billing, contract expiry, hold expiry, waitlist offer expiry, overstay, reminders, renewals.
*Fix:* a single `worker.ts` entrypoint that starts every worker and registers repeatable jobs per tenant timezone, with health and metrics.

**X-03. Tenant lifecycle would lock every marina.** P0, S (before X-02 is fixed).
`tenant-lifecycle.ts:49-56` uses the tenant's *own customers'* PAST_DUE invoices as the signal that the marina's Helm subscription is unpaid. Its email type `tenant_lifecycle` is also unknown to the email worker. Gate it on the Stripe Billing subscription status of the platform account before enabling any workers.

**X-04. Auth bypass whenever `NODE_ENV` is not `production`.** P0, S.
`middleware/auth.ts:34-53` and `tenant.ts:64-66` turn off authentication and fall back to the first tenant. Neither `Dockerfile.api` nor `docker-compose.yml` sets `NODE_ENV=production`. (Other audits may cover this. It is listed here because it makes every route in this scope public.)

**X-05. Tests give false confidence.** P1, M.
- Contracts: 3 of 4 fail (`creates a contract` returns 400; terminate tests fail).
- Transient: 3 of 3 fail (one hangs).
- Compliance and billing service tests fail.
- `app.listen` runs on import, so the default test run hits EADDRINUSE on 3001 (`index.ts:107`).
- There are no tests for overlap, boundary days, timezones, billing cycles, renewal filters, waitlist races or e-sign.

---

## 8. Competitive gaps vs best-in-class marina software

Reference set: Dockwa (marketplace plus Dockwa Marina Management), Molo (Storable Marine), DockMaster, Marina Master, Harba, Scribble, Snag-A-Slip, Swiftpad.

| Capability | Table stakes? | Who has it | Helm today |
|---|---|---|---|
| Interactive slip availability calendar / Gantt (drag-to-move, color by status, nightly grid) | **Yes** | Dockwa, Molo, DockMaster, Marina Master, Harba | None (a "Calendar" tab exists with mock data) |
| Date-ranged inventory with seasonal tenant "away" releases resold as transient | **Yes** | Dockwa ("slip sharing"), Molo, Harba ("release your berth") | None (TB-03) |
| Boat-fit auto-assignment (LOA/beam/draft/power) and "best fit" suggestion | **Yes** | Molo, Dockwa, Marina Master, Harba | None (SD-03) |
| Online booking engine with real-time availability, instant or request-to-book, deposit capture | **Yes** | Dockwa, Snag-A-Slip, Swiftpad, Harba, Molo | Mock widget (TB-02) |
| Marketplace / channel integration (Dockwa, Snag-A-Slip, Marinas.com) with two-way sync | Expected by transient-heavy marinas | Molo, DockMaster (Dockwa integration) | None. Requires an availability API, an iCal/OTA-style feed and a webhook ingest first. |
| Flexible rate engine: per-ft/night, min LOA, min nights, seasonal, weekend/holiday, length bands, power surcharges, member/seasonal-holder discounts, promo codes | **Yes** | All | None (PromoCode/PricingRule exist only for rentals) |
| Group / rally / raft-up bookings (block of slips, one organizer, rooming-list style) | Common | Dockwa, Molo, DockMaster | None |
| Annual/seasonal/winter contract templates with per-foot pricing and installment plans | **Yes** | All | None (CT-03/CT-04) |
| Built-in e-sign with audit certificate, signed copy emailed | **Yes** | Molo, Dockwa, Marina Master, Scribble | Fake (ES-01..04) |
| Bulk renewals with rate-card re-pricing, per-contract overrides, portal acceptance and deposit | **Yes** | Molo, DockMaster, Marina Master | Unreachable or buggy (RW-*) |
| Waitlist with deposits, priority, fit-matching offers, expiring offers, annual waitlist fees | Common | Molo, Marina Master, Scribble | Partial (WL-*) |
| Card/ACH on file with autopay, payment plans, automatic dunning | **Yes** | All | Unbuilt (PT-04) |
| Boater portal or app: contracts, invoices, pay, book, COI upload, boat info, away dates | **Yes** | Dockwa app, Molo portal, Harba app, Scribble | Mock (PT-01..03) |
| Insurance/COI tracking with minimum coverage, additional-insured and holds | **Yes** | Molo, Marina Master, Scribble | Partial and broken (IN-*) |
| Liveaboard handling (fees, approval, occupant count, addendum, pump-out requirement) | Common | Molo, DockMaster, Marina Master | None (only a mock "Live-Aboard" billing item) |
| Metered electric and water with mobile reading capture and auto-invoice | **Yes** at metered marinas | DockMaster, Molo, Marina Master | No write path (SD-06) |
| Arrival/departure board, check-in with gate/WiFi codes, overstay auto-billing | **Yes** | Dockwa, Molo, Harba | Basic and broken (TB-10/TB-13) |
| Multi-location inventory and reporting (occupancy %, RevPAF, ADR) | **Yes** for multi-site | Molo, DockMaster | No location on slips (SD-01) |
| Storage/dry-stack, haul-out and service work orders tied to slip contracts | Common | DockMaster, Molo, Marina Master | Out of scope here. Not tied to contracts. |
| Hurricane/emergency plans and mass notifications by dock | Common in the Southeast | Molo, DockMaster | Announcements exist. No dock targeting. |

**Positioning note:** Helm cannot out-feature DockMaster or Molo at launch. The credible wedge is a modern, reliable *core*: correct date-ranged inventory, a fit-aware owned booking widget, signed per-foot contracts that bill themselves, and a real boater portal with autopay. Dockwa and Snag-A-Slip integration should follow once the availability API exists.

---

## 9. Prioritized fix/build list

### Phase 0: stop the bleeding (about 1 week, all S)
1. **X-04** Set `NODE_ENV=production` in images and fail closed if Clerk keys are missing.
2. **IN-01** Add `SlipContract, MeterReading, RenewalBatch, SecurityDeposit, InsuranceRecord, CommunicationPreference, InvoiceLineItem` to the tenant allowlist. Remove "Contract". Add an explicit tenant filter in `getExpiringCompliance`.
3. **X-03** Disable or rewrite tenant-lifecycle before any worker is enabled.
4. **TB-01** Fix `clerkAuth` usage in `transient.ts`.
5. **RW-02** Add `autoRenew: true, renewalBatchId: null` to the batch query (or pass IDs). Never auto-approve until RW-03 is fixed.
6. **ES-01/ES-02** Disable send-for-signature in the UI until real e-sign exists (it 500s today). Move the webhook out of auth and add provider signature verification.
7. **SD-05/IN-02** Apply enum-based `requireRole` to all routes in scope and fix `"admin","manager"`.
8. **X-01** Fix `/api/api`, delete all `MOCK_*` fallbacks, and surface write errors. Fix the slip Add/Edit/Assign, contract create payload, lead stage, conversion and merge calls.
9. **LD-01/LD-02** Mount the public lead submit before auth, resolve the tenant by `embedKey`, fix the widget payload, add real reCAPTCHA and a rate limit.

### Phase 1: core data model (about 2 weeks)
10. **SD-01/SD-02** Dock and Location FKs; full slip dimension and power model. (M)
11. **TB-03/TB-04/CT-02** `SlipAllocation` with half-open date ranges and a Postgres exclusion constraint. Use it for contracts, transient bookings, holds, maintenance and seasonal releases. Replace every `slip.status` write. (L)
12. **SD-03** Shared `fitsSlip` enforced in all five assignment paths. (M)
13. **CT-01/CT-05/CT-06** Contract state machine service, immutable material terms, daily status job in tenant timezone. (M)
14. **CT-03** Term type, per-foot pricing, installment plans, snapshotted dimensions. (M)
15. **X-02** A real worker entrypoint with per-tenant repeatable jobs. (M)

### Phase 2: money from contracts and bookings (about 2 weeks; coordinate with the invoicing audit)
16. **CI-01/CI-02/CI-03/CI-04** Persisted `ContractBillingSchedule` generated at signing, an idempotent daily invoicer, one proration function, a FK from line item to contract. (M to L)
17. **TM-01/AM-01/RN-00** Termination service (credit memo or final invoice, penalty invoice, deposit disposition, schedule rewrite), slip move and amendment endpoint. (M)
18. **PT-04** SetupIntent card/ACH on file, default payment method, autopay toggle, retry/dunning hooks. (M)

### Phase 3: booking window (about 2 weeks)
19. **TB-06/TB-05** Date-only reserved dates, actual timestamps, location timezone, server-side night count. (M)
20. **TB-07** Transient rate engine and a server `quote` with tax. (M)
21. **TB-02/TB-08/TB-09** Public availability/quote/hold/book API, server-side PaymentIntent on the tenant account, webhook-confirmed booking, hold expiry. Rebuild the widget. (L)
22. **TB-10/TB-11/TB-12/TB-13** Invoice at booking, check-out adjustments, overstay job, cancellation policy and refunds, customer/boat linking, staff page persistence. (M)
23. **TB-14** Staff availability Gantt with drag-to-assign or move. (L)

### Phase 4: contracts you can enforce (about 2 weeks)
24. **CT-04** Contract templates with versioned PDF rendering, SHA-256, contract numbering. (L)
25. **ES-03/ES-04** DocuSign/Dropbox Sign integration (JWT, Connect HMAC), `ContractSignature` and `ContractEvent` audit trail, ESIGN consent, executed copy emailed to all parties, countersign. (L)
26. **IN-03** Compliance rules and holds at sign, activate, check-in and renew; reminder jobs. (M)

### Phase 5: renewals, waitlist, portal (about 3 to 4 weeks)
27. **PT-02** Portal auth (`User.customerId`, invite or magic link, `/api/portal/*`). Fix the Clerk webhook default role. (M)
28. **PT-01/PT-03** Real portal pages: invoices and pay, contracts and sign, renewal accept, waitlist offer accept, bookings, boats, COI upload, away dates. (L)
29. **RW-01/RW-03/RW-04/RW-05/RW-06** Renewal routes and UI, offer workflow, term-aware successor dates, notice cadence, per-contract overrides, working emails. (L)
30. **WL-01..04** Fit-matched offers tied to a slip, expiry job, deposits and priority, portal accept. (M)
31. **LD-03..06** Lead UI wiring, dedupe on conversion, merge log and undo, enforced communication preferences and TCPA consent. (M)
32. **SD-06** Meter reading capture (electric and water), billed-reading linkage. (M)
33. **X-05** Test suite: overlap and boundary, timezone (DST, Pacific/Hawaii), billing cycles, renewal filters, concurrency (parallel booking), e-sign webhook verification. (M, ongoing)

### Phase 6: competitive (post-launch)
Group/rally blocks; liveaboard addendum and fees; member/seasonal-holder transient discounts; Dockwa/Snag-A-Slip channel sync; occupancy, RevPAF and ADR reports by location; dock-targeted emergency notifications.
