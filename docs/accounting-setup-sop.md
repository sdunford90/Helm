# Accounting Setup SOP — Tenant Onboarding Runbook

This document is a top-to-bottom runbook for setting up a fresh Helm tenant
so that every posting flow (POS sale, invoice, inventory receive, inventory
adjustment, rental booking) lands cleanly in QuickBooks (or in the local GL
when QuickBooks is not connected). Follow it in order. By the end of the
"Per-Location Setup" section for one location, that location is fully
postable.

> **Audience.** Marina admin or bookkeeper onboarding a new tenant or
> standing up a new location. Not for the platform admin app.

> **Scope.** GL setup, tax setup, product/category setup, rental product
> setup, tax-exempt customers, and the day-to-day posting flows. Out of
> scope: Stripe payouts reconciliation, autopay/card-expiration handling,
> payroll, designing your own chart-of-accounts numbering scheme.

---

## 0. Prerequisites

Before starting:

- [ ] You are signed in as a tenant admin (role `TENANT_ADMIN` or
  `MARINA_OWNER`). If you only see a subset of locations in the location
  switcher, your user is location-restricted — get a tenant admin to widen
  your access first.
- [ ] At least one **Location** exists. Check **Settings → Locations**
  (left sidebar of Settings). If empty, click **Add Location**, fill in
  name + timezone, and save.
- [ ] You have decided, per location, whether it will sync to QuickBooks
  Online. A location can be QBO-connected or stand-alone — the rules
  change between the two. **Read the callout below before continuing.**

> ### 📌 GL resolution: three different paths
>
> Helm does **not** use one global precedence chain for every account. It
> picks one of **three** resolvers depending on what's being posted, and
> only the operator can fix a misposting if you know which resolver the
> posting line went through. Each posting line credits/debits two sides;
> a single sale typically uses 2–3 of these paths at once.
>
> **Path A — Inventory products & their COGS / inventory-asset legs.**
> Source: per-(category, location) row in `ProductCategoryGlMapping`,
> edited at **Settings → Categories → 📍 map-pin icon**.
>
> 1. Read the product's `productCategoryId` (required field).
> 2. Look up the `ProductCategoryGlMapping` row for that
>    (category, originating-location) pair and read the `revenueGl`,
>    `cogsGl`, or `inventoryAssetGl` slot the posting needs.
> 3. If the row is missing **or** the slot is null → `MISSING_GL_MAPPING`
>    error. **There is no fallback** — no tenant-wide product default,
>    no other location's mapping, nothing. Fix it on the category.
>
> **Path B — Rental products, dockage rates, and service fees.**
> Source: the GL slots pinned directly on the rental product / dockage
> rate / service fee, with optional per-location overrides on the same
> entity. Inventory's "category-only" rule does **not** apply to these —
> they keep their per-item per-location pins (out of scope of Task #235).
> Edited on the item's own settings page.
>
> **Path C — System posting accounts** (A/R 1200, Undeposited Funds 1000,
> Deferred Revenue 2100, Default Revenue 4500, Sales Tax Payable 2400,
> Early Termination Income 4700, ACH Return Fee Revenue 4600). Source:
> `resolveLocationSystemPostingAccount` (and the parallel A/R / cash
> resolvers in `gl-posting.ts`).
>
> 1. **Location pin wins** — the slot you set on
>    **QuickBooks Setup → Posting Accounts**.
> 2. **If the location is QBO-connected and there's no pin:** the
>    resolver looks for a row in **that location's own chart of accounts**
>    matching the well-known number (e.g. 1200 for A/R). If none, it
>    throws `UNCONFIGURED_GL_MAPPING` immediately. It will **not** walk
>    up to a tenant-wide row, because that could cross-post into another
>    QBO realm.
> 3. **If the location is NOT QBO-connected and there's no pin:** the
>    resolver tries a location-scoped chart row, then a tenant-wide chart
>    row. Loud failure only if neither exists.
>
> **One carve-out for Deferred Revenue.** `getDeferredRevenueAccountId`
> deliberately keeps a tenant-wide fallback even on QBO-connected
> locations: pin → location-scoped flagged → tenant-wide flagged →
> chart-by-number `2100` → null. This exists so legacy tenants with one
> shared deferred-revenue liability don't have to duplicate it per QBO
> realm. If you need strict per-location isolation, set the **Deferred
> Revenue** pin (step 2 of section 2) — the pin always wins.
>
> **The QBO sales-tax-split exception (Path C, sales tax slot only).**
> When an invoice or POS sale calculates tax, each `TaxRate` row may
> carry its own `glAccountId`. If set, that rate's tax credit goes to
> *that* account regardless of the location's pinned Sales Tax Payable
> slot — only rates with no `glAccountId` fall through to the location's
> pin. See **section 3b**.

> ### 📌 The QBO-strictness rule
>
> Once a location has a QuickBooks connection (i.e. a refresh token and
> realm ID stored on the location), **tenant-wide fallbacks stop applying
> for that location**. Every account it posts to must exist in **that
> location's own QBO chart of accounts**, and every category it sells from
> must have an explicit per-location mapping. This is intentional:
> falling back to a tenant-wide row could silently route a journal entry
> to a different QBO realm. There is no override for this — fix the
> mapping, don't bypass the rule.

---

## 1. Connect QuickBooks (per location)

Skip this section for any location that won't sync to QuickBooks. The
location will then resolve through tenant-wide fallbacks (step 4 in the
precedence callout) and the strict QBO rules above don't apply.

1. Go to **Settings → QuickBooks Setup** (left sidebar of the marina
   dashboard, route `/settings/quickbooks`).
2. You will see one card per location.
3. On the location's card, click **Connect QuickBooks** (the button
   shows a plug icon). For an unconnected location this is the only
   button visible in the card's actions row.
