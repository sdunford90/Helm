# 12 — Configurability and Notifications: Audit and Target Design

**Scope:** what can be configured today and what is hard-coded (Part A), every notification today (Part B), and the target configuration and notification platforms (Part C).
**Method:** static read of the source. Every path was traced from the code that produces a message to the code that sends it. No source files were changed.
**Related:** `docs/audit/09-competitive-research.md` (the wider competitor landscape).

---

## 0. Executive summary

1. **Helm is configurable in the database and in the UI, but the configuration does nothing.** `routes/settings.ts` saves billing, branding and notification options into `Tenant.invoiceTemplateJson` and `brandingJson`, but the business logic never reads them. Specifically:
   - `services/billing.ts` hard-codes the `INV-` + base36 timestamp invoice number, Net-30, USD and auto-charge-always.
   - POS hard-codes a 7% tax rate.
   - No code reads the notification toggles.
   - The Settings page (`apps/web/src/pages/Settings.tsx`) is a mock. Its inputs are uncontrolled, pre-filled with "Bayshore Marina" values, and call `GET/PUT /api/settings`. That route does not exist (only `/api/settings/marina|branding|billing|...` exist). Saving sends only `{ tab }`.
2. **Location is a label, not a scope.** `Location` has only name, address and timezone. `Slip`, `SlipContract`, `Invoice`, `Customer`, `Product` and `Payment` have no `locationId`. A multi-marina portfolio therefore cannot have different rates, taxes, policies, hours or senders per location.
3. **There is one tax rate per tenant, and its format is inconsistent.** The UI and API store `taxRate` as a percentage from 0 to 100. The tax engine reads a different key (`taxRates[]`) and treats the rate as a fraction.
4. **No notification is ever delivered.** The facts already confirmed (no scheduler, no worker entry point) hold. Beyond that, even with a worker running:
   - Every producer's payload is incompatible with the email worker's `switch(type)`. The five templates the worker handles have no producers at all.
   - The SMS worker reads `to`, but announcements send `phone`.
   - The automation worker queries snake_case Prisma fields and would throw.
   - The `email-automation` router is not mounted.
   - Its Prisma models (`AutomationRule`, `EmailTemplate`, `EmailAutomationLog`) do not exist in `schema.prisma`.
   - The `worker` service in `docker-compose.yml` runs `dist/jobs/renewal-job.js`. That module has no top-level side effects, so the container exits and restarts in a loop.
5. **There is no compliance plumbing.** Nothing implements CAN-SPAM unsubscribe, a postal address in the footer, RFC 8058 one-click `List-Unsubscribe`, an SMS consent capture, STOP/HELP handling, 10DLC brand/campaign registration, a consent ledger, or delivery webhooks. `CommunicationPreference` exists, but no send path checks it. Marketing announcements go to every non-inactive customer.
6. **Recommendation:** build two platform services before go-to-market (GTM):
   - a **layered, typed Settings service** (platform → tenant → location → product/slip type/segment), with versioning and audit;
   - a **Notification platform** (event catalog → rules → templates → preferences/consent → outbox → channel adapters → delivery tracking), run by a dedicated, supervised worker and a scheduler process.

---

## PART A — Configurability inventory

Legend: **HC** = hard-coded, **T** = tenant-configurable (stored), **T\*** = stored per tenant but never read by business logic, **L** = location-configurable, **UI-mock** = shown in the UI but not persisted.

### A.1 What the configuration surface looks like today

| Surface | Reality |
|---|---|
| `Tenant` (schema.prisma:249-272) | `name`, `subdomain`, `customDomain`, `brandingJson`, `invoiceTemplateJson` (also used as a catch-all settings blob), `timezone` (default `America/New_York`, :258), `fiscalYearEnd` (default `12/31`, :259), `saasTierId`. Code also reads `tenant.settings` (settings.ts:89, onboarding.ts:382), but **that column does not exist**. |
| `Location` (:274-292) | `name`, `address`, `city`, `state`, `zip`, `phone`, `timezone` (default `America/New_York`, :283), `active`. No settings, hours, tax, sender, currency or units. No model links to it except `LeadForm`, `Lead`, `WaitlistEntry`, `CancellationPolicy`, `RentalProduct`, `Shift` and `Inventory` (all nullable). |
| `SaasTier` (:294-306) | `monthlyFeeCents`, `perLocationFeeCents`, `achFeeRate`, `cardFeeRate`, `storageLimitGb`. No feature or entitlement flags. The 3% platform fee is hard-coded separately (A.2). |
| `CancellationPolicy` (:840-852) | The only real policy object: `tenantId`, optional `locationId`, `isWeatherPolicy`, `rulesJson` `[{hoursBeforeStart, refundPct}]`. It is used by rentals (rentals.ts:1105-1120). Transient and slip contracts have no equivalent. |
| `CommunicationPreference` (:1306-1321) | `(customerId, channel, category, optedIn)`. Categories are fixed: `billing`, `inspections`, `marketing`, `announcements` (communication-prefs.ts:10-11). Defaults are opted-in except marketing (:20). It has no source, timestamp of consent, IP or wording, so it is not a consent record. **No sender ever checks it.** |
| `ModulesContext.tsx` | One flag (`rentals`) stored in **browser localStorage** (`helm_modules`). It is per device, not per tenant, is never enforced server-side and is not tied to `SaasTier`. |
| `settings.ts` endpoints | `/marina`, `/branding`, `/billing`, `/stripe*`, `/qbo*`, `/team*`, `/notifications`. Zod validation exists. **No audit log entries** are written for setting changes (other modules do write `AuditLog`). |
| `Settings.tsx` | Tabs: Profile, Branding, Billing, Catalog, Integrations, Team, Modules, Advanced. All values are `defaultValue=` literals or mock arrays (`DOCKAGE_RATES_DATA`, `PAYMENT_TYPE_DEFAULTS`, `REVENUE_MAPPING_DEFAULTS`). It has **no Notifications tab**, although the API exposes `/settings/notifications`. |

### A.2 Setting-by-setting inventory

