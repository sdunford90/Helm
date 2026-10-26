# 13 — Integrations Ecosystem & Integration Platform Strategy

**Audience:** Product, partnerships, engineering leadership
**Date:** 2026-10-26
**Scope:** Which third-party integrations marina operators (independent, multi-site enterprise groups, municipal) need; what competitors already ship; partner-program and API realities per vendor; a phased integration roadmap; and an integration *platform* architecture for Helm, based on the current codebase.

> Legend used throughout
> - **Demand:** `SMB-TS` = table-stakes for independent/SMB marinas · `ENT-TS` = table-stakes for enterprise groups (Suntex, Safe Harbor, etc.) · `DIFF` = differentiator / win-theme · `NICHE` = segment-specific
> - **Effort:** `S` ≤ 2 engineer-weeks · `M` 2–6 eng-weeks · `L` > 6 eng-weeks (assumes the platform primitives in §5 exist; first integrations on the new framework pay a framework tax)
> - **Phase:** `Launch` (enterprise GA gate) · `6 mo` · `12 mo` · `Later`
> - Claims marked *(unverified)* come from secondary sources or could not be confirmed on the vendor's own pages.

---

## 1. Executive summary

1. **The enterprise market has already chosen a pattern: marina system + ERP + data lake.** Suntex, the largest independent operator, runs 72 locations on Storable's Molo + Stellar with a **NetSuite integration** for centralized accounting and a **data lake** for analytics. This is the closest thing to a reference architecture an enterprise buyer will hold Helm to ([Storable/Suntex, Dec 2024](https://www.storablemarine.com/resources/suntex-marinas-accelerates-enterprise-growth-with-storables-marine-technology-suite/)). Safe Harbor, owned by Blackstone Infrastructure and now buying MarineMax (which includes IGY Marinas and 70+ dealerships) for $1.5B, will need marina **and** dealer/service integrations across 150+ sites ([MarinaWorld, Aug 2026](https://www.marinaworld.com/news/safe-harbor-acquire-marinemax-1-5-billion)).
2. **What gets Helm on a shortlist (Launch):** QBO with a working sync, NetSuite, Sage Intacct, Stripe (payments, Terminal, ACH, a *real* webhook pipeline, payout/fee reconciliation, surcharging), outbound webhooks, a documented public REST API with scoped keys, SSO/SCIM, bulk data export, FuelCloud, and a marketplace feed for transient demand (Snag-A-Slip first, then Dockwa if a partnership is possible).
3. **Where Helm can win (DIFF):** hardware. That means smart pedestal and meter ingestion for automated utility billing, gate and access-control provisioning tied to contract status (via Seam, Brivo, Kisi or Verkada), LPR at launch ramps, weather-triggered rental cancellations (NWS/NOAA), and AI COI verification (Helm already has this). Dockwa, Molo and DockMaster publish little or nothing on pedestals or gates. Only Harba (HarbaPower, HarbaAccess) owns this space, and Harba is a European-first product ([Harba](https://harba.co/harbapower)).
4. **The codebase is not ready to host an ecosystem.** Integration state is ad-hoc columns on `Tenant`, OAuth tokens are stored in plaintext (and the columns are missing from the Prisma schema), there is no Stripe webhook endpoint, outbound webhooks don't exist, the QBO worker is a stub, and `ApiKey` has no scopes, expiry or rate limits. §4 lists 14 concrete defects. §5 specifies the replacement: a connection model, an encrypted credential vault, a connector SDK, a BullMQ sync framework with outbox, idempotency and mapping tables, Standard-Webhooks outbound delivery, a `/v1` public API with OAuth apps, a Zapier app, a marketplace UI, and per-connection health.
5. **Partner-program costs are now material and should be in the P&L.** Examples: Intuit App Partner Program Silver is about $300/mo for 1M metered CorePlus reads ([Apideck](https://www.apideck.com/blog/quickbooks-api-pricing-and-the-intuit-app-partner-program)); Xero Plus is A$245/mo for up to 1,000 connections ([Xero](https://developer.xero.com/pricing)); Sage Intacct is about $2,500/yr plus $0.015/call over credit ([Rutter](https://docs.rutter.com/platforms/accounting/sageintacct2)); Yardi is about $25K per interface per year *(unverified)* and needs 3 mutual clients ([Yardi](https://yardi.com/services/interfaces)); the Salesforce AppExchange security review is $999 ([Salesforce](https://developer.salesforce.com/docs/atlas.en-us.244.0.packagingGuide.meta/packagingGuide/security_review_fees.htm)).

---

## 2. Current-state audit of integration hooks in the codebase

### 2.1 Inventory

| Area | File(s) | What exists | Integration-platform readiness |
|---|---|---|---|
| Stripe client | `apps/api/src/lib/stripe.ts` | Platform-key client; `createPaymentIntent()` = **direct charge** on connected account with `application_fee_amount` | OK primitive. Direct charges imply per-account Apple Pay domain registration (§3.2) |
| Stripe Connect onboarding | `apps/api/src/routes/settings.ts` L362–420 | `stripe.accounts.create({ type: "standard" })` + Account Links | Standard accounts limit platform control over payouts, branding, surcharging config; consider Express/custom-controller accounts for enterprise |
| Stripe Terminal | `apps/api/src/services/stripe-terminal.ts` | Connection tokens, readers, capture, offline queue, tip report | Good base |
| ACH returns | `apps/api/src/services/ach-handler.ts` | `handleAchReturn()` | **Not wired to anything.** No Stripe webhook route exists |
| Webhook idempotency | `apps/api/src/services/webhook.ts` | `checkAndMarkProcessed()` (Stripe-only) | **Unused**; uses `processed_webhooks`/`stripe_event_id`, but the model is `ProcessedWebhook.stripeEventId` (`schema.prisma` L673) → schema drift |
| QBO OAuth + sync | `apps/api/src/services/qbo-sync.ts`, `apps/api/src/routes/qbo.ts` | Auth URL, code exchange, refresh, `syncCustomer/Invoice/Payment`, `postJournalEntry`, `syncAll`, inbound webhook | Logic exists but runs inline in HTTP requests; tokens on `Tenant` |
| QBO (duplicate flow) | `apps/api/src/routes/settings.ts` L422–545 | Second connect flow, `state = tenantId`, redirect `/api/callbacks/qbo` | Redirect route not mounted in `src/index.ts`; two flows diverge |
| QBO worker | `apps/api/src/workers/index.ts` L218–233 | `qbo-sync` Worker = `console.log` + TODO | **Stub** |
| Queues | `apps/api/src/lib/queue.ts` | Fixed `QUEUE_NAMES` (billing, deferred-revenue, qbo-sync, email, sms, renewals, automation) | No integration/webhook queues, no DLQ, no per-connection rate limiting |
| BI read API | `apps/api/src/routes/bi-api.ts` (mounted `/api/bi`) | 8 GET endpoints (customers, invoices, payments, slips, contracts, reservations, transactions, gl-entries), bearer `helm_…` key, SHA-256 hash lookup, offset/limit ≤ 1000 | Good seed for a public API. No scopes, versioning, rate limiting, cursor pagination or OpenAPI |
| API keys | `schema.prisma` L1323 `ApiKey` | `keyHash, scope (TENANT/PORTFOLIO), createdBy, lastUsedAt, revokedAt` | No name, prefix, scopes[], expiry, unique index on `keyHash`; **no issuance endpoint**; `PORTFOLIO` scope set but never enforced |
| API keys UI | `apps/web/src/pages/Settings.tsx` L156 (`API_KEYS` mock), L1250+ | Static table | Mock data only |
| Integrations UI | `apps/web/src/pages/Settings.tsx` L976–1010 | Hard-coded Stripe and QBO cards; "Sync Now" and "Disconnect" only set a toast (`setSavedMsg`) | Not wired to API |
| E-sign | `apps/api/src/services/esign.ts` | DocuSign/HelloSign via **platform-level env vars**, magic-link fallback, webhook handler | DocuSign base URL hard-coded to `demo.docusign.net` (L118, 240, 338, 375); no per-tenant connection |
| Inbound auth webhooks | `apps/api/src/routes/auth.ts` | Clerk webhooks verified with **svix** | Svix is already a dependency (`package.json`), so Standard Webhooks tooling is available |
| Lead capture | `apps/api/src/routes/lead-forms.ts` L227 | Public `POST /:embedKey/submit` | Natural inbound target for marketing integrations (Meta Lead Ads, Google Ads lead forms, Zapier) |
| Email / SMS | `apps/api/src/lib/email.ts` (Resend), `apps/api/src/lib/sms.ts` (Twilio, `provisionPhoneNumber`) | Platform-level senders | No 10DLC ISV/secondary-profile flow; no per-tenant sender domains in a connection model |
| Storage | `apps/api/src/lib/storage.ts` (R2) | Presigned up/down, quotas | Reusable for export files and connector artifacts |
| AI / OCR | `apps/api/src/services/insurance-ai.ts`, `services/ocr.ts` | COI extraction + coverage validation | Differentiator; expose results via webhooks (`insurance.verified`, `insurance.expiring`) |
| Tax | `apps/api/src/services/tax-engine.ts` | Per-tenant JSON rates, default 0% | No jurisdiction model, no exemption certs, no Avalara/Stripe Tax hook |
| Metering / pump-outs | `schema.prisma` `MeterReading` L586, `PumpOut` L1236 | Manual readings (staffId, isEstimated) | Ready to accept IoT-sourced readings with `source`/`deviceId` additions |
| Ramp / LPR-adjacent | `apps/api/src/routes/ramp.ts` | Ramp tickets include `licensePlate`, `boatRegistration` | Hook point for LPR and gate integrations |
| Sync IDs | `schema.prisma` `qboCustomerId`, `qboItemId`, `qboInvoiceId`, `qboPaymentId`, `qboAccountId`, `qboLiabilityEntryId`, `stripe*Id` | One column per provider per entity | Doesn't scale past 2 providers; replace with `ExternalIdMap` (§5.4) |

### 2.2 Answers to the specific questions

- **Outbound webhooks?** None. No model, route or worker.
- **API keys?** Yes, read-only BI keys. The model is too thin for third parties (§4, D9–D11).
- **OAuth app framework (Helm as an OAuth provider)?** None. As an OAuth *client*, Helm has one hand-rolled flow (QBO), duplicated in two places.
- **Generic connection model?** None. State lives on `Tenant` (`stripeAccountId`, `qboRealmId`) plus JSON inside `invoiceTemplateJson` (`qboLastSync`, `settings.ts` L441).

---

## 3. Market context

### 3.1 Enterprise buyers: what they run and what they'll ask for

| Group | Known stack / signals | Integration implications for Helm |
|---|---|---|
| **Suntex Marinas** (72 locations at time of release) | Storable Molo + Stellar (rentals), **NetSuite** integration (close went "from weeks to days"), data lake, rapid onboarding of acquisitions ([Storable](https://www.storablemarine.com/resources/suntex-marinas-accelerates-enterprise-growth-with-storables-marine-technology-suite/)). Boatsetter partnership for slip access ([Boating Industry](https://boatingindustry.com/news/2022/11/03/boatsetter-partners-with-suntex-marina/)) | NetSuite + warehouse export are must-haves. Bulk migration/import tooling from Molo. Rental-marketplace hooks |
| **Safe Harbor Marinas** (150+ marinas; Blackstone Infrastructure; acquiring MarineMax incl. IGY, closing ~end-2026) | Dockwa member-benefit tie-up ([Dockwa](https://dockwa.com/safe-harbor-marinas)); listed as a Dockwa management-group user in 2020 ([PR Newswire](https://www.prnewswire.com/news-releases/dockwa-announces-1-000th-marina-partner-300980858.html)). ERP not public | Org hierarchy (portfolio → region → marina), SSO/SCIM, ERP (likely NetSuite/Intacct/Dynamics class), **dealer DMS + service** integrations post-MarineMax, membership-program integration |
| **IGY Marinas** (24 properties, Americas/Europe/Middle East) | Part of MarineMax ([MarinaWorld](https://www.marinaworld.com/news/safe-harbor-acquire-marinemax-1-5-billion)) | Multi-currency, VAT, non-US payments (Adyen/Stripe EU), superyacht-scale invoicing |
| **Morningstar Marinas** | Uses **BoatCloud** for launch scheduling ([Morningstar](https://www.morningstarmarinas.com/blog/benefits-using-boating-app/)); Boatsetter partner ([Trade Only](https://tradeonlytoday.com/dealers/boatsetter-reports-milestone-after-cruzin-merger/)) | Dry-stack app interop (BoatCloud/SpeedyDock) or native replacement |
| **Oasis Marinas** | Proprietary "Oasis Engine" operating system *(per vendor directory)* ([ButterflyMX blog](https://butterflymx.com/blog/marina-management-companies/)) | Will want APIs and data export to feed its own tools. API-first is the pitch |
| **Westrec Marinas** | Dockwa management-group user (2020) ([PR Newswire](https://www.prnewswire.com/news-releases/dockwa-announces-1-000th-marina-partner-300980858.html)); Boatsetter partner | Same as above |
| **Municipal marinas / ports** | Tyler Munis/Enterprise ERP common in city RFPs, with file- or API-based one-way GL posting ([Ashland RFP Q&A](https://govtribe.com/file/government-file/questions-and-answers-utility-billing-software-rfp-012226-dot-pdf), [Alameda RFP Q&A](https://www.alamedaca.gov/files/assets/public/v/2/it/rfp_qa_combined_accessible.pdf)); NetSuite + Harbour Mastery at Port of Coos Bay *(unverified)* ([Capterra](https://www.capterra.co.uk/software/1108106/i-Marinas-for-NetSuite)) | **GL export file (CSV/fixed-width) to Tyler/Munis, Caselle, Springbrook**; ACH/lockbox; public-records-friendly audit trail; card surcharge exemptions for government (CT allows them, [CT DCP](https://portal.ct.gov/dcp/knowledge-base/articles/surcharge-faqs/surcharges-main)) |

### 3.2 Competitor integration matrix (public evidence)

| Capability | Dockwa | Molo / Storable Marine | DockMaster | Scribble (MARINAGO) | Harba | Marina Master | Snag-A-Slip |
|---|---|---|---|---|---|---|---|
| QBO | ✓ | ✓ (QBO + Advanced; no Desktop *(reviewer)*) | Accounting platforms unspecified | ✓ bidirectional | "partnered with major accounting" | QBO/Xero *(directory, unverified)* | – |
| QB Desktop | – | ✗ *(reviewer)* | – | ✓ (Ent/Prem/Pro) | – | – | – |
| Xero | ✓ (marketing page) | ✓ | – | – | – | – | – |
| NetSuite | ✓ (invoices, line items, customers, payments, COGS, JEs, vendor bills) | ✓ (Suntex) | – | – | – | – | – |
| Sage / Intacct | ✓ "Sage" | – | – | ✓ Sage Intacct bidirectional | – | – | – |
| Payments / surcharging | Integrated payments; surcharging ≤3% on contracts/POS/fuel, excluded states CA, CT, MA, ME, NY, PR, Bahamas, Canada | Integrated CC/ACH; surcharging % or flat (credit only) | DockMaster Payments (CC/debit/ACH pay-links); Worldpay, Elavon, FreedomPay | CC & ACH, Instant Payments | partners | – | collects and remits, % fee |
| Card readers / tipping | ✓ readers, tip presets (Jul 2026) | – | – | POS apps | – | – | – |
| Marketplace / distribution | Own boater network (~4,000 marinas, 450K boaters, 2026); ActiveCaptain reviews | Snag-A-Slip instant book | BoatCloud reservations | Snag-A-Slip (2020) | – | – | Waterway Guide booking engine; Molo & Marinago instant book |
| Fuel | Pump integration & metering | **FuelCloud** | **FuelCloud** | Fuel dispenser integration & control | – | – | – |
| Dry stack | Native | **SpeedyDock**, **BoatCloud** | SpeedyDock, BoatCloud | – | Native | – | – |
| Pedestals / metering | – | – | – | Meterwalk app | **HarbaPower** (clip-on, retrofit, native) | PULS metering (AU/NZ agent) | – |
| Access control | – | – | – | – | **HarbaAccess** | – | – |
| CRM | – | – | Salesforce (teamMarine), Kenect | – | Built-in | – | – |
| Parts / dealer | Dockwa Service (early access) | Service module | ARI PartSmart, DealerSpike, CoreLogic Credco, Supreme BI, Shopify | Service work orders | – | – | – |
| Collaboration | – | Slack | – | – | – | – | – |
| Public API / webhooks | No public docs found | **Outbound JSON webhooks** ("build your own integration") | "Open API" for partners (2018) | – | None public | – | No public API found |

Sources: [Dockwa accounting](https://marinas.dockwa.com/accounting-integrations), [Dockwa about](https://marinas.dockwa.com/about-us), [Dockwa surcharging](https://blog.dockwa.com/marinas/credit-card-surcharging-dockwa), [Dockwa Dispatch Jul 2026](https://blog.dockwa.com/marinas/dockwa-dispatch-july-2026), [Dockwa features](https://marinas.dockwa.com/marina-software/all-features), [Dockwa + ActiveCaptain](https://eldiariony.com/latinowire/dockwa-and-activecaptain-partner-to-combine-marina-reservations-and-reviews-for-boaters/), [PSG/Dockwa](https://psgequity.com/news/dockwa-secures-strategic-growth-investment-from-psg-to-build-the-operating-system-for-the-57-billion-marina-economy), [Storable Marine software](https://www.storablemarine.com/marina-software/), [Molo FuelCloud](https://getmolo.com/connect/fuel-cloud), [Molo surcharge](https://support.getmolo.com/support/solutions/articles/13000104789-using-the-credit-card-surcharge-feature), [Software Advice: Molo](https://www.softwareadvice.com/marine/molo-profile/), [DockMaster enterprise](https://dockmaster.com/for-enterprise-businesses), [DockMaster open API](https://dockmaster.com/blog/dockmasters-power-partnership-open-api), [DockMaster APIs blog](https://www.dockmaster.com/blog/supporting-marine-industry-apis-integrations), [GetApp: DockMaster](https://www.getapp.com/industries-software/a/dockmaster/), [MARINAGO accounting](https://www.marinago.com/business-accounting-detail.html), [Scribble + Snag-A-Slip](https://boatingindustry.com/news/2020/01/16/scribble-software-snag-a-slip-join-forces/), [Snag-A-Slip FAQ](https://www.snagaslip.com/frequently-asked-questions/), [Snag-A-Slip + Waterway Guide](https://digitaledition.greatlakesscuttlebutt.com/articles/snag-a-slip-partners-with-waterway-guide-media), [Harba](https://harba.co/solution), [HarbaPower](https://harba.co/harbapower), [Dash Symons / Marina Master](https://www.dashsymons.com/services/marina-management/).

**Takeaways**
- Accounting breadth is the most crowded area. Dockwa (QBO, NetSuite, Sage, Xero) and Scribble (QBO, QBD, Intacct) set the bar. Helm must ship QBO plus NetSuite and Intacct to compete for multi-site deals.
- Molo's outbound webhooks are the only self-serve extensibility among the US incumbents. A documented public API, webhooks and a Zapier app would make Helm the most open option, and that is a clear enterprise and IT-buyer win-theme.
- Hardware (pedestals, gates, LPR) is largely uncontested in the US.

---

## 4. Defects and risks in existing integration code (fix before building on it)

| # | Severity | Finding | Location | Fix |
|---|---|---|---|---|
| D1 | **Critical** | No Stripe webhook endpoint. Payment success, ACH settle/return, disputes, payouts and `account.updated` are never received. `handleAchReturn` and `checkAndMarkProcessed` are dead code | `src/index.ts` (no route); `services/ach-handler.ts`; `services/webhook.ts` | Add `POST /api/webhooks/stripe` with `express.raw()`, Connect endpoint secret, `stripe.webhooks.constructEvent`, generic `InboundWebhookEvent` idempotency (§5.6) |
| D2 | **Critical** | QBO OAuth `state` not validated (TODO). Callback derives `tenantId` from `state.split(":")[0]`, which **overrides `req.tenantId`**. A manager of tenant A can craft a callback to bind a QBO realm to tenant B (cross-tenant write) | `routes/qbo.ts` L33–70 | Server-side `OAuthState` row (random, single-use, 10-min TTL, bound to tenantId + userId + PKCE verifier); ignore client-supplied tenant |
| D3 | **High** | `router.use(...clerkAuth())` at the top of the QBO router also guards `/webhook`, so Intuit's server-to-server webhooks will be rejected | `routes/qbo.ts` L19–20, L179 | Mount provider webhooks on an unauthenticated `/api/webhooks/:provider` router |
| D4 | **High** | QBO webhook HMAC computed over `JSON.stringify(req.body)` (re-serialized, not raw bytes), non-constant-time `!==`, and **fails open** when `QBO_WEBHOOK_VERIFIER_TOKEN` is unset. Uses `req.tenantId` (none for server calls) | `routes/qbo.ts` L190–208 | Raw body, `crypto.timingSafeEqual`, fail closed, resolve tenant by `realmId` via connection table |
| D5 | **High** | OAuth access and refresh tokens stored **plaintext** on `Tenant` | `services/qbo-sync.ts` L77–115, L237–290 | Encrypted credential vault (§5.3) |
| D6 | **High** | Schema drift: `qboAccessToken/qboRefreshToken/qboTokenExpiresAt/qboConnectedAt` are referenced but not defined on `Tenant` (`schema.prisma` L249–272); `processed_webhooks`/snake_case fields used in `webhook.ts` and workers vs camelCase models | `schema.prisma`, `services/webhook.ts`, `workers/index.ts` | Reconcile schema; CI `prisma validate` + `tsc --noEmit` gate |
| D7 | Medium | Two divergent QBO connect flows; `settings.ts` redirects to unmounted `/api/callbacks/qbo` with raw `state=tenantId` | `routes/settings.ts` L454–480 | Delete; single `/api/integrations/:provider/connect` |
| D8 | Medium | `syncAll()` runs synchronously inside an HTTP request; worker is a stub | `routes/qbo.ts` L81; `workers/index.ts` L218 | Enqueue a `SyncRun`; return 202 |
| D9 | Medium | `ApiKey` has no name, display prefix, scopes, expiry, IP allowlist or rate tier; `keyHash` not unique/indexed | `schema.prisma` L1323 | Extend (§5.7) |
| D10 | Medium | `PORTFOLIO` scope is stored but never enforced. Enterprise groups need a cross-tenant org scope; today a key is always single-tenant | `routes/bi-api.ts` L68 | Introduce `Organization` and an org-scoped key model |
| D11 | Medium | No API key issuance/rotation endpoint; UI uses mock `API_KEYS` | `apps/web/src/pages/Settings.tsx` L156, L1250 | `POST /api/settings/api-keys` (show secret once) |
| D12 | Medium | E-sign provider configured globally via env and hard-coded to DocuSign **demo** host | `services/esign.ts` L21–28, L118, L240, L338, L375 | Per-tenant connection + environment from config; or native e-sign (§6.7) |
| D13 | Low | No rate limiting on any API surface | `src/index.ts` | Redis token bucket per key/IP |
| D14 | Low | Integrations UI buttons are cosmetic (toasts only) | `Settings.tsx` L976–1010 | Marketplace UI (§5.10) |

---

## 5. Integration platform architecture

### 5.1 Design goals
1. **Tenant-scoped connections** with an optional location scope (one QBO company per marina, or one NetSuite subsidiary per location in an enterprise org).
2. **Secrets never in plaintext at rest or in logs**, rotatable, and revocable per connection.
3. **At-least-once delivery with idempotent effects.** Every external write is keyed, every inbound event is deduplicated.
4. **One framework, many connectors.** Adding connector N+1 should mean implementing an interface, not touching the queue or the UI.
5. **Observable.** Health status per connection, sync runs, error queues, replay, and audit log entries a customer can see.
6. **Symmetric openness.** The same event stream feeds Helm's own connectors, customer webhooks, the Zapier app and the public API.

### 5.2 Data model (Prisma sketch, additive)

```prisma
model Organization {            // enterprise parent above Tenant (portfolio)
  id        String   @id @default(uuid())
  name      String
  tenants   Tenant[]             // add organizationId to Tenant
  ssoConnectionId String?        // Clerk enterprise connection
}

model IntegrationConnection {
  id                String   @id @default(uuid())
  tenantId          String
  locationId        String?            // null = tenant-wide
  provider          String             // "qbo" | "netsuite" | "stripe" | "fuelcloud" | ...
  authType          String             // oauth2 | api_key | basic | webhook_only | file_drop
  status            ConnectionStatus   // PENDING | ACTIVE | DEGRADED | REAUTH_REQUIRED | ERROR | DISABLED
  externalAccountId String?            // QBO realmId, NetSuite accountId, Stripe acct_
  displayName       String?
  scopes            String[]
  settings          Json               // non-secret config (sync direction, start date, toggles)
  credentialId      String?  @unique
  lastSyncAt        DateTime?
  lastSuccessAt     DateTime?
  lastErrorAt       DateTime?
  lastErrorCode     String?
  lastErrorMessage  String?
  consecutiveFailures Int    @default(0)
  createdBy         String
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
  @@unique([provider, externalAccountId])     // a realm can attach to only one tenant
  @@index([tenantId, provider])
}

model IntegrationCredential {    // envelope-encrypted blob
  id           String   @id @default(uuid())
  tenantId     String
  ciphertext   Bytes              // AES-256-GCM(JSON{access_token, refresh_token, ...})
  iv           Bytes
  authTag      Bytes
  wrappedDek   Bytes              // DEK wrapped by KMS key (per-tenant DEK)
  kmsKeyVersion String
  expiresAt    DateTime?          // access token expiry for proactive refresh
  rotatedAt    DateTime?
}

model OAuthState {               // CSRF + tenant binding for outbound OAuth (fixes D2)
  id           String   @id     // random 32 bytes, base64url
  tenantId     String
  userId       String
  provider     String
  pkceVerifier String?
  redirectAfter String?
  expiresAt    DateTime
  consumedAt   DateTime?
}

model ExternalIdMap {            // replaces qboCustomerId/qboInvoiceId/... columns over time
  id            String   @id @default(uuid())
  tenantId      String
  connectionId  String
  entityType    String           // customer | invoice | payment | item | gl_account | tax_code | vessel | access_user
  helmId        String
  externalId    String
  externalVersion String?        // QBO SyncToken, NetSuite lastModified, ETag
  contentHash   String?          // sha256 of last pushed canonical payload, skips no-op writes
  lastSyncedAt  DateTime
  @@unique([connectionId, entityType, helmId])
  @@unique([connectionId, entityType, externalId])
}

model FieldMapping {             // GL/item/tax/class/department/location mappings
  id           String @id @default(uuid())
  connectionId String
  mappingType  String           // gl_account | item | tax_code | class | department | subsidiary | payment_method
  helmKey      String           // e.g. GlAccount.id, product category, "slip_rental"
  externalKey  String
  @@unique([connectionId, mappingType, helmKey])
}

model SyncRun {
  id           String @id @default(uuid())
  connectionId String
  trigger      String           // schedule | manual | event | backfill | webhook
  direction    String           // push | pull | both
  status       String           // queued | running | succeeded | partial | failed | cancelled
  cursorBefore String?
  cursorAfter  String?          // e.g. QBO CDC changedSince, NetSuite lastModifiedDate
  stats        Json             // {created, updated, skipped, failed} per entity
  startedAt    DateTime?
  finishedAt   DateTime?
}

model SyncError {                // actionable, user-visible
  id          String @id @default(uuid())
  syncRunId   String
  connectionId String
  entityType  String
  helmId      String?
  externalId  String?
  code        String           // MAPPING_MISSING | VALIDATION | RATE_LIMIT | AUTH | CONFLICT | UPSTREAM_5XX
  message     String
  payload     Json?
  resolvedAt  DateTime?
  retryCount  Int @default(0)
}

model OutboxEvent {              // transactional outbox, written in the same tx as the domain change
  id          String   @id @default(uuid())     // also the public event id (evt_...)
  tenantId    String
  type        String             // invoice.created, payment.succeeded, ...
  apiVersion  String
  aggregateType String
  aggregateId String
  payload     Json
  occurredAt  DateTime @default(now())
  publishedAt DateTime?
  @@index([publishedAt, occurredAt])
}

model WebhookEndpoint {
  id          String @id @default(uuid())
  tenantId    String
  url         String
  description String?
  eventTypes  String[]           // ["*"] or explicit
  secretCredentialId String      // whsec_… stored in vault; supports 2 active secrets for rotation
  status      String             // enabled | disabled | auto_disabled
  apiVersion  String
  createdBy   String
  ownerAppId  String?            // set when created by an OAuth app / Zapier REST hook
}

model WebhookDelivery {
  id           String @id @default(uuid())
  endpointId   String
  eventId      String
  attempt      Int
  status       String            // pending | succeeded | failed | dead
  responseCode Int?
  responseMs   Int?
  responseBodySnippet String?
  nextAttemptAt DateTime?
  @@index([endpointId, status])
}

model InboundWebhookEvent {      // generalizes ProcessedWebhook (fixes D1/D6)
  id         String @id @default(uuid())
  provider   String
  eventId    String
  tenantId   String?
  type       String
  receivedAt DateTime @default(now())
  processedAt DateTime?
  status     String              // received | processed | failed | ignored
  payload    Json                // or R2 pointer for large bodies
  @@unique([provider, eventId])
}

model ApiKey {                   // extend existing
  id          String @id @default(uuid())
  tenantId    String?
  organizationId String?         // org-scoped (portfolio) keys
  name        String
  prefix      String             // "helm_live_ab12", shown in UI
  keyHash     String @unique     // sha256 (or HMAC with server pepper)
  scopes      String[]           // customers:read, invoices:write, webhooks:manage, ...
  locationIds String[]           // optional location restriction
  environment String             // live | test
  ipAllowlist String[]
  rateLimitTier String @default("standard")
  expiresAt   DateTime?
  createdBy   String?
  lastUsedAt  DateTime?
  lastUsedIp  String?
  revokedAt   DateTime?
}

model OAuthApp {                 // Helm as OAuth 2.0 provider (partners, Zapier)
  id            String @id @default(uuid())
  ownerOrgId    String?          // null = Helm first-party (Zapier, mobile)
  name          String
  clientId      String @unique
  clientSecretHash String
  redirectUris  String[]
  allowedScopes String[]
  status        String           // draft | in_review | published | suspended
  listingJson   Json?            // logo, description, docs URL for marketplace
}

model OAuthGrant {
  id         String @id @default(uuid())
  appId      String
  tenantId   String
  userId     String
  scopes     String[]
  refreshTokenHash String @unique
  createdAt  DateTime @default(now())
  revokedAt  DateTime?
}
```

**Migration path from today's columns.** Backfill `IntegrationConnection` from `Tenant.stripeAccountId` and `qboRealmId`. Backfill `ExternalIdMap` from the `qbo*Id` columns. Keep the old columns read-only for one release, then drop them.

### 5.3 Credential vault

- New `apps/api/src/lib/crypto.ts` and `apps/api/src/lib/vault.ts`.
- **Envelope encryption:** one data-encryption key (DEK) per tenant, AES-256-GCM, wrapped by a cloud KMS key (AWS KMS or GCP KMS; Cloudflare has no general-purpose KMS). Unwrapped DEKs are cached in memory for at most 5 minutes. Rotate the KMS key annually and re-wrap DEKs, not data.
- API: `vault.put(tenantId, secretJson) → credentialId`, `vault.get(credentialId)`, `vault.rotate(credentialId, newJson)`, `vault.destroy(credentialId)`. Only connector code (`apps/api/src/integrations/**`) may import `vault.get` (enforce with an ESLint `no-restricted-imports` rule).
- **Token refresh:** single-flight per connection with a Redis lock (`lock:refresh:{connectionId}`). Without it, concurrent workers race and invalidate rotating refresh tokens (QBO rotates them). On `invalid_grant`, set `REAUTH_REQUIRED` and notify admins.
- Redact secrets in logs and Sentry (`beforeSend` scrubber in `apps/api/src/lib/sentry.ts`).
- Disconnect revokes upstream where supported (QBO `revoke` endpoint, Stripe `deauthorize`), destroys the credential and keeps the mappings (soft) for audit.

### 5.4 Connector SDK

`apps/api/src/integrations/<provider>/index.ts` implements:

```ts
export interface Connector {
  provider: string;                       // "qbo"
  category: "accounting" | "payments" | "distribution" | "iot" | "access" | "crm" | "comms" | "esign" | "workforce" | "data" | "tax";
  auth: OAuth2Config | ApiKeyConfig | NoAuth;
  capabilities: {
    push?: EntityType[];                  // Helm → external
    pull?: EntityType[];                  // external → Helm
    inboundWebhooks?: boolean;
    subscribes?: EventType[];             // which OutboxEvent types trigger pushes
  };
  settingsSchema: z.ZodTypeAny;           // drives the config UI
  mappingsRequired?: MappingType[];       // UI blocks activation until mapped
  onConnect?(ctx): Promise<void>;         // fetch chart of accounts, create webhooks upstream, etc.
  healthCheck(ctx): Promise<HealthResult>;
  push?(ctx, entity, helmId, op): Promise<PushResult>;
  pull?(ctx, cursor?): Promise<PullResult>;           // returns new cursor
  handleWebhook?(rawBody: Buffer, headers, ctx?): Promise<InboundResult>;
  rateLimit: { requests: number; perMs: number; concurrency: number };
  classifyError(e): "retryable" | "auth" | "validation" | "rate_limit" | "fatal";
}
```

`ctx` gives the connector a pre-authenticated HTTP client that auto-refreshes, records metrics and redacts secrets. It also provides `idMap.get/put`, `mappings.get`, a logger bound to `{tenantId, connectionId, syncRunId}`, and a Prisma client bound to `tenantStore` (`apps/api/src/lib/prisma.ts` L11).

Move today's `services/qbo-sync.ts` logic into `integrations/qbo/` as the first connector. Use the QBO `requestid` query parameter for idempotent creates and `SyncToken` for optimistic concurrency. Pull changes with the CDC endpoint plus webhooks rather than polling, because Intuit now meters *reads* (CorePlus) and leaves writes unmetered ([Apideck](https://www.apideck.com/blog/quickbooks-api-pricing-and-the-intuit-app-partner-program), [hotglue](https://hotglue.com/blog/how-to-lower-your-coreplus-quickbooks-api-usage)).

### 5.5 Sync job framework on BullMQ

```
Domain write (Prisma tx) ──► OutboxEvent row (same tx)
                                   │  outbox-relay worker (poll 500ms / LISTEN-NOTIFY)
                                   ▼
                        queue "events" (jobId = OutboxEvent.id)  ← idempotent fan-out
                     ┌─────────────┼───────────────────────────┐
                     ▼             ▼                           ▼
     queue "integration-push"   queue "webhook-delivery"   (internal: automation, email)
     jobId = conn:entity:helmId:eventId     jobId = endpoint:eventId
                     │
     queue "integration-pull" (repeatable per connection, e.g. every 15 min; CDC cursor)
     queue "integration-backfill" (chunked initial loads, low priority)
     queue "integration-dlq" (exhausted jobs → SyncError + UI)
```

- **Add to `apps/api/src/lib/queue.ts`:** `events`, `integration-push`, `integration-pull`, `integration-backfill`, `webhook-delivery`, `integration-dlq`. Run them in a separate worker process from `workers/index.ts`, so a slow ERP can't starve email or SMS.
- **Idempotency:**
  - BullMQ `jobId` deduplicates enqueueing.
  - `ExternalIdMap` makes "create" become "update if mapped".
  - `contentHash` skips no-op writes and saves metered calls.
  - Provider idempotency keys go on writes: QBO `requestid`, the Stripe `Idempotency-Key`, NetSuite external IDs (`externalId` upsert).
- **Ordering:** process per `(connectionId, aggregateId)` serially. Use a Redis lock keyed by the aggregate, or BullMQ Pro groups. Out-of-order events are reconciled by fetching the current Helm state at push time (thin event, fresh read) instead of trusting event payloads.
- **Rate limiting:** per-connection token bucket in Redis, sized from `connector.rateLimit`. QBO allows 500 req/min per realm with 10 concurrent requests *(Intuit published limits; verify)*; NetSuite concurrency is governed per account. Respect `Retry-After`.
- **Retries:** exponential backoff with jitter (1m, 5m, 30m, 2h, 6h, 24h). `auth` errors stop retrying and mark the connection `REAUTH_REQUIRED`. `validation` errors become a `SyncError` the user must resolve, for example "Map GL account 'Transient Dockage' to a QBO income account."
- **Backfill:** chunked by date windows, resumable via `SyncRun.cursorAfter`. A dry-run mode previews counts before the first push. That matters for enterprise cutovers.
- **Accounting posting model:** support (a) **detailed** posting (customer, invoice, payment) for SMB QBO/Xero and (b) **summary journal entries** per day, location and GL account for enterprise ERPs. Most enterprise controllers want summarized JEs plus AR sub-ledger detail in Helm. `services/gl-posting.ts` already produces `GlEntry` rows, which are the natural source for the summary-JE connector.

### 5.6 Inbound webhooks (provider → Helm)

- Single router `apps/api/src/routes/webhooks.ts` mounted at `/api/webhooks/:provider`, **before** `express.json()`, using `express.raw({ type: "*/*" })` (fixes D1, D3, D4).
- Verify the signature with the provider's scheme: Stripe `constructEvent`, Intuit HMAC-SHA256 base64 over the raw body, Clerk/Svix, DocuSign Connect HMAC, Kisi or Verkada secrets.
- Insert into `InboundWebhookEvent` (unique `(provider, eventId)`), return 200 quickly, then process asynchronously in queue `inbound-webhooks`.
- Resolve the tenant from the connection (`externalAccountId` = realmId / `acct_` / org id), never from the request.

### 5.7 Public API (`/v1`)

- **Surface:** promote `routes/bi-api.ts` to `/v1/*`. Add write endpoints over time for customers, boats, leads, reservations, transient bookings, invoices (draft), payments (record offline), meter readings, pump-outs, access credentials and webhook endpoints.
- **Spec:** generate OpenAPI 3.1 from the existing zod schemas (`@asteasolutions/zod-to-openapi`). Publish docs (Mintlify, Redocly or Scalar) and SDKs (Stainless/Speakeasy) once the spec stabilizes.
- **Auth:**
  - API keys: `helm_live_…` and `helm_test_…`, shown once, with a visible prefix, scopes, optional location restriction and expiry.
  - Org-scoped keys for portfolio reporting (fixes D10).
  - OAuth 2.0 Authorization Code + PKCE for third-party apps (`OAuthApp`), with refresh-token rotation and scope consent screens.
  - The client-credentials grant is for first-party server integrations only.
- **Conventions:**
  - Cursor pagination (`starting_after`), replacing offset/1000.
  - An `Idempotency-Key` header on POST, stored for 24h.
  - `Helm-Version` date-based versioning.
  - Consistent error envelope.
  - `updated_since` filters on every list for incremental extraction.
  - Expandable relations.
- **Rate limits:** Redis sliding window per key, for example 100 req/s burst and 10K/hour standard, plus enterprise tiers. Return `RateLimit-*` headers.
- **Audit:** every API write emits an `AuditLog` row with `actorType = api_key | oauth_app`. That requires extending `AuditLog`, which today assumes a `userId`.
- **Sandbox:** a test-mode tenant per customer seeded with fake data, plus Stripe test mode. Partners will expect it (Zapier's and Xero's review processes both require working test accounts).

### 5.8 Outbound webhooks (Helm → customer)

- **Spec:** adopt **[Standard Webhooks](https://www.standardwebhooks.com/)**. Headers are `webhook-id`, `webhook-timestamp` and `webhook-signature` (`v1,<base64 HMAC-SHA256(id.timestamp.body)>`), secrets use a `whsec_` prefix, and multiple signatures allow zero-downtime rotation ([implementation notes](https://docs.openlayer.com/security/webhooks/verify-signatures)). The `svix` npm package already in `apps/api/package.json` can sign and verify this format.
- **Build vs buy:** Svix's hosted service gives an embeddable endpoint portal, retries and replay in about 1–2 weeks of integration work. A self-built `webhook-delivery` worker is about 4–6 weeks to reach parity. **Recommendation:** start on Svix at Launch and keep the `OutboxEvent → deliver()` seam so it can be brought in-house later.
- **Delivery:**
  - At-least-once delivery, 10s timeout, retries on 5xx, 429 and timeouts with backoff over about 3 days.
  - Auto-disable after 5 days of continuous failure, with an email to the owner.
  - Manual replay from the UI.
  - Ordering not guaranteed (documented).
  - **SSRF guard:** HTTPS only, block private, link-local and metadata IP ranges after DNS resolution, no redirects.
- **Payload:** `{id, type, api_version, created, tenant_id, location_id, data: {object}}`. Use thin+fat payloads (include the object, but tell consumers to re-fetch for authoritative state).
- **Initial event catalog:**
  - Customers and leads: `customer.created|updated|merged`, `lead.created|stage_changed`, `waitlist.offered|accepted`.
  - Contracts and slips: `contract.sent|signed|renewed|terminated`, `slip.assigned|vacated`.
  - Reservations: `reservation.created|cancelled|checked_in|checked_out`, `transient_booking.*`, `rental.weather_cancelled`.
  - Billing: `invoice.created|finalized|paid|voided|overdue`, `payment.succeeded|failed|refunded`, `ach.returned`, `dispute.created`, `payout.paid`.
  - Operations: `meter_reading.recorded`, `pump_out.recorded`, `fuel_sale.completed`, `pos.transaction_completed`, `ramp.launch_recorded`, `dock_walk.completed`.
  - Insurance: `insurance.verified|rejected|expiring|expired`.
  - Access: `access.credential_granted|revoked`.
  - Platform: `integration.connection_status_changed`.

### 5.9 Zapier app (and Make)

- Built with the Zapier Platform CLI, with OAuth2 against Helm's `OAuthApp` (first-party client).
- **Triggers** use REST hooks: `performSubscribe` creates a `WebhookEndpoint` with `ownerAppId`, and `performUnsubscribe` deletes it. Ship 8–12 starter triggers (new lead, new customer, invoice paid, payment failed, contract signed, reservation created, insurance expiring, rental weather-cancelled).
- **Actions:** create lead, customer, reservation, invoice draft, note or meter reading.
- **Searches:** find customer by email or phone, find slip.
- **Publishing:** the app must be publicly launched (not invite-only), use HTTPS production endpoints, provide a non-expiring test account for `integration-testing@zapier.com`, and pass a test Zap with a successful run per trigger and action. Publishing is free ([Zapier requirements](https://docs.zapier.com/platform/publish/integration-publishing-requirements), [public integration](https://docs.zapier.com/platform/publish/public-integration)). Thresholds of 10 templates and 50 users are reported by third parties *(unverified)* ([LTV Co.](https://ltvco.com/engineering/build-publish-new-zapier-integration)).
- Zapier covers the long tail (Mailchimp, Google Sheets, Slack, Teams, Monday, Airtable) and removes pressure to build those natively in year 1.

### 5.10 Integration marketplace UI

- Replace `Settings.tsx` L976–1010 and the mock `API_KEYS` (L156) with `apps/web/src/pages/Integrations/`:
  - A **catalog grid** with category filters (Accounting, Payments, Distribution, Hardware & IoT, Access, CRM & Marketing, Comms, Docs & Signatures, Workforce, Data & BI, Tax), each card showing status (Connected / Needs attention / Available / Coming soon / Enterprise plan).
  - **Connection detail page:** connect/disconnect, scopes, settings form generated from `settingsSchema`, a **mapping wizard** (GL accounts, items, tax codes, classes, locations), a sync-history table (`SyncRun`), an error inbox (`SyncError` with "Retry", "Ignore" and "Fix mapping"), and a "Sync now" button. Health status is shown here too.
  - A **Developers** tab for API keys (create, show once, scopes, revoke), webhook endpoints (the Svix portal or a native list with delivery logs and replay), OAuth apps for partners, and an API docs link.
  - A **request-an-integration** form whose votes feed the roadmap.
- **Plan gating:** tag connectors `tier: core | pro | enterprise`, checked against `SaasTier` (`schema.prisma` L294).
- **Admin app** (`apps/admin/src/pages/TenantDetail.tsx`): a cross-tenant connection health view and a "connections in REAUTH_REQUIRED" queue for customer success.

### 5.11 Health and observability per connection

- **Status machine:** `PENDING → ACTIVE ↔ DEGRADED (≥3 consecutive failures or error rate > 10%/1h) → ERROR`; any `auth` error moves to `REAUTH_REQUIRED`; `DISABLED` is user-initiated.
- `healthCheck()` runs on a repeatable job every 6h plus on demand. It checks token validity, that required mappings exist, and that upstream webhooks are still registered.
- **Metrics:** per-provider latency, error rate and 429 counts, as Sentry spans tagged `provider` and `connectionId`. Queue depth per queue. Outbox lag (oldest unpublished event age). Alert if lag exceeds 60s.
- **Notifications:** emit an `integration.connection_status_changed` event, email the tenant owner and accounting role, and post a Slack/Teams alert if connected (§6.6).
- A **status page** (statuspage.io or Instatus) with upstream components (Stripe, Intuit, NetSuite).

### 5.12 Enterprise identity and governance (cross-cutting)

- **SSO/SCIM:** Clerk supports SAML/OIDC enterprise connections (Okta, Entra ID, Google Workspace, generic SAML) and SCIM 2.0 directory sync, with customer self-serve configuration ([Clerk enterprise](https://clerk.com/enterprise-authentication), [Clerk directory sync](https://clerk.com/docs/guides/configure/auth-strategies/enterprise-connections/self-serve-directory-sync.md)). Map IdP groups to Helm roles (`UserRole`) per tenant or location. Effort: S–M. **Launch.**
- **Org hierarchy:** `Organization → Tenant → Location` with org-level roles (controller, regional manager) and org-scoped API keys and exports.
- **Audit log streaming:** an `audit.*` webhook stream or S3/R2 export for SIEMs (Splunk, Datadog).
- **Data residency and DPAs:** a sub-processor list covering every connector vendor.

---

## 6. Integration catalog by category

### 6.1 Accounting / ERP

| Integration | What it does for a marina | Demand | Competitors with it | API & partner program | Effort | Phase |
|---|---|---|---|---|---|---|
| **QuickBooks Online** | Push customers, invoices (dockage, electric, fuel, POS), payments, deposits/liabilities, deferred revenue JEs; pull payments recorded in QBO | SMB-TS | Dockwa, Molo, Scribble, (Marina Master *unverified*) | OAuth2 REST + webhooks + CDC. **Intuit App Partner Program:** Builder (free, 500K CorePlus reads/mo cap, overage blocked), Silver ≈$300/mo (1M reads), Gold ≈$1,700/mo (≥500 connections), Platinum ≈$4,500/mo (≥3,000 connections). Writes unmetered. App Store listing needs security review ([Apideck](https://www.apideck.com/blog/quickbooks-api-pricing-and-the-intuit-app-partner-program), [Truto](https://truto.one/blog/how-much-does-the-quickbooks-api-cost-2026-pricing-rate-limits/)) | M (logic exists; port to framework, fix D2–D6, add mapping UI) | **Launch** |
| **QuickBooks Desktop** (Pro/Premier/Enterprise via Web Connector) | Same as above for marinas that never moved to QBO, common among older family-owned marinas | NICHE (SMB legacy) | Scribble ✓, Molo ✗ | SOAP **Web Connector** pull model (QBWC polls your service), qbXML; no partner fee; certificate-renewed builds for QB 2022–2024 ([Intuit](https://developer.intuit.com/app/developer/qbdesktop/docs/get-started/get-started-with-quickbooks-web-connector)). Intuit stopped selling Desktop Pro/Premier to new US customers in July 2024; Enterprise continues ([Apideck](https://www.apideck.com/blog/build-an-integration-with-quickbooks-desktop-in-2025)). Alternatives: Conductor/Apideck unified APIs | M–L (SOAP endpoint, per-tenant .qwc, queue semantics) | **Later** (or via unified-API vendor in 12 mo if pipeline demands) |
| **Xero** | Same as QBO; strong in AU/NZ/UK (IGY Europe, Caribbean) | SMB-TS outside US | Dockwa, Molo | OAuth2; **new tiered pricing from 2 Mar 2026**: Starter free (5 conns), Core A$35/mo (50), **Plus A$245/mo (1,000)**, Advanced A$1,445/mo (10,000), egress-metered at A$2.40/GB; uncertified apps capped at 25 connections; certification needs ≥3 live connections ([Xero pricing](https://developer.xero.com/pricing), [Apideck](https://radar.apideck.com/blog/xero-api-pricing-and-the-app-partner-program)) | M | **6 mo** |
| **NetSuite** | Summary or detailed JEs by subsidiary, location, class or department; AR invoices; customer master; vendor bills for parts; multi-entity consolidation | **ENT-TS** (Suntex, Rattlesnake Marine) | Dockwa (rich object set), Molo (Suntex) | SuiteTalk REST + SuiteQL, OAuth 2.0 (M2M cert or auth-code) or TBA; **SuiteCloud Developer Network** membership for a "Built for NetSuite" listing (fee via Oracle; not public) ([Oracle SDN news](https://www.oracle.com/jp/news/announcement/sw25-netsuite-expands-partner-program-accelerate-ai-innovation-2025-10-06/)). i-Marinas exists as a NetSuite-native marina app competitor ([Capterra](https://www.capterra.co.uk/software/1108106/i-Marinas-for-NetSuite)) | L (subsidiary/segment mapping, custom fields, sandbox per customer) | **Launch** (design-partner driven) |
| **Sage Intacct** | Multi-entity GL, dimensions (location, department, class), AR, deferred revenue; popular with PE-backed portfolios and municipal-adjacent operators | ENT-TS | Scribble (bidirectional), Dockwa ("Sage") | XML Web Services (and newer REST); **Marketplace partner** ≈ $2,500/yr + $0.015/call after credit, Sender ID issued on contract; vetting includes a security questionnaire and demo; applications have occasionally been paused ([Rutter](https://docs.rutter.com/platforms/accounting/sageintacct2), [Apideck](https://developers.apideck.com/apis/accounting/sage-intacct/overview), [Sage Marketplace](https://marketplace.intacct.com/BecomeAPartner)) | L | **6 mo** |
| **Microsoft Dynamics 365 Business Central** | GL/AR for Microsoft-centric groups; often paired with Entra SSO | ENT (selective) | none found | API v2.0 (OData), Entra app registration, delegated or S2S client-credentials; AppSource listing optional ([Microsoft Learn](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/administration/automation-apis-using-s2s-authentication)) | M–L | **12 mo** |
| **Yardi (Voyager/Breeze)** | GL feed for real-estate holding companies and mixed-use waterfront developers that own marinas | NICHE | none | **Yardi Standard Interface Partnership:** per-interface annual license (≈$25K/yr reported *(unverified)*), company ≥2 years old, ≥3 mutual Voyager clients, Data Exchange Agreement per interface ([Yardi](https://yardi.com/services/interfaces), [Supergood](https://supergood.ai/api-report-card/yardi-voyager)) | L + commercial | **Later** (only with 3 signed mutual clients) |
| **Municipal ERPs** (Tyler Enterprise ERP/Munis, Caselle, Springbrook, CentralSquare) | Daily GL/cash-receipt posting; one-way file or API; often an RFP requirement | Municipal-TS | none found | Munis integrations are commonly **file-based one-way GL imports** ([Ashland Q&A](https://govtribe.com/file/government-file/questions-and-answers-utility-billing-software-rfp-012226-dot-pdf), [Alameda Q&A](https://www.alamedaca.gov/files/assets/public/v/2/it/rfp_qa_combined_accessible.pdf)) | S (generic **GL export file builder**: CSV/fixed-width templates, SFTP drop) | **Launch** (generic export), API connectors **Later** |
| **Unified accounting API** (Apideck, Codat, Rutter, Merge) | Covers long-tail ERPs (MYOB, FreshBooks, Wave, Zoho) through one integration | DIFF (speed) | – | Per-connection pricing; adds a sub-processor | S–M | **12 mo** (long tail only; keep QBO, NetSuite and Intacct native) |

**Accounting design notes**
- Ship a **GL mapping wizard** first: Helm `GlAccount` → external account, plus product categories (dockage, transient, electric, water, fuel, pump-out, storage, rentals, ship store, service labor and parts) → items. Deferred revenue for prepaid seasonal contracts already exists in `services/deferred-revenue.ts` and `gl-posting.ts`. Make posting mode (detail vs summary JE) a connection setting.
- Fuel needs special treatment: federal and state motor-fuel excise taxes are embedded in price, and COGS comes from tank inventory. Map those to separate liability and COGS accounts.

### 6.2 Payments

| Integration | What it does | Demand | Competitors | API / program | Effort | Phase |
|---|---|---|---|---|---|---|
| **Stripe (Connect, Payments, Billing-style autopay)** | Card/ACH for contracts, invoices, transient bookings, rentals; application-fee monetization | SMB-TS / ENT-TS | Dockwa, Molo, DockMaster, Scribble all have embedded payments | Existing. **Must add:** webhook pipeline (D1), Connect `account.updated` handling, dispute flows, Radar rules for transient no-shows | M (webhooks + hardening) | **Launch** |
| **Stripe Terminal** (+ Tap to Pay on iPhone/Android) | Fuel dock, ship store, dockside check-in; tips; offline mode | SMB-TS | Dockwa (readers, tip presets), Scribble POS apps | Existing service (`stripe-terminal.ts`) | S | **Launch** |
| **ACH + bank verification** | Lower-cost autopay for seasonal/annual contracts ($3,000 seasonal ≈ $90+ by card vs a few dollars by ACH ([Dockwa](https://blog.dockwa.com/marinas/marina-payment-processing-in-2026-a-complete-guide))) | SMB-TS | Dockwa, Molo, DockMaster | Use **Stripe Financial Connections** (native instant verification, no extra vendor) first; Plaid Auth → Stripe processor token as a fallback for bank coverage gaps, at extra Plaid cost ([Stripe/Plaid](https://docs.stripe.com/ach-deprecated), [Plaid](https://plaid.com/docs/auth/partnerships/achq)) | S (FC) / M (Plaid) | **Launch** (FC), Plaid **Later** |
| **Surcharging / cash discount / dual pricing** | Pass card fees to boaters on contracts, POS, fuel | **SMB-TS (competitive parity)** | Dockwa (≤3%, state-excluded), Molo (% or flat) | Visa cap 3%, Mastercard 4%, never above cost of acceptance; no surcharge on debit/prepaid; disclose on receipt; acquirer notice. **State restrictions:** CT and MA ban surcharges but allow cash discounts; Stripe lists 10 states with caps or bans (CA, CO, CT, FL, KS, ME, MA, NY, OK, TX) ([Stripe guide](https://stripe.com/resources/more/surcharge-fees), [CT DCP](https://portal.ct.gov/dcp/knowledge-base/articles/surcharge-faqs/surcharges-main)). Stripe surcharging for platforms is in public preview, automatic surcharge in private preview ([Stripe docs](https://docs.stripe.com/payments/advanced/surcharge)) | M (BIN-based debit detection, per-state rules table per Location, receipt disclosure, line item + GL mapping) | **Launch** |
| **Apple Pay / Google Pay** | Faster mobile checkout for transient and rental bookings | SMB-TS | Dockwa mentions "wallet-free payments" | Helm uses **direct charges**, so it must register each tenant's custom domain via `POST /v1/payment_method_domains` with `Stripe-Account` header ([Stripe](https://docs.stripe.com/payments/payment-methods/pmd-registration)). Automate on custom-domain verification (`Settings.tsx` DNS flow) | S | **Launch** |
| **Payouts & fee reconciliation** | Match Stripe payouts to bank deposits; post gross sales, fees and refunds to GL; enterprise controllers' #1 ask | **ENT-TS** | Dockwa (transaction-level sync, GL codes) | Stripe Balance Transactions + Payout reconciliation reports; `payout.paid` webhook → JE: Dr Bank (net), Dr Processing Fees, Cr Undeposited Funds/Clearing | M | **Launch** |
| **Adyen for Platforms** | Enterprise/international processing (IGY Europe/Caribbean), interchange++ pricing, local methods | ENT (international) | – | Sales-led onboarding, KYC via Adyen, split payments and managed/custom payouts ([Adyen docs](https://docs.adyen.com/platforms)) | L | **12 mo** (only with an international anchor customer) |
| **Worldpay/FIS, Elavon, Heartland (Global Payments), FreedomPay** | "Bring your own processor" for enterprise groups with negotiated rates | ENT (RFP checkbox) | DockMaster (Worldpay, Elavon, FreedomPay) | Partner/ISV certification per processor; usually needs a gateway abstraction | L each | **Later** (build a `PaymentProvider` abstraction now; implement on demand) |
| **Fortis** | ISV-focused processor with surcharging, revenue share, embedded onboarding | DIFF (margin) | – | ISV program, APIs/SDKs, surcharging "where permitted" ([Fortis ISV](https://go.fortispay.com/isv)) | L | **Later** (evaluate as a Stripe-margin alternative for SMB) |
| **Authorize.net** | Legacy gateway many marinas already have | NICHE | – | Public API, no partner gate | M | **Later** |

**Payments abstraction:** wrap `lib/stripe.ts` and `services/stripe-terminal.ts` behind `PaymentProvider` (create intent, capture, refund, vault method, terminal, payout feed, webhooks). Stripe stays the only implementation at Launch, but it keeps enterprise "BYO processor" answers credible.

### 6.3 Booking distribution and marketplaces

| Integration | What it does | Demand | Competitors | API / program | Effort | Phase |
|---|---|---|---|---|---|---|
| **Dockwa marketplace** | Transient demand from Dockwa's boater network (~4,000 marinas, 450K+ boaters claimed) ([PSG](https://psgequity.com/news/dockwa-secures-strategic-growth-investment-from-psg-to-build-the-operating-system-for-the-57-billion-marina-economy)) | SMB-TS for transient-heavy marinas | Dockwa (native) | **No public channel API found.** Dockwa is a direct competitor post-PSG, so a partnership is unlikely. Fallback: email/iCal ingestion of Dockwa reservations into Helm transient bookings | S (email/iCal parser) / L + BD (API) | **6 mo** (parser); API if BD succeeds |
| **Snag-A-Slip** | Transient marketplace; instant book when integrated with MMS (Molo, MARINAGO); collects and remits for a % fee; powers Waterway Guide's booking engine ([Snag-A-Slip FAQ](https://www.snagaslip.com/frequently-asked-questions/), [Waterway Guide](https://digitaledition.greatlakesscuttlebutt.com/articles/snag-a-slip-partners-with-waterway-guide-media)) | SMB-TS (transient) | Molo, Scribble | Partner integration (BD); availability/rates push + booking pull | M + BD | **Launch** (pursue now; it is the neutral channel) |
| **Garmin ActiveCaptain / Navionics** | Chartplotter and app discovery; reviews | DIFF | Dockwa (review syndication) ([Dockwa+AC](https://eldiariony.com/latinowire/dockwa-and-activecaptain-partner-to-combine-marina-reservations-and-reviews-for-boaters/)) | Garmin partnership; no public booking API found | M + BD | **12 mo** |
| **Waterway Guide / Marinas.com** | Listing pages and booking links | DIFF | Snag-A-Slip (WWG) | BD; deep-link to Helm booking widget (`apps/widgets`) | S | **6 mo** (deep links + schema.org markup) |
| **Google Things to Do** (rentals, tours, charters) | Free and paid listings in Search/Maps for boat rentals | DIFF | none found | Direct integration open to **reservation technology companies**: meet dev requirements, interest form, content license agreement, Google TAM onboarding ([Google](https://developers.google.com/actions-center/verticals/things-to-do/overview)) | L | **12 mo** |
| **Reserve with Google** (appointments, e.g. service bookings) | "Book" button on Business Profile | NICHE | – | Actions Center partner program (gated) | L | **Later** |
| **Viator / Expedia / GetYourGuide** | OTA distribution for rentals and charters | DIFF (rental-heavy marinas) | Stellar/Storable (rentals) likely via channel managers *(unverified)* | Viator **Reservation System API**: availability + booking push, contract-testing tool, starts with a kick-off meeting, needs ≥1 operator registered with Viator ([Viator docs](https://docs.viator.com/supplier-api/technical)); GYG/Expedia have similar supplier APIs | M each | **12 mo** (Viator first) |
| **Boatsetter / Getmyboat** (merged Dec 2025 *(unverified)*) | Peer-to-peer and fleet rentals; marina slip partnerships (Suntex, Westrec, Morningstar) | NICHE | – | **No public API**; BD only ([Supergood](https://supergood.ai/api-report-card/boatsetter), [Trade Only](https://tradeonlytoday.com/dealers/boatsetter-reports-milestone-after-cruzin-merger/)). Getmyboat has a FareHarbor sync precedent ([Getmyboat](https://getmyboat.com/journal/company-news/getmyboat-fareharbor-launch-partnership-2020)) | M + BD | **Later** |
| **Channel managers** (FareHarbor, Bókun, Rezdy) | One integration that reaches many OTAs | DIFF | – | FareHarbor External API partner-gated ([Supergood](https://supergood.ai/docs/fareharbor-api)); Bókun and Rezdy have open APIs | M | **12 mo** (Bókun as OTA hub for rentals) |
| **iCal export/import** | Universal fallback for any calendar-based channel | SMB-TS | common | Open standard | S | **Launch** |

### 6.4 Marina hardware and IoT (Helm's differentiation area)

| Integration | What it does | Demand | Competitors | API / program | Effort | Phase |
|---|---|---|---|---|---|---|
| **Smart pedestal and meter ingestion: generic** | Auto-import kWh and water readings into `MeterReading`, bill usage, detect theft/leaks, remote power on/off tied to contract and payment status | **DIFF** (ENT-TS for new builds) | Harba (HarbaPower), Marina Master (PULS, AU), Scribble (Meterwalk manual) | Build a **Meter Ingestion API** (`POST /v1/meter-readings` batch, CSV/SFTP drop, MQTT/HTTPS webhook) plus vendor adapters | M | **6 mo** |
| **Eaton Marina Power & Lighting** (Lighthouse, Powerhouse) | US pedestal market leader; meters are "wireless capable" with central reading; remote-metering software is third-party ([Eaton catalog](https://www.eaton.com/content/dam/eaton/products/backup-power-ups-surge-it-power-distribution/temporary-power-panels/power-pedestals-v1-t5-ca08100002e.pdf), [Eaton handbook](https://www.eaton.com/content/dam/eaton/company/news-insights/for-safety-sake-blog/marina-power-rv-park-equipment-handbook-vol-5.pdf)) | DIFF | – | No public API found; integrate via the metering-network vendor (EKM, MarineSync, Smarter Technologies) or a file export | M (via partner) | **6 mo** |
| **Marina Electrical Equipment (MEE)** | Pedestals with solid-state metering on a mesh network to an office base station ([MEE](https://marinaee.com/), [Marina Dock Age](https://www.marinadockage.com/from-smartphones-to-smart-marinas-how-technology-and-automation-is-aiding-operations/)) | DIFF | – | No public API found; MarineSync retrofits MEE pedestals | M | **6 mo** |
| **EKM Metering** | Pedestal-sized kWh and water meters, Zigbee mesh, Push3 gateway to cloud, **Open API** ([EKM](https://www.ekmmetering.com/pages/marinas)) | DIFF | – | Public API (EKM Push) | **S** | **6 mo** (first adapter) |
| **MarineSync (RUM)** | Wireless retrofit metering; "integrates with property management software" ([LinkedIn](https://linkedin.com/company/marinesync), [Marina Dock Age](https://www.marinadockage.com/wireless-meter-system/)) | DIFF | DockMaster partner list mentions MarineSync | API not public; BD | M + BD | **6 mo** |
| **Smarter Technologies (Orion/SmarterView)** | Marina utility monitoring; "APIs are available" ([Smarter Technologies](https://smartertechnologies.com/smart-utility-metering/marina-pedestal-metering-system/)) | DIFF | – | Partner API | M | **12 mo** |
| **Hubbell, Tallysman, Katradis, Rolec, D-Marin-style smart pedestals** | RFID/app activation, prepaid power, Modbus RS485 ([Katradis](https://www.katradis.com/our-products/marina-equipment/marine-pedestal-smart-e-power/), [Rolec](https://rolecserv.com/smartvend)) | DIFF (EU/new builds) | Harba | Mostly Modbus or gateway; needs an edge gateway | L | **Later** |
| **Water metering** | Per-slip or per-dock water billing, leak alerts | DIFF | – | Same ingestion API (EKM water, Wild Energy ([Wild Energy](https://wildenergyco.com/pages/marine-metering))) | S (once ingestion exists) | **6 mo** |
| **Gate / access control: Seam (aggregator)** | One API for Brivo, Avigilon Alta (Openpath), Kisi, Salto, Latch, ASSA ABLOY ([Seam](https://docs.seam.co/latest/~/revisions/YhF1FRaxI94O18y0EEO1/device-and-system-integration-guides/overview)) | **DIFF** | Harba (HarbaAccess) | Public API, usage pricing | **M** | **6 mo** (fastest path to many vendors) |
| **Brivo** | Cloud access control; auto-grant dock gate credentials on contract signed, revoke on termination or delinquency | DIFF | – | Public Access API (OAuth2 auth-code + API key; 5-minute tokens), Developer Portal for production keys ([Brivo](https://apidocs.brivo.com/), [Serval](https://docs.serval.com/sections/integrations/brivo)) | M | **6 mo** (direct or via Seam) |
| **Kisi** | Cloud access, mobile unlock | DIFF | – | Public REST API + webhooks; sandbox via sales ([Kisi](https://docs.kisi.io/platform/apis/)) | S–M | **6 mo** (via Seam) |
| **Verkada** (access + cameras + LPR) | Unlock gates by plate; camera events | DIFF | – | Public API; access events webhook; LPR events available via access APIs ([Verkada](https://apidocs.verkada.com/reference/access-api-101), [LPR Unlock](https://docs.verkada.com/docs/lpr-unlock-datasheet.pdf)) | M | **12 mo** |
| **Avigilon Alta (Openpath)** | Cloud access | DIFF | – | Via Seam | S (via Seam) | **6 mo** |
| **ButterflyMX** | Gate/entry intercom; daily PMS resident sync; vehicle tags | DIFF | – | PMS sync partner program (Yardi, RealPage, AppFolio, etc.); OAuth API *(unverified)* ([ButterflyMX](https://grow.butterflymx.com/hubfs/Fact%20sheets/butterflymx-sync-property-management-system-integrations.pdf)) | M + BD | **12 mo** |
| **Marina-specific access** (PDK, Kindoo, Parking BOXX, ICT Protege) | Hardware designed to interface with MMS ([Marina Dock Parts/PDK](https://www.marinadockparts.com/pdkmarinadockparts), [Kindoo](https://www.kindoo.tech/ports-marinas), [Parking BOXX](https://parkingboxx.com/marina-parking-systems), [ICT](https://www.ict.co/blog/pacsoft-and-ict/)) | NICHE | – | Vendor APIs vary | M each | **Later** |
| **License plate recognition at ramps and lots** | Auto-validate seasonal ramp passes (`RampTicket.licensePlate`), detect unpaid launches, parking enforcement | DIFF (municipal ramps) | none found | Plate Recognizer (cloud/on-prem, webhook output, from about $50 usage-based ([Capterra](https://www.capterra.com/p/229220/Plate-Recognizer/))), Rekor/OpenALPR, Verkada LPR | M | **12 mo** |
| **Cameras / VMS** | Event clips linked to incidents and dock walks | NICHE | – | Verkada, Eagle Eye APIs | M | **Later** |
| **FuelCloud** | Self-serve or attendant fuel dispensing; transactions auto-import for one-click invoicing to house accounts | **SMB-TS for fuel docks** | Molo, DockMaster ([Molo FuelCloud](https://getmolo.com/connect/fuel-cloud), [DockMaster/FuelCloud](https://www.tradeonlytoday.com/tech/dockmaster-partners-with-kenect-and-fuelcloud)) | Partner API (BD) | M | **Launch** (parity) |
| **Gilbarco / Veeder-Root (Passport, Insite360), OPW** | Tank levels, dispenser control, compliance alarms | ENT (large fuel docks) | Scribble "fuel dispenser integration and control" | Insite360 is cloud and "device-agnostic", but no public API found; TLS consoles reachable via gateways ([Gilbarco](https://www.gilbarco.com/us/blog/new-insite360-functionality-allows-remote-management-encorer-dispensers), [Chipkin](https://store.chipkin.com/products/protocol-conversions/veeder-root-integration-gateways-services)) | L + BD | **Later** |
| **Dry-stack / forklift / boat-lift telematics** | Launch queue, rack location, forklift utilization and hour-meter maintenance | DIFF | Dockwa, Harba (native); Molo/DockMaster via SpeedyDock and BoatCloud ([SpeedyDock](https://speedydock.com/products/dry-stack)) | No forklift OEM API found (Wiggins etc.); generic telematics (e.g. fleet IoT) via ingestion API. Interop with **SpeedyDock/BoatCloud** for marinas keeping those apps | M (native launch queue) / M (SpeedyDock sync) | **6 mo** (native), interop **12 mo** |
| **Wi-Fi captive portals** | Per-slip or tiered Wi-Fi bundled into slip fees; day passes for transients | DIFF | none found | Purple (member tiers, Stripe-paid passes), Xpodigital (rolls Wi-Fi into slip fees), Osmozis ([Purple](https://www.purple.ai/en-us/industries/porti-turistici), [Xpodigital](https://xpodigital.com/marinafi)). Pattern: RADIUS/portal API ← Helm contract status | M | **12 mo** |
| **Pump-out tracking** | Log pump-outs (`PumpOut` model), CVA grant reporting, IoT counters | NICHE (grant-funded) | Dockwa (pump integration & metering, fuel) | Ingestion API; Clean Vessel Act reporting export | S | **6 mo** |

**Hardware strategy:** build one **Device & Meter Ingestion service** with `Device` and `DeviceReading` models plus a `source` column on `MeterReading`, and one **Access Policy engine** (rules such as "active contract AND no invoice > 30 days overdue AND valid insurance → grant gate + pedestal power"). Then add thin vendor adapters. The policy engine is the real moat. It joins billing, compliance (COI from `insurance-ai.ts`) and physical access, which no US competitor publicly offers.

### 6.5 CRM and marketing

| Integration | What it does | Demand | Competitors | API / program | Effort | Phase |
|---|---|---|---|---|---|---|
| **HubSpot** | Sync leads, customers, lifecycle stage, waitlist and renewal status; trigger nurture | SMB-TS (growing) / ENT | – | Public APIs; Marketplace certification requires OAuth auth-code flow, a verified domain, a security assessment and a demo video; legacy platform versions rejected for new listings from 2 Nov 2026 ([HubSpot certification](https://developers.hubspot.com/docs/apps/developer-platform/list-apps/apply-for-certification/certification-requirements), [changelog](https://developers.hubspot.com/changelog/app-listing-and-app-certification-requirement-updates-for-may-2026)) | M | **6 mo** |
| **Salesforce** | Enterprise CRM for sales of slips and memberships and for dealer ops | ENT-TS (dealers, Safe Harbor + MarineMax) | DockMaster (two-way, via teamMarine) | REST/Bulk APIs; **AppExchange security review $999** ([Salesforce](https://developer.salesforce.com/docs/atlas.en-us.244.0.packagingGuide.meta/packagingGuide/security_review_fees.htm)) | L | **12 mo** |
| **Mailchimp / Klaviyo / ActiveCampaign** | Audience sync for newsletters, events, rental promos | SMB-TS | – | Public APIs, no partner gate | S each (or Zapier) | **6 mo** (Mailchimp native, others via Zapier) |
| **Meta Conversions API** | Send booking and lead conversions (incl. offline/in-person) for ad optimization | DIFF | – | The Offline Conversions API was retired in 2025; offline events now go through the main Conversions API with `action_source` ([Jon Loomer](https://www.jonloomer.com/qvt/offline-conversions-api-deprecation-delayed/)) | S–M | **12 mo** |
| **Google Ads offline conversion import / Enhanced conversions for leads** | Close the loop from lead form (`lead-forms.ts`) to signed contract | DIFF | – | Google Ads API (developer token approval) | M | **12 mo** |
| **Google Business Profile** | Review monitoring and replies, hours, booking link | SMB-TS | – | Business Profile APIs need **manual access approval** (0 QPM quota until approved) *(per third-party guides)* ([guide](https://singhamandeep.com/google-business-profile-api-access/)) | M | **12 mo** |
| **Post-stay review requests** (Google/Yelp via NPS) | Extend `NpsSurvey` to route promoters to Google reviews | SMB-TS | – | Deep links only (no API needed) | S | **Launch** |
| **Birdeye / Podium** | Reputation and messaging suites some groups already use | NICHE | DockMaster (Kenect, similar) | Partner APIs (BD) | M | **Later** (via Zapier first) |

### 6.6 Communications, alerts, weather and tides

| Integration | What it does | Demand | Competitors | API / program | Effort | Phase |
|---|---|---|---|---|---|---|
| **Twilio + A2P 10DLC (ISV model)** | Two-way SMS for reminders, launch requests, storm alerts | SMB-TS | Most | As an ISV, Helm needs an approved **Primary Business Profile** (ISV type), an ISV brand, then a **Secondary Customer Profile + brand + campaign per tenant** via TrustHub API; avoid ISV architectures 5/6 ([Twilio ISV guide](https://www.twilio.com/docs/messaging/compliance/a2p-10dlc/onboarding-isv-api)). `lib/sms.ts provisionPhoneNumber` must be extended with this registration flow | M | **Launch** (compliance blocker for US SMS) |
| **Quo (formerly OpenPhone) / RingCentral / Podium** | Office phone and texting with customer context | NICHE | DockMaster (Kenect) | Quo has a public API; screen-pop via webhook | S–M | **12 mo** |
| **Slack / Microsoft Teams** | Staff alerts: new transient booking, failed payment, meter anomaly, gate forced-open, connection errors | DIFF (cheap delight) | Molo (Slack) | Incoming webhooks / Slack app; Teams Workflows webhooks | S | **6 mo** |
| **Push / app notifications** | Boater and staff mobile alerts | SMB-TS | Dockwa, SpeedyDock | FCM / APNs | M | **6 mo** |
| **VHF / AIS** | Not an integration target (radio is analog). AIS position via aggregators (MarineTraffic API, AISHub) for arrival ETA is DIFF | NICHE | – | Paid AIS APIs | M | **Later** |
| **NWS (api.weather.gov)** | Small-craft advisories, Special Marine Warnings by marine zone → trigger `rental.weather_cancelled`, notify boaters, auto-refund per `CancellationPolicy` | **DIFF** | none found | Free public API; marine area/region alert filters; zone-based alerts lack polygons, so match on zone codes ([NWS](https://www.weather.gov/documentation/services-web-API)) | S–M | **6 mo** |
| **NOAA CO-OPS Tides & Currents** | Tide predictions for launch windows, dry-stack scheduling, shallow-draft guidance | DIFF | none found | Free API, JSON/CSV, range limits per interval ([CO-OPS](https://tidesandcurrents.noaa.gov/api/)) | S | **6 mo** |
| **Tomorrow.io** | Hyperlocal wind and lightning for rental go/no-go | DIFF | – | Free tier (limited; lightning premium), paid from ≈$23/mo *(per aggregator)* ([Tomorrow.io](https://support.tomorrow.io/hc/en-us/articles/23554984091156-Tomorrow-io-Pricing-Overview)) | S | **12 mo** (premium add-on) |

### 6.7 E-signature, documents, identity, insurance, waivers

| Integration | What it does | Demand | Competitors | API / program | Effort | Phase |
|---|---|---|---|---|---|---|
| **Native e-sign** (ESIGN/UETA-compliant: intent, consent, tamper-evident PDF, audit trail, signer auth via email/SMS OTP) | Slip contracts, renewals (`renewal-engine.ts`), rental agreements, waivers. No per-envelope cost | **SMB-TS** | Dockwa (e-contracts), DockMaster (eSignature), Scribble (e-signature contracts) | n/a. The magic-link fallback in `esign.ts` is the seed; add PDF hashing, certificate of completion, R2 WORM storage | M | **Launch** |
| **DocuSign** | Enterprise legal teams mandate it for high-value annual contracts | ENT (RFP checkbox) | – | eSignature REST API, OAuth (JWT grant for ISV), Connect webhooks; API plans priced by envelope volume ([comparison](https://proposify.com/blog/dropbox-sign-vs-docusign)). Fix D12 | M | **6 mo** |
| **Dropbox Sign / PandaDoc** | Lower-cost API e-sign; PandaDoc for proposals (yacht services, events) | NICHE | – | Dropbox Sign API from about $250–$300/mo for embedded signing *(sources conflict)* | S–M | **Later** |
| **Insurance COI verification** | AI extraction + coverage validation (exists: `insurance-ai.ts`); expiring reminders; broker portal upload | **DIFF** (already built) | none comparable found | Expose via API/webhooks; partner with marine insurers (e.g. Boater's Choice, cited by DockMaster) for direct COI feeds | S (exposure) / M + BD (carrier feeds) | **Launch** (exposure), carriers **12 mo** |
| **Boater ID / license verification** | Verify renters' identity and boating-safety card; fraud control for high-value rentals and transients | DIFF | – | **Stripe Identity** $1.50/verification US (first 50 free), 50¢ SSN lookup ([Stripe Identity](https://stripe.com/identity)); Persona for configurable flows | S (Stripe Identity) | **6 mo** |
| **Waivers** (Smartwaiver, WaiverForever) | Rental and event liability waivers | SMB-TS for rentals | – | Smartwaiver API key + `new-waiver` webhooks ([Airbyte](https://docs.airbyte.com/integrations/sources/smartwaiver), [Zapier community](https://community.zapier.com/code-webhooks-52/retrieving-customer-data-from-smartwaiver-for-quickbooks-online-52793)); offer native waivers via e-sign engine | S | **6 mo** (native + Smartwaiver import) |
| **USCG documentation / state registration lookup** | Validate vessel documentation number, hull ID, owner on boat records (`Boat` model) | DIFF | – | **No official API**; PSIX is a weekly FOIA snapshot via web search ([PSIX](https://cgmix.uscg.mil/PSIX/DocumentationLink.aspx)); an unofficial CGMIX endpoint is catalogued *(unverified)* ([apis.io](https://apis.io/apis/united-states-coast-guard/united-states-coast-guard-vessel-documentation-api/)); state registration is per-state with no common API | M (PSIX snapshot ingest + HIN checksum validation) | **12 mo** |

### 6.8 Payroll and workforce

| Integration | What it does | Demand | Competitors | API / program | Effort | Phase |
|---|---|---|---|---|---|---|
| **When I Work** | Dock-staff scheduling and time clock; push Helm `Shift`/tip data | SMB (seasonal staff) | – | REST API (Premium tier, developer key via support) ([Supergood](https://supergood.ai/api-report-card/when-i-work)) | S–M | **12 mo** |
| **Homebase / 7shifts** | Same; 7shifts strong in marina restaurants | SMB | – | Partner APIs (not verified) | S–M each | **Later** (Zapier first) |
| **Gusto** | Payroll for independents; push hours and Terminal **tips** (`getTipReport`) | SMB | – | Partner API with in-app directory listing; Gusto Embedded for payroll-in-product ([Gusto](https://support.gusto.com/article/106622056100000/API-integrations)) | M | **12 mo** |
| **ADP (Workforce Now / RUN)** | Enterprise payroll | ENT | – | ADP Marketplace partner program (REST) ([Knit](https://lb.getknit.dev/?p=776)) | M–L | **12 mo** (enterprise-driven) |
| **Unified HRIS API** (Finch, Merge) | Many payroll systems through one integration | DIFF | – | Per-connection pricing | S–M | **12 mo** |

### 6.9 Service, boatyard and dealer

| Integration | What it does | Demand | Competitors | API / program | Effort | Phase |
|---|---|---|---|---|---|---|
| **ARI PartSmart / PartStream** | OEM parts lookup (multi-OEM catalogs), add to work orders; PartSmart interfaces with "90+ DMS" | ENT-TS for full-service yards | DockMaster ([DockMaster](https://dockmaster.com/for-enterprise-businesses)) | Partner integration (BD) ([ARI](https://rurallifestyledealer.com/articles/1473-ari-integrates-footsteps-lead-management-solution-with-partsmartparts-lookup-software)) | M + BD | **12 mo** |
| **Mercury (MercNET), Yamaha (YMBS dealer portal), Volvo Penta (VODIA/dealer portal)** | Warranty claims, engine registration, parts ordering, service bulletins | ENT (dealers/service) | DockMaster (dealer focus) | Dealer-only portals; few public APIs. Start with CSV/EDI exports and links-out | L + BD | **Later** |
| **Lightspeed DMS (dealer) / CDK** | Sales and F&I for dealerships (MarineMax-class) alongside Helm marina ops | ENT (post Safe Harbor–MarineMax) | – | Partner program, gated | L + BD | **Later** (watch the Safe Harbor deal) |
| **DockMaster coexistence** | Groups running DockMaster for service/dealer and Helm for marina ops | ENT | – | DockMaster open API for partners (2018) ([DockMaster](https://dockmaster.com/blog/dockmasters-power-partnership-open-api)) | M + BD | **Later** |
| **Shopify / e-commerce** | Ship-store online sales; inventory sync with `Inventory` | NICHE | DockMaster (Shopify) | Public API | M | **12 mo** |
| **Native service module + technician app** | Work orders, labor, parts, estimates | SMB-TS for full-service | Dockwa Service (early access, Jul 2026), Scribble, DockMaster, Molo | n/a | L | Product roadmap (outside this doc) |

### 6.10 Data / BI / platform

| Integration | What it does | Demand | Competitors | API / program | Effort | Phase |
|---|---|---|---|---|---|---|
| **Public REST API v1** (§5.7) | Customer IT and partners build on Helm | **ENT-TS** | DockMaster (partner open API), Molo (outbound only) | n/a | M | **Launch** |
| **Outbound webhooks** (§5.8) | Real-time event stream | **ENT-TS** | Molo | Svix-compatible Standard Webhooks | S–M | **Launch** |
| **Bulk export: Snowflake / BigQuery / S3 (R2) / Databricks** | Feed the enterprise data lake (Suntex pattern) | **ENT-TS** | Molo (Suntex data lake) | Nightly Parquet/CSV to customer bucket (S3/R2/GCS) + incremental `updated_since`; **Snowflake Secure Data Sharing** for Snowflake customers (reader accounts possible but compute billed to provider) ([Snowflake](https://docs.snowflake.com/en/user-guide/data-sharing-intro)) | M | **Launch** (bucket export), Snowflake share **6 mo** |
| **Fivetran / Airbyte connector** | Customer-managed ELT into any warehouse | ENT | – | Fivetran Connector SDK / partner-built; Airbyte low-code CDK on top of `/v1` | S–M | **6 mo** (Airbyte), Fivetran **12 mo** |
| **Power BI / Tableau** | Portfolio dashboards | ENT | DockMaster (Supreme BI) | Power BI **certified connector**: free, but submit only when invited by a Microsoft contact; code-complete; TestConnection handler ([Microsoft Learn](https://learn.microsoft.com/power-query/connectorcertification)); Tableau via Web Data Connector/ODBC to export | M | **12 mo** (start with an OData endpoint + warehouse export) |
| **Zapier app / Make** (§5.9) | Long-tail automation | SMB-TS (expected) | none found | Free to publish | M | **6 mo** |
| **SSO (SAML/OIDC) + SCIM** (§5.12) | Okta, Entra, Google | **ENT-TS** | Dockwa ("secure sign-in options", Jul 2026) | Clerk enterprise connections | S–M | **Launch** |
| **GraphQL API** | Flexible querying for partners | DIFF (low) | – | – | M | **Later** (REST + webhooks first) |
| **MCP server** (AI agents) | Expose `/v1` to Claude/ChatGPT agents for marina staff | DIFF | – | Thin wrapper on OAuth + `/v1` | S | **12 mo** |

### 6.11 Tax and compliance

| Integration | What it does | Demand | Competitors | API / program | Effort | Phase |
|---|---|---|---|---|---|---|
| **Native jurisdiction-aware tax engine** (upgrade `tax-engine.ts`) | Per-Location rates by category: dockage, transient, storage (wet vs dry), electric, fuel, ship store, labor, parts; effective dates; exemptions (gov, resale, nonprofit) | **SMB-TS** | all MMS have rate tables | n/a | M | **Launch** |
| **Avalara AvaTax** | Rooftop rates, exemption-certificate management (CertCapture), returns filing for multi-state groups | **ENT-TS** | – | Certified integration program; criteria in partner portal ([Avalara legal](https://legal.avalara.com/partner.legal.center#certifiedimplementationexpertterms), [CPA Practice Advisor](https://www.cpapracticeadvisor.com/2025/04/09/avalara-announces-29-newly-certified-integrations-into-business-applications/156810/)) | M | **6 mo** |
| **Stripe Tax / TaxJar** | Simpler automation for SMB, mainly ship-store and goods | SMB | – | Stripe Tax uses product tax codes; marina-specific services (dockage, storage) need verification against available codes before relying on it | S | **12 mo** |
| **State dockage rules (content, not a vendor)** | Correct default tax categories per state | SMB-TS | – | Example: **Florida** taxes docking and storage of boats at 6% plus discretionary surtax under **s. 212.03(6)**. This is unaffected by the 1 Oct 2025 repeal of the commercial-rent tax and reported on DR-15 Line A ([FL DOR TIP 25A01-11](https://floridarevenue.com/taxes/tips/Documents/TIP_25A01-11.pdf)). High-and-dry storage without owner access may be a non-taxable bailment *(practitioner view)* ([Moffa](https://moffataxlaw.com/florida-sales-tax-on-parking-docking-tie-down-storage-tip-25a01-11/)). **Missouri** taxes floating dock/slip rentals unless tax was paid at purchase ([MO DOR](https://DOR.MO.GOV/taxation/business/documents/Marinas.pdf)). **South Carolina** (1990 advisory) treated wet-slip rental as non-taxable ([SC DOR](https://dor.sc.gov/resources-site/lawandpolicy/Advisory%20Opinions/TAM90-5.pdf)) | S per state (rules table + tax counsel review) | **Launch** (FL, plus top 10 states by customer count) |
| **Fuel excise (federal Form 720, state motor-fuel)** | Correct GL and price build-up for fuel docks | ENT | – | Content/rules | S | **6 mo** |

---

## 7. Phased roadmap

### Launch (enterprise GA gate): platform + parity
**Platform**
- Fix D1–D8 and D11.
- `IntegrationConnection`, vault, `OAuthState`, `ExternalIdMap`, `FieldMapping`, `SyncRun`/`SyncError`, outbox, inbound webhook router.
- `/v1` API with scoped keys, rate limits and OpenAPI docs.
- Outbound webhooks (Svix) and bulk export to S3/R2/GCS.
- SSO/SCIM via Clerk.
- Marketplace UI v1 (catalog, connection page, mapping wizard, error inbox, developer tab).

**Connectors**
- QBO (rebuilt on the framework).
- NetSuite (design partner).
- Generic GL export file (municipal/Munis).
- Stripe hardening: webhooks, payout/fee reconciliation, surcharging/cash discount, Apple/Google Pay domain automation, Financial Connections ACH.
- FuelCloud.
- Snag-A-Slip (BD), iCal.
- Twilio 10DLC ISV registration.
- Native e-sign v1.
- Tax engine v2 with FL and top-state rules.
- COI verification exposed via API/webhooks.

### 6 months: differentiation
- Hardware: meter-ingestion API + EKM adapter + MarineSync/Eaton-via-partner; Seam access control (Brivo, Kisi, Avigilon Alta) + Access Policy engine; pump-out tracking.
- Weather and tides: NWS and NOAA CO-OPS weather-cancellation automation and tide windows.
- Accounting and tax: Sage Intacct, Xero, Avalara.
- Marketing and comms: HubSpot, Mailchimp, Slack/Teams.
- Platform: Zapier app, Airbyte connector, Snowflake share.
- Docs and identity: DocuSign (enterprise), Stripe Identity, waivers.
- Distribution: Dockwa email/iCal ingestion, Waterway Guide/Marinas.com deep links.

### 12 months: enterprise depth and distribution
- Enterprise systems: Business Central, Salesforce, ADP, Gusto, When I Work, Fivetran, Power BI.
- Distribution: Google Things to Do, Viator (then GYG/Expedia or Bókun), ActiveCaptain.
- Hardware: Verkada (access + LPR), Plate Recognizer LPR for ramps, Wi-Fi captive-portal sync (Purple/RADIUS), SpeedyDock/BoatCloud interop, Smarter Technologies.
- Marketing: Meta CAPI, Google Ads offline conversions, Google Business Profile.
- Service and dealer: ARI PartSmart, Shopify.
- Data: USCG PSIX ingest.
- Payments: Adyen if an international anchor customer appears.
- Long tail: unified accounting and HRIS APIs. MCP server.

### Later (demand-gated)
- QuickBooks Desktop, Yardi, and municipal ERP APIs (beyond file export).
- BYO processors: Worldpay, Elavon, Heartland, FreedomPay, Fortis, Authorize.net.
- Gilbarco/Veeder-Root/OPW, Modbus smart pedestals (edge gateway).
- Mercury/Yamaha/Volvo dealer portals, Lightspeed/CDK DMS, DockMaster coexistence.
- Boatsetter/Getmyboat, Reserve with Google, GraphQL, AIS ETA.

---

## 8. Partner program and cost summary (budget input)

| Program | Cost / gate | Notes |
|---|---|---|
| Intuit App Partner Program (QBO) | Builder free (500K reads/mo, blocked above); Silver ≈$300/mo; Gold ≈$1,700/mo (≥500 conns); Platinum ≈$4,500/mo (≥3,000 conns); overage ≈$3.50/1K reads at Silver *(secondary sources)* | Use webhooks + CDC and content hashing to minimize metered reads |
| Xero App Partner | A$0–1,445/mo by tier, effective 2 Mar 2026; 25-connection cap until certified | Certification needs ≥3 live customers |
| Sage Intacct Marketplace | ≈$2,500/yr + $0.015/call after credit | Vetting and security questionnaire |
| NetSuite SDN | Fee via Oracle (not published) | "Built for NetSuite" badge helps enterprise sales |
| Yardi Interfaces | ≈$25K/yr per interface *(unverified)*; ≥2-year-old company; ≥3 mutual clients | Defer |
| Salesforce AppExchange | $999 security review (free apps waived) | — |
| HubSpot Marketplace | Free; certification requirements | Legacy platform cutoff 2 Nov 2026 |
| Zapier | Free to publish | Review by Zapier |
| Power BI certified connector | Free; invite-only submission | — |
| Google Things to Do | Content license agreement; approval | — |
| Viator supplier API | No fee published; kickoff + contract tests | — |
| Twilio 10DLC | Per-brand/campaign registration and vetting fees (TCR pass-through) | Required for US A2P SMS |
| Stripe Identity | $1.50/verification (US) | — |
| Svix (if used) | Usage-based SaaS | Saves about 4–6 eng-weeks |
| Seam | Usage-based SaaS | One integration covers 6+ access vendors |

---

## 9. Risks and open questions

1. **Dockwa's channel.** Dockwa is now PSG-funded and positioned as the "operating system for the marina economy". Assume no API access. Neutral channels (Snag-A-Slip, Google, Viator) and the marina's own booking widget (`apps/widgets`) carry the transient strategy.
2. **Storable/Molo's enterprise entrenchment.** Suntex's NetSuite + data-lake setup is the benchmark. Helm needs a **migration toolkit** (Molo/DockMaster/Dockwa export importers) as much as connectors.
3. **The Safe Harbor + MarineMax combination** (expected close end-2026) creates a dealer/service-heavy buyer. Validate whether Helm targets marina ops alongside an existing DMS, and prioritize Salesforce, ARI and Lightspeed coexistence if so.
4. **Metered APIs.** QBO reads and Xero egress are now billed, so connector efficiency becomes a gross-margin line. Track cost per connection in the health dashboard.
5. **Surcharging compliance.** State rules change and some bans are litigated. Store the rules as data per `Location`, have counsel review them, and log disclosures. Dockwa's exclusion list (CA, CT, MA, ME, NY, PR, Bahamas, Canada) is a pragmatic starting point.
6. **Hardware partnerships.** Pedestal OEMs (Eaton, MEE) don't publish APIs, so the metering-network vendors (EKM, MarineSync, Smarter Technologies) are the real partners. Budget for pilot hardware at 1–2 design-partner marinas.
7. **Security review readiness.** Intuit, Salesforce, HubSpot and enterprise buyers will all run security questionnaires. Before Launch Helm needs the vault, a SOC 2 Type I track, pen-test results and a sub-processor list.
8. **Verification gaps in this research.** Several claims rely on secondary sources and are marked *(unverified)*: Yardi fees, Intuit Gold credits, the Zapier user thresholds, the Boatsetter–Getmyboat merger, ButterflyMX OAuth, and Marina Master's accounting links. Confirm them with the vendors before budgeting or committing externally.

---

## 10. Sources

**Enterprise and market**
- Storable / Suntex enterprise case study: https://www.storablemarine.com/resources/suntex-marinas-accelerates-enterprise-growth-with-storables-marine-technology-suite/
- PRWeb Suntex/Storable: https://www.prweb.com/releases/suntex-marinas-accelerates-enterprise-growth-with-storables-marine-technology-suite-302326127.html
- MarinaWorld, Safe Harbor to acquire MarineMax: https://www.marinaworld.com/news/safe-harbor-acquire-marinemax-1-5-billion
- Dockwa × Safe Harbor membership: https://dockwa.com/safe-harbor-marinas
- Dockwa 1,000th marina partner (management groups): https://www.prnewswire.com/news-releases/dockwa-announces-1-000th-marina-partner-300980858.html
- PSG investment in Dockwa: https://psgequity.com/news/dockwa-secures-strategic-growth-investment-from-psg-to-build-the-operating-system-for-the-57-billion-marina-economy
- Morningstar Marinas / BoatCloud: https://www.morningstarmarinas.com/blog/benefits-using-boating-app/
- Boatsetter × Suntex: https://boatingindustry.com/news/2022/11/03/boatsetter-partners-with-suntex-marina/
- Boatsetter partners (Westrec, Morningstar): https://tradeonlytoday.com/dealers/boatsetter-reports-milestone-after-cruzin-merger/
- ButterflyMX marina management companies: https://butterflymx.com/blog/marina-management-companies/
- Ashland utility billing RFP Q&A (Munis): https://govtribe.com/file/government-file/questions-and-answers-utility-billing-software-rfp-012226-dot-pdf
- Alameda recreation RFP Q&A (Tyler ERP): https://www.alamedaca.gov/files/assets/public/v/2/it/rfp_qa_combined_accessible.pdf

**Competitors**
- Dockwa accounting integrations: https://marinas.dockwa.com/accounting-integrations
- Dockwa about: https://marinas.dockwa.com/about-us
- Dockwa all features: https://marinas.dockwa.com/marina-software/all-features
- Dockwa surcharging: https://blog.dockwa.com/marinas/credit-card-surcharging-dockwa
- Dockwa payment processing guide 2026: https://blog.dockwa.com/marinas/marina-payment-processing-in-2026-a-complete-guide
- Dockwa Dispatch July 2026: https://blog.dockwa.com/marinas/dockwa-dispatch-july-2026
- Dockwa dry stack: https://marinas.dockwa.com/dry-stack-software
- Dockwa × ActiveCaptain: https://eldiariony.com/latinowire/dockwa-and-activecaptain-partner-to-combine-marina-reservations-and-reviews-for-boaters/
- Storable Marine software: https://www.storablemarine.com/marina-software/
- Molo FuelCloud: https://getmolo.com/connect/fuel-cloud
- Molo surcharge feature: https://support.getmolo.com/support/solutions/articles/13000104789-using-the-credit-card-surcharge-feature
- Software Advice Molo profile: https://www.softwareadvice.com/marine/molo-profile/
- DockMaster enterprise: https://dockmaster.com/for-enterprise-businesses
- DockMaster open API: https://dockmaster.com/blog/dockmasters-power-partnership-open-api
- DockMaster APIs & integrations: https://www.dockmaster.com/blog/supporting-marine-industry-apis-integrations
- DockMaster integration partners: https://www.dockmaster.com/blog/integration-partners
- GetApp DockMaster: https://www.getapp.com/industries-software/a/dockmaster/
- DockMaster × FuelCloud/Kenect: https://www.tradeonlytoday.com/tech/dockmaster-partners-with-kenect-and-fuelcloud
- MARINAGO accounting: https://www.marinago.com/business-accounting-detail.html
- Scribble × Snag-A-Slip: https://boatingindustry.com/news/2020/01/16/scribble-software-snag-a-slip-join-forces/
- Snag-A-Slip FAQ: https://www.snagaslip.com/frequently-asked-questions/
- Snag-A-Slip × Waterway Guide: https://digitaledition.greatlakesscuttlebutt.com/articles/snag-a-slip-partners-with-waterway-guide-media
- Harba solution: https://harba.co/solution
- HarbaPower: https://harba.co/harbapower
- Harba dry stacks: https://harba.co/da/drystacks
- Dash Symons (Marina Master agent): https://www.dashsymons.com/services/marina-management/
- SpeedyDock dry stack: https://speedydock.com/products/dry-stack
- i-Marinas for NetSuite: https://www.capterra.co.uk/software/1108106/i-Marinas-for-NetSuite

**Accounting / ERP**
- Intuit App Partner Program pricing (Apideck): https://www.apideck.com/blog/quickbooks-api-pricing-and-the-intuit-app-partner-program
- QuickBooks API cost 2026 (Truto): https://truto.one/blog/how-much-does-the-quickbooks-api-cost-2026-pricing-rate-limits/
- CorePlus usage (hotglue): https://hotglue.com/blog/how-to-lower-your-coreplus-quickbooks-api-usage
- QuickBooks Web Connector: https://developer.intuit.com/app/developer/qbdesktop/docs/get-started/get-started-with-quickbooks-web-connector
- QB Desktop integration 2025 (Apideck): https://www.apideck.com/blog/build-an-integration-with-quickbooks-desktop-in-2025
- Xero developer pricing: https://developer.xero.com/pricing
- Xero App Partner (Apideck): https://radar.apideck.com/blog/xero-api-pricing-and-the-app-partner-program
- Sage Intacct (Rutter): https://docs.rutter.com/platforms/accounting/sageintacct2
- Sage Intacct (Apideck): https://developers.apideck.com/apis/accounting/sage-intacct/overview
- Sage Intacct Marketplace: https://marketplace.intacct.com/BecomeAPartner
- NetSuite partner program news (Oct 2025): https://www.oracle.com/jp/news/announcement/sw25-netsuite-expands-partner-program-accelerate-ai-innovation-2025-10-06/
- Business Central S2S auth: https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/administration/automation-apis-using-s2s-authentication
- Yardi interfaces: https://yardi.com/services/interfaces
- Yardi Voyager API report card: https://supergood.ai/api-report-card/yardi-voyager

**Payments**
- Stripe surcharge guide: https://stripe.com/resources/more/surcharge-fees
- Stripe surcharging docs: https://docs.stripe.com/payments/advanced/surcharge
- Stripe payment method domain registration: https://docs.stripe.com/payments/payment-methods/pmd-registration
- Stripe Apple Pay: https://docs.stripe.com/apple-pay.md?platform=web
- Stripe ACH / Plaid: https://docs.stripe.com/ach-deprecated
- Plaid Auth partnerships: https://plaid.com/docs/auth/partnerships/achq
- Connecticut DCP surcharge FAQ: https://portal.ct.gov/dcp/knowledge-base/articles/surcharge-faqs/surcharges-main
- Massachusetts surcharge bill: https://www.paymentsjournal.com/massachusetts-bill-may-pass-credit-card-surcharges-to-consumers/amp/
- Adyen for Platforms: https://docs.adyen.com/platforms
- Fortis ISV: https://go.fortispay.com/isv
- Stripe Identity: https://stripe.com/identity

**Distribution**
- Google Things to Do overview: https://developers.google.com/actions-center/verticals/things-to-do/overview
- Viator Reservation System API: https://docs.viator.com/supplier-api/technical
- Viator API certification: https://partnerresources.viator.com/travel-commerce/certification/
- Getmyboat × FareHarbor: https://getmyboat.com/journal/company-news/getmyboat-fareharbor-launch-partnership-2020
- FareHarbor API: https://supergood.ai/docs/fareharbor-api
- Boatsetter API report card: https://supergood.ai/api-report-card/boatsetter

**Hardware / IoT / access**
- Eaton pedestal catalog: https://www.eaton.com/content/dam/eaton/products/backup-power-ups-surge-it-power-distribution/temporary-power-panels/power-pedestals-v1-t5-ca08100002e.pdf
- Eaton marina parts handbook: https://www.eaton.com/content/dam/eaton/company/news-insights/for-safety-sake-blog/marina-power-rv-park-equipment-handbook-vol-5.pdf
- Marina Electrical Equipment: https://marinaee.com/
- Marina Dock Age, smart marinas: https://www.marinadockage.com/from-smartphones-to-smart-marinas-how-technology-and-automation-is-aiding-operations/
- Marina Dock Age, wireless meter system: https://www.marinadockage.com/wireless-meter-system/
- EKM Metering marinas: https://www.ekmmetering.com/pages/marinas
- Smarter Technologies marina metering: https://smartertechnologies.com/smart-utility-metering/marina-pedestal-metering-system/
- Wild Energy marine metering: https://wildenergyco.com/pages/marine-metering
- Katradis SMART E-POWER: https://www.katradis.com/our-products/marina-equipment/marine-pedestal-smart-e-power/
- Rolec SmartVend: https://rolecserv.com/smartvend
- Seam integrations overview: https://docs.seam.co/latest/~/revisions/YhF1FRaxI94O18y0EEO1/device-and-system-integration-guides/overview
- Seam Kisi guide: https://docs.seam.co/device-and-system-integration-guides/kisi-access-control-system/get-started-with-kisi-access-control-system
- Brivo API docs: https://apidocs.brivo.com/
- Brivo via Serval: https://docs.serval.com/sections/integrations/brivo
- Kisi APIs: https://docs.kisi.io/platform/apis/
- Verkada Access API: https://apidocs.verkada.com/reference/access-api-101
- Verkada LPR Unlock: https://docs.verkada.com/docs/lpr-unlock-datasheet.pdf
- ButterflyMX PMS integrations: https://grow.butterflymx.com/hubfs/Fact%20sheets/butterflymx-sync-property-management-system-integrations.pdf
- ButterflyMX marina access: https://butterflymx.com/blog/marina-access-control-system/
- PDK / Marina Dock Parts: https://www.marinadockparts.com/pdkmarinadockparts
- Kindoo ports & marinas: https://www.kindoo.tech/ports-marinas
- Parking BOXX marina: https://parkingboxx.com/marina-parking-systems
- ICT × Pacsoft: https://www.ict.co/blog/pacsoft-and-ict/
- Plate Recognizer (Capterra): https://www.capterra.com/p/229220/Plate-Recognizer/
- Gilbarco Insite360: https://www.gilbarco.com/us/blog/new-insite360-functionality-allows-remote-management-encorer-dispensers
- Chipkin Veeder-Root gateways: https://store.chipkin.com/products/protocol-conversions/veeder-root-integration-gateways-services
- Purple marinas Wi-Fi: https://www.purple.ai/en-us/industries/porti-turistici
- Xpodigital MarinaFi: https://xpodigital.com/marinafi

**CRM, comms, weather**
- HubSpot certification requirements: https://developers.hubspot.com/docs/apps/developer-platform/list-apps/apply-for-certification/certification-requirements
- HubSpot May 2026 listing changes: https://developers.hubspot.com/changelog/app-listing-and-app-certification-requirement-updates-for-may-2026
- Salesforce security review fees: https://developer.salesforce.com/docs/atlas.en-us.244.0.packagingGuide.meta/packagingGuide/security_review_fees.htm
- Meta Offline Conversions API deprecation: https://www.jonloomer.com/qvt/offline-conversions-api-deprecation-delayed/
- Google Business Profile API access: https://singhamandeep.com/google-business-profile-api-access/
- Twilio A2P 10DLC ISV onboarding: https://www.twilio.com/docs/messaging/compliance/a2p-10dlc/onboarding-isv-api
- NWS API: https://www.weather.gov/documentation/services-web-API
- NOAA CO-OPS API: https://tidesandcurrents.noaa.gov/api/
- Tomorrow.io pricing: https://support.tomorrow.io/hc/en-us/articles/23554984091156-Tomorrow-io-Pricing-Overview

**E-sign, identity, waivers, vessel data**
- Dropbox Sign vs DocuSign (Proposify): https://proposify.com/blog/dropbox-sign-vs-docusign
- Smartwaiver (Airbyte): https://docs.airbyte.com/integrations/sources/smartwaiver
- Smartwaiver webhooks (Zapier community): https://community.zapier.com/code-webhooks-52/retrieving-customer-data-from-smartwaiver-for-quickbooks-online-52793
- USCG PSIX: https://cgmix.uscg.mil/PSIX/DocumentationLink.aspx
- CGMIX API listing: https://apis.io/apis/united-states-coast-guard/united-states-coast-guard-vessel-documentation-api/

**Workforce / service**
- When I Work API report card: https://supergood.ai/api-report-card/when-i-work
- Gusto API integrations: https://support.gusto.com/article/106622056100000/API-integrations
- ADP Marketplace (Knit): https://lb.getknit.dev/?p=776
- ARI PartSmart: https://rurallifestyledealer.com/articles/1473-ari-integrates-footsteps-lead-management-solution-with-partsmartparts-lookup-software

**Data / platform / identity**
- Zapier publishing requirements: https://docs.zapier.com/platform/publish/integration-publishing-requirements
- Zapier public integrations: https://docs.zapier.com/platform/publish/public-integration
- LTV Co. Zapier publishing: https://ltvco.com/engineering/build-publish-new-zapier-integration
- Standard Webhooks: https://www.standardwebhooks.com/
- Webhook signature verification example: https://docs.openlayer.com/security/webhooks/verify-signatures
- Clerk enterprise auth: https://clerk.com/enterprise-authentication
- Clerk directory sync: https://clerk.com/docs/guides/configure/auth-strategies/enterprise-connections/self-serve-directory-sync.md
- Power BI connector certification: https://learn.microsoft.com/power-query/connectorcertification
- Snowflake Secure Data Sharing: https://docs.snowflake.com/en/user-guide/data-sharing-intro

**Tax**
- Florida DOR TIP 25A01-11 (docking/storage, 22 Aug 2025): https://floridarevenue.com/taxes/tips/Documents/TIP_25A01-11.pdf
- Moffa Tax Law on TIP 25A01-11: https://moffataxlaw.com/florida-sales-tax-on-parking-docking-tie-down-storage-tip-25a01-11/
- Missouri DOR marinas: https://DOR.MO.GOV/taxation/business/documents/Marinas.pdf
- South Carolina TAM 90-5: https://dor.sc.gov/resources-site/lawandpolicy/Advisory%20Opinions/TAM90-5.pdf
- Avalara partner legal terms: https://legal.avalara.com/partner.legal.center#certifiedimplementationexpertterms
- Avalara certified integrations (2025): https://www.cpapracticeadvisor.com/2025/04/09/avalara-announces-29-newly-certified-integrations-into-business-applications/156810/
