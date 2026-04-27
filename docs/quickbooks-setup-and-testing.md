# QuickBooks Online — Setup & Testing Guide

> Last updated: April 2026  
> Environment: Replit dev (API on port 3001) + Sandbox QBO account

---

## Current State

### What's implemented
- Full OAuth 2.0 flow: authorize → callback → token storage on `Tenant` record
- Token auto-refresh before every API call
- Bidirectional sync service (`apps/api/src/services/qbo-sync.ts`, ~845 lines):
  - **Customers** → QBO Customers (`qboCustomerId` on `Customer`)
  - **Invoices** → QBO Invoices (`qboInvoiceId` on `Invoice`)
  - **Payments** → QBO Payments (`qboPaymentId` on `Payment`)
  - **GL accounts** → QBO Accounts (`qboAccountId` on `GlAccount`)
  - **Inventory items** → QBO Items (`qboItemId` on `Product`/`InventoryItem`)
  - **Deferred revenue** → QBO Journal Entries (`qboLiabilityEntryId`)
- Webhook receiver at `POST /api/qbo/webhook` with HMAC-SHA256 signature verification
- Audit log entries for every QBO action
- Routes at `apps/api/src/routes/qbo.ts` (all require `admin` or `manager` role)

### What's NOT yet wired up
- The Settings page (`/settings`) has **placeholder** QBO buttons — "Sync Now" and "Disconnect" are mock/UI-only. They do not call the real API yet.
- The **Connect to QuickBooks** button on the Settings page is not yet present; the OAuth flow must currently be triggered manually (see testing steps below).
- `QBO_REDIRECT_URI` and `QBO_ENVIRONMENT` are **not yet set** as Replit secrets — add them before testing.

---

## Environment Variables Required

Five QBO-related env vars are needed. Three are already set as Replit secrets:

| Variable | Status | Value / Notes |
|---|---|---|
| `QBO_CLIENT_ID` | ✅ Set | From Intuit Developer app |
| `QBO_CLIENT_SECRET` | ✅ Set | From Intuit Developer app |
| `QBO_WEBHOOK_VERIFIER_TOKEN` | ✅ Set | From Intuit Developer webhooks page |
| `QBO_REDIRECT_URI` | ❌ **Not set** | See redirect URI section below |
| `QBO_ENVIRONMENT` | ❌ **Not set** | Set to `sandbox` for testing, `production` for live |

### Setting the missing variables

In the Replit Secrets panel, add:

```
QBO_ENVIRONMENT = sandbox
QBO_REDIRECT_URI = https://92c279c8-1036-4e43-940c-5e8c174d6713-00-gp3i4v467s4h.spock.replit.dev/api/qbo/callback
```

> **Important:** The Replit dev domain URL changes when the Repl restarts. For stable testing, use the **deployed** (published) app URL instead:  
> `https://<your-app>.replit.app/api/qbo/callback`  
> You must register whichever URL you use in the Intuit Developer app (see below).

---

## Intuit Developer App Setup (Sandbox)

### Step 1 — Create / configure your app

