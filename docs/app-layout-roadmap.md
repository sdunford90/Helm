# Helm Left-Nav Redesign & Flow Roadmap

## Context

Helm's left-nav layout grew organically. Sections were added as features shipped, not as a coherent flow that matches how marina staff (and customers, and platform admins) actually work. The result:
- Categories mix nouns and verbs (e.g., "Marina Operations" lumps assets like Slips with verbs like Dock Walks).
- Money-out (Inventory, Purchase Orders) sits inside "Revenue".
- Communications sit under "Admin".
- Settings is half a page and half five separate routes.
- The customer portal has no profile/comms grouping; the platform admin has no grouping at all.

This doc proposes a new sidebar structure for **all three apps**, built around the user's *actual* daily flow, plus a mapping table so the migration is mechanical. Critical files and a phased plan are at the bottom.

---

## Accomplished so far

The original roadmap envisioned six phases (web sidebar reorder → settings shell → portal & admin → ui-kit extraction → big rocks → testing). Phases 1–3 and meaningful pieces of 4 and 5 are now live across the three apps. The list below records what shipped, organized by surface area, with the commit each chunk lives in so future archaeology is cheap.

### Information architecture
| Item | Where it shipped |
|---|---|
| Web sidebar grouped into HOME / MARINA / DAILY OPS / POINT OF SALE / BACK OFFICE / PIPELINE / COMMUNICATIONS / INSIGHTS, Settings pinned to footer | Task #328 (`6f9c18c`) — pre-existing |
| Billing nested under Marina; Back Office holds Accounting + POs + Inventory | Task #328 (`6f9c18c`) |
| Web Settings shell — every tab gets its own `/settings/<tab>` URL; the 5 standalone `/settings/*` pages adopt the same shared SubNav; `?tab=` query strings redirect; `/audit-log` → `/settings/audit` | This branch (`0ff599e`) |
| Portal sidebar regrouped into HOME / MY MARINA / BILLING / SERVICES / COMMUNICATIONS with an Account footer (Profile / Notifications / Security / Help); Messages promoted into nav | This branch (`30b0508`) |
| Admin sidebar regrouped into HOME / TENANTS / REVENUE / OPERATIONS with a Configuration footer (Platform Settings, My Profile) | This branch (`30b0508`) |
| Account stub pages for portal (4) + admin `/me` page that reads from Clerk + `useAdminMe` | This branch (`30b0508`) |

### Reporting & Insights
| Item | Where it shipped |
|---|---|
| Insights surface broken into 8 per-section pages — Overview (KPIs + section index), Operations, Financial, Customers & CRM, Communications, Compliance & Audit, Scheduled & Saved, Custom Builder | This branch (`669e6e6`) |
| Each section page lists a real report inventory with status badges (Live / Phase 5a / 5b / 5c) instead of a single "Coming soon" stub | This branch (`669e6e6`) |
| `/insights/financial/sales-tax` mounts the existing Sales Tax report; old `/reports/sales-tax` redirects | This branch (`669e6e6`) |
| Deferred Revenue page replaced with a live schedule table (totals, recognition %, per-schedule progress bars) backed by `/api/reports/deferred-revenue` | This branch (`1b8c41e`) |
| **Universal Report Builder — catalog foundation**: `apps/api/src/services/report-catalog.ts` parses `prisma/schema.prisma` and emits a JSON catalog (112 models, every field with type/kind/optional/list/id/unique/default flags). Sensitive fields (secrets, signatures, raw webhook payloads, Stripe/Clerk IDs) flagged. Served at `GET /api/insights/catalog`. Frontend renders a two-pane catalog browser. | This branch (`c38eabb`) |
| **Universal Report Builder — MVP engine + UI**: `apps/api/src/services/report-engine.ts` translates a `ReportSpec` to a Prisma query with hard guardrails (tenant scope, sensitive-field allowlist, limit clamp, limit+1 has-more trick). Filter ops: eq / ne / lt / lte / gt / gte / in / notIn / contains / startsWith / endsWith / isNull / isNotNull / between. `POST /api/insights/run`. Custom Builder UI has a Build tab with field checkboxes, type-aware filter ops, Run button, result table, and warning banners for ignored fields/filters. | This branch (`e27d816`) |
| `ReportSpec` / `ReportFilter` / `ReportRunResult` types live in `@helm/shared-types`; Group-by + aggregates typed but rejected by the MVP engine | This branch (`e27d816`) |

### Cross-app primitives
| Item | Where it shipped |
|---|---|
| `SubNav` + `BILLING_SUBNAV` / `ACCOUNTING_SUBNAV` / `INSIGHTS_SUBNAV` / `SETTINGS_SUBNAV` moved to `@helm/ui-kit`; all 15 web callsites import from the package; `react-router-dom` is a peer dep | This branch (`64f8be7`) |
| `InsightsShell` + `ReportCard` + `ReportGrid` primitives under `apps/web/src/pages/insights/` (will graduate to ui-kit once portal/admin need them) | This branch (`669e6e6`) |

### Platform admin
| Item | Where it shipped |
|---|---|
| Webhooks console at `/webhooks` (Operations group). Three KPI cards for Stripe Payments / Stripe Connect / QBO delivery rates with color-coded success ratios. Tab switcher between QBO failures and Stripe payment failures with a recent-failures table. Auto-refresh every 30s. Backed by existing `/api/admin/health/system` and `/api/admin/health/system/failures`. | This branch (`819e904`) |

### Marina dashboard (web) features
| Item | Where it shipped |
|---|---|
| Customer Merge — backend service, route, modal, page integration. Field-level conflict resolution. Includes undo within a 15-min window. | Pre-existing on this branch's base |

### What this means for the rest of the doc

The **target IA below is now live across all three apps**. The original "Phased rollout" section at the bottom is preserved for archaeology; the **Next-up upgrades** section below replaces it as the planning surface going forward.

---

## Next-up upgrades — sized chunks

Each chunk below is **one focused PR**, scoped small enough that one engineer (or one Claude session) can ship it without a planning meeting. Sizes are working-day estimates, not calendar days. Items in the same area can be parallelized across people; items within an area have ordering dependencies called out.

### Immediate queue (current ordering)

What's next, in order, based on the latest priority pass:

1. **Settings clean redesign** — S1 → S2 → S3 → S4 → S5 → S6 → S7. See the dedicated *Settings — clean redesign* section below; replaces W4.
2. **Portal depth** — P1, P2, P3 (account stubs become real), then P5, P6 (Documents hub + My Slip).
3. **Platform admin operations** — A1 (webhook retry / replay), A2 (all-deliveries tab), A5 (job queue dashboard).
4. **Card-expiry forecast** — W3.
5. **Reporting follow-ups** — R3, R2, R8, and the Build UI for R1 + R3 + R4 (catalog + saved views are backend-ready; need a unified UI pass).

### Settings — clean redesign
- **S1. Layout shell + new routes** (≈2 days). New `SettingsLayout`; route tree at `/settings/<section>/<leaf>`; bare `/settings` redirects.
- **S2. Marina section** (≈2 days). Profile / Branding / Custom Domain.
- **S3. Team section** (≈3 days). Members / Roles / API Keys (new) / Audit Log.
- **S4. Pricing & Payments section** (≈4 days). 6 leaves; merges Tax Jurisdictions + Tax Rates.
- **S5. Catalog section** (≈2 days). Products & Rates / Categories / Modules.
- **S6. Integrations section** (≈2 days). QuickBooks / Email Sender / Webhooks & API.
- **S7. Drop the legacy `Settings.tsx`** (≈1 day). 2937-line monolith gone once leaves are migrated.

### Reporting & Insights
- **R1. Save / share a report view** (≈3 days). New Prisma tables `SavedReportView` and `ReportSubscription`, "Save" button on the Build tab, list page at `/insights/saved`. Surfacing in Scheduled & Saved.
- **R2. CSV / XLSX export from Build results** (≈2 days). Wire `report-scheduler` queue, write result to R2, surface in an Export Center inside Scheduled & Saved. Async path for >1000-row results.
- **R3. Relation traversal in the engine** (≈5 days). Dotted-path fields like `customer.firstName` and `customer.location.name`. Walk catalog relations, emit `select` graphs, cap JOIN depth at 4. Filter-on-relation as a follow-up sub-chunk.
- **R4. Aggregates + group-by** (≈5 days). Switch the engine to `prisma.<model>.groupBy` when the spec has `groupBy` / `aggregates`. Functions: count / sum / avg / min / max.
- **R5. AI assist on the builder** (≈3 days). Claude tool-calling that emits a `ReportSpec`. Engine validates and runs as usual; model never touches raw data.
- **R6. Anchor Operations reports** (≈5 days each, parallelizable). Real pages for Occupancy trend, Dock-walk findings, Transient overstay, Rentals utilization — built on top of the engine + chart primitive (R7).
- **R7. Chart primitive in `ui-kit`** (≈3 days). Wraps Recharts (or similar) for line / bar / donut. Used by anchor reports.
- **R8. P&L / Balance Sheet / Trial Balance** (≈5 days each). Books-grade reports straight from the GL — built once the engine has aggregates + relation traversal.
- **R9. Custom-report audit + run log** (≈2 days). `ReportRun` table; every `/api/insights/run` writes a row with spec hash, runtime, row count. Surface in Compliance & Audit > Admin Actions.
- **R10. Saved-view permissions** (≈2 days). `reports:run-custom`, `reports:run-sensitive-fields` permissions on `CustomRole`; engine reads them.