4. Complete the Intuit OAuth flow in the popup. When you return, the
   card should show:
   - The connected QuickBooks **company name** and **realm ID** in the
     card header.
   - An **Import / Refresh Chart of Accounts** button (with a refresh
     icon) where the **Connect QuickBooks** button used to be.
   - A red **Disconnect** button next to it.
5. Click **Import / Refresh Chart of Accounts** once. The button label
   changes to **Pulling…** while the request is in flight, then returns
   to **Import / Refresh Chart of Accounts** when the chart has been
   imported. Helm tags every imported row with this location's
   `locationId`. You can re-click this any time you change the chart
   in QuickBooks.
6. **Verification.** Open **Settings → Categories → (any category) → 📍
   map-pin icon**. The Revenue / COGS / Inventory Asset dropdowns for
   this location should now show options pulled from QuickBooks.

> If you also use Stripe for payments, the same card on QuickBooks Setup
> shows a Stripe Connect status line ("Connected" / onboarding link).
> Connect Stripe before you take a card payment, but Stripe is independent
> from the GL setup that the rest of this doc covers.

**Repeat for every location that will sync to QuickBooks.** Each location
gets its own QBO company; you can mix QBO and non-QBO locations in the
same tenant.

---

## 2. Pin location posting accounts

This is where you tell Helm which exact GL accounts each location uses for
the seven system posting slots. **Required for every QBO-connected
location.** Recommended but optional for non-QBO locations (they fall back
to chart-by-number lookup).

1. **Settings → QuickBooks Setup → (location) → Posting Accounts** card.
2. Set each of these dropdowns from the location's chart of accounts:
   - **Accounts Receivable** — the asset account invoice totals debit
     when an invoice is finalized. Maps to QBO A/R.
   - **Cash / Undeposited Funds** — the asset account payments debit
     when received before deposit. Maps to QBO Undeposited Funds (or a
     bank if you skip the holding step).
   - **Deferred Revenue** — the liability account that holds prepaid /
     unearned revenue (annual slip contracts, deposits) until the
     service period earns it.
   - **Default Revenue (4500)** — the revenue account ad-hoc invoice
     lines and POS lines fall back to when no per-category mapping is
     configured. **A QBO-connected location with no per-category
     mapping for an inventory product will refuse to post — this slot
     is the fallback for non-product, non-deferred ad-hoc revenue
     lines only.**
   - **Sales Tax Payable (2400)** — the liability account sales tax
     credits when no jurisdiction-level GL account is set on the
     `TaxRate` row.
   - **Early Termination Income (4700)** — the revenue account early
     termination fees credit on contract cancellations.
   - **ACH Return Fee Revenue (4600)** — the revenue account ACH
     return fees credit when a bank returns a payment.
3. **There is no per-row Save button.** Each dropdown saves
   immediately on selection — the row is briefly disabled while the
   request is in flight, and any error is shown in red below the grid.