1. Go to [https://developer.intuit.com](https://developer.intuit.com) and sign in.
2. Click **My Apps** → select your app (or create one).
3. In the app dashboard, go to **Keys & OAuth** → **Sandbox** tab.
4. Copy the **Client ID** and **Client Secret** — confirm they match `QBO_CLIENT_ID` / `QBO_CLIENT_SECRET` in Replit.

### Step 2 — Register the redirect URI

1. Still on the **Keys & OAuth** page, find **Redirect URIs**.
2. Add the URI exactly as set in `QBO_REDIRECT_URI`:
   ```
   https://92c279c8-1036-4e43-940c-5e8c174d6713-00-gp3i4v467s4h.spock.replit.dev/api/qbo/callback
   ```
3. Save. QBO will reject any callback to an unregistered URI.

### Step 3 — Scopes

The OAuth flow in `getAuthorizationUrl()` requests:
- `com.intuit.quickbooks.accounting` — full accounting read/write
- `openid`, `profile`, `email` — for identity

No changes needed here unless you want to restrict scope.

### Step 4 — Webhook endpoint (optional for initial testing)

1. In your Intuit app, go to **Webhooks**.
2. Add endpoint:
   ```
   https://<your-deployed-domain>/api/qbo/webhook
   ```
   (Webhooks require a public HTTPS URL — the Replit dev domain works but must remain stable.)
3. Copy the **Verifier Token** — confirm it matches `QBO_WEBHOOK_VERIFIER_TOKEN`.
4. Select events: `Customer`, `Invoice`, `Payment` at minimum.

---

## Testing the OAuth Flow (Manual Steps)

Since the Settings page buttons are not yet wired up, trigger the flow via the API directly:

### Step 1 — Get the authorization URL

```bash
curl -X GET \
  "https://92c279c8-1036-4e43-940c-5e8c174d6713-00-gp3i4v467s4h.spock.replit.dev/api/qbo/authorize" \
  -H "Authorization: Bearer <clerk-session-token>" \
  -H "x-tenant-id: <tenant-id>"
```

Response:
```json
{ "url": "https://appcenter.intuit.com/connect/oauth2?..." }
```

### Step 2 — Open the URL in your browser

Paste the returned URL into a browser. You'll be taken to the Intuit login → choose your **sandbox company** → authorize.

After authorizing, Intuit redirects to `QBO_REDIRECT_URI`. The API's `/callback` handler:
1. Verifies the HMAC-signed `state` parameter (CSRF protection)
2. Exchanges the auth code for access + refresh tokens
3. Stores tokens on the `Tenant` record in the database
4. Kicks off an initial sync of all customers, invoices, and GL accounts

### Step 3 — Confirm connection

```bash
curl "https://.../api/qbo/status" \
  -H "Authorization: Bearer <token>" \
  -H "x-tenant-id: <tenant-id>"
```

Expected:
```json
{
  "connected": true,
  "realmId": "...",
  "connectedAt": "2026-04-27T...",
  "lastSyncAt": "..."
}
```

---

## Testing Sync

### Full sync (all records)

```bash
curl -X POST "https://.../api/qbo/sync" \
  -H "Authorization: Bearer <token>" \
  -H "x-tenant-id: <tenant-id>"
```

Response includes `synced` count and any `failed` records.

### Sync a single customer

```bash
curl -X POST "https://.../api/qbo/sync/customer/<customer-id>" \
  -H "Authorization: Bearer <token>" \
  -H "x-tenant-id: <tenant-id>"
```

### Sync a single invoice

```bash
curl -X POST "https://.../api/qbo/sync/invoice/<invoice-id>" \
  -H "Authorization: Bearer <token>" \
  -H "x-tenant-id: <tenant-id>"
```

### Verify in QBO Sandbox

1. Log into [https://qbo.intuit.com/app/homepage](https://qbo.intuit.com/app/homepage) — select your sandbox company.
2. Navigate to **Sales → Customers** — seeded customers should appear.
3. Navigate to **Sales → Invoices** — seeded invoices should appear.
4. Navigate to **Accounting → Chart of Accounts** — seeded GL accounts should appear.

---

## Checking Sync Results in the Database

After a sync, QBO IDs are written back to the relevant records. Verify with psql or the admin panel:

```sql
-- Customers that have been synced to QBO
SELECT id, name, "qboCustomerId" FROM "Customer"
WHERE "qboCustomerId" IS NOT NULL;

-- Invoices synced to QBO
SELECT id, "invoiceNumber", "qboInvoiceId" FROM "Invoice"
WHERE "qboInvoiceId" IS NOT NULL;

-- GL Accounts synced
SELECT id, name, "qboAccountId" FROM "GlAccount"
WHERE "qboAccountId" IS NOT NULL;
```

---

## Testing Checklist

### Prerequisites
- [ ] `QBO_REDIRECT_URI` secret added in Replit
- [ ] `QBO_ENVIRONMENT=sandbox` secret added in Replit
- [ ] Redirect URI registered in Intuit Developer app
- [ ] API Server workflow is running (restart after adding secrets)
- [ ] Database is seeded (`cd apps/api && npx prisma db seed`)
- [ ] You have a Clerk session token for an `admin` or `manager` user

### OAuth Flow
- [ ] `GET /api/qbo/authorize` returns a valid Intuit URL
- [ ] Browser redirect completes without error
- [ ] `GET /api/qbo/status` returns `connected: true`
- [ ] Tenant record in DB has `qboAccessToken`, `qboRefreshToken`, `qboRealmId` populated

### Sync
- [ ] `POST /api/qbo/sync` completes with `synced > 0`
- [ ] Customer records in DB have `qboCustomerId` populated
- [ ] Invoice records in DB have `qboInvoiceId` populated
- [ ] GL account records in DB have `qboAccountId` populated
- [ ] Synced records visible in QBO sandbox company

### Webhook (optional)
- [ ] Test event from Intuit Developer dashboard arrives at `/api/qbo/webhook`
- [ ] API returns `200 { success: true }`
- [ ] Audit log entry created for the webhook event

### Disconnect
- [ ] `POST /api/qbo/disconnect` clears tokens from Tenant record
- [ ] `GET /api/qbo/status` returns `connected: false` after disconnect

---

## What to Build Next (Settings UI)

The Settings page currently has mock QBO buttons. To wire them up:

1. **Connect button** — call `GET /api/qbo/authorize`, open the returned URL in a new tab.
2. **Sync Now button** — call `POST /api/qbo/sync`, show progress/result toast.
3. **Disconnect button** — call `POST /api/qbo/disconnect`, update connection status display.
4. **Status display** — call `GET /api/qbo/status` on page load, show connected company name + last sync time.

---

## Seed Data Reference

The database is seeded with real (non-mock) data for Bayshore Marina:

| Entity | Count |
|---|---|
| Customers | 15 |
| Invoices | 42 |
| Payments | 33 |
| GL Accounts | 25 |
| Boats | 14 |
| Slips | 20 |
| Contracts | 14 |
| Dock Walks | 8 |
| Leads | 12 |
| Waitlist entries | 5 |

Re-run the seed anytime with:
```bash
cd apps/api && npx prisma db seed
```

The seed is idempotent — it uses `upsert` throughout and will not create duplicates.
