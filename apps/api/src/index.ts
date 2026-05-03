import "dotenv/config";

// Sentry must be initialised before importing any library it instruments.
import { initSentry, setupSentryErrorHandler } from "./lib/sentry.js";
initSentry();

import express, { type Application } from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";

import { tenantMiddleware } from "./middleware/tenant.js";
import { errorHandler } from "./middleware/error.js";
import { assertAuthConfigOrExit } from "./middleware/auth.js";
import { prisma } from "./lib/prisma.js";
import { redisConnection, queues } from "./lib/queue.js";
import { startQboInventoryRetrySchedule, stopQboInventoryRetrySchedule } from "./jobs/qbo-inventory-retry.js";
import { initQboInventoryResyncJobs } from "./services/qbo-inventory-resync-jobs.js";

// Fail fast in production if Clerk keys aren't configured.
assertAuthConfigOrExit();

import healthRouter from "./routes/health.js";
import authRouter from "./routes/auth.js";
import tenantsRouter from "./routes/tenants.js";
import slipsRouter from "./routes/slips.js";
import customersRouter from "./routes/customers.js";
import invoicesRouter from "./routes/invoices.js";
import paymentsRouter from "./routes/payments.js";
import leadsRouter from "./routes/leads.js";
import leadFormsRouter from "./routes/lead-forms.js";
import waitlistRouter from "./routes/waitlist.js";
import boatsRouter from "./routes/boats.js";
import dockWalksRouter from "./routes/dock-walks.js";
import posRouter from "./routes/pos.js";
import posDiscountsRouter from "./routes/pos-discounts.js";
import rentalsRouter from "./routes/rentals.js";
import reportsRouter from "./routes/reports.js";
import announcementsRouter from "./routes/announcements.js";
import adminRouter from "./routes/admin.js";
import onboardingRouter from "./routes/onboarding.js";
import contractsRouter from "./routes/contracts.js";
import settingsRouter from "./routes/settings.js";
import transientRouter from "./routes/transient.js";
import rampRouter from "./routes/ramp.js";
import conciergeRouter from "./routes/concierge.js";
import auditLogRouter from "./routes/audit-log.js";
import biApiRouter from "./routes/bi-api.js";
import insuranceRouter from "./routes/insurance.js";
import fuelRouter from "./routes/fuel.js";
import qboRouter from "./routes/qbo.js";
import qboCallbackRouter from "./routes/qbo-callback.js";
import qboWebhookRouter from "./routes/webhooks-qbo.js";
import storageRouter from "./routes/storage.js";
import inventoryRouter from "./routes/inventory.js";
import communicationPrefsRouter from "./routes/communication-prefs.js";
import webhooksStripeRouter from "./routes/webhooks-stripe.js";
import checkoutRouter from "./routes/checkout.js";
import saasBillingRouter from "./routes/saas-billing.js";
import portalRouter from "./routes/portal.js";
import chargebacksRouter from "./routes/chargebacks.js";
import emailComplianceRouter from "./routes/email-compliance.js";
import impersonationRouter from "./routes/impersonation.js";
import taxRouter from "./routes/tax.js";
import emailAutomationRouter from "./routes/email-automation.js";
import portfolioRouter from "./routes/portfolio.js";
import locationsRouter from "./routes/locations.js";
import rolesRouter from "./routes/roles.js";
import supportRouter from "./routes/support.js";
import accountingRouter from "./routes/accounting.js";

// Side-effect import: instantiates the BullMQ Workers (email, sms,
// automation, qbo-sync, billing, deferred-revenue, report-scheduler) and
// registers the repeatable cron jobs. Without this, jobs enqueued onto
// the queues (recurring-invoice -> sync-invoice, etc.) sit in Redis
// forever and the Failed Syncs panel keeps showing "no QBO invoice ID".
// The single-process model matches the rest of dev + the existing
// graceful-shutdown comments in this file ("Close BullMQ queues so
// workers stop picking up new jobs"). closeWorkers() is invoked from
// gracefulShutdown below so this file owns the only signal handler.
import { closeWorkers } from "./workers/index.js";

// --------------------------------------------------------------------------
// App initialisation
// --------------------------------------------------------------------------

const app: Application = express();
const PORT = parseInt(process.env.API_PORT ?? "3001", 10);

