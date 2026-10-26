# Helm: Build, Deployment & Operations

This document covers how Helm is built, shipped, migrated, backed up and rolled back.
It replaces the "use `prisma db push`" guidance that used to live in `replit.md`.
Background and the original findings are in `docs/audit/07-platform-security-infra.md`, sections 1.3, 2, 8 and 9.

---

## 1. Runtime topology

| Process | Image / command | Purpose |
|---|---|---|
| **api** | `Dockerfile.api`, `node dist/index.js` | Express REST API on `:3001`. Liveness at `GET /api/health`. |
| **worker** | `Dockerfile.api`, `node dist/worker.js` | BullMQ workers plus the repeatable schedulers (renewals, tenant lifecycle, pricing, email/SMS). It has no HTTP port. |
| **migrate** | `Dockerfile.api`, `node_modules/.bin/prisma migrate deploy` | One-shot release step. It must finish successfully before api/worker start. |
| **web** | `Dockerfile.web` (nginx, `:8080`) | Serves the marina dashboard SPA at `/` and widgets at `/widgets/`, and reverse-proxies `/api/` to the API. |
| **postgres** | Postgres 16 | The single shared database (see section 6, "Tenancy decision"). |
| **redis** | Redis 7 | BullMQ queues. It **must** run with AOF persistence and `maxmemory-policy noeviction`. |

The API, worker and migrate processes use **one image**, so they always run the same code and the same Prisma client.

> **Worker entrypoint:** `apps/api/src/worker.ts`, compiled to `dist/worker.js`, is being added in a parallel change. It starts every worker in `src/workers/` and registers the schedulers.
> `pnpm worker`, `pnpm worker:dev`, the compose `worker` service and the deploy template already point at that path.
> Until it lands, the worker container exits with `Cannot find module dist/worker.js`.
> The old compose command (`dist/jobs/renewal-job.js`) was wrong: that module only exports functions, so the container crash-looped.

---

## 2. Local development

Prerequisites: Node 22 (CI and the images use it; `engines` still allows 20), pnpm 9 (`npm i -g pnpm@9`, or `npx -y pnpm@9 …`), and Docker.

```bash
# 1. Infrastructure: Postgres 16 + Redis (AOF, noeviction) on localhost
docker compose -f docker-compose.dev.yml up -d

# 2. Dependencies (skip the ~170 MB Chrome download; see section 4.1, "PDF generation")
PUPPETEER_SKIP_DOWNLOAD=1 pnpm install --frozen-lockfile

# 3. apps/api/.env  (read by dotenv/config and by the Prisma CLI)
cat > apps/api/.env <<'EOF'
NODE_ENV=development
HELM_DEV_AUTH_BYPASS=true
DATABASE_URL=postgresql://helm:helmpassword@localhost:5432/helm?schema=public
REDIS_URL=redis://localhost:6379
EOF

# 4. Schema + seed data
pnpm db:generate
pnpm db:migrate:deploy        # apply committed migrations
pnpm db:seed                  # tenant "Bayshore Marina" (subdomain bayshore), users, slips, …

# 5. Run (separate terminals)
pnpm --filter @helm/api dev   # API  :3001 (tsx watch)
pnpm worker:dev               # BullMQ worker (tsx watch src/worker.ts)
pnpm --filter @helm/web dev   # web  :5000 (proxies /api -> :3001)
```

**`HELM_DEV_AUTH_BYPASS=true`** is the explicit, local-only opt-in to skip Clerk.
Auth fails closed when `NODE_ENV=production`, and both Docker images set `NODE_ENV=production`, so the bypass cannot take effect in a container built from this repo.
Never put the flag in `docker-compose.yml`, an image, CI, or any deployed environment.

Use `docker compose -f docker-compose.dev.yml down -v` to reset the local database.

### Useful scripts (repo root)

| Script | What it does |
|---|---|
| `pnpm typecheck` | `tsc --noEmit` in every package via turbo. This is the type gate. |
| `pnpm build` | Builds every package. Vite apps run `vite build` only, because type errors are gated by `typecheck`. |
| `pnpm test` | Runs tests. It depends on `^build` + `generate`, not on the package's own `tsc` emit, because vitest runs sources. |
| `pnpm db:generate` | `prisma generate` |
| `pnpm db:migrate:dev --name <change>` | Creates and applies a new migration locally |
| `pnpm db:migrate:deploy` | Applies pending migrations (CI, the release step) |
| `pnpm db:migrate:status` | Shows migration state |
| `pnpm db:seed` | Seeds demo data (dev/staging only, never production) |
| `pnpm worker` / `pnpm worker:dev` | Worker from `dist/` / with hot reload |

