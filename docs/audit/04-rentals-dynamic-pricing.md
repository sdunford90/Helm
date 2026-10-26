# Audit 04: Boat Rentals and Dynamic Pricing

**Scope:** rental product setup, pricing engine, availability, public booking widget, customer portal, staff Rentals page and API, check-out/check-in, deposits, waivers, cancellations, the algorithmic pricing job and rental automations.
**Method:** I read every file in scope. I type-checked `apps/api` with `tsc --noEmit` against the generated Prisma client and ran `tests/routes/rentals.test.ts`. No source files were changed.
**Date:** 2026-10-26

Severity: **P0** blocks launch, **P1** must fix soon after launch (or before, if rentals is a headline feature), **P2** gap or improvement.
Effort: **S** up to 1 day, **M** 2 to 5 days, **L** more than 1 week.

---

## Executive summary

The rental module is a **front-end mock with a non-functional back end**. Nothing about rentals works end to end today.

1. **The API route and the database schema describe two different data models.** `apps/api/src/routes/rentals.ts` was written against the model in `packages/shared-types/src/rental.ts`: `hourlyRateCents`, `dailyRateCents`, `totalQuantity`, `startDate`, `multiplier`, `occupancyThresholdPct`, `isDefault`, and so on. `schema.prisma`, the seed, the reports and the pricing job use a different model: `basePriceCents`, `startDt`, `ruleType`/`value`, `overrideDate`/`priceCents`, `availabilityThresholdPct`, `rulesJson`. `tsc` reports **110 type errors in rentals.ts** (and 337 across the API). At runtime (`tsx`/`node` do not type-check), Prisma rejects these queries. **About 16 of the 19 rental endpoints throw a 500 on every call.**
2. **The tenant-scoping Prisma extension breaks every pricing child table.** `lib/prisma.ts:17-55` lists `PricingRule`, `PricingCalendarOverride`, `DemandSurgeTier` and `AlgorithmicSuggestion` as tenant-scoped, but these tables have **no `tenantId` column**. So even a corrected route would fail as long as it queries these models directly inside a request.
3. **There is no public booking path.** The whole rentals router sits behind `clerkAuth()` (`rentals.ts:294`). The widget runs on mock products, computes the price in the browser, has a Stripe placeholder instead of a card form, and posts a payload the API would reject anyway.
4. **The staff UI runs entirely on hard-coded mock data.** The paths have a doubled `/api/api/...` prefix, so every call 404s and the page silently falls back to the mocks. The Check In, Check Out, Cancel, New Booking, Add Rule and Add Promo buttons call no API. Products added in the UI are lost on reload.
5. **There are four separate pricing engines and none agrees with another:** the API, the widget, `PricingCalendar` and `PriceSimulator`. Promo codes, taxes, fees, damage waivers and deposits are never applied anywhere.
6. **Nothing prevents double-booking.** Availability is a count-then-insert with no transaction or lock, no buffer time and no fleet units. Edits skip the availability check.
7. **None of the following is implemented:** payments, deposit holds, waivers, license checks, refunds, emails and automations. The worker that would send automations is never started in production, and its own queries would crash.
8. **The algorithmic pricing job is never scheduled.** If it ran, it would crash in all-tenant mode. In single-tenant mode it measures the wrong signal and can suggest a $0 price. The approve endpoint writes to columns that do not exist.

**Bottom line:** treat rentals as roughly 15% built. The UI shell and the data model are a reasonable start. The engine, booking, payment and operations layers have to be written. The realistic launch options are (a) launch **without** rentals (turn the module off server-side) or (b) take on about 6 to 9 engineer-weeks to reach a minimal viable rental product (section 8).

---

## 1. What exists (inventory)

| Layer | File | State |
|---|---|---|
| DB models | `apps/api/prisma/schema.prisma:840-1013` (CancellationPolicy, RentalProduct, PricingRule, PricingCalendarOverride, DemandSurgeTier, AlgorithmicSuggestion, Reservation, RentalAutomationEvent, NpsSurvey, PromoCode); SecurityDeposit `:769`; Boat `:458` | Reasonable skeleton. Missing quantity, rate table, units, photos, requirements, buffers, add-ons, timezone, deposit link. No migrations directory (schema-push only). |
| Enums | `ReservationStatus :132`, `PricingRuleType :141` (SEASONAL, PEAK_DAY, LEAD_TIME, MULTI_DAY), `SuggestionStatus` (PENDING, APPROVED, IGNORED), `AutomationEventType :154`, `DepositStatus :117` | Do not match the route, the shared types or the worker. |
| API | `apps/api/src/routes/rentals.ts` (19 endpoints, 1320 lines) | Written against a different model. Almost all endpoints fail at runtime (section 3.1). Every route requires Clerk auth. |
| Tenant scoping | `apps/api/src/lib/prisma.ts:17-55` | Lists 4 pricing models without a tenantId column, plus 2 models that do not exist (`Rental`, `CancellationRule`). |
| Pricing job | `apps/api/src/jobs/algorithmic-pricing.ts` | Never scheduled (`scheduleAlgorithmicPricing` is never called). Not sound (section 7). |
| Worker | `apps/api/src/workers/index.ts:90-215` | Rental automation cases exist, but nothing enqueues them. The queries use snake_case fields. Docker runs `dist/jobs/renewal-job.js` instead (`docker-compose.yml:90`). |
| Email automation | `apps/api/src/services/email-automation.ts:354-430` | 5 rental triggers defined. `processAutomationTrigger` is never called anywhere in the codebase. |
| Reports | `apps/api/src/routes/reports.ts:224-247` (rental-utilization), `bi-api.ts:291` | Use the schema correctly, so they work but report seed data only. |
| Staff UI | `apps/web/src/pages/Rentals.tsx` | Fully mock-driven. Tabs: Products, Availability (mock 3-slot grid), Reservations, Settings (Durations, Pricing Rules, Promo Codes, Pricing Calendar, Price Simulator). |
| Components | `apps/web/src/components/PricingCalendar.tsx`, `PriceSimulator.tsx` | Self-contained client-side mock pricing engines with hard-coded rules and dates. |
| Settings | `apps/web/src/pages/Settings.tsx:36-44,107-113,294-298,742-815` (rental catalog); `:1163-1200` (module toggle) | A second, disconnected product catalog in local React state, with damage waiver, deposit and GL columns. Never saved. |
| Module flag | `apps/web/src/context/ModulesContext.tsx` | Stored in browser localStorage only. Not per tenant, and not enforced by the API or the widget. |
| Widget | `apps/widgets/src/rental-booking/RentalBookingWidget.tsx`, `index.ts`; `shared/api.ts`, `shared/styles.ts` | Four-step UI on mock products. Client-side price. No availability, no payment. |
| Portal | `apps/portal/src/pages/*` | **No rental pages at all** (no "my reservations", no booking, no waiver signing). |
| Shared types | `packages/shared-types/src/rental.ts` | A third data model (FLAT, PER_FOOT and TIERED slip-pricing concepts; suggestion statuses ACCEPTED, REJECTED, EXPIRED). The route mirrors it; nothing else does. |
| Tests | `apps/api/tests/routes/rentals.test.ts` | 5 tests, **5 fail**: the builders `buildRentalProduct`, `buildRentalReservation` and `buildPricingRule` do not exist in `helpers.ts`. The tests mock `prisma.rentalReservation`, which does not exist, and hit `/pricing-rules`, which has no route. Because Prisma is mocked, these tests could never catch the schema drift. |
| Seed | `apps/api/prisma/seed/rentals.ts` | 6 products and 4 rules that match the schema; 10 reservations around March 2026. No overrides, surge tiers, promo codes or cancellation policies are seeded. 10 reservations is below the job's 20-reservation threshold. |

---

## 2. Product setup model assessment

### What the schema supports (`RentalProduct`, schema.prisma:854)
`name`, `description`, `durationType` (a free-text string), `basePriceCents` (a single price), `floorPriceCents`, `ceilingPriceCents`, `damageWaiverCents`, `depositCents`, `cancellationPolicyId`, `locationId`, `boatId` (a bare string with no relation), and `active`.

### Flow 1 traced: staff creates a product

