# 06 — Frontend, Design System & Staff UX Audit

**Scope:** `apps/web` (staff dashboard), `apps/portal` (boater portal), `apps/admin` (platform admin), `apps/widgets` (embeddable booking/lead widgets), `packages/ui-kit`. API route files in `apps/api/src/routes` were read only to check that the frontend calls line up with them.
**Method:** Every page and component file was read or grepped. `tsc --noEmit` was run on `apps/web`. `vite build` was run on `apps/web` and `apps/widgets`, with output sent to a scratch directory. No source files were changed.
**Severity:** P0 = blocks launch, P1 = fix before GA, P2 = polish or tech debt. **Effort:** S < 1 day, M = 1–3 days, L = 1–2+ weeks.

---

## 0. Executive summary

The frontends are **a high-fidelity clickable prototype, not a working product.** The main points:

1. **Almost every screen shows hardcoded mock data, and it falls back to mock data silently.** The pattern is `const x = apiData ?? MOCK_X`, and it appears on all but one of the 27 routed web pages. Onboarding is the exception; a few other pages are mock-only. The portal makes **zero** API calls. The admin app is all mock except one page. Neither widget fetches availability or products.
2. **No page reads the API's response envelope correctly.** The API returns `{ data: [...], pagination }` or nested objects. `useApi` stores the raw body, and **no file in `apps/web` reads `.data`** (grep for `?.data` / `.data.` returns 0 hits). The day the backend answers successfully, list pages call `.filter`/`.reduce` on an object and crash. There is one ErrorBoundary for the whole app, so the crash replaces the entire app, sidebar included, with "Something went wrong".
3. **Mutations lose data without telling anyone.** About 20 create/update/pay/sign flows either never call the API, call routes that don't exist, send bodies the API's validation rejects, or wrap the body as `{ body: … }`. Every one of them then **shows success anyway.** Examples: `PaymentModal` reports success on failure "for mock mode", POS sales are never POSTed, Transient bookings are only kept in local state, and contract edits are applied optimistically and never rolled back.
4. **The booking windows, invoicing and contracts screens do not work end to end today.** Specifics:
   - You cannot check in a transient guest. There is no Check In button.
   - Check Out throws a `ReferenceError`.
   - You cannot create a rental reservation from the staff UI.
   - You cannot finalize, send or void an invoice. The buttons have no handlers.
   - Payments are posted without the required `customerId`.
   - Contracts are created against slug IDs such as `'james-harborview'`.
   - Signing never happens. The backend fakes the request ID, and the webhook is behind staff auth.
5. **The public widgets cannot work in production.** The causes:
   - They are ES-module bundles, but the documented embed is a classic `<script>` tag.
   - The tenant is resolved from the hostname, so `api.helm.com` resolves to subdomain `api` and returns 404.
   - The booking endpoints require Clerk staff auth.
   - The payloads don't match the API schemas.
   - Stripe is a placeholder box, yet the button says "Pay $X".
6. **There is no auth guard, no sign-out, no 404 route and no onboarding redirect.** The web app never renders `<SignedIn>/<SignedOut>`. The admin app has no Clerk provider at all.
7. **The "responsive CSS" commits do nothing.** The 190 `helm-*` classes are defined in `packages/ui-kit/src/styles/global.css`, and **no app imports that file.** Only the six layout classes in AppLayout's inline `<style>` take effect.
8. **There is no design system in practice.** `@helm/ui-kit` is imported by zero apps. There are 4,453 inline `style={}` props, 123 distinct hex colours, **0 `htmlFor`**, and 4 `aria-*` attributes across about 34k lines. Cyan link text is 1.77:1 contrast.
9. **The build is red.** `tsc` fails in `apps/web` (`tsc && vite build`). There are 588 errors with the repo tsconfig; 56 remain after adding the DOM lib, including real bugs in Transient.tsx and InvoiceDetail.tsx. The web Dockerfile runs `npm ci` against a `package-lock.json` that doesn't exist (the repo uses pnpm).

What is in good shape:
- The visual language is coherent (navy/cyan, mono numerals).
- The page structure is sensible.
- Some UX ideas are strong and worth keeping: rental availability grid, pricing calendar with rule breakdown, dock map, ESignatureFlow status tracker, POS quick-qty editing.
- The production bundle is small: 221 kB min / 64 kB gzip.

Do not rewrite the UI. Wire it up properly behind one typed data layer.

---

## 1. Frontend inventory

Legend for "Data": **Mock** = hardcoded only; **Mock-fallback** = calls the API but shows mock data on any error, and crashes when the call succeeds, because of the envelope problem; **Real** = genuinely API-driven.
State quality rating (A–F) covers loading, error, empty states, mutation integrity and validation.

### 1.1 `apps/web` pages (27 routed + 1 orphan)

| Page (file, LOC) | Purpose | Data | State | Notes |
|---|---|---|---|---|
| Dashboard.tsx (1073) | KPIs, revenue chart, tasks, activity, quick actions | Mock (4 report calls whose fields are never read) | F | KPIs read `.rate/.total/.score`, which the API doesn't return (it returns `summary.occupancyRate`, `totalOutstanding`). Date "Tuesday, March 25, 2026" is hardcoded (L428). The period selector does nothing. "New Invoice" quick action **throws the form data away** (L1015–1019). |
| Leads.tsx (565) | Pipeline/kanban, lead detail, form builder | Mock-fallback | D | `PUT /api/leads` has no id (L309). The local state starts as MOCK_LEADS (L304). |
| Waitlist.tsx (700) | Waitlist queue | Mock-fallback | D | POST declared, never called. "Add" is a fake `setTimeout` (L577). |
| Customers.tsx (342) | Customer list + create | Mock-fallback | C | Create refetches, but errors are swallowed. Only 25 rows load (API default `take`) with no pagination. |
| CustomerDetail.tsx (1076) | Customer 360 (boats, billing, docs, activity, merge, comm prefs) | Mock-fallback | D | **Any unknown id shows a fake customer** (L675). `PUT /api/boats/update` doesn't exist. Merge POSTs the wrong body (L1042). The page doesn't refetch when `:id` changes. |
| Slips.tsx (967) | Slip list, map, assign/edit | Mock-fallback | D | `PATCH /api/slips/:id` doesn't exist (L710). Add Slip posts `{}` (L374). "Assign" sets OCCUPIED without creating a contract. |
| Contracts.tsx (1060) | Contract list, create, edit, transfer, e-sign | Mock-fallback | F | See §9. |
| Billing.tsx (246) | Invoice list + create | Mock-fallback | F | See §8. |
| InvoiceDetail.tsx (497) | Invoice view, pay, GL | Mock-fallback + **fabricated default invoice** | F | See §8. |
| ARaging.tsx (177) | A/R aging | Mock-fallback | F | Not in nav. See §8. |
| ChartOfAccounts.tsx (277) | GL accounts | Mock-fallback | D | Not in nav. The API returns `{period, accounts}`. |
| Rentals.tsx (1253) | Products, availability grid, reservations, pricing settings | Mock-fallback + module-level mock generator | F | See §7. |
| POS.tsx (611) | Ship-store POS + shifts | Mock-fallback | F | **`createTransaction` is never executed** (L305, L314–337), so no sale is ever saved. Cashier "Jake M." and "8:00 AM" are hardcoded. The running total filters on `'2026-03-25'` (L402). |
| Fuel.tsx (492) | Fuel sales/deliveries/tanks | Mock-fallback | D | The backend itself is an in-memory array (fuel.ts). |
| Inventory.tsx (579) | Products, counts, POs | Mock (one useApi) | F | Save / Start count / Receive are `setTimeout(onClose)` fakes (L208, 236, 273, 311). |
| RentRoll.tsx (258) | Rent roll | Mock-fallback | D | Not in nav. Exports are fake (L172–174). |
| DockWalks.tsx (577) | Inspections, violations, pump-outs | Mock-fallback | D | `GET /api/dock-walks/violations` hits `/:id`. The violation PUT route doesn't exist. Offline support isn't wired. |
| Reports.tsx (650) | Report catalog + viewer | Mock | D | `POST /api/reports/generate` doesn't exist. Downloads are fake (L394). |
| Announcements.tsx (1018) | Compose/send, templates, automation | Mock | D | POST declared, never called. Send success is faked (L357). It also contains an automation module that duplicates EmailAutomation. |
| EmailAutomation.tsx (326) | (orphan) | Mock | — | The route redirects to /announcements (App.tsx L64), so this is dead code. The API router isn't mounted either. |
| Settings.tsx (1298) | Marina, team, rates, integrations, GL mapping, modules | Mock | F | `GET/PUT /api/settings` doesn't exist (L264–265). "Saved", "Stripe disconnected", "QBO sync started" and "Invitation sent" are all fake banners (L267, 991, 1007, 1089). |
| Onboarding.tsx (847) | Tenant signup wizard | Real (raw fetch) | C | `API_BASE` defaults to `http://localhost:3001` in production builds (L3). Nothing redirects new tenants here. |
| Transient.tsx (497) | Transient guests | Mock-fallback | F | See §7. |
| Ramp.tsx (450) | Launch ramp tickets/passes | Mock-fallback | D | `GET/POST /api/ramp` doesn't exist (`/tickets`). Ramp routes also hang (see §3). |
| Concierge.tsx (540) | Service requests/vendors | Mock-fallback | D | `GET /api/concierge` doesn't exist (`/requests`). The routes hang. |
| AuditLog.tsx (249) | Audit trail | Mock-fallback | C | Envelope mismatch. The USERS filter list is hardcoded. |
| PortfolioDashboard.tsx (471) | Multi-property rollup | Mock | F | Not in nav. 13 TS errors (style functions spread as objects). |

### 1.2 `apps/web` components

| Component | Used by | Data | Notes |
|---|---|---|---|
| AppLayout | App | Mock locations | See §2 |
| InvoiceForm | Billing, Dashboard | Mock customers | See §8 |
| PaymentModal | InvoiceDetail | — | Always shows success. See §8 |
| ESignatureFlow | Contracts | Real (raw fetch) | See §9 |
| PricingCalendar | Rentals | Mock engine | See §7 |
| PriceSimulator | Rentals | Mock | Client-side pricing engine that duplicates the server's |
| CustomerForm | Customers, CustomerDetail | — | 73 TS errors with the repo tsconfig (DOM lib) |
| CustomerMerge | CustomerDetail | MOCK_TARGETS | Destructive action against mock targets |
| ConversionWizard | LeadDetailPanel | AVAILABLE_SLIPS hardcoded | |
| LeadDetailPanel / LeadFormBuilder | Leads | Mock activity/staff | |
| CommunicationPrefs | CustomerDetail | Real | Has the only proper aria-label in the app |
| DockMapSVG / SlipDetailPanel | Slips | Mock docks A–C | |
| ReportViewer | Reports | Mock | 32 TS errors (style fns not callable) |
| HelpCenter | AppLayout | Mock tickets | Floating 48px button, bottom-right, sits over POS totals and mobile content |
| Toast | main + 5 pages | — | Good component, but only 5 files use it |
| **OfflineBanner, QRScanner, BarcodeScanner** | **none** | — | **Unused.** The offline dock-walk feature is not wired (§6) |

### 1.3 `apps/portal` (10 pages) — all Mock, rating F

Dashboard, Invoices, InvoiceDetail, PaymentMethods, MyBoats, Insurance, ConciergeRequests, WaitlistStatus, Announcements, Messages. **There are no fetch calls and no `/api/portal` routes in the API.** "Pay $X Now" (InvoiceDetail L246) and "Download PDF" (L110, Invoices L124) have no handlers. The marina name is hardcoded as "Bayview Marina", while the staff app hardcodes "Bayshore Marina". Messages is routed but missing from `navItems`. There are no portal pages for contracts or signing, bookings, or autopay. ClerkProvider is mounted, but no route checks sign-in.