---

## 3. CI (`.github/workflows/ci.yml`)

CI runs on every PR, and on `main` through `deploy.yml`. There is **no** `continue-on-error`, so a red job blocks.

| Job | Steps |
|---|---|
| Typecheck | pnpm 9 (from `packageManager`), Node 22, `pnpm install --frozen-lockfile`, `prisma generate`, then `turbo run typecheck --continue` |
| Build | `turbo run build --continue`, then checks that each app's `dist/` exists |
| Test | `postgres:16` + `redis:7` service containers with `DATABASE_URL`/`REDIS_URL` set. Runs `prisma migrate deploy`, then a **drift check** (`prisma migrate diff --from-url $DATABASE_URL --to-schema-datamodel … --exit-code`), then the API vitest suite. |
| Docker | Builds both images without pushing (PRs only) |

Turbo's local cache (`.turbo/cache`) is persisted per job with `actions/cache`, and the pnpm store is cached by `setup-node`.

**Expected state at introduction:** typecheck (api, web, portal, admin, widgets), the API `tsc` build, the API Docker build and the API tests are red on the base branch. These are known issues being fixed in parallel (audit section 2).
CI is meant to show that, not hide it. Mark all four jobs as **required status checks** on `main` once they are green.

The drift check fails if someone edits `schema.prisma` without adding a migration. Fix it with `pnpm db:migrate:dev --name <change>`.

---

## 4. Images

### 4.1 API image (`Dockerfile.api`)

* `node:22-bookworm-slim`. Debian rather than Alpine, so Prisma engines and (if ever needed) Chromium use glibc.
* pnpm is installed with `npm i -g pnpm@9.15.9`, not corepack, which has failed signature checks before and is no longer bundled with newer Node.
* `pnpm fetch` runs from `pnpm-lock.yaml` alone, so that layer is cached until the lockfile changes.
  It is followed by `pnpm install --offline --frozen-lockfile --filter @helm/api...`, then `prisma generate`, then the build of `@helm/api` and its workspace deps only.
* The runtime `node_modules` comes from a separate lockfile-exact `--prod` install for `@helm/api` only.
  `pnpm deploy` isn't used because in pnpm 9 it re-resolves versions without the lockfile.
* The image runs as non-root uid `10001`. App files are root-owned, so they're read-only to the process.
  It sets `NODE_ENV=production`, runs `tini` as PID 1 for clean SIGTERM handling, and has a `HEALTHCHECK` on `/api/health`.
* `docker build` fails while `apps/api` has type errors (`tsc` is the build). That is intended.

**PDF generation (puppeteer).**
`apps/api/src/lib/pdf.ts` launches puppeteer, but nothing imports `generatePdf` today.
The image therefore sets `PUPPETEER_SKIP_DOWNLOAD=1` and ships **no Chromium**. That saves about 400 MB and a large attack surface.
When PDF invoices/contracts are wired up, pick one of:
1. Add `chromium` and its fonts to the runtime stage (`apt-get install chromium fonts-liberation`), set `PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium`, and render in the **worker**, not the API request path.
2. Use a separate renderer service (for example Gotenberg) or a hosted PDF API. This is the preferred option for multi-tenant isolation.

Note also that `tesseract.js` downloads language data at runtime unless it's vendored, so the worker or API needs outbound HTTPS for OCR.

### 4.2 Web image (`Dockerfile.web`, `nginx.conf`)

* The same pnpm fetch/offline pattern builds `@helm/web` and `@helm/widgets`.
* The runtime is `nginxinc/nginx-unprivileged` (uid 101, port **8080**). `nginx.conf` is installed as a template. `API_UPSTREAM` (default `api:3001`) sets where `/api/` is proxied.
* `VITE_CLERK_PUBLISHABLE_KEY` and `VITE_API_URL` are **build args** compiled into the bundle, so they must be public values. If staging and production use different Clerk instances, build one web image per environment, or move to runtime config. This is a follow-up item.