| Step | Where | Result |
|---|---|---|
| Staff opens Rentals, then "Add Product" | `Rentals.tsx:569-597` | Modal collects name, type, capacity and hourly, half-day and daily rates in **dollars (floats)**, plus status. |
| Save | `Rentals.tsx:892-895` | The product is added to **local state** (shows instantly). It then calls `createProduct.execute({ body: p })`, which sends `{ body: {...} }`, a wrapped object. The error is swallowed by `.catch(() => {})`. |
| HTTP | `apps/web/src/lib/api.ts:1,26` together with the path `'/api/rentals/products'` | The request goes to `/api/api/rentals/products`, which **404s**. This doubled prefix affects every page in the web app. |
| If the path were fixed | `rentals.ts:18-27,346-359` | Zod requires `category` (not sent), so the request fails with 400. With a valid body, Prisma rejects the unknown fields `category`, `hourlyRateCents`, `dailyRateCents`, `weeklyRateCents`, `totalQuantity`, `isActive` and `availableQuantity`, and the required `basePriceCents` is missing. Result: **500**. |
| Reload | | The product is gone. |

The Settings catalog (`Settings.tsx:781,804,810`) adds, edits and deletes rows in React state only.

### Findings

| # | Location | Problem | Failure scenario | Fix | Sev | Eff |
|---|---|---|---|---|---|---|
| 2.1 | `rentals.ts:18-38` vs `schema.prisma:854-880` | The create and update schemas use fields that do not exist in the DB. | Product create and update always fail. No product can be created except by seed. | Choose one canonical model (I recommend extending the Prisma schema; see 2.3), then rewrite the Zod schemas and generate shared types from Prisma (for example `zod-prisma-types`). | P0 | M |
| 2.2 | `Rentals.tsx:892-895`, `:1039` | Add Product sends a wrapped body in dollars and ignores failures. The row-level "Edit" button opens the empty Add modal. | Staff believe the product was saved; it disappears on reload. | Send cents, use the correct shape, surface errors with a toast, and build a real edit form. | P0 | S |
| 2.3 | `schema.prisma:854` | **No inventory quantity and no fleet units.** A product is one price, with no count of identical units (for example 6 jet skis) and no link to physical hulls. `boatId` points at `Boat`, which is a *customer-owned* vessel model (`Boat.customerId` is required, `:461`). | You cannot run a fleet of 6 identical kayaks or track which hull went out and its engine hours. | Split into **RentalProduct** (what is sold: type, rate card, capacity, requirements) and **RentalUnit** (a physical asset: name, HIN, registration, engine hours, status ACTIVE/MAINTENANCE/RETIRED, location). Bookings consume units. Do not reuse `Boat`. | P0 | M |
| 2.4 | `schema.prisma:861` | **No rate card.** There is one `basePriceCents`, with `durationType` as free text. The UI promises hourly, half-day, daily and multi-day rates (`Rentals.tsx:20-23`, `Settings.tsx:108`), and the Durations tab (`Rentals.tsx:717-871`) models named durations with unlock rules, in local state only. | The marina cannot sell a "4-hour half day for $280" alongside "$85/hr". | Add a `RentalRate` table (productId, label, durationMinutes, priceCents, availableDays, start-time windows, minimum lead time, unlock rule). The Durations tab already sketches this; persist it. | P0 | M |
| 2.5 | `schema.prisma:854` | No capacity (passengers), photos, description media, requirements (minimum age, boater-safety card, license, experience), included items, fuel policy or GL account. Capacity, type and rating exist in the UI only. | The widget cannot show photos or enforce "18+ with boater card". | Add `capacity`, `category` enum, `images[]` (S3; the storage route exists), `requirementsJson`, `fuelPolicy` (FULL_TO_FULL, METERED, INCLUDED), `glAccountId`, `taxCategory`. | P1 | M |
| 2.6 | `schema.prisma:854` | No buffer or turnaround time, operating hours, check-in windows or minimum/maximum duration. | Back-to-back bookings with zero cleaning or fuel time; bookings at 3 a.m. | Add `bufferBeforeMin`, `bufferAfterMin`, `minDurationMin`, `maxDurationMin`, and operating hours per location. | P1 | S |
| 2.7 | `schema.prisma:883-921` | `PricingRule`, `PricingCalendarOverride` and `DemandSurgeTier` have no `tenantId` and no `active` flag. Scoping relies only on the parent product. | Combined with 3.2, every direct query on them fails. | Add `tenantId` with an index (preferred: consistent with RLS and the extension), or remove these models from `TENANT_SCOPED_MODELS` and always access them through the product. | P0 | S |
| 2.8 | `Settings.tsx:107-113` vs `Rentals.tsx:66-75` | Two independent product catalogs (Settings, then Catalog, then Rental Products; and Rentals, then Products) with different fields and different mock data. | Staff edit one and the other does not change. | Keep one catalog screen backed by the API; link to it from the other. | P1 | S |
| 2.9 | `ModulesContext.tsx:13-23`; `App.tsx:51` | The Rentals module toggle lives in **localStorage**. It is per browser, not per tenant, and the API and widget ignore it. | A marina "disables" rentals, but a public widget or another staff browser still shows it. | Store the flag in a tenant settings table, enforce it in API middleware (403 when disabled) and in the widget config endpoint. | P1 | S |
| 2.10 | `rentals.ts` (none) | No DELETE or archive for products, rules, overrides or policies. No CRUD at all for surge tiers or promo codes. No GET for overrides or policies by product. | Bad data cannot be removed; promo codes and surge tiers cannot be configured. | Add full CRUD with soft-delete (`active=false`) for anything referenced by reservations. | P1 | M |

---

## 3. Pricing engine walk-through and findings

### 3.1 Which rental endpoints actually work today (runtime, inside a tenant request)

`tenantMiddleware` (`middleware/tenant.ts:77`) wraps every request in `tenantStore.run`, so the `$extends` hook injects `tenantId` into every top-level query on the models listed in `TENANT_SCOPED_MODELS`.

| Endpoint | Outcome | Reason |
|---|---|---|
| GET /products | **500** if any product exists | The `reservation.count` filter uses `startDate`/`endDate`; the columns are `startDt`/`endDt` (`:322`). |
| POST /products | 400 or 500 | See 2.1. |
| PUT /products/:id | Works only for name and description | The other fields do not exist. |
| GET/POST /products/:id/pricing, PUT /pricing/:ruleId | **500** | The route passes `tenantId`, `type`, `baseRateCents` and `seasonStart` (`:196,434,461-466,497`), and the extension also injects `tenantId`. |
| POST /products/:id/calendar-overrides | **500** | `tenantId`, `startDate`, `endDate`, `multiplier` and `label` do not exist (`:542-551`). |
| GET /products/:id/calendar | **500** | `startDate` filter and `orderBy` (`:600-606`). |
| GET /reservations | **500 always** | The default `sortBy: "startDate"` (`:120`) and `select: { category }` (`:717`). |
| GET /reservations/:id | **500** | `include: { cancellationPolicy }`, but Reservation has no such relation (`:749`). |
| POST /reservations | **500** | `isActive` (`:783`), `startDate` (`:802`), `totalQuantity` (`:807`), `isDefault` (`:818`), plus create fields (`:830-838`). |
| PUT /reservations/:id | Works only for a status-only change | `notes`, dates and `pricingBreakdownJson` do not exist. |
| POST /reservations/:id/check-in | **500** | `checkedInAt` does not exist (`:969`). |
| POST /reservations/:id/check-out | **500** | `checkedOutAt`, `overtime*` and `damage*` do not exist (`:1037-1042`). |
| POST /reservations/:id/cancel | **500** | `include: { cancellationPolicy }` (`:1088`); `cancelledAt` and `refundPct` do not exist. |
| GET/PUT /pricing/suggestions | **500** | `tenantId`, `createdAt`, `pricingRule`, `pricingRuleId`, `suggestedRateCents`; ACCEPTED and REJECTED are not values of the `SuggestionStatus` enum. |
| GET /cancellation-policies | Works | Every field exists. |
| POST /cancellation-policies | **500** | `isDefault` and `description` do not exist (`:1287-1296`). |

