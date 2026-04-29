# Helm — End-to-End Testing Guide

## Overview

Helm is a three-app monorepo:

| App | Command | Default Port | Purpose |
|-----|---------|-------------|---------|
| **Web** | `pnpm --filter @helm/web dev` | 5000 | Staff-facing marina management UI |
| **API** | `pnpm --filter @helm/api dev` | 3001 | Express/Prisma backend |
| **Admin** | `pnpm --filter @helm/admin dev` | 3003 | Platform admin panel |

All three are managed as Replit workflows and should be running before testing.

---

## 1. One-Time Setup

### 1.1 Confirm all three workflows are running

In the Replit sidebar, verify **API Server**, **Start application**, and **Admin App** all show a green running indicator.

### 1.2 Seed the database

Run this once (or any time you want a clean slate):

```bash
pnpm --filter @helm/api run seed
```

This creates the **Demo Marina** tenant (subdomain `demo`, `@demomarina.example`) with:

- **3 locations:** Main Marina, North Dock, South Cove
- **6 staff users** (see roles below)
- Slips, customers, leads, contracts, invoices, waitlist entries, rentals, POS items, inventory, ramp tickets, and dock-walk records spread across all three locations
- 42 invoices (15 Main Marina / 15 South Cove / 12 North Dock)
- A platform admin user (default `admin@helm.local`, `PLATFORM_ADMIN` + `SUPERUSER`) for the admin panel — see Section 1.6

Seeding is idempotent — re-running it wipes existing data and starts fresh
(the `platform_settings` singleton row is preserved so configured fees/flags survive re-seeds).

### 1.2.1 Production seed (one-time prod bootstrap)

For a fresh production database, use:

```bash
pnpm db:seed:prod
```

This runs `prisma migrate deploy` followed by the seed. The seed includes a
production-safe guard:

- If `NODE_ENV=production` and the DB already has tenants or users, the seed
  refuses to run unless you also set `HELM_PROD_SEED_CONFIRM=yes`. This
  prevents accidentally wiping a live database.
- An empty production DB seeds without confirmation so the very first deploy
  can bootstrap itself.

The platform admin user is configurable via env vars:

| Variable | Default | Notes |
|----------|---------|-------|
| `HELM_PLATFORM_ADMIN_EMAIL` | `admin@helm.local` | Used as the user's email |
| `HELM_PLATFORM_ADMIN_FIRST_NAME` | `Platform` | |
| `HELM_PLATFORM_ADMIN_LAST_NAME` | `Admin` | |
| `HELM_PLATFORM_ADMIN_CLERK_ID` | _(none)_ | Set this to the Clerk user ID so the prod admin can sign in via Clerk |

The admin user is **upserted** by email — re-running the seed will not create
duplicates and will pick up Clerk-ID changes from env.

### 1.6 Signing in to the Admin Panel

The admin SPA runs at port **3003** (`Admin App` workflow).

**Development (auth bypass on):** the API automatically authenticates the
seeded platform admin. Just open the admin URL — no sign-in required.

**Production:** Clerk is required. Steps:

1. Create the admin user in Clerk (or have the user sign up).
2. Copy their Clerk user ID from the Clerk dashboard.
3. Set `HELM_PLATFORM_ADMIN_CLERK_ID=<clerk_user_id>` and re-run
   `pnpm db:seed:prod` (idempotent — only updates the existing admin row).
4. The admin can now sign in at `admin.<your-domain>` with their Clerk
   credentials. The API checks that `user.role === 'PLATFORM_ADMIN'` before
   serving any `/api/admin/*` route, then enforces sub-roles
   (`SUPERUSER` / `BILLING_ADMIN` / `READ_ONLY_SUPPORT`) on mutating routes.

### 1.3 Credentials status — everything is configured

All third-party service credentials are already set in Replit Secrets:

| Service | Secrets configured | Notes |
|---------|-------------------|-------|
| **Clerk** | `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`, `CLERK_WEBHOOK_SECRET`, `VITE_CLERK_PUBLISHABLE_KEY` | Dev keys |
| **Stripe** | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET_PLATFORM`, `STRIPE_WEBHOOK_SECRET_CONNECT`, `VITE_STRIPE_PUBLISHABLE_KEY` | Sandbox keys |
| **Resend** | `RESEND_API_KEY` | Email delivery |
| **R2 Storage** | `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_ENDPOINT`, `R2_PUBLIC_URL` | File uploads |
| **QuickBooks** | `QBO_CLIENT_ID`, `QBO_CLIENT_SECRET`, `QBO_WEBHOOK_VERIFIER_TOKEN` | Sandbox — see Section 6 for OAuth setup |
| **Redis** | `REDIS_URL`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Queue/cache |

No credentials need to be added before testing.

### 1.4 Dev auth bypass (no Clerk sign-in needed)

The following are already set in the **development** environment:

```
ENABLE_AUTH_DEV_BYPASS=true
VITE_ENABLE_AUTH_DEV_BYPASS=true
NODE_ENV=development
```

With these set:
- The **API** skips Clerk token verification and automatically uses the first seeded user (Sarah Dunford, `MARINA_OWNER`)
- The **frontend** skips the Clerk sign-in redirect — the app loads directly without logging in
- Clerk is still fully configured if you want to test real sign-in (see Section 7)

> **Important:** These flags must never be set in production. The API actively blocks the bypass when `NODE_ENV=production`.

### 1.5 In-app setup steps required before certain features work

Even though credentials are all in place, some features require completing a one-time setup flow inside the app:

| Feature | Setup step required |
|---------|-------------------|
| **Card payments / invoicing** | Settings → Stripe → Connect Stripe Account (Stripe Connect OAuth for the Demo Marina tenant) |
| **Card reader (POS)** | Settings → POS Settings → Readers → Register Reader (enter pairing code from a Stripe Terminal device or simulator) |
| **QuickBooks sync** | Full setup in Section 6 — requires the Intuit developer portal redirect URI step before the in-app connect |
| **Email sending** | No setup needed — Resend is live |
| **File uploads** | No setup needed — R2 is configured |

---

## 2. Seed Data Reference

### Tenant
- **Name:** Demo Marina
- **Subdomain:** `demo`

### Locations
| Location | Role in seed |
|----------|-------------|
| Main Marina | Primary location, bulk of data |
| North Dock | Secondary location |
| South Cove | Secondary location |

Switch between locations using the dropdown in the top-right of the nav bar.

### Staff Users
The dev bypass automatically signs you in as Sarah (MARINA_OWNER). To test role-based access, see Section 7.

| Email | Role |
|-------|------|
| sarah@demomarina.example | MARINA_OWNER |
| jake@demomarina.example | MARINA_MANAGER |
| maria@demomarina.example | DOCK_STAFF |
| tom@demomarina.example | POS_CASHIER |
| lisa@demomarina.example | ACCOUNTING |
| robert@demomarina.example | DOCK_STAFF |

---

## 3. Feature Testing Checklist

Work through each page in the left navigation. For each one: load the page, verify data appears, and exercise the primary actions.

### Dashboard
- [ ] All stat tiles load without staying in "Loading..." state
- [ ] Occupancy Rate, Monthly Revenue, Outstanding A/R show numbers
- [ ] Revenue chart renders
- [ ] Location switcher (top-right) changes the data shown

### Slips
- [ ] Slip list loads — check for records across Dock A, B, C
- [ ] Filter by status (Available, Occupied, Reserved, etc.)
- [ ] Click a slip to open the detail panel
- [ ] **Add Slip** modal: enter slip number (e.g. `D-01`) + length (e.g. `35`) → Save → slip appears in list
- [ ] **Edit** an existing slip — change status or dimensions → confirm save
- [ ] **Generate QR code** on a slip detail

### Contracts
- [ ] Contract list loads with seeded agreements
- [ ] Open a contract to view line items, dates, and status
- [ ] Filter by status (Active, Pending, Expired)

### Dock Walks
- [ ] Dock walk list loads with recent entries
- [ ] Create a new dock walk record
- [ ] Mark items on the checklist

### Transient
- [ ] Transient reservations list loads
- [ ] Create a new reservation with a date range
- [ ] Check in / check out a reservation

### Launch Ramp
- [ ] Ramp ticket list loads
- [ ] Create a new ramp ticket
- [ ] Mark a ticket as complete

### Concierge
- [ ] Concierge request list loads
- [ ] Create a new request
- [ ] Update request status

### Billing
- [ ] Invoice list loads (42 invoices seeded)
- [ ] Open an invoice to see line items and payment status
- [ ] Filter by status (Draft, Sent, Paid, Overdue)
- [ ] **Send invoice email** — Resend is configured, email should deliver
- [ ] **Collect payment** — requires Stripe Connect setup (Settings → Stripe first)

### Rentals
- [ ] Rental list loads with seeded records
- [ ] Open a rental detail
- [ ] Create a new rental

### POS
- [ ] POS grid loads with product tiles
- [ ] Add items to cart
- [ ] Complete a **cash sale** — works with no external setup
- [ ] Complete a **card payment** — requires Stripe Connect + reader registration
- [ ] Settings tab → Readers → register a reader via a Stripe Terminal pairing code

### Fuel
- [ ] Fuel log loads
- [ ] Record a fuel transaction

### Inventory
- [ ] Inventory item list loads
- [ ] Update stock level on an item
- [ ] Create a new inventory item

### Leads
- [ ] Lead pipeline loads in Kanban view
- [ ] Drag a lead between stages
- [ ] Create a new lead
- [ ] Open a lead detail and add a note

### Customers
- [ ] Customer list loads with seeded contacts
- [ ] Open a customer detail — verify boats, active contracts, invoices, and balance all show values
- [ ] Search by name

### Waitlist
- [ ] Waitlist table loads with seeded entries
- [ ] Filter by slip type and status
- [ ] **Add to Waitlist**: enter first name + last name (required) → slip type + boat length (optional) → Save → entry appears in list
- [ ] Notify / Accept / Remove an entry

### Reports
- [ ] Revenue report loads
- [ ] Change date range — chart updates
- [ ] Sales Tax report loads

### Settings
- [ ] General settings page loads and saves
- [ ] **Stripe Connect** — complete in-app OAuth (see service status table)
- [ ] **QuickBooks Online** — complete full setup in Section 6 first
- [ ] Tax rates page loads and allows adding a rate

### Announcements
- [ ] Announcements list loads
- [ ] Create and publish an announcement

### Audit Log
- [ ] Audit log loads with recent activity entries reflecting actions taken during testing

---

## 4. Service Status at a Glance

| Feature | Status |
|---------|--------|
| Browse all pages | ✅ Works — no setup needed |
| Read / create / edit data | ✅ Works — no setup needed |
| Cash POS sale | ✅ Works — no setup needed |
| Email sending (invoices, contracts) | ✅ Resend configured — sends immediately |
| File uploads (insurance docs, attachments) | ✅ R2 configured — uploads work |
| Card payment / invoicing | ⚙️ Stripe keys set — complete Stripe Connect OAuth in Settings |
| Stripe Terminal card reader | ⚙️ Stripe configured — register a reader in POS Settings |
| QuickBooks sync | ⚙️ QBO keys set — complete full sandbox setup in Section 6 |
| Clerk real sign-in | ⚙️ Clerk configured — follow Section 7 to create a Clerk user |

---

## 5. Known Issues

1. **Some Dashboard tiles may show "Loading..." or zeros** — certain dashboard stat endpoints are still being finalized. Core pages (Billing, Slips, Customers, Leads, Waitlist) all load correctly from seed data.

2. **Re-seed wipes everything** — running `pnpm --filter @helm/api run seed` again deletes all records created during a testing session. Do this only intentionally.

3. **Stripe Connect must be completed per tenant** — even with sandbox keys configured, each marina tenant needs to connect their own Stripe account through the Settings UI before card payments or invoice collection will work.

---

## 6. QuickBooks Online Sandbox — Full Setup & OAuth Test

### 6.1 One-time developer portal setup

This only needs to be done once. If the app has already been registered and the redirect URI added, skip to 6.2.

**Step 1 — Sign in to the Intuit developer portal**
1. Go to [developer.intuit.com](https://developer.intuit.com)
2. Sign in with the Intuit account that owns the `QBO_CLIENT_ID` and `QBO_CLIENT_SECRET` in Replit Secrets

**Step 2 — Find your app**
1. Click **My Apps** in the top nav
2. Select the app whose Client ID matches `QBO_CLIENT_ID` in Replit Secrets

**Step 3 — Add the Replit dev callback URL as a redirect URI**
1. In the app, go to **Keys & credentials** → **Redirect URIs** (or **OAuth 2.0** → **Redirect URIs** depending on the portal version)
2. Click **Add URI**
3. Enter exactly:
   ```
   https://92c279c8-1036-4e43-940c-5e8c174d6713-00-gp3i4v467s4h.spock.replit.dev/api/qbo/callback
   ```
4. Save

> **Why this matters:** Intuit rejects any OAuth redirect that isn't explicitly registered. The callback URL must match what the app sends character-for-character.

**Step 4 — Confirm a sandbox company exists**
1. Go to [developer.intuit.com](https://developer.intuit.com) → **Sandbox** → **Companies**
2. You should see a default sandbox company (e.g. "Sandbox Company_US_1"). If not, click **Add** to create one
3. Note the company name — this is the QBO account the marina will connect to

### 6.2 Running the OAuth flow in the app

These steps test the end-to-end QBO connect from the UI.

1. Open the Helm web app in the browser (port 5000 preview)
2. Navigate to **Settings** in the left sidebar
3. Find the **QuickBooks Online** section and click **Connect**
4. The app calls the API, which builds a signed OAuth URL and returns it
5. The browser redirects to Intuit's authorization page
6. Sign in with the **same Intuit account** that owns the sandbox app (from Step 1 above)
7. Select your **sandbox company** from the list
8. Click **Connect** to authorize
9. Intuit redirects back to the Replit dev callback URL:
   ```
   https://[replit-dev]/api/qbo/callback
   ```
10. The callback exchanges the authorization code for access tokens, stores them against the tenant, and kicks off an initial sync
11. The browser returns a JSON response — `{ "success": true, "message": "QuickBooks Online connected successfully..." }`
12. Go back to Settings → QuickBooks — the status should now show **Connected** with the realm ID and connection timestamp

### 6.3 Verifying the sync

After connecting:

- [ ] Settings → QuickBooks shows **Connected** status
- [ ] Click **Sync Now** — confirm the API returns a sync result with counts
- [ ] Navigate to **Customers** — seeded customers should now have QBO IDs
- [ ] Navigate to **Billing** → open an invoice → confirm the **Sync to QBO** button is available
- [ ] Click **Sync to QBO** on an invoice — verify it appears in the QBO sandbox company under Sales → Invoices at [app.qbo.intuit.com/app/invoices](https://app.qbo.intuit.com/app/invoices)

### 6.4 Disconnecting

To test disconnect:
1. Settings → QuickBooks → **Disconnect**
2. Confirm the status reverts to **Not Connected**
3. QBO tokens are cleared from the database
4. Sync buttons on invoices and customers should disappear or be disabled

---

## 7. Testing with Real Clerk Sign-In (Optional)

The dev bypass handles authentication automatically for most testing. To test role-based access or Clerk-specific features:

1. Go to [dashboard.clerk.com](https://dashboard.clerk.com) → Users → Create User
2. Use the email `sarah@demomarina.example` and set a password
3. In Replit Secrets, set `VITE_ENABLE_AUTH_DEV_BYPASS` and `ENABLE_AUTH_DEV_BYPASS` both to `false` (or delete them from the development env)
4. Restart both the **API Server** and **Start application** workflows
5. Sign in at the app with those Clerk credentials — the API matches the Clerk ID to Sarah's seeded database record

To return to bypass mode: set both flags back to `true` and restart.

---

## 8. Resetting to a Clean State

```bash
pnpm --filter @helm/api run seed
```

Then hard-refresh the browser. All pages will show fresh seed data. Note this clears any QBO connection tokens — you'll need to re-run the OAuth flow in Section 6.2 after a re-seed.

---

## 9. Port Reference

| Service | Port | How to access |
|---------|------|--------------|
| Web app | 5000 | Preview pane (default) |
| API | 3001 | `/api/*` proxied through Vite — no direct access needed |
| Admin panel | 3003 | Use the Replit port switcher in the preview pane |