**What the web image serves.**

| Path | App | Notes |
|---|---|---|
| `/` | `apps/web` | SPA fallback to `index.html`. `X-Frame-Options: DENY` and `frame-ancestors 'none'`. |
| `/assets/*` | `apps/web` | Content-hashed, `Cache-Control: public, max-age=31536000, immutable`. A missing file returns 404, not `index.html`. |
| `/widgets/*.es.js` | `apps/widgets` | **Embeddable on marina websites**: `frame-ancestors *`, no XFO, CORS `*` and CORP `cross-origin` (these are ES modules loaded cross-origin). Entry files cache for 5 min because their names are stable; hashed chunks are immutable. |
| `/api/*` | API | Reverse proxy. Keeps `Host` (tenancy is Host-based) and sets `X-Forwarded-*`. The API's own helmet headers apply. |
| `/healthz` | nginx | Container liveness. |

Deliberately **not** served:
* **apps/admin**, the platform-admin console. Platform-admin must not be reachable on tenant hostnames (`<tenant>.gethelm.com` or custom domains). Deploy it as its own static site on a separate host, for example `admin.gethelm.com` behind SSO/IP allowlisting, once `requirePlatformAdmin` is fixed (audit A-3).
* **apps/portal**, the boater portal. It is still 100% mock data with no portal-scoped API (audit section 1.2). Add it when it's real, ideally on its own host.

**Security headers.**
* `Strict-Transport-Security: max-age=31536000` without `includeSubDomains`, because a tenant's custom (possibly apex) domain would otherwise force HTTPS onto all of the marina's other subdomains. Set `includeSubDomains; preload` for `gethelm.com` at the edge.
* `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`.
* **CSP is Report-Only to start** (`Content-Security-Policy-Report-Only`). It allows self, Clerk (`*.clerk.accounts.dev` and `clerk.gethelm.com`), Cloudflare Turnstile and Stripe.
  Watch the browser console for violations, add a `report-to` endpoint when one exists, then promote it to an enforced `Content-Security-Policy`.
  `frame-ancestors` is sent as an **enforced** CSP because browsers ignore it in Report-Only.

TLS is terminated in front of nginx, at the platform edge or load balancer.
Wildcard DNS and TLS for `*.gethelm.com`, plus on-demand certificates for tenant custom domains, are an edge/platform concern and are not solved here.
The API also needs Express `trust proxy` configured so `req.ip` and `req.protocol` honour `X-Forwarded-*`. That is an app-code follow-up.

---

## 5. Environments

| | Local | CI | Staging | Production |
|---|---|---|---|---|
| How it runs | Host processes + `docker-compose.dev.yml` | GitHub Actions service containers | `deploy.yml` → `deploy-compose.yml` (GitHub Environment `staging`) | Same, Environment `production`, **manual approval** |
| `NODE_ENV` | `development` | `test` | `production` | `production` |
| `HELM_DEV_AUTH_BYPASS` | `true` (opt-in) | unset | **never** | **never** |
| Database | Compose Postgres | Ephemeral `postgres:16` | Managed Postgres 16 (PITR) | Managed Postgres 16 (PITR), separate instance |
| Redis | Compose Redis | Ephemeral `redis:7` | Redis with AOF + `noeviction` | Same, separate instance |
| Seed data | yes | no | optional | **no** |

`docker-compose.yml` is a production-*like* single-host stack. It's useful for smoke tests and as the deploy template's target.
For real production, move Postgres to a managed service with PITR. Point `DATABASE_URL` at it and drop the `postgres` service.

---

## 6. Configuration (environment variables)

Secrets live in the environment's secret store. For the compose target that is `${DEPLOY_PATH}/.env` on the host, mode `600`, owned by the deploy user, and never committed.
Another change is adding zod-validated env parsing at API boot, which will make missing required variables fail fast. Keep this table and `.env.example` in sync with that schema.