| # | Setting | Current location (file:line) | Status today | Recommended scope | Recommended default |
|---|---|---|---|---|---|
| 1 | Org timezone | schema.prisma:258; settings.ts:19,156 | T (only `taxRates`-free code paths read it; billing uses server-local `new Date()`) | Tenant, overridden by Location | Derived from the address at onboarding |
| 2 | Location timezone | schema.prisma:283 | L (stored; no job uses it) | Location | Inherit tenant |
| 3 | Timezone choices | Settings.tsx:386-393 | HC (4 US zones only) | Platform (full IANA list) | — |
| 4 | Fiscal year end | schema.prisma:259; Settings.tsx:395 (UI says "Start" and stores a month index, while the API expects `MM/DD`) | T (format mismatch) | Tenant | 12/31 |
| 5 | Operating / business hours | Settings.tsx:403-416 (06:00-20:00, Sun 08:00-18:00) | UI-mock | Location (+ seasonal calendars, holidays) | Mon-Sun 08:00-17:00 |
| 6 | Currency | billing.ts:290, payments.ts:311, ramp.ts:181, transient.ts:177, stripe-terminal.ts:50,135 (`"usd"`); pdf.ts:65,172 (`USD`); web/src/lib/format.ts:6-13 (`$`); 100+ `$${...toFixed(2)}` call sites in web/portal/widgets | HC | Tenant (one currency per Stripe account), display per Location | USD |
| 7 | Locale / number and date format | format.ts:1-28 (English month array, 12h clock); `en-US` in pdf.ts, billing.ts:125 and about 20 web files | HC | Tenant, overridable per user | en-US |
| 8 | Length / volume / depth units | Slip `lengthFt`, `beamFt`, `depthFt` (schema:512-515); fuel `gallons` (fuel.ts:23,32); dock-walks.ts:71 | HC (feet, gallons) | Tenant display preference (store SI or canonical, convert at display) | ft / gal (US); m / L (intl) |
| 9 | Brand primary / secondary colours | settings.ts:204-205,233-234 (`#0A2342`/`#00D4FF` fallbacks); Settings.tsx:428-445 shows fixed swatches; `#0A2342` appears 768 times in web/portal/widgets styles | T (stored) / HC (rendered) | Tenant, overridable per Location (sub-brands) | Helm palette |
| 10 | Logo / favicon | settings.ts:26,35; Settings.tsx:448 upload box is non-functional | T\* | Tenant + Location | none |
| 11 | Marina display name in portal / widgets | portal PortalLayout, Dashboard, InvoiceDetail, Announcements, WaitlistStatus ("Bayview Marina"); web AppLayout ("Bayshore") | HC | Tenant / Location | Tenant.name |
| 12 | Email "from" address | email.ts:31-33 (`billing@{marinaDomain}` or `noreply@gethelm.com`) | HC (no verified-domain model) | Tenant + Location sender identities | `{tenant}@mail.gethelm.com` with the marina reply-to address |
| 13 | Email footer "Powered by Helm" | email.ts:80 | HC | Platform (tier-dependent white-label) | Shown on lower tiers |
| 14 | Email button colour | email.ts:88 (`#0066ff`) | HC | Tenant brand | brand.primary |
| 15 | Email copy (all templates) | email.ts:95-372; workers/index.ts:128-202 | HC | Tenant template overrides on platform defaults | Platform defaults |
| 16 | Rental "what to bring" / check-in steps | email.ts:228-232, 285-290 ("arrive 15 minutes before") | HC | Product / Location | Text block per product |
| 17 | E-sign link expiry text | email.ts:258 ("expires in 7 days") | HC (not tied to the provider setting) | Tenant | 7 days |
| 18 | Renewal auto-renew copy | email.ts:370 ("renewed automatically at the new rate") | HC | Contract template | Per template |
| 19 | Payment terms (Net N) | Settings saves `defaultPaymentTerms` (settings.ts:39,278); billing.ts:183-184 and invoices.ts use **+30 days** | T\* (ignored) | Tenant → Location → Contract type → Customer | Net 30 / "due on 1st" |
| 20 | Invoice number prefix / sequence | settings.ts:43-44,282-283 (`INV-`, 1001); billing.ts:182 and invoices.ts:263 use `INV-${Date.now().toString(36)}` | T\* (ignored; numbers are not sequential, which is an audit risk) | Tenant (optionally per Location) with gapless sequence | `INV-{YYYY}-{00000}` |
| 21 | PO numbering | inventory.ts:525 (`PO-0001`) | HC | Tenant | `PO-{0000}` |
| 22 | Late fee % | settings.ts:40,279 (1.5); UI 1.5 | T\* (**no late-fee engine exists**) | Tenant → Location → Contract type | Off; when enabled, 1.5%/month or a flat amount, whichever is greater |
| 23 | Late fee grace days | settings.ts:41,280 (10); UI default 5 (inconsistent) | T\* | Same as above | 10 |
| 24 | Auto-charge on invoice | settings.ts:42,281 (false); billing.ts:267-305 **always** charges when a Stripe customer exists | T\* (ignored; charges customers who did not opt in) | Tenant default + Customer opt-in (mandate) | Off (customer mandate required) |
| 25 | Default tax rate | settings.ts:45,284 (percentage); tax-engine.ts:57-66 reads `taxRates[]` as a fraction; UI default 7.0 | T\* (key and units mismatch) | Location (jurisdiction) × tax category; customer exemptions | 0 until configured; block invoicing until tax is set up |
| 26 | POS tax | pos.ts:373 (`taxClass ? 0.07 : 0`) | HC 7% | Location × product tax class | from tax table |
| 27 | Tax categories | billing.ts:128,144 (`slip_rental`, `electricity`) | HC | Platform list + tenant custom | — |
| 28 | Tax ID / EIN | Settings.tsx:501 | UI-mock | Tenant / legal entity per Location | — |
| 29 | Electricity rate per kWh | settings.ts:46,285 (0.12) vs Slip `kwhRateCents`; UI catalog 0.14 | T\* and per-slip | Location → Pedestal or meter type → Slip | from utility tariff |
| 30 | Electricity mode | schema `ElectricityMode` (FLAT_FEE/METERED), Slip default FLAT_FEE | Per slip | Slip type → Slip → Contract | FLAT_FEE |
| 31 | Security deposit default | settings.ts:47,286 (50000 cents = $500) | T\* | Location × slip type / contract type | $0 |
| 32 | Proration method | billing.ts:432-449 (actual days in month) | HC | Tenant / contract type (daily, 30-day, none, half-month) | Actual days |
| 33 | Billing run day | billing.ts:40-47 (`billingAnchor <= today`) | Per contract | Tenant default anchor + contract override | 1st |
| 34 | Invoice line description format | billing.ts:125 (`Slip X — Month YYYY` en-US) | HC | Template | — |
| 35 | Renewal term length | renewal-engine.ts:290-292 (always +1 year) | HC | Contract template | 12 months |
| 36 | Auto-renew lookahead window | renewal-engine.ts:378-380 (30 days) | HC | Tenant / contract type | 60 days |
| 37 | Auto-approve auto-renew batch | renewal-engine.ts:405-414 | HC (always auto-approves) | Tenant workflow | Require approval |
| 38 | Renewal rate increase | renewal-engine.ts:26,71 (per batch) | Per batch | Tenant default + slip type | 0% |
| 39 | ACH return fee | ach-handler.ts:38 ($25) | HC | Tenant / Location | $25 |
| 40 | ACH block R-codes | ach-handler.ts:16 (R02, R03, R07, R10) | HC | Platform default, tenant override | as is |
| 41 | Platform application fee | transient.ts:179, ramp.ts:183 (3%); SaasTier rates are never read here | HC | Platform × SaasTier | per tier |
| 42 | Slip-holder free launch | ramp.ts:160-172 (any active contract makes the launch free) | HC | Location ramp policy (free / discount % / N per season) | discount configurable |
| 43 | Waitlist hold duration | waitlist.ts:45 (48h, request param) | Request-level | Location × slip type | 48h |
| 44 | Insurance reminder offsets | insurance-ai.ts:323-334 (30 and 7 days) | HC | Notification rule | 60/30/7/0 |
| 45 | Rental cancellation tiers | CancellationPolicy.rulesJson | T / L / Product | Product → Location → Tenant | 48h 100%, 24h 50%, 0 |
| 46 | Weather cancellation | `isWeatherPolicy` flag only; no trigger | T (flag) | Location | Full credit |
| 47 | Transient rate / nights / check-in and check-out times / minimum nights | transient.ts:19-31 (client sends `rateCents`/`totalCents`; no server rate table; no check-in/out time) | Missing | Location × slip type × season | 3pm / 11am; minimum 1 night |
| 48 | Rental time slots | widgets RentalBookingWidget.tsx:392 (8 AM-5 PM list) | HC | Product (schedule) | product hours |
| 49 | Dynamic pricing multipliers | algorithmic-pricing.ts:110-137 (0.85-1.20 bands, lead-time rules), 30-day horizon :102, Sunday cron :188 | HC | Tenant / product strategy | conservative preset |
| 50 | Fuel prices / cost / tank capacity | fuel.ts:50-53 (**in-memory global array shared by every tenant**) | HC / volatile | Location × fuel type (DB) | — |
| 51 | Low-fuel threshold | none | Missing | Location × tank | 20% |
| 52 | GL account mapping | gl-posting.ts:86-95 (AR 1200, Slip 4000, Elec 4100, Deferred 2400…); onboarding.ts:320+ seeds 2100/2110 deferred; Settings.tsx:230-238 shows 4100 dockage / 4200 electricity | HC, and **three sources disagree** | Tenant (per Location class/department) | from seeded chart |
| 53 | Accepted payment methods | Settings.tsx:526-531, 249-256 | UI-mock | Location × channel (POS / billing / portal / widget) | card, ACH |
| 54 | Customer-merge undo window | customer-merge.ts:36 (15 min) | HC | Platform | 15 min |
| 55 | SaaS dunning schedule | tenant-lifecycle.ts:45-150 (day 1/7/14/30 lock), cron `0 6 * * *` UTC (:233) | HC (platform) | Platform | as is, but use the tenant timezone |
| 56 | Notification master switches | settings.ts:50-59, 694-703 | T\* (never read) | Superseded by NotificationRule | — |
| 57 | Communication categories | communication-prefs.ts:10-11 | HC (4 categories) | Platform catalog + tenant custom topics | — |
| 58 | SMS from number | sms.ts:12 (`TWILIO_DEFAULT_NUMBER` env); onboarding reads the non-existent `tenant.settings.twilioPhoneNumber` | Env / broken | Tenant + Location sender (10DLC campaign) | platform pool (transactional only) |
| 59 | Terms and conditions / waiver / contract text | none (e-sign uses provider templates via env `ESIGN_PROVIDER`, esign.ts:24) | Missing | Tenant document templates, versioned | starter templates |
| 60 | Modules / feature flags | ModulesContext.tsx (localStorage) | Client-only | Platform entitlement (tier) × tenant toggle × location toggle | per tier |
| 61 | Roles and permissions | settings.ts:63-69 enum; Settings.tsx:1146 "Role Permissions" mock | HC enum | Tenant custom roles on platform permission set | 5 built-in roles |
| 62 | Custom fields | none | Missing | Tenant (per entity), with Location visibility | — |
| 63 | Custom domain | Tenant.customDomain; Settings.tsx:1234 | T (no DNS verification) | Tenant | — |
| 64 | Webhook endpoints | Settings.tsx:1013 | UI-mock | Tenant | — |
| 65 | NPS / Google review URL | email.ts:344 param, no setting | Missing | Location | — |

**Root causes:**
- There is no settings resolver, so each module reads raw JSON or falls back to literals.
- Business data has no `locationId`.
- No contract defines the meaning and units of each setting.

---

## PART B — Notification inventory

### B.1 The pipeline as it exists today

```
producer ──queues.email.add(name, payload)──► Redis "email" ──► emailWorker (workers/index.ts:20)
                                                               switch(payload.type) { invoice | payment_receipt | ach_return | expiry_reminder | announcement }
                                                               uses payload.to, payload.data
producer ──queues.sms.add(...)────────────► Redis "sms"   ──► smsWorker (reads payload.to, body, fromNumber)
producer ──queues.automation.add(...)─────► Redis "automation" ► automationWorker (rental drip, algorithmic pricing)
```

**Global blockers (each one is fatal by itself):**
1. `workers/index.ts` is never started. There is no `package.json` script and no Dockerfile command for it. `docker-compose.yml:74-90` runs `node dist/jobs/renewal-job.js`, which only *exports* `startRenewalWorker` and `scheduleAutoRenewChecks`, so the process exits immediately and `restart: unless-stopped` loops it.
2. `scheduleTenantLifecycle` (tenant-lifecycle.ts:231), `scheduleAlgorithmicPricing` (algorithmic-pricing.ts:186), `scheduleAutoRenewChecks` (renewal-job.ts:86) and `startRenewalWorker` (:64) are **never called**.
3. No producer sends a payload the email worker understands (table below). The worker's five `type`s have zero producers.
4. No Resend or Twilio status webhooks exist. `AnnouncementDelivery.status` stays `PENDING` forever, and `sendEmail`/`sendSms` swallow errors and return `null`, so BullMQ never retries.
5. **Consent:** `CommunicationPreference` is never consulted by any send path. Emails have no unsubscribe link, no postal address and no `List-Unsubscribe` header. STOP/HELP are not handled. `provisionPhoneNumber` (sms.ts:59-88) buys a raw local number with **no 10DLC brand/campaign registration**, so US carriers would block or filter A2P traffic. Lead and booking widgets require a phone number (RentalBookingWidget.tsx:216) but capture **no SMS consent**.
6. **Security:** templates interpolate unescaped values (`${params.customerName}`, the announcement `body` as raw HTML), which allows HTML injection into outbound mail. Announcement routes have no `requireRole` (announcements.ts:105 applies only `clerkAuth`).

### B.2 Notification-by-notification table

