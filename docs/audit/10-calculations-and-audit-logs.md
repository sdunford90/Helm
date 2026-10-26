# 10 — Calculation Catalog & Audit Logging Assessment

**Scope:** Every business-number calculation in `apps/api`, `apps/web`, `apps/portal`, `apps/admin`, `apps/widgets`, `packages/shared-types`, plus a full audit-logging assessment and target design.
**Method:** grep for arithmetic on money/quantity identifiers (`Cents`, `amount`, `price`, `rate`, `tax`, `fee`, `discount`, `qty`, `gallons`, `nights`, `hours`, `Math.round/floor/ceil`, `toFixed`, `reduce(`, `*`, `/`). I read each hit in context, checked the Prisma schema for column types, and ran edge cases in Node (TZ=America/New_York) to confirm "Wrong" verdicts. I also built an endpoint-by-endpoint audit matrix with a script over every `router.post/put/patch/delete`.
**Relation to other reviews:** money flows (02), rentals pricing (04) and contracts/booking (05) are reviewed in depth elsewhere. This document lists those calculations so the catalog is complete, but keeps the analysis short and points to the other reviews where they overlap.
**No source files were modified.**

---

## 0. Executive summary

1. **No single source of truth exists for any money calculation.** There is no shared money library. `packages/shared-types` holds only types, and those types disagree with the Prisma schema. Proration is implemented twice and the two versions disagree. Tax is implemented three ways (tenant JSON rates; a hard-coded 7% in POS; a hard-coded 7% default in the web invoice form), with **two different units** (fraction `0.07` in the API, percent `7` in the UI and settings). Rental pricing is implemented **five** ways: the API, the algorithmic job, PriceSimulator, PricingCalendar and the booking widget. None of the five agree.
2. **The core revenue engine never runs.** `generateRecurringInvoices()` and `recognizeDeferred()` have **no caller**: no job, no route, no worker. The only scheduled money job is algorithmic pricing. When billing does run (for example in tests), it charges `rateCents` **every month whatever the billing cycle**. The rent roll treats the same field as a per-cycle amount, so a quarterly contract would be billed 3× (see C-01).
3. **The GL is not trustworthy.** (a) Sales tax is credited to **revenue**. (b) There are three incompatible chart-of-accounts conventions (posting code vs onboarding vs seed). For example, account `2400` means "Deferred Revenue" to the posting code, "Sales Tax Payable" in onboarding and "Tips Payable" in the seed, and the AR account `1200` exists in neither. (c) Contract termination writes a **single-sided GL entry** that bypasses the balance check. (d) ACH return fees and QBO-inbound balance changes alter invoice balances with **no GL entry**.
4. **The server trusts client-supplied numbers** for transient booking totals, POS unit prices, ramp tickets, damage charges, dock-walk and pump-out fees and termination-penalty overrides. Transient and ramp payments also take the **Stripe connected-account ID from the request body**.
5. **Hard-coded values that should be tenant config:** 7% POS tax, 3% platform fee (tier fee rates are ignored), $25 ACH return fee, Net-30 due date, 50 gal/day fuel burn, fuel prices (shared in memory **across all tenants**), and summer/weekend percentages in the pricing UIs.
6. **Wrong results confirmed by worked examples:**
   - algorithmic pricing suggests **$0** whenever a product has no ceiling price;
   - the POS daily report subtracts each refund **twice**;
   - partial credit application **discards** the leftover credit;
   - repeated partial refunds can exceed the original payment;
   - deferred schedules spread a 12-month term over **13** months and defer the **tax** with the revenue;
   - rentals that cross the DST change are charged **2 days for 24 wall-clock hours**;
   - the "NPS" figure is a mean score, not NPS;
   - billing anchors of 29–31 skip short months entirely.
7. **Audit logging is about 48% covered (74 of 155 mutating endpoints) and is not enterprise-grade.** Nothing captures IP or user agent, even though `ipAddress` is a column. The schema has no reason code, actor type, request ID or hash chain. The log is not append-only. Several of the most sensitive actions write **nothing**: platform-admin impersonation, tenant lock/unlock, SaaS tier price changes, team role changes, settings and tax changes, fuel price changes, transient bookings, inventory adjustments, draft-invoice edits, QBO sync, and all exports. The audit UI **falls back to hard-coded fake entries** when the API fails, and in production the API always fails: the role check uses `"admin"/"manager"` while the stored roles are `MARINA_OWNER/...`, and the user lookup filters on a non-existent field `tenant_id`.

---

## Part A — Calculation Catalog

### A.1 Legend

- **Units:** `¢Int` = integer cents in an Int column; `$Float` = floating-point dollars; `Float frac` = rate stored as a fraction (0.07); `pct` = rate stored as a percent (7).
- **Rounding:** `round½↑` = JS `Math.round`. This rounds halves up for positive numbers and toward +∞ for negative numbers (`Math.round(-2.5) = -2`).
- **Test:** `none`, `mock-only` (the Prisma client is fully mocked, so schema drift goes undetected), or `unit`.
- **Verdict:** **OK** Correct · **SUS** Suspect · **WRONG** Wrong · **HC** Hard-coded, should be config · **MISSING** the calculation the feature needs does not exist.

### A.2 Billing, invoicing, tax, deferred revenue, GL