// Trust the first proxy hop (Replit's reverse proxy / nginx).
// Required for express-rate-limit to read X-Forwarded-For correctly and
// for req.ip to reflect the real client IP rather than the proxy's address.
app.set('trust proxy', 1);

// --------------------------------------------------------------------------
// Global middleware
// --------------------------------------------------------------------------

// In production restrict origins to known app domains; in development allow all.
const ALLOWED_ORIGINS = [
  process.env.APP_URL,
  process.env.APP_PORTAL_URL,
  process.env.APP_ADMIN_URL,
  // Vite dev servers
  'http://localhost:5000',
  'http://localhost:5001',
  'http://localhost:5002',
  'http://localhost:5173',
].filter(Boolean) as string[];

const isDev = process.env.NODE_ENV !== 'production';

// Global rate limit: 300 requests per minute per IP.
// Skipped entirely in development — Replit's shared proxy IP would cause
// legitimate dev requests to hit the limit almost immediately.
const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
  skip: (req) => isDev || req.path === '/api/health',
});
app.use(globalLimiter);

// Stricter limiter for authentication + webhook endpoints (production only)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please slow down.' },
  skip: () => isDev,
});
app.use('/api/auth', authLimiter);

app.use(
  cors({
    origin: process.env.NODE_ENV === 'production'
      ? (origin, cb) => {
          if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
          return cb(new Error(`CORS: origin ${origin} not allowed`));
        }
      : true,
    credentials: true,
  }),
);
app.use(helmet());

// Webhook routes MUST be mounted before express.json() so their raw body
// is preserved for signature verification. The routers themselves apply
// express.raw({type:"application/json"}) on each webhook endpoint.
app.use("/api/webhooks", webhooksStripeRouter);
app.use("/api/email", emailComplianceRouter);
// Intuit signs the raw bytes it sends, so the QBO webhook also needs the
// raw body. Mount before express.json() and before the authenticated
// /api/qbo router below so it doesn't inherit Clerk auth either.
app.use("/api/qbo/webhook", qboWebhookRouter);

app.use(express.json());

// Public impersonation handoff (verify/end). Mounted after express.json()
// so the JSON body is parsed, but before tenantMiddleware so it can be
// reached from any tenant subdomain without a tenant lookup.
app.use("/api/impersonation", impersonationRouter);

// Public QBO OAuth callback. Intuit redirects the popup here via a
// top-level cross-origin navigation that cannot reliably carry our Clerk
// session cookie, so the route must NOT sit behind clerkAuth. CSRF
// protection comes from the HMAC-signed `state` parameter, verified by
// the handler. Mounted before tenantMiddleware because tenantId comes
// from the verified state, not from the hostname.
app.use("/api/qbo/callback", qboCallbackRouter);

// Tenant resolution — attaches tenantId / tenant to every request
// (bypasses /api/health, /api/admin, /api/onboarding, /api/auth/webhook,
// /api/webhooks)
app.use(tenantMiddleware);

// --------------------------------------------------------------------------
// Route groups
// --------------------------------------------------------------------------

app.use("/api/health", healthRouter);
app.use("/api/auth", authRouter);
app.use("/api/tenants", tenantsRouter);
app.use("/api/slips", slipsRouter);
app.use("/api/customers", customersRouter);
app.use("/api/invoices", invoicesRouter);
app.use("/api/payments", paymentsRouter);
app.use("/api/leads", leadsRouter);
app.use("/api/lead-forms", leadFormsRouter);
app.use("/api/waitlist", waitlistRouter);
app.use("/api/boats", boatsRouter);
app.use("/api/dock-walks", dockWalksRouter);
// Discounts mount BEFORE the generic /api/pos router so the more specific
// path matches first (Express routes are evaluated top-down).
app.use("/api/pos/discounts", posDiscountsRouter);
app.use("/api/pos", posRouter);
app.use("/api/rentals", rentalsRouter);
app.use("/api/reports", reportsRouter);
app.use("/api/announcements", announcementsRouter);
app.use("/api/admin", adminRouter);
app.use("/api/onboarding", onboardingRouter);
app.use("/api/contracts", contractsRouter);
app.use("/api/settings", settingsRouter);
app.use("/api/transient", transientRouter);
app.use("/api/ramp", rampRouter);
app.use("/api/concierge", conciergeRouter);
app.use("/api/audit-log", auditLogRouter);
app.use("/api/bi", biApiRouter);
app.use("/api/insurance", insuranceRouter);
app.use("/api/fuel", fuelRouter);
// /api/qbo/webhook is mounted above (before express.json()) so the raw
// body is preserved for HMAC verification. The authenticated tenant API
// lives under /api/qbo here.
app.use("/api/qbo", qboRouter);
app.use("/api/storage", storageRouter);
app.use("/api/inventory", inventoryRouter);
app.use("/api/communication-prefs", communicationPrefsRouter);
app.use("/api/checkout", checkoutRouter);
app.use("/api/saas-billing", saasBillingRouter);
app.use("/api/portal", portalRouter);
app.use("/api/chargebacks", chargebacksRouter);
app.use("/api/tax", taxRouter);
app.use("/api/email-automation", emailAutomationRouter);
app.use("/api/portfolio", portfolioRouter);
app.use("/api/locations", locationsRouter);
app.use("/api/roles", rolesRouter);
app.use("/api/support", supportRouter);
app.use("/api/accounting", accountingRouter);

