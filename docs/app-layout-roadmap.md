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

## Status as of `b6b393e` (May 11, 2026)

Most of **Phase 1** and a large chunk of **Phase 2** for the web app have already shipped via Task #328 (`6f9c18c Task #328: Redesign marina dashboard sidebar into intent-based sections`) and its follow-ons. The remainder of this roadmap should be read against that baseline.

| Item | Status | Where |
|---|---|---|
| Web sidebar reorganized into HOME / MARINA / DAILY OPS / POINT OF SALE / BACK OFFICE / PIPELINE / COMMUNICATIONS / INSIGHTS | ✅ Done | `apps/web/src/components/AppLayout.tsx` (`NAV_SECTIONS`) |
| Billing nested under Marina | ✅ Done | `NAV_SECTIONS` line 177 |
| Settings pinned to sidebar footer | ✅ Done | `FOOTER_NAV_ITEM` + footer render block |
| Audit Log promoted into a Settings tab + `/audit-log` redirect | ✅ Done | `Settings.tsx` audit tab; `App.tsx` redirect |
| Insights replaces Reports with Overview + 7 sub-sections | ✅ Done | `apps/web/src/pages/Insights.tsx` (199 lines, live KPIs on Overview, stubs elsewhere) |
| Shared `SubNav` primitive + `BILLING_SUBNAV` / `ACCOUNTING_SUBNAV` / `INSIGHTS_SUBNAV` constants | ✅ Done | `apps/web/src/components/SubNav.tsx` |
| Billing sub-nav (Invoices, A/R Aging, Disputes, Chart of Accounts, Deferred Revenue, Rent Roll) | ✅ Done | Wired through Billing/ARaging/Disputes/ChartOfAccounts/RentRoll/`BillingDeferredRevenue.tsx` |
| Rent Roll routed at `/billing/rent-roll` + `/rent-roll` redirect | ✅ Done | `App.tsx` |
| Accounting Hub folded into routed `/accounting/{setup,periods,sync-health,reconciliation,change-log}` | ✅ Done | `AccountingHub.tsx`, `AccountingOverview.tsx` |
| `/portfolio` defanged with migration banner | ✅ Done | `PortfolioDashboard.tsx` |
| `/reports` redirect → `/insights`; legacy `/email-automation` route restored under Communications | ✅ Done | `App.tsx` |
| Location-picker scoping for the 5 main entities + inventory isolation | ✅ Done (Tasks #339, #340) | API enforcement layer |
| Z-Reports nav link | ✅ Done (commit `bf86acb`) | `AppLayout.tsx` |
| **Web Settings shell split** — 13 in-page tabs still live inside `Settings.tsx` (only Audit Log was added as a tab) | ⏳ Partial | `apps/web/src/pages/Settings.tsx` (1309 lines) |
| **Portal sidebar restructure** — grouped into HOME / MY MARINA / BILLING / SERVICES / COMMUNICATIONS + Account footer; Messages now in nav | ✅ Done | `apps/portal/src/components/PortalLayout.tsx` (this branch) |
| **Admin sidebar grouping** — 4 groups + Configuration footer; `/me` page added | ✅ Done | `apps/admin/src/components/AdminLayout.tsx` (this branch) |
| **`ui-kit` extraction** — `SubNav` and the 4 nav constants moved into `packages/ui-kit`; web imports from `@helm/ui-kit`. Sidebar / TopBar / Breadcrumb / EmptyState deferred (need design tokens first) | ⏳ Partial | `packages/ui-kit/src/components/SubNav.tsx` |
| **Insights sub-section content** — all stubs except Overview | ⏳ Not started | `apps/web/src/pages/Insights.tsx` |
| **Universal Report Builder** | ⏳ Not started | — |
| **Test-pyramid build-out** | ⏳ Not started | — |

What this means for the rest of the doc: the **vision and target IA below are now live across all three apps**. Phase 1 + ~60% of Phase 2 had shipped on the source branch (commit `6f9c18c`); this branch adds the rest of Phase 2's route-based Settings shell, all of Phase 3 (portal + admin restructure), and the SubNav slice of Phase 4. What remains: Insights content build-out, Universal Report Builder, the heavier ui-kit unification (Sidebar/TopBar primitives with design tokens), Settings tab file-by-file extraction, and the test-pyramid build-out.

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
