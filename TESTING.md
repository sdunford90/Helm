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

### 1.3 Verify required environment variables are set

Check the Replit Secrets panel. These must be present:

**Always required (API won't start without them):**
| Secret | Purpose |
|--------|---------|
| `CLERK_SECRET_KEY` | Clerk backend SDK — also used as fallback signing key |
| `DATABASE_URL` | PostgreSQL connection (auto-managed by Replit) |
| `REDIS_URL` | Session / queue store |

**Required for full feature testing:**
| Secret | Feature |
|--------|---------|
| `STRIPE_SECRET_KEY` | Payments, POS terminal, invoicing |
| `STRIPE_WEBHOOK_SECRET_PLATFORM` | Platform webhook verification |
| `STRIPE_WEBHOOK_SECRET_CONNECT` | Connect webhook verification |
| `VITE_STRIPE_PUBLISHABLE_KEY` | Stripe Elements in the browser |
| `RESEND_API_KEY` | Sending invoice/contract emails |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_BUCKET` / `R2_ENDPOINT` / `R2_PUBLIC_URL` | File storage (insurance docs, attachments) |
| `QBO_CLIENT_ID` / `QBO_CLIENT_SECRET` / `QBO_WEBHOOK_VERIFIER_TOKEN` | QuickBooks Online integration |

**Frontend env vars (set in Replit Secrets as VITE_ prefixed):**
| Variable | Value needed |
|----------|-------------|
| `VITE_CLERK_PUBLISHABLE_KEY` | Your Clerk publishable key |
| `VITE_STRIPE_PUBLISHABLE_KEY` | Your Stripe publishable key |

### 1.4 Dev auth bypass (no Clerk account needed)

The following env vars are already set in the **development** environment:

```
ENABLE_AUTH_DEV_BYPASS=true
VITE_ENABLE_AUTH_DEV_BYPASS=true
NODE_ENV=development
```

With these set:
- The **API** skips Clerk token verification and automatically uses the first seeded user (Sarah Dunford, `MARINA_OWNER` role)
- The **frontend** skips the Clerk sign-in redirect and loads the app directly
- No Clerk user account or sign-in is required to navigate the UI

> **Important:** These flags must never be set in production. The API actively blocks the bypass when `NODE_ENV=production`.

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

### Staff Users (seeded but not linked to Clerk accounts in dev bypass mode)
| Email | Role | Notes |
|-------|------|-------|
| sarah@bayshoremarina.com | MARINA_OWNER | Active user in dev bypass |
| jake@bayshoremarina.com | MARINA_MANAGER | |
| maria@bayshoremarina.com | DOCK_STAFF | |
| tom@bayshoremarina.com | POS_CASHIER | |
| lisa@bayshoremarina.com | ACCOUNTING | |
| robert@bayshoremarina.com | DOCK_STAFF | |

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
- [ ] **Send invoice** — requires `RESEND_API_KEY` to deliver email
- [ ] **Collect payment** — requires Stripe credentials

### Rentals
- [ ] Rental list loads with seeded records
- [ ] Open a rental detail
- [ ] Create a new rental

### POS
- [ ] POS grid loads with product tiles
- [ ] Add items to cart
- [ ] Complete a cash sale
- [ ] **Card payment** — requires Stripe Terminal reader (pairing code from Settings → POS Settings → Readers)
- [ ] Settings tab: register a reader via pairing code

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
- [ ] **Add to Waitlist**: enter first name + last name (required) → slip type + boat length (optional) → Save → entry appears
- [ ] Notify / Accept / Remove an entry

### Reports
- [ ] Revenue report loads
- [ ] Change date range — chart updates
- [ ] Sales Tax report loads

### Settings
- [ ] General settings page loads and saves
- [ ] **Stripe Connect** — connect a Stripe account (requires live Stripe credentials)
- [ ] **QuickBooks Online** — OAuth connect flow (requires QBO credentials)
- [ ] Tax rates page loads

### Announcements
- [ ] Announcements list loads
- [ ] Create and publish an announcement

### Audit Log
- [ ] Audit log loads with recent activity entries

---

## 4. External Services — What Works Without Live Credentials

| Feature | Works in dev bypass? | Needs live credentials |
|---------|---------------------|----------------------|
| Browse all pages | ✅ Yes | — |
| Read seed data | ✅ Yes | — |
| Create/edit records | ✅ Yes | — |
| Cash POS sale | ✅ Yes | — |
| Card payment (POS / invoices) | ❌ No | Stripe secret + publishable key |
| Card reader terminal | ❌ No | Stripe Terminal + physical reader |
| Send email (invoices, contracts) | ❌ No | Resend API key |
| File uploads (insurance docs) | ❌ No | R2 storage credentials |
| QuickBooks sync | ❌ No | QBO OAuth credentials |
| Clerk user management | ❌ No | Clerk secret + publishable key |

---

## 5. Known Dev Limitations

1. **Dashboard tiles may stay at "Loading..." or show zeros** — some dashboard stat endpoints are in progress. Data-heavy pages like Billing, Customers, and Slips load correctly from seed.

2. **Clerk user account not linked** — the dev bypass uses the first seeded DB user (Sarah Dunford) automatically. If you remove `ENABLE_AUTH_DEV_BYPASS=true`, you must create a matching Clerk user at [dashboard.clerk.com](https://dashboard.clerk.com) with the email `sarah@bayshoremarina.com` and add her to the tenant.

3. **Stripe elements will not render** without `VITE_STRIPE_PUBLISHABLE_KEY` — the invoice payment button and POS card flow will fail silently or show an error.

4. **Re-seed resets all data** — running `pnpm --filter @helm/api run seed` again wipes everything created during testing.

---

## 6. Resetting to a Clean State

```bash
# From the project root
pnpm --filter @helm/api run seed
```

Then hard-refresh the browser. All pages will show fresh seed data.

---

## 7. Port Reference

| Service | Port | Direct URL |
|---------|------|-----------|
| Web app | 5000 | Preview pane default |
| API | 3001 | `/api/*` proxied through Vite |
| Admin panel | 3003 | Use Replit port switcher |

The web app Vite dev server proxies all `/api/` requests to `localhost:3001` automatically, so you never need to point the browser at the API directly.