### 1.4 `apps/admin` (7 pages) — Mock except TenantDetail, rating F

Dashboard, Tenants, Billing, Analytics, Support and PlatformSettings are entirely hardcoded arrays. TenantDetail calls `/api/admin/*` through `apiFetch`, which sends **no bearer token**, and `main.tsx` has **no ClerkProvider**. Every call 401s, because `requirePlatformAdmin` has no dev bypass. **There is no auth gate on the admin UI.**

### 1.5 `apps/widgets` (3 widgets) — Mock data, cannot submit successfully

| Widget | Data | Submit |
|---|---|---|
| transient-booking | `MOCK_SLIPS` (L61). Never calls `/api/transient/availability` | `POST /api/transient` with a wrong schema; endpoint is auth-only and hangs |
| rental-booking | `MOCK_PRODUCTS` (L57). Availability is a static "✅ Available" (L429–441) | `POST /api/rentals/reservations` with a wrong schema; auth-only |
| lead-form | form | `POST /api/lead-forms/:formId/submit` — the only public route, but blocked by tenant-by-hostname; reCAPTCHA token is a literal placeholder (L122); `boatLength` sent as a string where the schema wants a number |

### 1.6 `packages/ui-kit`

Exports Button, Card, StatusBadge, Table, Input, Modal (with role="dialog"), Sidebar, tokens and global.css. **No app imports any of it.** The web tsconfig `paths` point to `../../../packages/...`, which resolves outside the repo. The package `main` points at `dist/`, which is never built.

---

## 2. Routing & navigation

| # | File:line | Issue | User impact | Fix | Sev | Eff |
|---|---|---|---|---|---|---|
| R1 | web/App.tsx:35–68, main.tsx:169–181 | **No auth guard.** No `<SignedIn>/<SignedOut>/<RedirectToSignIn>` anywhere in web. `useApi` sends `Authorization: Bearer null` when signed out. | Unauthenticated visitors see the full staff UI with mock data. Real data calls 401 and quietly fall back to mock. | Wrap the `AppLayout` route in a `RequireAuth` element (Clerk `SignedIn`, else `RedirectToSignIn`). Add `/sign-in/*` routes. | P0 | S |
| R2 | AppLayout.tsx:370 | The avatar is a plain div: **no sign-out, profile or tenant switch** anywhere in the app. | Staff on shared front-desk PCs cannot log out. | Use Clerk `<UserButton/>`. Add a tenant switcher that calls the existing `POST /api/auth/switch-tenant`. | P0 | S |
| R3 | App.tsx (no `*` route) | No 404 route. Unknown URLs render an empty layout. | Typos and stale links look like a blank or broken page. | `<Route path="*" element={<NotFound/>}/>` inside the layout. | P1 | S |
| R4 | App.tsx:36 | `/onboarding` is never reached: no redirect when the tenant has no setup, and no link to it. | New tenants land on a mock dashboard. | After auth, call `GET /api/onboarding/:tenantId/status` (or `/api/auth/me`) and redirect if incomplete. | P1 | M |
| R5 | AppLayout.tsx:39–84 | Routed pages missing from nav: `/rent-roll`, `/portfolio`, `/billing/ar-aging`, `/billing/chart-of-accounts`. | A/R Aging and CoA can only be reached by typing the URL. | Add sub-nav under Money/Billing (see §10). | P1 | S |
| R6 | AppLayout.tsx:262 | Active state is exact match (`pathname === item.path`). | On `/billing/invoices/123` or `/customers/abc` nothing is highlighted. | Use `NavLink` or `matchPath(item.path + '/*')`. | P2 | S |
| R7 | AppLayout.tsx:195–212 | The breadcrumb title map covers 13 of 27 routes and has no params. | The header says "Helm" on Transient, Fuel, invoice detail and others. | Use route `handle` metadata plus real breadcrumbs (Billing › INV-…). | P2 | S |
| R8 | App.tsx:49–52, ModulesContext.tsx:1–55 | The Rentals module gate is stored in **browser localStorage**, not tenant settings. | One clerk switching modules off doesn't apply to colleagues. Clearing storage turns modules back on. | Load modules from tenant settings via the API. Gate nav, routes and API alike. | P1 | M |
| R9 | AppLayout.tsx:33–37, 221 | The location switcher is hardcoded "Bayshore Marina – …" and changes nothing. | Staff at multi-location tenants think they are filtering. They aren't. | Back it with `/api/admin/tenants/:id/locations` (or a tenant-scoped equivalent), put it in context, and send it as a query param. Hide it if there is only one location. | P1 | M |
| R10 | AppLayout.tsx:367 | The topbar Help button has no `onClick`. HelpCenter renders its own floating button. | Two help entry points, one of them dead. | Have the topbar button open HelpCenter. Remove the floating trigger. | P2 | S |
| R11 | Billing.tsx:214 / InvoiceDetail.tsx | The `?action=pay` deep link from the Billing "Pay" button is never read. | "Pay" from the list just opens the invoice. That's one extra click on the most common billing task. | `useSearchParams()`; auto-open PaymentModal. | P1 | S |
| R12 | CustomerDetail.tsx:665–670, useApi.ts:69–74 | `immediate` fetches only on mount. Changing route param `:id` (for example after a merge, or a link from one customer to another) keeps the stale customer. | You see the wrong customer's data. | Re-run when `path` changes (`useEffect(..., [path])`), or move to React Query keyed by id. | P1 | S |
| R13 | main.tsx:88–128 | A single ErrorBoundary sits outside the Router. | One page crash removes the whole app, sidebar included. Combined with the envelope crashes in §3, this is very likely to happen. | Add a per-route `errorElement` (switch to the data router `createBrowserRouter`) with a "Go back" option. Send errors to Sentry. | P0 | S |
| R14 | portal/App.tsx | No auth gating. `/messages` is not in nav. No 404. | — | Same pattern as R1/R3. | P1 | S |
| R15 | admin/main.tsx | No ClerkProvider, no guard. | Admin UI is publicly loadable; API calls fail. | Add Clerk and gate on the `platform_admin` role. | P0 | S |
| R16 | Onboarding.tsx:758 | "Go to Dashboard" is a raw `<a href="/">` on the **current** host, not `{subdomain}.gethelm.com`. | The new tenant ends up on the wrong tenant, or the dev fallback tenant. | Redirect to the tenant URL after Clerk session sync. | P1 | S |

---

## 3. Frontend ↔ API contract mismatch table

**Global contract problems (they apply to every row below):**

- **G1 — Envelope.** The API returns `{data, pagination}`, `{data, total}`, `{buckets, details}`, `{summary, rows}`, or a raw object. Frontends assume a bare array or a flat object. `useApi` never unwraps it. Result: a crash on the first successful response.
- **G2 — Units & enums.** The API uses `*Cents` integers, Prisma field names (`invoiceNumber`, `issuedDate`, `customer{firstName,lastName}`), and UPPER_SNAKE enums (`ISSUED`, `MONTHLY`, `CHECKED_IN`). The UI uses dollars or cents inconsistently, display strings (`'Issued'`, `'Monthly'`, `'Checked In'`) and flat strings (`customer: 'Name'`). There is no mapping layer, and `@helm/shared-types` is a dependency that is never used.
- **G3 — `{ body: … }` wrapper.** `useApi.execute(arg)` sends `arg` itself as the JSON body, but 6 call sites pass `{ body: payload }`: Contracts.tsx:780, 790; CustomerDetail.tsx:574, 679, 685; Rentals.tsx:894. The server receives `{body:{…}}` and zod rejects it.
- **G4 — Swallowed errors.** `useApi.execute` returns `null` on error and never throws, so every `.catch(() => {})` is dead code, and callers close modals or show success unconditionally.
- **G5 — Auth inconsistency.** 15 raw `fetch` calls send no bearer token (ESignatureFlow, Contracts bulk send, Slips, DockWalks, CustomerDetail merge, Rentals override, Onboarding, admin apiFetch). They only work if Clerk's `__session` cookie happens to be same-origin. Choose one approach.
- **G6 — Backend hangs (API bug that breaks three screens).** `transient.ts`, `concierge.ts` and `ramp.ts` pass `clerkAuth` **uncalled** as middleware (e.g. transient.ts:65, 105, 140, 160, 213, 249, 285, 314). Express calls `clerkAuth(req,res,next)`, gets back an array, and **`next()` is never called, so every request hangs until timeout.** Transient, Concierge and Ramp will show "Loading…" forever. Fix: `router.use(...clerkAuth())`, as every other router does.
- **G7 — Widgets & tenant resolution.** `tenantMiddleware` resolves the tenant from the hostname only and ignores the `x-helm-tenant-id` header the widgets send. On `api.helm.com` the subdomain is `api`, so every widget request gets **404 TENANT_NOT_FOUND**. The widget client also reads `body.message`, while the API sends `body.error` (widgets/shared/api.ts:49–52), so users only ever see "Request failed (404)".
- **G8 — Pagination.** All list endpoints default to `take=25` (max 100). No page sends `skip/take` or renders paging, so wired-up lists will silently show at most 25 rows.

