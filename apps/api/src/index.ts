import "dotenv/config";

import express from "express";
import cors from "cors";
import helmet from "helmet";

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
import conciergeRouter from "./routes/concierge.js";
import rampRouter from "./routes/ramp.js";
import referralPartnersRouter from "./routes/referral-partners.js";
import promoCodesRouter from "./routes/promo-codes.js";
import purchaseOrdersRouter from "./routes/purchase-orders.js";
import glAccountsRouter from "./routes/gl-accounts.js";
import auditLogsRouter from "./routes/audit-logs.js";
import apiKeysRouter from "./routes/api-keys.js";

// --------------------------------------------------------------------------
// Workers — import to start processing background jobs
// --------------------------------------------------------------------------

import "./jobs/billing-worker.js";
import "./jobs/email-worker.js";
import "./jobs/sms-worker.js";
import "./jobs/qbo-sync-worker.js";
import "./jobs/automation-worker.js";
import "./jobs/deferred-revenue-worker.js";
import { startRenewalWorker } from "./jobs/renewal-job.js";

startRenewalWorker();

// --------------------------------------------------------------------------
// App initialisation
// --------------------------------------------------------------------------

const app = express();
const PORT = parseInt(process.env.API_PORT ?? "3001", 10);

// --------------------------------------------------------------------------
// Global middleware
// --------------------------------------------------------------------------

app.use(cors());
app.use(helmet());
app.use(express.json());

// Tenant resolution — attaches tenantId / tenant to every request
// (bypasses /api/health and /api/admin automatically)
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
app.use("/api/concierge", conciergeRouter);
app.use("/api/ramp", rampRouter);
app.use("/api/referral-partners", referralPartnersRouter);
app.use("/api/promo-codes", promoCodesRouter);
app.use("/api/purchase-orders", purchaseOrdersRouter);
app.use("/api/gl-accounts", glAccountsRouter);
app.use("/api/audit-logs", auditLogsRouter);
app.use("/api/api-keys", apiKeysRouter);

// --------------------------------------------------------------------------
// Error handler (must be last)
// --------------------------------------------------------------------------

app.use(errorHandler);

// --------------------------------------------------------------------------
// Start server
// --------------------------------------------------------------------------

app.listen(PORT, () => {
  console.log(`[helm-api] listening on port ${PORT}`);
});

export default app;