| Variable | Required in prod | Used by | Notes |
|---|---|---|---|
| `NODE_ENV` | yes (`production`) | api, worker | Set by the images. Auth fails closed in production. |
| `DATABASE_URL` | yes | api, worker, migrate | `postgresql://…?schema=public`. Use a pooled URL for the app and a direct URL for migrations if using PgBouncer/Neon. |
| `REDIS_URL` | yes | api, worker | BullMQ. Redis must use AOF + `noeviction`. |
| `API_PORT` | no (3001) | api | |
| `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY` | yes | api | Read by `@clerk/express`. |
| `CLERK_WEBHOOK_SECRET` | yes | api | Svix verification. **Missing from `.env.example`.** |
| `VITE_CLERK_PUBLISHABLE_KEY` | yes (build arg) | web build | GitHub repo variable for `deploy.yml` |
| `VITE_API_URL` | no | web build | Leave empty when the API is same-origin via `/api/` |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | yes | api | |
| `STRIPE_CLIENT_ID` | for Connect | api | **Missing from `.env.example`.** |
| `STRIPE_PLATFORM_ACCOUNT_ID` | ? | — | In `.env.example`, not read by the code |
| `QBO_CLIENT_ID`, `QBO_CLIENT_SECRET`, `QBO_REDIRECT_URI` | for QBO | api | |
| `QBO_ENVIRONMENT`, `QBO_WEBHOOK_VERIFIER_TOKEN` | for QBO | api | **Missing from `.env.example`.** |
| `ANTHROPIC_API_KEY` | for AI features | api | |
| `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | yes | api | **The code reads `R2_BUCKET` and `R2_ENDPOINT`. `.env.example` has `R2_BUCKET_NAME` / `R2_ACCOUNT_ID`, which are never read.** |
| `R2_PUBLIC_URL`, `R2_UPLOAD_URL` | yes | api | **Missing from `.env.example`.** |
| `RESEND_API_KEY` | yes | worker/api | |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_DEFAULT_NUMBER` | for SMS | worker/api | `TWILIO_DEFAULT_NUMBER` is **missing from `.env.example`.** |
| `APP_URL` | yes | api | Used for Stripe/e-sign return URLs. It falls back to a wrong default (`https://app.helm.dev`). **Missing from `.env.example`.** |
| `APP_BASE_URL` | yes | api | **Missing from `.env.example`.** Consolidate with `APP_URL`. |
| `APP_DOMAIN` | ? | — | In `.env.example`, not read by the API |
| `IMPERSONATION_SECRET` | yes | api | Falls back to a **hard-coded dev key** if unset. It must be required in production. **Missing from `.env.example`.** |
| `SENTRY_DSN` | recommended | api, worker | **Missing from `.env.example`.** |
| `RECAPTCHA_SECRET_KEY` | for public forms | api | **Missing from `.env.example`.** |
| `ESIGN_PROVIDER`, `DOCUSIGN_API_KEY`, `DOCUSIGN_ACCOUNT_ID` | for e-sign | api | **Missing from `.env.example`.** |
| `NEON_API_KEY` | no | — | Leftover from the DB-per-tenant idea. Remove it. |
| `HELM_DEV_AUTH_BYPASS` | **must be unset** | api | Local dev only |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | compose only | docker-compose.yml | `POSTGRES_PASSWORD` is required, and compose refuses to start without it. Add it to `.env.example`. |
| `REDIS_MAXMEMORY` | compose only | docker-compose.yml | Default `512mb` |
| `HELM_API_IMAGE`, `HELM_WEB_IMAGE` | compose only | docker-compose.yml | Image refs to run instead of building (set by the deploy template) |

---

## 7. Database migrations

**Tenancy decision:** Helm uses **one shared database with a shared schema and a row-level `tenantId`**. The Prisma `$extends` tenant scoping will be backed by Postgres Row-Level Security as defence in depth.
`tools/migrate-all.ts`, the per-tenant-schema migration runner, is **deprecated**. Don't use it. The root `db:migrate:all` script has been removed, and the tool will be deleted together with the unused `CREATE SCHEMA tenant_…` call in onboarding.

Migrations live in `apps/api/prisma/migrations/`. The baseline is `0_init`. `prisma db push` is **not** used against any shared database.

### Day-to-day workflow

```bash
# edit apps/api/prisma/schema.prisma, then:
pnpm db:migrate:dev --name add_payment_refunded_cents   # creates + applies locally
git add apps/api/prisma/migrations && git commit
```
CI applies migrations to a fresh Postgres and fails on drift. Deploys run `prisma migrate deploy` (the compose `migrate` service) before the new api/worker start.