### Portal depth
- **P1. Real `/account/profile`** (≈2 days). Read/write a `/api/portal/me` endpoint backed by the `Customer` row. Replace the stub.
- **P2. Real `/account/notifications`** (≈3 days). UI on top of the existing `communication-prefs` API.
- **P3. Real `/account/security`** (≈2 days). Surface Clerk's password / 2FA / session controls embedded in the portal.
- **P4. Real `/account/help`** (≈3 days). FAQ list + "send a question to the office" form posting to the existing support-ticket API.
- **P5. Documents hub** (`/my-marina/documents`, ≈3 days). List signed contracts, certificates, receipts. Links to `CustomerDocument` rows.
- **P6. "My Slip"** (`/my-marina/slip`, ≈2 days). Read-only map snippet + dockmaster contact info.
- **P7. Portal "Year in review"** (≈3 days). Small spend / usage rollups on the Dashboard and Invoices page.

### Platform admin
- **A1. Webhooks retry / replay actions** (≈2 days). `POST /api/admin/qbo-webhooks/:id/replay` and an audit-replay endpoint for Stripe; buttons on the Webhooks console rows.
- **A2. Webhooks "all deliveries" tab** (≈2 days). Today the table only shows failures — add a tab for the full feed with a status filter.
- **A3. `TenantDetail.tsx` breakup** (≈3 days). Split the 81 KB file into nested routes (Overview / Users / Billing / Audit / Feature Flags).
- **A4. Tenant Deep Dive promotion** (≈1 day). Add a top-level entry point from the Tenants list — currently the route exists but is orphaned.
- **A5. Job queue dashboard** (≈2 days). Embed Bull Board (or a thin equivalent) under admin Operations.

### Notifications
- **N1. Backend feed** (≈4 days). `Notification` table + service that fans out from existing audit events. One row per recipient.
- **N2. Bell UI in all three top bars** (≈3 days). Unread badge, dropdown with the 10 most recent, "mark all read" action. Reads from `/api/notifications`.
- **N3. Notification preferences** (≈2 days). Plug into P2 for the portal; add a Settings tab for staff.

### Web feature gaps
- **W1. Transient overstay queue** (≈3 days). List in `Daily Ops > Transient`. Contact actions (email / SMS) + late-fee escalation.
- **W2. Rental pricing suggestions UI** (≈3 days). Surface the existing surge engine in a tab under `Daily Ops > Rentals` with "accept suggested rate" actions.
- **W3. Customer card-expiry forecast page** (≈2 days). Already on the roadmap inventory under Customers & CRM — list customers whose saved cards expire in the next 60 / 90 days.
- **W4.** *(retired — superseded by the Settings clean redesign, S1–S7 above.)*
- **W5. Insurance AI review step in portal** (≈3 days). Confirm extracted fields before save, coverage-gap warning.

### `ui-kit` extraction (deferred until design tokens land)
- **U1. Design-token pass** (≈3 days). Define color, spacing, typography tokens that span web's light theme and portal/admin's dark theme. Today's `tokens.ts` is partial.
- **U2. `Sidebar` primitive with footer slot + theme support** (≈5 days). Replace the three bespoke sidebars (web `AppLayout`, `PortalLayout`, `AdminLayout`) one at a time.
- **U3. `TopBar` primitive** (≈3 days). Slots for page title / location switcher / search / user chip / notifications bell.
- **U4. `Breadcrumb` + `EmptyState`** (≈2 days each). Build when first re-used cross-app.
- **U5. Storybook + visual-regression for ui-kit** (≈3 days). Set up Chromatic (or Playwright screenshots) — only worth it once U2–U4 land.

### Testing (parallel with everything)
- **T1. Playwright smoke per app** (≈3 days). One spec per top-level nav section. Opens every entry, asserts a known DOM marker. Catches dead links during future moves.
- **T2. axe-core a11y scan in CI** (≈2 days). Fail on serious violations across the new shells.
- **T3. RTL on layout shells** (≈3 days). Tests for `AppLayout` / `PortalLayout` / `AdminLayout` covering role gating, module gating, location switcher, footer slot.
- **T4. 301-redirect regression test** (≈1 day). Assert every legacy URL (`/audit-log`, `/reports/sales-tax`, `/settings?tab=*`, `/rent-roll`, `/portfolio`) still resolves.
- **T5. Lighthouse CI budgets** (≈2 days). TTI < 3s, LCP < 2.5s, JS bundle < 500 KB on web.
- **T6. Multi-tenant isolation test generator** (≈3 days). For each route, assert it 403/404s on a cross-tenant ID.
- **T7. Permission-matrix test generator** (≈3 days). Iterate every `CustomRole` permission, assert route access matches the spec.
- **T8. Migration rehearsal in CI** (≈1 day). Run `prisma migrate deploy` against a frozen prod-schema snapshot on every PR; fail on drift.

---

## Left to complete

Everything below is bigger than a single chunk and either depends on the chunks above or hasn't been designed yet. Roughly ordered by ROI inside each area; not all of it will (or should) ship.

### Reporting depth
- Full Operations / Financial / Customer dashboards beyond the anchor set (R6, R8) — each non-trivial domain has 3-8 more reports planned.
- Communications reports — email deliverability, SMS volume, automation performance, suppression-list growth.
- Compliance reports — Period Close attestations, QBO sync history, Admin Actions.
- Universal Report Builder additions: **scheduling** (cron, recipients, run history), **subscriptions** (per-user "email me this weekly"), **computed fields** (a small whitelisted expression DSL), **per-tenant catalog overrides** (Settings > Reporting toggles).
- Platform admin Insights revamp — MRR, churn, trial conversion, tenant benchmarks, support SLAs, reliability dashboards.

### Big-rock features (from the New-Feature Catalog further down)
- **Service / work-order system** — haul-out, launch, winterize, bottom paint. New domain; hooks into Inventory + Billing + Calendar.
- **Two-way SMS conversations** — currently SMS is one-way notifications only.
- **Drip / sequence email campaigns** — multi-step automations beyond single rules.
- **Cash drawer / shift management** — POS shift open/close, over/short reporting.
- **Slip swap / sublet** — owner sublets slip to a transient; revenue split.
- **Waitlist auto-promote** — auto-offer to next eligible when a slip frees up.
- **Public-facing slip application** — long-term lease widget feeding `Lead` + `WaitlistEntry`.
- **Approvals workflow** — POs / refunds above a threshold need manager approval.
- **Vendor portal** — vendors submit invoices, see PO status.
- **Expense management** — staff expense submission with receipts.
- **Gift cards / store credit** — POS-integrated, ties to Stripe + GL.
- **Membership tiers / loyalty** — tiered pricing, perks, slip discounts.
- **Slip-for-sale marketplace** — for marinas where slips are owned.
- **Bank feeds / Plaid** — direct bank reconciliation without QBO.
- **1099-NEC reporting** + **W-9 collection workflow**.
- **Multi-currency** — for marinas in CAD / MXN / Caribbean.

### Compliance, security, governance
- **GDPR / CCPA customer export** + **right-to-be-forgotten** flow.
- **SOC 2 evidence package** — automated control evidence collection.
- **SSO (SAML / OIDC)** + **SCIM provisioning** for enterprise tenants.
- **2FA enforcement policy**; **API key management UI**; **IP allowlisting** per tenant.
- **Tenant audit packet export** — bundle audit log + period close + reconciliation for auditors.

### AI-powered (Anthropic key already configured)
- **Natural-language report builder** (R5 above is the wiring; this is the prompt + tool design).
- **Dock-walk voice notes** — speech-to-text + auto-categorize issues.
- **Smart concierge triage** — classify and route concierge requests; suggest replies.
- **Lead scoring + next-best-action**.
- **Churn prediction**.
- **Invoice line-item categorization** — auto-suggest GL category.
- **Email draft assistant** with tone presets.
- **Insurance AI v2** — coverage-gap warnings, review/correct extracted fields.

