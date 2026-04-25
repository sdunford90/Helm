import "dotenv/config";

// Sentry must be initialised before importing any library it instruments.
import { initSentry, setupSentryErrorHandler } from "./lib/sentry.js";
initSentry();

import express, { type Application } from "express";
import cors from "cors";
import helmet from "helmet";

import { tenantMiddleware } from "./middleware/tenant.js";
import { errorHandler } from "./middleware/error.js";
import { assertAuthConfigOrExit } from "./middleware/auth.js";
import { prisma } from "./lib/prisma.js";
import { redisConnection, queues } from "./lib/queue.js";

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
import storageRouter from "./routes/storage.js";
import inventoryRouter from "./routes/inventory.js";
import communicationPrefsRouter from "./routes/communication-prefs.js";
import webhooksStripeRouter from "./routes/webhooks-stripe.js";
import checkoutRouter from "./routes/checkout.js";
import saasBillingRouter from "./routes/saas-billing.js";
import portalRouter from "./routes/portal.js";
import chargebacksRouter from "./routes/chargebacks.js";
import emailComplianceRouter from "./routes/email-compliance.js";

// --------------------------------------------------------------------------
// App initialisation
// --------------------------------------------------------------------------

const app: Application = express();
const PORT = parseInt(process.env.API_PORT ?? "3001", 10);

// --------------------------------------------------------------------------
// Global middleware
// --------------------------------------------------------------------------

app.use(cors());
app.use(helmet());

// Webhook routes MUST be mounted before express.json() so their raw body
// is preserved for signature verification. The routers themselves apply
// express.raw({type:"application/json"}) on each webhook endpoint.
app.use("/api/webhooks", webhooksStripeRouter);
app.use("/api/email", emailComplianceRouter);

app.use(express.json());

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
app.use("/api/qbo", qboRouter);
app.use("/api/storage", storageRouter);
app.use("/api/inventory", inventoryRouter);
app.use("/api/communication-prefs", communicationPrefsRouter);
app.use("/api/checkout", checkoutRouter);
app.use("/api/saas-billing", saasBillingRouter);
app.use("/api/portal", portalRouter);
app.use("/api/chargebacks", chargebacksRouter);

// --------------------------------------------------------------------------
// Error handlers — Sentry goes BEFORE the app error handler so unhandled
// errors get captured before they're converted to a 500 response.
// --------------------------------------------------------------------------

setupSentryErrorHandler(app);
app.use(errorHandler);

// --------------------------------------------------------------------------
// Start server + graceful shutdown
// --------------------------------------------------------------------------

const server = app.listen(PORT, () => {
  console.log(`[helm-api] listening on port ${PORT}`);
});

// Grace window: orchestrators typically give SIGKILL 30s after SIGTERM.
const SHUTDOWN_TIMEOUT_MS = 25_000;
let shuttingDown = false;

async function gracefulShutdown(signal: string): Promise<void> {
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
}

process.on("SIGTERM", () => void gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => void gracefulShutdown("SIGINT"));

// Log — but don't crash on — unhandled rejections; Sentry will have captured them.
process.on("unhandledRejection", (reason) => {
  console.error("[helm-api] unhandledRejection:", reason);
});

export default app;