Rules:
* Migrations are **forward-only** in production. Write them **expand/contract**: add nullable or defaulted columns and new tables first, deploy code that handles both shapes, and drop or rename in a later release. Then the previous image keeps working if you roll back (section 10).
* Never edit a migration that has been applied to staging or production. Add a new one.
* Large backfills go in the worker or in a separate script, not in a migration transaction.

### Regenerating the baseline (one-time, before 0_init is applied anywhere shared)

`0_init` was generated from `schema.prisma` at the time of this change.
If the schema changes before the baseline has been applied to any shared database (for example `Payment.refundedCents` from the parallel security change), **regenerate it instead of adding a second migration**:

```bash
cd apps/api
npx prisma migrate diff \
  --from-empty \
  --to-schema-datamodel prisma/schema.prisma \
  --script > prisma/migrations/0_init/migration.sql
# verify on an empty database:
DATABASE_URL=postgresql://…/helm_scratch npx prisma migrate deploy
DATABASE_URL=postgresql://…/helm_scratch npx prisma migrate status   # "Database schema is up to date!"
```
After `0_init` has been applied to staging or production, schema changes must be new migrations (`pnpm db:migrate:dev --name …`).

### Adopting migrations on a database created with `db push` (for example the Replit DB)

1. Back up the database.
2. Confirm it matches the baseline:
   `npx prisma migrate diff --from-url "$DATABASE_URL" --to-migrations prisma/migrations --shadow-database-url "$SHADOW_URL" --script`. Run it from `apps/api`. The output should be empty, or contain only changes you understand.
3. Mark the baseline as already applied, without running it:
   `npx prisma migrate resolve --applied 0_init`
4. From then on, run `pnpm db:migrate:deploy`.

---

## 8. Worker process

* Run the worker as its own process or container (`node dist/worker.js`) from the same image as the API, with the same env.
* It needs Redis (AOF + `noeviction`; with eviction, BullMQ can lose jobs silently) and Postgres.
* Scale workers horizontally by running more replicas. Repeatable schedulers are registered idempotently by BullMQ, but keep a single scheduler-registering replica if the implementation requires it (audit J-6).
* SIGTERM is forwarded by `tini`. The worker should `await worker.close()` so in-flight jobs finish. compose gives it a 30 s `stop_grace_period`.
* There is no HTTP health endpoint yet. Monitor the queues (failed/waiting counts) and alert on them. A readiness probe that checks DB and Redis is an open follow-up (audit O-2).

---

## 9. CI/CD and deploy

### Pipeline (`.github/workflows/deploy.yml`)

1. **On push to `main`:** CI (called via `workflow_call`) runs, and every job must pass.
2. **build-and-push:** `ghcr.io/<owner>/<repo>/api` and `/web` are tagged with the **full commit SHA**, which is the only tag deploys use, and with `main`. SBOM and provenance attestations are attached.
3. **deploy-staging:** uses GitHub Environment `staging`.
4. **deploy-production:** uses GitHub Environment `production`. It needs staging to succeed **and** a manual approval from the environment's required reviewers.

Deploy jobs are **disabled until** the repository variable `DEPLOY_ENABLED` is `true`. Until then the pipeline stops after pushing images.

The deploy implementation is the reusable `.github/workflows/deploy-compose.yml`, a **generic SSH + docker compose template**.
It copies `docker-compose.yml` to the host, logs in to GHCR with the job's short-lived `GITHUB_TOKEN`, and runs `docker compose pull` and `docker compose up -d --no-build --wait`.
That runs the `migrate` one-shot first, then api and worker, then web, and fails if anything isn't healthy. An optional external health check follows.
To move to Fly.io, Render or ECS, replace that step and keep the same order: migrate, then api + worker, then web, then health check.

### One-time setup

1. **Settings → Environments:** create `staging` and `production`.
   On `production`, add **Required reviewers**, and restrict deployment branches to `main`.
2. Per environment, add **secrets**:

   | Secret | Value |
   |---|---|
   | `DEPLOY_SSH_HOST` | Hostname or IP of the docker host |
   | `DEPLOY_SSH_USER` | Deploy user (member of the `docker` group, no sudo) |
   | `DEPLOY_SSH_PRIVATE_KEY` | Private key for that user (ed25519, deploy-only) |
   | `DEPLOY_SSH_KNOWN_HOSTS` | Output of `ssh-keyscan -t ed25519 <host>`, verified out of band |

   Per environment, add **variables**: `DEPLOY_PATH` (default `/opt/helm`) and `DEPLOY_HEALTHCHECK_URL` (for example `https://staging.gethelm.com/api/health`).