4. **Verification.** On a QBO-connected location, the placeholder row
   in each empty dropdown reads `— Required: pin an account —` (vs.
   `— Use tenant default —` on stand-alone locations). Once you pick
   an account, the dropdown shows the account number, name, and a `·
   QBO` suffix on QBO-imported rows.

**If you skip a system slot on a QBO-connected location**, the first
posting that needs it will throw:

```
UNCONFIGURED_GL_MAPPING: location {id} is QBO-connected but has no
{slot} account pinned ({context}). Pin a {slot} account for this
location in QuickBooks Setup before posting.
```

Fix it on this same page, then retry.

---

## 3. Tax setup (jurisdictions and rates)

Tax is per-tenant (jurisdictions are tenant-scoped) but stacked
per-location (each location attaches an ordered list of jurisdictions). A
sale at location L is taxed by walking L's jurisdiction stack and adding
every applicable rate.

### 3a. Create jurisdictions

1. Go to **Sales Tax Rates** (route `/settings/tax-rates`, also reachable
   via **Settings → Tax** in the left sidebar).
2. Under **Add Jurisdiction**, fill in:
   - **Code** — short code (e.g. `NJ`, `OCEAN_CO`, `ATLANTIC_CITY`).
   - **Name** — display name (e.g. `New Jersey State Sales Tax`).
   - **Kind** — one of `STATE`, `COUNTY`, `CITY`, `SPECIAL`.
3. Click **Add Jurisdiction**. The new row appears under **Configured
   Jurisdictions**.
4. Repeat for every jurisdiction your locations operate in (e.g. NJ
   state + a county + a special marina-tax district).

### 3b. Add rates to each jurisdiction

1. Click a jurisdiction row to expand it.
2. Click **Add Rate** and fill in:
   - **Category** — a free-form text input (default placeholder
     `marina_services`). This is the string the tax engine matches
     against each line item's `taxCategory`. Pick one that matches
     the **Default Tax Category** you use on your product categories
     (see step 4a). Common values: `general`, `marina_services`,
     `fuel`, `food`, `lodging`, `exempt`. The `general` row is
     special — when no exact-category match is found for a line, the
     engine falls back to the jurisdiction's `general` rate.
   - **Rate %** — entered as a percentage; stored internally as
     basis points (`6.625%` → `662.5 bps`, rounded).
   - **Effective from** — the date this rate starts applying.
   - **Effective to** — leave blank for "currently in effect".
   - **GL Account** — *optional but recommended*. The liability
     account this jurisdiction's tax credits to. When set, sales tax
     is split per jurisdiction at posting time. When blank, the tax
     falls back to the location's pinned **Sales Tax Payable**
     account (step 2).
3. **Posting behavior.** At calculation time the engine prefers an
   exact category match for the line item's `taxCategory`, then falls
   back to the rate row marked `general`. A rate with no `general`
   row and no exact-category row simply doesn't apply — the line
   isn't taxed by that jurisdiction. Use this to model, e.g., a
   fuel-only special-district rate (give it a `fuel` rate row only;
   only line items whose category resolves to `taxCategory = "fuel"`
   pick it up) or an exempt class (give it a `0%` `general` rate, or
   tag the customer as Tax Exempt — see step 7).

### 3c. Stack jurisdictions on each location

1. Go to **Settings → Locations → (a location) → Tax Jurisdictions**
   tab/section.
2. Add jurisdictions in the order they should apply. The `sortOrder`
   determines the order they appear in the per-line-item breakdown but
   does **not** stack rates multiplicatively — rates are added across
   the stack against the same taxable amount.
3. Save.

**Verification.** Open **POS → New Sale** at this location, add any
taxable item, and confirm the tax line(s) at the bottom show one row per
jurisdiction with the expected rate.

### 3d. Worked examples — NJ rate-lock, MOTOR_FUEL, and exempt classes

These three patterns trip up almost every new tenant. Model them with
the generic jurisdiction + rate primitives — there are no special
"NJ-only" or "fuel-only" toggles in the engine; what makes them behave
correctly is which **category** strings you put on the rate row vs.
the product category.

#### 3d.i — NJ state sales tax (rate-locked at 6.625%)

New Jersey's state sales tax has been statutorily fixed at **6.625%**
since 2018. Operators sometimes "round it down to 6.6%" or guess
`6.5%` — the engine will happily use whatever you type, so the rate is
only ever wrong because someone overrode it. Treat the row as
read-only after setup.