| ID | Module | Location | Formula (plain English) | Inputs / units | Rounding | Duplicates / agree? | Config vs hard-coded | Edge cases | Test | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|
| C-01 | Recurring billing: slip rent | `apps/api/src/services/billing.ts:116-133` | Monthly line = `contract.rateCents` (or prorated), **every month, for every billing cycle**. `billingCycle != MONTHLY` only sets `isDeferred`. | rateCents ¢Int | n/a | Rent roll `reports.ts:776-789` treats rateCents as **per-cycle**. They contradict each other. | Per contract | Quarterly, semi-annual and annual contracts are overbilled. Contracts whose endDate has passed but status is still ACTIVE keep billing. Contracts starting in a future month are billed in full now. | mock-only | **WRONG** |
| C-02 | Proration (billing) | `billing.ts:432-449` | `round(rate / daysInMonth(end) × (floor((end−start)/86.4e6)+1))` | ¢Int, JS Dates in server-local time | round½↑ once at the end | Duplicated by C-03; they **disagree** | Policy hard-coded (per-diem by calendar month) | Under a DST server TZ, a March start loses a day (see work W-2). The contract **end** is never prorated. Partial-day start times are ignored. | none | **WRONG** (when TZ is not UTC) / SUS |
| C-03 | Proration (contract create) | `apps/api/src/routes/contracts.ts:128-160` | `round(rate / cycleDays × remainingDaysInStartMonth)` with cycleDays = days in month, 90, 182 or 365 | ¢Int | round½↑ | Disagrees with C-02 for every non-monthly cycle and under DST. The result is **only echoed and audited, never invoiced**. | Hard-coded 90/182/365 (leap years ignored) | Quarterly ≠ 90 days. A start on the 1st returns 0 prorated days. | none | **SUS** |
| C-04 | Billing due-date selection | `billing.ts:40-47`; default anchor `contracts.ts:408` | A contract is due when `billingAnchor ≤ today.getDate()`. The anchor defaults to the start day of month (1–31), which bypasses the zod `max(28)`. | Int | n/a | none | – | Anchor 29–31: **no invoice in months shorter than the anchor** (W-3). Mid-month starts with anchor > day-of-month are delayed. Server-local time, not tenant TZ. | mock-only | **WRONG** |
| C-05 | Flat electricity | `billing.ts:139-148` | Add `slip.flatFeeCents` each month | ¢Int | n/a | none | Per slip | Not prorated on partial months | none | SUS |
| C-06 | Metered electricity (kWh × rate) | `billing.ts:393-418`; `MeterReading` model | Reads `reading.amountCents`. **Nothing in the API computes `consumedKwh × rateCents`, and nothing writes MeterReading.** | consumedKwh Float, rateCents ¢Int (cannot represent 12.5¢/kWh) | none | `settings.ts:283` holds `electricityRatePerKwh` as **$Float 0.12**, which is unused. The web Slips page shows mock kWh amounts. | Units conflict (¢Int vs $Float) | Rollover, meter replacement and estimated reads are unhandled | mock-only | **MISSING / WRONG** |
| C-07 | Sales tax (invoice) | `apps/api/src/services/tax-engine.ts:49-72, 127-160` | Per line: `round(amountCents × rate)`. The rate comes from `tenant.invoiceTemplateJson.taxRates[]` matched by category, falling back to "general" and then to 0. Exempt customers get 0. | rate as Float frac | round½↑ **per line** | Settings UI writes `invoiceTemplateJson.taxRate` (**pct**, a different key), so **the configured tax rate is never used**. POS uses its own 7% (C-41). | JSON with no effective dates, no jurisdiction stacking, no rate validation (a value of 7 would mean 700%) | Negative lines round toward +∞. Exemption expiry is compared to server "now". | none | **WRONG** (config wiring) |
| C-08 | Manual invoice line extended | `apps/api/src/routes/invoices.ts:224-238` (PUT `:350-358`) | `unitPriceCents × quantity − discountCents` | quantity **Float**, unit ¢Int (negatives allowed), discount ¢Int (uncapped) | **none.** Fractional cents reach an Int column, so Prisma throws (qty 1.5 × 1,001 = 1,501.5). | Web form computes `qty×unitPrice` with no discount (C-10) | – | A discount larger than the line gives a negative extended amount. Tax is calculated on the post-discount amount (fine). | mock-only | **WRONG** |
| C-09 | Invoice totals | `invoices.ts:240-255`; `billing.ts:186-212` | subtotal = Σ extended; tax = Σ line tax; total = subtotal + tax; balance = total | ¢Int | inherits per-line rounding | – | – | – | mock-only | OK (given its inputs) |
| C-10 | Web InvoiceForm preview | `apps/web/src/components/InvoiceForm.tsx:139-187` | line = qty × unitPrice; tax = round(line × taxRate/100); **default taxRate = 7** | ¢Int, taxRate **pct** | round½↑ per line | Disagrees with API (no discount; API ignores the client's taxRate). The payload (`customer` name, `lines`, `qty`) does not match `CreateInvoiceSchema` (customerId, lineItems, quantity), so the request returns 400. | **HC** 7% | `parseInt(qty)` drops fractions | none | **HC / WRONG** |
| C-11 | Web InvoiceDetail totals | `apps/web/src/pages/InvoiceDetail.tsx:286-294` | Recomputes subtotal from `lines`, tax from `taxJurisdictions`, balance = total − Σ completed payments. **Ignores the API's totalCents and balanceCents.** | mixed | round½↑ | Duplicates C-09 with different field names (`lines/qty/unitPrice` vs `lineItems/quantity/unitPriceCents`) | – | With real API data `invoice.lines` is undefined, so the page breaks or falls back to mock invoices | none | **WRONG** |
| C-12 | Portal invoice balance | `apps/portal/src/pages/InvoiceDetail.tsx:65` | total − Σ payments (all statuses) | mock $ | – | Duplicates the server balance | – | Failed and refunded payments are subtracted | none | SUS (mock) |
| C-13 | Credit application | `billing.ts:460-512` | For each unapplied COMPLETED payment: apply `min(credit, balance)`, then **link the whole payment to the invoice** | ¢Int | n/a | `customers.ts:245-253` measures credits as Σ unlinked payments | – | **Leftover credit disappears** (W-4). No GL. Not atomic across credits. | unit (mock) | **WRONG** |
| C-14 | Payment application | `apps/api/src/routes/payments.ts:271-411` | balance −= amount; PAID if ≤ 0; overpayment rejected | ¢Int | n/a | – | – | ACH payments reduce the balance immediately while status is PENDING | mock-only | OK / SUS (ACH) |
| C-15 | Payment refund | `payments.ts:446-545` | `refund ≤ payment.amountCents` (not cumulative); balance += refund; status set to ISSUED | ¢Int | n/a | – | Stripe reason hard-coded | **Several partial refunds can exceed the payment** (W-5). A refund on a past-due invoice resets it to ISSUED. | none | **WRONG** |
| C-16 | ACH return fee | `apps/api/src/services/ach-handler.ts:37, 100-156` | Add a $25 line; subtotal, total and balance each += 2,500 | ¢Int | – | GL reverses only the payment. **The fee is never posted** (account 4600 is unused). | **HC** $25 | Ternary `newBalance >= total ? "ISSUED" : "ISSUED"` is a no-op | none | **HC / WRONG** (GL) |
| C-17 | Due date | `billing.ts:183-184` | issued + 30 days | Date | – | `settings.defaultPaymentTerms` (NET_15/30/45/60) is unused | **HC** | Server TZ | none | **HC** |
| C-18 | Invoice number | `invoices.ts:256`, `billing.ts:182` | `INV-` + base36(Date.now()) | – | – | `invoicePrefix` and `nextInvoiceNumber` in settings are unused | **HC** | Collides when two invoices are created in the same millisecond (billing loop); numbers are not sequential (an audit concern) | none | **HC / SUS** |
| C-19 | Late fee / interest | settings only: `settings.ts:40-41, 279-280` | **None.** `lateFeePercent` (default 1.5) and `lateFeeGraceDays` (10) are stored but never applied. Nothing ever sets an invoice to `PAST_DUE`. | pct | – | Seed has a "Late Fee Revenue 4950" account | Config exists, no engine | – | none | **MISSING** |
| C-20 | Deferred schedule | `apps/api/src/services/deferred-revenue.ts:19-87` | total = **extended + tax**; months = inclusive calendar-month count; per = floor(total/months); remainder goes to the last entry | ¢Int | floor plus last-entry plug | – | – | **Tax is deferred as revenue.** A 12-month term starting mid-month gives **13** entries (W-6). Calendar months, not daily. Uses the global `prisma` inside the caller's interactive transaction, so the FK to the uncommitted line item fails or rolls back. | none | **WRONG** |
| C-21 | Deferral window (recurring) | `billing.ts:247-254` | start/end = current month, so monthCount = 1 | – | – | – | – | Deferral is a no-op: revenue sits in "deferred" until a recognition job that is never scheduled | none | **WRONG** |
| C-22 | Deferral window (finalize) | `invoices.ts:461-476` | issuedDate → +1 year − 1 day | – | – | Ignores `deferredStartDate/EndDate`, which the schema accepts | **HC** 12 months | Feb 29 → Mar 1 | none | **HC** |
| C-23 | Deferred recognition | `deferred-revenue.ts:94-177` | Recognize PENDING entries with date ≤ today | ¢Int | – | – | – | **No caller or scheduler** | none | **MISSING** (not wired) |
| C-24 | Deferred washout on termination | `contracts.ts:619-634` vs `deferred-revenue.ts:186-268` | The route sets schedules to "RECOGNIZED" with no GL entry, and only matches `status:"PENDING"` + `sourceType:"SlipContract"`. Real schedules are `ACTIVE` + `CONTRACT`, so **nothing matches**. | – | – | The proper `washoutDeferred()` and `postEarlyTermination()` are unused | – | – | none | **WRONG** |
| C-25 | Early-termination penalty | `contracts.ts:574-617` | FIXED: `round(value)` treated as cents (Float column). FORMULA: `rateCents × value` (months). An override accepts any value. GL: **a single credit line** to a client-supplied account. | Float, ¢Int | round½↑ | `postEarlyTermination()` (balanced) exists but is unused | Per contract | Ignores the remaining term and billing cycle. Never invoiced. **The GL becomes unbalanced.** | mock-only | **WRONG** |
| C-26 | Renewal rate increase | `apps/api/src/services/renewal-engine.ts:60-88` | percent: `round(rate × (1+v/100))`; dollar: `rate + round(v)` (v in cents); custom: v | Float value | round½↑ | Single implementation, but **no API or UI calls it** | Per batch | No cap, no rounding to whole dollars, no CPI | none | OK (math) / SUS |
| C-27 | Renewal batch selection and delta | `renewal-engine.ts:96-174, 374-418` | Σ (new − old) rateCents. `autoRenewCheck` builds its batch with **filters that omit `autoRenew:true` and `renewalBatchId:null`**. | ¢Int | – | – | – | Non-auto-renew contracts get auto-renewed. Contracts already in another batch are stolen. Monthly and annual rates are summed together. A DRAFT batch can be executed without approval. | none | **WRONG** |
| C-28 | Renewal term dates | `renewal-engine.ts:291-293`; `contracts.ts` renew | new start = old end; end = +1 year via `setFullYear` | Date | – | – | **HC** 1 year | Feb 29 2028 → Mar 1 2029. The successor is created ACTIVE immediately, so with C-01 the new rate bills before the old term ends. | none | SUS |
| C-29 | Security deposit | `contracts.ts:429-440` | Stores `securityDepositCents` as HELD | ¢Int | – | Web sends `depositCents` (`Contracts.tsx:396`, `CustomerDetail.tsx:574`), which is **silently dropped**. Settings `securityDepositDefault` is unused. | – | No GL entry (`postSecurityDeposit` is unused) | none | **WRONG** |
| C-30 | GL invoice posting | `apps/api/src/services/gl-posting.ts:102-157` | Dr AR = total; Cr revenue or deferred per line **= extended + tax** | ¢Int | – | – | Accounts by hard-coded number | **Sales tax is booked to revenue.** Billing passes `glAccountId = contract.qboItemId` (a QBO item id, not a GL UUID). Slip (4000) and electricity (4100) accounts are unused. | unit (mock) | **WRONG** |
| C-31 | GL account mapping | `gl-posting.ts:85-96` vs `apps/api/src/routes/onboarding.ts:307-327` vs `apps/api/prisma/seed/gl-accounts.ts:7-26` | Posting expects 1200 AR, 1000 Cash, 1010 Bank, 2300 Deposits, 2400 Deferred, 4500 General, 4600 ACH fee, 4700 Termination | – | – | Onboarding: 2300 = Tips, 2400 = Sales Tax, no 1xxx accounts. Seed: 1100 AR, 1010 Cash, 2300 Sales Tax, 2400 Tips, 4500 Retail, 4600 Transient, 4700 Ramp. | **HC** | Either throws "GL account 1200 not found" or **posts deferred revenue to Tips/Sales-Tax Payable** and termination income to Ramp Revenue | none | **WRONG** |
| C-32 | GL balance assertion | `gl-posting.ts:23-41` | Σ debits = Σ credits, not all zero | ¢Int | – | Bypassed by direct `glEntry.create` (C-25) | – | – | unit | OK |
| C-33 | Void reversal | `gl-posting.ts:251-279`; `invoices.ts:510-575` | Swap Dr/Cr of the original entries; balance = 0 | ¢Int | – | – | – | A DRAFT invoice cannot be voided (there are no GL rows, so it throws). Deferred schedules keep recognizing after a void. | none | SUS |
| C-34 | QBO invoice push | `apps/api/src/services/qbo-sync.ts:382-392` | `Amount = item.totalCents/100` (**the field does not exist**; the line field is `extendedCents`). `UnitPrice = unit/100`. | $Float | none | – | – | Amount is NaN/undefined. Tax lines and discounts are not sent. | none | **WRONG** |
| C-35 | QBO inbound balance | `qbo-sync.ts:763-767` | `balanceCents = round(QBO.Balance × 100)`; PAID if ≤ 0 | $Float → ¢ | round½↑ | – | – | Changes the receivable with **no Payment and no GL entry**; audited only as `system/qbo-sync` | none | **WRONG** |

### A.3 POS, tips, cash, terminal

| ID | Module | Location | Formula | Inputs / units | Rounding | Duplicates / agree? | Config | Edge cases | Test | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|
| C-40 | POS line subtotal | `apps/api/src/routes/pos.ts:363-369` | `unitPrice × qty − discount`, where unitPrice = `li.unitPriceCents ?? product.priceCents`. The schema **requires** unitPriceCents, so **the catalog price is never used.** | ¢Int (client) | – | Web cart C-46 | – | Unknown productId is accepted. Discount is uncapped (negative lines possible). No price-override audit or approval. | mock-only | **WRONG** (trusts client) |
| C-41 | POS tax | `pos.ts:370-372` | `round(lineSubtotal × 0.07)` if the product has **any** taxClass, else 0 | Float frac | round½↑ per line | Ignores tax-engine C-07 and customer exemption. Web cart uses per-product pct. | **HC 7%** | – | none | **HC** |
| C-42 | POS totals and tip | `pos.ts:373-389` | lineTotal = sub + tax (stored as `extendedCents`); total = Σsub + Σtax + tip | ¢Int | – | **`extendedCents` includes tax here but excludes it on InvoiceLineItem**, so fuel and product reports mix the two meanings | – | The payment method is stored in `status` ("CASH", "CARD"), which breaks every status filter (see C-133) | mock-only | SUS |
| C-43 | POS refund | `pos.ts:588-704` | Partial: ratio = qty/origQty; tax = round(tax×ratio); extended = round(ext×ratio); sub = unit×qty − round(disc×ratio). Full: negate the original. **The original is always marked REFUNDED.** | ¢Int | round½↑ per component | – | – | After a partial refund, nothing else can be refunded. The tip is never refunded. sub + tax can differ from extended by 1¢. No Stripe refund, no GL. | none | **WRONG** |
| C-44 | Shift expected cash / variance | `pos.ts:902-907` | expected = openingFloat + Σ totalCents where status = "CASH"; variance = counted − expected | ¢Int | – | – | – | Cash refunds are not subtracted. A partially refunded sale drops out entirely (W-7). Cash tips are included in expected. `Shift.tipTotalCents` is never updated. | none | **WRONG** |
| C-45 | POS daily report | `pos.ts:983-1029` | sales = status ≠ REFUNDED; refunds = status = REFUNDED; net = Σsales − Σ\|refunds\| | ¢Int | – | – | – | **Double-subtracts** (W-8). Day boundaries use server-local time, not tenant TZ. | none | **WRONG** |
| C-46 | Web POS cart | `apps/web/src/pages/POS.tsx:318-328, 393-395` | subtotal = Σ price×qty; tax = Σ price×qty×rate/100, **rounded once on the total** | **$Float**, pct | round to 0.01 at the end | Disagrees with the backend's per-line round½↑. **Never POSTs** (`createTransaction` is declared but unused), so sales live only in React state. | Mock products with 7% / 0% | Float drift; quantities allow 3 decimals | none | **WRONG** |
| C-47 | Cash change | `POS.tsx:180` | max(0, tendered − total) | $Float | none | – | – | Not stored; no denomination rounding | none | SUS |
| C-48 | Terminal tip capture | `apps/api/src/services/stripe-terminal.ts:85-117` | amount_to_capture = authorized + tip; application fee unchanged | ¢Int | – | – | – | Capturing more than was authorized fails unless overcapture is enabled. The platform fee is not recomputed. | none | SUS |
| C-49 | Tip reports | `stripe-terminal.ts:228-262`; `apps/api/src/routes/reports.ts:508-509` | Σ metadata tips by employee and UTC day; Σ PosTransaction.tipCents by cashier | ¢Int | – | Two sources that are never reconciled | – | UTC day buckets | none | SUS |

### A.4 Fuel

| ID | Module | Location | Formula | Inputs / units | Rounding | Duplicates | Config | Edge cases | Test | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|
| C-50 | Fuel sale | `apps/api/src/routes/fuel.ts:118-144` | `round(gallons × priceCentsPerGallon)`; tank −= gallons | gallons Float, price ¢Int | round½↑ | Web `Fuel.tsx:150-170` in $Float | **HC** prices in a module-level array that is **shared across all tenants**; in-memory and lost on restart | Cannot price in tenths of a cent ($4.299). **No federal, state or marine fuel excise or sales tax.** No payment, invoice, GL or customer charge-to-slip. | unit (in-memory) | **WRONG / HC** |
| C-51 | Fuel margin, level, days left | `fuel.ts:93-98, 191-199`; `Fuel.tsx:230, 279, 463-464` | margin = price − cost; level% = level/capacity; daysLeft = level/50 | ¢Int / $Float | round | Web duplicate | **HC** 50 gal/day | avgMargin is an unweighted mean across fuel types | unit | **HC** |
| C-52 | Fuel delivery cost | `fuel.ts:156-180` | round(gal × cost) | ¢Int | round½↑ | – | – | No weighted-average or FIFO cost; tank level can be set arbitrarily | none | SUS |
| C-53 | Fuel report | `reports.ts:450-458` | Σ POS line `extendedCents` where `product.department = "FUEL"` (that field does not exist; the model has `departmentId`) | ¢Int | – | Disjoint from C-50's in-memory sales | – | Includes tax (C-42) | none | **WRONG** |

### A.5 Transient, ramp, concierge, dock walks

| ID | Module | Location | Formula | Inputs / units | Rounding | Duplicates | Config | Edge cases | Test | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|
| C-60 | Transient total | `apps/api/src/routes/transient.ts:28-29, 184-197` | **Taken from the client** (`rateCents`, `totalCents`); never checked against nights × rate | ¢Int | – | Widget C-63 and staff page C-64 compute their own totals | No rate table, per-foot or seasonal rates exist | Overstay (`/:id/overstay`) changes status only and adds no charge | mock-only | **WRONG** |
| C-61 | Platform application fee | `transient.ts:179`; `apps/api/src/routes/ramp.ts:183` | round(total × 0.03) | ¢Int | round½↑ | `SaasTier.cardFeeRate/achFeeRate` (2.9/0.8, 2.5/0.6, 2.0/0.4) are **unused** | **HC 3%** | **`stripeConnectedAccountId` comes from the request body** | none | **HC** (+ security) |
| C-62 | Transient availability | `transient.ts:73-95` | Conflict if `checkIn ≤ to` and `checkOut ≥ from` | Date | – | – | – | Inclusive bounds turn back-to-back stays (out 11/2, in 11/2) into conflicts | none | SUS |
| C-63 | Widget nights and weekend premium | `apps/widgets/src/transient-booking/TransientBookingWidget.tsx:61-95, 184-187, 244-252` | nights = round(Δms/86.4e6); total = nightly × nights + premium × weekendNights (Fri/Sat/Sun) | **$Float**, mock slips (75/110/160/185) | round | Disagrees with server (no server pricing) | **HC** mock rates | `new Date("2026-10-30")` parses as UTC midnight, so `getDay()` in US time zones returns **the previous weekday** (W-9). Payload (`pricing`, `guest`, `slip_a1`) does not match the API schema, and the route needs Clerk auth. | none | **WRONG** |
| C-64 | Staff transient page | `apps/web/src/pages/Transient.tsx:74, 164-178, 196-201` | nights = max(1, round(Δ/day)); total = nights × rate; default rate **85** | $Float | round | Duplicate | **HC** 85 | Local state only | none | **HC** |
| C-65 | Transient report | `reports.ts:403-414` | revenue = Σ totalCents (all statuses); avgStay = mean ceil nights | ¢Int | ceil | – | – | Cancelled stays count as revenue. A null checkOut gives NaN. | none | SUS |
| C-66 | Per-foot dockage | – | **Not implemented anywhere.** `perFootCents` exists only in the rentals zod schema and shared types. `Slip.lengthFt` and `Boat.lengthFt` are never multiplied. | – | – | – | – | Annual, seasonal and transient per-foot pricing (the standard marina model) is absent | – | **MISSING** |
| C-67 | Ramp ticket | `ramp.ts:153-205` | Client amount; set to 0 if the customer has any ACTIVE contract | ¢Int | – | Web `Ramp.tsx:164` sums the day | No ramp fee schedule | Season passes and validation have no pricing | none | SUS |
| C-68 | Concierge revenue | `reports.ts:484`; `apps/web/src/pages/Concierge.tsx:233` | Σ quoteCents of completed requests | ¢Int | – | Duplicate | – | Counts quotes, not invoiced amounts | none | SUS |
| C-69 | Dock-walk violation fee / pump-out fee | `apps/api/src/routes/dock-walks.ts:42, 72, 354, 476` | Client-supplied `feeCents`; gallons stored but never priced | ¢Int, Float gal | – | – | No fee schedule | Never invoiced (`invoiceLineId` is never set) | none | **MISSING** |

### A.6 Rentals pricing (details in review 04)

| ID | Module | Location | Formula | Inputs / units | Rounding | Duplicates | Config | Edge cases | Test | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|
| C-70 | Base by duration | `apps/api/src/routes/rentals.ts:172-192` | ≥7d: ceil(d/7) × weekly; ≥1d: ceil(d) × daily; else ceil(h) × hourly | ¢Int. **The fields used (`weeklyRateCents`, `dailyRateCents`, `hourlyRateCents`, `totalQuantity`) do not exist in Prisma** (110 TS errors in this file). | ceil | C-79, C-80, C-81 | Per product | A rental over the DST change is billed **2 days** (W-10). 7.1 days is billed as 2 weeks. | mock-only | **WRONG** |
| C-71 | Seasonal rule | `rentals.ts:200-212` | Applies if the start date's "MM-DD" string falls between seasonStart and seasonEnd | string compare | – | UI seasons: May–Sep (Sim) vs Jun–Aug (Calendar) | Per rule | A wrap-around season (Nov–Feb) never matches. Only the start date is considered. | none | **WRONG** |
| C-72 | Calendar override | `rentals.ts:221-237` | Highest **multiplier** among overlapping overrides | Float | – | Prisma `PricingCalendarOverride.priceCents` holds an **absolute price**; PricingCalendar UI treats the override as an absolute price | – | Semantics conflict | none | **WRONG** |
| C-73 | Demand surge | `rentals.ts:240-269` | utilization = overlapping CONFIRMED/CHECKED_IN ÷ totalQuantity; first tier with threshold ≤ util | Float pct | – | Schema has `availabilityThresholdPct` (availability is the inverse of utilization) | Tiers queried **tenant-wide**, not per product | – | none | SUS |
| C-74 | Rental total | `rentals.ts:272` | `round(base × rule × calendar × surge)` | ¢Int | round½↑ once | – | – | floor/ceiling, damage waiver, deposit, tax and promo codes are **not applied** | none | **WRONG** |
| C-75 | Overtime | `rentals.ts:1025-1029` | round(minutes/60 × hourly) | ¢Int | round½↑ | – | – | Per-minute here, while the base charge is ceil-hour | none | SUS |
| C-76 | Damage charge | `rentals.ts:1031` | Client amount added to totalCents | ¢Int | – | – | – | Never invoiced; no approval | none | SUS |
| C-77 | Cancellation refund | `rentals.ts:1102-1121` | refund% from the first rule where hoursUntilStart ≥ threshold; refund = round(total × pct/100) | Int pct | round½↑ | – | Per policy | No policy means 0% (silent). Not paid out. Uses totalCents after damage charges. | none | SUS |
| C-78 | Algorithmic suggestion | `apps/api/src/jobs/algorithmic-pricing.ts:86-167` | bookingRate = bookings on that weekday ÷ 13; tiered ×1.20/1.15/1.05/0.90/0.85; lead-time ×1.05/0.95; clamp to [floor, ceiling]; emit if \|Δ\|/base > 10% | ¢Int | round½↑ at each step | Simulator C-79 uses different rules | **HC** thresholds and multipliers | **A null ceiling clamps the price to $0** (W-1). Counts cancelled reservations. bookingRate ignores quantity (it can exceed 1). Duplicate suggestions every week. | none | **WRONG** |
| C-79 | Web PriceSimulator | `apps/web/src/components/PriceSimulator.tsx:41-165` | base × duration multiplier (3.5 / 6); then +40% Jul 4, +25% May–Sep, +15% weekend, surge from a **hash of the date**, −10% lead time, −15/20% multi-day, floor 0.6× / ceiling 2.5×, mock promo codes | ¢Int | round½↑ at each step (negative adjustments round toward +∞) | Disagrees with C-70 to C-78 | **HC** everything | Presented as the "what the customer pays" explanation, but it is fiction | none | **HC** |
| C-80 | Web PricingCalendar | `apps/web/src/components/PricingCalendar.tsx:40-90, 185-215` | +25% **Jun–Aug**, +15% weekend, +10% surge on mock dates; override = absolute price | ¢Int | round½↑ at each step | Disagrees with C-79 (season months) and C-72 | **HC** | – | none | **HC** |
| C-81 | Rental widget | `apps/widgets/src/rental-booking/RentalBookingWidget.tsx:197-201, 231-240` | hourly × hours, or a flat daily rate | **$Float** mock | – | Sends `totalPrice` and `promoCode`, which the API ignores | **HC** | Claims "Price locked for 15 minutes", which is not implemented | none | **HC** |
| C-82 | Promo codes | `PromoCode` model; `reports.ts:428` | **Never applied server-side**; `usedCount` is never incremented | Float discountValue | – | Simulator mock promos | – | – | none | **MISSING** |

### A.7 Inventory

| ID | Module | Location | Formula | Inputs / units | Rounding | Duplicates | Config | Edge cases | Test | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|
| C-90 | Inventory valuation | `apps/api/src/routes/inventory.ts:680-725` | Σ qoh × **current** costCents (labelled "FIFO"); margin = (price − cost)/price | ¢Int | round to 0.01% | `reports.ts:370-381`, `apps/web/src/pages/Inventory.tsx:355, 548-550`. **The inventory route uses its own in-memory product store**, separate from the Prisma `Product`/`Inventory` tables that POS decrements. | – | Not FIFO and not weighted-average. Two stock ledgers. | none | **WRONG** |
| C-91 | Reorder alerts | `inventory.ts:729-745`; `reports.ts:375-376` | qoh ≤ reorderPoint (in-memory) vs qoh ≤ **reorderQty** (Prisma; null coerces to 0) | Int | – | They disagree | – | – | none | SUS |
| C-92 | Count variance | `inventory.ts:429` | actual − expected | Int | – | – | – | – | none | OK |
| C-93 | PO total / receive | `inventory.ts:517-519, 592` | Σ qty × unitCost; receive is capped at the outstanding qty | ¢Int | – | – | – | Receiving does not update unit cost | none | OK (in-memory) |

### A.8 Reports, KPIs, dashboards

| ID | Module | Location | Formula | Units | Rounding | Duplicates | Edge cases | Test | Verdict |
|---|---|---|---|---|---|---|---|---|---|
| C-100 | Occupancy % | `reports.ts:24-61`; `reports.ts:884` | OCCUPIED ÷ all slips (MAINTENANCE included), from **current status** | toFixed(1) **string** | – | Groups by `dock` (the field is `dockId`). Point-in-time count, not slip-nights or linear feet. | mock-only | SUS |
| C-101 | Revenue | `reports.ts:65-96` | Σ COMPLETED payments in range; "invoiced" = Σ totals (VOID included) | ¢Int | – | Partially refunded payments are **excluded entirely**. Pending ACH is excluded. An endDate given as a date-only string is midnight UTC, so the last day is dropped. | mock-only | SUS |
| C-102 | AR aging | `reports.ts:100-119`; web `apps/web/src/pages/ARaging.tsx` (mock) | floor(days since due): ≤0 current, 1–30, 31–60, 61–90, ">90" labelled `days120plus` | ¢Int | floor | Excludes `COLLECTIONS`. UTC-based. Bucket label is wrong. | mock-only | SUS |
| C-103 | Collections recovery rate | `reports.ts:130-135` | recovered ÷ handoff | string | toFixed | – | none | OK |
| C-104 | Deferred revenue summary | `reports.ts:141-150` | Σ total, Σ recognized | ¢Int | – | Inherits C-20 | none | SUS |
| C-105 | Lead conversion rate | `apps/api/src/routes/leads.ts:165-171` vs `reports.ts:215` | won ÷ (won + lost) vs won ÷ all leads | % | 2dp vs 1dp | **Two definitions of one KPI** | mock-only | SUS |
| C-106 | Days to convert | `leads.ts:174-188` | mean(convertedAt − createdAt) | days | 1dp | – | none | OK |
| C-110 | "NPS" | `reports.ts:418-430` | **mean score**, labelled `avgNpsScore`; promoters ≥ 9, detractors ≤ 6 | – | 1dp | NPS = %promoters − %detractors (W-11) | none | **WRONG** |
| C-111 | Pricing suggestion acceptance | `reports.ts:436-444` | Counts `APPROVED/IGNORED`, but the route writes `ACCEPTED/REJECTED`, so the rate is always 0% | – | – | – | none | **WRONG** |
| C-112 | P&L | `reports.ts:597-608` | revenue = Cr − Dr (REVENUE accounts); COGS from type `"COGS"` (**not in the enum**, so the query errors) | ¢Int | – | Revenue includes sales tax (C-30) | none | **WRONG** |
| C-113 | Trial balance | `reports.ts:625-632` | Σ debits, Σ credits | ¢Int | – | Unbalanced because of C-25 | none | OK (calc) |
| C-114 | Rent roll annualization | `reports.ts:776-789` | MONTHLY ×12; QUARTERLY ×4 then ÷12; ANNUAL ÷12; **SEMI_ANNUAL missing, so annual = 0** | ¢Int | round½↑ | Contradicts C-01's billing semantics | none | **WRONG** |
| C-115 | Expiring contracts | `reports.ts:662-668` | Σ rateCents per month | ¢Int | – | Mixes cycles. A null endDate throws on `toISOString`. | none | SUS |
| C-116 | Customer LTV | `reports.ts:684-690` | Σ COMPLETED payments ÷ customers; tenure = ceil(days/30) | ¢Int | round | Refunds are not netted | none | SUS |
| C-117 | Misc ratios (chargeback win rate, announcement open rate, dock-walk completion, vacancy) | `reports.ts:299, 537, 551, 656` | simple ratios | strings | toFixed(1) | – | none | OK |
| C-118 | Web dashboard KPIs | `apps/web/src/pages/Dashboard.tsx:44-47, 284-308` | Reads `occupancyData.rate`, `revenueApiData.total`, `arData.total`. **The API returns `summary.occupancyRate`, `revenue.totalCents` and `totalOutstanding`**, so the page **always shows mock values**. The revenue chart is hard-coded. | – | – | Customer-facing numbers are fake | none | **WRONG** |
| C-119 | Portfolio dashboard / admin dashboards / admin analytics / admin billing | `apps/web/src/pages/PortfolioDashboard.tsx:93-104`; `apps/admin/src/pages/Dashboard.tsx`, `Analytics.tsx`, `Billing.tsx` | Sums and ratios over **hard-coded mock arrays** | – | – | – | none | **HC** |
| C-120 | Compliance days-to-expiry and score | `apps/api/src/services/compliance.ts:166-190, 221-301` | ceil(Δ/day); categorical score | – | ceil | – | unit | OK |

### A.9 Platform / SaaS

| ID | Module | Location | Formula | Units | Verdict | Notes |
|---|---|---|---|---|---|---|
| C-130 | MRR / ARR / ARPU | `apps/api/src/routes/admin.ts:420-431, 111, 754` | Σ tier.monthlyFeeCents over ACTIVE tenants; ARR = 12 × MRR; ARPU = MRR ÷ active | ¢Int | SUS | Ignores `perLocationFeeCents` and transaction-fee revenue. GRACE_PERIOD tenants are excluded from MRR. |
| C-131 | "Churn rate" | `admin.ts:429` | LOCKED ÷ total tenants, all time | ratio | **WRONG** | Not churn (that needs a period and cancellations) |
| C-132 | SaaS invoice generation | `admin.ts:458-555` | amount = monthlyFeeCents; stored in an **in-memory array** | ¢Int | **WRONG** | Lost on restart, duplicated across instances, per-location fee ignored, no proration for mid-month signups |
| C-133 | Platform GMV | `admin.ts:640-674` | Σ COMPLETED payments + POS where `status:"completed"` (**never matches**: POS status holds the payment method) + all transient (cancelled included) + all ramp | ¢Int | **WRONG** | |
| C-134 | Tenant health score | `admin.ts:736-742` | additive points 30/10/15/25/15/15 | Int | **HC** | |
| C-135 | Card/ACH platform fee on invoice payments | `payments.ts:313-336`; `billing.ts:287-305` | **None.** No `application_fee_amount` on invoice charges. | – | **MISSING** | Tier `cardFeeRate/achFeeRate` are never used. The platform earns nothing on its main payment flow. |
| C-136 | Tenant grace / lock | `apps/api/src/jobs/tenant-lifecycle.ts:46-145` | Tenant → GRACE_PERIOD if **any of the marina's own customer invoices** is PAST_DUE for more than 1 day; LOCKED after 30 days | – | **WRONG** (latent) | Dormant only because nothing sets PAST_DUE. The day overdue-marking is built, a marina with one late boater gets locked out. |

### A.10 Cross-cutting numeric facts (verified in Node)

- `Math.round(parseFloat("1.005")*100) = 100` (expected 101) and `Math.round(parseFloat("10.075")*100) = 1007` (expected 1008). Every dollar-input form uses this pattern: `InvoiceForm.tsx:317`, `Contracts.tsx:395-396`, `CustomerDetail.tsx:574`, `Inventory.tsx:192-193`, `PaymentModal.tsx:119`. **WRONG by 1¢ on specific inputs.**
- `Math.round(-2.5) = -2`, so rounding of negative adjustments (discounts, refunds, PriceSimulator) is asymmetric.
- `150 × 0.07 = 10.500000000000002`, so float noise decides ties. The code has no explicit half-up or banker's policy.
- `Math.min(null, 12000) = 0`, which is the root cause of W-1.
- The schema mixes types: money is `Int` cents (good), but `quantity`, `taxRate`, `discountValue`, `earlyTerminationValue`, `rateIncreaseValue`, `multiplier`, `consumedKwh` and `gallons` are `Float`. **No `Decimal` is used anywhere.**
- `apps/api` has **444 TypeScript errors** (`tsc --noEmit`), mostly schema drift: rentals.ts 110, reports.ts 40, customers.ts 34, pos.ts 26, and others. All route tests mock Prisma, so none of this is caught.

### A.11 Worked examples for "Wrong" verdicts

- **W-1 Algorithmic $0 price (C-78).** Product: base 12,000¢, floorPriceCents = null, ceilingPriceCents = null. The step produces suggested = 13,800. Clamp: `Math.min(null, 13800)` → `Math.min(0, 13800)` = **0**, then `Math.max(null, 0)` = **0**. diff = \|0 − 12,000\| / 12,000 = 1.0 > 0.10, so a **$0.00 suggestion is persisted for every one of the next 30 days**. Accepting one sets the price to 0.
- **W-2 Proration disagreement (C-02 vs C-03), server TZ America/New_York.** Rate $1,000 (100,000¢), start 2026-03-05. C-03: remaining days = 31 − 5 + 1 = 27, so 100,000/31 × 27 = **87,097¢**. C-02: end = Mar 31 00:00 EDT, start = Mar 5 00:00 EST, Δ = 25 days 23 h, floor = 25, +1 = 26, so **83,871¢**. They differ by **$32.26**. With a UTC server both give 87,097, so the result depends on deployment TZ.
- **W-3 Anchor 31 (C-04).** A contract starting Jan 31 defaults to `billingAnchor = 31`. In November `today.getDate()` never exceeds 30, so `31 ≤ day` is always false and **no November invoice is generated**. Same for Feb, Apr, Jun and Sep. Anchor 29 or 30 skips February.
- **W-4 Credit loss (C-13).** Customer has a $100 unapplied credit and a new $60 invoice. applyAmount = 60. The **whole $100 payment** is linked to the invoice, and the invoice is set to PAID. The credits query (`invoiceId: null`) now returns $0. **$40 of customer money disappears** from the sub-ledger.
- **W-5 Over-refund (C-15).** Payment $100. Refund $60 passes ($60 ≤ $100) and status becomes PARTIALLY_REFUNDED. Refund $60 again passes the same check. Total refunded is **$120 on a $100 payment**. Stripe will reject the second refund, but the local GL and invoice have already been reversed twice when the check is done locally first. Here the Stripe call is made before the transaction, so the outcome depends on Stripe.
- **W-6 Deferred 13 months (C-20, C-22).** Invoice issued 2026-01-15, so start = 2026-01-15 and end = 2027-01-14. months = (2027 − 2026) × 12 + (0 − 0) + 1 = **13**. An annual $1,200 + 7% tax ($84) line gives total 128,400¢ (tax included), and per month = floor(128,400/13) = 9,876¢ for 13 months. Correct treatment: 12 × 10,000¢ revenue, with 8,400¢ booked to Sales Tax Payable on day 1.
- **W-7 Shift variance (C-44).** Float $100. One cash sale of $50; then 1 of its 2 items ($25) is refunded in cash. The drawer holds $125. The code marks the original "REFUNDED", so it is excluded from the CASH sum, and the refund row has status "REFUNDED", so it is also excluded. expected = $100, variance = **+$25**, a false overage.
- **W-8 Daily report double subtraction (C-45).** One $100 sale, fully refunded the same day. Rows: original (status REFUNDED, +10,000) and refund (status REFUNDED, −10,000). sales = [] so totalSales = 0. refunds = both rows, so totalRefunds = 10,000 + 10,000 = 20,000. **net = −$200** (correct: $0).
- **W-9 Widget weekday shift (C-63).** In a browser in America/New_York, `new Date("2026-10-30")` (a Friday) is Thu 29 Oct 20:00 local, so `getDay() = 4` and Friday night is **not** counted as a weekend night. `new Date("2026-11-02")` (Monday) has `getDay() = 0` (Sunday) and **is** counted.
- **W-10 DST rental (C-70).** Daily rental Sat 2026-10-31 09:00 EDT → Sun 2026-11-01 09:00 EST. Δ = 25 h, durationDays = 1.0417, ceil = **2 days** charged for one calendar day.
- **W-11 NPS (C-110).** Ten responses: five 10s, two 8s, three 3s. Code: mean = (50 + 16 + 9)/10 = **7.5**. True NPS = 50% − 30% = **+20**.
- **C-01 overbilling.** A quarterly contract has rateCents = 300,000 ($3,000/quarter, which is how the rent roll interprets it). `generateRecurringInvoices` bills 300,000 each month, so **$9,000 per quarter instead of $3,000**.

---

## Part A — Findings (prioritized)

**F-1 (P0) Billing engine is dead code and semantically wrong.** Nothing schedules recurring invoicing or deferred recognition. When it runs, cycle semantics are wrong (C-01), anchors 29–31 skip months (C-04), and deferral is a no-op (C-21).
**F-2 (P0) GL integrity.** Tax is booked as revenue (C-30). Three conflicting account maps (C-31). Single-sided termination entry (C-25). Fee, QBO and credit changes have no GL (C-16, C-35, C-13). Deferred revenue includes tax and miscounts months (C-20). QBO push sends NaN amounts (C-34).
**F-3 (P0) Server trusts client-computed money.**
- Transient total (C-60).
- POS unit price (C-40).
- Ramp amount (C-67).
- Damage charges (C-76).
- Dock-walk and pump-out fees (C-69).
- Penalty override (C-25).
- Stripe connected account from the request body (C-61).
- In the other direction, the web InvoiceForm and POS cart **compute totals the server never receives** (C-10, C-46), so users see numbers the system never records.

**F-4 (P0) Tax configuration is not wired.** The setting is stored under the wrong key and in the wrong unit (C-07). POS uses 7% (C-41). Fuel has no tax or excise (C-50). Tax is calculated on the post-discount amount on invoices but on the client price in POS.
**F-5 (P1) Refund, credit and cash math is wrong.** C-13, C-15, C-43, C-44, C-45.
**F-6 (P1) Pricing is fragmented.** Five rental engines (C-70 to C-81). No per-foot dockage (C-66). Promo codes are never applied (C-82). Algorithmic pricing can emit $0 (C-78).
**F-7 (P1) Customer-facing KPIs are fake or mislabelled.** Dashboard always shows mock data (C-118). NPS (C-110), churn (C-131), GMV (C-133), acceptance rate (C-111) and P&L (C-112) are all wrong.
**F-8 (P1) Hard-coded commercial terms.** 7% tax, 3% platform fee, $25 ACH fee, Net-30, 12-month deferral, 1-year renewal term, 50 gal/day, fuel prices (cross-tenant), and pricing percentages in the UIs.
**F-9 (P1) Time handling.** All date math uses server-local time (`new Date()`, `setHours`, `getDate`), never `tenant.timezone` or `location.timezone`, even though both columns exist. Includes DST (W-2, W-10), UTC-parse weekday shift (W-9) and date-only endDate filters.
**F-10 (P2) Number types.** Float for quantity and rates. Dollars-as-float in every frontend. The `parseFloat × 100` 1¢ errors. No Decimal anywhere. No explicit rounding policy.
**F-11 (P2) Test coverage.** No tests for proration, tax, deferral, refunds, aging, pricing, renewal math or POS reports. Existing tests mock Prisma, so 444 type errors and schema drift go undetected.

---

## Part B — Audit Logging Assessment

### B.1 Current implementation

- **Model** (`apps/api/prisma/schema.prisma:823-838`):

  ```
  AuditLog { id, tenantId, userId?, userName?, recordType, recordId, action (free text),
             changedFieldsJson Json?, ipAddress?, createdAt }   @@index([tenantId]) @@index([recordType, recordId])
  ```

  The model has no actor type, impersonator, location, request or correlation ID, user agent, reason or reason code, before/after separation, hash, sequence or schema version. There is no index on `(tenantId, createdAt)` or `userId`.
- **Writers:** 23 files call `prisma.auditLog.create` directly, with hand-written payloads. There is no shared helper; `qbo-sync.ts:50` has a private one. Action verbs are inconsistent (`CREATED`/`CREATE`, `UPDATED`, `REFUNDED`, `BULK_RENEWED`, `ESIGN_SENT`, `QBO_WEBHOOK_*`, ...).
- **Write-path reliability:**
  - Most writes happen **after** the business transaction commits, outside it (invoices, payments, POS, rentals). A crash between the two leaves the mutation with no audit row.
  - qbo-sync swallows audit failures.
  - A few writes are inside the transaction (contract terminate and renew, renewal-engine, ach-handler, customer-merge, waitlist accept), which is correct.
- **IP / user agent:** `ipAddress` is **never populated anywhere** (grep finds only the CSV header). No user agent.
- **Before/after:**
  - **Present** (`{field:{from,to}}`) in contracts PUT, slips PUT, customers PUT, boats PUT, POS product PUT and leads PUT.
  - **Absent** from rental product and pricing-rule updates (`rentals.ts:400-409, 508-517` log `UPDATED` with **no payload**, even though these are price changes), dock-walk PUT (after only) and waitlist PUT (after only).
  - Invoice, payment and POS entries log selected fields only.
- **Reasons:** captured ad hoc only for payment refunds (`reason`, optional), POS refunds, contract termination and shift close notes. There are no reason codes.
- **Tamper evidence:** none. The app's DB role can `UPDATE/DELETE audit_logs`. There is no hash chain and no WORM export. `customer-merge.ts` even **reads audit rows back to drive undo logic**, so the log is used as application state.
- **Tenant scoping:** AuditLog is in the `$extends` tenant-scope list (`apps/api/src/lib/prisma.ts:17-56`), which is good. Jobs with no tenant context write `userId: "system"` with no other actor detail.
- **Retention:** no policy and no purge or archive job.
- **Read API** (`apps/api/src/routes/audit-log.ts`): list, filter (user, recordType, recordId, action, date), per-record, per-user, CSV export capped at 10,000 rows.
  - **Production-broken:** `requireRole("admin","manager")` while stored roles are `MARINA_OWNER/MARINA_MANAGER/...`, so every request is 403. In dev, the first user's real role (e.g. MARINA_OWNER) is also rejected.
  - The user lookup uses `where: { tenant_id }` (TS2561), so the list endpoint throws at runtime whenever any entry has a userId.
  - There is no full-text search across `changedFieldsJson`.
  - The export endpoint is itself **not audited**.
- **UI** (`apps/web/src/pages/AuditLog.tsx`):
  - Expects an **array** of `{timestamp, description, changedFields:string, ipAddress}`. The API returns `{data, pagination}` with different field names, so it crashes on success.
  - **On failure (always, see above) it renders 15 hard-coded fake entries**, including fake IP addresses and a real-looking user name. That presents fabricated audit history as genuine.
  - Filters run client-side on that one page. "Export CSV" has no handler. There is no per-record history tab elsewhere, except `customers.ts:450` timeline, which reads audit rows for one customer.

### B.2 Coverage matrix: every mutating endpoint

Legend: **A** = audit row written (✓ / ✗). **D** = before/after diff (✓ full, ~ partial, ✗). **R** = reason captured. **$** = money-affecting. IP and user agent are ✗ for every row and are not repeated. Actor = `req.userId` + `userName` (email) where ✓.

| Route file | Endpoint | A | D | R | $ | Notes |
|---|---|---|---|---|---|---|
| admin.ts | POST /queues/pause, /queues/unpause | ✗ | – | ✗ | | Platform-wide action, unaudited |
| admin.ts | POST /tenants | ✗ | – | ✗ | | |
| admin.ts | PUT /tenants/:id | ✗ | ✗ | ✗ | $ | Tier change alters billing |
| admin.ts | **POST /tenants/:id/impersonate** | ✗ | – | ✗ | | **Impersonation is unaudited.** HMAC token with a default secret `"helm-impersonation-dev-key"`; no consumer validates it. |
| admin.ts | POST /tenants/:id/lock, /unlock | ✗ | – | ✗ | $ | |
| admin.ts | POST /billing/invoices/generate | ✗ | – | – | $ | In-memory |
| admin.ts | **PUT /billing/tiers/:id** | ✗ | ✗ | ✗ | $ | SaaS price and fee-rate change, unaudited |
| admin.ts | PUT /support/tickets/:id; POST/PUT/DELETE /tenants/:id/locations | ✗ | ✗ | ✗ | | |
| announcements.ts | POST /, PUT /:id, DELETE /:id, POST /:id/send, POST /:id/duplicate | ✓ | ~ | ✗ | | |
| auth.ts | POST /webhook (Clerk), **POST /sync-session (login)**, **POST /switch-tenant** | ✗ | – | – | | **No login, logout or failed-login trail**; tenant switching unaudited |
| boats.ts | POST /, PUT /:id, DELETE /:id, POST /:id/safety-inspection | ✓ | ✓ (PUT) | ✗ | | |
| communication-prefs.ts | PUT /:customerId | ✗ | ✗ | ✗ | | Consent changes (TCPA/CAN-SPAM evidence) unaudited |
| concierge.ts | POST /requests, PUT /requests/:id, **PUT /requests/:id/quote**, **/approve**, /complete, POST/PUT /vendors | ✗ | ✗ | ✗ | $ | Quote amount and approval unaudited |
| contracts.ts | POST / | ✓ | ~ | ✗ | $ | |
| contracts.ts | **PUT /:id** (rate change) | ✓ | ✓ | ✗ | $ | Rate changed with no reason or approval |
| contracts.ts | **POST /:id/terminate** | ✓ (in tx) | ~ | ✓ | $ | Penalty override not distinguished from the computed value |
| contracts.ts | POST /:id/renew | ✓ (in tx) | ✓ rate | ✗ | $ | |
| contracts.ts | POST /:id/send-for-signature, /bulk-send-for-signature, /esign-webhook | ✓ | – | – | | |
| customers.ts | POST /, PUT /:id, DELETE /:id | ✓ | ✓ (PUT) | ✗ | | Tax-exempt flag change captured via diff only |
| customers.ts | POST /:id/merge, /:id/undo-merge | ✓ (service, in tx) | ✓ | ✗ | $ | Moves invoices and payments between customers |
| dock-walks.ts | POST /, PUT /:id, POST /:id/complete, POST /pump-outs | ✓ | ~ | ✗ | $ (fees) | |
| dock-walks.ts | POST /:id/items, **PUT /:id/items/:itemId** | ✗ | ✗ | ✗ | $ | Violation fee set or changed, unaudited |
| email-automation.ts | rules and templates POST/PUT/DELETE | ✓ | ~ | ✗ | | |
| email-automation.ts | POST /templates/:id/preview | ✗ | – | – | | (read-like) |
| **fuel.ts** | **PUT /types/:id/price** | ✗ | ✗ | ✗ | $ | **Fuel price change unaudited (and cross-tenant)** |
| fuel.ts | POST /sales, POST /deliveries | ✗ | – | – | $ | |
| insurance.ts | POST /upload | ✓ (insurance-ai service) | – | – | | |
| insurance.ts | PUT /:id/review | ✓ | ~ | ✗ | | |
| inventory.ts | products POST/PUT/DELETE; **POST /adjustments**; counts POST/complete; purchase-orders POST/receive/cancel; POST /labels | ✗ (all 11) | ✗ | ✗ | $ | **Stock write-offs and adjustments unaudited** (shrink control) |
| invoices.ts | POST / | ✓ | ~ (total only) | ✗ | $ | |
| invoices.ts | **PUT /:id** (draft line and price edits) | ✗ | ✗ | ✗ | $ | **Line items replaced wholesale, unaudited** |
| invoices.ts | POST /:id/finalize, **POST /:id/void**, POST /:id/send | ✓ | ~ | **✗ (void)** | $ | Void with no reason |
| lead-forms.ts | authed POST/PUT/DELETE; public POST /:embedKey/submit | ✗ | ✗ | ✗ | | |
| leads.ts | POST /, PUT /:id, PUT /:id/stage, DELETE /:id, POST /:id/convert | ✓ | ✓/~ | ✗ | | |
| onboarding.ts | POST /start, /:tenantId/branding, **/stripe**, **/qbo**, **/chart-of-accounts** | ✗ | ✗ | ✗ | $ | Payment and GL setup unaudited; unauthenticated tenantId path |
| payments.ts | **POST /** (manual cash/check/charge-to-slip) | ✓ | ~ | ✗ | $ | No reason or reference for manual payments |
| payments.ts | **POST /:id/refund** | ✓ | ~ | ✓ (optional) | $ | |
| pos.ts | products POST/PUT/DELETE | ✓ | ✓ (PUT) | ✗ | $ | |
| pos.ts | POST /transactions | ✓ | ~ | ✗ | $ | **Client price overrides and discounts not flagged** |
| pos.ts | POST /transactions/:id/refund | ✓ | ~ | ✓ (optional) | $ | |
| pos.ts | PUT /inventory/:productId | ✓ | ✓ | ✓ (optional) | $ | |
| pos.ts | POST /shifts/open, /shifts/:id/close | ✓ | ✓ (variance) | notes | $ | |
| qbo.ts | POST /sync, /sync/customer/:id, /sync/invoice/:id, /disconnect, /webhook | ✗ (route) / ✓ (service, as "system") | ✗ | ✗ | $ | Inbound balance overwrite logged only as a system row |
| ramp.ts | POST /tickets, /passes/validate | ✗ | – | – | $ | |
| rentals.ts | products POST/PUT; **POST /products/:id/pricing; PUT /pricing/:ruleId; POST calendar-overrides** | ✓ | **✗ (no payload)** | ✗ | $ | **Price changes logged with no values** |
| rentals.ts | reservations POST (breakdown ✓), PUT, check-in, check-out, cancel | ✓ | ~ | cancel: ✗ | $ | Damage charge has no approver |
| rentals.ts | PUT /pricing/suggestions/:id; POST /cancellation-policies | ✓ | ✓ (rates) | ✗ | $ | |
| settings.ts | PUT /marina, /branding, **/billing (tax, late fee, terms)**, /notifications | ✗ | ✗ | ✗ | $ | **Tax-rate and fee changes unaudited** |
| settings.ts | POST /stripe/connect, **/stripe/disconnect**, /qbo/connect, /qbo/disconnect, /qbo/sync | ✗ | – | ✗ | $ | Payout account change unaudited (fraud vector) |
| settings.ts | POST /team/invite, **PUT /team/:userId/role**, **DELETE /team/:userId** | ✗ | ✗ | ✗ | | **Permission changes unaudited** |
| slips.ts | POST /, PUT /:id (flat fee and kWh rate diff ✓), DELETE /:id, POST /:id/qr-code | ✓ | ✓ | ✗ | $ | |
| storage.ts | POST /presign-upload, DELETE /* | ✗ | – | – | | Document deletion unaudited |
| tenants.ts | POST /, PUT /:id, POST /:id/stripe/connect, /:id/qbo/connect | ✗ | ✗ | ✗ | $ | |
| transient.ts | POST / (client total), check-in, check-out, overstay, DELETE (cancel) | ✗ (all 5) | ✗ | ✗ | $ | **Entire transient module unaudited** |
| waitlist.ts | POST /, PUT /:id (after only), DELETE, notify-next, accept, expire | ✓ | ~ | ✗ | | |
| **Exports** | GET /api/audit-log/export; all /api/reports/*; BI API key reads | ✗ | – | – | | **No export or data-access logging** |
| **Background jobs** | billing (not wired), deferred (not wired), algorithmic pricing, renewal auto-batch, tenant lifecycle (lock, user deactivation) | renewal ✓ (userId "system:auto-renew"); others ✗ | – | – | $ | **Tenant lock and user deactivation by job unaudited** |

**Totals:** 155 mutating endpoints. **74 audited (48%)**, 81 unaudited. Of the money-affecting set, the unaudited include: fuel price, SaaS tier price, billing and tax settings, draft-invoice edits, inventory adjustments and write-offs, all of transient, ramp, concierge quotes, dock-walk fees, QBO sync and Stripe account changes. Required enterprise events with **zero** coverage: logins and failed logins, impersonation, role and permission changes, exports and report access, API-key use, payout-account changes, and tenant lock/unlock.

### B.3 Client-trust flags (frontend computes, backend never re-verifies)

| Flow | What the client decides | Server behavior |
|---|---|---|
| Transient booking (staff and widget) | `rateCents`, `totalCents`, Stripe connected account | Stored and charged as sent (`transient.ts:28-31, 174-197`) |
| POS sale | `unitPriceCents` per line, `discountCents`, `tipCents` | Used verbatim; catalog price ignored (`pos.ts:367`) |
| Ramp ticket | `amountCents`, Stripe account | Verbatim (`ramp.ts:19, 178-196`) |
| Rental check-out | `overtimeMinutes`, `damageChargeCents` | Verbatim, added to total |
| Dock-walk item / pump-out | `feeCents` | Verbatim |
| Contract terminate | `penaltyOverrideCents`, `glAccountId` | Verbatim, posted to GL |
| Contract create / PUT | `rateCents` (no rate card or per-foot check) | Verbatim |
| Web InvoiceForm, POS cart, Fuel, Transient pages | Full totals in $Float | Shown to the user; never sent, or sent in a shape the API rejects, so displayed totals ≠ stored totals |
| Widgets | `pricing`, `totalPrice`, `promoCode` | Payload rejected or ignored; customers see a price the server never computes |

---

## Part C — Target Design

### C.1 Event schema (`audit_events`)

```prisma
model AuditEvent {
  id              String   @id @default(uuid())      // UUIDv7 preferred (time-ordered)
  seq             BigInt                              // per-tenant monotonic sequence (gap = tamper signal)
  tenantId        String?                             // null only for platform-scope events
  locationId      String?
  occurredAt      DateTime @db.Timestamptz(6)         // when it happened (app clock)
  recordedAt      DateTime @default(now()) @db.Timestamptz(6)

  // ── Actor ──
  actorType       AuditActorType                      // USER | PORTAL_CUSTOMER | PLATFORM_ADMIN | IMPERSONATOR | API_KEY | SYSTEM_JOB | WEBHOOK | ANONYMOUS
  actorId         String?                             // user id / api key id / job name / webhook source
  actorDisplay    String?                             // email or label, denormalized at write time
  actorRole       String?
  impersonatorId  String?                             // platform admin acting as actorId
  impersonationSessionId String?

  // ── What ──
  action          String                              // dotted taxonomy: "invoice.void", "payment.refund", "pricing_rule.update"
  category        AuditCategory                       // AUTH | ACCESS | DATA_CHANGE | MONEY | CONFIG | PERMISSION | EXPORT | INTEGRATION | SYSTEM
  severity        AuditSeverity                       // INFO | NOTICE | SENSITIVE | CRITICAL
  resourceType    String                              // "Invoice"
  resourceId      String
  parentType      String?                             // e.g. Customer for an Invoice (enables per-customer history)
  parentId        String?

  // ── Change ──
  before          Json?                               // redacted snapshot of changed fields only
  after           Json?
  diff            Json?                               // RFC 6902 JSON Patch (before → after)
  amountCents     BigInt?                             // signed money impact, for MONEY events (indexable)
  currency        String?  @db.Char(3)
  reasonCode      String?                             // controlled vocabulary per action (e.g. VOID_DUPLICATE, REFUND_WEATHER, PRICE_MATCH)
  reasonText      String?
  approvalId      String?                             // dual-control approval record, if required

  // ── Context ──
  requestId       String?                             // X-Request-Id, propagated to logs/Sentry
  correlationId   String?                             // ties job → child events, webhook → effects
  ipAddress       String?  @db.Inet
  userAgent       String?
  origin          String?                             // web | portal | admin | widget | api | job | webhook
  schemaVersion   Int      @default(1)

  // ── Integrity ──
  prevHash        String?  @db.Char(64)
  hash            String   @db.Char(64)               // SHA-256(canonical_json(event_without_hash) || prevHash)

  @@unique([tenantId, seq])
  @@index([tenantId, occurredAt(sort: Desc)])
  @@index([tenantId, resourceType, resourceId, occurredAt])
  @@index([tenantId, parentType, parentId, occurredAt])
  @@index([tenantId, actorId, occurredAt])
  @@index([tenantId, action, occurredAt])
  @@map("audit_events")
}
```

**Action taxonomy:** `<resource>.<verb>` with a closed verb set:
- `create`, `update`, `delete`, `restore`, `status_change`, `void`, `refund`, `write_off`, `adjust`;
- `override` (price, discount, penalty), `approve`, `reject`, `post` (GL), `reverse`;
- `export`, `view_sensitive`, `login`, `login_failed`, `logout`, `mfa`;
- `impersonate_start`, `impersonate_end`, `role_change`, `key_create`, `key_revoke`, `connect`, `disconnect`, `sync`, `job_run`.

The action registry lives in `packages/shared-types/src/audit.ts`, with severity and whether a reason code or approval is required.

### C.2 Capture approach (hybrid)

1. **Request context (middleware).** An `AsyncLocalStorage` `auditContext` holds `{requestId, tenantId, locationId, actor*, impersonator*, ip, ua, origin}`. It extends the existing `tenantStore` and is set in `tenantMiddleware` and `clerkAuth`. Use `req.ip` with `trust proxy` set correctly behind nginx. Jobs and webhooks set `actorType=SYSTEM_JOB/WEBHOOK`, `actorId=<job name / Stripe event id>` and a `correlationId`.
2. **Automatic data-change capture (Prisma `$extends`).** Wrap `create/update/upsert/delete/*Many` on an allow-list of models. For single-row updates, read the row before writing (`findUnique` inside the same tx), compute a field-level diff, and redact per a model field policy (PII and secrets hashed or masked). Emit `<model>.create|update|delete` at INFO severity. `*Many` operations emit one summary event with a where-clause hash and count. This guarantees **no silent mutation**, including the 81 endpoints that write nothing today.
3. **Explicit domain events (service calls)** for meaning that a row diff cannot express: `invoice.void` (reason), `payment.refund`, `pos.price_override`, `discount.apply`, `contract.terminate` (penalty computed vs overridden), `pricing_rule.update`, `tax_rate.change`, `gl.manual_entry`, `export.run`, `auth.login`, `impersonate_start`, `role_change`, `stripe.payout_account_change`. Call `audit.record(action, {resource, before, after, amountCents, reasonCode, approvalId})`, which enforces the registry (for example, `invoice.void` without a `reasonCode` → 400).
4. **Transactional outbox.** Audit rows are written **inside the same DB transaction** as the business change. Pass `tx` everywhere and make the helper accept a `tx`. An outbox table then streams to the SIEM. If the audit insert fails, the business transaction fails.
5. **Deduplication.** If an explicit domain event exists for the same `(requestId, resourceType, resourceId)`, the `$extends` event for that row is linked (`correlationId`) rather than duplicated, or is suppressed at INFO level.

### C.3 Tamper evidence and storage

- **Append-only at the DB level.** A dedicated Postgres role `helm_app` gets `INSERT, SELECT` only on `audit_events`, plus a `BEFORE UPDATE OR DELETE` trigger that `RAISE EXCEPTION`s. Migrations run as a separate owner role.
- **Hash chain per tenant.** `seq` comes from a per-tenant counter row (`SELECT ... FOR UPDATE`, or an advisory lock keyed on tenantId). `hash = sha256(canonicalJSON(event fields) ‖ prevHash)`.
- **Anchoring.** A nightly job computes a Merkle root per tenant per day and writes it to an `audit_anchors` table **and** to external WORM storage (S3/R2 Object Lock, compliance mode). Optionally anchor to an RFC 3161 timestamp authority.
- **Verification.** Admin endpoint `GET /api/audit/verify?from&to` recomputes the chain and reports breaks or gaps. A weekly job verifies automatically and alerts on mismatch.
- **Separation.** Stop using audit rows as application state. Customer-merge undo needs its own `merge_operations` table.

### C.4 Retention

| Class | Hot (Postgres, searchable) | Warm (Parquet in object storage, queryable) | Total | Basis |
|---|---|---|---|---|
| MONEY, GL, tax, payments, refunds, voids, pricing | 24 months | to 7 years | **7 years** | IRS/SOX-style record retention, card-network dispute windows |
| AUTH, PERMISSION, IMPERSONATION, EXPORT | 13 months | to 3 years | 3 years | SOC 2 / PCI DSS 10.7 (≥ 1 yr, 3 mo immediately available) |
| General DATA_CHANGE | 13 months | to 3 years | 3 years | |
| Tenant offboarding | Retain per class; tenant can export everything; PII fields crypto-shredded on erasure request while hashes stay valid (hash covers the ciphertext) | | | GDPR/CCPA |

Use monthly partitioning (`occurredAt`) so the archive job is a partition detach plus export, never a `DELETE`. Per-tenant overrides apply to the enterprise tier only.

### C.5 UI

- **Per-record "History" tab** on Invoice, Payment, Contract, Customer, Slip, Reservation, Product and GL journal. Shows a timeline with actor (and an "as impersonated by" badge), field-level diff rendered as before → after, money impact, reason and request ID link. It is driven by `parentType/parentId`, so the Customer tab includes child invoices and payments.
- **Global audit search** (`/audit`): server-side filters (date range, actor, actor type, action prefix, category, severity, resource, amount range, IP, request ID), plus full-text on `reasonText` and diff values (GIN index on `diff jsonb_path_ops`). Cursor pagination. Saved searches.
- **Export:** CSV and JSONL streaming with no 10k cap (async job, emailed link). **Every export is itself an `export.run` event.** SIEM feed via the outbox to a webhook, Splunk HEC, Datadog Logs or S3, in OCSF format.
- **Integrity panel:** chain-verification status and last anchor time.
- **Remove the mock fallback** in `AuditLog.tsx`. An error state must say "unavailable" and must never show sample data.

### C.6 Alerts on sensitive actions

A rules table per tenant with platform defaults. Notifications go by email, Slack or webhook to the owner role.

- **Impersonation** start (always notify the tenant owner) and any money action taken while impersonating.
- Role or permission change; new admin; API key create; Stripe or QBO connect/disconnect or payout change.
- Refund or void over a threshold (default $500) or over N per user per day. POS price override or discount over X% (default 20%). Cash variance over $20.
- Tax-rate, fee or pricing-rule change. Manual GL entry. Write-off. Penalty override below the computed amount.
- Export of more than N customer records. Off-hours money actions. Failed-login bursts.
- Dual control (`approvalId` required) for: refunds over threshold, write-offs, voids of PAID or posted invoices, tax config, payout account, role elevation to OWNER.

### C.7 Calculation provenance

Every computed money number persists **how** it was computed, immutably, next to the result.

- **New table `price_computations`** (or a `pricingBreakdown Json` column on each priced row):

  ```json
  {
    "engine": "helm-pricing", "engineVersion": "2026.11.0", "policyVersion": "tenant:abc@v14",
    "currency": "USD", "rounding": {"mode": "HALF_EVEN", "scale": 0, "stage": "line"},
    "inputs": { "slipId": "...", "boatLoaFt": 42.5, "billableFt": 43, "nights": 3, "tz": "America/New_York",
                "start": "2026-10-31T09:00-04:00", "end": "2026-11-03T09:00-05:00" },
    "steps": [
      { "seq": 1, "rule": "rate_card.transient_per_ft", "ruleId": "rc_17@v3", "op": "set",  "value": "4.25/ft/night", "resultCents": 54825 },
      { "seq": 2, "rule": "season.peak",                "ruleId": "sr_4@v2",  "op": "mul",  "value": "1.15",         "resultCents": 63049 },
      { "seq": 3, "rule": "promo.FALL10",               "ruleId": "pc_9",     "op": "pct_off","value": "10",         "resultCents": 56744 },
      { "seq": 4, "rule": "tax.state_marina",           "ruleId": "tx_2@2026-01-01", "op": "tax", "rate": "0.0700", "taxCents": 3972 }
    ],
    "subtotalCents": 56744, "taxCents": 3972, "totalCents": 60716,
    "overrides": [{ "by": "user_123", "fromCents": 60716, "toCents": 55000, "reasonCode": "PRICE_MATCH", "approvalId": "ap_5" }],
    "inputHash": "sha256:…"
  }
  ```

- **Where it is attached:** `InvoiceLineItem.pricingBreakdown`, `Reservation.pricingBreakdown` (the code already tries to write `pricingBreakdownJson`; add it to the schema), `TransientBooking`, `PosLineItem` (price source: catalog / override / promo), `SlipContract` (rate card, per-foot, renewal increase lineage), `DeferredSchedule` (method, months, entries), `MeterReading` (prev, current, multiplier, rate version), and termination penalty.
- **Rule versioning:** rate cards, pricing rules, tax rates, promo codes, fee schedules and cancellation policies become **versioned, effective-dated rows** (`validFrom`, `validTo`, `version`). They are never mutated in place, so a `ruleId@version` always resolves.
- **"Explain this number" UI:** every money cell gets a popover that renders the steps. Re-pricing (`POST /pricing/quote`) returns the same structure, so quotes and charges are explained identically.
- **Server authority:** clients may *request* a quote (getting back a `quoteId` with breakdown and expiry, which is how the price lock is implemented). Mutations accept a `quoteId`, never a total. The server recomputes and must match; otherwise it returns 409.

### C.8 Shared money and pricing library (`packages/money`, `packages/pricing`)

**Representation**
- Store money as **integer minor units in `BigInt`/`Int` columns** (keep cents; there is no need for Decimal columns for money).
- Store rates, multipliers, per-foot and per-kWh prices, quantities (gallons, kWh, feet, nights) and fuel prices in **`Decimal(p,s)`** (Prisma `Decimal`), handled with **decimal.js** (or `dinero.js` v2, whose minor-unit and scale model fits). Fuel needs 3-decimal unit prices; electricity needs 4.
- **Forbid `number` arithmetic on money.** An ESLint rule bans `*`, `/` and `Math.round` on identifiers matching `/Cents|price|amount|total|fee|tax/i` outside the library. The frontend sends and displays cents only; one `parseMoneyInput("1.005") → 101` helper uses decimal parsing, not `parseFloat × 100`.

**One rounding policy**
- **Line-level** rounding to cents, **HALF_EVEN (banker's)** for computed allocations (proration, deferral splits, percentage discounts, fee splits), because it is unbiased over many entries.
- **Tax: HALF_UP, at the line level, after discounts**. This matches most US state guidance and POS/QBO behavior. Make it configurable per tenant to `invoice-level` for jurisdictions that require it, and record the choice in the provenance `rounding` block.
- **Allocation by largest remainder** (`allocate(total, weights)`) for deferral schedules, split payments, partial refunds and multi-line discounts, so Σ parts == total, always.
- **Time:** all calendar math in the **location timezone** via Temporal or Luxon. Nights and days are counted as calendar dates, never `ms / 86_400_000`. Proration uses actual days in the service period.

**API sketch**

```ts
money.fromMajor("12.50") / money.add / money.sub / money.mulDecimal(m, rate, mode) / money.allocate(total, ratios)
pricing.quote({ product|slip|fuel|transient, inputs, tenantPolicyVersion }) -> { totalCents, taxCents, breakdown }
tax.compute(lines, { tenantId, locationId, customerExemption, date }) -> per-line tax + jurisdiction breakdown
proration.dailyActual(rateCents, periodStart, periodEnd, serviceStart, serviceEnd, tz)
deferral.schedule(totalCents_exTax, serviceStart, serviceEnd, method: "DAILY"|"MONTHLY", tz)
```

The same package is imported by `apps/api` (authoritative) and by the frontends (preview only). Golden-file tests sit in the package, and the API and UI must produce identical outputs for a shared fixture set.

**Migration plan**
1. **Freeze & measure (1 week).** Add the money package with property-based tests (fast-check) and golden fixtures. Add an ESLint rule in warn mode. Add shadow computation: in every money route, compute with the new library alongside the old code and log the diffs (no behavior change) for 2 weeks on staging and seed data.
2. **Schema (1–2 weeks).**
   - Add `Decimal` columns: `quantityDec`, `taxRateDec`, `multiplierDec`, `kwhRateMicros` or `Decimal(10,4)`, fuel `pricePerGallon Decimal(8,3)`.
   - Add `pricingBreakdown Json` on priced rows.
   - Add versioned `tax_rates`, `rate_cards`, `fee_schedules` and `gl_account_mappings` (role → account per tenant; this replaces the hard-coded numbers).
   - Backfill from the Float columns with explicit rounding. Dual-write.
3. **Server cutover by domain, highest risk first.**
   - (a) Tax engine plus GL posting: Sales Tax Payable, account-role mapping, balanced termination, fee posting.
   - (b) Invoicing: lines, proration, deferral ex-tax, credits, refunds.
   - (c) POS: catalog price authority, override events, refunds, shift and daily math.
   - (d) Transient and per-foot, fuel with excise, ramp.
   - (e) Rentals: a single engine, with the simulator, calendar and widget calling `/pricing/quote`.
   - Each cutover reconciles old vs new on historical data, and any difference over 0 needs a sign-off.
4. **Client cutover.** Remove the duplicate frontend engines (PriceSimulator, PricingCalendar, widget totals, InvoiceForm and POS cart math). Display server quotes. Mutations accept `quoteId` only.
5. **Enforce.** Switch the ESLint rule to error. Drop the Float columns. Run CI checks on golden fixtures and on schema/TS (`tsc --noEmit` must pass; today it reports 444 errors).

---

## Prioritized plan

Effort: **S** ≤ 3 days, **M** ≤ 2 weeks, **L** > 2 weeks (one engineer).

### P0 (launch blockers)

| # | Item | Effort | Refs |
|---|---|---|---|
| 1 | Make the server authoritative for every price and total. Reject client totals, unit prices, fees and connected-account IDs. Introduce `/pricing/quote` + `quoteId`. | M | C-40, C-60, C-61, C-67, C-69, C-76, B.3 |
| 2 | Fix the GL. Per-tenant account-role mapping (one convention across posting, onboarding and seed). Sales tax to a liability. Balanced termination via `postEarlyTermination`. Post ACH fees. No balance change without a GL entry (QBO inbound, credits). | M | C-16, C-25, C-30, C-31, C-35 |
| 3 | Wire tax config. One versioned `tax_rates` model with a single unit (Decimal fraction). Settings UI writes it. POS and invoices both use `tax.compute`. Exemptions apply in POS. | M | C-07, C-41, C-10 |
| 4 | Billing engine correctness and scheduling. Bill per cycle (or deferral-correct). Anchor clamped to the last day of month. Tenant-TZ dates. Schedule billing and recognition jobs with idempotency keys. Deferral excludes tax and uses the correct month count, inside `tx`. | L | C-01, C-02, C-04, C-20 to C-24 |
| 5 | Fix refund, credit and cash math. Cumulative refund cap. Partial credit split. POS partial refunds without marking the original REFUNDED. Shift and daily report formulas. | M | C-13, C-15, C-43 to C-45 |
| 6 | Audit-log minimum viable fix. Correct roles and the `tenant_id` bug on `/api/audit-log`. **Delete the mock fallback** in AuditLog.tsx and align the UI with the API shape. Capture IP and UA via middleware. Audit impersonation, role changes, settings and tax, tier price, fuel price, draft-invoice edits, inventory adjustments, transient, Stripe/QBO connect, exports and logins. Move post-commit audit writes into the transaction. | M | B.1, B.2 |
| 7 | Algorithmic pricing $0 bug (null-safe clamp) and disabling auto-renew of non-auto-renew contracts. | S | C-78, C-27 |
| 8 | Stop showing fabricated numbers. Dashboard KPI key mapping. Remove mock-data fallbacks on money screens (or label them "Demo"). | S | C-118, C-119, C-11 |
| 9 | Disarm the tenant-lifecycle job until a real SaaS invoice model exists (it would lock marinas over their own customers' invoices). Persist SaaS invoices. | S | C-132, C-136 |

### P1 (first 60 days after launch)

| # | Item | Effort | Refs |
|---|---|---|---|
| 10 | `packages/money` + `packages/pricing` (decimal.js, HALF_EVEN allocations, HALF_UP line tax, TZ-aware calendar math) with golden tests, then migrate every domain. | L | C.8 |
| 11 | Enterprise audit schema (`audit_events`), hybrid capture (`$extends` + domain events + outbox), action registry with required reason codes. | L | C.1, C.2 |
| 12 | Calculation provenance: `pricingBreakdown` on invoice lines, reservations, transient bookings, POS lines and contracts; versioned rule tables; "Explain" popover. | M | C.7 |
| 13 | Per-foot dockage and transient rate cards (seasonal, weekend, LOA rounding), overstay charging, fuel price in Decimal(8,3) with per-tenant DB storage and excise/sales tax, metered electricity (MeterReading write path, kWh × Decimal rate). | L | C-06, C-50, C-63, C-66 |
| 14 | Single rental pricing engine (review 04) covering floor/ceiling, waiver, deposit, tax, promo codes, wrap-around seasons and DST-safe durations. Delete PriceSimulator and PricingCalendar logic. | M | C-70 to C-82 |
| 15 | Platform fees from SaaS tier (card/ACH) on all Stripe charges, per-location SaaS fees, correct MRR, churn and GMV. | M | C-61, C-130 to C-135 |
| 16 | Late fees and interest engine (grace days, % or flat, caps, state limits), PAST_DUE marking job, all audited. | M | C-19 |
| 17 | Reporting fixes: NPS formula, AR buckets and labels including COLLECTIONS, revenue net of refunds, P&L account types, rent-roll cycles, single conversion-rate definition, tenant-TZ date filters. | M | C-100 to C-116 |
| 18 | Alerts and dual-control approvals for sensitive actions. | M | C.6 |

### P2 (hardening)

| # | Item | Effort | Refs |
|---|---|---|---|
| 19 | Hash chain, append-only DB role and trigger, daily anchors to WORM storage, verify endpoint. | M | C.3 |
| 20 | Retention partitions, archive to Parquet, crypto-shred PII on erasure. | M | C.4 |
| 21 | Global audit search (GIN), per-record History tabs, async export, SIEM/OCSF streaming. | M | C.5 |
| 22 | Inventory: single ledger (remove the in-memory store), real FIFO or weighted-average costing, reorder-point semantics. | M | C-90, C-91 |
| 23 | CI gates: `tsc --noEmit` clean, ESLint money rule as error, integration tests against a real Postgres (not a mocked Prisma) for every catalog item marked WRONG or SUS. | M | A.10, F-11 |
| 24 | Sequential, gap-free invoice numbering per tenant (prefix and next number from settings), which auditors expect. | S | C-18 |
