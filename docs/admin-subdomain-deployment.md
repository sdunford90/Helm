# Serving the Admin Portal at admin.tracktheturn.com

The platform admin SPA (`apps/admin`) ships as a separate bundle from the
main marina app (`apps/web`). Both build into their own `dist/` and are
served at different hosts by a single Node frontend server.

## Hosting strategy

We use **option (b) from task #158** — one process serves both bundles
and routes by `Host` header. This keeps the deployment surface area small
(one image, one container, one set of TLS certs) and the only operational
diff per host is which `index.html` and asset directory we serve from.

| Host                                     | Bundle                          |
| ---------------------------------------- | ------------------------------- |
| `admin.tracktheturn.com`, `admin.*`      | `apps/admin/dist`               |
| everything else (`app.tracktheturn.com`, tenant subdomains, preview URLs) | `apps/web/dist` |

The frontend server (`apps/frontend-server/server.js`) also reverse-proxies
`/api/*` to `API_PROXY_TARGET` (env var, defaults to `http://localhost:3001`),
so the admin SPA's same-origin `fetch('/api/admin/...')` calls keep working
without any CORS preflight.

The build is wired in two places — pick whichever matches your production
infra:

### A) Replit autoscale deployment (default)

`.replit` `[deployment]`:

```toml
deploymentTarget = "autoscale"
build = ["bash", "-c", "pnpm install --frozen-lockfile && pnpm --filter @helm/shared-types build && pnpm --filter @helm/ui-kit build && pnpm --filter @helm/web build && pnpm --filter @helm/admin build"]
run  = ["node", "apps/frontend-server/server.js"]
```

A single Replit autoscale deployment hosts both bundles. Attach
`app.tracktheturn.com` **and** `admin.tracktheturn.com` to the same
deployment in Replit's custom-domain UI; the server picks the right bundle
by `Host`.

Set the `API_PROXY_TARGET` env var on the production deployment to the URL
of the API service (e.g. `https://api.tracktheturn.com` if the API is its
own deployment, or leave unset if the API runs as `localhost:3001` inside
the same container).

### B) Self-hosted Docker / Nginx

`Dockerfile.web` builds both `apps/web` and `apps/admin` and copies them
into per-app subdirectories under `/usr/share/nginx/html`. `nginx.conf`
has two `server` blocks selected by `Host` (`admin.*` → admin bundle,
default `_` → web bundle). Both proxy `/api/*` to the API container at
`http://api:3001`. Use this path if you're running the project under
`docker-compose` instead of Replit.

Both paths produce the same observable behavior; the autoscale path is
what `.replit` is configured for now.

## DNS setup

`admin.tracktheturn.com` should be created at the domain registrar (or
wherever DNS for `tracktheturn.com` is hosted) as either:

- **CNAME** → the same hostname your existing `app.tracktheturn.com` record
  points at (the production frontend server / load balancer), **or**
- **A/AAAA** → the same IPs as `app.tracktheturn.com`.

Once DNS resolves and the custom domain is bound to the autoscale
deployment in Replit's UI, the frontend server picks the right bundle by
`Host` header — no extra config per host is required.

## Clerk dashboard checklist

The admin SPA uses the same Clerk instance as the marina app
(`VITE_CLERK_PUBLISHABLE_KEY`). After DNS is live, in the Clerk dashboard:

1. Add `https://admin.tracktheturn.com` to **Domains → Allowed origins**.
2. Add it to **Paths → Sign-in / Sign-up redirect URLs** (and any
   after-sign-in / after-sign-out URLs you want admins to land on).
3. Confirm `APP_ADMIN_URL=https://admin.tracktheturn.com` is set in the
   production environment (already declared in `.replit` →
   `[userenv.shared]`). The API uses this to populate CORS allowed origins
   (see `apps/api/src/index.ts` → `ALLOWED_ORIGINS`).

## Tenant-middleware behavior on the admin subdomain

`apps/api/src/middleware/tenant.ts` already bypasses tenant resolution for
any path starting with `/api/admin`, so requests from
`admin.tracktheturn.com` to `/api/admin/*` never try to look up a tenant
named "admin" — verified, no change needed.

The admin SPA only calls `/api/admin/*` (`rg "['\\\"\`]/api/" apps/admin/src`
shows two call sites, both under that prefix), so there is no risk of a
non-admin endpoint being hit with `Host: admin.tracktheturn.com` and
returning `TENANT_NOT_FOUND`.

## Verifying the rollout

After deploying:

1. `curl -sI https://admin.tracktheturn.com/` → expect `200` with
   `content-type: text/html`.
2. `curl -s https://admin.tracktheturn.com/ | grep '<title>'` → expect
   `<title>Helm Admin</title>` (proves you're hitting the admin bundle,
   not the web bundle).
3. `curl -sI https://admin.tracktheturn.com/tenants/abc-123` (a deep link)
   → expect `200` and the same `index.html` body (SPA fallback).
4. `curl -s https://admin.tracktheturn.com/api/health` → expect a JSON
   body from the API (proves the `/api` proxy works on the admin host).
5. `curl -s https://app.tracktheturn.com/ | grep '<title>'` → expect
   `<title>Helm</title>` (the marina app, unchanged).
6. Open the admin URL in a browser, sign in via Clerk, and confirm the
   Dashboard, Tenants, Billing, Analytics, Support, and Settings pages
   all render and that API calls under the **Network** tab return `200`
   (not `404 TENANT_NOT_FOUND` and not CORS-blocked).

## Rollback

The change is additive — the only new artifact is `apps/frontend-server/`.
To roll back:

1. Revert `.replit` `[deployment]` to its previous static config
   (`deploymentTarget = "static"`, `publicDir = "apps/web/dist"`,
   without the admin build step).
2. Redeploy. `app.tracktheturn.com` keeps working as the static web app;
   `admin.tracktheturn.com` returns whatever the registrar resolves it
   to (typically nothing) until DNS is removed or pointed elsewhere.

No data migrations, no API contract changes, no Clerk-config destruction.