// --------------------------------------------------------------------------
// Error handlers — Sentry goes BEFORE the app error handler so unhandled
// errors get captured before they're converted to a 500 response.
// --------------------------------------------------------------------------

setupSentryErrorHandler(app);
app.use(errorHandler);

// --------------------------------------------------------------------------
// Start server + graceful shutdown (skipped when imported by the test runner)
// --------------------------------------------------------------------------

if (!process.env.VITEST) {
  const server = app.listen(PORT, () => {
    console.log(`[helm-api] listening on port ${PORT}`);
    // Recover any QBO inventory re-sync jobs that were left running by a
    // crashed predecessor process and start the periodic staleness sweep so
    // multi-replica deploys self-heal when one replica's runner dies.
    initQboInventoryResyncJobs();
  });

  // Schedule the recurring QBO inventory retry sweep. Lives in the API process
  // because the retry logic touches in-memory product / adjustment / PO state
  // owned by routes/inventory.ts.
  startQboInventoryRetrySchedule();

  // Grace window: orchestrators typically give SIGKILL 30s after SIGTERM.
  const SHUTDOWN_TIMEOUT_MS = 25_000;
  let shuttingDown = false;

  const gracefulShutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[helm-api] received ${signal}, draining...`);

    // Hard deadline so a hung dependency can't block the exit forever.
    const killTimer = setTimeout(() => {
      console.error("[helm-api] shutdown timed out, forcing exit");
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    killTimer.unref();

    // 1. Stop accepting new connections; keep existing in-flight requests.
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    }).catch((err) => console.error("[helm-api] server.close error:", err));

    // 1a. Stop the in-process QBO inventory retry scheduler.
    stopQboInventoryRetrySchedule();

    // 1b. Close BullMQ Workers first so any in-flight jobs can finish (or
    // be re-queued) before we tear down the queue/redis connections under
    // them. Workers and the API run in the same process — see the
    // side-effect import + closeWorkers comment near the top of this file.
    try {
      await closeWorkers();
    } catch (err) {
      console.error("[helm-api] closeWorkers error:", err);
    }

    // 2. Close BullMQ queues so workers stop picking up new jobs.
    try {
      await Promise.all(Object.values(queues).map((q) => q.close()));
    } catch (err) {
      console.error("[helm-api] queue.close error:", err);
    }

    // 3. Close Redis.
    try {
      await redisConnection.quit();
    } catch (err) {
      console.error("[helm-api] redis.quit error:", err);
    }

    // 4. Close Prisma / Postgres.
    try {
      await prisma.$disconnect();
    } catch (err) {
      console.error("[helm-api] prisma.$disconnect error:", err);
    }

    console.log("[helm-api] shutdown complete");
    process.exit(0);
  };

  process.on("SIGTERM", () => void gracefulShutdown("SIGTERM"));
  process.on("SIGINT", () => void gracefulShutdown("SIGINT"));
}

// Log — but don't crash on — unhandled rejections; Sentry will have captured them.
process.on("unhandledRejection", (reason) => {
  console.error("[helm-api] unhandledRejection:", reason);
});

export default app;