**Coordinator item verified (`lib/prisma.ts` TENANT_SCOPED_MODELS).**
- Any top-level `prisma.pricingRule.*`, `pricingCalendarOverride.*`, `demandSurgeTier.*` or `algorithmicSuggestion.*` call made inside a request gets `tenantId` injected into `where` or `data`. Prisma then throws `Unknown argument tenantId`. This affects the endpoints `/products/:id/pricing` (GET and POST), `/pricing/:ruleId`, `/products/:id/calendar-overrides`, `/products/:id/calendar` (overrides query), `/pricing/suggestions` (GET and PUT), and `calculateDynamicPrice` (so POST and PUT `/reservations`).
- **Nested includes and nested writes through RentalProduct are not affected.** The `$allOperations` hook only sees the top-level operation. `rentalProduct.findMany({ include: { pricingRules: true, calendarOverrides: true, demandSurgeTiers: true } })` works, and `rentalProduct.update({ data: { pricingRules: { create: [...] } } })` works: `tenantId` is injected only on RentalProduct, which has the column. This is a workable stop-gap, but the proper fix is 2.7.
- Code paths **outside** a tenant context are unaffected: the seed, and the worker and pricing job, which do not set `tenantStore`.
- `Rental` and `CancellationRule` are dead entries. They are harmless but misleading.
- The commit "Fix crash when viewing pricing rules" (ad0aa21) only added optional chaining in `Rentals.tsx:1169,1172` for mock data. It did not touch the API, and the API call never succeeds anyway (wrong path, and `/pricing-rules` does not exist).

### 3.2 Actual order of operations in `calculateDynamicPrice` (`rentals.ts:160-290`), as written

1. **Duration** = `(end - start)` in hours and days (`:172-174`).
2. **Base price, one rate tier only** (`:180-192`):
   - If 7 days or more and there is a weekly rate: `ceil(days/7) × weekly`.
   - Otherwise, if 1 day or more and there is a daily rate: `ceil(days) × daily`.
   - Otherwise, if there is an hourly rate: `ceil(hours) × hourly`.
   - Otherwise **0**.
3. **Pricing rules**, by priority ascending, **first match wins, then `break`** (`:203-218`):
   - SEASONAL compares the **start-date MM-DD as a string** against the season range and sets `ruleMultiplier`.
   - FLAT **replaces** `baseCents` with the rule's fixed amount, ignoring duration.
   - DEMAND does nothing.
4. **Calendar override:** of all overrides overlapping the booking window, take the **highest multiplier** and apply it to the **whole booking** (`:224-238`).
5. **Demand surge:** utilization = (CONFIRMED + CHECKED_IN reservations overlapping the window) ÷ `totalQuantity`. The highest tier whose threshold is at or below utilization wins (`:245-270`). Tiers are queried **tenant-wide** (`:260`), not per product.
6. **Total** = `round(base × rule × calendar × surge)` (`:272`). This is the only rounding step.
7. **Never applied:** floor and ceiling, PEAK_DAY, LEAD_TIME, MULTI_DAY, algorithmic suggestions, promo codes, damage waiver, taxes, booking or service fees, deposit (the deposit comes from the **request body**, `:102,834`), and add-ons.

### 3.3 The same price is not computed everywhere

| Surface | Engine | Order of operations |
|---|---|---|
| API (`rentals.ts:160`) | Server | Rate tier, one rule, max override multiplier, surge |
| Widget (`RentalBookingWidget.tsx:197-201`) | **Browser** | `hourlyRate × hours` or `dailyRate`, from mock products. Sends `totalPrice` (`:239`). |
| PricingCalendar (`PricingCalendar.tsx:37-88`) | Browser mock | An override is an **absolute price that short-circuits** everything else, then summer (Jun-Aug) +25%, weekend +15%, then a hard-coded surge-dates list +10%, compounded. Legend labels +25% as a "Seasonal Discount" (`:94`). |
| PriceSimulator (`PriceSimulator.tsx:60-168`) | Browser mock | Duration multiplier (half-day = 3.5 × hourly, full day = 6 × hourly), July 4 +40%, summer May-Sep +25%, weekend +15%, surge chosen from a **hash of the date string**, lead time -10%, multi-day -15/-20%, floor/ceiling of 0.6 to 2.5 × base, "algorithmic" (cosmetic only), promo. The promo map hard-codes SUMMER50 as 10% (`:44`); the promo list in `Rentals.tsx:101` shows it as $50. |
| Staff booking | — | No staff booking form exists. |
| Final charge | — | No charge is ever made (section 6). |

The simulator presents itself as "what the customer will pay", but its logic is unrelated to the server's.

### 3.4 Findings

| # | Location | Problem | Failure scenario | Fix | Sev | Eff |
|---|---|---|---|---|---|---|
| 3.1 | `rentals.ts` throughout | Schema drift (section 3.1). | No pricing or booking endpoint works. | Rewrite against the final schema. Add a CI `tsc --noEmit` gate. The API currently has 337 TS errors, and builds and dev mode both ignore them. | P0 | L |
| 3.2 | `lib/prisma.ts:37-46` | Models without a tenantId are listed as tenant-scoped. | Every direct pricing-model query fails. | 2.7. Also delete `Rental` and `CancellationRule`. Add a startup assertion that every listed model has a `tenantId` field (via `Prisma.dmmf`). | P0 | S |
| 3.3 | `rentals.ts:180-192` | Falls through to **$0** when the booking is shorter than a day and the product has no hourly rate, or longer than a day with no daily rate and no hourly rate. | A 3-hour booking of a daily-only pontoon is created at $0. | Use rate-card selection (2.4): choose the best-fit or cheapest valid combination; reject when no rate applies; never return 0 unless the product is configured as free. | P0 | S |
| 3.4 | `rentals.ts:181,185` | Coarse `ceil` jumps: 25 hours costs 2 days; 8 days costs 2 weeks, which is more than 8 × daily. No half-day tier. | Overcharges; customers dispute the charge. | Use the cheaper of the combinations (weeks + days + hours), or charge strictly by the rate-card duration. Unit-test the boundaries. | P1 | S |
| 3.5 | `rentals.ts:203-218` | First matching rule wins, then `break`, so rules never stack. FLAT replaces the entire base regardless of duration. | A seasonal rule at priority 0 silences a weekend rule; a FLAT rule makes a 1-hour and a 7-day booking cost the same. | Define an explicit pipeline (3.6). Evaluate every matching rule per day with a defined stacking mode (multiply, add, or max) and a per-rule `stackable` flag. | P1 | M |
| 3.6 | `rentals.ts:205-206` | SEASONAL compares MM-DD strings using server-local `getMonth`/`getDate`. A season that wraps the year (Nov to Mar) never matches. Only the start date counts. | A winter discount never applies; a rental spanning the season boundary is priced entirely at one rate. | Evaluate in the **tenant/location timezone** and per day (or per hour) of the booking. Support wrap-around ranges. The schema already uses real `startDate`/`endDate` DateTimes, so use them. | P1 | S |
| 3.7 | `rentals.ts:233-238` | The highest override multiplier is applied to the whole booking. The calendar view uses the *first* matching override (`:638`), not the max. The schema defines overrides as an **absolute `priceCents` per date**, not a multiplier. | One holiday day inside a 7-day rental raises the whole week by 1.5×; the calendar shows a different price from what the booking charges. | Overrides set the per-day base price for that date only (matching the schema). Price multi-day bookings as a sum of per-day prices. Have the calendar endpoint call the same function. | P1 | S |
| 3.8 | `rentals.ts:245-270` | Surge: (a) tenant-wide tiers in the route vs per-product tiers in the schema; (b) `occupancyThresholdPct` vs `availabilityThresholdPct`, inverse meanings, so a fix could invert surge; (c) counts any overlap in the window, not peak concurrent units; (d) ignores PENDING holds although availability counts them; (e) no floor or ceiling. | Prices spike or drop unpredictably; a 1-week booking is priced on any single overlap. | Compute peak concurrent units per time bucket. Define the threshold explicitly as % *booked*. Apply surge per day. Clamp to floor and ceiling. | P1 | M |
| 3.9 | `rentals.ts:272` | No clamp to `floorPriceCents`/`ceilingPriceCents` (which exist in the schema); multipliers are unbounded (`seasonMultiplier: z.number().min(0)`, `:56`). | A 0 multiplier makes the booking free; stacked 2× multipliers make it 8×. | Clamp the final price per unit or day, and validate multipliers to roughly 0.25 to 4. | P1 | S |
| 3.10 | (missing) | **No promo code engine.** The `PromoCode` model exists (`schema:1000`), but there is no endpoint, no validation and no atomic `usedCount` increment. The widget sends `promoCode`, and the server ignores it. | Marketing codes do nothing; the UI list is mock data. | Add `POST /public/rentals/quote` that validates the code (date window, limit, product scope, minimum spend), and redeem it atomically with `UPDATE ... SET usedCount = usedCount + 1 WHERE usedCount < usageLimit` inside the booking transaction. | P1 | M |
| 3.11 | (missing) | **No taxes, fees or damage waiver.** `tax-engine.ts` serves slip invoices only. `damageWaiverCents` and `Reservation.waiverSelected` are never used. No booking fee or fuel surcharge. | The marina under-collects sales or rental tax; local boat-rental tax may apply in some jurisdictions. | After the rental subtotal: add-ons, then optional or required damage-waiver fee, then fees, then tax computed via `tax-engine` with a `boat_rental` category, then rounding. Store the itemized lines. | P0 | M |
| 3.12 | `rentals.ts:102,834` | The deposit amount is taken from the request body; `RentalProduct.depositCents` is ignored. | Staff or a tampered client sets the deposit to 0. | Derive the deposit from the product (and its units); treat it as a hold, separate from the price (6.x). | P1 | S |
| 3.13 | `rentals.ts:838`, `schema:939` | `pricingBreakdownJson` is not a column. Reservations store only `totalCents`. There is no line-item snapshot. | Price disputes cannot be explained; refunds cannot be split between tax and fees. | Add `ReservationLineItem` (type BASE, RULE, ADDON, WAIVER, FEE, TAX, DISCOUNT; amount; metadata) and a `pricingSnapshotJson` with the engine version. | P1 | S |
| 3.14 | `PricingCalendar.tsx`, `PriceSimulator.tsx`, `RentalBookingWidget.tsx:197` | Four pricing engines. | Staff preview, widget quote and charge all disagree. | **Single source of truth:** a pure `priceRental(input, config)` function in a shared package (`packages/pricing`), used by the API. The UIs call `POST /quote`. The simulator and calendar call it, or a batch quote endpoint, and do not re-implement it. | P0 | M |
| 3.15 | (missing) | No price lock or quote token. `Reservation.priceLockExpiresAt` exists but is unused; the widget's "Price locked for 15 minutes" (`:565`) is fake. | The price changes between quote and pay (surge from other bookings); the customer is charged differently from what was shown. | The quote endpoint returns a signed `quoteId` (with line items and expiry) and creates a PENDING hold. Booking must reference the `quoteId`; the server re-verifies it. | P1 | M |
| 3.16 | `PricingCalendar.tsx:137-138`, `Rentals.tsx:1225-1241` | The calendar is hard-wired to March 2026 and three hard-coded products. It saves to `/api/rentals/pricing-calendar-overrides` (which does not exist) with no auth token and non-UUID ids, and swallows errors. | Overrides "save" visually and are lost. | Wire to real products and the real endpoint; default to the current month. | P1 | S |
| 3.17 | `Rentals.tsx:1151-1186` | The Pricing Rules tab reads `/api/rentals/pricing-rules` (no such route). "Add Rule" and "Edit" are "Coming Soon" toasts. Rule types in the UI (Seasonal, Peak Day, Lead Time, Multi-day) match the **schema** enum, not the route enum. | Staff cannot configure pricing. | Build the rule editor against the schema enum (SEASONAL, PEAK_DAY with `daysJson`, LEAD_TIME, MULTI_DAY), with a live preview using the quote endpoint. | P0 | M |