1. Create a jurisdiction with **Code** `NJ`, **Name** `New Jersey
   State Sales Tax`, **Kind** `STATE`.
2. Add **one** rate row to it:
   - **Category**: `general`
   - **Rate %**: `6.625` (stored as `662.5 bps`, which is the only
     correct value for NJ state sales tax)
   - **Effective from**: the date the location starts collecting tax
     (typically the location's go-live date, not 2018)
   - **Effective to**: leave blank
   - **GL Account**: pin to `2400 Sales Tax Payable - NJ` if you
     report NJ separately on your liability roll-forward.
3. Stack `NJ` first (lowest `sortOrder`) on every NJ-domiciled
   location's jurisdiction list (step 3c).
4. **Operational rule.** Treat the NJ rate row as locked. If the
   statutory rate ever changes, end-date the existing row (set
   **Effective to** = the day before the new rate kicks in) and add a
   new row with the new rate and the new **Effective from** — don't
   edit the basis points in place, or historical invoices will report
   the wrong rate when re-rendered.

#### 3d.ii — MOTOR_FUEL (separate excise on fuel sales)

Many states (NJ included) layer a **motor-fuel-only** tax on top of
sales tax. In Helm this is just a second rate row whose Category
matches a tax-category string you only put on fuel SKUs.

1. Decide on the string you'll use for fuel line items. The
   convention in the marina default vocabulary is lowercase `fuel`.
   This SOP uses `fuel` — substitute `motor_fuel` if your bookkeeper
   prefers the longer form, but use the same string everywhere.
2. **On the fuel jurisdiction** (could be the existing `NJ`
   jurisdiction, or a separate `NJ_MOTOR_FUEL` one if you want the
   liability split out for reporting):
   - Add a rate row with **Category** `fuel`, the per-gallon-equivalent
     percentage rate, an **Effective from** date, and a dedicated
     **GL Account** like `2410 Motor Fuel Excise Payable`.
   - Do **not** add a `general` row to this jurisdiction if it's a
     fuel-only special district — that way only fuel lines pick it up.
3. **On the product side**, create a `Fuel` category whose **Default
   Tax Category** is `fuel` (step 4a). Every fuel SKU you create
   under this category inherits `taxCategory = "fuel"` automatically,
   and the engine applies the motor-fuel rate to those lines while
   leaving non-fuel lines alone.
4. **Verification.** Ring up a mixed POS sale (10 gal fuel + 1 cooler
   of soda). The tax breakdown on the fuel line should show two rows
   — `NJ general 6.625%` + `NJ_MOTOR_FUEL fuel <X>%` — while the soda
   line shows only `NJ general 6.625%`.

> **Pure-excise variant.** If your state's motor-fuel tax is a
> per-gallon dollar amount, not a percentage, the engine doesn't
> support that natively (rates are stored in basis points of the line
> amount). Either convert it to a percentage of the pump price for
> SOP purposes, or take the excise outside Helm and post it manually.

#### 3d.iii — Exempt classes (resale, government, non-profit)

There are **two** ways to suppress tax for an exempt sale, and they
mean different things:

1. **Customer-level exemption** (the common case — resale
   certificates, 501(c)(3) buyers, government accounts):
   - On the customer record (**Customers → (customer)**), set
     **Tax Exempt = on** and set **Exemption Expiry** (the date the
     certificate expires; leave blank for "never expires"). These are
     the only two fields the engine consults — Helm does not currently
     store an exemption *reason* or *certificate number* as separate
     columns, so capture those in the customer's free-text
     **Notes** field if your auditor needs them on file.
   - When a sale at any jurisdiction is rung up against this customer
     and `exemptionExpiry` has not yet passed, the engine **skips the
     entire jurisdiction stack** and posts $0 tax. Every line on the
     sale is exempt — there is no per-line carve-out.
   - Anonymous POS sales (no customer attached) **cannot be exempt**
     — the engine has nothing to look at, so the location's
     jurisdiction stack applies in full. If you sell tax-exempt at
     the counter regularly, create a "Tax Exempt — Walk-In" customer
     and attach it to those sales.
2. **Category-level exemption** (rare — e.g. a category of items
   that's never taxed regardless of who buys them, like "Federal
   excise stamps"):
   - On the product category, set **Taxable = off** (step 4a).
     Products in this category never have tax calculated, even for
     non-exempt customers.
   - Alternatively, give the category a **Default Tax Category** of
     `exempt` and add `0%` rate rows with **Category** `exempt` to
     each relevant jurisdiction. The engine will then formally pick
     up an exempt rate (auditable on the breakdown) instead of
     simply not applying any rate.

**Reverification.** After setting up an exempt customer, run a POS
sale against them and confirm the tax line shows `$0.00` with no
breakdown rows. The customer's saved card / autopay flow uses the
same engine, so a recurring autopay invoice will also bill $0 tax
until the exemption expires.

---

## 4. Product categories + per-location GL mappings

> **As of the `20260429080000_inventory_category_only_gl` migration**
> (April 2026), inventory products resolve their GL accounts through
> exactly ONE rung: the per-(category, location) `ProductCategoryGlMapping`
> row. There are no per-product GL overrides, no tenant-wide category
> defaults, and `Product.productCategoryId` is required. If a product is
> sold at a location with no mapping for that category, the POS / invoice
> posting fails with `MISSING_GL_MAPPING`.

### 4a. Create categories

1. **Settings → Categories** (route `/settings?tab=categories`).
2. Click **Add Category** and fill in:
   - **Name** (e.g. `Fuel`, `Provisions`, `Bait & Tackle`).
   - **Default Tax Category** — the `taxCategory` string to apply to
     every product in this category by default. Match a string used in
     your tax-rate setup (step 3b) — typically `general`, `fuel`,
     `food`, etc.
   - **Taxable** — toggle off if items in this category should never
     have tax calculated (e.g. internal transfers).
   - **Active** — defaults to on.
3. Click **Create Category**. The row appears in the table.

The modal explicitly tells you GL accounts are configured per location —
they're not on this modal. Click **Save** to dismiss, then move to 4b.

### 4b. Set per-location GL mappings on each category

1. Back on the **Settings → Categories** table, find the category row
   and click the **📍 map-pin icon** in its row.
2. The **Per-Location GL Mappings — {Category Name}** modal opens. It
   lists every location for the tenant with a "QBO" badge on
   QBO-connected ones.
3. For each location row, set the three dropdowns:
   - **Revenue** — the revenue (REVENUE-typed) account this category's
     sales credit at this location.
   - **COGS** — the expense (EXPENSE-typed) account COGS debits when
     an inventory item from this category is sold.
   - **Inv. Asset** — the asset (ASSET-typed) account inventory value
     debits when items in this category are received and credits when
     they ship out.
4. Each row shows a **Save** button when dirty. Click it. You should
   see a "Mapping saved" toast.
5. **What the dropdowns show.**
   - **QBO-connected location:** only accounts that belong to that
     location's chart appear (we hide tenant-wide accounts to prevent
     cross-realm bleed). If the dropdown is empty, you haven't
     finished step 1 — re-sync the chart from **QuickBooks Setup**.
   - **Non-QBO location:** the dropdown is the union of
     location-scoped accounts and tenant-wide accounts.
6. Any slot you leave blank shows an amber **"Not mapped"** warning
   under the row. Inventory products in this category will refuse to
   post at that location until the slot is filled.

> ### Skipping COGS / Inventory Asset
>
> Categories whose products you never track in inventory (e.g. service
> SKUs, ad-hoc line items) only **need** the Revenue slot. COGS and
> Inv. Asset are only required for products with `trackInventory =
> true`. The posting code is what enforces this — it requires
> `["revenue"]` for every line and additionally requires
> `["cogs", "inventoryAsset"]` for inventory-tracked product lines.

**Repeat for every category × location pair** before issuing any
invoice or POS sale at a location.

---

## 5. Inventory products

1. **Inventory** (left sidebar, route `/inventory`).
2. Click **Add Product**.
3. Fill in name, SKU, price, etc. **The Category dropdown is
   required** — the form will not save without a category. There are
   **no GL account inputs on this form**; GL accounts are inherited
   from the category × location mapping you set in step 4b.
4. If this is a tracked-inventory item, set **Track Inventory = on**.
5. **Save.**
6. The product list shows a per-product QBO sync badge
   (Synced / Pending / Error) and a small green **cloud icon button**
   (tooltip: "Sync to QuickBooks") in the row's action column. Click
   the cloud to push the item to QBO immediately. (It also pushes
   automatically in the background after each save.)

**Effective GL display.** When you've selected a single location in the
location switcher, the product list shows the *effective* Revenue / COGS /
Inv. Asset that will post at that location, with an **"Edit on category"**
link that deep-links to **Settings → Categories** with the per-location
mapping modal already open (`?mappings=<categoryId>`).

If the effective slot is blank, you'll see an amber **"Not assigned"**
chip — clicking the deep-link is the fastest fix.

---

## 6. Rental products

Rental products (kayaks, paddleboards, courtesy vehicles, etc.) still
have their own per-(rental product, location) GL slots —
`RentalProductGlMapping` — separate from inventory categories.

1. **Settings → Products & Revenue** (route `/settings/products`).
2. In the **Rental Products** section, find the product and click the
   row to expand it.
3. For each location, set:
   - **Revenue**, **COGS**, **Inventory Asset** dropdowns.
4. Click **Save** per row.
5. Same QBO-strictness rule applies: a QBO-connected location requires
   the Revenue slot to be set (the product's location row shows
   "Unmapped" otherwise) and only shows location-scoped accounts.

The same page also holds:
- **Dockage Rates** — per-location, per-slip-type monthly/quarterly/annual
  rates with an optional **GL Account** for revenue. Falls back to the
  location's pinned **Default Revenue** when blank (non-QBO only — QBO
  locations require it explicitly).