| # | Notification | Trigger / producer | Recipient | Channel | Template source | Fires today? (trace) | Configurable? | Consent / opt-out checked? |
|---|---|---|---|---|---|---|---|---|
| 1 | Invoice sent | `POST /invoices/:id/send`, invoices.ts:619 `queues.email.add("send-invoice", {customerEmail, invoiceNumber, totalCents…})` | Customer | Email | worker `invoice` → `invoiceEmailHtml` (email.ts:95) | **No.** No worker runs; the payload has no `type` or `to`, so it would be dropped as "Unknown email type". | No (settings `invoiceCreatedEmail` is ignored) | No (transactional, so acceptable, but no footer) |
| 2 | Invoice created (recurring billing) | billing.ts generateRecurringInvoices | Customer | Email | — | **No.** There is no producer, and the billing job itself is never scheduled. | No | — |
| 3 | Payment receipt | — | Customer | Email | `paymentReceiptHtml` (email.ts:121) | **No.** The template exists but no producer does (payments.ts and billing auto-charge enqueue nothing). | No | — |
| 4 | ACH return | ach-handler.ts:204 `"ach-return-notification"` | Customer | Email | `achReturnHtml` (email.ts:149) | **No.** Payload has no `type`/`to` (uses `customerEmail`, `amountCents`). | No | — |
| 5 | Insurance expiry 30-day / 7-day | insurance-ai.ts:339 delayed jobs, `type:"insurance_expiry_reminder"` | Customer | Email | intended `expiryReminderHtml` | **No.** The type is not in the switch, there is no `to`, and a delayed job lives in Redis for weeks (lost on flush; not recalculated if the policy is replaced). | No (offsets HC) | — |
| 6 | Renewal e-sign request | renewal-engine.ts:354 `"renewal-esign"` | Customer | Email | intended `contractSignatureRequiredHtml` (email.ts:237, never imported) | **No.** No `type`; the renewals worker is never started either. | No | — |
| 7 | Contract renewal notice | — | Customer | Email | `contractRenewalNoticeHtml` (email.ts:349) | **No** (no producer) | — | — |
| 8 | Rental booking confirmation | — | Customer | Email | `bookingConfirmationHtml` (email.ts:203) | **No** (no producer) | — | — |
| 9 | Rental reminder (day before) | — | Customer | Email | `rentalReservationReminderHtml` (email.ts:262) | **No** | — | — |
| 10 | Rental agreement / waiver signature | — | Customer | Email | `rentalAgreementSignatureHtml` (email.ts:298) | **No** | — | — |
| 11 | Post-rental thank-you + Google review | — | Customer | Email | `postRentalThankYouHtml` (email.ts:328) | **No** | — | — |
| 12-18 | Rental drip: ABANDONED_CART_1/2, ABANDONED_CART_3 (SMS), POST_BOOKING, PRE_ARRIVAL, POST_RENTAL, NPS_SURVEY | automationWorker (workers/index.ts:127-206); intended to be driven by `RentalAutomationEvent` | Customer | Email, SMS (cart 3) | Inline hard-coded HTML in the worker | **No.** Nothing creates `RentalAutomationEvent` rows or automation jobs. The worker queries `tenant_id`/`first_name`, which are not Prisma fields, so it would throw. The case names `POST_BOOKING`/`POST_RENTAL` do not match the enum (`POST_BOOKING_CONFIRM`, `POST_RENTAL_THANKS`). `CHECK_IN_REMINDER`, `GOOGLE_REVIEW_PROMPT` and `RE_ENGAGEMENT` have no case. | No | **No.** Abandoned-cart and NPS messages are *marketing* and need consent, especially the SMS. |
| 19 | Announcement email | announcements.ts:404, 608 `"announcement-email"` | Audience (`all`, `active_customers`, `slip_holders`, `waitlist`, `custom`) | Email | `announcementHtml` (email.ts:187) | **No.** No `type`/`to` (uses `email`). The announcement is still marked `sentAt` and deliveries are created as `PENDING`, so the UI shows it as sent. Scheduled announcements have no scheduler. | Per message | **No.** Ignores `announcements`/`marketing` preferences; no unsubscribe link. `isEmergency` exists but cannot be set on create and is never used to bypass preferences. |
| 20 | Announcement SMS | announcements.ts:416, 620 `"announcement-sms"` | Audience | SMS | raw body | **No.** Payload has `phone`, but the worker reads `to`, so Twilio would reject it. No 160/1600-character or segment handling. | Per message | **No** TCPA consent, STOP or quiet hours |
| 21 | Automation-rule email/SMS | services/email-automation.ts:617, 634 (`processRule`) | Customer | Email, SMS (SMS uses the subject line as the body) | Tenant `EmailTemplate` with `{{var}}` merge (email-automation.ts:494) | **No.** `processAutomationTrigger` is never called. The router `routes/email-automation.ts` is **not mounted** in index.ts. The `AutomationRule`, `EmailTemplate` and `EmailAutomationLog` models are **missing from the schema**. The email payload has no `type`, so the worker would drop it. `sendAutomationEmail` exists but no worker calls it. | Designed to be (25 triggers, delay, conditions) | No |
| 22-25 | SaaS dunning day 1, 7, 14, 30 lock | tenant-lifecycle.ts:70, 129, 172, 208 `type:"tenant_lifecycle"` | Marina owner | Email | inline subject/message | **No.** The type is not handled and the job is not scheduled. | Platform | n/a |
| 26 | Waitlist offer ("slip available") | waitlist.ts:365-436 sets `HOLD` and `notifiedAt` | Waitlisted customer or lead | (none) | — | **No.** The code comment says "In a real system, this would trigger an email/SMS". The UI and database say "notified". | Hold hours per request | — |
| 27 | Dock-walk violation, welcome, payment failed, contract expiring 60/30/7, registration expiry, invoice past due 0/7/14/30 | Declared only as `AutomationTrigger` (email-automation.ts:9-34) and in the settings toggles | Customer | — | — | **No** producers | — | — |
| 28 | Staff alerts (low fuel, low inventory, failed QBO sync, failed auto-charge, chargeback, insurance pending review) | none (only `console.error`, e.g. qbo-sync.ts:215, 233, 256; billing.ts:354) | Staff | — | — | **No** | — | — |
| 29 | Push / in-app | none. A service worker exists for offline sync (web/src/main.tsx:79), not for push. There is no notification bell; `Bell` icons are the Concierge nav. | — | — | — | **No** | — | — |
| 30 | Portal messages | portal/src/pages/Messages.tsx is mock content | Customer | in-app | — | Mock | — | — |
| 31 | Outbound integration webhooks | Settings.tsx:1013 UI only | Systems | Webhook | — | **No** | — | — |

**UI state:** `apps/web/src/pages/EmailAutomation.tsx` uses only mock `RULES` and `TEMPLATES` and is not routed in App.tsx. The Announcements page's automation tab reuses the same mocks (Announcements.tsx:123-145). `CommunicationPrefs.tsx` (staff view) does call the real prefs API. **The portal has no preferences page and no unsubscribe page.**

**Net: of more than 31 notification types, zero are delivered, zero check consent, and none have delivery tracking.**

### B.3 Compliance gaps that block GTM

