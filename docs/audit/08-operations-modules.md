# 08 — Operations Modules Audit (POS, Fuel, Inventory, Ramp/Dry Stack, Concierge, Dock Walks, Insurance/AI, Comms, Reports/BI, Onboarding/Admin, Help, Seed)

*Audited 2026-10-26 against commit `ae2e111`. No source files were changed. To type-check, I generated the Prisma client into `node_modules` and ran `tsc --noEmit` on `apps/api`: 669 error lines, about 200 of them in files this audit covers. I also ran the existing vitest route tests for these modules: 20 of 37 fail.*

*Out of scope here, covered by other audits: money/invoicing/payments, QuickBooks, rentals/dynamic pricing, slips/contracts/transient/waitlist/leads/portal, frontend design, and platform security. When a platform-level defect breaks one of my modules, I name it once in §0 and refer back to it.*

Severity: **P0** blocks launch · **P1** must fix soon after launch, or before launch if the module ships · **P2** later.
Effort: **S** ≤1 day · **M** 2–5 days · **L** more than 1 week.

---

## 1. Module scorecard

| # | Module | Maturity | v1 scope | Top issue |
|---|---|---|---|---|
| 1 | **POS** (pos.ts, POS.tsx, scanners, stripe-terminal, Shift) | **Prototype**. The API is about half real. The UI is 100% mock. | **IN, narrowed:** charge-to-slip-account, cash, and "external card terminal" tender, plus an end-of-day Z report. Integrated Stripe Terminal moves to v1.1. | The UI never saves a sale and shows "Payment Complete" for a card that was never charged (POS.tsx:233, :314). The API trusts client prices, taxes everything at a hardcoded 7%, and drops `customerId`, so charge-to-account is impossible. |
| 2 | **Fuel dock** (fuel.ts, Fuel.tsx, PumpOut) | **Stub**. Data lives in process memory and is shared across all tenants. | **IN only as POS fuel products** (decimal gallons, fuel tax). Separate tank, delivery and pump modules are OUT. | fuel.ts:49-82 keeps prices, tank levels and sales in module-level arrays. One marina's price change applies to every marina, and everything is lost on restart. |
| 3 | **Inventory & purchasing** (inventory.ts, Inventory.tsx, barcode lib) | **Stub**. In-memory, and it is a second product catalog separate from POS. | **OUT.** Keep only QOH on `Product` through POS. | inventory.ts:180-183 holds products, POs and counts in RAM. They never touch the Prisma `Product`/`Inventory`/`PurchaseOrder` tables POS uses. |
| 4 | **Dry stack / launch ramp** (ramp.ts, Ramp.tsx, RampTicket) | **Stub**. Every API call hangs. There is no dry stack at all. | **OUT.** Remove "dry stack" from marketing until it is built. | ramp.ts:54,102,136,155,214 pass `clerkAuth` uninvoked, so every request hangs until timeout. Card payments are routed to a Stripe account ID taken from the request body (ramp.ts:22,178-186). |
| 5 | **Concierge** (concierge.ts, Concierge.tsx) | **Prototype**. API hangs. UI is mock. Nothing gets billed. | **OUT.** Fold into the future Work Orders module. | Same uninvoked `clerkAuth` hang (concierge.ts:87…346). `ConciergeVendor` is not tenant-scoped, so vendor lists and updates leak across tenants. "Complete" is a TODO with no billing (concierge.ts:289). |
| 6 | **Dock walks + offline** (dock-walks.ts, DockWalks.tsx, offline-store, sync-manager, sw.js) | **Prototype**. Walk header CRUD works. Item endpoints crash. The UI cannot record per-slip checks. Offline is not wired. | **IN, online-first** (mobile web, photos, violation → notice/fee). Offline sync is OUT of v1 and should not be marketed. | Every `prisma.dockWalkItem.*` call crashes because the tenant extension injects `tenantId` into a model that has no such column (prisma.ts:28). `sw.js` is never registered. The sync endpoints don't exist. |
| 7 | **Insurance & AI** (insurance.ts, insurance-ai.ts, ocr.ts) | **Prototype**. The extraction core is reasonable. There is no UI, no file intake, and reminders never send. | **IN, narrowed.** This is a true differentiator: PDF upload → Claude extraction → staff review → expiry tracking. | Upload requires the client to send `documentText` (insurance.ts:15-20). The OCR service is unused. The review and compliance endpoints are unreachable because of lowercase role checks. Expiry reminders use a job type the worker drops. |
| 8 | **Announcements, email automation, SMS** | **Prototype**. Nothing is ever delivered. It is non-compliant with TCPA and CAN-SPAM. | **IN: email announcements only**, with unsubscribe, preference checks and a physical address. SMS is OUT until 10DLC, consent capture and STOP handling exist. Automation rules engine is OUT. | Queue payloads don't match the worker's contract (announcements.ts:404-422 vs workers/index.ts:23,73). The worker process has no start script. Recipients are never filtered by opt-out. There is no STOP or unsubscribe handling anywhere in the codebase. |
| 9 | **Reports & BI** (reports.ts, bi-api.ts, Reports.tsx, ReportViewer, Portfolio, RentRoll, Dashboard) | **Prototype**. About 40 endpoints, at least 8 of which crash. Every report UI is hardcoded. | **IN: 8 real reports with CSV export.** BI API, Portfolio dashboard and scheduled reports are OUT. | The whole `/api/reports` router returns 403 to every real user (reports.ts:8). The BI API returns the *hostname's* tenant data for any valid API key (bi-api.ts:67 with prisma.ts:94-105). |
| 10 | **Onboarding, tenants, settings, admin, tenant lifecycle** | **Broken / Prototype.** Onboarding crashes and is unauthenticated. The admin app has no auth and shows mock data. | **IN (required), rebuilt** as sales-assisted provisioning from a secured admin app. Self-serve signup is OUT. | `/api/onboarding/*` has no auth. Anyone can rewrite any tenant's branding or bind an attacker's Stripe account through `state=tenantId` (onboarding.ts:110-203). The lifecycle job would lock every marina that has one past-due *boater* invoice (tenant-lifecycle.ts:49-124). |
| 11 | **Help center** (HelpCenter.tsx, help-articles.ts) | **Stub**. | **IN, minimal.** Make content accurate and route tickets to a real inbox. | "Submit Ticket" sends nothing but tells the user "We've received your ticket" (HelpCenter.tsx:167). Articles describe features that don't exist (Stripe Terminal, CSV import, autopay). |
| 12 | **Seed data** (prisma/seed/*) | **Needs work.** | **IN** as a demo-tenant seed only. Never run it in production. | Destructive `deleteMany` with no tenant filter (seed/tenant.ts:4-5). Dates are frozen in March 2026. Seeded POS data uses status values the API never writes. No seed data exists for ramp, concierge, insurance, fuel or preferences. |

**Bottom line:** none of these modules works end to end today, and every staff page in scope renders hardcoded mock data. A focused v1 should ship **POS-lite (with fuel as products), Dock Walks (online), Insurance COI tracking, Email Announcements, about 8 core reports, and secure sales-assisted onboarding**. Inventory/PO, ramp/dry stack, concierge, fuel tank management, SMS, the automation builder, the BI API and the portfolio dashboard should all be hidden behind tenant-level feature flags and kept out of v1.

---

## 0. Cross-cutting defects that break every module in this audit

These are listed first because they explain why "nothing works" before any module-level bug matters. Several sit in platform code. They are listed once here with module impact, and the platform-security audit owns the deeper fix.

| ID | File:line | Issue | Failure scenario | Fix | Sev | Effort |
|---|---|---|---|---|---|---|
| X1 | apps/web/src/lib/api.ts:1 + every `useApi('…','/api/…')` (e.g. POS.tsx:303, Fuel.tsx:260, Dashboard.tsx:44, RentRoll.tsx:97, Settings.tsx:264) | `API_BASE='/api'` is prepended to paths that already start with `/api`, so requests go to `/api/api/pos/products`. Vite's proxy has no rewrite (vite.config.ts). | Every `useApi` call 404s, and every page silently falls back to its `MOCK_*`/`PRODUCTS`/`SALES` constants. Staff see plausible fake data and believe the system works. | Strip `/api` from either the base or the paths. Make useApi throw loudly instead of falling back. Delete all mock constants from production bundles. | P0 | S |
| X2 | POS.tsx:144-149, Fuel.tsx:260-272, Concierge.tsx:183-187, RentRoll.tsx:97-98, Dashboard.tsx:285-295, Ramp.tsx:158-160 | UI types don't match API shapes. The API returns `{data, pagination}` with cents and enum names. The UI expects bare arrays with dollars and display labels (`price`, `inStock`, `'Single Launch'`, `occupancyData.rate`). | Once X1 is fixed, pages crash (`entries.filter is not a function` in RentRoll), or the KPIs keep showing mock values because the expected fields don't exist. | Generate shared types (zod → TS) in a `packages/contracts` workspace. Add one adapter per page. Add contract tests. | P0 | M (per module) |
| X3 | POS.tsx:314-336, Fuel.tsx:290-310, Concierge.tsx:204-232, Inventory.tsx (no API calls), Announcements.tsx:346-357, HelpCenter.tsx:167 | Writes go to React local state only. `createTransaction` is declared (POS.tsx:305) but never called. | A cashier rings up a sale and the customer pays cash. The sale vanishes on refresh. No inventory moves and there is no audit trail. | Wire each mutation to the API and only show success after a 2xx response. | P0 | M |
| X4 | reports.ts:8, fuel.ts:103,156,205, insurance.ts:168,268,409, tenants.ts:81,99,117, (also qbo.ts, audit-log.ts) | `requireRole("admin","manager","accounting")` uses lowercase strings. The `UserRole` enum is `MARINA_OWNER`/`MARINA_MANAGER`/`ACCOUNTING`… (schema.prisma:18-26). | Every real user gets a 403 on all reports, the Dashboard KPIs, fuel pricing, and insurance review and compliance. Tests pass only because auth is mocked. | Replace with enum values. Add a role→permission map. Add a test that boots real middleware with each seeded role. | P0 | S |
| X5 | ramp.ts:54,102,136,155,214, concierge.ts:87,118,137,172,207,238,268,303,319,346 (also transient.ts) | `clerkAuth` is passed as a function reference instead of `...clerkAuth()`. Express calls the factory as middleware, it returns an array, and `next()` is never called. | Every ramp and concierge request hangs until the client times out. Confirmed: concierge.test.ts "returns 404…" times out at 30s. | `router.use(...clerkAuth())` at the top of each router. Add a lint rule banning bare `clerkAuth`. | P0 | S |
| X6 | apps/api/src/lib/prisma.ts:17-55, :94-110 | The tenant-scoping extension's model list is wrong in both directions. **Listed but have no `tenantId` column:** `DockWalkItem` (l.28), `PosLineItem` (l.32), `AnnouncementDelivery` (l.47), and `FuelDispense`, which doesn't exist (l.50). Every direct query on these throws `Unknown argument tenantId`. **Have `tenantId` but not listed:** `ConciergeVendor`, `InsuranceRecord`, `CommunicationPreference`, `MeterReading`, `GlAccount`, `SecurityDeposit` and others, so they rely on hand-written filters. | Dock-walk issues list, item add/update, the `dock-walk-summary`/`dock-walk-violations`/`fuel` reports, announcement stats and sends, and seeding all 500. Vendors are listed across tenants. | Generate the list from the Prisma DMMF (models whose fields include `tenantId`). Add `tenantId` to child tables, or scope them through the parent relation. Owner: platform audit. | P0 | M |
| X7 | apps/api/package.json scripts (no worker), workers/index.ts:23,49-51,73,116-117, lib/queue.ts | `src/workers/index.ts` has no start script or Procfile entry, so no worker ever runs. Even if one ran, the email worker expects `{type,to,data}` and the SMS worker `{to,body}`, while producers send `{email,subject,body}` / `{phone,body}` / `{type:"insurance_expiry_reminder", customerId}` / `{type:"tenant_lifecycle"}`. The automation worker queries snake_case fields (`tenant_id`, `first_name`) that don't exist. | No announcement, insurance reminder, lifecycle notice or automation message is ever delivered. `AnnouncementDelivery` rows stay `PENDING` forever. | Add a `worker` process. Define one typed job schema per queue (zod) that both producer and consumer import. Add a dead-letter queue and alerting. | P0 | M |
| X8 | fuel.ts:49-82, inventory.ts:173-183, admin.ts (saasInvoiceStore, supportTicketStore) | Business data is kept in module-level arrays. | Data is lost on every deploy. It diverges across instances. Fuel prices and tank levels are shared across all tenants. | Move to Prisma models (see each module). | P0 | M–L |
| X9 | apps/api/prisma/ (no `migrations/`) | There is no migration history, although `db:migrate` runs `prisma migrate deploy`. | Production DB creation is undefined. Schema changes recommended below can't be rolled out safely. | `prisma migrate dev --name init`, then commit migrations. Owner: platform audit. | P0 | S |
| X10 | apps/api/tests/setup.ts (mockPrisma), src/index.ts:107 | Tests mock Prisma and auth entirely, and `index.ts` calls `app.listen` on import, so parallel files fail with EADDRINUSE. Serial run: 20 of 37 route tests in scope fail. 669 tsc errors are never gated in CI. | Schema drift (wrong field names, missing models) ships undetected. Most bugs in this report would have been caught by `tsc`. | Export `app` without listening. Run a real Postgres test container. Make `tsc --noEmit` a required CI check. | P0 | M |
| X11 | POS.tsx:396, Fuel.tsx:276, Ramp.tsx:162, Reports.tsx:219-220, ReportViewer.tsx:657-688 | "Today" is hardcoded to `2026-03-25`. | Today is 2026-10-26, so every "today" KPI shows zero, or shows mock data from seven months ago. | Use tenant-timezone `now()`. | P1 | S |
| X12 | pos.ts:960-964, ramp.ts:57-60, reports.ts:12-19, announcements.ts:236 | Day boundaries use the server's local time, not `Tenant.timezone`. | A Florida marina's 8–9 pm sales land on "tomorrow" when the server runs in UTC. The Z report and daily cash recon disagree with the drawer. | Add a `tenantDayRange(tz, date)` helper (date-fns-tz) and use it everywhere. | P1 | S |

---

## 2. Module sections

### 2.1 POS — retail and ship store

**Purpose.** Ring up ship-store, bait, ice and fuel sales. Take cash, card, ACH or charge-to-slip. Manage cashier shifts and cash drawers, issue refunds, and produce a daily sales report.

**What actually works.**
- **API (Prisma-backed):** product CRUD, transaction create/list/get, full and partial refunds, an inventory level list and absolute set, shift open/close with an expected-cash calculation, and a daily report. These run against the DB, scoped by `tenantId`.
- **UI:** the cart, tender modal and change calculation work as a mock only.

**Stubbed or fake.**
- No payment processing exists. "Card" just shows "Tap, insert, or swipe" and then "Payment Complete" (POS.tsx:233, 314-336).
- ACH and Charge-to-Slip are labels only.
- `stripe-terminal.ts` is never imported by any route.
- `BarcodeScanner.tsx` and `QRScanner.tsx` are never imported.
- The shift banner is hardcoded ("Jake M.", 8:00 AM, $100 float; POS.tsx:285-287).
- "Close Shift" only flips local state.

**API↔UI mismatches.**
- The UI expects `Product{price (dollars), taxRate, inStock, category}`. The API returns `{data:[{priceCents, taxClass, inventory:[…], departmentId}], pagination}`.
- The UI tender labels ('Card', 'Charge to Slip') don't match the API enum (`CARD`, `CHARGE_TO_ACCOUNT`).
- The UI supports fractional quantities (POS.tsx:215-228, needed for fuel gallons). The API requires `z.number().int().positive()` (pos.ts:48).

**Data-model problems.**
- `PosTransaction.status` is a free-text `String` that holds the *payment method* (`CASH`/`CARD`…) and is later overwritten with `REFUNDED` (pos.ts:401, 647-650), so payment method and refund state are destroyed together.
- There is no `customerId`, `paymentMethod`, `stripePaymentIntentId`, `invoiceId`, `locationId`, `receiptNumber` or `voidedAt` column.
- `PosLineItem.quantity Int` cannot hold 12.437 gallons.
- `Product` has no `active`, `category`, `department` (only a dangling `departmentId`), `taxClassId`, `glAccountId` or `isFuel`.
- There is no `Payment`/tender table for split tender, and no `GiftCard` or `HouseAccount` tables, although the `PaymentMethod` enum has `GIFT_CARD`.

**Correctness bugs.**

| ID | File:line | Issue | Failure scenario | Fix | Sev | Effort |
|---|---|---|---|---|---|---|
| POS-1 | POS.tsx:314-336, :305 | The sale is never POSTed and the UI declares payment complete. | Cash and card sales are not recorded. No revenue, tax, inventory or audit trail exists. | Call `POST /pos/transactions` and show success only on 201. Add a printable/emailable receipt. | P0 | M |
| POS-2 | pos.ts:370 | `unitPrice = li.unitPriceCents ?? product.priceCents`. The schema *requires* `unitPriceCents` (l.49), so the client always sets the price. Missing or foreign products are accepted. | Any staff member (or a modified client) can sell a $24.99 fender at $0.01. A line with a `productId` from another tenant is created referencing that tenant's product. | Price from DB. Allow overrides only with a `priceOverride` permission and a reason. Reject unknown products. | P0 | S |
| POS-3 | pos.ts:373 | Tax is `product.taxClass ? 0.07 : 0`. Any non-null `taxClass`, including the seeded `'EXEMPT'` on fuel (seed/pos.ts:11-13), is taxed at 7%. `tax-engine.ts` and the tenant `taxRate` setting are ignored. | Fuel is over-charged 7% sales tax. Every marina outside 7% jurisdictions charges the wrong rate. Tax-exempt customers (`Customer.taxExempt`) are taxed. | Use the tax engine with a `TaxClass` table (rate, jurisdiction, fuel excise/inclusive flag). Respect customer exemption. Store rate per line. | P0 | M |
| POS-4 | pos.ts:392-412 | `customerId` is parsed but not stored. `CHARGE_TO_ACCOUNT` creates no invoice line or AR entry. | "Charge to slip", the most common marina tender, loses the charge entirely. | Persist `customerId`. On charge-to-account, append an `InvoiceLineItem` to the customer's open/next invoice (sourceType=`POS`), coordinating with the billing audit. Check credit limit and `COLLECTIONS_HOLD`. | P0 | M |
| POS-5 | pos.ts:371 | `lineSubtotal = price*qty - discount` has no lower bound. | A negative line total is accepted and offsets other lines. | `discountCents ≤ price*qty`. Require a discount permission. | P1 | S |
| POS-6 | pos.ts:392-427, 624-667 | No DB transaction. Inventory decrements run in a loop after the sale insert, and stock can go negative. | A partial failure leaves the sale recorded without the decrement, or the reverse. Concurrent sales oversell. | Wrap in `prisma.$transaction`. Do an atomic decrement with a stock-policy check. | P1 | S |
| POS-7 | pos.ts:647-650, 549-551 | A partial refund marks the *whole* original `REFUNDED`. A second partial refund is blocked. | Refunding 1 of 3 items removes the full sale from sales and shift totals and blocks refunding the rest. | Track `refundedQty` per line and a `refundOfId` link. Set status `PARTIALLY_REFUNDED`. Refund the tender through the original method (cash out, Stripe refund). | P0 | M |
| POS-8 | pos.ts:981-989 | The daily report puts both the original (now `REFUNDED`) and the refund row in `refunds`. | Every refund is counted twice. Net sales are understated by the full refund amount. | Derive from line-level signed amounts. Never mutate the original's status. | P0 | S |
| POS-9 | pos.ts:799-808, 903-908 | Expected cash counts only rows whose `status === 'CASH'`. Cash refunds (status `REFUNDED`, negative) and cash tips are ignored. Seeded rows use `COMPLETED`. | Drawer variance is wrong whenever a cash refund occurs. | Add a tender table with method and signed amount, and compute from it. Add cash drops/payouts. | P0 | M |
| POS-10 | pos.ts:883-917, 396 | Any user can close any cashier's shift. Transactions can reference any `shiftId`, including closed shifts or other cashiers'. A sale is allowed with no open shift. | Cash accountability is impossible. | Require an open shift owned by the cashier, or a manager override. Validate `shiftId` belongs to the tenant and is OPEN. Add blind close and a manager `RECONCILED` step (the enum value exists but is never used). | P1 | S |
| POS-11 | pos.ts:320-325 | "Delete" sets `priceCents = 0`. | The deactivated product stays sellable in POS at $0. | Add `active Boolean` and filter on it. The `active` filter is currently ignored (l.136-140). | P1 | S |
| POS-12 | pos.ts:118 + all routes | No role checks. `POS_CASHIER` can delete products, set inventory, and issue unlimited refunds. | Refund fraud and inventory tampering. | Permission matrix: refunds, price overrides, inventory and product edits need manager. Add manager-PIN override. | P1 | S |
| POS-13 | pos.ts:463-464 | `paymentMethod` and `status` filters write the same column, and the second overwrites the first. | The filter "cash refunds" is impossible. | Fixed by the schema change in POS-7/9. | P2 | S |
| POS-14 | stripe-terminal.ts:97 | `amount_to_capture = original + tip` exceeds the authorized amount, which Stripe rejects unless overcapture is enabled. Tips are stored in metadata rather than Terminal's native on-reader tipping. | Tipped card sales fail at capture. | Use the Terminal `tipping` config on the PaymentIntent or reader. Capture the final amount. Lint fixes (`stripe` possibly null; `"wispos_e"` is not a valid `DeviceType`, l.26). | P1 (v1.1) | M |
| POS-15 | stripe-terminal.ts:123-171 | `processOfflineQueue` creates `card_present` PaymentIntents with `confirm:true` and no payment method. Card-present data cannot be replayed from a server. | The offline card queue always fails, and silently counts as `failed`. | Delete it. Use Stripe Terminal's reader-side offline mode with `offline` behavior and its forwarding webhooks. | P1 (v1.1) | M |
| POS-16 | BarcodeScanner.tsx:10-17, 57-63 | The scanner accepts only six hardcoded barcodes. It uses Web Serial and `BarcodeDetector` (Chrome-only). Most retail scanners are USB HID "keyboard wedge" devices, which aren't supported. It is not mounted anywhere. | No real product can be scanned. | Global keystroke-burst listener for HID scanners. Look up by `Product.barcode` through the API. Keep camera scanning as fallback. Mount it in POS. | P1 | S |

**Tenant/auth gaps.** These are covered in POS-2 (foreign productId), POS-10 and POS-12. Queries otherwise include `tenantId`.

**What operators need that's missing** (Lightspeed/Square/DockMaster/Molo POS parity):
- Charge to slip/house account with credit limits.
- Split tender.
- Gift cards and store credit.
- Discounts and promotions.
- Tax classes by jurisdiction, including fuel excise and tax-inclusive fuel pricing.
- Receipts (print/email/SMS).
- Cash drops and payouts.
- Z/X reports and blind drawer count.
- Manager override PIN.
- Multi-register and multi-location.
- Returns without receipt.
- Customer lookup by slip or boat.
- Integrated card-present payments.
- Offline sale queue.
- Department/category reporting and GL mapping per department.

**Rating:** Prototype. **v1: IN, narrowed.** Charge-to-account, cash, and recorded external card tender. Correct tax via tax classes. Fuel as decimal-quantity products. Shift and drawer reconciliation and a Z report. Stripe Terminal moves to v1.1.

---

### 2.2 Fuel dock (fuel.ts, Fuel.tsx, PumpOut)

**Purpose.** Fuel pricing per grade, sales log, deliveries, tank levels and margin reporting. Pump-outs are recorded under dock-walks.

**What actually works.** Nothing persists.
- `fuel.ts` keeps three hardcoded fuel types, a `SALES` array and a `DELIVERIES` array in memory (l.49-82).
- The UI (Fuel.tsx) never calls POST. It edits local state only (l.290-310).
- `GET /reports/fuel` (reports.ts:455) queries `product: { department: "FUEL" }`. That field doesn't exist, so it crashes (also because of X6 on `posLineItem`).

**Correctness bugs.**

| ID | File:line | Issue | Failure scenario | Fix | Sev | Effort |
|---|---|---|---|---|---|---|
| FUEL-1 | fuel.ts:49-53, 86-114 | Prices and tank levels are global, not per tenant, and in memory. | Marina A sets diesel to $5.99 and every Helm marina now charges $5.99. Restarting the server resets the price. | Models: `FuelGrade(tenantId, locationId, name, pricePerGalMicros, costPerGal, taxClassId)`, `FuelTank(capacity, gradeId)`, `FuelDelivery`, `TankReading`. Fuel sales should be POS lines (not a separate `FuelSale`) so the cash drawer and tax are unified. | P0 | M |
| FUEL-2 | fuel.ts:118-144 | A sale takes no payment, ignores `customerId`, has a hardcoded `staffName: "Current User"`, and generates IDs from `Date.now()`, which collide within the same millisecond. | Unbillable and unauditable. | Route through POS (POS-1/4). | P0 | S (after POS) |
| FUEL-3 | fuel.ts:124 | No tax, fuel excise or per-gallon rounding rules. Prices are integer cents per gallon, so $4.299 (a common fuel price) is impossible. | Wrong totals versus the pump display. | Price in tenths of a cent (or micros). Use a tax-inclusive flag per grade. | P1 | S |
| FUEL-4 | fuel.ts:162 | `tankLevelAfterGallons \|\| …` treats 0 as missing. There is no overfill check against capacity. | A stick reading of 0 is ignored. | `??`. Validate against capacity. | P2 | S |
| FUEL-5 | fuel.ts:198 | `estimatedDaysRemaining = level/50` is a fake constant. | A misleading reorder signal. | Use the trailing 14-day burn rate. | P2 | S |
| FUEL-6 | fuel.ts:103,156,205 | Lowercase roles (X4). | Price updates, deliveries and reports return 403 for every real user. | X4. | P0 | S |

**Missing versus FuelCloud and fuel-dock POS:**
- Pump controller integration (Gilbarco/Wayne/OPW pump interfaces, or FuelCloud API) for authorize→dispense→finalize.
- Price tiers: slip-holder versus transient, volume breaks, and a "cash price".
- Per-boat fuel history.
- Daily tank reconciliation (opening + deliveries − sales vs stick reading): required for leak detection and EPA/state UST compliance.
- Delivery BOL capture.
- Fuel tax reporting.
- Fuel-only quick-sale screen with numeric gallons entry.

**Rating:** Stub. **v1: IN only as POS fuel products** (grade = product with decimal quantity and tax-inclusive pricing, plus a manual tank reading form if time allows). Separate fuel module, pump integration and delivery/tank management are **OUT** (v1.1+).

---

### 2.3 Inventory and purchasing (inventory.ts, Inventory.tsx, Product/Inventory/PurchaseOrder models, lib/barcode.ts)

**Purpose.** Product catalog, stock adjustments, cycle counts, purchase orders and receiving, ZPL shelf labels, valuation and reorder alerts.

**What actually works.**
- The route has complete-looking logic, but **everything lives in arrays in RAM** (inventory.ts:173-183), separate from the Prisma `Product`/`Inventory` that POS uses.
- The UI is 100% mock constants (Inventory.tsx:34-67) and imports `useApi` without calling it.
- The Prisma `PurchaseOrder` model (schema:1191) has no line items, vendor table or received quantities, and is unused.
- `lib/barcode.ts` (a correct 2"×1" ZPL generator) is not used. The route builds its own ZPL inline (inventory.ts:667).

| ID | File:line | Issue | Failure scenario | Fix | Sev | Effort |
|---|---|---|---|---|---|---|
| INV-1 | inventory.ts:180-183 | In-memory, with a second catalog. | Products created in Inventory never appear in POS. Data is lost on restart. | Delete the in-memory store. Build on Prisma `Product`/`Inventory` with an `InventoryTransaction` ledger (type, qty, unitCost, refId). | P0 (if shipped) | L |
| INV-2 | inventory.ts:185-187 | `tenantId ?? "default"`. | Without tenant context, every request shares a "default" bucket. | Remove the fallback. Require tenant. | P1 | S |
| INV-3 | inventory.ts:344-348 | The COGS GL posting is a comment ("In production: create GL journal entry"). | Inventory valuation and COGS never reach the GL or P&L. reports.ts `/pnl` queries `type:"COGS"`, which is not a valid enum value (reports.ts:603), so it crashes. | Post COGS at sale time using weighted average cost. Map the COGS account through `GLAccountType.EXPENSE` plus a subType. | P1 | M |
| INV-4 | schema.prisma:1191-1202 | `PurchaseOrder` has no lines, vendor FK, received qty or cost. | Partial receiving and landed cost can't be modeled. | `Vendor`, `PurchaseOrderLine(qtyOrdered, qtyReceived, unitCost)`, `Receipt`. Update `Inventory.qtyOnOrder`. | P1 | M |
| INV-5 | inventory.ts:667 | Product name and SKU are interpolated into ZPL without escaping `^`/`~`. The name isn't truncated. | A product named `"Rod ^XZ"` breaks the label job. Long names overflow. | Use `lib/barcode.ts` and sanitize `^~\`. | P2 | S |
| INV-6 | inventory.ts:439-479 | Completing a count overwrites QOH from `actualQty` but trusts the client's `expectedQty`. There is no freeze snapshot, so sales during the count cause drift. | Shrinkage is mis-stated. | Snapshot expected quantity at count start and apply the variance as a ledger entry. | P2 | S |
| INV-7 | pos.ts:721-743 | The POS "adjust inventory" sets an absolute quantity with only an audit-log reason, and has no role check. | Untraceable stock changes. | Ledger entries with a reason enum. Manager-only. | P1 | S |

**Missing versus Lightspeed:** vendors, multi-location stock and transfers, matrix/variant items (apparel sizes), serial numbers (outboards, electronics), special orders, min/max reorder automation, cost averaging, import/export.

**Rating:** Stub. **v1: OUT.** Ship POS with a simple QOH field and "received stock" adjustments only. A real Inventory/PO module comes in v1.1.

---

### 2.4 Dry stack and launch ramp (ramp.ts, Ramp.tsx, RampTicket)

**Purpose.** Sell public launch-ramp tickets and day/season passes, and validate passes. The scope note mentions "dry stack launch queue and forklift scheduling", but **no dry-stack code, model or UI exists anywhere**. RampTicket is only a public-ramp fee ticket.

**What actually works.** Nothing.
- Every route hangs (X5).
- The UI is mock (`MOCK_TICKETS`, `MOCK_PASSES`, hardcoded "Peak hour 7:00–8:00 AM"; Ramp.tsx:160-165). It calls `/api/ramp` instead of `/api/ramp/tickets` and sends `{ticketType:'Single Launch', amount}` instead of `{ticketType:'SINGLE_LAUNCH', amountCents}` (Ramp.tsx:439).

| ID | File:line | Issue | Failure scenario | Fix | Sev | Effort |
|---|---|---|---|---|---|---|
| RAMP-1 | ramp.ts:54,102,136,155,214 | Uninvoked `clerkAuth` (X5). | All endpoints hang. | `router.use(...clerkAuth())`. | P0 | S |
| RAMP-2 | ramp.ts:22, 178-186 | `stripeConnectedAccountId` comes from the request body and is used as the destination account. The PaymentIntent is created but never confirmed. | An insider or attacker routes ramp card revenue to their own Stripe account. Card tickets are recorded as paid with an unconfirmed PI. | Always use `tenant.stripeAccountId`. Confirm through Terminal or Payment Element. Mark paid only from the `payment_intent.succeeded` webhook. | P0 | S |
| RAMP-3 | ramp.ts:19, 163-173 | The client sets the price. *Any* customer with *any* active slip contract gets a free launch, with no tenant check on `customerId`. | Revenue leakage. A customer ID from another tenant's slip holder qualifies. | A price table per ticket type and location. Make the slip-holder benefit a configurable rule, validated within the tenant. | P1 | S |
| RAMP-4 | ramp.ts:229-232 | "Season" means calendar year of purchase. There is no expiry field or per-launch usage log. | A pass bought in December expires in January. Day passes can't be validated. Passes are reusable by anyone holding the ID. | `RampPass(validFrom, validTo, boatRegistration, vehiclePlate)` and a `RampLaunch` usage log. Use a QR code containing a signed token. | P1 | M |
| RAMP-5 | ramp.ts:139, 219 | `findUnique({id})` relies solely on the tenant extension. | Safe today, but fragile. | Use `findFirst({id, tenantId})` consistently. | P2 | S |

**Missing versus Dock Pro and SpeedyDock (dry stack):**
- Rack and bin inventory (rack/level/position, size limits).
- Boat-to-rack assignment and storage contracts.
- Launch/haul requests from the boater app with time slots.
- A **launch queue** with forklift/operator scheduling and capacity per time window.
- Status board (racked → requested → staged → in water → returned → washed → racked).
- Wash-down and service add-ons.
- Weather holds.
- No-show fees.
- Boater SMS when the boat is ready.

None of this exists.

**Rating:** Stub. **v1: OUT** (both ramp and dry stack). Remove "dry stack" claims from launch marketing (the competitive research doc §0 lists it as a differentiator). Dry stack is a v2 module and an L-sized build.

---

### 2.5 Concierge (concierge.ts, Concierge.tsx, ConciergeRequest/ConciergeVendor)

**Purpose.** Boaters or staff log service requests (detailing, provisioning, canvas, mechanic). Staff quote, the customer approves, the request is scheduled with a vendor, completed and invoiced.

**What actually works.**
- The API code is reasonable CRUD with a status machine, but it hangs (X5).
- The UI is mock (`MOCK_REQUESTS`, `MOCK_VENDORS`). Its "Submit" adds a local object only (Concierge.tsx:204-232). It calls `/api/concierge` instead of `/api/concierge/requests`.

| ID | File:line | Issue | Failure scenario | Fix | Sev | Effort |
|---|---|---|---|---|---|---|
| CON-1 | concierge.ts:87…346 | Uninvoked `clerkAuth`. | All endpoints hang (confirmed by test timeout). | X5. | P0 | S |
| CON-2 | concierge.ts:306-308, 351-367; prisma.ts:17-55 | `ConciergeVendor` is missing from the tenant-scoped list. `findMany` has no `tenantId`. `findUnique`/`update` are by id only. | Marina A sees and edits Marina B's vendor list (names, phone, email). | Add `tenantId` filters and add the model to the scoped list (X6). | P0 | S |
| CON-3 | concierge.ts:289 | `// TODO: Create billable charge`. `invoiceId` is never set, and status `INVOICED` is unreachable. | Completed services are never billed. The concierge report counts `quoteCents` of COMPLETED as "revenue" (reports.ts:484). | Create an invoice line on completion, with vendor cost and markup. | P1 | M |
| CON-4 | concierge.ts:143-145, 21-22 | Customer check uses `findUnique` with no explicit tenant filter. `boatId` is not validated, so it could belong to another customer or tenant. | Cross-customer data association. | Validate boat belongs to the customer within the tenant. | P1 | S |
| CON-5 | concierge.ts:236-263 | "Customer approves quote" is a staff-authenticated endpoint. There is no portal path and no recorded approval actor. | Staff can self-approve. There is no consent evidence for the charge. | Portal approval with signature/IP, or staff approval with a "verbal approval" note. | P2 | S |
| CON-6 | concierge.ts:182-189 | PUT allows arbitrary `status` jumps, skipping the state machine. | SUBMITTED → INVOICED without a quote. | Enforce transitions. | P2 | S |
| CON-7 | schema.prisma:1061-1083 | No `createdAt`, so `reports.ts:480` crashes (TS2353). No vendor cost, scheduledAt or attachments. | The concierge report 500s. Requests can't be sorted by submission. | Add `createdAt`, `scheduledAt`, `vendorCostCents`, `notesInternal`. | P1 | S |

**Rating:** Prototype. **v1: OUT.** It overlaps heavily with the missing **Work Orders** module (§3). Fold concierge into Work Orders as a "request type", rather than maintaining two half-built workflows.

---

### 2.6 Dock walks and offline sync

**Purpose.** Dock staff walk each dock and check each slip (lines, power, bilge, condition) with photos. They flag violations, notify owners, assess fees, and log pump-outs. Offline-capable mobile operation is advertised as a differentiator.

**What actually works.**
- `GET/POST/PUT /dock-walks`, `GET /:id`, `POST /:id/complete` and `POST /pump-outs` work against Prisma, and their tenant scoping is correct.
- The UI calls the start-walk API only, through raw `fetch` with **no auth header** (DockWalks.tsx:160). Everything else is mock (`WALKS`, `VIOLATIONS`, `INSPECTORS` with fake IDs like `staff-jake`).

**Broken.** Everything item-level, the issues list, the reports, and offline.

| ID | File:line | Issue | Failure scenario | Fix | Sev | Effort |
|---|---|---|---|---|---|---|
| DW-1 | prisma.ts:28 + dock-walks.ts:170,184,346,381,395; reports.ts:289,700; seed/operations.ts:4 | `DockWalkItem` has no `tenantId`, but the extension injects it. | Adding or updating a slip check, the open-issues list and both dock-walk reports throw a Prisma validation error (500). | Add `tenantId` to `DockWalkItem` (recommended), or remove it from the list and scope through the parent. | P0 | S |
| DW-2 | dock-walks.ts:204 vs :501 | `GET /:id` is registered before `GET /pump-outs`. | `GET /api/dock-walks/pump-outs` returns "Dock walk not found" (404). Pump-out history is unreachable. | Register static routes before `/:id`, or validate `:id` as a UUID. | P0 | S |
| DW-3 | dock-walks.ts:287, 31 | Updates write `notes`, which doesn't exist on `DockWalk`. Create-time `notes` is silently discarded (l.27/242-250). | `PUT /:id` with notes → 500. | Add a `notes` column. | P1 | S |
| DW-4 | dock-walks.ts:339-344 | `lineCheck/powerCheck/bilgeCheck/boatCondition` are computed into `checkFlags` and then **never saved** (the comment says they're stored in photoUrls, but they aren't). | The checklist results, which are the whole point of a walk, are lost. | A `checks Json` column or a configurable `DockWalkChecklistItem` template per tenant. | P0 | S |
| DW-5 | DockWalks.tsx (whole page) | The UI has no per-slip walk flow (slip list → check → photo → next). There are only "start walk" and "resolve violation" calls, and the latter targets the non-existent `/api/dock-walks/violations/:id` (l.244). | Staff can't actually perform a walk. | Build the mobile walk screen: dock → slips (from `/slips?dockId`) → checklist → camera upload (S3 presign via storage route) → next. Use `QRScanner` to jump to a slip. | P0 | M |
| DW-6 | dock-walks.ts:36-47, 346-356 | Violations do nothing downstream. `feeCents` is never invoiced, `notifiedAt` is never set, and there is no owner notification, resolution status or due date. `ListIssuesQuerySchema.severity` is unused. | Violations are recorded but have no consequence. | `Violation` entity with severity, owner notice (email via comms), fee → invoice line, `resolvedAt/resolvedBy`, and a re-inspect link. | P1 | M |
| DW-7 | dock-walks.ts:462-496 | Pump-outs: `slipId`/`staffId` are not validated against the tenant. `feeCents` is never billed (`invoiceLineId` unused). There is no Clean Vessel Act log export. | Pump-out fees are lost. Grant (CVA) reporting is impossible. | Validate. Bill. Add a monthly gallons export. | P1 | S |
| DW-8 | dock-walks.ts:24-26 | `inspectorId` is client-supplied, not `req.userId`. | Walks can be attributed to anyone. The UI sends fake IDs. | Default to `req.userId`. Allow a manager override. | P2 | S |
| DW-9 | register-sw.ts:5 (never imported), main.tsx | The service worker is never registered. `OfflineBanner` is never mounted. `offline-store` is never used by DockWalks. | Zero offline capability exists, despite being marketed. | Wire it, or stop claiming it (see v1 scope). | P1 | M |
| DW-10 | public/sw.js:4-9, 21 | `cache.addAll` includes `/icon-192.png` and `/icon-512.png`, which don't exist in `public/`. | SW install rejects, so even after registration nothing gets cached. | Add icons, or drop them from pre-cache. | P1 | S |
| DW-11 | public/sw.js:52-53, 82-90 | Every authenticated `GET /api/*` response is cached in CacheStorage by URL with no user or tenant key and no purge on logout. | On a shared dock tablet, user B (or a different tenant) is served user A's cached customer, slip and financial data when offline. This leaks PII. | Never cache API responses in the SW. Use IndexedDB keyed by user+tenant with explicit allow-listed datasets, and clear on logout. | P0 (if SW ships) | M |
| DW-12 | public/sw.js:57-60 | `/` (index.html) is served cache-first and never revalidated. | After a deploy, users stay on the old bundle indefinitely and hit missing chunk files. | Network-first for navigations. Use hashed-asset precache (Workbox). | P1 | S |
| DW-13 | sync-manager.ts:11-16, sw.js:171-178 | Sync targets `/dock-walks/items`, `/violations` and `/dock-walks/photos`, none of which exist. Items reference local walk IDs that the server doesn't know (no ID mapping). There is no idempotency key, and both the page and the SW can replay the same queue. | Every sync fails, or creates duplicate walks once endpoints exist. | A single `POST /dock-walks/sync` that accepts a client-generated UUID walk plus items plus photo refs, with an idempotency key and upsert by client UUID. | P1 | M |
| DW-14 | sw.js:136 | Bearer token is read from `item.data._token`, persisting auth tokens in IndexedDB. Clerk session tokens expire in about 60 seconds. | Background sync always 401s, and tokens sit at rest on the device. | Sync only from the page, with a fresh `getToken()`. Don't persist tokens. | P1 | S |

**Rating:** Prototype. **v1: IN, online-first.** It's simple, visible and differentiating (mobile dock walk with photos, violation notices, pump-out log). Fix DW-1…DW-8. **Offline sync is OUT of v1** (DW-9…DW-14 are an M–L hardening job) and should not appear in marketing until it is built.

---

### 2.7 Insurance and AI (insurance.ts, services/insurance-ai.ts, services/ocr.ts, InsuranceRecord)

**Purpose.** Ingest boaters' certificates of insurance (COI). Use Claude to extract insurer, policy number, dates, limits and additional insured. Compare against marina minimums. Staff review. Track expirations and remind boaters.

**What actually works.**
- The `parseInsuranceDocument` prompt and parsing are reasonable, with per-field confidence.
- `validateCoverage` compares against defaults or tenant minimums.
- `processInsuranceUpload` creates a `PENDING_REVIEW` record.
- The routes check customer and boat ownership within the tenant.

**Stubbed.**
- There is no file intake. The client must POST `documentText` (insurance.ts:15-20), so there is no path from an uploaded PDF to text.
- `ocr.ts` is unused, and its PDF path (l.39-60) "OCRs the raw PDF buffer as an image", which doesn't work with Tesseract.
- **There is no staff UI** (no Insurance page; only mock mentions in Dashboard and CustomerDetail).

| ID | File:line | Issue | Failure scenario | Fix | Sev | Effort |
|---|---|---|---|---|---|---|
| INS-1 | insurance.ts:15-20; ocr.ts | Text must be supplied by the caller. OCR is unused or broken. | The feature can't be used with a real COI PDF. | Upload to S3 (storage route). Send the PDF directly to Claude as a `document` content block (native PDF support handles scanned pages), and drop Tesseract. Store the raw extraction JSON. | P0 (if IN) | M |
| INS-2 | insurance.ts:168,268,409 | Lowercase roles (X4). | Review queue, compliance and approve/reject all return 403. | X4. | P0 | S |
| INS-3 | insurance-ai.ts:340-351; workers/index.ts:41-51 | Reminder jobs use type `insurance_expiry_reminder`, no `to`, and multi-week BullMQ `delay`s. The worker handles only `expiry_reminder` with `{to,data}`. | No reminder is ever sent. Delayed jobs are also lost if Redis is flushed. They aren't rescheduled when staff correct the expiry date during review, so they fire on the wrong date. | A daily scheduled job that queries `expiryDate` windows (60/30/7/0 days) and sends through the comms service with preference checks. Delete the delayed jobs. | P1 | S |
| INS-4 | insurance-ai.ts:9 | `new Anthropic({apiKey: undefined})` at import time. There is no timeout, retry or size cap, and no tenant- or PII-safe logging. | A missing key crashes on the first upload. Large documents time out the HTTP request. | Process on a queue. Show "processing" status in the UI. Retry with backoff. Cap tokens and size. | P1 | S |
| INS-5 | insurance-ai.ts:296 | `hasLowConfidence ? "PENDING_REVIEW" : "PENDING_REVIEW"`. | A harmless no-op, but it signals unfinished logic. | Keep everything in review for v1 (the correct choice) and delete the dead ternary. | P2 | S |
| INS-6 | insurance-ai.ts:227-241 | Tenant minimums are read from `invoiceTemplateJson.insuranceMinimums`, an overloaded JSON column with no settings UI. | Marinas can't configure their required liability limit (commonly $300k–$1M) or require "marina named as additional insured". | `TenantSettings.insuranceRequirements` with a settings UI. Add additional-insured and named-vessel checks (HIN/name match against `Boat`). | P1 | S |
| INS-7 | insurance.ts:110 | `findUnique({id})` after create, with no tenant filter (the model isn't in the scoped list, X6). | Fragile, though the risk is low. | `findFirst({id, tenantId})`. | P2 | S |
| INS-8 | schema.prisma:1252-1271 | `extractionConfidence` is a `String` holding JSON. There are no `reviewedBy/At`, `rejectionReason` or `supersedesId` columns, so history is lost when a renewal arrives. | Can't show "current policy" versus history. | Typed columns, an `isCurrent` flag, and supersession. | P2 | S |

**Missing:**
- Portal upload by boater, with a "your COI was rejected because…" email.
- Contract-gating rule: an active contract requires an approved, unexpired COI. The compliance service may partly cover this (slips/contracts audit).
- Bulk compliance list with filters.
- Registration and USCG documentation expiry tracking, using the same flow (`Boat.registrationExpiry` exists).

**Rating:** Prototype. **v1: IN, narrowed.** This is the one AI feature competitors don't advertise. Ship the upload → extract → review → expire → remind loop with a small staff UI (M–L total).

---

### 2.8 Announcements, email automation and SMS (TCPA and CAN-SPAM)

**Purpose.**
- Staff send broadcast messages (weather, maintenance, events) by email and SMS to audience segments.
- Event-triggered automations run (invoice past due, contract expiring, etc.).
- Customers control preferences per channel and category.

**What actually works.**
- `announcements.ts` creates `Announcement` rows and resolves audiences (all/active/slip holders/waitlist/custom).
- `communication-prefs.ts` reads and writes per-customer preferences (but see X1 for the UI).

**Nothing is delivered.**
- **Email automation is dead code.** `routes/email-automation.ts` is not mounted in index.ts (l.10-40). It references Prisma models that don't exist (`automationRule`, `emailTemplate`, `emailAutomationLog`; 21 tsc errors). `processAutomationTrigger` (services/email-automation.ts:509) has no callers.
- The `/email-automation` page redirects to `/announcements` (App.tsx:64), whose "Automation" tab is mock data.

| ID | File:line | Issue | Failure scenario | Fix | Sev | Effort |
|---|---|---|---|---|---|---|
| COM-1 | announcements.ts:404-422 vs workers/index.ts:23-51,73; package.json | The job contract doesn't match, and the worker never runs (X7). | 0% delivery. UI and stats show "Sent". | Typed job schema. Run the worker. Set delivery status from Resend/Twilio webhooks (`SENT/DELIVERED/FAILED/OPENED`, which exist in the enum but are never set). | P0 | M |
| COM-2 | announcements.ts:72-102, 382-425 | Recipients are **never filtered by `CommunicationPreference`**, customer status `COLLECTIONS_HOLD`, or contact validity. No preference check exists anywhere (grep: no consumer outside the prefs route). | A customer who opted out of announcements, or who replied STOP, still gets texted. **TCPA exposure is $500–$1,500 per message, per recipient, and class actions are common.** | Central `canContact(customer, channel, category)` gate in the comms service. Store consent records. Treat `isEmergency` as an informational category, but still require SMS consent. | P0 | M |
| COM-3 | lib/sms.ts (whole), no inbound route (grep STOP/unsubscribe/opt-out → no hits) | There is no inbound SMS webhook. STOP/UNSTOP/HELP keywords are not honored or recorded. There is no 10DLC brand/campaign registration flow, no per-tenant sender, and `provisionPhoneNumber` buys a number with no campaign attached. | US carriers block unregistered A2P 10DLC traffic. Opt-outs handled by Twilio Advanced Opt-Out aren't mirrored in Helm, so staff UIs show the customer as reachable. | Twilio Messaging Service per tenant, plus 10DLC registration in onboarding. An inbound webhook that writes `CommunicationPreference(sms,*, optedIn=false)` plus a consent log. HELP auto-reply with marina name and phone. | P0 (if SMS ships) | L |
| COM-4 | communication-prefs.ts:14-22, 198; schema.prisma:1312 | SMS defaults to **opted-in** for billing/inspections/announcements, and missing rows default `optedIn: true`. There is no consent timestamp, source, IP or disclosure text. | Marketing-adjacent SMS goes out without the prior express (written) consent TCPA requires, and there's no evidence to defend a claim. | SMS defaults OFF until consent is captured (contract e-sign checkbox, portal, keyword opt-in). Add a `ConsentEvent` table (customer, channel, category, granted, method, text, ip, ts). | P0 | M |
| COM-5 | lib/email.ts:67-80, 187-197, 33 | The email layout has no unsubscribe link, no `List-Unsubscribe`/`List-Unsubscribe-Post` headers, and no physical postal address. The sender is `billing@{marinaDomain}`, which needs per-tenant domain verification in Resend. | CAN-SPAM violation for commercial mail. Gmail/Yahoo bulk-sender rules (Feb 2024) require one-click unsubscribe, so announcements go to spam or get rejected. Unverified domains fail to send. | Signed per-recipient unsubscribe link and endpoint. RFC 8058 headers. Tenant address in the footer. Platform sending domain with a per-tenant reply-to until a custom domain is verified. | P0 | M |
| COM-6 | prisma.ts:47 + announcements.ts:171,243,398,534 | `AnnouncementDelivery` has no `tenantId` (X6). | List stats, `/stats`, send and delete all 500. On create (l.357 then 398), the announcement row is created, then the delivery insert crashes, which leaves an orphan with no `sentAt`. | Add `tenantId`. Wrap in a transaction. | P0 | S |
| COM-7 | announcements.ts:374-432 | `POST /` with no `scheduledAt` **sends immediately**. There is no draft state. Scheduled announcements have no scheduler ("a scheduler worker will pick it up", l.372, but none exists). | "Save draft" blasts every customer. Scheduled sends never go out. | `status` enum column (DRAFT/SCHEDULED/SENDING/SENT/CANCELLED). Explicit `/send`. A repeatable job polling due schedules. | P0 | S |
| COM-8 | Announcements.tsx:346-357 vs announcements.ts:20-27 | The UI sends `{subject, channels:[…], scheduled, scheduledDate}`. The API expects `{title, channel:'EMAIL'\|'SMS'\|'BOTH', scheduledAt}`. The UI shows success unconditionally. It offers "Push", "In-App" and "By Dock" options that don't exist on the server. | Every send from the UI is a 400 that displays as success. | Align the contract. Show real errors. Remove unsupported options, or implement dock segments (slip.dockId → contracts → customers). | P0 | S |
| COM-9 | announcements.ts:401-425 | Per-recipient `await queues.x.add` runs inside the HTTP request. | A 600-customer marina sending to BOTH channels makes 1,200 sequential Redis round-trips, and the request times out half-way, producing a partial send. | `addBulk`, or enqueue a single fan-out job. | P1 | S |
| COM-10 | lib/email.ts:195; services/email-automation.ts:496 | Announcement body and template merge values go into HTML unescaped. | Customer-controlled merge fields (name, boat name) can inject HTML or links into marina-branded email. | Escape merge values. Sanitize staff HTML (allow-list). | P2 | S |
| COM-11 | lib/sms.ts:7-10; lib/email.ts:7 | Twilio and Resend clients are constructed at import time with possibly undefined keys (`twilio()` throws "username is required"). | Any import chain touching these crashes the process at boot when env vars are missing (dev or staging). | Lazy-initialize with explicit "not configured" errors. | P2 | S |

**Missing versus Dockwa/Molo comms:**
- Delivery and bounce dashboard.
- Bounce and complaint suppression list.
- Per-dock and per-pier targeting.
- Emergency broadcast with SMS + voice + email and acknowledgment tracking (hurricane prep).
- Templates.
- Quiet hours (8am–9pm recipient local time, which TCPA and some state laws, e.g. FL mini-TCPA, require).
- Two-way SMS inbox.

**Rating:** Prototype. **v1: IN for email announcements only**, after COM-1/2/5/6/7/8 and an unsubscribe flow. **SMS: OUT** until COM-3/4 are done. The one exception is a narrowly scoped emergency/weather SMS, shipped only after consent capture and STOP handling exist. **Automation rule builder: OUT.** Keep code-defined transactional emails (invoice, receipt, COI expiry), owned with the billing audit.

---

### 2.9 Reports and BI (reports.ts, bi-api.ts, Reports.tsx, ReportViewer.tsx, PortfolioDashboard.tsx, RentRoll.tsx, Dashboard.tsx)

**Purpose.**
- A report library covering financial, ops, customer, rentals and POS.
- The home dashboard KPIs.
- A rent roll.
- A multi-property portfolio view.
- An API-key-authenticated BI export API.

**What actually works.** Several simple aggregate endpoints are correct against the schema: occupancy summary counts, revenue, AR aging, collections, deferred revenue, GL summary, lead conversion, customer activity, rental utilization, waitlist, security deposits, chargebacks, trial balance and cash flow. But:
- every one of them returns 403 to every real user (X4, reports.ts:8);
- **every report UI is hardcoded.** ReportViewer has 15 hardcoded "March 2026" datasets. "Export CSV" has no handler (ReportViewer.tsx:715). "Generate" POSTs to `/api/reports/generate`, which doesn't exist (Reports.tsx:216). Recent and Scheduled reports are fixtures. A "Maintenance Log — work orders" report is offered for a module that doesn't exist;
- PortfolioDashboard has no API at all;
- the Dashboard reads `occupancyData.rate`, `revenueApiData.total` and `complianceData.score` (Dashboard.tsx:285-295), none of which the API returns.

| ID | File:line | Issue | Failure scenario | Fix | Sev | Effort |
|---|---|---|---|---|---|---|
| REP-1 | reports.ts:8 | Lowercase roles (X4). | Reports and dashboard KPIs return 403 for everyone. | X4. Allow `DOCK_STAFF` ops reports by permission. | P0 | S |
| REP-2 | reports.ts:34-52, 654, 735, 753-754, 852-853 | `groupBy dock`, `select dock`, `orderBy {dock, number}`, `slip.number`: none of these fields exist (`dockId`, `slipNumber`). | `/occupancy`, `/vacancy-history` and **`/rent-roll`** throw. The rent roll, the most important operator report, is down. | Use `dockId`/`slipNumber`, or add a `Dock` model (recommended; docks have names, power, depth). | P0 | S |
| REP-3 | reports.ts:839 | Rent roll balance filters `status in ["SENT","OVERDUE"]`, which aren't `InvoiceStatus` values, and sums `totalCents` rather than `balanceCents`. | Outstanding balance is always wrong (it errors or shows 0). | `status in [ISSUED, PAST_DUE]` and sum `balanceCents`. | P0 | S |
| REP-4 | reports.ts:777-789 | `SEMI_ANNUAL` isn't handled (annual = 0). Quarterly treats `rateCents` as a per-quarter rate while others treat it as per-period. The rate semantics are undocumented. | Rent roll totals are wrong for semi-annual and quarterly contracts. | A single `annualizedRate(contract)` helper shared with billing. | P1 | S |
| REP-5 | reports.ts:801-843 | 4 queries per slip (N+1, with try/catch swallowing errors). | A 400-slip marina makes about 1,600 queries per rent-roll load (multi-second). Errors silently become zeros. | Batch with `in` queries and groupBy. Don't swallow errors. | P1 | S |
| REP-6 | reports.ts:257 | `pos-sales` filters `status:"COMPLETED"`, but POS writes the payment method into status. | The POS sales report is always $0 for real data (it only works on seed data). | Fix with the POS-7/9 schema. | P0 | S |
| REP-7 | reports.ts:289, 700, 455, 548 | `dockWalkItem`, `posLineItem` and `announcementDelivery` queries are broken by X6. `/fuel` uses non-existent `product.department`. | The dock-walk summary, violations, fuel and announcements reports throw. | X6, plus the fuel-as-product category. | P0 | S |
| REP-8 | reports.ts:603 | P&L queries `account.type: "COGS"`, which is not in `GLAccountType`. | `/pnl` throws. | Use `EXPENSE` + `subType='COGS'`. | P1 | S |
| REP-9 | reports.ts:351-356 | Tax liability sums invoice-line tax only. POS sales tax (separate table) is excluded, and there's no jurisdiction breakdown. | The sales-tax return is under-reported, which is a filing risk. | Union POS line tax, grouped by tax class and jurisdiction, period by `postedAt` in tenant timezone. | P0 (tax filing) | S |
| REP-10 | bi-api.ts:67 + prisma.ts:94-105 + tenant.ts:25 | `/api/bi` is *not* bypassed by tenant middleware, so `tenantStore` holds the **hostname** tenant. The key's tenant is only set on `req.tenantId`, and the Prisma extension then *overwrites* `where.tenantId` with the store's tenant. | Any valid API key, from any tenant, called against `victim.gethelm.com/api/bi/customers` returns the victim's customers, including DL numbers, DOB and addresses. | Bypass tenant middleware for `/api/bi` and run `tenantStore.run({tenantId: apiKey.tenantId})` inside the key middleware. Add per-key scopes and rate limits. | P0 | S |
| REP-11 | bi-api.ts:121-127 | Customer export returns every column (`dlNumber`, `dob`, `dlPhotoUrl`, `emergencyContactJson`). | PII over-exposure to BI tools. | Explicit `select`. Gate PII behind a separate scope. | P1 | S |
| REP-12 | bi-api.ts (no key mgmt route); Settings.tsx (API keys table is static) | There is no endpoint to create or revoke keys, and the UI is fake. `PORTFOLIO` scope is unused. | The BI API can't be used by customers anyway. | **OUT of v1.** Disable the router until key management exists. | P1 | M |
| REP-13 | RentRoll.tsx:97-98 | `entries = apiData \|\| MOCK` where the API returns `{summary, rows}`. | After X1 is fixed, the page crashes on `.filter`. | Adapter. | P0 | S |
| REP-14 | ReportViewer.tsx:119,397,657-688, 715; Reports.tsx:216, 92-106 | All report data and metadata are hardcoded. Export is a no-op. Generate hits a 404. | Owners make decisions on fake numbers. | Bind each viewer to its endpoint. Server-side CSV (stream). PDF later. | P0 | M |
| REP-15 | PortfolioDashboard.tsx:24+ | Static fixture. The data model has no `locationId` on slips, contracts or invoices (only POS/Shift/Ramp carry it). | Multi-property operators see fake numbers. | **OUT of v1.** It requires location scoping across the core models. | P2 | L |
| REP-16 | reports.ts:12-19 | Default period uses server-local month start. `endDate` = now, while a `?endDate=YYYY-MM-DD` parameter is treated as midnight UTC, which excludes the last day. | Off-by-one-day totals. | X12. Make the end date inclusive. | P1 | S |

**v1 report set (wire for real, with CSV):**
1. Rent roll.
2. Occupancy by dock.
3. AR aging.
4. Payments/revenue by method.
5. Sales tax liability (invoice + POS).
6. POS daily Z / shift reconciliation.
7. Insurance compliance.
8. Dock-walk violations.

Everything else stays hidden.

**Rating:** Prototype. **v1: IN, narrowed** (the 8 reports above plus a real Dashboard with 4 KPIs). BI API, Portfolio, scheduled reports and PDF export are **OUT**.

---

### 2.10 Onboarding, tenants, settings, SaaS tiers, admin app, tenant lifecycle

**Purpose.**
- Provision a new marina tenant and its owner user.
- Connect Stripe and QuickBooks Online.
- Seed the chart of accounts.
- Configure marina profile, branding, billing defaults, team and notifications.
- Platform staff manage tenants, tiers, SaaS billing, support and locations.
- A daily job enforces SaaS non-payment.

**What actually works.**
- `settings.ts` endpoints use correct enum roles and correct Prisma fields for marina, branding, billing, stripe, team and notifications.
- The Stripe Express/Standard account link flow (settings.ts:362-394) is the most correct Stripe Connect path in the repo.
- The admin API for locations and lock/unlock is fine *if* platform-admin auth worked.

| ID | File:line | Issue | Failure scenario | Fix | Sev | Effort |
|---|---|---|---|---|---|---|
| ONB-1 | tenant.ts:25 (bypass) + onboarding.ts:45-413 (no auth at all) | Every onboarding endpoint is public and takes `:tenantId` from the URL. | Anyone can overwrite any tenant's branding (l.110), seed GL accounts into any tenant (l.297), or read status (l.355). | Onboarding = an authenticated platform-admin action or a signed, expiring signup token. Never use a raw tenantId. | P0 | M |
| ONB-2 | onboarding.ts:163, 175-197, 240-286 | OAuth `state = tenantId` (unsigned, guessable), and the callback trusts `:tenantId` from the path. | An attacker completes Stripe OAuth with their own account and replays the callback for the victim tenant, so the **victim's payouts go to the attacker's Stripe account**. QBO tokens are fetched and then discarded (l.276-286), so QBO is "connected" but unusable. | Signed state nonce bound to session and tenant. Use the Connect account-link flow from settings.ts and delete the legacy OAuth path. Store QBO tokens encrypted (QBO audit). | P0 | S |
| ONB-3 | onboarding.ts:61-86, 118, 196, 285, 333-341, 377 | Wrong field names (`fiscal_year_end`, `settings`, `branding`, `tenant_id`, `first_name`, `stripe_account_id`, `qbo_realm_id`, `prisma.gLAccount` with `code/active/balance_cents`). 8 tsc errors. | `/start` always 500s, so **no tenant can be created through onboarding**. The other steps also crash. | Rewrite against the schema (`brandingJson`, `glAccount.accountNumber`, …). | P0 | S |
| ONB-4 | onboarding.ts:74-75 | `CREATE SCHEMA tenant_<uuid>` per tenant via `$executeRawUnsafe`, though the app is single-schema row-level tenancy. | Orphan schemas pile up. It confuses `tools/migrate-all.ts`-style tooling. | Remove. | P1 | S |
| ONB-5 | onboarding.ts:78-86; settings.ts:572-605 | The owner user, and any invited user, is created without a Clerk user, invitation or `clerkUserId`. The Clerk webhook only links users whose `public_metadata.tenant_id` is set (auth.ts:69-96), and nothing sets that. | Invited staff can never sign in, or the webhook creates a duplicate user. | Clerk Invitations API with `publicMetadata.tenantId` + role. Link by invitation ID. | P0 | M |
| ONB-6 | settings.ts:572 | A `MARINA_MANAGER` may invite a `MARINA_OWNER` (schema allows any role). | Privilege escalation. | Only owners can grant owner or manager. | P1 | S |
| ONB-7 | onboarding.ts:18, 23-26 vs schema:259, settings.ts:22 | The subdomain regex forbids hyphens while tenants.ts allows them. There are no reserved names (`admin`, `api`, `www`, `app`). Fiscal year is `MM-DD` here, but `MM/DD` in settings and the DB default. | Tenants get `fiscalYearEnd="12-31"`, which fails settings validation on the first save. A subdomain `api` or `admin` can be claimed. | Single validator. Reserved list. Normalize format. | P1 | S |
| ONB-8 | tenants.ts:31-56 | A second, unauthenticated `POST /api/tenants` that writes a non-existent `settings` column. | Spam tenants (if fixed), or a crash. | Delete it. Keep one provisioning path. | P1 | S |
| ONB-9 | tenants.ts:61-76 | `GET /api/tenants/:id` lets any authenticated user read *any* tenant record (Tenant isn't tenant-scoped), including `stripeAccountId`, `qboRealmId` and branding. | Cross-tenant metadata disclosure. | Restrict to `req.tenantId`. | P1 | S |
| ONB-10 | tenants.ts:101 | `accountLinks.create({account: req.params.id})` passes the *tenant UUID* as a Stripe account. | Always fails. | Delete (settings.ts covers it). | P2 | S |
| ONB-11 | Onboarding.tsx:405, 428 | Stripe and QBO are marked "connected" as soon as the popup opens. | Owners launch believing payments are set up. | Poll the `/status` endpoint after redirect back. | P1 | S |
| ONB-12 | Settings.tsx:264-268, 1002, 1231-1260 | The UI calls non-existent `GET/PUT /api/settings` with `{tab}`. Integrations ("Realm: 12345678"), custom domain (`app.bayshoremarina.com`) and API keys are hardcoded. Module toggles live in `localStorage` (ModulesContext.tsx:3-23) per browser, not per tenant. | Settings never save, but the UI says "Settings saved successfully!" (l.267). Disabling a module on one PC doesn't hide it for other staff. | Wire each tab to its `/settings/*` endpoint. `Tenant.enabledModules` server-side, enforced in API routers and nav, which is also how to hide the v1-OUT modules. | P0 | M |
| ONB-13 | settings.ts:506-532 | "QBO sync" only writes a timestamp into `invoiceTemplateJson`. | Fake sync. | QBO audit. | P1 | — |
| ONB-14 | settings.ts:85-91 + insurance-ai.ts:236 + tax-engine.ts | Billing, tax and insurance settings are stuffed into `invoiceTemplateJson`. | Schema-less config drifts between modules. The `taxRate` set in Settings is not what POS uses. | A typed `TenantSettings` table or a zod-validated JSON column. | P1 | M |
| LIFE-1 | tenant-lifecycle.ts:49-56, 107-124 | A "SaaS past due" is detected as **any `Invoice` in the tenant with status `PAST_DUE`**, which is the marina's *boater* invoices. After 30 days it sets LOCKED and deactivates all staff users. | The day this job is scheduled, essentially every real marina (all have a past-due boater) enters grace and is locked out 30 days later. | Base on the Stripe Billing subscription status (`invoice.payment_failed` / `customer.subscription.past_due` webhooks) of the *platform's* customer object for the tenant. | P0 (latent) | M |
| LIFE-2 | tenant.ts:68-73 (middleware), auth.ts:34-53, 104 | `Tenant.status` LOCKED and `User.active=false` are never enforced by any middleware. | Locking does nothing except send (undeliverable) emails. Unlock doesn't reactivate the users deactivated in LIFE-1. | Enforce in tenant and auth middleware (read-only portal mode). Record and restore the users' prior state. | P1 | S |
| LIFE-3 | tenant-lifecycle.ts:231-240 | `scheduleTenantLifecycle` is never called. The email type `tenant_lifecycle` is unknown to the worker. | The job is dormant. That's currently a good thing, given LIFE-1. | Keep it unscheduled until LIFE-1 is fixed. | — | — |
| ADM-1 | auth.ts:136-138 (requirePlatformAdmin) | Queries `clerk_id` (the field is `clerkUserId`) and `role:"platform_admin"` (the enum is `PLATFORM_ADMIN`). | Every `/api/admin/*` call 500s. The admin console is unusable. | Fix the fields. Model platform staff separately from tenant users (`User.tenantId` is required, so a platform admin must belong to a tenant). | P0 | S |
| ADM-2 | apps/admin/src/main.tsx, pages/*.tsx | The admin app has **no authentication** (no ClerkProvider). 6 of 7 pages are pure mock data. TenantDetail calls the API with no token (TenantDetail.tsx:6-13). | Once ADM-1 is fixed, the admin UI is still unauthenticated on the client and gets 401 from the API. Owners see fake MRR and analytics. | Clerk with platform-admin org, plus SSO/MFA. Wire Tenants, TenantDetail and Billing to the real API. Delete Analytics and Support mocks. | P0 | M |
| ADM-3 | admin.ts:473-555 (saasInvoiceStore), :808-880 (supportTicketStore) | SaaS invoices and support tickets live in memory. There is no Stripe Billing subscription per tenant, and `SaasTier.perLocationFeeCents/achFeeRate/cardFeeRate` are never applied (no application fees use the tier). | Helm can't bill its own customers. Platform fee revenue isn't collected per tier. | Stripe Billing (Customer + Subscription per tenant, quantity = slips or locations). Read `application_fee_amount` from the tier. | P0 (business) | M |
| ADM-4 | admin.ts:298-347 | The impersonation token is HMAC-signed with a default secret (`"helm-impersonation-dev-key"`) and **no code validates it**. Nothing is audit-logged. | Dead feature with a dangerous default secret. | Use Clerk actor tokens (impersonation) and audit-log them. | P1 | S |

**Rating:** Broken/Prototype. **v1: IN (required), but sales-assisted.** A platform admin creates the tenant, the owner gets a Clerk invite, and then the owner walks a settings checklist covering Stripe Connect, branding, tax classes, insurance minimums, team invites and module toggles. **Self-serve public signup is OUT** of v1.

---

### 2.11 Help center (HelpCenter.tsx, data/help-articles.ts)

**Purpose.** In-app help articles, search, and support tickets.

**What works.** Static article list with client-side search, mounted in AppLayout.tsx:377.

| ID | File:line | Issue | Failure scenario | Fix | Sev | Effort |
|---|---|---|---|---|---|---|
| HELP-1 | HelpCenter.tsx:152-167 | Ticket inputs are uncontrolled and the submit button only sets local state, yet the screen says "We've received your ticket and will respond within 1 business day". | Customers' support requests disappear, and they wait for a reply that never comes. This damages trust at launch. | POST to a real support inbox (Intercom, HelpScout, or email to support@ with tenant and user context). "My Tickets" should read from it, or be removed. | P0 | S |
| HELP-2 | help-articles.ts:23-112 | Articles describe non-existent features: Stripe Terminal tap/insert (#11), CSV import under Settings (#2), autopay (#4), QR codes per slip (#6), ACH R-code automation (#5), scheduled reports (#13), "you'll receive an invite" (#14). | Support load. Customers believe features exist. | Rewrite for v1 scope only. Host in a CMS so it's editable without deploys. | P1 | S |
| HELP-3 | HelpCenter.tsx (MOCK_TICKETS) | Fake ticket history. | Confusing. | Remove. | P2 | S |

**Rating:** Stub. **v1: IN, minimal** (accurate articles plus a working contact path).

---

### 2.12 Seed data (apps/api/prisma/seed.ts, seed/*)

| ID | File:line | Issue | Failure scenario | Fix | Sev | Effort |
|---|---|---|---|---|---|---|
| SEED-1 | seed/tenant.ts:4-5, seed/tiers.ts:4 | `prisma.user.deleteMany()`, `tenant.deleteMany()` and `saasTier.deleteMany()` run with **no filter**. | Running `db:seed` against staging or production wipes all users and tenants (cascades or orphans). | Guard with `NODE_ENV!=='production'` plus an explicit `--force-demo` flag. Seed into a dedicated `demo` subdomain and delete only that tenant's data. | P0 | S |
| SEED-2 | seed/pos.ts:31, seed/operations.ts:13,32 etc. | Dates are fixed to March 2026 and use `Math.random()`. | The demo looks stale (7 months old). Non-deterministic data breaks screenshots and tests. | Relative dates (`subDays(now, n)`), seeded PRNG. | P1 | S |
| SEED-3 | seed/pos.ts:39-41 vs pos.ts:401 | Seeded transactions use `status:'COMPLETED'`. The API writes payment methods. Seeded taxClass `'EXEMPT'` is taxed by the API (POS-3). | Reports look right on seed data and wrong on real data, which hides bugs in demos. | Align with the fixed POS schema. | P1 | S |
| SEED-4 | seed/tenant.ts:22-27 | Users have no `clerkUserId`. Login works only via the dev bypass (auth.ts:34-53), which logs in as the first user (the owner). | Every role-based behaviour is untestable locally. Everyone is owner. | Seed Clerk dev users, or let the dev bypass select a user via header. | P1 | S |
| SEED-5 | seed/* | No seeds for ramp, concierge, insurance, fuel grades, communication preferences, API keys, locations or tax classes. | Pages for those modules can only render mocks. | Add seeds as each module is wired. | P2 | S |
| SEED-6 | seed/operations.ts:4,23 | Uses `dockWalkItem` and `announcementDelivery` through a plain PrismaClient, which works only because seed bypasses the extension. | Masks X6. | — (fix X6) | — | — |

**Rating:** Needs work. **v1: IN** as a guarded demo-tenant seed (also useful for sales demos).

---

## 3. Modules missing entirely

The competitive-research audit (09) notes that serious competitors have all of these. Rows are ordered by v1 importance.

| Module | Current state in repo | Why it matters | Recommendation |
|---|---|---|---|
| **Service / work orders (boatyard)** | **Entirely absent.** No model, route or UI. The "Maintenance Log — work orders" report card (Reports.tsx:79) is fake. Concierge (§2.5) is the closest thing. | It is the biggest revenue line for full-service marinas: labor plus parts plus haul-out. DockMaster's core. Dockwa added it in July 2026, closing its last gap. | **v1.1 priority #1** (L). Model `WorkOrder` (customer, boat, location, status, estimate → approval → schedule → time entries → parts from inventory → invoice), technicians and labor rates, and canned jobs. Absorb concierge into it. Position v1 honestly as "dockage + ops", not boatyard. |
| **Haul-out / travel-lift / yard scheduling** | Absent. | Spring launch and fall haul are peak operational crunches. | v1.1 alongside work orders: a lift calendar, capacity per lift, a weather-hold flag, and "boat on the hard" location tracking. |
| **Boatyard / winter storage (on-the-hard, rack, trailer)** | Absent. Only `Slip` exists. | Storage contracts are a seasonal revenue pillar in northern markets. | Generalize `Slip` into a `Space` (type: slip/mooring/rack/yard/trailer/parking) with the same contract and billing engine. This is cheaper than parallel modules (M–L). |
| **Dry stack (rack inventory, launch queue, forklift scheduling)** | Absent (§2.4). | A differentiator claimed in positioning. Required by dry-stack operators (SpeedyDock/Dock Pro market). | v2 (L), built on `Space(type=rack)` plus a launch-request queue, an operator board and boater SMS. |
| **Gift cards / store credit** | Only the `PaymentMethod.GIFT_CARD` enum value. | Common holiday upsell for ship stores and rentals. | v1.1 (M): `GiftCard(code, balance, ledger)`, sold and redeemed in POS and online. Watch escheatment rules. |
| **House accounts / charge to slip account** | Enum only. Not implemented (POS-4). | The default tender at most marinas. | **v1 (part of POS-lite).** |
| **End-of-day cash reconciliation / Z report** | Partial and wrong (POS-8/9/10). | Owners' #1 anti-theft control. | **v1** (S–M after the POS schema fix): blind count, denominations, drops, over/short sign-off, `RECONCILED` status. |
| **Sales tax engine for retail and fuel** | Hardcoded 7% (POS-3). `tax-engine.ts` is used by invoices only. | Filing correctness. Fuel excise and tax-inclusive pricing. Dockage taxability varies by state (FL charges sales tax on dockage). | **v1 (M):** `TaxClass` and jurisdiction rates per tenant, with per-line storage. Consider Stripe Tax or Avalara for v2. |
| **Utilities metering (pedestal readings → invoices)** | `MeterReading` model plus slip and billing usage exist (slips/billing audits). No pedestal hardware integration and no mobile meter-read route on dock walks. | Metered electric is common and labor-intensive. | Add a "meter read" step into the dock-walk flow (v1.1, S–M). Hardware integrations (e.g., smart pedestals) in v2. |
| **Gate / access control** | Absent. | Gate codes and fobs tied to active contracts, revoked on delinquency. A frequent RFP line item. | v2. Start with a gate code field on contract plus export. Integrations (Brivo, OpenPath, ButterflyMX) later. |
| **Liveaboard management** | Absent (no liveaboard flag, fee or occupant list). | Liveaboard fees, occupant registration and pump-out compliance (many municipalities require logs). | v1.1 (S): a flag on contract with a fee line, occupant list, and pump-out frequency check. |
| **Vessel safety inspections** | `VesselSafetyRecord` model exists, used in boats/compliance services. No inspection UI. | Insurance and USCG-aux courtesy checks. | Fold into the dock-walk checklist (v1.1). |
| **Incident / damage reports** | Absent. | Liability documentation (storms, collisions, injuries) with photos and witnesses. | v1.1 (S), reusing the dock-walk photo pipeline. |
| **Staff time clock / task assignment** | Absent. | Small-marina staff scheduling. | v2, or integrate (When I Work, Homebase). |
| **Hurricane / emergency plan tracking** | Absent. | Hurricane plans and haul-out commitments are required by many Gulf/Atlantic marinas and insurers. | v1.1 (S): a plan document on boat/contract plus an emergency broadcast (comms). |
| **Multi-location / portfolio scoping** | `Location` exists. Only POS, Shift and Ramp carry `locationId`. Slips, contracts and invoices don't. | Required for portfolio dashboards and multi-site operators (Suntex-type buyers). | v2 (L). Don't sell to multi-site operators in v1. |

---

## 4. Prioritized fix list

### Phase A: launch blockers for the v1-IN scope (about 5–7 weeks for a 2–3 engineer team)

| # | Item | Refs | Sev | Effort |
|---|---|---|---|---|
| 1 | Fix the web `/api/api` prefix. Make `useApi` fail loudly. Delete mock fallbacks from all v1-IN pages. | X1, X3 | P0 | S |
| 2 | Fix role strings to enum values and add a permission map. Fix the `clerkAuth` uninvoked calls. | X4, X5 | P0 | S |
| 3 | Fix the tenant-extension model list (generate from DMMF). Add `tenantId` to `DockWalkItem`, `AnnouncementDelivery`, `PosLineItem`. Scope `ConciergeVendor`. Fix the BI tenant override (or disable `/api/bi`). | X6, CON-2, REP-10 | P0 | S–M |
| 4 | Commit an initial migration. Make `tsc --noEmit` a CI gate. Real-DB route tests for v1 modules. | X9, X10 | P0 | M |
| 5 | Lock down onboarding and tenants routes. Use signed OAuth state. Fix schema field names. Clerk invitations for owner and staff. Fix platform-admin auth and add auth to the admin app. | ONB-1/2/3/5, ADM-1/2 | P0 | M |
| 6 | Server-side tenant module flags. Hide v1-OUT modules (Inventory/PO, Ramp, Concierge, Fuel-tanks, SMS, Automation, BI, Portfolio) in nav and API. | ONB-12 | P0 | S |
| 7 | POS-lite: DB prices; tax classes (fuel exempt or tax-inclusive); decimal quantity; `customerId` plus charge-to-account → invoice line; tender table; refunds by line; correct daily report; shift ownership; wire UI save and receipts. | POS-1…POS-12, FUEL-1/3 | P0 | L |
| 8 | Dock walks online: item tenantId; route order; checklist persistence; mobile per-slip flow with photo upload; violation notice and fee; pump-out billing. | DW-1…DW-8 | P0 | M |
| 9 | Comms (email only): worker process plus typed job schemas; `status` column with drafts and scheduler; preference gate; unsubscribe link plus RFC 8058 headers plus postal address; delivery webhooks; align UI payload; `addBulk`. Disable SMS sends. | X7, COM-1/2/5/6/7/8/9 | P0 | M |
| 10 | Insurance: S3 upload → Claude native-PDF extraction on a queue → review UI → approve/reject; daily expiry job and reminders; tenant minimums setting. | INS-1/2/3/4/6 | P0 (as a v1 differentiator) | M–L |
| 11 | Reports: fix rent roll (`dockId`/`slipNumber`, invoice statuses, N+1), occupancy, POS sales, tax liability (with POS), dock-walk reports. Bind the 8 v1 report viewers to the API with CSV export. Make the Dashboard KPIs real. Use tenant-timezone dates. | REP-1…REP-9, REP-13/14/16, X11/X12 | P0 | M |
| 12 | Settings UI wired to real endpoints (profile, branding, billing/tax, team, notifications, insurance minimums, modules). | ONB-12/14, ONB-6/7 | P0 | M |
| 13 | Help center: real ticket submission and accurate articles. | HELP-1/2 | P0 | S |
| 14 | Seed safety guard. Relative dates. Clerk dev users per role. | SEED-1/2/3/4 | P0 | S |
| 15 | Neutralize the lifecycle job (keep it unscheduled). Base SaaS dunning on Stripe Billing. Enforce LOCKED in middleware. | LIFE-1/2, ADM-3 | P0 (business) | M |

### Phase B: P1s shortly after launch, or before launch if the module is pulled into v1

- **Stripe Terminal:** card-present payments with native tipping, Terminal offline mode, and HID barcode scanning (POS-14/15/16).
- **Offline dock walks:** single idempotent sync endpoint, SW without API caching, fresh tokens, icons, network-first navigations (DW-9…DW-14).
- **SMS:** 10DLC registration in onboarding, inbound STOP/HELP webhook, consent events, quiet hours (COM-3/4). Only then enable SMS announcements.
- **Fuel:** grades and tank reconciliation, delivery log, price tiers (FUEL-1…5).
- **Inventory:** ledger-based inventory, POs with lines and receiving, COGS posting (INV-1…INV-7).
- **Concierge → Work Orders v1.1** (CON-3…7, §3).
- **Remaining fixes:** `GET /tenants/:id` scoping (ONB-9), impersonation via Clerk actor tokens (ADM-4), BI key management and PII select (REP-11/12), P&L COGS type (REP-8), rent-roll rate semantics (REP-4).

### Phase C: P2 and roadmap

- Ramp passes with QR and usage log (RAMP-3/4).
- Dry stack (v2).
- Portfolio and multi-location scoping (REP-15).
- Gift cards.
- Gate access.
- Liveaboard.
- Haul-out scheduling.
- Incident reports.
- ZPL sanitization (INV-5).
- Escaping merge fields (COM-10).
- Lazy provider clients (COM-11).
- Typed insurance columns (INS-8).

---

### Appendix: verification notes

- **tsc (`apps/api`, after `prisma generate`):** 669 error lines. In scope:
  - reports.ts: 40
  - pos.ts: 26
  - email-automation route + service: 25
  - stripe-terminal.ts: 16
  - dock-walks.ts: 13
  - announcements.ts: 12
  - concierge.ts: 11
  - communication-prefs.ts: 9
  - onboarding.ts: 8
  - settings.ts: 6
  - tenants.ts: 5
  - workers: 3
  - ramp, insurance, bi-api: 1 each

  Many `string | string[]` errors are noise from the @types/express version. The schema-drift errors cited above are real runtime failures.
- **vitest (serial, scoped route files):** 17 pass, 20 fail. Concierge "returns 404 when customer does not exist" times out after 30s, which confirms X5. Parallel runs fail with `EADDRINUSE :3001` because `src/index.ts:107` listens on import.
- **Grep checks:**
  - No production code references `STOP`, `unsubscribe`, `opt-out`, `List-Unsubscribe` or an inbound Twilio webhook.
  - `CommunicationPreference` is read only by its own route.
  - `stripe-terminal.ts`, `ocr.ts`, `lib/barcode.ts`, `BarcodeScanner.tsx`, `QRScanner.tsx`, `register-sw.ts`, `sync-manager.ts` and `OfflineBanner.tsx` have no importers.
  - `routes/email-automation.ts` is not mounted.