### Mobile & portfolio
- **Mobile staff PWA** — expand offline support beyond dock walks to transient check-in, ramp tickets, POS.
- **Native iOS / Android customer app** — wrap the PWA or build native; Wallet pass + push.
- **Portfolio app / section** — for owners of multiple marinas; current `/portfolio` is a stub.
- **Tenant benchmarks** (admin) — anonymized cross-tenant percentiles.
- **Group billing / consolidation** — single invoice across a customer's boats at multiple locations.

### Internationalization & accessibility
- **i18n framework** — start with en-US, structure for future locales.
- **WCAG 2.1 AA compliance pass** — color contrast, keyboard nav, ARIA on every shell.
- **High-contrast / dark mode polish** for web + portal (admin is already dark).
- **Print stylesheets** for invoices, reports, work orders.

### Hardware & integrations
- **Smart gate / lock access** — issue and revoke keys; webhooks from the hardware.
- **Pedestal metering wrap-up** — power / water with billing.
- **License plate recognition for ramp** — auto-create tickets.
- **Fuel pump SCADA / Veeder-Root integration** — auto-import sales.
- **Public REST + webhook API for tenants** — first-party integrations.
- **Zapier / Make integration**.
- **Slack / Teams notifications** for staff channel pings.
- **DocuSign embed** — alternative to native eSign.

### Quality & ops
- **Synthetic monitoring** — staging + prod uptime checks.
- **Slow-query log surfacer** — pg_stat_statements top-10 panel under admin Operations.
- **Error budget / SLO dashboard** — paired with Sentry.
- **Chaos / resilience testing** — Redis / QBO / Stripe / R2 outages.
- **PDF / export determinism** — hash-stable PDFs for invoices and reports.

---

## Settings — clean redesign

Treat Helm as a new product and design Settings from scratch.

### The problem

A user opens Settings to do one of five things:

1. **"This is who we are"** — name, logo, hours, domain.
2. **"Who's on the team"** — invite people, scope what they can do.
3. **"How money moves"** — what we charge, what we pay tax on, how cards clear.
4. **"What we sell"** — rate plans, categories, which modules are on.
5. **"Plumbing"** — integrations, audit, API keys.

The mental model is five buckets. The page should reflect those five buckets.

### Proposed IA

Five sections at the top, leaves underneath. Every leaf has its own URL.

```
/settings
│
├── Marina
│     ├── Profile           name, contact, address, timezone, fiscal year, operating hours
│     ├── Branding          colors, logo, favicon, display name, tagline
│     └── Custom Domain     CNAME + DNS verification
│
├── Team
│     ├── Members           invite, role assignment, location scoping
│     ├── Roles             custom roles + permission matrix
│     ├── API Keys          tenant API keys, last-used, rotation
│     └── Audit Log         search by user / record / action / date
│
├── Pricing & Payments
│     ├── Payment Terms     default Net terms, late fee %, grace period, default tax rate
│     ├── Stripe Connect    per-location card processing accounts
│     ├── Tax               jurisdictions (state/county/city/special) + rates per category, in one place
│     ├── Card Readers      Stripe terminal pairing per location
│     ├── Discounts         POS auto-applied customer discounts
│     └── Subscription      Helm's bill to the tenant (per-location SaaS tier, Stripe portal link)
│
├── Catalog
│     ├── Products & Rates  dockage rates, service fees, rental products, GL mappings
│     ├── Categories        POS / product / contract category taxonomy
│     └── Modules           per-location feature toggles (transient, rentals, ramp, concierge)
│
└── Integrations
      ├── QuickBooks        per-location QBO setup, sync controls
      ├── Email Sender      per-tenant + per-location Resend From mailbox
      └── Webhooks & API    outbound webhook destinations and API surface controls
```

### Why this is easier