### 3.5 Recommended canonical pipeline
For each rate period (day or hour) in the tenant's timezone:

1. Base price from the rate card, or the date override (absolute).
2. Seasonal adjustment.
3. Peak-day adjustment.
4. Demand surge (peak concurrency).
5. Approved algorithmic price, if any (it replaces 1-4 for that date, as an override does).
6. Clamp to floor and ceiling.

Then, once for the booking:

7. Sum the periods.
8. Multi-day discount and lead-time discount.
9. Units × quantity.
10. Add-ons.
11. Promo code, on the pre-tax rental subtotal (capped).
12. Damage waiver and fees.
13. Tax per line category.
14. Round each line half-up to the cent, so the lines add up to the total.

The security deposit is reported separately as a hold and is never part of the total.

---

## 4. Availability and double-booking

### Flow 3 traced
`POST /reservations` (`rentals.ts:797-809`) counts overlapping PENDING, CONFIRMED and CHECKED_IN reservations (half-open overlap `start < end && end > start`, which is correct) and compares the count with `product.totalQuantity`. Then it calls `calculateDynamicPrice` and runs a separate `reservation.create`. Today this throws on `totalQuantity`/`startDate` before reaching the check.

| # | Location | Problem | Failure scenario | Fix | Sev | Eff |
|---|---|---|---|---|---|---|
| 4.1 | `rentals.ts:797-825` | **Check-then-insert race.** No transaction, no row lock, no DB constraint. Several awaits separate the check from the create (pricing, policy lookup). | Two widget users book the last jet ski within the same few hundred milliseconds; both succeed. On July 4 this happens routinely. | Book per **unit**, inside a `SERIALIZABLE` transaction or with `SELECT ... FOR UPDATE` on the product or unit rows. Better: a Postgres **exclusion constraint** on `rental_unit_bookings` with `EXCLUDE USING gist (unitId WITH =, tstzrange(startDt - bufferBefore, endDt + bufferAfter) WITH &&) WHERE status IN (...)`. This needs a raw-SQL migration, so the project must move from `db push` to migrations. Retry on `23P01` and report "just booked". | P0 | M |
| 4.2 | `rentals.ts:871-940` | **PUT /reservations/:id changes dates without any availability check**, and also allows arbitrary `status` transitions (CANCELLED back to CONFIRMED, PENDING to CHECKED_OUT). | Staff extend a booking over another customer's; a cancelled booking is revived over a rebooked slot. | Run the same availability and pricing transaction on modifications, excluding the reservation itself. Enforce a status state machine, with dedicated endpoints per transition. | P0 | S |
| 4.3 | `schema:854` | No unit-level assignment or turnaround buffer (2.3, 2.6). | Zero minutes between return and next departure; no time to fuel, clean or inspect. | Model units and buffers; auto-assign the best unit at booking, with staff override. | P0 | M |
| 4.4 | (missing) | No maintenance or blackout blocks. The UI shows "maintenance" and "blocked" slots from mock data (`Rentals.tsx:143,174`). | A boat with a known engine fault can be booked. | Add a `RentalUnitBlock` (unitId, range, reason) that availability honors. Set unit status MAINTENANCE from damage on check-in. | P1 | S |
| 4.5 | `schema:948`, `rentals.ts:801` | PENDING holds count against inventory forever. There is no expiry, and `priceLockExpiresAt` is unused. | Abandoned checkouts permanently block inventory. | PENDING with `holdExpiresAt` (10-15 minutes); a sweeper job releases expired holds; the availability query ignores expired holds. | P0 | S |
| 4.6 | Timezone: `rentals.ts:205,580-625`; widget `:166-168,392`; job `:71,104` | **No timezone model.** `Tenant.timezone` and `Location.timezone` exist (`schema:258,286`) but are never used. The API parses `new Date(string)` (a client ISO string, or a naked date treated as UTC). The calendar buckets by **UTC** date (`toISOString().slice(0,10)`) and builds months in server-local time. The widget sends `date: "2026-07-04"` and `startTime: "9:00 AM"` as unrelated strings with no zone. | A 7 p.m. EDT sunset cruise (23:00Z) appears on the right day, but an 8:30 p.m. one lands on the next day in the calendar. Seasonal and weekend rules evaluate in UTC; a Saturday 9 p.m. EDT booking is priced as Sunday. | Store UTC `timestamptz`. Have all business rules (slots, seasons, day of week, operating hours, cancellation windows) evaluated in the **location timezone** using a library such as `date-fns-tz` or Temporal. The public API takes `{ date, startTime, locationId }` and resolves the instant server-side. | P0 | M |
| 4.7 | `rentals.ts:313-334` | Product "availability" is computed for `now` only, with an N+1 query per product. | The products list shows "available" while the boat is booked from 30 minutes from now. | Return the next available slot, or availability for a requested range, from the availability service. | P2 | S |
| 4.8 | `rentals.ts:628-635` | The calendar counts any reservation touching a day as a fully booked unit. | A 2-hour kayak booking makes the kayak look fully booked for the day. | Return slot-level availability (per rate-card start time) instead of per-day counts. | P1 | S |
| 4.9 | `Rentals.tsx:107-260` | The Availability grid is 100% mock data (`generateMockAvailability`); the fixed morning, afternoon and evening slots do not exist in the backend. "New Booking" has no handler (`:481`). | Staff see fictional availability. | Drive the grid from `GET /availability?from&to&location`, with real slot definitions from the rate card. | P0 | M |