- **Service Fees** — per-location flat or percent fees with the same
  optional GL account / fallback.

The page header also shows a **missing-mappings warning banner** with a
per-location count of catalog items that lack a usable mapping.

---

## 7. Tax-exempt customers

1. Open the customer's record (**Customers → (a customer)**) or the
   **New Customer** modal.
2. Toggle **Tax Exempt = on**.
3. Optionally set **Exemption Expiry** (a date). After this date the
   exemption is automatically ignored at calculation time and tax goes
   back to applying normally. Leave blank for "no expiry".
4. Save.

**Posting behavior.** When `taxExempt = true` and the exemption is in
effect (no expiry, or expiry in the future), `calculateTax()` returns
zero tax on every line for that customer regardless of jurisdiction.
Anonymous POS sales (no customer attached) cannot be tax-exempt — they
always pay the location's stack.

---

## 8. Daily posting flows — what lands where

Once steps 1–7 are done you can post. This section is a quick reference
for what shows up in the GL when a clerk does normal work.

### 8a. Invoice finalization (`POST /api/invoices/:id/finalize`)

Service: `apps/api/src/services/gl-posting.ts → postInvoice`.

| Side  | Account                                     | Amount                  |
| ----- | ------------------------------------------- | ----------------------- |
| DR    | A/R                                         | totalCents (incl. tax)  |
| CR    | Revenue (per-line, see precedence callout)  | extendedCents per line  |
| CR    | Deferred Revenue                            | extendedCents per line if `isDeferred` |
| CR    | Sales Tax Payable (per jurisdiction)        | per breakdown           |