3. **Repository variables:** `VITE_CLERK_PUBLISHABLE_KEY` and optionally `VITE_API_URL` (web build args), and finally `DEPLOY_ENABLED=true`.
4. **On each host:** install Docker Engine + the Compose plugin and create `${DEPLOY_PATH}/.env` (mode 600) with the section 6 variables.
   For production, point `DATABASE_URL` at managed Postgres and remove or ignore the bundled `postgres` service.
   GHCR packages are private by default. The job's `GITHUB_TOKEN` (`packages: read`) is used for the pull and the host is logged out again afterwards.

---

## 10. Rollback

**Application rollback:** redeploy a previous image, without rebuilding.
* Go to **Actions → Deploy → Run workflow**, choose `environment`, and set `image_tag` to the previous commit SHA.
  `${DEPLOY_PATH}/deploy-history.log` on the host lists the tags deployed, and the GHCR package page lists every pushed SHA.
* Production redeploys still require approval.
* `migrate deploy` with an older image is a no-op: Prisma doesn't roll migrations back. That is why migrations must be expand/contract (section 7), so the previous release keeps working on the newer schema.

**Bad migration:**
1. Prefer a **forward fix**, a new migration that corrects it.
2. If data was damaged, restore from **PITR** to a new instance at a time just before the migration (section 11), verify it, then switch `DATABASE_URL` and redeploy the matching image.
3. If a migration failed half-way, Prisma marks it failed. Fix the database manually, then run `prisma migrate resolve --rolled-back <name>` (or `--applied`) and redeploy.

**Redis:** the queues aren't the system of record. If Redis is lost, the worker should re-register scheduled repeatables when it starts (verify this in `src/worker.ts`). In-flight emails and SMS may need re-triggering.

---

## 11. Backups and disaster recovery

| Target | Value |
|---|---|
| **RPO** (max data loss) | **15 minutes** |
| **RTO** (max time to restore service) | **4 hours** |

* **Postgres:** use a managed Postgres 16 with **point-in-time recovery** enabled (Neon, RDS/Aurora, Cloud SQL, Crunchy Bridge, …). Continuous WAL archiving gives an RPO of minutes, well inside 15 min.
  Keep 14 days of retention for production, and keep daily snapshots copied to a second region or account.
  The bundled compose `postgres` volume is **not** a backup. If you run it anywhere that matters, add scheduled `pg_dump` plus WAL archiving (for example pgBackRest or wal-g) to off-host storage.
* **Restore drill:** at least quarterly, restore PITR to a scratch instance, run `prisma migrate status` and smoke tests against it, and record the elapsed time. That time must fit the 4 h RTO.
* **Object storage (R2):** enable bucket versioning or lifecycle retention for tenant documents.
* **Redis:** AOF (`appendfsync everysec`) limits loss to about 1 s on restart. A Redis snapshot isn't needed for DR because Postgres is the source of truth.
* **Secrets:** keep the environment `.env` and the GitHub secrets in a password manager or vault, so a host can be rebuilt from scratch within the RTO.

---

## 12. Known gaps / follow-ups

* Typecheck and tests are red on the base branch (section 3). Make the CI jobs required once they're green.
* `apps/api/src/worker.ts` is pending in a parallel change (section 1).
* `/api/health` is liveness only. Add a readiness probe that checks Postgres and Redis (audit O-2).
* The API responds with `Access-Control-Allow-Origin: *` (open `cors()`), observed through the nginx proxy. Restrict it to tenant origins (app code).
* Express `trust proxy` isn't set (section 4.2).
* The web image bakes in a single Clerk publishable key (section 4.2).
* `.env.example` drift (section 6).
* `packages/database` is an empty stub. Its `db:*` scripts point at a schema that doesn't exist. Remove it or move the schema there (audit I-2).
* There are no `lint` scripts or ESLint config, so `turbo lint` does nothing (audit I-3).
* There is no `apps/admin` deployment target yet (section 4.2).