---

## 5. Front-end booking (widget and portal) findings

### Flow 4 traced: public widget
The host page embeds `data-helm-rental-booking data-helm-tenant-id`, and `index.ts:19-40` mounts the widget. The flow then goes:

1. **Step 0** shows `MOCK_PRODUCTS` (`:57-94`). There is no product fetch.
2. **Step 1** takes a free-form date (past dates allowed), a hard-coded 8 a.m. to 5 p.m. list, hourly or full-day, and an hours count from 1 to 12. The "Available at the selected time" banner is hard-coded (`:429-441`).
3. **Step 2** collects name, email and phone.
4. **Step 3** shows the client-computed price, a fake "price locked" notice, a promo field that changes nothing, and a **Stripe placeholder div** (`:581-598`).
5. **Submit** POSTs `/api/rentals/reservations` with `{ productId, date, startTime, duration, hours, customer, promoCode, totalPrice }` (`:231-240`).
6. **API:**
   - `shared/api.ts:8` defaults to `https://api.helm.com`, a three-label host, so `tenantMiddleware` (`tenant.ts:52-61`) resolves subdomain `"api"` and returns **404 Tenant not found** in production. The `x-helm-tenant-id` header (`api.ts:40`) is **ignored** by the server.
   - Next, `clerkAuth` returns **401**.
   - Next, Zod returns **400**: no `customerId`, `rentalProductId`, `startDate` or `endDate`.
   - The widget would also show a generic message, because it reads `body.message` while the API returns `{ error }` (`api.ts:49`).
7. **No confirmation email** is sent, although the success screen promises one (`:258-261`).