If a product line has no `glAccountId` and the product has no
per-(category, location) mapping, the post throws
`MISSING_GL_MAPPING: Missing GL mapping for category "..." at location
"..."`. Fix it on **Settings → Categories → 📍 map-pin icon**.

### 8b. Payment received

| Side  | Account                                                    | Amount      |
| ----- | ---------------------------------------------------------- | ----------- |
| DR    | Cash / Undeposited Funds                                   | amountCents |
| CR    | A/R                                                        | amountCents |

Both accounts come from the location's pinned posting accounts (step 2)
or fall back to chart-by-number 1000/1010/1200.

### 8c. POS checkout (`/api/pos/...`)

Same shape as invoice + payment, but in one step. The product line's
revenue account is resolved by `resolveProductGlAccountsStrict` —
inventory-tracked items also debit COGS and credit Inventory Asset.

### 8d. Inventory receive (`PUT /api/inventory/purchase-orders/:id/receive`)

| Side | Account                                | Amount                  |
| ---- | -------------------------------------- | ----------------------- |
| DR   | Inventory Asset (per category, location) | qty × unit cost      |
| CR   | A/P (or pinned vendor account)         | bill total              |

If QBO-connected, also pushes a **Bill** to QBO with the same line
distribution.

### 8e. Inventory adjustment (`POST /api/inventory/adjustments`)

| Side | Account                                  | Amount                |
| ---- | ---------------------------------------- | --------------------- |
| DR   | COGS (shrinkage, write-off) **or** Inventory Asset (write-up) | qty × unit cost |
| CR   | The opposite leg                         | qty × unit cost       |