| # | Caller (file:line) | Call | API reality | Mismatch | Sev |
|---|---|---|---|---|---|
| 1 | web Transient.tsx:132 | GET /api/transient | exists (transient.ts:104) | **Hangs (G6)**. `{data,total}`; fields `guestName, guestEmail, rateCents, totalCents, status:'BOOKED', slip{}`, while the UI expects `email, nightlyRate, slip:string, payment, status:'Booked'` | P0 |
| 2 | Transient.tsx (none) | — | PUT /:id/check-in, /:id/check-out, /:id/overstay, DELETE /:id, GET /availability, POST / | **None are called.** Booking creation is local only | P0 |
| 3 | widgets transient L244 | POST /api/transient | auth-only + hangs | Body `{checkIn:'YYYY-MM-DD', checkOut, nights, boat{}, slipId:'slip_a1', guest{}, pricing{}}`; schema wants `{slipId:uuid, guestName, guestEmail, guestPhone, boatName, boatLength:number, checkIn:datetime, rateCents, totalCents}` | P0 |
| 4 | widgets rental L231 | POST /api/rentals/reservations | auth-only (rentals.ts:294) | Body `{productId, date, startTime:'9:00 AM', duration, hours, customer{}, promoCode, totalPrice}`; schema wants `{customerId (existing!), rentalProductId, startDate, endDate, depositCents}`. No public customer upsert, no promo support | P0 |
| 5 | widgets lead-form L125 | POST /api/lead-forms/:id/submit | public route, but blocked by G7 | `boatLength` string vs `z.number()`; recaptcha `"recaptcha-placeholder-token"` fails when `RECAPTCHA_SECRET_KEY` is set; widget passes `formId` but route expects `embedKey` (confirm they are the same value) | P0 |
| 6 | Rentals.tsx:886 | GET /api/rentals/products | exists | `{data}`; `hourlyRateCents, dailyRateCents, category, totalQuantity, isActive, availableQuantity` vs UI `hourlyRate, halfDayRate, type, status, rating, totalBookings` | P0 |
| 7 | Rentals.tsx:887 | GET /api/rentals/reservations | exists | `{data,pagination}`; `startDate/endDate/totalCents/customer{}/rentalProduct{}/status:'CONFIRMED'` vs UI `number, customer:string, product, date, timeSlot, duration, total` | P0 |
| 8 | Rentals.tsx:888 | GET /api/rentals/pricing-rules | **does not exist** | Rules are per product: GET /products/:id/pricing | P1 |
| 9 | Rentals.tsx:889 | GET /api/rentals/promo-codes | **does not exist** | No promo API at all | P1 |
| 10 | Rentals.tsx:890/894 | POST /api/rentals/products | exists | `{body:p}` wrapper (G3); dollars and free-text type vs `*Cents`, `category` enum | P1 |
| 11 | Rentals.tsx:1235 | POST /api/rentals/pricing-calendar-overrides | **does not exist** | Real: POST /products/:id/calendar-overrides `{startDate,endDate,multiplier,label}`. **The UI sets absolute prices; the API stores multipliers.** No auth header | P1 |
| 12 | Rentals.tsx:705–708 | (none) | POST /reservations/:id/check-in, /check-out, /cancel | Buttons only show a message and never call the API | P0 |
| 13 | Billing.tsx:104 | GET /api/invoices | exists | `{data,pagination}`; `invoiceNumber, customer{}, issuedDate, dueDate, status:'ISSUED', subtotalCents, taxCents, totalCents, balanceCents` vs UI `number, customer, issued, due, subtotal…` | P0 |
| 14 | Billing.tsx:240–241 / InvoiceForm.tsx:174–187 | POST /api/invoices | exists | Body `{customer:'Name', dueDate, notes, lines[{qty,unitPriceCents,taxRate}], subtotalCents…, status}`; schema `{customerId:uuid, issuedDate, dueDate, lineItems[{description, quantity, unitPriceCents, discountCents}]}` → **400** | P0 |
| 15 | InvoiceDetail.tsx:316/320/327 | (none) | POST /:id/finalize, /:id/send, /:id/void | **Buttons have no onClick** | P0 |
| 16 | InvoiceDetail.tsx:277 | GET /api/invoices/:id | exists | Raw `{…invoice, lineItems, glEntries}`; UI reads `invoice.lines.reduce`, `taxJurisdictions` → **crash** | P0 |
| 17 | InvoiceDetail.tsx:278 | GET /api/payments?invoiceId= | exists | `{data,pagination}`; `amountCents, method:'CARD', status:'COMPLETED'` vs `amount, 'Card', 'Completed'` → `.filter` crash | P0 |
| 18 | PaymentModal.tsx:117 | POST /api/payments | exists | Sends `{invoiceNumber, amountCents, method}`; schema needs `customerId` (required) and `invoiceId` → **400**, but the UI shows success | P0 |
| 19 | ARaging.tsx:94 | GET /api/reports/ar-aging | exists | `{buckets{current,days30,days60,days90,days120plus}, details[]}` vs `AgingRow[]` per customer → crash. Bucket names and semantics differ. requireRole admin/manager/accounting → 403 for dock staff | P0 |
| 20 | Dashboard.tsx:44–47 | GET /reports/occupancy, revenue, ar-aging, compliance | exist | UI reads `.rate .total .score .sub .trendText`; API returns `summary.occupancyRate`, `totalOutstanding`… → always mock. 403 for non-managers | P1 |
| 21 | Contracts.tsx:769 | GET /api/contracts | exists | `{data,pagination}`; `rateCents, startDate, endDate, status:'ACTIVE', billingCycle:'MONTHLY', esignStatus, customer{}, slip{}`; there is no `number` field, so `c.number.toLowerCase()` crashes search (L855) | P0 |
| 22 | Contracts.tsx:1039 / L387–398 | POST /api/contracts | exists | `{customerId:'james-harborview', slipNumber:'A-01', boatId:'b1', productId, billingCycle:'Monthly', depositCents}` vs `{slipId:uuid, customerId:uuid, boatId:uuid, billingCycle:'MONTHLY', securityDepositCents}`. UI offers **Seasonal**, which is not in `BillingCycleEnum` | P0 |
| 23 | Contracts.tsx:771/780 | PUT /api/contracts/update | **does not exist** (PUT /:id) | Plus G3 wrapper; `rate/end/securityDeposit` vs `rateCents/endDate/securityDepositCents` | P0 |
| 24 | Contracts.tsx:772/790 | POST /api/contracts/transfer | **does not exist** | No transfer endpoint. The UI rewrites `slip` locally | P0 |
| 25 | Contracts.tsx (none) | — | POST /:id/terminate, /:id/renew, GET /expiring | Unused. The status dropdown (L631–638) bypasses termination penalties and renewal logic | P0 |
| 26 | Contracts.tsx:814 | POST /contracts/bulk-send-for-signature | exists | No auth header; mock ids fail `uuid()`; failure is silent | P1 |
| 27 | ESignatureFlow.tsx:341, 372 | POST /:id/send-for-signature, GET /:id/signature-status | exist | No auth header. Backend generates a fake `requestId` and sends nothing. `esign-webhook` (contracts.ts:934) sits behind `router.use(clerkAuth)` (L163), so the provider can never report "signed" | P0 |
| 28 | CustomerDetail.tsx:574 | POST /api/contracts | exists | G3 wrapper + `slipNumber` | P0 |
| 29 | CustomerDetail.tsx:669/679 | PUT /api/boats/update | **does not exist** (PUT /:id) | — | P1 |
| 30 | CustomerDetail.tsx:670/685 | POST /api/boats | exists | G3 wrapper | P1 |
| 31 | CustomerDetail.tsx:1042 | POST /customers/:id/merge | exists | Calls `/{targetId}/merge` with `{sourceCustomerId, selections}`; API expects `{targetCustomerId, fieldChoices}`. **Merge direction may be inverted**; 400 is swallowed | P0 |
| 32 | Customers.tsx:182 | GET /api/customers | exists | Envelope + field names; 25-row cap | P0 |
| 33 | Slips.tsx:745 | GET /api/slips | exists | Envelope; `slipNumber` vs `number`, `occupant` absent | P0 |
| 34 | Slips.tsx:710 | PATCH /api/slips/:id | **PUT only** | 404, swallowed. "Assign" also creates no contract | P1 |
| 35 | Slips.tsx:593 | GET /api/customers?limit=200 | `take` max 100 | `limit` ignored, so 25 rows. Raw fetch | P2 |
| 36 | Slips.tsx:374/904 | POST /api/slips | exists | Body `{}` | P1 |
| 37 | Leads.tsx:309 | PUT /api/leads | **needs /:id** (and PUT /:id/stage for drag) | 404 | P1 |
| 38 | Waitlist.tsx:362 | POST /api/waitlist | exists | Never executed (fake add L577) | P1 |
| 39 | Concierge.tsx:183 | GET /api/concierge | **/requests** | Also hangs (G6) | P1 |
| 40 | Ramp.tsx:158–159 | GET/POST /api/ramp | **/tickets, /stats, /passes/validate** | Also hangs (G6) | P1 |
| 41 | Reports.tsx:216 | POST /api/reports/generate | **does not exist** | 35 GET /reports/* endpoints exist and are unused | P1 |
| 42 | Settings.tsx:264–265 | GET/PUT /api/settings | **does not exist** | Real: /settings/marina, /branding, /billing, /stripe/*, /qbo/*, /team/*, /notifications | P0 (Stripe/QBO connect is part of go-live) |
| 43 | DockWalks.tsx:329 | GET /dock-walks/violations | **no route** (falls into `/:id`) | Real list: /dock-walks/issues | P1 |
| 44 | DockWalks.tsx:244 | PUT /dock-walks/violations/:id | **does not exist** | Marked resolved regardless of result | P1 |
| 45 | ChartOfAccounts.tsx:129 | GET /reports/gl-summary | exists | `{period, accounts[]}` | P1 |
| 46 | RentRoll.tsx:97 | GET /reports/rent-roll | exists | `{asOfDate, summary, rows}` | P1 |
| 47 | AuditLog.tsx:98 | GET /api/audit-log | exists | Envelope | P2 |
| 48 | Fuel.tsx:260–263 | GET /fuel/types, sales, deliveries, tank-levels | exist | `{fuelTypes}`, `{sales,count}`, `{deliveries}`. **Backend stores fuel in a process-memory array** | P1 |
| 49 | POS.tsx:303–305 | GET products/transactions; POST transactions | exist | Envelope; **POST never called**; schema `lineItems[{productId,quantity}]`, `paymentMethod:'CHARGE_TO_ACCOUNT'` vs UI "Charge to Slip"; shifts API (/shifts/open, /:id/close) unused | P0 |
| 50 | Announcements.tsx:319 | POST /api/announcements (+ /:id/send) | exist | Never executed | P1 |
| 51 | Onboarding.tsx:3 | `${VITE_API_URL ?? 'http://localhost:3001'}/api/onboarding/*` | exists (unauthenticated bypass) | Production defaults to localhost | P0 |
| 52 | sync-manager.ts:11–16 | POST /dock-walks/items, /violations, /dock-walks/photos | **don't exist** (items are /:id/items) | Offline sync can never succeed. Nothing enqueues anyway | P2 |
| 53 | admin TenantDetail.tsx:7 | /api/admin/* | exist (platform admin) | No token, no Clerk → 401 | P0 (for admin) |
| 54 | portal (all) | — | **no portal API exists** | Portal needs scoped endpoints: my invoices, pay, my boats, insurance upload, sign contract | P0 (if the portal is in the launch scope) |
| 55 | EmailAutomation.tsx | — | email-automation router **not mounted** in api index.ts | Dead on both sides | P2 |

---

## 4. Design system & consistency

| # | Location | Issue | Impact | Fix | Sev | Eff |
|---|---|---|---|---|---|---|
| D1 | packages/ui-kit (all) | Zero imports across all 4 apps. Every page re-declares `title`, `divider`, `th/td`, `badge`, `overlay/modal`, `primaryBtn` style objects; there are 4,453 `style={}` props in web. | Inconsistent spacing and radii (4/6/8/12px), and no shared focus/hover/disabled states. Every fix has to be made 27 times. | Make ui-kit the single source: `PageHeader`, `StatCard`, `DataTable` (sorting, paging, empty and loading states), `Modal` (focus trap, Esc, aria), `Drawer`, `FormField` (label, error, help), `MoneyInput`, `DateInput`, `StatusBadge`, `Tabs`, `Toolbar`, `EmptyState`, `ConfirmDialog`. Move to CSS modules, vanilla-extract or Tailwind, not inline objects. Migrate the highest-traffic pages first. | P1 | L |
| D2 | 123 distinct hex colours in web | The tokens exist in `ui-kit/tokens.ts` but are unused. Ad-hoc greys: `#CCC`, `#CCCCCC`, `#E2E8F0`, `#F2F4F6`, `#94A3B8`, `#64748B`, `#2E4A6B`. Status green is `#1B5E20`, `#03543F` or `#22C55E` depending on the page. | Statuses look different on different screens; "Paid" green is not the same green everywhere. | Use CSS custom properties from tokens. One semantic status palette (success, warning, danger, info, neutral). | P1 | M |
| D3 | Status maps redefined per page (Billing L49, InvoiceDetail L164, Contracts L80, Transient L54, Rentals L506/512, …) | The same concept is styled differently: "Issued" is solid navy, "Active" pale green, "Renewed" solid navy (the same as "Issued"). Void is struck-through grey. Terminated is a white outline. | Staff can't learn the colour code. | Single `StatusBadge` with domain mappings (`invoiceStatus`, `contractStatus`, `bookingStatus`) driven by the API enums. | P1 | S |
| D4 | Typography | Dashboard uses `-apple-system…` (L72) while everything else uses Inter. Title sizes are 28/32/36px. Uppercase labels are 11/12/13px. | Visual noise. | Type scale from tokens; `PageHeader` component. | P2 | S |
| D5 | Money formatting | `formatCents` is used in 6 files. There are about 93 ad-hoc `toFixed(2)`/`toLocaleString` calls. Some screens store dollars as floats (POS, Rentals, Transient, Contracts `fmt`) while Billing stores cents. `${monthRevenue.toLocaleString()}` has no decimals (Rentals L953). | Rounding drift (POS tax computed in float dollars, L318–319), inconsistent display, and wrong values when wired to `*Cents` APIs. | Cents everywhere in state. `formatMoney(cents, currency)` uses `Intl.NumberFormat` with the tenant currency. A `MoneyInput` component converts at the edge. | P0 for money screens | M |
| D6 | Dates/time zones: lib/format.ts:7–9 | `formatDate('2026-03-01')` parses as **UTC midnight** and then reads local `getDate()`. **Every date-only value shows one day early in US time zones.** That covers invoice issued/due, contract start/end and booking dates. Other screens show raw ISO strings (Transient L296, Contracts L974, Rentals L1097). "Today" is computed with `toISOString().slice(0,10)` (UTC) in Rentals L152, 252, 279, 367. After about 7–8pm Eastern, "today" becomes tomorrow. No tenant timezone is used anywhere. | Due dates wrong by a day on invoices, which customers will dispute. The availability grid "TODAY" column is wrong in the evening. | Treat date-only values as `PlainDate` (parse `YYYY-MM-DD` without a time zone). Use the tenant timezone (it's collected in onboarding) through `Intl.DateTimeFormat(…, {timeZone})`, or date-fns-tz. Ban `toISOString().slice(0,10)` with a lint rule. | **P0** | M |
| D7 | Feedback patterns | Four ways to show feedback: Toast (5 files), `setSavedMsg` banners (Settings), `actionMsg` banners (Slips, Rentals), inline green boxes; 1 `confirm()` in the codebase. **There is no confirmation for void, terminate, cancel, delete or merge.** | Destructive actions are one misclick away. | Use Toast for results. `ConfirmDialog` for destructive actions, requiring the reason to be typed for void and terminate. | P1 | S |
| D8 | Two PaymentModals (components/PaymentModal.tsx; POS.tsx:169) | Different method names ("Charge to Slip" vs API `CHARGE_TO_SLIP` / `CHARGE_TO_ACCOUNT`), different validation, different success UI. | Inconsistent tender experience and ledger categories. | One `TenderPanel` component used for invoices, POS, bookings and deposits. | P1 | M |
| D9 | Tables | Zebra rows use `#D6E8F4`, which is strong and clashes with the hover colour `#E0F0FF`. Hover is done by mutating `style` in `onMouseEnter`. Rows are clickable `<tr onClick>` with nested `<Link>` (Billing L195–202). There is no sorting, column chooser or sticky header, and no pagination. | Slow scanning at 200+ slips. Not keyboard navigable. | `DataTable` with CSS `:hover`, sortable headers, sticky header, row actions menu, paging, and density toggle. | P1 | M |
| D10 | Modals | Each page has its own overlay. Clicking the overlay **closes forms and discards input** (InvoiceForm L214, Contracts L404, Transient L418, PaymentModal L135 even while processing). There's no Esc handling (only 2 Escape handlers in the app) and no focus management. | Staff lose long invoice and contract forms on a stray click. | Shared Modal: Esc and overlay-close disabled when the form is dirty or submitting; initial focus; focus trap; return focus. For long forms (invoice, contract) use a full-page route or a drawer instead. | P1 | S |
| D11 | Duplicate reference data | Dockage rates in Settings L96 and Contracts L331. GL accounts in Settings L140 and L216, Contracts L33/45, ChartOfAccounts. Rental products in Settings L107 and Rentals L66. POS items in Settings L116, POS, Inventory. Slip lists hardcoded in Transient L129, Contracts L427/514, ConversionWizard L38. | Changing a rate in Settings changes nothing elsewhere. | Fetch from the API; one catalog (§10). | P0 (when wiring) | M |

---

## 5. Accessibility & responsive

### 5.1 Accessibility (WCAG 2.1 AA). Widgets are public-facing, which brings ADA exposure.

| # | Location | Issue | Fix | Sev | Eff |
|---|---|---|---|---|---|
| A1 | All forms (246 `<label>`, **0 `htmlFor`**, Transient uses `<span>` labels L427+) | Labels aren't associated with inputs, so screen readers announce "edit text" and clicking the label doesn't focus the field. | `FormField` component that generates an id and sets `htmlFor` plus `aria-describedby` for errors. | P1 (P0 for widgets) | M |
| A2 | Icon-only buttons (close X in every modal, Eye L1105 / Edit2 / Trash2 in Rentals, hamburger AppLayout L286, select-all checkboxes Contracts L932) | No accessible name. | `aria-label` on all of them. Use `<input type="checkbox">` for selection. | P1 | S |
| A3 | Clickable non-buttons: `<tr onClick>` (Billing, Rentals, Contracts), slip/product cards `<div onClick>` (widgets transient L424, rental L302), toggles `<div onClick>` (Contracts L488, L663), availability pills `<span onClick>` (Rentals L403) | Not focusable or operable by keyboard. **Public widget users can't choose a slip or boat by keyboard.** | Buttons or radios (`role="radio"` in a radiogroup) for selection cards; `<button>` in the row for the primary action; switch with `role="switch" aria-checked`. | P0 (widgets) / P1 | S |
| A4 | Contrast: cyan `#00D4FF` text on white = **1.77:1** (invoice number links Billing L202, "View"/"Edit" links throughout, TODAY badge). `#94A3B8` on white = 2.56:1 (empty states, dashes, legends). `#EF4444` validation text = 3.76:1. `#64748B` on zebra `#D6E8F4` = 3.79:1. | Fails AA (4.5:1). | Cyan for accents and focus rings only. Links use navy `#0A2342` (12.5:1) or a darker cyan (about `#0077A3`). Muted text at least `#64748B` on white only. | P1 | S |
| A5 | Modals (all) | No `role="dialog"`, `aria-modal` or `aria-labelledby`. No focus trap or Esc. Background still scrolls. | Shared Modal (ui-kit's Modal already has role and aria; extend it with focus trap). | P1 | S |
| A6 | Status conveyed by colour only (availability pills, aging columns, balance red/green) | Colour-blind users can't tell states apart. | Text or icon alongside colour (the grid already uses text labels; extend to balances and badges). | P2 | S |
| A7 | No visible focus styles (`outline: 'none'` on inputs: Transient L98, L121; Rentals L554; Contracts L278) | Keyboard users get lost. | Global `:focus-visible` ring from tokens. | P1 | S |
| A8 | Toasts/inline success (`actionMsg`, `savedMsg`) | Not announced. Only OfflineBanner has `aria-live`. | Toast region with `role="status" aria-live="polite"`; errors `role="alert"`. | P2 | S |
| A9 | Widgets step indicator; error text | Current step not announced. Errors not linked to fields; no focus moves to the first error. | `aria-current="step"`; focus the first invalid field on Continue. | P1 | S |
| A10 | Tables | No `scope="col"` or `<caption>`. Sticky first column in the availability grid has no row header semantics. | `<th scope>`; `<th scope="row">` for product names. | P2 | S |

### 5.2 Responsive

| # | Location | Issue | Fix | Sev | Eff |
|---|---|---|---|---|---|
| M1 | packages/ui-kit/src/styles/global.css:161–284 | **All responsive rules for `helm-stats-grid`, `helm-table-wrap`, `helm-modal`, `helm-filter-bar`, `helm-tabs`, `helm-form-grid`, `helm-detail-panel` and `helm-page-title` live in a file no app imports.** The 190 `className`s added in commit a79a592 have no effect. | Import the stylesheet once in each app's `main.tsx` (and move the 6 duplicate AppLayout rules into it). Then verify on 375px. | P0 (mobile dock-walk / dock-staff use) | S |
| M2 | ~23 table wrappers use inline `overflow: 'hidden'` (Transient L264, Billing L177, Rentals `tableWrap`…) | Even with M1 fixed, inline `overflow:hidden` loses to the class's `overflow-x:auto` because inline beats stylesheet without `!important`. **Wide tables are clipped on tablets and phones, and columns such as Actions become unreachable.** | Remove the inline overflow; use the `DataTable` scroll container. On phones, switch to stacked card rows for key lists (Arrivals, Reservations, Invoices). | P0 | S |
| M3 | Double padding: `.helm-content` 32px plus page `padding: 32px` (every page) | 64px gutters on desktop. On mobile 16+32 = 48px per side, so a 375px screen keeps only about 280px of content. | Remove page-level padding; the layout owns the gutter. | P1 | S |
| M4 | Fixed widths (37 occurrences of 400–900px): InvoiceForm 800px (L45), Contracts modal 640/680px, PaymentModal 520px, detail panels 420px (Rentals L558), HelpCenter panel 440px, ESignature 600px | Only Transient has `maxWidth: '95vw'`; the others overflow the viewport on phones (and M1 is inert). | `width: min(800px, 100vw - 32px)`; drawers become full-screen below 640px. | P1 | S |
| M5 | Stats grids `repeat(4/5, 1fr)` inline (Transient L87, ARaging L44, Billing L76, Rentals L525) | 4–5 columns of 24px mono numbers on a phone overflow. | `repeat(auto-fit, minmax(180px, 1fr))`. | P1 | S |
| M6 | InvoiceForm line-item grid `2fr 0.7fr 1fr 0.7fr 1fr 40px` (L79–85) | Unusable below about 700px. | Stack line items on mobile. | P2 | S |
| M7 | HelpCenter floating button (fixed bottom-right, z-index 999) | Covers POS "Complete Payment" and pagination areas on tablets. | Move it into the topbar. | P2 | S |
| M8 | Touch targets: action links 12–13px text with no padding (Rentals "Edit", Contracts "View"/"Sign") | Below the 44px target for gloved or wet hands on the dock. | 40–44px minimum hit areas; sticky primary action bar on mobile. | P1 | S |
| M9 | Portal `sidebarOpen` defaults to true (PortalLayout L37) | On mobile the boater portal opens with the sidebar covering content. | Default closed below 768px. | P1 | S |

---

## 6. Performance

The bundle is not the problem. The production web bundle is **221 kB min / 64 kB gzip**, one chunk. Clerk loads remotely and lucide icons are tree-shaken. The real issues are the data layer and how lists scale.

| # | Location | Issue | Fix | Sev | Eff |
|---|---|---|---|---|---|
| P1 | App.tsx:3–28 | All 27 pages are imported eagerly. Fine at 64 kB today, but pages will grow once they're wired up and mock arrays are replaced by forms and charts. | `React.lazy` per route with a `<Suspense>` skeleton. Keep POS, Dashboard and Transient eager for front-desk speed. | P2 | S |
| P2 | hooks/useApi.ts (whole) | No cache, dedupe, abort, retry, refetch-on-focus or invalidation. `mountedRef` hides warnings but **out-of-order responses can overwrite newer ones** (fast filter changes). After a mutation, screens are stale (Billing create, Contracts create, payment recorded and invoice balance unchanged). StrictMode doubles every request in dev. | Adopt **TanStack Query**: `useQuery(['invoices', filters])`, `useMutation` with `invalidateQueries`, AbortSignal passed into `api.request`, typed `unwrap` of `{data, pagination}`. This one change fixes G1, G4, R12 and the stale-state bugs. | **P0** | M |
| P3 | Lists (Customers, Slips, Contracts, Invoices, Reservations, AuditLog) | Client-side filtering of a 25-row server page. The search box searches only the current 25 rows, so real search results are wrong. No virtualization. | Server-side filtering, sorting and paging (the APIs already accept skip, take, status, sortBy). Debounced search parameter. Virtualize only AuditLog and the availability grid when over 200 rows. | P1 | M |
| P4 | Rentals.tsx:146–248 | `generateMockAvailability()` runs at module import. `countAvailableToday` runs for every product row on every render (L1019). | Remove with mock data; compute availability server-side (`GET /products/:id/calendar`). | P2 | S |
| P5 | Dashboard.tsx:52–330 | About 40 style objects and all mock arrays are recreated on every render, inside the component. | Move constants to module scope or CSS. | P2 | S |
| P6 | Hover via `onMouseEnter` style mutation (Billing L199, Transient L287, InvoiceForm L242) | Direct DOM writes fight React re-renders; zebra colour is computed incorrectly after a re-sort. | CSS `:hover`. | P2 | S |
| P7 | Settings.tsx (1298 LOC), Rentals.tsx (1253), CustomerDetail (1076), Dashboard (1073), Contracts (1060) | Monolith components, so every keystroke in a tab form re-renders the whole page. | Split by tab and route (`/settings/:section`, `/rentals/:tab`) and lazy-load the tabs. | P2 | M |
| P8 | public/sw.js:4–9, main.tsx:157 | SW pre-caches `/icon-192.png` and `/icon-512.png`, **which don't exist**, so `cache.addAll` rejects and the SW never installs (the offline dock-walk PWA is dead). If it does install after the icons are added, the **cache-first strategy for `/` serves a stale index.html forever after deploys.** It is also registered in dev. | Use Vite PWA (Workbox) with network-first navigation and hashed-asset precache. Only register in production. Add the icons. | P1 | S |
| P9 | API (affects UX latency): rentals.ts:302–339 | N+1 `reservation.count` per product on `GET /products`. | `groupBy` once. (Backend.) | P2 | S |

---

## 7. Booking windows deep-dive (Transient, Rentals, widgets, PricingCalendar)

### 7.1 `apps/web/src/pages/Transient.tsx`

| Line | Bug / fragility | Impact | Fix | Sev |
|---|---|---|---|---|
| 132 | GET hangs (G6), envelope (G1), field mismatch (row 1) | "Loading bookings…" forever; then a crash if the backend is fixed | Typed query + mapper | P0 |
| 190 | `allBookings = localBookings || apiBookings || MOCK_BOOKINGS` | **Fake guests show in production on any error** | Never fall back to mock; show error and Retry | P0 |
| 160–188 | `handleCreateBooking` builds the object locally and **never POSTs**. Lost on refresh | Front desk thinks the guest is booked, double-books the slip | `POST /api/transient` with `slipId` from availability, `checkIn` ISO, `rateCents`/`totalCents`; disable while pending; invalidate the list | P0 |
| 167–183 | New object uses `nights, rate, total, paymentMethod` but the type and render use `nightlyRate` and `payment` (TS2353) | `fmt$(undefined)` → **TypeError crash** on the Current tab right after creating. `PAYMENT_COLORS[undefined].bg` crashes the All tab | Fix with the mapper; remove `as` fields | P0 |
| 169 | `bookingNumber: TG-${2100+n}` client-generated, prefix differs from mock `TB-` | Duplicate or meaningless booking numbers | Server-generated | P1 |
| 166 | `parseFloat(nbRate) || 85` | Blank rate silently becomes $85/night | Rate comes from the slip rate card; require an explicit override | P1 |
| 161 | Check-out optional; nights default to 1 | Open-ended bookings with no end date break availability | Require check-out or an explicit "open-ended" flag | P1 |
| 216–219 | `setBookings(bookings.map…)` — **undefined identifiers** (TS2304) | **Clicking Check Out throws a ReferenceError**, and the global ErrorBoundary replaces the whole app | `PUT /api/transient/:id/check-out` + confirm + invalidate | P0 |
| 309–316 | Only Check Out is offered. **No Check In action for `Booked`** (API has PUT /:id/check-in). No Cancel, Overstay, Extend or Move-slip | **The #1 front-desk task, "check in a transient boater", is impossible** | Row actions: Check in, Take payment, Extend, Move, Cancel, Mark overstay | P0 |
| 129, 448–453 | `SLIP_OPTIONS = ['T-01'…'T-10']` hardcoded | Can book non-existent or occupied slips | Use `GET /api/transient/availability?dateFrom&dateTo`, filtered by LOA, beam and draft | P0 |
| 194 | "Check-ins Today" uses literal `'2026-03-25'` | Always 0 in production | Tenant-tz today | P1 |
| 200 | "Revenue This Month" filters `startsWith('2026-03')` and sums `nightlyRate × nights` regardless of payment state | Wrong KPI | Server KPI or computed from `totalCents` of paid bookings | P1 |
| 71–75 | `nights()` uses `new Date('YYYY-MM-DD')` (UTC) and `Math.max(1, …)` | Same-day bookings count as 1 night; DST-safe only by luck | Date-only arithmetic helper | P2 |
| 296–298, 379–380 | Raw ISO dates displayed | Inconsistent with the rest of the app | `formatDate` (fixed) | P2 |
| 470–475 | "Payment Method" select doesn't take payment; button icon is CreditCard "Create Booking" | Misleading; no deposit or card on file captured | Create booking then open TenderPanel (or "Pay later") | P1 |
| 407–414 | Calendar tab: "coming soon" placeholder | No slip × night view, which is how transient desks work | Reuse Rentals `AvailabilityGrid` pattern: slips (rows) × nights (cols), drag to create | P1 |
| 417–419, 478–480 | Overlay-click discards the form; validation message shows before the user has typed anything; labels are `<span>` | Lost input; poor a11y | Shared Modal/FormField | P2 |
| — | No customer link: guest isn't matched to existing Customer or Boat (API supports `customerId`) | Repeat transients re-typed every visit; no history or credit card on file | Customer/boat typeahead with "new guest" inline | P1 |

### 7.2 `apps/web/src/pages/Rentals.tsx`

| Line | Bug / fragility | Impact | Fix | Sev |
|---|---|---|---|---|
| 886–903 | Five useApi calls with mock fallback; two endpoints don't exist (rows 8–9); envelopes not unwrapped | Crash (`products.filter is not a function`) once the API responds; mock otherwise | Typed queries | P0 |
| 910 | `avgRating = sum/products.length` | `NaN` when there are 0 products | Guard; drop rating (not in the data model) | P2 |
| 954 | Hardcoded "+18% vs last month" | Fake KPI | Server KPI or remove | P1 |
| 892–895 | Add Product: local insert + `{body:p}` POST with dollars; `.catch` no-op | Product appears, then vanishes on reload; never saved | Proper mutation; cents; category enum | P1 |
| 1039 | Product "Edit" opens the **Add** modal empty | Cannot edit products | Edit modal with PUT /products/:id | P1 |
| 668–713 | `ReservationDetail` Check In / Check Out / Cancel only show a message and close after 1.5s via `setTimeout` (L671) | **Rental check-in/out never recorded; inventory never freed; deposits not handled** | POST /reservations/:id/check-in, /check-out (with damage/fuel/extra charges), /cancel (show the policy refund) | P0 |
| (none) | **No "New Reservation" button anywhere.** The grid popover "New Booking" button (L480–483) has no onClick | **Staff cannot book a rental**, one of the five top daily tasks | Booking drawer prefilled from the clicked cell: product, date, slot, then customer typeahead, live price from the server quote, deposit, Confirm | P0 |
| 146–248, 394 | Availability grid driven entirely by `MOCK_AVAILABILITY`; real reservations ignored | Grid shows fictitious bookings | Use `GET /products/:id/calendar` (exists) or a new `GET /rentals/availability?from&to` | P0 |
| 109–129 | Fixed 3 slots (8–12, 12–4, 4–8) vs API using arbitrary start/end datetimes, and the Durations tab defining other durations | Three incompatible time models | Pick one: product-defined durations (from settings) mapped to datetime ranges; grid renders blocks from real start/end | P1 |
| 152, 252, 279, 367 | `toISOString().slice(0,10)` for "today" and column keys | Grid shifts by a day in the evening (US) | Tenant-tz date helper | P1 |
| 927–930 | `handleViewReservation` matches `r.number === resId`; API has no `number` | View Reservation from the grid does nothing | Match by id | P2 |
| 810–871 | DurationsTab: local state only; deletes without confirm | Settings lost on reload | Persist (needs API) | P1 |
| 1155, 1177, 1192, 1214 | "Add Rule", "Edit", "Add Promo" show a "Coming Soon" toast | Dead ends | Hide until built or implement | P1 |
| 1226–1242 | PricingCalendar given hardcoded products `pontoon/jetski/kayak`; posts to a non-existent route without auth; errors swallowed; `token = null` comment | Overrides "saved" locally only; lost on reload; never affect real prices | Pass real products; call POST /products/:id/calendar-overrides; reconcile absolute price vs multiplier semantics with backend | P1 |
| 668–671 | Panel `setTimeout(onClose)` without cleanup | setState after unmount; flicker | Remove pattern | P2 |

### 7.3 `apps/web/src/components/PricingCalendar.tsx`

| Line | Bug / fragility | Fix | Sev |
|---|---|---|---|
| 23–35, 37–133, 173–221 | Client-side "pricing engine" with hardcoded rules (summer +25%, weekend +15%, surge dates in 2026) duplicated twice in the file and **different from server `calculateDynamicPrice`** | Staff see one price and customers are charged another. Render server quotes: `GET /products/:id/calendar?month&year` returns per-day price + breakdown | P0 |
| 137–138 | Opens on **March 2026** hardcoded | Default to current month (tenant tz) | P1 |
| 144, 164–168 | Server overrides never loaded; merged map rebuilt for every day cell (31×) inside `useMemo` | Load from API; build merged map once | P2 |
| 249–275 | Bulk range fires **one request per day** and doesn't await or report errors | One request with `{startDate,endDate}`; show progress and error | P1 |
| 252–253 | `cents <= 0` rejected, so you can't price a day at $0 (comp) or "block" a date | Separate "Block date" action | P2 |
| 277–299 | Copy-week only updates local state (never calls `onOverrideChange`); only copies source days visible in the current month | Persist; operate on dates not visible cells | P2 |
| — | No legend explaining that the API stores **multipliers** while the UI edits **absolute** prices | Decide one model and align UI and API | P1 |

### 7.4 `apps/widgets/src/transient-booking/TransientBookingWidget.tsx`

| Line | Bug / fragility | Impact | Fix | Sev |
|---|---|---|---|---|
| index.ts:16 + vite.config.ts | Built as ES modules with a shared chunk (`styles-*.js` containing React, 220 kB); docs embed `<script src=… defer>` (classic) | **SyntaxError: Cannot use import statement**, widget never renders | Build IIFE/UMD single file per widget (`formats:['iife']`, `inlineDynamicImports:true`), or document `type="module"`; consider Preact to cut 220 kB to about 15 kB | P0 |
| shared/api.ts:8 | Default base `https://api.helm.com`; tenant via header the API ignores (G7) | 404 for every tenant | Public endpoints keyed by `tenantId` or embedKey in the path (`/api/public/:tenantKey/...`) with explicit tenant resolution, CORS allow-list and rate limit | P0 |
| 61–68, 176–181 | `MOCK_SLIPS` with fake ids `slip_a1` | Public sees fake inventory and prices | `GET /api/public/:tenant/transient/availability?from&to&loa&beam&draft` returning slips and quoted price | P0 |
| 82–96 | `isWeekend` counts Fri, Sat **and Sun** nights. `new Date('YYYY-MM-DD')` is UTC midnight, so in US time zones `getDay()` returns the **previous day** (Saturday check-in is evaluated as Friday) | Wrong weekend surcharge shown to the customer | Price must come from the server quote; never compute in the widget | P0 |
| 183–188 | Client computes total; posts `pricing` object | Client-trusted prices | Server quote id with expiry; POST references quote | P0 |
| 244–252 | Payload shape mismatch (row 3); dates not ISO datetime; no `rateCents/totalCents`; no `guestName` | 400 even after auth issues are fixed | Align to a public booking schema | P0 |
| 558–575, 616 | "Stripe CardElement placeholder" box; button says **"Pay $X"** but no payment occurs | Bookings without payment, or customers believe they paid | Stripe Payment Element with PaymentIntent from the server (connected account); confirm, then create the booking; idempotency key | P0 |
| 263–277 | "Reservation Confirmed! A confirmation has been sent" (no email is sent anywhere) | False promise | Show a server confirmation number; send email from the backend | P1 |
| 308–330 | No `min` on check-in (past dates allowed); no max stay; check-out `min=checkIn` allows the same day (blocked only on Continue) | Bad requests | `min=today` (tenant tz); `min=checkIn+1` | P1 |
| 239–241, 613 | Double-submit guarded by `status==='loading'` (good), but no idempotency key; network retry duplicates | Duplicate holds | Idempotency-Key header | P1 |
| 307, 364, 377, 390, 505… | Labels not associated (A1); slip cards are divs (A3) | ADA risk | FormField + radio cards | P0 |
| shared/api.ts:49–52 | Reads `body.message`, API sends `body.error` | Generic "Request failed" errors | Read `error` | P2 |
| — | Renders into host DOM with no Shadow DOM; host CSS (`* {box-sizing}`, `button {}`) can restyle it | Visual breakage on marina websites | Mount inside a shadow root | P2 |

### 7.5 `apps/widgets/src/rental-booking/RentalBookingWidget.tsx`

| Line | Bug / fragility | Fix | Sev |
|---|---|---|---|
| 57–94, 299 | Mock products | `GET /api/public/:tenant/rentals/products` | P0 |
| 392 | Start times hardcoded 8 AM–5 PM, ignoring durations, unlock rules and operating hours | Server-provided slots | P1 |
| 413–426 | Hours input `min=1 max=12` not validated (0, 99 and blank allowed: `Number('')*rate = 0`) | Validate in step 1; better, choose from product durations | P1 |
| 429–441 | **"✅ Available at the selected time" is static** | Real availability check (409 NO_AVAILABILITY already exists server-side) | P0 |
| 197–201 | Client price = hourly × hours or daily; ignores dynamic pricing, half-day rate, deposits, taxes | Server quote | P0 |
| 565 | "🔒 Price locked for 15 minutes": no lock exists | Implement quote expiry or remove | P1 |
| 569–579 | Promo code field: no validation endpoint exists | Validate via API or hide | P1 |
| 582–598, 607 | Stripe placeholder; "Pay $X" | As 7.4 | P0 |
| 227–240 | No validation before submit on step 3 (`handleSubmit` skips `validateStep`); payload mismatch (row 4) needs an existing `customerId` | Public customer upsert by email; align schema | P0 |
| 302 | Product cards not keyboard-selectable | Radio cards | P0 |
| — | No waiver/rental agreement acceptance, no age or license capture, no capacity check (party size vs `capacity`) | Add required waiver checkbox + signature (ties to e-sign §9) | P1 |

---

## 8. Invoicing deep-dive (Billing, InvoiceDetail, InvoiceForm, PaymentModal, ARaging)

### 8.1 `pages/Billing.tsx`

| Line | Bug / fragility | Impact | Fix | Sev |
|---|---|---|---|---|
| 104–106 | `apiInvoices ?? mockInvoices` + envelope | Mock in production on error; crash on success | Typed query; error state | P0 |
| 108–114 | Client-side filtering of a 25-row page; date filter compares `inv.issued < dateFrom` as strings (fails with ISO datetimes) | Search misses invoices; wrong filtering | Server-side params (`status`, `dateFrom`, `dateTo`, `customerId`, text search) | P1 |
| 116–119 | Summary cards: "Paid This Month" uses literal `'2026-03-01'`; "Credits Available" hardcoded `4500` | Fake numbers on the main finance screen | Server summary endpoint | P0 |
| 124 | "Past Due (30+ days)" sums all Past Due + Collections regardless of age | Mislabelled KPI | Use the aging buckets | P2 |
| 171 | No links to A/R Aging, Payments, Credits, Batch invoicing, Statements | Finance tasks scattered | Sub-nav tabs: Invoices · Payments · Aging · Credits · Batch run | P1 |
| 195–202 | `<tr onClick>` + nested `<Link>`; not keyboard-friendly | A11y | Row link | P2 |
| 211–221 | "Pay" navigates with `?action=pay`, which is ignored (R11) | Extra clicks | Open payment directly | P1 |
| 236–242 | `onSaveDraft`/`onFinalize` POST the wrong schema (row 14), ignore the result, don't refetch, and "Finalize" just adds `status:'Issued'` (the API ignores it; finalize is a separate endpoint that posts GL) | **Invoices are never created**, the user gets no error, and the list doesn't change | `createInvoice` then (if finalize) `POST /:id/finalize` then navigate to the new invoice; toast; invalidate | P0 |
| — | No bulk actions (send reminders, batch finalize, export), no statement run, no recurring/contract billing preview | Month-end billing is manual and click-heavy | Batch billing screen driven by contracts (§10) | P1 |

### 8.2 `components/InvoiceForm.tsx`

| Line | Bug / fragility | Impact | Fix | Sev |
|---|---|---|---|---|
| 21–34, 152–154 | `mockCustomers` names; selection stores a **name string**, not an id | Can't create a real invoice | Async customer typeahead (`GET /api/customers?search=`) storing id; show balance and boats | P0 |
| 174–187 | Payload: `customer`, `lines`, `qty`, missing `issuedDate`/`lineItems`/`quantity` | 400 | Match `CreateInvoiceSchema` | P0 |
| 140, 169–172 | Client tax: default **7%** per line, editable free-text; server recalculates tax with `calculateTax(tenant, customer)` | **Totals on screen differ from the saved invoice**; tax-exempt customers shown taxed | Remove the tax % column; call a server "quote/preview" endpoint (or show "tax calculated on save"); line `taxCategory` from catalog item | P0 |
| 297 | `qty` via `parseInt` | Can't bill 32.5 ft × $/ft, 1.5 hrs labour or 12.3 kWh | `parseFloat` with step 0.01 (API accepts `z.number().positive()`) | P1 |
| 305–306 | Controlled money input re-formats on every keystroke: `(unitPrice/100).toFixed(2)` | Typing "12.5" becomes "12.50" and the caret jumps; typing a 5 then gives "12.505", rounded to "12.51"; clearing to "0" blanks the field | `MoneyInput`: keep the raw string while focused, parse on blur | P0 |
| 189–195 | Validation: passes if **any** line has a description or price; allows lines with a description and $0 or a blank description and a price; due date before issue date; negative prices (min only an HTML hint) | Garbage invoices | Per-line validation; due ≥ issued; explicit "credit line" type for negatives | P1 |
| 197–211 | `await onSaveDraft(...)`, then **always** `onClose()`, even on failure (useApi returns null, never throws) | **Data loss without the user knowing** | Close only on success; show server error inline; keep form state | P0 |
| 214 | Overlay click closes and discards a long form | Data loss | Dirty-check / no overlay close | P1 |
| 138 | Module-level `let nextId` | Harmless but leaks across mounts | `useId`/uuid | P2 |
| — | No line-item catalog (slip rental, electric, pump-out, storage) with GL mapping; no issue date, terms, PO, memo-on-invoice vs internal notes; no deferred-revenue dates (API supports `isDeferred`, `deferredStartDate`) | Inconsistent GL coding; slow entry | Catalog picker that auto-fills price, GL, tax category and deferral | P1 |

### 8.3 `pages/InvoiceDetail.tsx`

| Line | Bug / fragility | Impact | Fix | Sev |
|---|---|---|---|---|
| 146–161, 281 | **`getDefaultInvoice(id)` fabricates "Sample Customer – Slip Rental $1,500" for any id the mocks don't have**, including real ids when the API fails | **Staff can see, and try to collect on, an invoice that doesn't exist**. This is a financial-integrity risk | Remove; show 404 or an error | P0 |
| 282–284 | Raw API object used as `InvoiceData`; `invoice.lines`/`taxJurisdictions` undefined | **Crash** on the first real invoice | Mapper from `lineItems`, `taxCents`, tax breakdown | P0 |
| 286–294 | Subtotal, tax, total and **balance recomputed on the client** from lines and payments | Can disagree with the server `balanceCents` (credits, refunds, partial voids) | Display server `subtotalCents/taxCents/totalCents/balanceCents`; never recompute money | P0 |
| 292 | Only `'Completed'` payments counted; API status `COMPLETED` | Balance = total even when paid | Mapper / enums | P0 |
| 316, 320, 327 | Finalize, Send, Void buttons have **no onClick** | Can't issue, email or void | Wire to POST /:id/finalize, /:id/send, /:id/void (confirm + reason); disable while pending; refetch | P0 |
| 318 | Record Payment only for Issued and Past Due; not for Collections; Draft can't be paid (correct) | Collections accounts can't be settled here | Allow for Collections | P2 |
| 312 | Customer name not linked | Extra navigation | Link to `/customers/:id` | P2 |
| 483–493 | Passes `onSubmit` to PaymentModal, but PaymentModal's props don't include it (TS2322) and it posts by itself; after the modal closes **nothing refetches** | Balance and status stale; staff record the payment twice | Single mutation passed down; invalidate the invoice + payments + customer balance | P0 |
| — | No PDF/print/download, no email history, no "copy payment link", no credit memo/refund UI (API has POST /payments/:id/refund), no audit trail | Common asks unsupported | Add actions menu | P1 |
| 337, 341, 433, 470 | `formatDate` timezone bug (D6) | Due date shows one day early | Fix format.ts | P0 |

### 8.4 `components/PaymentModal.tsx`

| Line | Bug / fragility | Impact | Fix | Sev |
|---|---|---|---|---|
| 9–14 | Props lack `onSubmit`, `invoiceId`, `customerId` | Can't post a valid payment | Accept ids | P0 |
| 117–121 | Body `{invoiceNumber, amountCents, method}`; API requires `customerId` (and `invoiceId` to apply) | **Always 400** | Correct body | P0 |
| 122, 124 | `setStatus(result ? 'success' : 'success')` and `catch → 'success'` ("Fallback to success for mock mode") | **Every failed payment shows "Payment recorded successfully."** This is the most dangerous line in the frontend | Success only on 2xx; show server message (ACH_BLOCKED, OVERPAYMENT, STRIPE_NOT_CONFIGURED) | **P0** |
| 110, 184–196 | Amount input: no validation. 0, negative, NaN and **over balance** allowed (the server rejects overpay, but the UI says success). `parseFloat('12.345')*100` gives 1234.5, rounded | Wrong postings | MoneyInput; 0 < amount ≤ balance; explicit "overpay → credit" toggle if desired | P0 |
| 128–132, 218–223 | "Process via Stripe" for Card/ACH with **no card entry, no saved payment method picker, no Terminal** (API needs `stripePaymentMethodId` or a connected-account flow) | Can't take a card payment | Saved PM picker (customer's cards and bank accounts), Stripe Payment Element for new card, Stripe Terminal reader for card-present (backend has `stripe-terminal.ts`) | P0 |
| 114–126, 217–224 | Double-submit: button hidden once `status!=='idle'` (good), but no idempotency key; overlay click (L135) closes during processing | Duplicate charges on retry; the user closes mid-charge and retries | Idempotency-Key; lock modal while processing | P0 |
| 105 | "Charge to Slip" posts `CHARGE_TO_SLIP`, but there's no slip/account selection; POS uses `CHARGE_TO_ACCOUNT` | Ledger inconsistency | One enum, account picker | P1 |
| — | No check/cash reference number, no posted date (back-dating lockbox payments), no memo, no receipt email/print | Reconciliation pain | Add fields | P1 |

### 8.5 `pages/ARaging.tsx`

| Line | Bug / fragility | Fix | Sev |
|---|---|---|---|
| 94–95 | Expects `AgingRow[]` per customer; API returns `{buckets, details[]}` per invoice → crash | Group `details` by customer client-side, or add `?groupBy=customer` | P0 |
| 84–90 | Buckets Current/1-30/31-60/61-90/90+ vs API `current/days30/days60/days90/days120plus` (and the 91+ bucket is named "120plus") | Align naming | P1 |
| 121–122 | Export CSV/PDF buttons dead | Implement CSV client-side; PDF server-side | P1 |
| 140–161 | No drill-down to invoices or customer, no "send reminder" or "send to collections" action, no as-of date | Add row expand + actions (`/reports/collections` exists) | P1 |
| (nav) | Not in nav | §2 R5 | P1 |
| — | 403 for staff without admin/manager/accounting role: page silently shows mock data | Proper 403 state | P1 |

---

## 9. Contracts deep-dive (Contracts.tsx, ESignatureFlow, CustomerDetail contract modal)

### 9.1 `pages/Contracts.tsx`

| Line | Bug / fragility | Impact | Fix | Sev |
|---|---|---|---|---|
| 68–76, 774 | `MOCK_CONTRACTS` fallback (2024–2025 dates shown "Active" in late 2026) | Fake contracts in production on error | Remove fallback | P0 |
| 769, 774 | Envelope + field names (row 21); no `number` field, so **search crashes** (L855 `c.number.toLowerCase()`) | Crash on typing in search | Mapper; server search | P0 |
| 774, 776–791 | `localContracts` replaces API data after the first local edit and never resyncs; optimistic updates **never rolled back** because `.catch` is dead (G4) | **Staff see edits, rate changes and transfers that were never saved** | Mutation + invalidate; roll back on error with a toast | P0 |
| 771, 780 | `PUT /api/contracts/update` (doesn't exist) + `{body}` wrapper + dollars | Edits never persist | `PUT /api/contracts/:id` with `rateCents`, `endDate`, `securityDepositCents`, enums | P0 |
| 772, 783–791 | Transfer: non-existent endpoint; local edit **sets status to 'Active'** and rewrites slip in place (contradicting the banner at L706: "current contract ended, new one created") | Slip occupancy and billing desync | Backend transfer endpoint (end + create + prorate + move boat) and a wizard | P0 |
| 514–517 | `AVAILABLE_SLIPS` hardcoded strings including "D-01…D-04" | Transfer to non-existent slips | Vacant slips from API filtered by boat dimensions | P0 |
| 351–401, 415–449 | Create form: customers are slug options, slips hardcoded with status in the label ("B-02 (Maintenance)" is selectable!), boats from a `CUSTOMER_BOATS` map | Contracts against nonexistent records; can contract a slip under maintenance | Customer typeahead, then that customer's boats (API), then compatible vacant slips (API) | P0 |
| 331–338, 367–373 | DOCKAGE_PRODUCTS hardcoded rates "/mo" even when billing cycle is Annual/Seasonal | Wrong rate | Rate card from settings: rate × LOA, per cycle; show computed price and proration preview (backend has `calculateProration`) | P1 |
| 380–384 | Validation only presence; no end > start, no rate > 0, no overlap check with existing slip contract; deposit free | Overlapping contracts and double-assigned slips | Validate + server 409 handling | P0 |
| 387–400 | `await onSave(...)` then always `onClose()`; parent `createContract.execute(data)` result ignored; list not refreshed | Silent failure; new contract not visible | As InvoiceForm | P0 |
| 462–468, 642–648 | "Seasonal" cycle offered; API enum lacks SEASONAL | 400 | Add to API or remove | P1 |
| 631–638 | **Status is a free dropdown**: Draft → Active without signature; Active → Terminated without termination calc; → Renewed without renewal | Bypasses early-termination fees, deposit handling, renewal invoices and the e-sign gate | Status is derived/read-only; actions: Send for signature, Activate (if signed or override with reason), Renew (POST /:id/renew), Terminate (POST /:id/terminate with penalty preview) | P0 |
| 552–567 | `parseFloat(rate) || contract.rate`, so entering 0 or clearing keeps the old rate silently; mid-term rate change has no effective date | Unintended pricing | Effective-dated rate changes | P1 |
| 670–691 | GL/Billing mapping with hardcoded codes (4100…, BI-001…) not from the CoA | GL mapping saved locally only | Use real GL accounts and items (QBO) | P1 |
| 802–808, 931–937 | Select-all compares `selectedIds.size === filtered.length`; selections outside the current filter persist and get bulk-sent | Sends signature requests to unintended customers | Scope selection to visible rows; show "N selected (M hidden)" | P1 |
| 810–831 | Bulk send: raw fetch without auth; on failure "silently fail"; no per-contract result; already-signed/terminated contracts selectable | No feedback; duplicate requests to customers | Show the result summary from the API; disable ineligible rows | P1 |
| 842–851 | Expiring filter via `new Date('YYYY-MM-DD')` (UTC) | Off-by-one at boundaries | Date helper or server `GET /contracts/expiring?days=` | P2 |
| 1005–1013 | "Sign" link shown for Draft/Expired/Renewed and when `signatureStatus==='pending'` → re-send without warning | Duplicate envelopes | Show "Resend / Remind / Void envelope" for pending | P1 |
| 923–1037 | No columns for balance, deposit held, insurance status; no link to customer, slip or invoices; no contract PDF | Context-switching | Contract detail as a full page `/contracts/:id` with timeline (sent, viewed, signed), invoices, documents | P1 |
| 488–498, 663–666 | Auto-renew toggle is a div | Keyboard/a11y | Switch | P2 |
| 586 | Detail modal width 680px (no maxWidth) | Mobile overflow | M4 | P2 |

### 9.2 `components/ESignatureFlow.tsx`

The UI quality here is the best in the app (signer validation, status tracker, request ID). The problems are integration and trust.

| Line | Bug / fragility | Impact | Fix | Sev |
|---|---|---|---|---|
| 341–349, 372 | Raw fetch without bearer token (G5) | 401 under cross-origin or Bearer-only auth | Shared api client | P1 |
| — (API contracts.ts:765–830) | Backend creates a fake `requestId` and **sends nothing**; no PDF generation; no provider (Dropbox Sign/DocuSign) | **"Signature Request Sent" is untrue; customers never receive anything** | Integrate a provider; generate the contract PDF from a template (lib/pdf.ts exists) | P0 |
| — (API contracts.ts:163, 934) | `esign-webhook` is behind `clerkAuth`; no signature verification | Signed status can never arrive | Mount the webhook before auth with HMAC verification | P0 |
| 437–439 | "Preview" button has no handler | Staff send documents they can't review | Preview the generated PDF | P1 |
| 369–382 | Status refresh is manual and errors are swallowed; unknown statuses (e.g. `completed`, `expired`) fall into `stepOrder[...] ?? 0`, showing "Draft" | Misleading tracker | Map the full provider vocabulary; poll or SSE while the modal is open | P2 |
| 360 | `onSent()` sets the list status to `'pending'`, but the API stores `esignStatus:'sent'`; the list (Contracts L89) has no 'sent' key | Badge mismatch after reload | One enum | P2 |
| 385 | Overlay click closes during `sending` | Ambiguous whether it was sent | Lock while sending | P2 |
| — | **No in-person signing** (front-desk tablet), no countersignature by the marina, no multi-signer (co-owners), no reminders, no void envelope | Common marina flows unsupported | Add "Sign now on this device" (embedded signing URL) + countersign step | P1 |
| — | Portal has no "My documents / Sign" page | Boaters can only sign via the email link | Portal contracts page | P1 |

### 9.3 `pages/CustomerDetail.tsx` (contract creation, L~560–647)

There is a second, different New Contract form (slip text, `{body}` wrapper L574, `slipNumber`). Two forms to maintain, both broken. Merge into one `ContractWizard` launched from Customer, Slip, Waitlist-accept and Lead-convert. (P1, M)

---

## 10. Staff workflow efficiency & proposed IA

### 10.1 Click counts — today vs proposed

| Task | Today (best case) | Works end to end? | Proposed flow | Proposed clicks |
|---|---|---|---|---|
| **Check in an arriving transient** | Nav Transient (1) → find row → *(no Check In action)* | **No** | **Today** board, "Arrivals" list (default landing for front desk) → **Check in** (1) → drawer: confirm slip, take payment / card on file (2), Done (3) | **3** (1 if prepaid) |
| Walk-up transient | Transient (1) → New Booking (2) → 10 fields incl. hardcoded slip → Create (3) → saved locally only, no payment | **No** | Global **+ New → Transient** (2) → LOA/beam → slip auto-suggested from availability (3) → guest typeahead (returning boaters prefill) → Charge & check in (4) | **~4–5** |
| **Take a POS payment** | POS (1) → tap items (n) → method (1) → tendered + Complete (2) → auto-close | **No** (never saved) | Same layout + barcode/quick keys + customer/slip lookup → Tender (1) → Complete (1); receipt print/email optional | **n + 2** |
| **Create & send an invoice** | Billing (1) → Create (2) → mock customer → due date → lines (k) → Save & Finalize (3) → find invoice → Send (dead) | **No** | From Customer 360 **Bill** (1) or Billing **New** → customer typeahead (2) → catalog lines (k) → **Finalize & Email** (3); payment link included | **3 + k** |
| Record a payment on an invoice | Billing (1) → Pay (2) → lands on invoice, ?action ignored → Record Payment (3) → method (4) → Process (5) → shows success even on failure | **No** | Billing row **Pay** (1) → TenderPanel opens directly with saved card/ACH preselected → Charge (2) | **2** |
| **Sign a contract** | Contracts (1) → Sign (2) → Send (3) → nothing is sent | **No** | Contract wizard (from slip/customer) → Review (1) → **Send for signature** or **Sign on this device** (2) → on signed: auto-activate, create deposit + first invoice | **2** after setup |
| **Book a rental** | Rentals (1) → Availability (2) → click free cell (3) → "New Booking" (dead) | **No** | Bookings calendar → click/drag free block (1) → drawer: customer typeahead (2), price from server quote, deposit/waiver (3) → Confirm (4) | **~4** |
| Rental check-out → return | Rentals → Reservations → row → Check In (fake) | **No** | Today board "Out on water" list → **Return** (1) → fuel/damage/extras → settle deposit (2) | **2** |

Cross-cutting changes that save the most clicks:
- **Global search (Cmd/Ctrl-K)** across customers, boats (name and registration), slips, invoices, contracts and bookings. Today there is no global search. Every lookup is navigate-then-filter, and filtering only covers the 25 loaded rows.
- **Global "+ New" menu** in the topbar: Booking, Walk-up, Invoice, Payment, Customer, Contract.
- **Customer 360 as the hub.** Every customer record exposes Bill / Take payment / New contract / Book rental / Book transient, with balance, card on file, insurance status and boats.
- **Saved views and default filters** per role (e.g. Billing defaults to "Open"; Contracts defaults to "Expiring 60d").
- Keyboard-first tables (↑/↓/Enter) for desk staff.

### 10.2 Duplicated screens and concepts to merge

| Duplication | Where | Merge into |
|---|---|---|
| 3 booking models (Transient bookings, Rental reservations, Slip "Reserved"/Assign) + Ramp tickets | Transient.tsx, Rentals.tsx, Slips.tsx assign modal, Ramp.tsx | **Bookings**: one calendar/grid (resources = slips + rental units + ramp), one booking drawer, one check-in/out pipeline |
| 4 ways to put a boat in a slip | Contracts form, CustomerDetail contract modal, Slips "Assign" (sets OCCUPIED, no contract), Lead ConversionWizard (hardcoded slips), Waitlist accept | **ContractWizard** used everywhere |
| 2 payment modals (+ widget Stripe placeholders) | components/PaymentModal, POS PaymentModal | **TenderPanel** |
| 2 invoice forms (Dashboard's discards data) | InvoiceForm via Billing & Dashboard | One form/route `/billing/invoices/new` |
| Messaging: Announcements (with automation tabs) + orphan EmailAutomation page | Announcements.tsx, EmailAutomation.tsx | **Communications**: Broadcasts · Automations · Templates · Log |
| A/R in 4 places | Dashboard KPI, Billing cards, ARaging page, ReportViewer aging | Billing › Aging (single source) + Dashboard links into it |
| Slip occupancy in 3 places | Slips list/map, Rent Roll, Reports occupancy | Slips (map/list) with a "Rent roll" view toggle + export |
| Catalog data in 4+ places | Settings (dockage, rental products, POS items, service fees, GL ×2), Contracts, Rentals, Inventory, POS | **Settings › Catalog & Pricing** (one item master with GL/tax mapping) |
| Inventory in 2 APIs and 2 screens | /api/pos/inventory vs /api/inventory/*, POS vs Inventory page | Inventory owns stock; POS consumes |
| Fuel separate from POS | Fuel.tsx (backend in-memory) | Fuel as POS item category + tank module |
| Location lists ×3 | AppLayout LOCATIONS, Settings MARINA_LOCATIONS, admin locations API | Tenant locations API + context |
| Help ×2 | topbar Help, floating HelpCenter | Topbar only |

### 10.3 Proposed information architecture (staff app)

```
TODAY (default for front-desk role)
  Arrivals / Departures (transient)  ·  Rentals out / due back  ·  Tasks (expiring insurance, overdue dock walk, ACH returns)  ·  Quick POS
BOOKINGS
  Calendar (slips × nights, rental units × hours, ramp)  ·  List  ·  Waitlist
SLIPS & CONTRACTS
  Dock map / list (rent-roll view)  ·  Contracts (expiring, unsigned, renewals)  ·  Dock walks
CUSTOMERS
  Customers (360)  ·  Leads (pipeline = customer lifecycle stage)  ·  Communications
MONEY
  Invoices  ·  Payments  ·  Aging & collections  ·  Batch billing run  ·  POS & Fuel  ·  Inventory  ·  Accounting (CoA, GL, QBO sync)
REPORTS
SETTINGS
  Marina & locations · Team & roles · Catalog & pricing (rate cards, rental products, durations, pricing rules, promos, calendar) · Payments (Stripe/Terminal) · Accounting (QBO, GL mapping) · Modules · Notifications · Portal & widgets (embed codes)
```

- Role-based landing: front desk goes to Today, accounting to Money › Invoices, manager to Dashboard (KPIs from real reports).
- The current Dashboard becomes a manager "Overview". Keep the KPI cards, wired to real report endpoints, and drop the fake activity feed until an events API exists.
- Remove from nav until real: Portfolio, Concierge, Ramp, Inventory (if the backend isn't ready). Gate them by tenant modules (R8).

### 10.4 Boater portal IA (for parity with staff flows)

Home (balance, next payment, upcoming bookings, docs to sign) · Invoices & pay (Stripe, autopay) · Documents & signatures · My boats & insurance upload · Bookings (transient/rentals) · Messages · Profile & communication preferences. This needs a scoped `/api/portal/*` surface (none exists).

---

## 11. Prioritized fix list

### P0: launch blockers (suggested order)

| # | Fix | Files | Eff |
|---|---|---|---|
| 1 | **Make it compile and deploy.** Add `"lib": ["ES2022","DOM","DOM.Iterable"]` and `vite/client` types to web/portal/admin tsconfig; fix ui-kit `paths` (`../../packages/...`); fix the 56 remaining TS errors (Transient L176/218, InvoiceDetail L489, ReportViewer, Onboarding, PortfolioDashboard style fns, Leads L538). Fix Dockerfile.web (pnpm lockfile; invalid `COPY … 2>/dev/null || true`). Add `tsc --noEmit` to CI. | tsconfig*, Dockerfile.web, pages | M |
| 2 | **Fix the backend hangs.** `clerkAuth` → `...clerkAuth()` in transient.ts, concierge.ts, ramp.ts. (Backend owner; one-line change per file, but it blocks the Transient screen.) | api routes | S |
| 3 | **Auth shell**: RequireAuth wrapper, sign-in route, UserButton/sign-out, admin ClerkProvider + platform-admin gate, portal gate; per-route `errorElement`; 404 route. | App.tsx, main.tsx, AppLayout, admin/portal main | S |
| 4 | **Data layer**: TanStack Query + one `apiClient` (token, AbortSignal, `unwrap<T>()` for `{data,pagination}`, typed errors that **throw**); domain mappers (API DTO ↔ view model) shared via `@helm/shared-types`; delete every `?? MOCK_*` fallback and the fabricated `getDefaultInvoice`; real loading, error (with Retry) and empty states; server pagination. | hooks/useApi.ts → lib/query, all pages | L |
| 5 | **Never show success on failure.** PaymentModal L122/124, InvoiceForm L197–211, Contracts L387–400 / L780 / L790, Settings saved banners, Inventory/Slips/Waitlist/Announcements `setTimeout` fakes, DockWalks resolve, CustomerDetail merge. Close modals only on 2xx. | listed | M |
| 6 | **Money & dates correctness.** Cents everywhere; `MoneyInput` (fix InvoiceForm L305 caret/rounding bug); remove client tax and balance math (InvoiceForm L169–172, InvoiceDetail L286–294); fix `formatDate` UTC off-by-one; tenant-timezone "today"; ban `toISOString().slice(0,10)`. | lib/format.ts, InvoiceForm, InvoiceDetail, POS, Rentals, Transient | M |
| 7 | **Invoicing end to end.** Customer typeahead → valid `POST /invoices` → `/finalize` → `/send` → `/void` (confirm + reason) → payment with `customerId`/`invoiceId`, saved-card/ACH/Terminal, idempotency key, refetch; honour `?action=pay`; ARaging mapper + nav. | Billing, InvoiceForm, InvoiceDetail, PaymentModal, ARaging, AppLayout | L |
| 8 | **Transient desk.** List from API with mapper; **Check in / Check out / Cancel / Overstay** wired; creation via `/availability` + POST; remove Check Out ReferenceError; slip × night grid (reuse AvailabilityGrid). | Transient.tsx | M |
| 9 | **Rentals desk.** New Reservation drawer from grid; real availability/calendar; check-in/out/cancel wired; server price quotes in the grid and PricingCalendar; remove the client pricing engine. | Rentals.tsx, PricingCalendar.tsx | L |
| 10 | **Contracts.** Real create via ContractWizard (customer → boat → compatible vacant slip → rate card → proration preview); PUT /:id for edits; read-only derived status with Activate/Renew/Terminate actions; backend transfer endpoint; real e-sign provider + public verified webhook; remove mock lists. | Contracts.tsx, CustomerDetail.tsx, ESignatureFlow, api contracts.ts | L |
| 11 | **POS persistence.** Execute `POST /pos/transactions` (cents, `lineItems[{productId,quantity}]`, enum alignment); shifts via `/pos/shifts/open|close` with the real user; TenderPanel; card-present via Stripe Terminal. | POS.tsx | M |
| 12 | **Widgets.** IIFE single-file build (or Preact); public `/api/public/:tenantKey/*` endpoints for availability, quotes, booking and lead submission (explicit tenant resolution, CORS allow-list, rate limit, captcha); Stripe Payment Element; server quotes; a11y (labels, radio cards); Shadow DOM; fix `error` vs `message`. | apps/widgets/*, api | L |
| 13 | **Settings that gate go-live**: wire marina, team invite/roles, Stripe connect/disconnect and QBO connect/sync to the existing `/api/settings/*` routes. | Settings.tsx | M |
| 14 | **Import global.css** in every app; strip inline `overflow:hidden` from table wrappers; remove double page padding. (Turns the mobile work on.) | main.tsx ×3, pages | S |
| 15 | Onboarding `API_BASE` default to same-origin `''`; post-auth redirect to onboarding when incomplete. | Onboarding.tsx, App.tsx | S |
| 16 | Portal: either ship it read-only on real `/api/portal/*` (invoices + pay + documents/sign) or **remove it from launch scope**. Do not ship mock data to boaters. | apps/portal, api | L |

### P1: before GA

1. Shared ui-kit components (Modal with focus trap/Esc/dirty-guard, DataTable, FormField, StatusBadge, ConfirmDialog, Toast-only feedback) and migrate the money/booking/contract screens first. *(L)*
2. Accessibility pass: `htmlFor`, aria-labels on icon buttons, keyboard-operable rows/cards/toggles, `:focus-visible`, contrast (stop using cyan as text colour). *(M)*
3. Nav/IA: add Aging/CoA/Rent Roll; NavLink active matching; breadcrumbs; global search (Cmd-K); "+ New" menu; Today board for front desk. *(M–L)*
4. Server-side search/filter/paging on all lists; debounce. *(M)*
5. Tenant-scoped modules and locations (replace localStorage gate and the fake location switcher). *(M)*
6. Merge duplicated concepts (§10.2): ContractWizard, TenderPanel, Communications, Catalog & Pricing. *(L)*
7. Remove or hide dead UI ("Coming soon" toasts, dead Export/Download/Preview/Help buttons, Dashboard fake KPIs and "+18%"). *(S)*
8. Service worker: Workbox, network-first navigation, add icons, wire the offline dock-walk queue to real endpoints or remove offline claims. *(M)*
9. Responsive fixes M3–M5, M8–M9; mobile card layouts for Arrivals, Reservations and Invoices. *(M)*
10. Leads/Waitlist/Slips/DockWalks/Concierge/Ramp/Reports endpoint alignment (rows 34–46). *(M)*

### P2: polish and tech debt

Lazy-load routes; split 1,000-line pages by tab/route; move style constants out of render; CSS `:hover` instead of style mutation; delete EmailAutomation.tsx, OfflineBanner/QRScanner/BarcodeScanner if unused; colour-plus-text statuses; `aria-live` toasts; table semantics; Shadow DOM for widgets; consistent typography scale; remove `nextId` globals.

---

### Appendix A: verification artifacts

- `npx tsc --noEmit -p apps/web`: **588 errors** with the repo tsconfig (no DOM lib), **56** after adding DOM lib. Real defects include `Transient.tsx(218) Cannot find name 'setBookings'/'bookings'`, `Transient.tsx(176) 'nights' does not exist in type 'Booking'`, and `InvoiceDetail.tsx(489) onSubmit not assignable to PaymentModalProps`.
- `vite build` (web): 221 kB JS / 64 kB gzip, single chunk.
- `vite build` (widgets): `transient-booking.es.js` begins with `import { … } from "./styles-*.js"`; the shared chunk is 220 kB.
- Grep stats (apps/web/src): `style={` 4,453 · distinct hex colours 123 · `htmlFor` 0 · `aria-`/`role=` 4 · Escape handlers 2 · `?.data`/`.data.` unwraps 0 · `@helm/ui-kit` imports 0 (all apps).
- Contrast: `#00D4FF`/white 1.77:1 · `#94A3B8`/white 2.56:1 · `#EF4444`/white 3.76:1 · `#64748B`/`#D6E8F4` 3.79:1 · navy/zebra 12.5:1.