| Requirement | Status | Needed |
|---|---|---|
| CAN-SPAM: unsubscribe in commercial email, honoured within 10 business days, sender's physical postal address | Missing | Footer per Location (address), tokenised unsubscribe page, suppression list |
| Gmail/Yahoo bulk-sender rules (2024): SPF, DKIM, DMARC; RFC 8058 one-click `List-Unsubscribe`; spam rate below 0.3% | Missing (unverified tenant domains used as `from`) | Per-tenant verified domains in Resend (or a platform subdomain) and `List-Unsubscribe` + `List-Unsubscribe-Post` headers |
| TCPA: prior express (written, for marketing) consent for SMS; revocation by any reasonable means honoured promptly (the FCC 2024 order sets a 10-business-day limit); quiet hours (federal 8am-9pm recipient local time; some states such as FL and OK are stricter) | Missing | Consent capture with disclosure text and version, ledger, quiet-hours enforcement by the *recipient's* timezone |
| CTIA: STOP / HELP / START keywords and confirmation replies | Missing (Twilio's default opt-out may block silently at Twilio, and Helm would keep retrying with error 21610) | Inbound SMS webhook, keyword handling, sync with Twilio opt-out state |
| A2P 10DLC brand + campaign registration (or toll-free verification) | Missing | Per-tenant brand (EIN) + campaign(s) via Twilio Trust Hub; messaging service per tenant/location |
| Transactional vs marketing distinction | Not modelled | `category.isMarketing`; transactional messages bypass marketing opt-out but never a channel-level STOP |

---

## PART C — Target design

### C.1 Layered configuration system

#### C.1.1 Resolution model

```
Platform default (code, zod .default())
  └─ Tenant override
       └─ Location override
            └─ Scope overrides (any of, by precedence):
                 Product / RentalProduct
                 Slip type (and Dock)
                 Contract type / Rate plan
                 Customer segment (e.g. "Annual", "Seasonal", "Commercial", "Club member")
                 └─ Record-level override (a specific contract, customer or invoice; stored on the record)
```

- **Resolution rule:** take the most specific *defined* value. A setting definition can declare a `mergeStrategy`: `replace` (the default), `deepMerge` (objects such as `branding`), or `append` (lists such as `requiredDocuments`).
- **Allowed scopes per key:** each setting declares `scopes: ["tenant","location","slipType"]`. Overrides at undeclared scopes are rejected. For example, `currency` is tenant-only because there is one Stripe account; `taxRates` is location-only.
- **Locks:** a tenant can mark a key `locked` so locations cannot override it. This is the portfolio-governance case, for example "all locations must use corporate late-fee policy".
- **Effective dating:** rates and taxes need `effectiveFrom`/`effectiveTo`, so settings rows carry an optional effective window. The resolver takes an `asOf` date, which makes billing re-runs reproducible.

#### C.1.2 Typed registry (code)

```ts
// packages/config/src/registry.ts
export const settings = defineSettings({
  "billing.paymentTerms": {
    schema: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("net"), days: z.number().int().min(0).max(120) }),
      z.object({ kind: z.literal("dayOfMonth"), day: z.number().int().min(1).max(28) }),
      z.object({ kind: z.literal("dueOnReceipt") }),
    ]),
    default: { kind: "net", days: 30 },
    scopes: ["tenant", "location", "contractType", "customer"],
    group: "billing", label: "Default payment terms", sensitive: false,
    requiresPermission: "settings.billing.write",
  },
  "tax.rates": { schema: TaxRateTable, default: [], scopes: ["location"], effectiveDated: true, ... },
  ...
});
```

- One registry is shared by the API (validation and resolution) and the web app (form generation, labels, help text), and is exported from `packages/config`.
- Server access goes through `const cfg = await settingsService.resolve(ctx, ["billing.paymentTerms", "tax.rates"], { locationId, slipTypeId, customerId, asOf })`. The result is typed from the zod schema, and **raw JSON access is not allowed** (enforce with a lint rule that bans `invoiceTemplateJson` reads).
- Caching: request-scoped memoisation plus Redis with a per-tenant **version counter**. Any write bumps the counter and publishes invalidation over Redis pub/sub.

#### C.1.3 Data model

```prisma
model SettingValue {
  id          String   @id @default(uuid())
  tenantId    String
  key         String                     // "billing.paymentTerms"
  scopeType   SettingScope               // TENANT | LOCATION | SLIP_TYPE | PRODUCT | CONTRACT_TYPE | SEGMENT | CUSTOMER
  scopeId     String?                    // null for TENANT
  valueJson   Json
  locked      Boolean  @default(false)
  effectiveFrom DateTime?
  effectiveTo   DateTime?
  version     Int                        // per (tenant,key,scope) monotonic
  updatedBy   String
  updatedAt   DateTime @updatedAt
  @@unique([tenantId, key, scopeType, scopeId, effectiveFrom])
  @@index([tenantId, key])
}

model SettingChange {                     // append-only audit + rollback source
  id         String   @id @default(uuid())
  tenantId   String
  key        String
  scopeType  SettingScope
  scopeId    String?
  oldValue   Json?
  newValue   Json?
  changeSetId String                      // groups a multi-field save
  reason     String?
  actorId    String
  actorIp    String?
  createdAt  DateTime @default(now())
  @@index([tenantId, createdAt])
}

model FeatureFlag { key String @id; description String; defaultOn Boolean; minTier String? }
model TenantFeature { tenantId String; key String; enabled Boolean; locationId String?; source String /* tier|override|beta */; @@id([tenantId, key, locationId]) }

model CustomFieldDef {
  id String @id @default(uuid()); tenantId String; entity CustomEntity /* CUSTOMER|BOAT|SLIP|CONTRACT|RESERVATION|TRANSIENT|INVOICE|WORK_ORDER */
  key String; label String; type FieldType /* text|number|date|bool|select|multiselect|file|currency|phone|email|url */
  optionsJson Json?; required Boolean @default(false); locationIds String[]; visibleInPortal Boolean @default(false)
  editableByCustomer Boolean @default(false); validationJson Json?; sortOrder Int; archivedAt DateTime?
  @@unique([tenantId, entity, key])
}
// values: `customFieldsJson Json` column on each entity, validated against defs (with GIN index for filtering)

model DocumentTemplate {          // contracts, invoices, statements, receipts, waivers, T&Cs, emails share the merge engine
  id String @id; tenantId String; locationId String?; kind DocKind /* CONTRACT|INVOICE|STATEMENT|RECEIPT|WAIVER|TERMS|QUOTE|COLLECTION_LETTER */
  name String; locale String @default("en-US"); bodyHtml String; cssJson Json?; mergeSchemaVersion Int
  status TemplateStatus /* DRAFT|PUBLISHED|ARCHIVED */; version Int; publishedAt DateTime?; publishedBy String?
  appliesToJson Json? // slipTypes, contractTypes, products
}
model SignedDocument { id String @id; templateId String; templateVersion Int; renderedPdfUrl String; sha256 String; signerIds String[]; signedAt DateTime?; ... }

model DocumentRequirement {        // e.g. "Annual slip > 40ft requires COI with $500k liability + registration"
  id String @id; tenantId String; locationId String?; appliesToJson Json /* slipTypes, contractTypes, products, segments */
  docType String /* INSURANCE_COI|REGISTRATION|DL|WAIVER|W9|CUSTOM */; minCoverageCents Int?; additionalInsuredRequired Boolean @default(false)
  blocking BlockPoint /* AT_BOOKING|AT_CHECKIN|AT_CONTRACT_SIGN|AT_RENEWAL|NONE */; reminderRuleId String?
}

model WorkflowDef {                // approval steps
  id String @id; tenantId String; trigger String /* contract.create, renewal.batch, refund.issue, writeoff, discount.override, rate.change */
  conditionsJson Json /* e.g. amountCents > 50000, discountPct > 10 */; stepsJson Json /* [{approverRole|userIds, quorum, slaHours}] */; active Boolean
}
model WorkflowInstance { id String @id; defId String; subjectType String; subjectId String; state String; stepIndex Int; historyJson Json }
```

**Schema prerequisites (blocking):**
- Add `locationId` (required) to `Slip`, `Dock` (new model), `SlipContract`, `Invoice`, `Payment`, `PosTransaction`, `Product`/`Inventory`, `TransientBooking`, `Reservation` and `FuelTank` (new, replacing the fuel.ts in-memory array).
- Add `SlipType` as a model, not a free string.
- Add `CustomerSegment`, `ContractType` and `RatePlan` models.
- Add `TaxRate` (jurisdiction, category, rate as a decimal, `effectiveFrom`) and `TaxCategory`.
- Add a `NumberSequence` model (`tenantId`, `locationId?`, `kind`, `prefixPattern`, `next`), incremented with `UPDATE … RETURNING` for gapless invoice numbers.

#### C.1.4 Versioning, audit, safety

- Every save creates a `changeSetId`, writes `SettingChange` rows, and emits the event `settings.changed` (staff notification optional).
- History UI: per key, "who changed what, when, why", with diff and **revert to version N**.
- **Draft → Publish** for high-impact groups (tax, fees, payment terms, templates), with an optional approval workflow (`WorkflowDef trigger=settings.publish`).
- **Preview:** "Show me the effect on the next invoice for customer X" calls the resolver with candidate values in dry-run.
- Settings export and import as JSON per tenant, to clone a new location from an existing one (a key multi-marina onboarding feature) and to provide portfolio "templates".
- Settings with `sensitive: true` (API keys, bank details) live in a separate encrypted store and are never returned in full.

#### C.1.5 Feature flags and modules

Effective feature = `PlatformFlag.defaultOn` AND `tier entitlement` AND `TenantFeature(tenant)` AND `TenantFeature(location)`.
- The server enforces it with `requireFeature("rentals")` middleware. The web app reads `/api/me/features` instead of localStorage. Disabled modules hide nav items and reject API calls with `403 FEATURE_DISABLED`.
- Initial modules: dockage, transient, rentals (boat club), storage (dry stack / yard), ramp, fuel, POS, concierge, service / work orders, dock walks, insurance AI, dynamic pricing, QBO, portal, widgets, BI API, SMS, white-label.

#### C.1.6 Settings UI information architecture

The settings screen has a left navigation of groups. A **scope switcher** in the header (Organisation | Location ▾ | Slip type ▾ | Segment ▾) shows inherited values in grey with an "Inherited from Organisation" badge, plus an "Override here" action and a "Reset to inherited" action. Search covers all settings by label and keyword. Each page shows "Last changed by … on … · History".

1. Organisation & Locations
2. Branding
3. Slips & Dockage
4. Transient
5. Contracts & Renewals
6. Rentals
7. Billing & Invoicing
8. Taxes
9. Payments
10. Fees & Penalties
11. Fuel
12. POS
13. Notifications
14. Customer Portal
15. Integrations
16. Users & Permissions
17. Data & Privacy

#### C.1.7 Setting catalog (about 210 rows; some rows group closely related keys)

Sources: patterns visible in public help documentation are cited where verified. Campspot's Properties → General and Messaging pages, Contact Preferences (reply-to, BCC) and email tags are documented publicly. Cloudbeds documents Email settings tabs (Templates, Scheduling, Delivery Log, Guest Opt-in), event-triggered automated messages with filters and staff recipients, and "Smart Policies" that tie cancellation and prepayment rules to rate plans in property local time. Dockwa documents that cancellation policies are set per marina and requires that boaters not be charged more for booking through Dockwa. Molo is described as automating renewal, confirmation and invoice emails. DockMaster is described as billing by boat length, flat rate or parts and labour, with service estimates and work orders. FareHarbor (from third-party sources) shows automated confirmations and reminders, and waivers handled largely through integrations. Marina Master entries reflect common marina ERP practice and were not verified against its documentation.

Scope legend: P = platform, T = tenant, L = location, ST = slip type, PR = product, CT = contract type, SG = customer segment, C = customer.

**1. Organisation & Locations**
| Key | Type | Scopes | Default |
|---|---|---|---|
| org.legalName / dbaName | text | T, L | — |
| org.taxId (EIN) | text | T, L (legal entity per location) | — |
| org.address, phone, email, website | contact | T, L | — |
| org.timezone | IANA | T, L | from address |
| org.locale | BCP-47 | T, L, user | en-US |
| org.currency | ISO-4217 | T | USD |
| org.units.length | ft/m | T, L | ft |
| org.units.volume | gal/L | T, L | gal |
| org.units.temperature | F/C | T | F |
| org.dateFormat / timeFormat | enum | T, user | MMM d, yyyy / 12h |
| org.fiscalYearEnd | MM-DD | T | 12-31 |
| org.weekStart | enum | T | Sunday |
| loc.hours.regular | weekly schedule | L | 08:00-17:00 |
| loc.hours.seasonal | dated schedules | L | — |
| loc.holidays | date list | L | US federal |
| loc.season.definitions | named date ranges (Summer, Winter, Shoulder) | L | — |
| loc.geo (lat/lng), NOAA station, VHF channel | data | L | — |
| loc.departments / GL classes | list | L | — |

**2. Branding**
| Key | Type | Scopes | Default |
|---|---|---|---|
| brand.logo / logoDark / favicon / emailHeaderImage | asset | T, L | — |
| brand.colors.primary / secondary / accent | hex | T, L | Helm palette |
| brand.font | enum | T | system |
| brand.portalSubdomain / customDomain (with DNS verification) | domain | T, L | {sub}.gethelm.com |
| brand.emailSender.displayName / fromAddress / replyTo / bcc | identity | T, L | Marina name / mail.gethelm.com |
| brand.emailFooter.address (CAN-SPAM) | text | L | location address |
| brand.socialLinks | urls | T, L | — |
| brand.whiteLabel (hide "Powered by Helm") | bool | T (tier) | false |
| brand.reviewUrls (Google, Yelp, TripAdvisor) | urls | L | — |

**3. Slips & Dockage**
| Key | Type | Scopes | Default |
|---|---|---|---|
| dock.slipTypes | catalogue (slip, mooring, T-head, side-tie, lift, dry-stack, trailer, rack) | L | slip |
| dock.pricingBasis | per-foot LOA / per-foot max(LOA, slip length) / flat / per-sq-ft (LOA × beam) | ST | per-foot LOA |
| dock.lengthRounding | up to whole ft / 0.5 / none | L | whole ft up |
| dock.minimumBillableLength | ft | ST | slip length × 0.8 |
| dock.rateTables (monthly / seasonal / annual per foot, by season) | table | L, ST, SG | — |
| dock.overhangPolicy (max overhang, surcharge) | rule | ST | 2 ft |
| dock.beamSurcharge / multihullMultiplier | rule | ST | 1.5× catamaran |
| dock.liveaboardAllowed / liveaboardFee | bool / money | L, ST | false |
| dock.liveaboardCap (count) | int | L | — |
| dock.electric.mode (flat / metered / included) | enum | ST, slip | flat |
| dock.electric.flatByAmperage (30A/50A/100A) | table | L | — |
| dock.electric.kwhRate / minimumCharge / demandCharge | money | L | utility |
| dock.electric.meterReadCadence | enum | L | monthly |
| dock.water / cable / wifi / pumpout included or fee | bool / money | ST | included |
| dock.subleasePolicy / ownershipTransfer | rule | L | not allowed |
| dock.slipAssignment.requireApproval | bool | L | true |
| dock.vesselRequirements (max LOA, draft, beam vs slip) enforcement | enum hard/soft | L | soft |
| dock.dockWalk.checklist items | list | L | default list |
| dock.dockWalk.violationTypes / resolutionDays | list | L | 7 days |
| dock.requiredDocuments | DocumentRequirement[] | L, ST, CT | COI + registration |

**4. Transient**
| Key | Type | Scopes | Default |
|---|---|---|---|
| tr.checkInTime / checkOutTime | time | L | 15:00 / 11:00 |
| tr.earlyArrival / lateDeparture fee | money / %-of-night | L | — |
| tr.rate.perFootNightly by season and day of week | table | L, ST | — |
| tr.minNights (global, weekend, holiday, event) | rule | L, ST | 1; 2 on summer weekends |
| tr.maxNightsPerSeason (per vessel) | int | L | — |
| tr.minimumCharge (per night) | money | L | 30 ft equivalent |
| tr.weeklyMonthlyDiscount | % | L | 10% / 20% |
| tr.bookingWindow (advance-open days, cutoff hours) | ints | L | 365 / 2h |
| tr.instantBook vs requestToBook | enum | L, ST | request |
| tr.deposit (first night / % / full) and due-by | rule | L | first night |
| tr.cancellationPolicyId | ref | L, ST, season | 48h full refund |
| tr.weatherPolicy | ref | L | credit |
| tr.overstay.handling (auto-extend at rate × N) | rule | L | 1.0× |
| tr.marketplaceParity (Dockwa etc.) | bool | L | true |
| tr.raftingAllowed / raftingFee | bool / money | L | — |
| tr.arrivalInstructions (text, VHF, gate codes) | rich text | L | — |
| tr.guestRequiredFields | list | L | name, email, phone, LOA, beam, draft |
| tr.autoAssignSlip | bool | L | false |

**5. Contracts & Renewals**
| Key | Type | Scopes | Default |
|---|---|---|---|
| ct.contractTypes (annual, seasonal, monthly, winter, storage) | catalogue | L | annual, seasonal, monthly |
| ct.termLength / termAlignment (calendar or season or anniversary) | rule | CT | 12 months anniversary |
| ct.billingCycles allowed | list | CT | monthly, quarterly, annual |
| ct.payInFullDiscount | % | CT | 5% |
| ct.templateId (DocumentTemplate) | ref | CT, L | starter |
| ct.mergeFields | registry | P | — |
| ct.signatureProvider (built-in / DocuSign / Dropbox Sign) | enum | T | built-in |
| ct.signingLinkExpiryDays | int | T | 7 |
| ct.cosignerRequired (LLC-owned vessels) | rule | CT | false |
| ct.securityDeposit (amount / months / waive for segments) | rule | CT, SG | 1 month |
| ct.earlyTermination (fee / months remaining / % ) | rule | CT | 2 months |
| ct.renewal.mode (auto / offer-accept / manual) | enum | CT | offer-accept |
| ct.renewal.noticeDays | int | CT | 60 |
| ct.renewal.responseDeadlineDays | int | CT | 30 |
| ct.renewal.defaultIncrease (% / per-ft / CPI) | rule | L, ST | 0% |
| ct.renewal.batchApprovalRequired | bool | T | true |
| ct.renewal.rightOfFirstRefusal / priorityRules | rule | L | true |
| ct.waitlist.priority (date joined / deposit paid / member status) | rule | L | date joined |
| ct.waitlist.deposit / refundable | money / bool | L | $0 |
| ct.waitlist.offerHoldHours | int | L, ST | 48 |
| ct.waitlist.maxDeclinesBeforeRemoval | int | L | 2 |
| ct.approvals (WorkflowDef for new contract, rate override) | ref | T | none |

**6. Rentals (boat rental / boat club)**
| Key | Type | Scopes | Default |
|---|---|---|---|
| rn.durations offered (hourly, half-day, full-day, multi-day) | list | PR | half, full |
| rn.timeSlots / bufferBetweenRentals / turnaroundMinutes | schedule | PR, L | 30 min |
| rn.operatingHours / sunset cutoff | schedule | PR | loc hours |
| rn.minRenterAge / licence or boater-education requirement by state | rule | PR, L | 18 / state rule |
| rn.deposit (amount, hold vs charge, release after N hours) | rule | PR | hold |
| rn.damageWaiver (optional / required, price) | rule | PR | optional |
| rn.fuelPolicy (full-to-full / charge per gallon used / included) | rule | PR | charge used |
| rn.lateReturnFee (per 15 min) | money | PR | — |
| rn.cancellationPolicyId / weatherPolicyId | ref | PR | — |
| rn.waiverTemplateId and signer per passenger | ref | PR | starter |
| rn.checkinInstructions / whatToBring | rich text | PR, L | — |
| rn.capacity (passengers) | int | PR | — |
| rn.dynamicPricing (enabled, floor, ceiling, strategy aggressiveness) | rule | PR | off |
| rn.boatClub.membershipTiers, booking credits, reservation limits (max active, weekend caps) | rule | L | — |
| rn.abandonedCart.enabled and timings | rule | L | on: 1h / 24h |

**7. Billing & Invoicing**
| Key | Type | Scopes | Default |
|---|---|---|---|
| bill.paymentTerms | union (net / day-of-month / receipt) | T, L, CT, C | net 30 |
| bill.invoiceNumber pattern + sequence | pattern | T, L | INV-{YYYY}-{00000} |
| bill.invoiceTemplateId / statementTemplateId / receiptTemplateId | ref | T, L | starter |
| bill.runDay / runTime (location timezone) | rule | L | 1st 06:00 |
| bill.invoiceInAdvanceDays | int | CT | 0 |
| bill.proration (actual days / 30-day / none / half-month) | enum | CT | actual |
| bill.consolidateInvoices (one per customer per run) | bool | T | true |
| bill.statementCadence | enum | T | monthly |
| bill.minimumInvoiceAmount | money | T | $0 |
| bill.roundingRule | enum | T | half-up |
| bill.creditApplication (auto oldest first) | enum | T | auto |
| bill.houseAccounts (charge-to-slip limit) | money | L, SG | $500 |
| bill.footerText / paymentInstructions / remitTo | text | T, L | — |
| bill.attachPdfToEmail | bool | T | true |
| bill.dunning (sequence of reminders) | NotificationRule refs | T, SG | 0/7/14/30 |
| bill.collections (hand-off after N days, block services) | rule | T | 90 days |
| bill.serviceBlocks on past due (fuel, POS charge, launch, gate access) | list | L | charge-to-slip blocked |
| bill.writeOffApproval | WorkflowDef | T | manager |

**8. Taxes**
| Key | Type | Scopes | Default |
|---|---|---|---|
| tax.provider (manual / Avalara / Stripe Tax) | enum | T | manual |
| tax.rates (jurisdiction × category × effective dates) | table | L | none (blocks invoicing until set) |
| tax.categories (dockage long-term, transient lodging, electricity, fuel, retail, labour, rental, storage) | catalogue | P + T | P list |
| tax.longTermExemptionDays (e.g. FL exempts dockage over 6 months from transient-rental tax) | int | L | — |
| tax.inclusivePricing | bool | L, PR | false |
| tax.compounding (tax on tax / county surtax caps) | rule | L | none |
| tax.exemptions (certificate types, expiry reminders) | rule | T | — |
| tax.fuelTaxIncluded in pump price | bool | L | true |
| tax.roundingLevel (line / invoice) | enum | T | line |

**9. Payments**
| Key | Type | Scopes | Default |
|---|---|---|---|
| pay.methodsAccepted per channel (POS, portal, widget, back office) | matrix | L | card, ACH |
| pay.autopay.enrolmentRequired (mandate text version) | rule | T | required |
| pay.autopay.retrySchedule (days) | list | T | 3, 5, 7 |
| pay.cardSurcharge / convenience fee (state-law aware) | % / money | L | off |
| pay.achDiscount | % | T | — |
| pay.partialPaymentsAllowed | bool | T | true |
| pay.overpaymentHandling (credit / refund) | enum | T | credit |
| pay.refundApproval threshold | WorkflowDef | T | > $500 |
| pay.storedCardRequired for transient / rental | bool | L, PR | true |
| pay.preAuthHoldAmount | money | PR | deposit |
| pay.terminal (Stripe Terminal readers per location) | config | L | — |
| pay.tipping (POS, concierge) and tip presets | list | L | 15/18/20 |

**10. Fees & Penalties**
| Key | Type | Scopes | Default |
|---|---|---|---|
| fee.late.type (% per month / flat / greater-of) | rule | T, L, CT | off |
| fee.late.amount, graceDays, cap, compounding | rule | T, L, CT | 1.5%, 10, —, no |
| fee.nsf / achReturn | money | T | $25 |
| fee.chargebackFee | money | T | $15 |
| fee.lateCheckout / overstay | rule | L | — |
| fee.cancellationAdmin | money | L | — |
| fee.waitlistApplication | money | L | — |
| fee.cleaning / pumpout / haulout / launch & retrieve / winterisation | catalogue | L | — |
| fee.serviceCatalog (GL mapping) | catalogue | L | — |
| fee.violationFines (by dock-walk violation type) | table | L | — |
| fee.platformApplicationFee | % | P × tier | from SaasTier |

**11. Fuel**
| Key | Type | Scopes | Default |
|---|---|---|---|
| fuel.tanks (type, capacity, sensor id) | catalogue | L | — |
| fuel.price per type, effective dated | money | L | — |
| fuel.pricingTiers (member / slip-holder / volume discounts) | table | L, SG | — |
| fuel.lowLevelThreshold % and reorder point | % | tank | 20% |
| fuel.unit (gal / L) | enum | L | gal |
| fuel.ethanolFree labelling | bool | tank | — |
| fuel.requireReceiptSignature over amount | money | L | — |
| fuel.dockHours | schedule | L | loc hours |
| fuel.reconciliation variance tolerance | % | L | 0.5% |

**12. POS**
| Key | Type | Scopes | Default |
|---|---|---|---|
| pos.registers / drawers | catalogue | L | — |
| pos.taxClassDefault | ref | L | general |
| pos.discountOverrideApproval % | WorkflowDef | L | > 10% |
| pos.chargeToSlipAllowed segments | list | L | slip-holders |
| pos.receipt (print / email / SMS, footer text, return policy) | config | L | email |
| pos.returnWindowDays | int | L | 30 |
| pos.cashDrawer (open float, blind close) | config | L | — |
| pos.lowStockThreshold default | int | L, product | 5 |
| pos.inventoryCostMethod | FIFO / avg | T | avg |
| pos.barcodeFormat | enum | T | UPC |

**13. Notifications** (detail in C.2)
| Key | Type | Scopes | Default |
|---|---|---|---|
| ntf.rules (per event: enabled, channels, offsets, audience, template) | NotificationRule | T, L, SG | platform defaults |
| ntf.quietHours (start, end, days) | window | L | 21:00-08:00 |
| ntf.quietHours.channelPolicy (defer / allow-urgent) | enum | L | defer |
| ntf.senderIdentities (email domain, SMS messaging service) | ref | T, L | platform |
| ntf.digest (staff: instant / hourly / daily at HH:MM) | enum | user | instant |
| ntf.staffRouting (event → role / user / Slack channel / Teams webhook) | table | L | managers |
| ntf.emergencyBroadcast (who may send, bypass prefs) | rule | T | owner, manager |
| ntf.smsFooter ("Reply STOP to opt out") frequency | enum | T | first message per 30 days + marketing |
| ntf.languageFallback | locale | T | en-US |
| ntf.maxMarketingPerWeek (frequency cap) | int | T | 3 |

**14. Customer Portal**
| Key | Type | Scopes | Default |
|---|---|---|---|
| portal.enabled modules (invoices, pay, autopay, documents, boats, reservations, concierge, announcements, waitlist) | list | L | all |
| portal.selfService (update boat info, request slip change, cancel reservation) | flags | L | view only |
| portal.requiredProfileFields | list | T | — |
| portal.documentUpload types | list | L | COI, registration |
| portal.welcomeMessage / announcementsBanner | rich text | L | — |
| portal.loginMethods (magic link, password, SSO) | list | T | magic link |
| portal.showBalancesBy location | bool | T | true |
| portal.termsTemplateId / privacyUrl | ref | T | — |

**15. Integrations**
| Key | Type | Scopes | Default |
|---|---|---|---|
| int.qbo (company per location / class mapping / sync cadence / item mapping) | config | T, L | nightly |
| int.stripe (connected account per location or per legal entity) | config | T, L | — |
| int.dockwa / marketplace channel sync | config | L | — |
| int.webhooks (endpoints, events, secret) | config | T | — |
| int.apiKeys (scopes, location restriction) | config | T | — |
| int.accessControl (gate / pedestal / RemoteLock codes) | config | L | — |
| int.slack / teams (staff alerts) | config | T, L | — |
| int.calendarFeeds (iCal for staff) | config | L | — |
| int.weather (NOAA / NWS alerts zone) | config | L | auto by geo |

**16. Users & Permissions**
| Key | Type | Scopes | Default |
|---|---|---|---|
| iam.roles (custom roles over permission set) | catalogue | T | 5 built-in |
| iam.userLocationAccess | list | user | all |
| iam.mfaRequired / SSO (SAML / OIDC) | bool | T (tier) | owner MFA |
| iam.sessionTimeout | minutes | T | 720 |
| iam.ipAllowlist | list | T | — |
| iam.approvalLimits per role (refund, discount, write-off) | money | T | — |
| iam.staffNotificationDefaults per role | ref | T | — |

**17. Data & Privacy**
| Key | Type | Scopes | Default |
|---|---|---|---|
| data.retention (DL photos, card images, audit logs, messages) | durations | T | DL 3y after last activity |
| data.piiMasking in UI (DL number, DOB) | bool | T | true |
| data.exportFormats / scheduled export | config | T | CSV |
| data.customerDeletionWorkflow (CCPA / GDPR) | WorkflowDef | T | manual approval |
| data.consentTextVersions (SMS, email, autopay) | versioned text | T | platform |
| data.cookieBanner for widgets | bool | T | auto (EU) |
| data.auditLogRetention | duration | P / T | 7 years |
| data.sandboxMode (tenant test environment) | bool | T | — |

**Cross-cutting features:**
- **Custom fields** on Customer, Boat, Slip, Contract, Reservation, TransientBooking and Invoice, with portal visibility and editability, location scoping, use in filters, reports, merge fields and webhooks.
- **Custom invoice and contract templates:** a sandboxed Handlebars-style engine (with `{{customer.firstName}}`, `{{slip.number}}`, `{{contract.rate|currency}}`, `{{#each lineItems}}`, `{{customFields.insuranceAgent}}`, `{{location.address}}`, `{{date contract.startDate "long"}}`), WYSIWYG blocks plus HTML mode, versioned and published. The merge-field registry is generated from typed context builders, so the editor offers autocomplete and validates references at publish time.
- **Workflows:** configurable approval steps for new contracts, rate overrides, refunds, write-offs, renewal batches, settings publication, and large announcements over N recipients.
- **Per-slip-type document requirements:** `DocumentRequirement` drives checklists on the contract and booking flow, portal upload prompts and reminder notifications.
- **Localisation:** currency per tenant, units per tenant or location, language via ICU message files for UI and templates (`NotificationTemplate.locale`), customer `preferredLocale`, and date and number formatting through `Intl` with the resolved locale and timezone (replacing `format.ts`).

### C.2 Notification platform

#### C.2.1 Architecture

```
 Domain code ──emit(event)──► [Outbox table, same DB txn]
                                  │  (relay: polls/LISTEN, at-least-once)
                                  ▼
                         notifications.events queue
                                  │
                          Rule Engine (per tenant/location)
               resolves NotificationRules → (audience × channel × schedule)
                                  │
         ┌──────── immediate ─────┴───── scheduled/offset ────────┐
         ▼                                                         ▼
   Dispatch planner                                  ScheduledNotification rows
   - preference check                                (sendAt in recipient/location TZ)
   - consent check (ConsentRecord)                   picked by Scheduler sweep (every minute)
   - quiet hours / frequency caps / dedupe
   - digest batching
         │
         ▼
  NotificationDelivery rows (one per recipient×channel) ──► channel queues
        email(Resend) │ sms(Twilio Messaging Service) │ push(Web Push/FCM/APNs) │ in-app │ webhook │ slack/teams
         │
         ▼
  Provider webhooks (Resend/Svix-signed, Twilio X-Twilio-Signature) ──► delivery status, bounces, complaints, STOP
```

**Principles:**
- Domain code **emits events only**. It never sends messages or picks a template.
- Time-based events (reminders N days before) are computed by **sweeps** over database state, not week-long delayed Redis jobs. A sweep survives Redis loss, handles edits (an insurance policy replaced means no stale reminder), and respects timezones.
- Idempotency key per delivery: `hash(tenantId, eventId, ruleId, recipientId, channel, occurrenceKey)`.

#### C.2.2 Event catalog (68 events)

Columns:
- **Default channels:** E = email, S = SMS, P = push, I = in-app, W = webhook, K = Slack/Teams.
- **Category:** `txn` = transactional, `ops` = operational/service, `mkt` = marketing, `staff`.
- **Offsets:** default timing offsets the tenant can configure.

| # | Event key | Audience | Default channels | Cat. | Offsets |
|---|---|---|---|---|---|
| **Reservations / Transient** |||||
| 1 | transient.booking.requested | staff; guest ack | K I / E | staff/txn | — |
| 2 | transient.booking.confirmed | guest | E S W | txn | — |
| 3 | transient.booking.declined | guest | E | txn | — |
| 4 | transient.booking.modified | guest | E | txn | — |
| 5 | transient.booking.cancelled | guest; staff | E / I | txn | — |
| 6 | transient.prearrival | guest | E S | ops | 2d, 1d before check-in |
| 7 | transient.arrival.instructions (gate code, VHF) | guest | S E | ops | morning of arrival |
| 8 | transient.checkin.completed | guest | E | txn | — |
| 9 | transient.checkout.reminder | guest | S | ops | 1h before check-out |
| 10 | transient.overstay.detected | staff; guest | I K / S | staff | +1h after check-out |
| 11 | transient.postdeparture.review | guest | E | mkt | +1d |
| **Rentals / Boat club** |||||
| 12 | rental.cart.abandoned | prospect | E (S if marketing consent) | mkt | 1h, 24h, 72h |
| 13 | rental.booking.confirmed | renter | E S | txn | — |
| 14 | rental.waiver.required | renter + passengers | E S | txn | at booking, 24h before if unsigned |
| 15 | rental.reminder | renter | E S | ops | 24h, 2h before |
| 16 | rental.weather.advisory | renter; staff | S E / K | ops | on NWS alert |
| 17 | rental.weather.cancelled (credit issued) | renter | E S | txn | — |
| 18 | rental.late.return | staff; renter | K I / S | staff | +15 min |
| 19 | rental.returned.receipt (fuel, damage) | renter | E | txn | — |
| 20 | rental.deposit.released | renter | E | txn | — |
| 21 | rental.nps.request | renter | E | mkt | +1d |
| 22 | rental.review.prompt (NPS ≥ 9) | renter | E | mkt | on NPS response |
| **Contracts / Renewals / Waitlist** |||||
| 23 | contract.sent_for_signature | customer | E S | txn | — |
| 24 | contract.signature.reminder | customer | E S | txn | +3d, +6d |
| 25 | contract.signed | customer; staff | E / I | txn | — |
| 26 | contract.expiring | customer; staff | E / I | ops | 90, 60, 30, 7 days |
| 27 | renewal.offer.sent | customer | E | txn | ct.renewal.noticeDays |
| 28 | renewal.offer.reminder | customer | E S | txn | 14d, 3d before deadline |
| 29 | renewal.accepted / declined | staff | I K | staff | — |
| 30 | renewal.batch.pending_approval | approvers | I E | staff | — |
| 31 | waitlist.joined | applicant | E | txn | — |
| 32 | waitlist.offer | applicant | E S | txn | — |
| 33 | waitlist.offer.expiring | applicant | S | txn | 12h before hold expiry |
| 34 | waitlist.offer.expired / position.update | applicant | E | txn | annual position letter |
| **Billing / Payments** |||||
| 35 | invoice.issued | customer | E W | txn | — |
| 36 | invoice.upcoming_autopay | customer | E | txn | 3d before charge |
| 37 | invoice.due_soon | customer | E | txn | 3d before due |
| 38 | invoice.past_due | customer | E S | txn | 1, 7, 14, 30 days after due |
| 39 | invoice.late_fee.assessed | customer | E | txn | — |
| 40 | statement.monthly | customer | E | txn | 1st of month |
| 41 | payment.succeeded (receipt) | customer | E W | txn | — |
| 42 | payment.failed | customer; staff | E S / I | txn | immediate + retry schedule |
| 43 | payment.method.expiring | customer | E | txn | 30d before card expiry |
| 44 | ach.returned | customer; staff | E / I K | txn | — |
| 45 | chargeback.opened / evidence_due | staff | I K E | staff | due -3d |
| 46 | refund.issued | customer | E | txn | — |
| 47 | collections.escalated | customer; staff | E (letter) / I | txn | per policy |
| 48 | autopay.enrolled / cancelled | customer | E | txn | — |
| **Compliance / documents** |||||
| 49 | insurance.expiring | customer; staff | E S / I | ops | 60, 30, 7, 0 days |
| 50 | insurance.expired | customer; staff | E / I K | ops | +1d, weekly |
| 51 | insurance.uploaded.pending_review | staff | I | staff | — |
| 52 | insurance.rejected (coverage below requirement) | customer | E | ops | — |
| 53 | registration.expiring | customer | E | ops | 30d |
| 54 | document.required.missing | customer | E | ops | at contract creation, +7d |
| 55 | taxexempt.certificate.expiring | customer; accounting | E / I | ops | 30d |
| **Operations / Maintenance / Alerts** |||||
| 56 | weather.alert (NWS small craft / gale / hurricane watch) | slip holders at location; staff | S E P / K | ops (emergency) | on alert |
| 57 | marina.emergency.broadcast | all at location | S E P | emergency (bypasses marketing prefs, not STOP) | — |
| 58 | dockwalk.violation.logged | customer | E | ops | — |
| 59 | dockwalk.violation.unresolved | customer; staff | E / I | ops | at resolution deadline |
| 60 | maintenance.workorder.status (estimate, approved, complete) | customer | E S | txn | — |
| 61 | maintenance.scheduled (dock closure, power outage) | affected slips | E S | ops | 7d, 1d |
| 62 | concierge.request.created / updated | staff / customer | I K / E S | ops | — |
| 63 | meter.reading.anomaly (spike > X%) | staff | I | staff | — |
| **Staff / system alerts** |||||
| 64 | fuel.tank.low | fuel managers | I K S | staff | at threshold |
| 65 | inventory.low_stock | POS managers | I (digest) | staff | daily digest |
| 66 | qbo.sync.failed / token.expiring | accounting | I E K | staff | immediate; token 7d before |
| 67 | billing.run.completed (summary, failures) | accounting, managers | I E | staff | after run |
| 68 | lead.created / form.submitted | sales staff | I K E | staff | — |

Platform-level (tenant owner) events also exist: `saas.invoice.past_due` (day 1, 7, 14), `saas.account.locked`, `saas.usage.limit`, `security.new_admin_login`, `apikey.created`, `settings.changed` (high-impact groups) and `export.ready`.

Each event is defined in code with:
- a zod **payload schema** (which doubles as the merge-field schema);
- `category` and `isMarketing`;
- `defaultRules`;
- `allowedChannels`;
- `allowedOffsets`;
- `audienceResolvers` (customer, co-owners, billing contact, passengers, staff role, location subscribers);
- an `entityRef` used to cancel scheduled sends when an entity changes. For example, an invoice paid before the 7-day reminder cancels that reminder.

#### C.2.3 Per-event channel matrix and tenant configuration

For each event, a tenant sees one row per audience with these controls:
- enabled toggle
- channel checkboxes, limited to those the event allows
- timing offsets (multiple; relative to an anchor such as `dueDate`, `startDate`, `expiryDate` or `holdExpiresAt`; send at a fixed local time such as 09:00 location time)
- template per channel and locale
- conditions (segment, slip type, location, amount ≥ X, custom field equals Y)
- audience (primary, billing contact, all owners)
- staff routing

Location overrides follow the same inheritance as settings, so a different location can have a different enabled flag, offsets or template.

#### C.2.4 Template editor

- Channel-aware: email (subject, preheader, HTML blocks plus plain-text auto-generated), SMS (segment counter, GSM-7 vs UCS-2 warning, link shortening with tracked domain, required opt-out footer injected for marketing), push (title and body, deep link), in-app (title, body, action), Slack (Block Kit).
- **Merge fields** come from the event schema plus global context: `{{marina.name}}`, `{{location.*}}`, `{{customer.*}}`, `{{customFields.*}}`, `{{links.portal}}`, `{{links.pay}}`, `{{links.unsubscribe}}`. Filters include `currency`, `date`, `datetime` (TZ-aware), `units` and `pluralize`. Logic-less Handlebars with auto-escaping (this fixes the current HTML injection) is rendered in a sandbox.
- **Branding:** the shared layout pulls logo, colours, footer address and social links from the resolved Branding settings for the location.
- **Versioning:** draft, test send to self, publish. Every delivery records `templateId` and `version`. Admins can roll back.
- Platform default templates ship for every event, with English and Spanish first. Tenant overrides are copy-on-write. When a platform default changes, the tenant sees a "new version available" diff.
- Preview with sample data, built from `getSampleDataForTrigger` but generated from the schema, or with a real record ("preview for invoice INV-2026-00041").

#### C.2.5 Timing, quiet hours, frequency, digests

- **Timezone:** schedules resolve in the **location timezone**. For SMS, quiet hours use the **recipient's timezone** where known (area code or address), falling back to the location timezone. Defaults are 21:00-08:00 plus state-specific stricter windows (e.g. FL 8am-8pm, with limits on Sundays and holidays). Marketing SMS is always deferred. Transactional SMS defers by default. Events flagged `urgent` (emergency, weather, payment failure where the tenant allows) may bypass the window.
- **Frequency caps:** at most N marketing messages per recipient per week, per tenant. Duplicates are suppressed by `(event, entity, recipient)` within a window.
- **Digest:** staff can receive events instantly, hourly or daily at HH:MM. Low-priority customer operational notices (for example multiple document reminders) can be merged. A `DigestBucket` collects items keyed by `(recipient, digestKey)`, and the scheduler flushes it.

#### C.2.6 Preferences centre and consent ledger

- **Boater-facing preference page** (portal `/preferences`, also reachable from a tokenised link with no login, which RFC 8058 one-click requires):
  - per-category × channel toggles: Billing (transactional; email cannot be disabled but SMS can), Reservations, Compliance reminders, Marina news/announcements, Promotions/marketing, Surveys;
  - "unsubscribe from all marketing";
  - preferred language;
  - preferred phone;
  - quiet-hours preference;
  - per-location subscription for multi-marina customers.
- **Staff preferences:** per event, per channel (in-app, email, SMS, push, Slack DM); digest cadence; on-call schedule; location filter.
- **Consent ledger** (append-only) records consent capture with: source (widget, portal, staff entry, import, keyword), exact disclosure text version, IP, user-agent, timestamp, phone or email, category, and evidence (form id). Revocation is recorded the same way (STOP keyword, unsubscribe link, staff note, bounce or complaint).
  - Staff-entered SMS opt-ins require a "consent obtained via ___" attestation. Imports require a consent-date column; rows without one default to *no marketing consent*.
  - The current preference is a projection of the ledger.
- **Capture points:** lead form, transient, rental and widgets, portal signup and contract signing all get an unchecked SMS consent checkbox with TCPA-compliant disclosure ("Msg & data rates may apply. Msg frequency varies. Reply STOP to cancel, HELP for help. Consent not a condition of purchase") plus links to terms and privacy.
- **Keywords:**
  - STOP, STOPALL, UNSUBSCRIBE, CANCEL, END, QUIT, plus the FCC "any reasonable means" free-text (for example "please stop texting"), detected with a classifier and routed for staff review → channel-level opt-out for that sender (the tenant's messaging service) and a single confirmation reply.
  - START / UNSTOP → re-opt-in.
  - HELP → the tenant's support message (marina name, phone, and "Reply STOP to cancel").
- **10DLC:** onboarding gains a "Register SMS" step. It collects the brand (legal name, EIN, address, website, vertical) and registers a campaign (use case such as "Mixed: account notifications + marketing" with sample messages and opt-in flow description) via Twilio Trust Hub / A2P. The status is tracked in `SmsSenderRegistration`. SMS sending stays disabled until the campaign is approved; email-only works meanwhile. Use a Twilio **Messaging Service** per tenant (optionally per location), not a raw `from` number. Toll-free verification is an alternative for small tenants.

#### C.2.7 Delivery tracking, retries, bounces

- **Resend webhooks** (Svix-signed): `email.sent`, `delivered`, `delivery_delayed`, `bounced`, `complained`, `opened`, `clicked` → `NotificationDelivery.status` plus `DeliveryEvent` rows.
  - A hard bounce or complaint adds the address to `SuppressionEntry` (email, tenant-scoped, and platform-global for complaints).
  - Soft bounces retry with exponential backoff; three consecutive soft bounces suppress the address.
- **Twilio status callbacks** (`queued`, `sent`, `delivered`, `undelivered`, `failed` with error codes) are signature-validated.
  - 21610 (unsubscribed recipient) → record a revocation.
  - 30007 (filtered) → alert the tenant and platform (likely a 10DLC or content issue).
  - 21211 (invalid number) → mark the phone invalid.
- **Retry policy:** provider 5xx or network errors retry (BullMQ `attempts: 5`, exponential backoff starting at 30s). 4xx validation errors fail fast. After the final attempt the delivery is marked `FAILED`, and a staff in-app alert fires if the event is critical (payment, emergency). **Channel fallback** is configurable per rule: if SMS fails or is undeliverable, send email.
- **Observability:** per-tenant dashboard with sent, delivered, bounced, complained, opened and clicked by event, plus a per-customer message timeline on the customer record. This reuses and replaces `AnnouncementDelivery`; announcements become `marina.announcement` events with an ad-hoc template.

#### C.2.8 Outbound webhooks (integrations)

- `WebhookEndpoint` (url, secret, events[], location filter, active, apiVersion).
- Deliveries use an HMAC-SHA256 signature header (`Helm-Signature: t=…,v1=…`), a unique event id, retries with backoff for 24h, automatic disable after N consecutive failures with an owner notification, a replay UI, and a delivery log.
- Payloads are versioned and documented, and generated from the same event schemas. This also serves Zapier/Make connectors.

#### C.2.9 Data model (Prisma)

```prisma
enum NotificationChannel { EMAIL SMS PUSH IN_APP WEBHOOK SLACK TEAMS }
enum DeliveryState { PLANNED SCHEDULED SUPPRESSED QUEUED SENT DELIVERED OPENED CLICKED BOUNCED COMPLAINED FAILED CANCELLED }
enum ConsentAction { GRANT REVOKE }

model OutboxEvent {                        // written in the same txn as the domain change
  id          String   @id @default(uuid())
  tenantId    String
  locationId  String?
  eventKey    String                       // "invoice.issued"
  entityType  String
  entityId    String
  payloadJson Json
  occurredAt  DateTime @default(now())
  publishedAt DateTime?
  @@index([publishedAt, occurredAt])
}

model NotificationEvent {                  // catalog row mirrored from code for UI + FK (platform-level)
  key            String  @id
  category       String                    // txn | ops | mkt | staff | emergency
  isMarketing    Boolean
  allowedChannels NotificationChannel[]
  payloadSchemaVersion Int
}

model NotificationTemplate {
  id          String   @id @default(uuid())
  tenantId    String?                       // null = platform default
  locationId  String?
  eventKey    String
  channel     NotificationChannel
  locale      String   @default("en-US")
  subject     String?
  preheader   String?
  body        String                        // handlebars (html for email; text for sms/push)
  version     Int
  status      String                        // DRAFT | PUBLISHED | ARCHIVED
  parentTemplateId String?                  // platform default it was copied from
  publishedAt DateTime?
  publishedBy String?
  @@index([tenantId, eventKey, channel, locale, status])
}

model NotificationRule {
  id          String   @id @default(uuid())
  tenantId    String
  locationId  String?                        // null = tenant-wide; location row overrides
  eventKey    String
  audience    String                         // customer | billing_contact | all_owners | passengers | role:MARINA_MANAGER | user:<id> | slack:<channelId>
  channels    NotificationChannel[]
  enabled     Boolean  @default(true)
  offsetsJson Json?                          // [{anchor:"dueDate", offsetMinutes:-4320, sendAtLocalTime:"09:00"}]
  conditionsJson Json?
  templateOverridesJson Json?                // {EMAIL: templateId, SMS: templateId}
  fallbackJson Json?                         // {SMS:"EMAIL"}
  urgent      Boolean  @default(false)
  digestKey   String?
  version     Int
  updatedBy   String
  updatedAt   DateTime @updatedAt
  @@index([tenantId, eventKey])
}

model ScheduledNotification {              // materialised future sends, recomputed on entity change
  id          String   @id @default(uuid())
  tenantId    String
  ruleId      String
  eventKey    String
  entityType  String
  entityId    String
  occurrenceKey String                     // e.g. "dueDate-7d"
  sendAt      DateTime                     // UTC computed from location TZ
  status      String                       // PENDING | DISPATCHED | CANCELLED
  @@unique([ruleId, entityId, occurrenceKey])
  @@index([status, sendAt])
}

model NotificationPreference {
  id          String  @id @default(uuid())
  tenantId    String
  subjectType String                       // CUSTOMER | USER
  subjectId   String
  locationId  String?
  category    String                       // billing, reservations, compliance, announcements, marketing, surveys, or eventKey for staff
  channel     NotificationChannel
  enabled     Boolean
  digest      String?                      // instant | hourly | daily@08:00
  quietHoursJson Json?
  updatedAt   DateTime @updatedAt
  @@unique([subjectType, subjectId, locationId, category, channel])
}

model ConsentRecord {                      // append-only ledger
  id          String   @id @default(uuid())
  tenantId    String
  customerId  String?
  channel     NotificationChannel            // EMAIL | SMS
  address     String                          // E.164 phone or email (normalised)
  scope       String                          // transactional | marketing | all
  action      ConsentAction
  source      String                          // widget:rental, portal, staff, import, keyword:STOP, unsubscribe_link, bounce, complaint, carrier
  disclosureTextVersion String?
  evidenceJson Json?                          // ip, userAgent, formId, staffUserId, inbound message sid
  occurredAt  DateTime @default(now())
  @@index([tenantId, address, channel, occurredAt])
}

model SuppressionEntry { id String @id; tenantId String?; channel NotificationChannel; address String; reason String; createdAt DateTime @default(now()); @@unique([tenantId, channel, address]) }

model NotificationDelivery {
  id            String   @id @default(uuid())
  tenantId      String
  locationId    String?
  outboxEventId String?
  eventKey      String
  ruleId        String?
  templateId    String?
  templateVersion Int?
  recipientType String                        // CUSTOMER | USER | ENDPOINT
  recipientId   String?
  channel       NotificationChannel
  address       String
  idempotencyKey String  @unique
  state         DeliveryState
  suppressedReason String?                    // opted_out | no_consent | quiet_hours_deferred | suppressed | frequency_cap | duplicate
  providerMessageId String?
  renderedSubject String?
  renderedBodyRef String?                     // S3 pointer for large bodies (retention-limited)
  attempts      Int      @default(0)
  lastError     String?
  scheduledFor  DateTime?
  sentAt        DateTime?
  deliveredAt   DateTime?
  openedAt      DateTime?
  createdAt     DateTime @default(now())
  @@index([tenantId, createdAt])
  @@index([providerMessageId])
}

model DeliveryEvent { id String @id; deliveryId String; type String; payloadJson Json; occurredAt DateTime; @@index([deliveryId]) }
model InAppNotification { id String @id; tenantId String; userId String?; customerId String?; title String; body String; actionUrl String?; readAt DateTime?; createdAt DateTime @default(now()); @@index([userId, readAt]) }
model PushSubscription { id String @id; subjectType String; subjectId String; endpoint String @unique; keysJson Json; platform String; createdAt DateTime @default(now()) }
model SenderIdentity { id String @id; tenantId String; locationId String?; channel NotificationChannel; emailDomain String?; domainVerified Boolean @default(false); twilioMessagingServiceSid String?; tenDlcCampaignId String?; status String }
model SmsSenderRegistration { id String @id; tenantId String; brandSid String?; campaignSid String?; status String; submittedAt DateTime?; approvedAt DateTime?; rejectionReason String? }
model WebhookEndpoint { id String @id; tenantId String; url String; secretHash String; events String[]; locationIds String[]; active Boolean; failureCount Int @default(0) }
model WebhookDelivery { id String @id; endpointId String; eventId String; status Int?; attempts Int; nextAttemptAt DateTime?; responseSnippet String?; @@index([endpointId]) }
```

`CommunicationPreference` migrates into `NotificationPreference`, and an initial `ConsentRecord` is written with `source=legacy_migration` for email transactional only. **Legacy SMS and marketing preferences are not treated as consent**, because there is no evidence behind them.

#### C.2.10 Queue and scheduler: running reliably

1. **Separate entry points and processes:**
   - `apps/api/src/worker.ts` registers all BullMQ workers.
   - `apps/api/src/scheduler.ts` is a singleton that holds a lock.
   - `package.json` scripts: `start:worker`, `start:scheduler`.
   - Dockerfile `CMD` stays the API. Compose and Kubernetes run `node dist/worker.js` (horizontally scalable) and `node dist/scheduler.js` (1 replica, with a Redis Redlock or Postgres advisory lock for leader election, so a second replica is a hot standby).
   - Fix `docker-compose.yml:89`.
2. **Recurring jobs:** use BullMQ **Job Schedulers** (`queue.upsertJobScheduler(id, {pattern, tz}, template)`), which are idempotent on every boot, instead of `add(..., {repeat})` called from nowhere.
   - Platform jobs: tenant lifecycle (daily), outbox relay safety sweep (every 1 min), scheduled-notification dispatcher (every 1 min), digest flusher (every 5 min), webhook retry sweeper, Resend/Twilio reconciliation (hourly; fetches statuses for deliveries stuck in `SENT` for more than 24h).
   - Tenant-local jobs, fanned out per location in its timezone: billing run, late-fee assessment, auto-renew and renewal notices, insurance and document expiry materialisation, dynamic pricing. Implementation: one cron every 15 minutes enumerates locations whose local time matches the configured run time and enqueues `jobId = "${kind}:${locationId}:${localDate}"`, so runs are idempotent and missed runs are caught up.
3. **Transactional outbox:** domain writes and `OutboxEvent` insert happen in one Prisma transaction. A relay publishes to the `notifications.events` queue and marks `publishedAt`. This guarantees no lost events and no sends for rolled-back transactions.
4. **Materialise, don't delay:** offsets create `ScheduledNotification` rows, recomputed on entity change (an `entityRef` hook). For example, when `invoice.paid` fires, pending `invoice.past_due` rows are cancelled. The dispatcher polls `WHERE status='PENDING' AND sendAt <= now() FOR UPDATE SKIP LOCKED LIMIT 500`. Long `delay` jobs in Redis are avoided entirely.
5. **Idempotent sends:** `NotificationDelivery.idempotencyKey` is unique. Provider idempotency keys are used where supported (Resend `Idempotency-Key` header). Channel workers re-check the delivery state before calling the provider.
6. **Retries and DLQ:** `sendEmail`/`sendSms` must **throw** on retryable errors (today they return `null`, so BullMQ thinks the job succeeded). Each queue sets `attempts`, exponential backoff, `removeOnComplete` (by age) and `removeOnFail` (keep 7d). A failed-job dashboard (BullMQ Board behind platform-admin auth, extending admin.ts:43 queue introspection) supports manual retry.
7. **Rate limiting:** BullMQ group or worker limiter per provider (Resend account limits; Twilio MPS per 10DLC campaign tier), plus fair-share per tenant so one tenant's 5,000-recipient announcement doesn't starve another tenant's receipts. Priority lanes: `urgent` > `txn` > `ops` > `mkt`.
8. **Redis durability:** AOF enabled (`appendonly yes`), `maxmemory-policy noeviction` (required by BullMQ), managed Redis with persistence. Postgres stays the source of truth (outbox, scheduled rows and deliveries), so a Redis loss is recoverable by re-relaying unpublished outbox rows and re-dispatching `QUEUED` deliveries.
9. **Health and alerting:** worker heartbeat key and scheduler lease checked by `/api/health/workers`. Alerts fire on queue depth, oldest waiting job age above 5 min, failed rate, outbox lag above 2 min and dispatcher lag. Sentry is already a dependency; wire it into workers.
10. **Graceful shutdown:** keep the existing SIGTERM handling, use `worker.close()` with a drain timeout, and set the Kubernetes `terminationGracePeriodSeconds` to at least the longest job.
11. **Testing:** contract tests that every producer's payload validates against the event zod schema (this would have caught every B.2 mismatch). Integration test spins Redis and Postgres, emits an event and asserts a `NotificationDelivery` row and a mocked provider call. Time-travel tests for timezone offsets and DST.

#### C.2.11 Build sequence (suggested)

1. **Stop-the-bleeding, about 1 week:**
   - worker and scheduler entry points;
   - fix payload contracts for invoice, receipt and ACH emails;
   - escape template variables;
   - add the footer (address + unsubscribe link);
   - turn off SMS until 10DLC is in place;
   - mount or remove the dead `email-automation` route;
   - correct the Settings UI or label it "coming soon".
2. **Settings service + location scoping migrations + tax table + number sequences, about 3-4 weeks.**
3. **Notification core** (outbox, rules, templates, deliveries, Resend webhooks, preference centre, consent ledger), about 4-5 weeks.
4. **SMS** (10DLC onboarding, Messaging Services, inbound keywords, quiet hours), about 2-3 weeks.
5. **Template editor UI, staff alerts (Slack/Teams), push / in-app, outbound webhooks, digests, workflows, custom fields, document templates**, ongoing.

---

## Sources (competitor research)

- Campspot, Properties > General: https://support.campspot.com/campground-setup-properties-general
- Campspot, Messaging: https://support.campspot.com/messaging
- Campspot, Policies setup: https://support.campspot.com/policies-setup
- Cloudbeds, Smart Policies: https://myfrontdesk.cloudbeds.com/hc/en-us/articles/43772769251611-Cloudbeds-Smart-Policies-Everything-You-Need-to-Know
- Cloudbeds, Guest Experience Automated Messages: https://myfrontdesk.cloudbeds.com/hc/en-us/articles/8699946508187
- Cloudbeds, Email settings: https://myfrontdesk.cloudbeds.com/hc/en-us/articles/218511467
- Dockwa, marina pricing page: https://marinas.dockwa.com/pricing
- Dockwa, boater help (cancellation policies are marina-specific): https://mayday.dockwa.com/en/articles/8602455-how-to-submit-a-reservation-request-on-dockwa
- Falmouth Harbormaster (example marina minimum-night rules): https://www.usharbors.com/business/falmouth-mass-harbormaster/
- Molo, Software Advice profile: https://www.softwareadvice.com/marine/molo-profile
- Molo, solutions: https://getmolo.com/solutions/
- DockMaster, solutions: https://dockmaster.com/solutions
- DockMaster, Capterra: https://capterra.com/p/92549/DockMaster/
- FareHarbor (third-party): https://www.getapp.com/customer-management-software/a/fareharbor/reviews/
- OtterSign FareHarbor integration: https://ottersign.com/integration/fareharbor/
- Podium FareHarbor integration: https://podium.com/marketplace/fareharbor

Marina Master was not verified against public documentation. Dockwa's marina-side settings and FareHarbor's native settings documentation were not reachable through search, so the catalogue relies on general industry practice for those products.