Adjustments with reason `received` or `sold` are skipped at posting
time — those have already been posted by the receive / invoice paths.

### 8f. Rental booking

Resolves through `resolveRentalProductGlAccounts` (the per-(rental
product, location) `RentalProductGlMapping` row), then posts like an
invoice line.

---

## 9. Multi-location specifics

A tenant can mix locations in any combination of QBO-connected and
stand-alone. The rules:

- **Each QBO-connected location has its own QBO company.** They are
  not shared. Disconnecting one does not affect the others.
- **The chart of accounts is location-scoped.** When you click "Sync
  now" at QuickBooks Setup, the imported `GlAccount` rows are tagged
  with that `locationId`. Tenant-wide rows (`locationId = null`) only
  exist for legacy / pre-multi-location tenants and for non-QBO
  locations.
- **Posting account numbers can collide across locations** (every
  location can have its own `1200 — Accounts Receivable`). The
  resolver always prefers the row scoped to the originating location.
- **A QBO-connected location refuses tenant-wide fallbacks.** If the
  location is missing its own A/R / Sales Tax / Default Revenue / etc.
  in its chart, posting fails — see the troubleshooting matrix.
- **Switching a location from non-QBO to QBO** (by completing the
  OAuth connect): from that point on, every category mapping that
  location uses must point to a row in the location's QBO chart, and
  every system posting account must be pinned (step 2). The migration
  doesn't move existing mappings — re-do the mappings before issuing
  the first invoice.

---

## 10. Troubleshooting matrix

The "Symptom" column shows the substring you can grep for in API logs or
user-visible error toasts — the runtime error strings interpolate
context (invoice ids, location ids, category names) on top of these.

| Symptom (substring of the error / banner)                                                                | Root cause                                                                                                              | Where to fix                                                                                                       |
| -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `MISSING_GL_MAPPING: Missing GL mapping for category "X" at location "Y"`                                | The `ProductCategoryGlMapping` row for (category X, location Y) is missing the slot the line needs (revenue / cogs / inventoryAsset). | **Settings → Categories** → 📍 map-pin on the row → set Revenue / COGS / Inv. Asset for location Y → **Save**.    |
| `UNCONFIGURED_GL_MAPPING: location ... is QBO-connected but has no A/R account pinned and no account number 1200 in its chart of accounts` | QBO-connected location, **Accounts Receivable** pin is empty, **and** the QBO chart has no 1200 row to fall back to. | **Settings → QuickBooks Setup → (location) → Posting Accounts → Accounts Receivable**.                            |
| `UNCONFIGURED_GL_MAPPING: location ... is QBO-connected but has no sales tax payable account pinned`     | Tax line fell through to the location's pinned slot and the slot is empty on a QBO-connected location.                  | **QuickBooks Setup → Posting Accounts → Sales Tax Payable (2400)**.                                                |
| `UNCONFIGURED_GL_MAPPING: location ... is QBO-connected but has no default revenue account pinned`       | An ad-hoc (non-product) invoice line posted at a QBO-connected location with no pinned default revenue.                 | **QuickBooks Setup → Posting Accounts → Default Revenue (4500)**, OR convert the line into a product with a per-(category, location) revenue mapping.              |
| `UNCONFIGURED_GL_MAPPING: location ... is QBO-connected but has no early termination income account pinned` | Contract early-termination posted with no pin and no chart row.                                                         | **QuickBooks Setup → Posting Accounts → Early Termination Income (4700)**.                                        |
| `UNCONFIGURED_GL_MAPPING: location ... is QBO-connected but has no ACH return fee revenue account pinned` | An ACH return fee was posted with no pin and no chart row.                                                              | **QuickBooks Setup → Posting Accounts → ACH Return Fee Revenue (4600)**.                                          |
| `UNCONFIGURED_GL_MAPPING: Invoice ... line ... has no revenue GL account and the originating location is connected to QuickBooks` | A QBO-connected location tried to post a non-product (ad-hoc) line with no GL account.                                  | Either pin **Default Revenue** (step 2), or convert the line to a product with a category mapping (step 4b).     |
| `UNCONFIGURED_GL_MAPPING: no <slot> account found for tenant ... (location=...)`                          | Non-QBO posting found neither a pin nor a typed chart row for the requested system slot at the location or tenant-wide. | Pin the slot in **QuickBooks Setup**, or add a row of the right type (REVENUE / LIABILITY) to the chart.          |
| `GL account <number> not found for tenant <id>`                                                          | Non-QBO posting tried to look up a well-known number (1200 / 1000 / etc.) and the tenant chart has no such row.         | Seed the chart row, or pin the equivalent slot in **QuickBooks Setup**.                                            |
| QBO sync badge on a product is **Error**                                                                  | The push to QBO failed (QBO category drifted, refresh token expired, etc.).                                              | Hover the badge to read the error → fix in QBO if needed → click the green **cloud icon** ("Sync to QuickBooks") on the product row to retry. |
| **"Not mapped"** amber chip on a category × location row                                                  | The `ProductCategoryGlMapping` row exists but a slot is null.                                                           | Set the slot in **Settings → Categories → 📍 map-pin → (location row)** → **Save**.                              |
| **"Not assigned"** amber chip on the Inventory list "Effective GL" column                                  | The product's category has no per-location mapping for the location currently selected in the location switcher.        | Click **"Edit on category →"** next to the chip — it deep-links to the right per-location mapping modal.          |
| Sales tax appears on a POS sale that should be exempt                                                     | Customer's `taxExempt` flag is off, or `exemptionExpiry` has passed, or the sale was anonymous (no customer attached).  | **Customers → (customer) → Tax Exempt = on**, set / clear **Exemption Expiry**. Anonymous sales cannot be exempt.  |
| Tax credits lump into one **Sales Tax Payable** line instead of splitting per jurisdiction                  | The `TaxRate` row(s) for the jurisdiction(s) have no **GL Account** set.                                                | **Sales Tax Rates → (jurisdiction) → (rate) → GL Account**.                                                       |
| Inventory adjustment posted to the wrong location's COGS                                                  | The product's category mapping at the originating location resolves to a different account than expected.              | **Settings → Categories → 📍 map-pin → (the originating location) → COGS**.                                       |
| `Re-sync interrupted by API restart` on a QBO inventory re-sync job                                       | The sweeper flipped a `running` job to `failed` after the API process restarted mid-run.                                | Re-trigger the re-sync from **Settings → QuickBooks Setup → Inventory Sync to QuickBooks → Retry all failed**.    |

