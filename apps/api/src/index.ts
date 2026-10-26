import "dotenv/config";

import express from "express";
import cors from "cors";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";

import { buildCorsOptions, isDevAuthBypassEnabled, loadEnv, parseList } from "./lib/env.js";
import { tenantMiddleware } from "./middleware/tenant.js";
import { errorHandler } from "./middleware/error.js";

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

// --------------------------------------------------------------------------
// App initialisation
// --------------------------------------------------------------------------

// Fail fast on missing/unsafe configuration (exits the process on error).
const env = loadEnv();

function limiter(windowMs: number, limit: number) {
  // In-memory store: per-instance limits. Move to a Redis store when the API
  // runs more than one replica.
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: "Too many requests", code: "RATE_LIMITED" },
  });
}

const authLimiter = limiter(15 * 60 * 1000, 100);
const publicFormLimiter = limiter(15 * 60 * 1000, 30);
const webhookLimiter = limiter(60 * 1000, 300);
const apiKeyLimiter = limiter(60 * 1000, 120);

const app = express();
const PORT = env.API_PORT;

// --------------------------------------------------------------------------
// Global middleware
// --------------------------------------------------------------------------

// Behind one reverse proxy (nginx): trust its X-Forwarded-For so req.ip and
// the rate limiters see the real client address.
app.set("trust proxy", 1);

app.use(helmet());

// CORS: only configured origins (CORS_ORIGINS, comma-separated). All origins
// are reflected only in local dev with the explicit HELM_DEV_AUTH_BYPASS flag.
// Requests without an Origin header (server-to-server, webhooks, curl) are
// not affected by CORS.
app.use(cors(buildCorsOptions(parseList(env.CORS_ORIGINS), isDevAuthBypassEnabled())));

// Signature-verified webhooks need the exact raw bytes: parse them as Buffer
// BEFORE the JSON parser runs (express.json skips bodies already parsed).
app.use("/api/auth/webhook", webhookLimiter, express.raw({ type: "*/*", limit: "1mb" }));
app.use("/api/qbo/webhook", webhookLimiter, express.raw({ type: "*/*", limit: "1mb" }));
// ── STRIPE WEBHOOK MOUNT POINT ──────────────────────────────────────────────
// Reserved for POST /api/webhooks/stripe (handler not implemented yet; owned
// separately). Raw body + rate limit are already in place and the path
// bypasses tenant resolution; mount the router below with
//   app.use("/api/webhooks/stripe", stripeWebhookRouter);
// and verify with stripe.webhooks.constructEvent(req.body, sig, secret).
app.use("/api/webhooks/stripe", webhookLimiter, express.raw({ type: "*/*", limit: "1mb" }));

app.use(express.json({ limit: "1mb" }));

// Rate limits on public / unauthenticated-reachable endpoints.
app.use("/api/auth", authLimiter);
app.use("/api/onboarding/start", authLimiter);
app.use("/api/onboarding/stripe/callback", authLimiter);
app.use("/api/qbo/callback", authLimiter);
app.use("/api/lead-forms/:embedKey/submit", publicFormLimiter);
app.use("/api/widgets", publicFormLimiter); // future public widget endpoints
app.use("/api/bi", apiKeyLimiter);

// Tenant resolution — attaches tenantId / tenant to every request
// (see shouldBypassTenant() in middleware/tenant.ts for the exceptions)
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

// --------------------------------------------------------------------------
// Error handler (must be last)
// --------------------------------------------------------------------------

app.use(errorHandler);

// --------------------------------------------------------------------------
// Start server
// --------------------------------------------------------------------------

// Tests import the app (supertest) — don't bind a port there (EADDRINUSE).
if (!process.env.VITEST) {
  app.listen(PORT, () => {
    console.log(`[helm-api] listening on port ${PORT}`);
  });
}

export default app;
