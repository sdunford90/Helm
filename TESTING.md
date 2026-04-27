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

This creates the **Bayshore Marina** tenant with:

- **3 locations:** Main Marina, North Dock, South Cove
- **6 staff users** (see roles below)
- Slips, customers, leads, contracts, invoices, waitlist entries, rentals, POS items, inventory, ramp tickets, and dock-walk records spread across all three locations
- 42 invoices (15 Main Marina / 15 South Cove / 12 North Dock)

Seeding is idempotent — re-running it wipes existing data and starts fresh.

### 1.3 Credentials status — everything is configured

All third-party service credentials are already set in Replit Secrets:

| Service | Secrets configured | Notes |
|---------|-------------------|-------|
| **Clerk** | `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`, `CLERK_WEBHOOK_SECRET`, `VITE_CLERK_PUBLISHABLE_KEY` | Sandbox/dev keys |
| **Stripe** | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET_PLATFORM`, `STRIPE_WEBHOOK_SECRET_CONNECT`, `VITE_STRIPE_PUBLISHABLE_KEY` | Sandbox keys |
| **Resend** | `RESEND_API_KEY` | Email delivery |
| **R2 Storage** | `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_ENDPOINT`, `R2_PUBLIC_URL` | File uploads |
| **QuickBooks** | `QBO_CLIENT_ID`, `QBO_CLIENT_SECRET`, `QBO_WEBHOOK_VERIFIER_TOKEN`, `QBO_REDIRECT_URI`, `QBO_ENVIRONMENT` | Sandbox |
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
- Clerk is still fully configured if you want to test real sign-in (see Section 5)

> **Important:** These flags must never be set in production. The API actively blocks the bypass when `NODE_ENV=production`.

### 1.5 In-app setup steps required before certain features work

Even though credentials are all in place, some features require completing a one-time setup flow inside the app itself:

| Feature | Setup step required |
|---------|-------------------|
| **Card payments / invoicing** | Settings → Stripe → Connect Stripe Account (completes Stripe Connect OAuth for the Bayshore Marina tenant) |
| **Card reader (POS)** | Settings → POS Settings → Readers → Register Reader (enter pairing code from a Stripe Terminal device or simulator) |
| **QuickBooks sync** | Settings → Integrations → QuickBooks → Connect (completes QBO OAuth — redirects to QBO sandbox, then returns) |
| **Email sending** | No setup needed — Resend key is live and emails send immediately |
| **File uploads** | No setup needed — R2 is configured and ready |

---

## 2. Seed Data Reference

### Tenant
- **Name:** Bayshore Marina
- **Subdomain:** `bayshore`

### Locations
| Location | Role in seed |
|----------|-------------|
| Main Marina | Primary location, bulk of data |
| North Dock | Secondary location |
| South Cove | Secondary location |

Switch between locations using the dropdown in the top-right of the nav bar.

### Staff Users
These users exist in the database. The dev bypass automatically signs you in as Sarah (MARINA_OWNER). To test with a different role, a real Clerk sign-in is required (see Section 5).

| Email | Role |
|-------|------|
| sarah@bayshoremarina.com | MARINA_OWNER |
| jake@bayshoremarina.com | MARINA_MANAGER |
| maria@bayshoremarina.com | DOCK_STAFF |
| tom@bayshoremarina.com | POS_CASHIER |
| lisa@bayshoremarina.com | ACCOUNTING |
| robert@bayshoremarina.com | DOCK_STAFF |

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
- [ ] Send a contract for e-signature — generates a signing link

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
- [ ] **Collect payment** — requires Stripe Connect setup for the tenant (Settings → Stripe first)

### Rentals
- [ ] Rental list loads with seeded records
- [ ] Open a rental detail
- [ ] Create a new rental

### POS
- [ ] POS grid loads with product tiles
- [ ] Add items to cart
- [ ] Complete a **cash sale** — no Stripe needed
- [ ] Complete a **card payment** — requires Stripe Connect setup + a registered reader
- [ ] Settings tab → Readers → register a reader via pairing code from a Stripe Terminal simulator

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
- [ ] **Stripe Connect** — click Connect, complete the Stripe OAuth flow (sandbox), confirm account appears connected
- [ ] **QuickBooks Online** — click Connect, complete QBO OAuth (sandbox), confirm sync status
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
| Card payment / invoicing | ⚙️ Stripe keys configured — needs Stripe Connect OAuth in Settings |
| Stripe Terminal card reader | ⚙️ Stripe configured — needs reader registration in POS Settings |
| QuickBooks sync | ⚙️ QBO keys configured — needs OAuth flow in Settings |
| Clerk real sign-in | ⚙️ Clerk configured — needs a Clerk user created (see Section 5) |

---

## 5. Testing with Real Clerk Sign-In (Optional)

The dev bypass handles authentication automatically for most testing. To test actual role-based access or Clerk-specific features:

1. Go to [dashboard.clerk.com](https://dashboard.clerk.com) → Users → Create User
2. Use the email `sarah@bayshoremarina.com` (or any seeded user email) and set a password
3. In Replit Secrets, remove or set `VITE_ENABLE_AUTH_DEV_BYPASS=false` and `ENABLE_AUTH_DEV_BYPASS=false`
4. Restart both workflows
5. Sign in at the app with that Clerk user — the API will match the Clerk ID to the seeded database user

To return to bypass mode, set both flags back to `true` and restart.

---

## 6. Known Issues

1. **Some Dashboard tiles may show "Loading..." or zeros** — certain dashboard stat endpoints are still being finalized. Core pages (Billing, Slips, Customers, Leads, Waitlist) all load correctly from seed data.

2. **Re-seed wipes everything** — running `pnpm --filter @helm/api run seed` again deletes all records created during a testing session. Do this intentionally only.

3. **Stripe Connect must be completed per tenant** — even with Stripe credentials configured, each marina tenant needs to connect their own Stripe account through the Settings UI before card payments or invoice collection will work.

---

## 7. Resetting to a Clean State

```bash
pnpm --filter @helm/api run seed
```

Then hard-refresh the browser. All pages will show fresh seed data.

---

## 8. Port Reference

| Service | Port | How to access |
|---------|------|--------------|
| Web app | 5000 | Preview pane (default) |
| API | 3001 | `/api/*` proxied through Vite — no direct access needed |
| Admin panel | 3003 | Use the Replit port switcher in the preview pane |