---

## Appendix A — Per-location setup checklist

Print this, paste it into an onboarding ticket, or check it off as you
go. **Finish every box for one location and that location is postable.**

```
LOCATION: ____________________________________

QuickBooks (skip if not connecting this location)
[ ] Connect QuickBooks (Settings → QuickBooks Setup → location card)
[ ] Import / Refresh Chart of Accounts — chart populated
[ ] (Optional) Stripe Connect onboarded

Posting Accounts (Settings → QuickBooks Setup → Posting Accounts)
[ ] Accounts Receivable           pinned
[ ] Cash / Undeposited Funds      pinned
[ ] Deferred Revenue              pinned
[ ] Default Revenue (4500)        pinned
[ ] Sales Tax Payable (2400)      pinned
[ ] Early Termination Income      pinned (only if you charge ETF)
[ ] ACH Return Fee Revenue        pinned (only if you accept ACH)

Tax (Settings → Tax Rates and Settings → Locations)
[ ] All applicable jurisdictions created
[ ] Each jurisdiction has at least a `general`-category rate effective today
[ ] Each rate has a GL Account set (otherwise tax lumps into Sales Tax Payable)
[ ] This location has its jurisdiction stack configured in sortOrder

Categories (Settings → Categories → 📍 map-pin)
[ ] Every active category has Revenue mapped at this location
[ ] Every category whose products are inventory-tracked also has
    COGS and Inv. Asset mapped at this location
[ ] No row shows the amber "Not mapped" warning

Catalog (Settings → Products & Revenue)
[ ] Every active rental product has Revenue (and COGS / Inv. Asset
    when tracked) set for this location
[ ] Every active dockage rate has a GL Account (or you've pinned
    Default Revenue and the location is non-QBO)
[ ] Every active service fee has a GL Account (same caveat)

Smoke test
[ ] POS → New Sale → ring a tax-exempt customer (zero tax) and a
    normal customer (correct tax breakdown). Both finalize without
    a posting error.
[ ] Inventory → receive 1 unit of a tracked product (Inventory
    Asset debit lands).
[ ] Invoice → finalize a single-line invoice → A/R debit + Revenue
    credit + Sales Tax credit land in the right accounts.
```