- **Five sections instead of 18 flat tabs**. Sections fit in working memory; you can scan the top nav and know roughly where to look.
- **Names describe the job, not the page**. "Card Readers" instead of "Terminal". "Subscription" instead of "Billing" (so it doesn't collide with the customer-facing billing flow). "Tax" instead of separate "Tax Jurisdictions" and "Tax Rates" — they're one task, one page.
- **Related work lives together**. Tax jurisdictions and rates are one page. Per-location Stripe and per-location QBO are no longer split across two different tabs. The catalog's product/category/module trio is one section.
- **No more "Advanced" dump**. Custom domain → Marina. API keys → Team. Webhooks → Integrations. Every leaf has a real home.
- **Routes are predictable**: `/settings/<section>/<leaf>`. Deep-linkable, shareable, no tab state to keep track of.

### URL structure

| Section | Leaf | URL |
|---|---|---|
| Marina | Profile | `/settings/marina/profile` |
| Marina | Branding | `/settings/marina/branding` |
| Marina | Custom Domain | `/settings/marina/domain` |
| Team | Members | `/settings/team/members` |
| Team | Roles | `/settings/team/roles` |
| Team | API Keys | `/settings/team/api-keys` |
| Team | Audit Log | `/settings/team/audit` |
| Pricing & Payments | Payment Terms | `/settings/payments/terms` |
| Pricing & Payments | Stripe Connect | `/settings/payments/stripe` |
| Pricing & Payments | Tax | `/settings/payments/tax` |
| Pricing & Payments | Card Readers | `/settings/payments/card-readers` |
| Pricing & Payments | Discounts | `/settings/payments/discounts` |
| Pricing & Payments | Subscription | `/settings/payments/subscription` |
| Catalog | Products & Rates | `/settings/catalog/products` |
| Catalog | Categories | `/settings/catalog/categories` |
| Catalog | Modules | `/settings/catalog/modules` |
| Integrations | QuickBooks | `/settings/integrations/quickbooks` |
| Integrations | Email Sender | `/settings/integrations/email` |
| Integrations | Webhooks & API | `/settings/integrations/api` |

19 leaves under 5 sections. Bare `/settings` lands on `/settings/marina/profile`.

### Layout pattern

Two-level navigation:

```
┌─ Settings ───────────────────────────────────────────────────────────────┐
│  [Marina] [Team] [Pricing & Payments] [Catalog] [Integrations]           │
├──────────────────────────────────────────────────────────────────────────┤
│ Profile · Branding · Custom Domain                                       │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│   <leaf content>                                                         │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

Top strip = section. Sub-strip = leaves of the active section. Both update the URL. Top strip is visible from anywhere in Settings; the sub-strip changes per section.

This matches the pattern Billing / Insights / Accounting already use, so users don't learn a new nav.

### Implementation chunks

The redesign is its own track, sized for delivery one leaf at a time:

- **S1. Layout shell + new routes** (≈2 days). New `SettingsLayout` component renders the section + sub-strip; new route tree at `/settings/<section>/<leaf>`; bare `/settings` redirects to `/settings/marina/profile`. All 19 routes mounted but rendering thin placeholders.
- **S2. Marina section** (≈2 days). Three leaves: Profile, Branding, Custom Domain. Each is one file under `apps/web/src/pages/settings/marina/`. Lift the current marina-profile + branding + custom-domain UI verbatim into the new files; drop the old single-page glue.
- **S3. Team section** (≈3 days). Members, Roles, API Keys (new), Audit Log. API Keys is a new leaf surfaced from the existing `ApiKey` Prisma model. Audit Log is the existing component rendered in-shell.
- **S4. Pricing & Payments section** (≈4 days). Six leaves. The biggest single chunk because it also merges the Tax Jurisdictions + Sales Tax Rates pages into one Tax page, and renames Subscription clearly.
- **S5. Catalog section** (≈2 days). Lift Products & Rates (the 1736-line `SettingsProducts.tsx`), Categories (`CategoriesSettings.tsx`), Modules tab.
- **S6. Integrations section** (≈2 days). QuickBooks (existing), Email Sender (lift), Webhooks & API (new — pulls together webhook destinations + the API key list cross-link to Team).
- **S7. Delete the legacy monolith** (≈1 day). Drop the old `Settings.tsx` 2937-line file once every leaf is migrated. Drop the legacy `?tab=` query-string handling. Update `SETTINGS_SUBNAV` to the new 19-entry structure (or replace it with two coordinated subnav arrays).

S1 first, then S2–S6 in any order, then S7. Each leaf inside a section can be split across PRs if the lift is heavy (e.g. `Products & Rates` alone is bigger than some whole sections).

### What stays the same

- `/api/settings/*` endpoints. Backend doesn't move.
- All Prisma models. Pure UI/routing change.
- The 5 sub-app routes (`SettingsBilling`, `SettingsTaxRates`, etc.) keep their underlying components — they just get re-homed under the new IA. The Tax page merges two old screens into one but reuses the same `SettingsTaxRates` logic; Subscription is the existing `SettingsBilling`.

---

## Mental model behind the redesign

For each app, the sidebar should walk top-to-bottom in roughly the order a user would touch it during their day. The grouping rule:

1. **Home** — what changed since I last looked.
2. **The things I manage** (nouns: slips, boats, customers, tenants).
3. **What I do today** (verbs: dock walks, transient check-in, concierge).
4. **Money in** (POS, fuel, rentals, invoices).
5. **Money out / books** (purchase orders, inventory, accounting).
6. **Pipeline** (leads, waitlist — future revenue).
7. **Communications** (announcements, messages, email automation).
8. **Insights** (reports, analytics, audit).
9. **Settings** — always pinned to the bottom of the sidebar.

Same skeleton for portal/admin, just different nouns.

---

## Marina Dashboard (`apps/web`) — proposed sidebar

```
HOME
  └─ Dashboard

MARINA                           (the assets, relationships & their money)
  ├─ Slips
  ├─ Boats
  ├─ Customers
  ├─ Contracts
  └─ Billing                     (Invoices, A/R Aging, Disputes,
                                  Chart of Accounts, Deferred Revenue,
                                  Rent Roll — all as sub-nav inside)

DAILY OPS                        (what staff actively do)
  ├─ Dock Walks
  ├─ Transient                   [module-gated]
  ├─ Launch Ramp                 [module-gated]
  ├─ Rentals                     [module-gated]
  └─ Concierge                   [module-gated]

POINT OF SALE
  ├─ POS
  └─ Fuel

BACK OFFICE                      (books & supply — money-out, not money-in)
  ├─ Accounting                  (Overview, Setup, Periods,
  │                               Sync Health, Reconciliation,
  │                               Change Log — sub-nav inside)
  ├─ Purchase Orders
  └─ Inventory

PIPELINE
  ├─ Leads
  └─ Waitlist

COMMUNICATIONS
  ├─ Announcements
  └─ Email Automation            (currently dead code — revive or remove)

INSIGHTS                         (becomes a first-class section — see
                                  "Robust Reporting" below)
  ├─ Overview                    (live KPI dashboard — landing)
  ├─ Operations
  ├─ Financial
  ├─ Customers & CRM
  ├─ Communications
  ├─ Compliance & Audit
  ├─ Scheduled & Saved
  └─ Custom Builder

══════════════════════════════════
⚙ Settings                        (pinned to footer of sidebar)
   └─ Marina Profile, Locations, Branding, Billing, Team, Roles,
      Tax, Categories, Catalog, Terminal, Modules, Email, Advanced,
      Audit Log
```

### Why this flows better

- **"Marina"** is the customer-relationship hub: slips, boats, customers, contracts, *and the billing those relationships generate*. Staff looking at a customer want their invoices in the same neighborhood, not three sections away.
- **"Daily Ops"** is purely *what you do today*. A staff member starting a shift goes here. Rentals is a verb (operational reservations), so it moves out of Revenue.
- **"Point of Sale"** is the cash drawer — keeps POS and Fuel together, separate from invoice-based billing.
- **"Back Office"** is books & supply only — Accounting, Purchase Orders, Inventory. Money-in lives with the customer (Marina > Billing); money-out and the GL live here.
- **"Pipeline"** stays as forward-looking customer acquisition.
- **"Communications"** finally has a home. Announcements stops being filed under "Admin".
- **"Insights"** absorbs Reports plus future analytics.
- **Settings is pinned to the bottom** — visually de-emphasized, single entry point. Audit log lives inside it (it's a compliance/governance tool, not a daily destination).

### Old → new mapping (web)

| Old location | New location |
|---|---|
| Overview > Dashboard | Home > Dashboard |
| Marina Ops > Slips, Boats, Contracts | Marina > Slips, Boats, Contracts |
| Marina Ops > Dock Walks, Transient, Ramp, Concierge | Daily Ops > … |
| Revenue > Rentals | Daily Ops > Rentals |
| Revenue > POS, Fuel | Point of Sale > POS, Fuel |
| Revenue > Billing | Marina > Billing |
| Revenue > Inventory, Purchase Orders | Back Office > Inventory, Purchase Orders |
| Revenue > Rent Roll *(unlinked)* | Marina > Billing > Rent Roll (sub-tab) |
| CRM > Leads, Waitlist | Pipeline > Leads, Waitlist |
| CRM > Customers | Marina > Customers |
| Admin > Reports | Insights > Reports |
| Admin > Announcements | Communications > Announcements |
| Admin > Audit Log | Settings > Audit Log (sub-tab) |
| Admin > Accounting Overview | Back Office > Accounting > Overview |
| Admin > Accounting Hub | Back Office > Accounting > Setup |
| Admin > Settings | ⚙ Settings (footer) |
| Admin > Portfolio | **Removed** (move to `apps/admin` or new portfolio app) |
| `/settings/billing,tax-rates,products,pos-discounts,quickbooks` | Children of `/settings/*` shell |
| `apps/web/src/pages/EmailAutomation.tsx` (orphaned) | Communications > Email Automation (or delete) |

---

## Customer Portal (`apps/portal`) — proposed sidebar

Current portal is flat: Dashboard, Invoices, Payment Methods, My Boats, Insurance, Concierge, Waitlist, Announcements. Messages is routable but invisible. There's no profile area at all.

```
HOME
  └─ Dashboard                   (overdue invoices, expiring insurance,
                                  card warnings — "what needs attention")

MY MARINA
  ├─ My Slip                     (NEW — read-only map + dockmaster info)
  ├─ My Boats
  ├─ Insurance
  └─ Documents                   (NEW — signed contracts, certs, receipts)

BILLING
  ├─ Invoices
  └─ Payment Methods

SERVICES
  ├─ Concierge
  ├─ Reservations                (NEW — bookings from rental/transient widgets)
  └─ Waitlist

COMMUNICATIONS
  ├─ Announcements               (one-way broadcasts)
  └─ Messages                    (currently orphaned — promote into nav)

══════════════════════════════════
⚙ Account                         (NEW — pinned to footer)
   ├─ Profile
   ├─ Notification Preferences   (uses existing `/communication-prefs` API)
   ├─ Security
   └─ Help & Support             (NEW — FAQ + ticket form via support API)
```

Why: gives customers the same noun→verb flow (assets → billing → services → comms → account). Closes three notable gaps: profile/preferences page, help, and Messages discoverability.

---

## Platform Admin (`apps/admin`) — proposed sidebar

Current admin is 9 flat items. Group them.

```
HOME
  └─ Dashboard

TENANTS
  ├─ Tenants                     (Detail page broken into nested
  │                               sub-routes: Overview, Users, Billing,
  │                               Audit, Feature Flags)
  ├─ Trials
  └─ Tenant Deep Dive            (currently orphan — promote here)

REVENUE
  ├─ SaaS Billing
  └─ Analytics

OPERATIONS
  ├─ System Health
  ├─ Support
  ├─ Webhooks                    (NEW — ProcessedWebhook + QboWebhookDelivery
  │                               failures, retry; very high ops value)
  └─ Activity Log

══════════════════════════════════
⚙ Configuration                   (pinned to footer)
   ├─ Platform Settings
   └─ My Profile                  (NEW — admins can manage other admins
                                   but have no own preferences page)
```

Why: gives admins an obvious mental ladder (tenants → revenue → operations → config). Webhooks console is the single highest-value addition — failed Stripe/QBO deliveries currently sit silent.

---

## Robust Reporting & Analytics (Insights section)

Today, the marina dashboard exposes a single `/reports` page plus a one-off `/reports/sales-tax` route. Behind the scenes, the API already has `reports.ts`, `bi-api.ts`, `cross-tenant-analytics.ts`, `report-data.ts`, and a `ScheduledReport` model — almost none of which is surfaced. The Helm data model has 100+ tables and we are reporting on ~3 of them.

The goal: every domain we *operate on* should have a corresponding report and a live dashboard. Insights becomes the section a marina owner opens for "how is the business doing," and the section an accountant opens at month-end close.

### IA inside Insights

```
/insights
  /overview                    Live KPIs landing (occupancy, MTD revenue,
                               A/R, leads, compliance, alerts)
  /operations                  ── operational dashboards & exports
    /occupancy                 Slip occupancy now / trend / by dock
    /dock-walks                Findings by dock, repeat issues, completion
    /transient                 Arrivals, overstays, no-shows, length-of-stay
    /rentals                   Utilization %, surge effectiveness, suggestions hit-rate
    /fuel                      Sales vs deliveries, margin, pump uptime
    /pos                       Sales by terminal, by category, voids/refunds
    /inventory                 Turnover, stock-outs, shrinkage, slow movers
    /purchasing                PO aging, vendor lead-time, accruals
  /financial                   ── books-grade reports
    /revenue                   By location/product/period, MRR vs transient
    /ar-aging                  Buckets, customer drilldown
    /card-rail-mix             Card vs ACH vs cash; surcharge capture
    /refunds-chargebacks       Volume, reasons, dispute outcomes
    /deferred-revenue          Schedules, recognition, ASC 606
    /sales-tax                 Existing /reports/sales-tax — relocated
    /pnl                       Income statement (per-period, per-location)
    /balance-sheet             From GL
    /cash-flow                 Direct-method, from payments
    /reconciliation            Stripe ⇄ Helm ⇄ QBO three-way state
    /trial-balance             GL trial balance for close
  /customers                   ── CRM-grade reports
    /ltv                       Customer lifetime value, cohorts
    /churn                     Cancellations, contract non-renewal
    /pipeline                  Lead conversion, source ROI, velocity
    /waitlist                  Depth, age-in-queue, conversions
    /nps                       NpsSurvey results, drivers
    /compliance                Insurance expiry, safety records, COI gaps
    /card-expiry               Forecast of expiring cards by month
  /communications              ── outbound performance
    /email                     Volume, deliverability, opens, clicks, bounces
    /sms                       Volume, opt-out rate
    /automations               Rule-by-rule performance & errors
    /announcements             Reach, read-rate (PortalMessage-backed)
    /suppression               List growth, top reasons
  /compliance-audit
    /audit-log                 Full search (replaces top-level /audit-log)
    /admin-actions             AdminAuditEvent feed
    /period-close              Open/closed periods, attestations
    /qbo-sync                  Sync health, deltas, errors history
    /webhooks                  Stripe & QBO delivery success/retry/dead-letter
  /scheduled-and-saved
    /scheduled                 ScheduledReport CRUD + run history
    /subscriptions             "Email me this report weekly" per user
    /saved                     Saved filters/views per report
    /exports                   Export center: CSV / Excel / PDF, history
  /custom-builder              UNIVERSAL REPORT BUILDER — toggle on/off
                               every model and field across the entire
                               database, build any report. See dedicated
                               section below.
```

### Cross-cutting reporting features

Every report (existing and new) gets the same chrome:

- **Filters bar** — date range, location(s), product/service, customer, comparison-period.
- **View toggle** — Table / Chart / KPI cards / Pivot.
- **Drill-down** — every row links to the source entity (invoice, customer, slip, etc.).
- **Save view** — store filter+view as a saved report under the user.
- **Schedule** — email a CSV/PDF on a cron, to a list of recipients (uses `report-scheduler` queue).
- **Subscribe** — "send me this weekly" without admin scheduling.
- **Export** — CSV, Excel, PDF (existing `pdf.ts`); jobs run via the BullMQ `report-scheduler` queue and land in the Export Center.
- **Permissions** — every report respects `CustomRole` permissions and location scope.
- **Annotation** — analysts can pin notes on a date range ("rate change deployed 2026-04-01").

### Platform Admin reporting (new)

Mirror the same shape inside `apps/admin > Insights` (rename "Analytics" to "Insights"):

- **Platform health** — MRR, ARR, GMV, take-rate, active tenants, churn, trial-conversion funnel.
- **Tenant benchmarks** — anonymized cross-tenant percentiles (occupancy, A/R days, refund rate). Backed by `cross-tenant-analytics.ts`.
- **Support SLAs** — first-response, resolution time, backlog by severity.
- **Reliability** — webhook delivery success, queue depth/lag, API error rate, email send failures (`Tenant.lastEmailFailure*`).
- **Adoption** — feature flag rollout adoption, module enablement %, login frequency, CRM/Accounting integration coverage.

### Customer Portal reporting (light)

Not a "reports" page, but each portal section gets a small "year in review" / activity summary:

- My spend (by year, by category) on the Invoices page.
- My usage (transient stays, fuel purchases, rentals) on the Dashboard.
- Boat history (service, dock walks observed, photos) on each boat's page.

### Backend: what to build vs reuse

Reuse:
- `apps/api/src/routes/reports.ts` — extend, don't replace.
- `apps/api/src/routes/bi-api.ts` — backs the Custom Builder.
- `apps/api/src/services/report-data.ts` — dataset assembly.
- `apps/api/src/services/cross-tenant-analytics.ts` — admin benchmarks.
- `report-scheduler` BullMQ queue — schedules + exports.
- `ScheduledReport` Prisma model — persistence.

Add:
- A `ReportDefinition` table (id, slug, name, dataset, default filters, default viz, allowed roles).
- A `SavedReportView` table (user, report, filters, viz, name).
- A `ReportSubscription` table (user, report, schedule).
- Materialized views or a small warehouse layer (e.g., per-day per-location revenue rollup) to keep dashboards fast — start with Postgres materialized views, graduate to a real warehouse only if needed.
- Caching layer for live dashboards (Redis, 60s TTL per report+filter hash).

### Universal Report Builder ("report on anything")

The pre-built reports above cover the 80% case. The other 20% — every ad-hoc question a marina owner has ever asked an analyst at 11pm — needs a generic builder where **every table and every column in the database is reportable**, with toggles to opt fields in or out, filters, joins, and aggregations. This is the single highest-leverage feature in the Insights section.

**Goal:** any user with the right permission can pick a starting model (e.g., `Boat`), tick on the fields they want (length, beam, owner name, slip number, last dock walk date, insurance expiry, MTD spend), filter (e.g., insurance expires within 30 days), group / aggregate, save the view, schedule it, and export.

#### Architecture

1. **Data Catalog (auto-generated from Prisma schema, ~111 models today)**
   - On API startup, walk `apps/api/prisma/schema.prisma` and emit a `DataCatalog` JSON: for each model → its fields, types, relations, and a set of default attributes (label, description, format, allowed operators per type).
   - File: `apps/api/src/services/report-catalog.ts` (new). Re-runs on schema migration via a postinstall hook so the catalog never drifts.
   - Each model and each field carries metadata flags: `tenantScoped` (almost always true), `locationScoped`, `sensitive` (PII / secrets), `enabledByDefault`, `requiredPermission`, `joinable`, `aggregatable`, `dimensionOrder`.

2. **Catalog overrides — admin toggle UI**
   - Two layers of toggles:
     - **Platform layer** (`apps/admin > Configuration > Report Catalog`): SUPERUSER-only. Globally hide things that should never leave Helm — e.g., `WebhookSecret`, `ApiKey.hashedKey`, `Payment.stripeChargeId`, audit-log raw payloads. Stored as a `ReportCatalogOverride` row.
     - **Tenant layer** (`apps/web > Settings > Reporting`): tenant admins decide which fields/models *their* users see. Useful for hiding columns by role (e.g., dock staff don't see customer credit-card metadata).
   - The effective catalog for a request = base schema + platform overrides + tenant overrides + role permissions, computed and cached per (tenant, role) tuple.

3. **Builder UI** (`apps/web/src/pages/insights/CustomBuilder.tsx`)
   - **Left rail:** searchable tree of models. Toggling a model on adds it as the report's base. Toggling a *related model* (e.g., from Boat → Customer → Insurance) auto-adds the join.
   - **Field tray:** for the active models, a checkbox list of fields. Drag into Columns, Rows, Filters, Aggregates, or Sort.
   - **Visual canvas:** Table / Pivot / Chart (line/bar/area/donut) / KPI tiles. Same chrome as the rest of Insights.
   - **Filter bar:** type-aware operators (`=`, `≠`, `>`, `<`, `between`, `in`, `contains`, `is null`, `last N days`, `this month`, `relative to today`, etc.).
   - **Computed fields:** small expression language (e.g., `Invoice.total - Invoice.amountPaid`). Whitelisted to safe arithmetic + a few helpers (date_diff, money_to, etc.).
   - **Preview:** runs against tenant data with a hard query budget (e.g., 5s max, 10k rows max for live preview); paginates beyond that.
   - **Save / Share / Schedule:** persists as a `SavedReportView` + optional `ReportSubscription`.

4. **Backend query engine**
   - Builder UI emits a JSON spec (validated against a Zod schema in `packages/shared-types`).
   - API translates the spec to Prisma queries (or, for grouped/window queries, to parameterized SQL via `prisma.$queryRaw` against a curated allowlist).
   - **Hard guardrails enforced server-side**, never client-side:
     - Tenant scope automatically appended to every query (no opt-out).
     - Location scope appended for users limited to specific locations.
     - Field/model permission check vs. user's role; rejected fields stripped with a warning.
     - Sensitive fields *never* selectable, even for admins, unless explicitly allowed by the platform layer.
     - Query budget: row-limit, time-limit, JOIN-depth cap (default 4), and an EXPLAIN-cost ceiling — fall back to async export above the threshold.
   - **Async path:** if the query is too heavy for live preview, queue a `report-scheduler` job, write the result to R2, surface in the Export Center.

5. **Caching & performance**
   - Cache keyed by `(catalog version, normalized spec, tenant, role, location set)` — Redis with 60s TTL for live dashboards, 24h TTL for scheduled/saved.
   - Materialized views for hot rollups (per-day per-location revenue, per-month occupancy, AR-aging snapshot). Refreshed by a daily job.
   - Heavy "report on anything" queries are *not* allowed to hit hot transactional tables during business hours unless the user has a "heavy reports" permission — soft-warn and offer to schedule for off-peak.

6. **Permissions model**
   - Two new permissions in the `CustomRole` system:
     - `reports:run-custom` — can use the builder.
     - `reports:run-sensitive-fields` — can opt-in to fields tagged sensitive (still bounded by the platform-layer allowlist).
   - Plus per-model toggles in tenant settings for fine-grained control by role.

7. **Audit & explainability**
   - Every custom-report run is logged in `AuditEvent` with: spec hash, fields touched, row count, runtime. So an owner can see *who ran what* — useful for compliance and for spotting expensive queries.
   - Each saved report has a "show me the SQL" / "show me the fields" panel for debugging.

8. **AI assist (slot for later)**
   - Hook the natural-language builder ("show me boats whose insurance expires next month with no payment in 90 days") into this engine: Claude returns a JSON spec, the engine validates and runs it. The AI never sees raw data — it only emits a spec. This protects against prompt-injection exfiltration and keeps tenant scope intact.

#### Data model additions

| Table | Purpose |
|---|---|
| `ReportCatalogOverride` | Platform / tenant toggles for which models/fields are exposed |
| `SavedReportView` | A user's saved spec + viz |
| `ReportSubscription` | Schedule + recipients for a saved view |
| `ReportRun` | Audit row per run (spec hash, user, runtime, row count, status) |
| `ReportComputedField` | Tenant-defined named expressions reusable across reports |

#### Critical files

- **New:** `apps/api/src/services/report-catalog.ts` — schema introspection + catalog assembly.
- **New:** `apps/api/src/services/report-engine.ts` — spec → query translator with guardrails.
- **New:** `apps/api/src/routes/insights-builder.ts` — REST endpoints (`GET /catalog`, `POST /run`, `POST /save`, `POST /schedule`).
- **New:** `apps/web/src/pages/insights/CustomBuilder.tsx`.
- **New:** `apps/admin/src/pages/ReportCatalog.tsx` — platform-layer toggle UI.
- **New:** `apps/web/src/pages/SettingsReporting.tsx` (under Settings) — tenant-layer toggle UI.
- **Reuse:** existing `bi-api.ts`, `report-data.ts`, `report-scheduler` queue.
- **Schema:** Prisma migration adding the five tables above + a `Tenant.reportCatalogVersion` cache key.

#### Why design it this way

- **Schema-driven** means new tables are reportable the moment they're added — no per-report engineering work.
- **Two-layer toggle** lets the platform protect what must never leak (PCI, secrets, audit raw payloads) while still giving tenants self-service control.
- **Guardrails on the server** mean the UI can be permissive without becoming an exfiltration vector.
- **Spec → engine → query** keeps the AI assistant safely sandboxed: it can only emit a validated spec, never run free-form SQL.
- **Audit & explain** keeps month-end and SOX-style reviews tractable.

### Phasing the reporting work

Slot into the main rollout:

- **Phase 2** (with the IA shell): introduce `/insights` as a routed shell with sub-nav. Migrate the existing `/reports` and `/reports/sales-tax` underneath. No new reports yet.
- **Phase 3**: ship the cross-cutting chrome (filters, views, save, schedule, export, subscribe). Pick **5 anchor reports** — Occupancy, Revenue, A/R Aging, Card Rail Mix, Sales Tax — and migrate them onto the new chrome. This proves the pattern.
- **Phase 5a**: fill out Operations + Financial dashboards (most operator value).
- **Phase 5b**: fill out Customers + Communications + Compliance reports.
- **Phase 5c**: ship the **Universal Report Builder** (catalog generator → admin toggle UI → tenant toggle UI → builder UI → engine + guardrails → save/schedule) and the admin Insights revamp.
- **Phase 5d**: bolt the AI natural-language layer onto the Universal Builder spec format.

---

## Robust New-Feature Catalog (things to consider)

This is a deeper, opinionated list of features worth adding — beyond the IA fixes and the reporting build-out. Each one is tagged by app and has a rough size (S/M/L) so it can be triaged. Where the backend already supports it, the path is given.

### AI / Anthropic-powered (key already configured)

- **Natural-language report builder** (M, web) — "show me revenue by location last quarter vs prior year". Wraps `bi-api.ts` with a Claude tool-calling layer.
- **Dock-walk voice notes** (M, web mobile) — speech-to-text + auto-categorization of issues (electrical, plumbing, structural). `apps/web/src/pages/DockWalkRunner.tsx`.
- **Smart concierge triage** (M, web) — auto-classify and route concierge requests; suggest replies. Backend: `concierge.ts`.
- **Lead scoring & next-best-action** (M, web) — score `Lead` rows, suggest follow-up cadence.
- **Churn prediction** (M, web) — score active customers, surface at-risk in CRM.
- **Invoice line-item categorization** (S, web) — auto-suggest GL category; reduces accountant cleanup.
- **Email draft assistant** (S, all) — staff "compose" with tone presets.
- **Insurance AI v2** (M, portal) — review/correct extracted fields before save (already discussed; expand to add coverage gap warnings).
- **Marina-photo auto-tagging** (S, web) — categorize boat/slip photos for fast retrieval.
- **AI summarizer for tenant Deep Dive** (S, admin) — paragraph-form executive summary.

### Marina operations (where backend signals exist)

- **Service / work-order system** (L, web) — haul-out, launch, winterize, bottom paint. New domain. Hooks into Inventory + Billing + Calendar.
- **Pump-out compliance** (S, web) — `PumpOut` model exists; build a queue + reporting page under Daily Ops.
- **Slip swap / sublet** (M, web) — workflow for owners to sublet their slip to a transient; revenue split.
- **Wait-list auto-promote** (S, web) — when a slip frees up, auto-offer to next eligible waitlist with expiring offer link.
- **Liveaboard registry** (S, web) — flag + extra fees + compliance docs per slip.
- **Tide / weather / current widget** (S, web) — real signal for dockmasters; embed on Dashboard and DockWalkRunner.
- **Vessel registration tracking** (S, web) — expiration alerts; companion to Insurance.
- **Incident / spill report** (S, web) — regulatory paperwork generator.
- **Boat photo-history** (S, portal/web) — track condition over time; ties to dock walks.

### Bookings & online sales

- **Public-facing slip application** (M, widgets) — long-term lease application, not just transient. New widget + API endpoint feeding `Lead` + `WaitlistEntry`.
- **Membership tiers / loyalty** (L, web+portal) — tiered pricing, perks, slip discounts. New domain.
- **Gift cards / store credit** (M, web+portal) — POS-integrated; ties to Stripe + GL.
- **Slip-for-sale marketplace** (L, web+portal) — for marinas where slips are owned. New domain.
- **Calendar integration** (S, web+portal) — Google/Outlook for reservations.
- **Apple Wallet / Google Wallet pass** (S, portal) — slip access pass / gate code.

### Communications

- **Two-way SMS conversations** (M, web) — currently SMS is one-way notifications.
- **Drip / sequence campaigns** (M, web) — multi-step email/SMS automations beyond single rules.
- **Customer review capture** (S, portal) — post-service NPS already exists (`NpsSurvey`); add Google/Yelp deep-link.
- **Referral program UI** (S, portal) — `ReferralPartner` model exists; expose to customers.
- **Newsletter system** (S, web) — extend Announcements with templated newsletters.
- **Tenant in-app announcements** (S, admin) — admins notify all tenants of platform updates.

### Accounting & finance

- **1099-NEC reporting** (M, web) — vendor 1099 generation at year-end.
- **W-9 collection workflow** (S, web) — secure vendor W-9 capture with reminders.
- **Bank feeds / Plaid** (L, web) — direct bank reconciliation; reduces reliance on QBO.
- **Approvals workflow** (M, web) — POs and refunds above $X require manager approval.
- **Vendor portal** (L, new app or admin tenant-side) — vendors submit invoices, see PO status.
- **Expense management** (M, web) — staff expense submission with receipts.
- **Cash drawer / shift management** (M, web) — POS shift open/close, over/short reporting.
- **Tip pooling** (S, web) — dockhand tips split across shift.
- **Multi-currency** (L, all) — for marinas in CAD/MXN/Caribbean.

### Compliance, security, governance

- **GDPR / CCPA data export per customer** (M, all) — already have `TenantExport`; build `CustomerExport`.
- **Right-to-be-forgotten flow** (M, all) — soft-delete with retention windows.
- **SOC 2 evidence package** (M, admin) — automated control evidence collection.
- **SSO (SAML / OIDC)** (M, admin) — for enterprise tenants.
- **SCIM provisioning** (M, admin) — auto-provision staff users from IdP.
- **2FA enforcement policy** (S, web+admin) — admin-enforced; Clerk supports it.
- **API key management UI** (S, web) — `ApiKey` model exists; expose to tenants.
- **IP allowlisting per tenant** (S, web) — for higher-tier customers.
- **Tenant audit packet export** (S, admin) — bundle audit log + period close + recon for auditors.

### Hardware & integrations

- **Smart gate / lock access** (L, web) — issue keys, revoke on offboarding; webhook from gate hardware.
- **Pedestal metering** (M, web) — power/water metering already partially there (`MeterReading`); finish the loop.
- **License plate recognition for ramp** (M, web) — auto-create ramp tickets.
- **Fuel pump SCADA / Veeder-Root integration** (M, web) — auto-import sales.
- **Public REST + Webhook API for tenants** (L, all) — let tenants build integrations.
- **Zapier / Make integration** (M, all) — official triggers/actions.
- **Slack / Teams notifications** (S, web) — staff channel pings (low slip count, overdue invoice, etc.).
- **DocuSign embed** (S, web) — alternative to native eSign for tenants who require it.

### Customer portal depth

- **My documents** (M, portal) — already noted; expand with downloadable history.
- **Reservations** (M, portal) — already noted.
- **Maintenance request form** (M, portal) — feeds the new work-order system.
- **Family / multi-user accounts** (M, portal) — boat is shared across spouse + kids; multiple logins per customer.
- **Boat owner-to-owner messaging** (S, portal) — opt-in "do you have a fender I can borrow" community.
- **Push notifications (PWA)** (S, portal) — "your invoice is paid", "your boat's pumped out".

### Mobile & offline

- **Mobile staff PWA** (M, web) — offline-capable dock walks already exist; expand to transient check-in, ramp tickets, POS.
- **Native iOS/Android customer app** (L, portal) — wrap the PWA or build native; Wallet pass + push.

### Multi-marina / portfolio

- **Portfolio app or section** (L, new) — for owners of multiple marinas; the current `/portfolio` is a stub.
- **Tenant benchmarks** (M, admin) — see Reporting.
- **Group billing / consolidation** (M, web) — single invoice to a customer with boats at multiple locations.

### Internationalization & accessibility

- **i18n framework** (M, all) — start with en-US; structure for future locales.
- **WCAG 2.1 AA compliance pass** (M, all) — color contrast, keyboard nav, ARIA on the new IA shells.
- **High-contrast / dark mode polish** (S, all) — admin already dark; web/portal need theme tokens.
- **Print stylesheets** (S, web+portal) — for invoices, reports, work orders.

### Observability & ops (developer-facing but worth listing)

- **In-app feature flag UI** (S, admin) — already on roadmap; surface flag state to engineers.
- **Job queue dashboard** (S, admin) — BullMQ has Bull Board; expose under admin Operations.
- **Slow-query log surfacer** (S, admin) — pg_stat_statements top-10 panel.
- **Error budget / SLO dashboard** (S, admin) — paired with Sentry.
- **Synthetic monitoring** (S, ops) — uptime checks against staging + prod.

---

## Testing Strategy

### What exists today

- `apps/api/tests/` — solid Vitest coverage on services (billing, GL posting, tax, period guard, costing, QBO sync, etc.) and routes (slips, dock-walks, rentals, settings, audit-log, etc.). Good foundation.
- `apps/web/src/lib/posCnp.test.ts` — a single frontend unit test.
- `TESTING.md` — a manual playbook, useful for QA but not automated.

### What's missing (and should be added alongside the IA work)

| Layer | Tool | Coverage today | What to add |
|---|---|---|---|
| Frontend unit | Vitest + RTL | ~1 file | Tests for `AppLayout`, `PortalLayout`, `AdminLayout`, the new `SettingsLayout` / `BillingLayout` / `Insights` shells. Test nav rendering by role and module flags. |
| Component / visual | Storybook + Chromatic *(or Playwright screenshots)* | none | Stories for every `ui-kit` component (`Sidebar`, `TopBar`, `Breadcrumb`, `EmptyState`, report chrome) with visual regression pinned. |
| Frontend integration | Vitest + MSW | none | Mock API; test routing, role-gated nav, location-switcher behavior, settings tabs save/restore. |
| E2E | Playwright | none | One smoke spec per top-level nav section, per app. Critical-flow specs: invoice → payment → GL post; dock walk → issue → invoice; transient check-in → bill → checkout. |
| Accessibility | `@axe-core/playwright` | none | Run axe on every page in the new IA — fail CI on serious violations. |
| Performance | Lighthouse CI | none | Budgets per app: TTI < 3s, LCP < 2.5s, JS bundle < 500KB on web. Wire into CI. |
| API load | k6 or Artillery | none | Bench the heavy reports + the BI API; lock SLOs. |
| Security (SAST) | CodeQL or Semgrep | partial *(GitHub default?)* | Scan for SQLi, XSS, weak crypto, hardcoded secrets. |
| Dependency scan | `pnpm audit` + Dependabot | partial | Enforce in CI; auto-PR for patches. |
| Multi-tenant isolation | Vitest integration | implicit | Explicit test: every API route returns 404/403 for cross-tenant IDs. Generate from route file list. |
| Permission matrix | Vitest integration | partial | For each `CustomRole` permission, assert allowed/denied routes. Generate from permission registry. |
| Webhook idempotency | Vitest | partial *(QBO)* | Replay every webhook source twice (Stripe, QBO); assert single side-effect. |
| Migration rehearsal | Prisma + CI | none | On every PR, run `prisma migrate deploy` against a snapshot of prod schema; fail on drift. |
| Data invariants | Vitest scheduled | none | Nightly job: A/R = sum(invoice balances); GL debits = credits; reconciliation mismatch < $0.01. |
| Email/SMS deliverability | Sandbox + monitor | partial *(Tenant.lastEmailFailure*)* | Synthetic send through Resend/Twilio sandbox per release. |
| PDF / export determinism | Snapshot tests | none | Hash-stable PDFs for invoices, reports, statements. |
| Smoke (post-deploy) | Playwright | none | 30-second login + dashboard + invoice-detail check after every deploy. |
| Contract tests | Pact or shared-types | shared-types only | Versioned schemas between API and frontends to prevent breaking changes. |
| Chaos / resilience | manual or Toxiproxy | none | Verify graceful degradation when Redis, QBO, Stripe, R2 are down. |

### Recommended minimum bar for the IA migration

Before merging Phase 1-2 of the layout redesign:

1. Playwright smoke spec per app that opens every top-level nav item and asserts a known DOM marker. **Catches dead links during the reorg.**
2. axe-core scan on the new shells. **The redesign is the cheapest moment to fix a11y debt.**
3. Vitest tests on `AppLayout`/`PortalLayout`/`AdminLayout` covering: role gating, module gating, location-switcher, footer settings entry. **Locks the new contract.**
4. A 301-redirect test asserting every old URL still resolves (either the page or a redirect). **Prevents bookmarked links from 404ing post-migration.**

### Test-pyramid target shape

```
                 ┌──────────────┐
                 │  E2E (~50)   │  Playwright across web/portal/admin
              ┌──┴──────────────┴──┐
              │  Integration (~300) │  API routes + frontend with MSW
           ┌──┴───────────────────-─┴──┐
           │   Unit (~2000)             │  Services, components, utils
           └────────────────────────────┘
```

API integration is already strong. The two large gaps to close: frontend unit/component tests (currently ~1 file) and any E2E at all.

---

## Cross-app additions to plan for

These belong in `packages/ui-kit` and should be designed once for all three apps:

| Component | Used by | Why |
|---|---|---|
| `<Sidebar>` with grouped sections + footer slot | all three | Drives the redesign above |
| `<TopBar>` with notifications bell | all three | No app currently surfaces unread state |
| `<Breadcrumb>` | all three | Web has it in top bar; portal/admin don't |
| `<EmptyState>` | all three | Repeated ad-hoc across pages |
| Command palette (⌘K) | web + admin | Bundles search + quick-create + jump-to-page; massively shortens nav distance |

---

## Critical files to modify

| Concern | Path | Status |
|---|---|---|
| Web nav definition (the `NAV_SECTIONS` array) | `apps/web/src/components/AppLayout.tsx` (around line 163) | ✅ done in Task #328 |
| Web router | `apps/web/src/App.tsx` | ✅ done in Task #328 (Insights routes, redirects) |
| Web shared sub-nav primitive | `packages/ui-kit/src/components/SubNav.tsx` | ✅ moved to ui-kit; web imports from `@helm/ui-kit` |
| Web settings monolith (split into shell + tabs) | `apps/web/src/pages/Settings.tsx` (1309 lines) | ⏳ still needs Phase-2 work |
| Web Insights sub-section content | `apps/web/src/pages/Insights.tsx` (199 lines, mostly stubs) | ⏳ Phase 5 content build-out |
| Portal layout (add footer slot, group sections) | `apps/portal/src/components/PortalLayout.tsx` | ⏳ Phase 3 |
| Portal router | `apps/portal/src/App.tsx` | ⏳ Phase 3 |
| Admin layout (add groups + footer slot) | `apps/admin/src/components/AdminLayout.tsx` | ⏳ Phase 3 |
| Admin router | `apps/admin/src/App.tsx` | ⏳ Phase 3 |
| Admin tenant monolith (81KB → nested routes) | `apps/admin/src/pages/TenantDetail.tsx` | ⏳ Phase 5 |
| Shared sidebar/topbar components | `packages/ui-kit/src` | ⏳ Phase 4 deferred (need design tokens) |

---

## Phased rollout

### Phase 1 — Web sidebar reorder ✅ **DONE** (commit `6f9c18c`, Task #328)
- `NAV_SECTIONS` rewritten into the 8-group structure.
- Sidebar footer slot added; Settings pinned there.
- Audit Log moved into a Settings tab; `/audit-log` redirects to `/settings?tab=audit`.
- Rent Roll routed at `/billing/rent-roll`; legacy `/rent-roll` redirects.
- `EmailAutomation` revived under Communications (route restored).
- `/portfolio` defanged with a migration banner (route still mounted).

### Phase 2 — Web settings & billing shells (~60% done; ~3 days remaining)
**Done:**
- Billing wrapped with shared `SubNav` (Invoices, A/R Aging, Chart of Accounts, Disputes, Deferred Revenue, Rent Roll).
- Accounting Hub folded into routed sub-pages at `/accounting/{setup,periods,sync-health,reconciliation,change-log}`.
- `/settings/accounting` → `/accounting/setup` redirect in place.

**Still to do:**
1. Convert `/settings` into a layout shell with sub-nav; pull the remaining 13 in-page tabs out of `apps/web/src/pages/Settings.tsx` (1309 lines) into routed sub-pages. Only the Audit Log tab has been added so far — the other tabs still render via internal state.
2. Lift the standalone `/settings/billing`, `/settings/tax-rates`, `/settings/products`, `/settings/pos-discounts`, `/settings/quickbooks` routes into the same shell so URL structure matches the sub-nav.
3. Replace the placeholder Deferred Revenue page with a real schedule view (drops into existing slot at `/billing/deferred-revenue`).

**Verify:** back button at every level; deep links from emails/Slack still resolve; existing redirects unaffected.

### Phase 3 — Portal & admin sidebars (≈1 week) — **next up**
Portal and admin haven't been touched yet; both still match the "current state" descriptions earlier in this doc.

1. Restructure `PortalLayout.tsx` into the 5 groups + Account footer; promote `/messages` into nav.
2. Add portal `/account` shell with Profile / Notifications / Security / Help.
3. Restructure `AdminLayout.tsx` into the 4 groups + Configuration footer; promote `/tenants/:id/deep-dive` into Tenants group.
4. Add admin `/me` page.

**Verify:** click through each nav item in both apps; confirm no route 404s.

### Phase 4 — Shared `ui-kit` extraction (~60% done)
**Step 1 done.** `SubNav` (with `BILLING_SUBNAV` / `ACCOUNTING_SUBNAV` / `INSIGHTS_SUBNAV` / `SETTINGS_SUBNAV`) now lives in `packages/ui-kit/src/components/SubNav.tsx` and is exported from the package. All 15 web callsites import from `@helm/ui-kit`; the local `apps/web/src/components/SubNav.tsx` is gone. `react-router-dom` is now a peer dep of ui-kit.

**Deferred** — the remaining extraction items need design work first, not pure mechanical moves:

- **`Sidebar`** — a primitive already exists in `packages/ui-kit/src/components/Sidebar.tsx` but no app uses it. The three real sidebars are visually distinct on purpose: light web with a location switcher and module-gated items, dark portal, dark-gradient admin with `GlobalSearch`. Unifying them requires shared design tokens (active-state color, footer-slot pattern, section-label typography) and a polymorphic API that exposes those slots. Track separately; do not rush a primitive that the apps will then have to fight.
- **`TopBar`** — same shape: web has location switcher + page title, portal has user chip + sign-out, admin has `GlobalSearch` + ENV badge + Clerk controls. One primitive needs a config surface to hold all three. Pair with the notifications-bell wiring.
- **`Breadcrumb`** / **`EmptyState`** — small primitives; build when first re-used cross-app. Currently no callers outside web.
- **Notifications bell** — needs a backend feed (a `Notification` table or stream) before the UI is worth building. Tracked under Phase 5 big rocks.

The dead `Sidebar.tsx` already in ui-kit can stay; it documents an early API but is not imported anywhere.

### Phase 5 — Big rocks behind the new IA (≈6-8 weeks, parallelizable)
With the navigation skeleton in place, these new surfaces drop into the right slots:
- **Reporting build-out** (5a → 5c above): Operations + Financial dashboards, then Customers + Communications + Compliance, then Custom Builder + admin Insights.
- **Webhooks console** → admin Operations.
- **Customer Merge** → web Marina > Customers.
- **Transient Overstay queue** → web Daily Ops > Transient.
- **Pricing Suggestions** → web Daily Ops > Rentals.
- **Deferred Revenue** → web Marina > Billing.
- **Insurance AI review step** → portal My Marina > Insurance.
- **Documents hub & Reservations** → portal My Marina + Services.
- **Notifications API** → backs the bell across all three apps.
- **Break up `TenantDetail.tsx`** into nested routes.
- **Command palette (⌘K)** → web + admin (also the fastest jump-to-report shortcut).
- **Pick from the New-Feature Catalog above** — best near-term ROI candidates: service/work-order system, two-way SMS, cash drawer/shift mgmt, slip auto-promote, Slack notifications, public REST API, AI report builder, gift cards.

### Phase 6 — Test-pyramid build-out (parallelizable with all phases)
- Stand up Playwright + axe-core in CI; one smoke spec per app to start.
- Storybook + visual regression for `ui-kit` components built in Phase 4.
- Frontend Vitest + RTL coverage on the new layout shells (gating, modules, location switching).
- Old-URL 301 redirect tests as a guard rail for the IA migration.
- Lighthouse CI budgets, dependency scanning, migration-rehearsal job.
- Multi-tenant isolation + permission-matrix test generators.

---

## Verification

Phase 1 has already shipped — the validation work below applies to the **remaining** phases.

For the **rest of Phase 2** (Settings shell split):
1. `pnpm --filter @helm/web dev`, then click every section in `/settings` and confirm each lives at a real route (e.g., `/settings/team`, `/settings/branding`) rather than a `?tab=` query.
2. Hit every legacy in-page tab URL and the standalone routes (`/settings/billing`, `/settings/tax-rates`, `/settings/products`, `/settings/pos-discounts`, `/settings/quickbooks`) — confirm each either resolves or 301s to the new shell.
3. Confirm the Audit Log tab (already in place) and the new Deferred Revenue page (replacing the placeholder) both render under their new home.

For **Phase 3** (portal + admin restructure):
1. Open portal and admin in dev; click every new nav item and confirm no 404s.
2. Confirm `/messages` in portal is now visible in nav (currently routable but invisible).
3. Confirm portal `/account` and admin `/me` render.

For **Phase 4** (ui-kit extraction):
1. `pnpm --filter @helm/ui-kit build` succeeds.
2. All three apps import `SubNav` / `Sidebar` / `TopBar` from `@helm/ui-kit` (verify with `grep -rn "from '@helm/ui-kit'"`); no `apps/*/src/components/SubNav.tsx` duplicate remains.
3. Notifications bell renders in all three top bars (empty state if no data yet).

For **Phase 5** (reporting + big rocks): open a separate plan-mode session per feature — this document is the IA map, not their implementation plan. The Universal Report Builder in particular warrants its own design doc before code lands.

For **Phase 6** (testing): once Playwright is stood up, the smoke spec from "Recommended minimum bar for the IA migration" should be the first thing it runs.