| # | Location | Problem | Failure scenario | Fix | Sev | Eff |
|---|---|---|---|---|---|---|
| 5.1 | `rentals.ts:294` | No public endpoints; the whole router requires staff auth. | Online booking is impossible. | Add a `/api/public/rentals/*` router: `GET catalog`, `GET availability`, `POST quote`, `POST checkout` (creates a hold and a PaymentIntent), plus a Stripe webhook that confirms. | P0 | L |
| 5.2 | `tenant.ts:52-66`; `widgets/shared/api.ts:8,40` | Tenant resolution depends on the Host header; widget calls go to `api.helm.com`, which resolves to subdomain "api". **Dev fallback:** if no tenant matches outside production, the **first tenant** is used. | Widget calls 404 in production. In staging, every widget hits tenant #1. | For public routes, resolve the tenant from a **public widget key** (`data-helm-widget-key`, mapped to tenant and allowed origins), validated against `Origin`. Never accept a raw tenant UUID as authority. Remove or guard the dev fallback with an explicit env flag. | P0 | S |
| 5.3 | `RentalBookingWidget.tsx:197-201,239` | The price is computed client-side and sent as `totalPrice`. | If a future implementation trusts it, the user edits the request and pays $1. (The current server would recompute, which is correct.) | The server is the only price authority. The widget displays the `POST /quote` result; checkout sends the `quoteId` only. | P0 | S |
| 5.4 | `RentalBookingWidget.tsx:581-598` | No Stripe integration. `Reservation.stripePaymentIntentId` exists but is unused. Stripe Connect code exists for terminal and invoices (`services/stripe-terminal.ts`, `routes/payments.ts:335`). | No revenue can be collected online. | Stripe Payment Element on the tenant's connected account (`stripeAccount: tenant.stripeAccountId`, application fee). Confirm the reservation only on the `payment_intent.succeeded` webhook (idempotent). Support deposit-only and pay-in-full options. | P0 | M |
| 5.5 | `index.ts:53` (`app.use(cors())`); no rate-limit middleware anywhere in `apps/api/src` | Open CORS for all routes; no rate limiting, bot protection or CAPTCHA. | Inventory-hold spam (bots create PENDING holds to block a competitor's July 4 fleet); card-testing through checkout. | Per-IP and per-widget-key rate limits (`express-rate-limit` backed by Redis); per-origin CORS on public routes; Turnstile or hCaptcha on checkout; Stripe Radar; a cap on concurrent holds per email or IP. | P0 | S |
| 5.6 | `RentalBookingWidget.tsx` | No waiver/e-sign, terms acceptance, party size versus capacity, renter age, boater-education card upload, add-ons, cancellation policy disclosure, or timezone display. | Liability exposure; capacity violations (a USCG capacity plate limits passengers); disputes ("I wasn't told the policy"). | Add steps for party size, add-ons, renter requirements (DOB, boater card), policy and waiver acceptance (link to the e-sign flow from commit fde3bc5), then payment. | P0 | M |
| 5.7 | `RentalBookingWidget.tsx:370-377` | A past date can be selected; there is no minimum lead time and no maximum booking horizon. | Bookings for yesterday or for 2031. | Validate server-side per product (lead time, horizon); the date picker shows only available days. | P1 | S |
| 5.8 | `RentalBookingWidget.tsx:250-266` | The success screen shows no confirmation number, no add-to-calendar, and no manage or cancel link. | Customers call the marina to confirm. | Show a reservation number, an ICS file, and a magic link to the portal's "manage booking" page. | P1 | S |
| 5.9 | `apps/portal/src/pages` | **The portal has no rental features:** no booking, upcoming or past rentals, waiver signing, document upload, receipts, or self-service cancel or reschedule. | Members (slip holders, who are the best rental customers) cannot rent through their account. | Add Portal Rentals pages: list, detail, cancel/reschedule under policy, waiver, and "Book" (reusing the widget component with prefilled identity and member pricing). | P1 | M |
| 5.10 | (missing) | No customer de-duplication on public bookings (the widget sends raw customer info; the API needs a `customerId`). | Duplicate customer records for every booking. | Upsert the customer by tenant and email (normalized) and phone; `customer-merge.ts` exists and can be reused. | P1 | S |
| 5.11 | (missing) | The widget cannot be configured per tenant: no location filter, theming beyond one color, or language. There is no widget config endpoint. | Multi-location marinas cannot embed per dock. | `GET /public/widget-config` (products, locations, branding, policies, module enabled). | P2 | S |

---

## 6. Back-office booking and operations findings

### Flow 5: staff booking, modification and cancellation
- **Staff booking:** **there is no booking form in the staff app.** The "New Booking" button has no handler (`Rentals.tsx:481`). The Reservations tab lists mock `RESERVATIONS` (`:77-88`), and its Check In, Check Out and Cancel buttons call `showMsg` only (`:705-708`). The API endpoint (`POST /reservations`) creates bookings directly as **CONFIRMED with no payment** (`:832`).
- **Cancellation math** (`rentals.ts:1102-1122`): rules are sorted by `hoursBeforeStart` descending, and the first rule with `hoursUntilStart >= threshold` wins; `refund = round(totalCents × pct/100)`. The logic is sound for a simple tiered policy, but see the defects below.

| # | Location | Problem | Failure scenario | Fix | Sev | Eff |
|---|---|---|---|---|---|---|
| 6.1 | `Rentals.tsx:875-1253` | The staff Rentals page is mock data throughout. API paths are doubled (`/api/api/...`). Even with the path fixed, responses come back as `{ data: [...] }`, while the page expects an array, so `products.filter` would crash. `/pricing-rules` and `/promo-codes` do not exist. "+18% vs last month" is hard-coded (`:954`). `avgRating` is NaN with zero products (`:910`). | Staff see fake bookings and fake revenue. Real operations are impossible. | Rebuild against real endpoints: unwrap `.data`, remove the mock fallbacks in production builds, and show empty or error states instead. Fix `API_BASE`, or strip `/api` from all `useApi` paths, app-wide. | P0 | L |
| 6.2 | (missing) | No staff booking or quote UI: customer search or create, product, unit, time, add-ons, price preview with manual override and reason, payment (card on file, terminal, cash), deposit hold. | Walk-up and phone bookings cannot be taken. | Build a booking drawer that uses the same quote and checkout service as the widget, plus staff-only price override (audited) and "send payment link". | P0 | M |
| 6.3 | `rentals.ts:832` | Staff-created reservations are CONFIRMED with no payment and no invoice. **Rentals never create an Invoice, Payment or GL entry.** `gl-posting.ts` has no rental revenue account mapping, although Settings shows GL 4300. | Rental revenue never reaches AR, GL or QBO; reconciliation is impossible. | On confirmation, create an Invoice with line items (3.13) or a POS transaction, and post revenue at checkout (recognize at completion) plus deposit liability. Integrate with the existing billing and GL services. | P0 | M |
| 6.4 | `rentals.ts:1094-1100` | Cancellation is allowed from CHECKED_IN and NO_SHOW. | An in-progress rental is "cancelled" with a refund. | State machine: cancel only from PENDING or CONFIRMED; add a separate "early return" flow. | P1 | S |
| 6.5 | `rentals.ts:1106-1122` | No refund is actually issued (no Stripe refund). The policy is read live, not snapshotted (Reservation has no `cancellationPolicyId`). `RentalProduct.cancellationPolicyId` is ignored. The `isWeatherPolicy` flag is ignored. The refund base is `totalCents`, which after checkout includes damage. Fees and tax are not separated. No staff override or reason (`cancellationReason` exists, unused). No credit or voucher option. | A marina edits a policy and changes refunds on existing bookings; customers never actually get money back; weather cancellations are charged under the normal policy. | Snapshot the policy JSON onto the reservation at booking. Refund via Stripe on the original PaymentIntent (partial). Define which lines are refundable (non-refundable booking fee). Add staff override with reason and an audit entry. Offer "refund to credit" (needs gift card or credit, section 8). | P0 | M |
| 6.6 | (missing) | No no-show handling. NO_SHOW can be set only through the generic PUT; there is no grace window, auto-mark, fee capture or release of inventory. | No-shows keep the boat blocked all day; no fee is collected. | Add a `POST /:id/no-show` endpoint (allowed after start + grace) that applies the policy (forfeit or fee) and releases the remaining time. Add a scheduler job to flag reservations still CONFIRMED at start + grace. | P1 | S |
| 6.7 | (missing) | No weather cancellation workflow: no bulk cancel or reschedule by date, time and location; no weather source; no customer notification. | On a small-craft-advisory day staff manually call 40 customers. | Bulk "weather cancel" action: choose a window, apply the weather policy (full refund, credit or reschedule), notify by SMS and email, and log the event. An NWS marine forecast feed is optional. | P1 | M |

### Flow 6: check-out and check-in (departure and return)
Vocabulary: the API's "check-in" means the boat leaves (CONFIRMED to CHECKED_IN); its "check-out" means the boat returns (CHECKED_IN to CHECKED_OUT). Industry usage is usually the reverse, so consider renaming to **Depart** and **Return**.

| # | Location | Problem | Failure scenario | Fix | Sev | Eff |
|---|---|---|---|---|---|---|
| 6.8 | `rentals.ts:944-997` | Departure has **no gating**: no signed waiver, renter ID or license, boater-safety card, payment, deposit hold, safety briefing, or time window (it can be done days early or late). It also fails at runtime (`checkedInAt`). | An unlicensed 16-year-old leaves on a jet ski without a waiver. This is a serious liability problem, since many US states require boater education cards for personal watercraft (PWC) or rental operators. | Run a pre-departure checklist. Hard blocks: waiver signed by every adult (or the renter plus listed operators), boater card verified when the product requires it, payment complete, deposit authorized. Record the staff member, time, start engine hours, fuel level, photos and the operator's ID number. | P0 | M |
| 6.9 | `rentals.ts:1001-1076` | Return: overtime is charged only when an hourly rate exists, pro-rated to the minute, with no grace period and no late-fee tiers. No fuel charge. No engine hours. Damage is a free-form amount added to `totalCents`, which mutates the original price. Nothing is charged to the card. It also fails at runtime (`checkedOutAt`). | Late returns are under- or over-charged; fuel is never billed (often the second-largest revenue line); damage cannot be collected from the deposit. | Return inspection: end fuel (metered gallons × price, using the Fuel module's price) or flat refill tiers; end engine hours (update the unit); photos; damage items with amounts. Create **separate** post-rental charge lines. Capture from the deposit hold, or charge the card on file (SetupIntent saved at booking), then release the remainder. | P0 | M |
| 6.10 | `schema:769-786`; `rentals.ts:834` | **No rental security deposit flow.** `SecurityDeposit` is tied to `SlipContract` (`contractId`), with no `reservationId`. The reservation's `depositAuthId` is unused. Stripe authorizations expire after **7 days** (online card payments), so multi-day rentals booked weeks ahead cannot rely on an authorization made at booking. | Damage cannot be recovered; deposits are not tracked in the GL liability account. | Add `SecurityDeposit.reservationId`. At booking, save the payment method (SetupIntent). At departure, create a manual-capture PaymentIntent for the deposit (or use incremental authorization where supported). At return, capture a partial amount for damage or fuel and cancel the rest. Show deposit status in the UI. | P0 | M |
| 6.11 | (missing) | No waiver or e-sign link to reservations. The e-sign flow from commit fde3bc5 is contract-oriented. `waiverSelected` (damage-waiver add-on) is a separate concept from the liability waiver and is easily confused with it. | No signed liability release on file for a rental accident. | A `RentalWaiver` template per product or location (versioned), a signature request per participant sent with the confirmation, kiosk or tablet signing at the dock, and the signed PDF stored in S3. Rename `waiverSelected` to `damageWaiverPurchased`. | P0 | M |
| 6.12 | (missing) | No boater-education or license capture or verification. No age check (many states set a minimum PWC operator age). No livery-law compliance fields (operator briefing record, required in some states). | Regulatory exposure for marinas in states with livery laws, such as Florida's livery permit and pre-rental instruction rules. | Add renter and operator profiles (DOB, ID, boater card number, state and expiry, image), product requirements (2.5) enforced at booking (soft) and at departure (hard), and a briefing checklist with a timestamp and staff signature. | P0 | M |
| 6.13 | (missing) | No captain or crew assignment for captained charters; no staff scheduling link (the Shift model exists). | A captained "Fishing Charter 30" cannot be sold correctly. | Treat a captain as a resource (an add-on that consumes staff availability). | P2 | M |

---

### Flow 8: Automations (pre-arrival reminders, post-rental NPS)

| # | Location | Problem | Failure scenario | Fix | Sev | Eff |
|---|---|---|---|---|---|---|
| 8.1 | `services/email-automation.ts:354-430`; whole repo | Rental triggers (`rental_booking_confirmed`, `rental_pre_arrival`, `rental_post_return`, `rental_abandoned_cart`, `rental_nps_survey`) are defined, but **`processAutomationTrigger` is never called** anywhere. | No confirmation, reminder or survey email is ever sent. The widget promises a confirmation. | Emit domain events from the booking service (confirmed, departed, returned, cancelled, hold expired) that call `processAutomationTrigger`, and schedule the delayed ones (pre-arrival at T-48h or T-24h, NPS at return +24h) as delayed BullMQ jobs, recorded in `RentalAutomationEvent`. | P0 for the confirmation email, P1 for the rest | M |
| 8.2 | `workers/index.ts:115-118` | The automation worker queries `customer` with `tenant_id`, `first_name` and `last_name` (snake_case), but the Prisma fields are camelCase. Every automation job throws. | Even if events were enqueued, nothing would send. | Use camelCase fields; add a worker smoke test. | P0 | S |
| 8.3 | `workers/index.ts:160,182` vs `schema:154-165` | Job type names (`POST_BOOKING`, `POST_RENTAL`) do not match the enum (`POST_BOOKING_CONFIRM`, `POST_RENTAL_THANKS`). `CHECK_IN_REMINDER` and `GOOGLE_REVIEW_PROMPT` have no handlers. The worker templates are hard-coded and slip-oriented ("have your registration and insurance documents ready", which is wrong for renters). | Mismatched events are dropped as "Unknown automation type". | One enum shared by the producer and consumer; use the email-automation templates (tenant-editable) instead of inline HTML. | P1 | S |
| 8.4 | `RentalAutomationEvent`, `NpsSurvey` models | Never written or read. The NPS email asks the customer to "reply with your score", so there is no response capture. No Google review prompt for promoters. | NPS data is never collected. | Create a tokenized NPS landing page (0-10 plus comment) that writes `NpsSurvey`. Promoters (9-10) get a Google review link, recording `googlePromptSentAt`. Detractors (0-6) alert the manager. | P2 | M |
| 8.5 | (missing) | No SMS reminders for rentals (an SMS worker exists) and no day-of "your boat is ready / weather update" messages. Abandoned-cart flows need PENDING holds with contact info first. | Higher no-show rate. | Send an SMS reminder at T-24h and T-2h, with a link to the waiver if unsigned. Run abandoned cart only after hold expiry, and only with marketing consent (communication-prefs exists). | P2 | S |

---

## 7. Algorithmic pricing job assessment (`apps/api/src/jobs/algorithmic-pricing.ts`)

**What it does:**
- For each active product with 20 or more reservations whose `startDt` is within the last 90 days, it computes `bookingRate[dow] = bookingsStartingOnThatWeekday / 13` and the average lead days.
- For each of the next 30 days, it starts from `basePriceCents` and applies a step multiplier by booking rate (×1.20, 1.15, 1.05, 0.90 or 0.85), then ×1.05 or ×0.95 for lead time.
- It clamps to floor and ceiling and creates an `AlgorithmicSuggestion` when the result differs from base by more than 10%.

**Can it run?**
- `scheduleAlgorithmicPricing()` (`:186`) is **never called**.
- The worker (`workers/index.ts`) is not started in docker-compose. The worker service runs `dist/jobs/renewal-job.js` (`docker-compose.yml:90`), and the API image runs only `dist/index.js`.
- Even when triggered, the scheduled payload is `{}`, so the worker takes the all-tenants path: `prisma.tenant.findMany({ where: { active: true } })` (`workers/index.ts:101`). **Tenant has no `active` column** (it has `status`), so it throws.

| # | Location | Problem | Failure scenario | Fix | Sev | Eff |
|---|---|---|---|---|---|---|
| 7.1 | `algorithmic-pricing.ts:186-192`; `workers/index.ts:101`; `docker-compose.yml:90` | Never scheduled; the worker is never launched; the all-tenant query is invalid. | The feature advertised in the UI does nothing. | Register repeatable jobs at worker boot. Run `workers/index.ts` as the worker container command. Iterate tenants with `status: 'ACTIVE'` and the rentals module enabled. Fan out one job per tenant. | P1 | S |
| 7.2 | `:139-142` | **Floor/ceiling clamp with nulls.** `Math.min(null, x)` is 0, so when `ceilingPriceCents` is null the suggestion becomes **$0** (or the floor). The reason text says "suggest discount". | Any product created without a ceiling gets "$0" suggestions for every day. Approving one would make the boat free (if 7.6 were fixed). | Clamp only when the bound is non-null; reject suggestions at or below 0; require floor and ceiling for products with algorithmic pricing enabled. | P1 | S |
| 7.3 | `:42-48,69-72` | Wrong demand signal. It counts **all statuses** (including CANCELLED and NO_SHOW), includes **future** bookings (it filters on start ≥ 90 days ago with no upper bound), and counts bookings per weekday instead of **utilization**: it ignores duration, unit count and operating hours. For a fleet of 6, `bookingRate` routinely exceeds 1, so the result is always +20%. A cancellation spike reads as high demand. | Systematically wrong prices; worst for multi-unit fleets. | Use utilization = booked unit-hours ÷ available unit-hours per weekday or date (excluding cancelled and no-show bookings, past dates only). Also measure the booking **pace** for the target date (on-the-books versus historical at the same lead time). | P1 | M |
| 7.4 | `:108,144-146` | Ignores the existing pricing rules and overrides: it compares against `basePriceCents` only. Seasonal and weekend rules are then applied **on top** of an approved suggestion (if it were applied), so the adjustment is double-counted. `avgPriceCents` is computed but unused. | Weekend surcharge applied twice. | Compute the suggestion against the **rule-engine price** for that date, and express it as a per-date absolute price (override semantics, 3.5 step 5). | P1 | S |
| 7.5 | `:102-167` | Not idempotent: each weekly run creates up to 30 new PENDING suggestions per product, overlapping the previous run's dates (about 23 duplicates per product per week). No expiry; past-date suggestions remain PENDING. Uses server UTC `getDay()`. | The suggestion inbox fills with stale duplicates; staff stop using it. | Unique `(rentalProductId, suggestedDate)`: upsert, supersede older PENDING suggestions, expire them after the date passes, compute in the tenant timezone, batch the writes. | P1 | S |
| 7.6 | `rentals.ts:1188-1249` | The approve flow writes `pricingRule.baseRateCents` (not a column) using `suggestion.pricingRuleId` and `suggestedRateCents` (not columns), with status ACCEPTED or REJECTED (the enum is APPROVED or IGNORED). Even if fixed, the design applies a **date-specific** suggestion to a **permanent** rule. | Approving one Tuesday's discount would discount every Tuesday forever. | Approval upserts a `PricingCalendarOverride { overrideDate: suggestedDate, priceCents: suggestedPriceCents, createdBy: 'algo:<suggestionId>' }` in the same transaction as the status update. Re-check that the suggestion is still within floor and ceiling and in the future. Add a "bulk approve" option. | P1 | S |
| 7.7 | `:30-34` | Runs outside the tenant context, so the extension is bypassed. The product query is tenant-filtered, but the reservation query relies on product id only. That is acceptable, but fragile. | — | Run the job inside `tenantStore.run({ tenantId })` once the model fixes land. | P2 | S |
| 7.8 | (design) | No explanation of confidence, no guardrails on maximum change per week, no autopilot option, no measure of whether accepted suggestions improved revenue. The UI has no suggestion inbox (the simulator's "algorithmic" step is fake). | Staff cannot trust or evaluate it. | MVP: keep the job behind a feature flag. Ship rule-based pricing first, then an inbox with approve or ignore, a cap (±20%) and accepted-versus-control reporting. | P2 | M |

**Verdict:** this is not sound enough to launch. Disable it for launch and ship explicit rules (season, weekday, date override, surge) first. Revisit with utilization-based logic after one season of real data.

---

## 8. Competitive gap list (vs FareHarbor, Peek Pro, Checkfront, Bookeo, Boatsetter, Freedom Boat Club, Molo/Dockwa rentals)

| Capability | Best-in-class | Helm today | Gap and recommendation | Priority |
|---|---|---|---|---|
| **Resource versus product modeling** | Checkfront and Bookeo separate *items* from *resources* or units; Peek has products, resources and shared resource pools (for example a captain shared across tours). | One product row, no units. | Model products, units and resource pools (2.3). Resource pools enable captains, guides and shared docks. | P0 |
| **Rate cards and durations** | Fixed time slots (9-1, 1-5), flexible hourly with minimums, half-day, full-day, multi-day; durations unlock rules ("afternoon opens after morning books"). | A single base price; durations exist only in the UI. | 2.4. Persist the Durations tab concept. | P0 |
| **Capacity per time slot** | FareHarbor and Peek: per-slot capacity (seats) for tours; per-unit capacity (passengers) for boats. | None. | Product capacity (passengers, validated against party size) plus slot capacity for tours or classes. | P1 |
| **Add-ons and upsells** | Fuel packages, captain, tubes, wakeboards, coolers, ice, fishing gear, GoPro, damage waiver (optional or required), with inventory-tracked add-ons. | None (damage waiver is a dead field). | `RentalAddon` (price per booking, hour or person; inventory-limited; required or optional), shown in widget step 2. These are high-margin. | P1 |
| **Damage waiver / insurance** | Boatsetter bundles insurance; FareHarbor and Peek offer an optional damage-waiver fee. | Dead field. | Optional or required waiver fee that changes the deposit amount (waiver bought means a lower hold). | P1 |
| **Deposits and holds** | Peek and Checkfront: automatic authorization holds and post-trip charges. | None. | 6.10. | P0 |
| **Waivers and e-sign** | Smartwaiver and WaiverSign integrations; per-guest waivers sent with the confirmation. | None. | 6.11. | P0 |
| **Boater license / education** | Boatsetter verifies boating experience; livery operators collect state boater cards. | None. | 6.12. | P0 |
| **Payments** | Full payment, deposit plus balance, saved cards, payment links, Apple Pay and Google Pay, POS. | None. | Stripe Payment Element plus Terminal (exists). | P0 |
| **Gift cards and vouchers** | FareHarbor, Peek and Bookeo sell gift cards redeemable on bookings. | None. | `GiftCard` (code, balance, ledger) and store credit, also used for weather-cancel credits. | P2 |
| **Memberships / boat-club credits** | Freedom Boat Club: member reservation windows (rolling N days), limits on active reservations, weekday/weekend credits, no per-trip charge, member-only fleet; Molo and Dockwa link slip holders to rental perks. | None. | `RentalMembership` plans: credit buckets (weekday or weekend), booking horizon, maximum concurrent reservations, member pricing, plus portal booking. A major differentiator for marinas with slip-holder customers. | P2 (post-launch roadmap) |
| **Weather cancellations** | Bulk weather cancel with rebook or credit; weather notices. | Flag only. | 6.7. | P1 |
| **Waitlists** | Peek and Bookeo: waitlist on sold-out slots with automatic offers. | A slip waitlist exists (WaitlistEntry); nothing for rentals. | A rental waitlist per product, date and slot; notify on cancellation (with a hold window). | P2 |
| **Multi-unit / group bookings** | Book 3 jet skis plus 1 pontoon in one cart. | One product per reservation. | Cart (a `Booking` with many `ReservationItem`s), one payment, per-unit waivers. | P1 |
| **Packages / bundles** | Sunset cruise with dinner; a tube package; multi-day "week at the lake". | None. | Packages as products that consume multiple resources. | P2 |
| **OTA / channel distribution** | FareHarbor and Peek connect to Google Things to Do, Viator, Expedia, GetYourGuide and Airbnb Experiences through Reserve with Google feeds and OCTO-standard APIs. | None. | Phase 2: implement the **OCTO** API (availability, booking, cancel) to reach resellers, plus a Google Things to Do feed. Requires a solid availability service (4.x) and partner pricing (net rates). | P2 |
| **Dynamic pricing** | Peek and FareHarbor dynamic pricing: by demand or occupancy and lead time, with price floors. | Broken (sections 3 and 7). | Fix the rules engine first; add algorithmic pricing later. | P1 |
| **Promo codes** | Code types (%, $, free add-on), product scope, blackout dates, per-customer limits. | Model only. | 3.10. | P1 |
| **Customer self-service** | Manage booking: reschedule within policy, add guests, sign waivers, pay balance. | None. | 5.9. | P1 |
| **Check-in tools** | Tablet manifest, QR check-in, digital pre-departure checklist, photo capture. | None. | 6.8 and 6.9; a mobile-friendly dock view. | P1 |
| **Fleet maintenance** | Engine-hour-based service intervals, out-of-service blocks. | None. | Unit engine hours and service thresholds, plus blocks (4.4). | P2 |
| **Reporting** | Utilization by unit, revenue per available hour (RevPAH), channel mix, no-show rate, add-on attach rate. | A basic rental-utilization report (bookings and revenue per product). | Add per-unit utilization, RevPAH and attach-rate reports once the data exists. | P2 |
| **Embeds and booking UX** | Calendar-first, live availability, inline price changes per date, mobile-optimized, Apple Pay. | Mock four-step form. | 5.x. | P0 |

---

## 9. Prioritized fix and build list

### Decision first (day 0)
- **Option A, recommended if launch is within 4-6 weeks:** launch without rentals. Hide the module server-side, return 404 from `/api/rentals/*` and `/public/rentals/*` when disabled, and remove the widget from marketing. Keep the mock UI out of production builds; it shows fake revenue numbers.
- **Option B:** commit to the MVP below, about **6-9 engineer-weeks** for one strong full-stack engineer plus QA.

### Phase 0: foundation (P0, about 1.5-2 weeks)
1. **Pick the canonical model** and migrate. Extend the Prisma schema with RentalProduct (capacity, category, requirements, buffers, images, GL and tax category), **RentalUnit**, **RentalRate** (rate card), RentalUnitBlock, ReservationLineItem, `Reservation.unitId`, `holdExpiresAt`, `policySnapshotJson`, `locationId`, and `tenantId` on all pricing child tables. Move from `db push` to **Prisma migrations** (needed for the exclusion constraint). Generate shared types from Prisma. Delete the stale `shared-types/rental.ts` model. (S/M) [2.1, 2.3, 2.4, 2.7]
2. Fix `TENANT_SCOPED_MODELS`, and add a boot-time assertion that each listed model has a `tenantId` field. (S) [3.2]
3. Add a CI gate: `tsc --noEmit` across the workspaces (currently 337 API errors), plus integration tests against a real Postgres (Testcontainers) for the rentals routes, replacing the mocked tests. (M) [tests]
4. Fix the web `API_BASE` double `/api` prefix app-wide and unwrap `{ data }` responses. (S) [6.1]

### Phase 1: pricing and availability core (P0, about 2 weeks)
5. Write a **pure pricing function** in a shared package with the canonical pipeline (3.5): rate card, date override, seasonal, peak day, surge, clamp, multi-day and lead time, add-ons, promo, waiver and fees, tax, with line items and rounding. Cover it with property-style and unit tests (boundary durations, wrap-around seasons, DST transitions, timezone). (M) [3.3-3.14]
6. Build an **availability service**: unit-based, with buffers, blocks, operating hours, slot generation from the rate card, and evaluation in the location timezone. (M) [4.3, 4.4, 4.6, 4.8]
7. Booking transaction: hold (PENDING plus expiry), then confirm, with a **Postgres exclusion constraint** and a serializable retry. Add a hold sweeper job. Run modifications through the same path. Add a status state machine. (M) [4.1, 4.2, 4.5]
8. Rewrite `routes/rentals.ts` (staff) on top of steps 5-7: product, rate, rule, override and policy CRUD, quote, booking, modify, cancel, depart, return, no-show. (L)

### Phase 2: money and compliance (P0, about 2 weeks)
9. **Public API** `/api/public/rentals`: widget-key tenant resolution with an origin allowlist, rate limiting, CAPTCHA on checkout, and a signed quote token. Remove the dev first-tenant fallback for public routes. (M) [5.1, 5.2, 5.5, 3.15]
10. Stripe on the connected account: Payment Element, a webhook that confirms bookings, a SetupIntent for card on file, and a manual-capture **deposit hold at departure** with partial capture at return. Refunds through the cancellation policy with a snapshotted policy. (M) [5.4, 6.5, 6.10]
11. Invoice and GL posting for rentals (revenue, tax, deposit liability) and QBO sync mapping. (M) [6.3]
12. Liability waiver e-sign per participant, plus boater-card and age capture with product requirements. Pre-departure hard gates. (M) [6.8, 6.11, 6.12]
13. Confirmation email (and ICS) through the email-automation service. Fix the worker field names and launch the worker process. (S) [8.1, 8.2]

### Phase 3: front ends (P0/P1, about 1.5-2 weeks)
14. Widget rebuild: live catalog and photos, a calendar showing available slots and prices, party size, add-ons, requirements, waiver acceptance, Stripe, and a confirmation number. (M) [5.3-5.8]
15. Staff Rentals page on real data: dock dashboard (today's departures and returns), availability grid, booking drawer, depart and return checklists with fuel, hours, damage and photos, rule editor with live quote preview, overrides calendar, promo CRUD. Remove the mocks, and wire or remove the Simulator and Calendar so they call the quote API. (L) [6.1, 6.2, 3.16, 3.17]
16. Make the module toggle tenant-scoped and enforced in the API. (S) [2.9]

### Phase 4: post-launch (P1/P2)
17. Weather bulk-cancel and credit; no-show automation; pre-arrival SMS and email; NPS with Google review prompt. [6.6, 6.7, 8.3-8.5]
18. Portal rentals: my bookings, self-service reschedule and cancel, waiver signing, and booking with member identity. [5.9]
19. Multi-unit cart, add-on inventory, packages, gift cards and credits. [section 8]
20. Algorithmic pricing v2: utilization and pace based, idempotent per-date suggestions applied as overrides, guardrails, inbox UI, performance tracking. [7.x]
21. Boat-club memberships and credits (Freedom Boat Club-style). [section 8]
22. OCTO API and Google Things to Do feed for OTA distribution. [section 8]

### Quick wins (do these regardless of the A/B decision)
- Remove `Rental` and `CancellationRule` from `TENANT_SCOPED_MODELS`, and the 4 tenantless models (or add the columns). (S)
- Guard the dev first-tenant fallback in `tenant.ts:64-66` behind an explicit `ALLOW_TENANT_FALLBACK=1`. (S)
- Fix the null clamp in `algorithmic-pricing.ts:139-142` and `tenant.findMany({ where: { active: true } })` in `workers/index.ts:101`. (S)
- Remove fake claims from the UI ("+18% vs last month", "Price locked for 15 minutes", "Available at the selected time", "You'll receive a confirmation email"). (S)
