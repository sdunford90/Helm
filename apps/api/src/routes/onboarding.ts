import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { getAuth } from "@clerk/express";
import type { GLAccountType, Prisma } from "@prisma/client";
import { prisma, tenantStore } from "../lib/prisma.js";
import { stripe } from "../lib/stripe.js";
import { authenticateSession, clerkAuth, requireRole } from "../middleware/auth.js";
import { consumeOAuthState, createOAuthState, isActiveTenantOwner } from "../lib/oauth-state.js";

// --------------------------------------------------------------------------
// Onboarding.
//
// Only two paths bypass tenant resolution (middleware/tenant.ts):
//   POST /api/onboarding/start            — creates a brand-new tenant, so no
//                                            tenant exists yet. Requires a
//                                            Clerk session; the caller becomes
//                                            the MARINA_OWNER.
//   GET  /api/onboarding/stripe/callback  — Stripe's fixed redirect URI. The
//                                            tenant comes from the verified,
//                                            single-use server-side state.
// Every other step runs on the new tenant's host with staff auth +
// MARINA_OWNER, and `:tenantId` must equal the Host-resolved tenant.
//
// QBO connect lives only in /api/qbo (authorize + callback).
// --------------------------------------------------------------------------

const router = Router();

// --------------------------------------------------------------------------
// Validation schemas
// --------------------------------------------------------------------------

const startSchema = z.object({
  marinaName: z.string().min(1).max(255),
  subdomain: z
    .string()
    .min(2)
    .max(63)
    .regex(/^[a-z0-9]+$/, "Subdomain must be alphanumeric (lowercase, no hyphens or special chars)"),
  adminEmail: z.string().email(),
  adminFirstName: z.string().min(1).max(100),
  adminLastName: z.string().min(1).max(100),
  timezone: z.string().min(1).default("America/New_York"),
  fiscalYearEnd: z
    .string()
    .regex(/^\d{2}[-/]\d{2}$/, "Must be MM-DD format")
    .default("12-31"),
});

const brandingSchema = z.object({
  logo: z.string().url().optional(),
  primaryColor: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/, "Must be a valid hex color")
    .optional(),
  marinaName: z.string().min(1).max(255).optional(),
  address: z.string().max(500).optional(),
  phone: z.string().max(30).optional(),
  email: z.string().email().optional(),
  website: z.string().url().optional(),
});

// Subdomains that must never become tenants.
const RESERVED_SUBDOMAINS = new Set(["www", "app", "api", "admin", "portal", "widgets", "static", "mail"]);

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

/** `:tenantId` must be the Host-resolved tenant (404 otherwise — no oracle). */
function sameTenant(req: Request, res: Response, next: NextFunction): void {
  if (!req.tenantId || req.params.tenantId !== req.tenantId) {
    res.status(404).json({ error: "Tenant not found", code: "NOT_FOUND" });
    return;
  }
  next();
}

const ownerOfThisTenant = [...clerkAuth(), requireRole("MARINA_OWNER"), sameTenant];

function stripeRedirectUri(): string | undefined {
  return (
    process.env.STRIPE_CONNECT_REDIRECT_URI ??
    (process.env.APP_URL ? `${process.env.APP_URL}/api/onboarding/stripe/callback` : undefined)
  );
}

function finishStripe(res: Response, outcome: "connected" | "error", status = 200, code?: string): void {
  const appUrl = process.env.APP_URL;
  if (appUrl) {
    const url = new URL("/onboarding", appUrl);
    url.searchParams.set("stripe", outcome);
    if (code) url.searchParams.set("code", code);
    res.redirect(302, url.toString());
    return;
  }
  res
    .status(status)
    .json(outcome === "connected" ? { success: true } : { error: "Stripe connection failed", code });
}

// --------------------------------------------------------------------------
// POST /api/onboarding/start — Create tenant + owner (Clerk session required)
// --------------------------------------------------------------------------
router.post("/start", authenticateSession(), async (req, res, next) => {
  try {
    const data = startSchema.parse(req.body);

    // The Clerk identity creating the tenant becomes its owner (null only
    // under the explicit local dev bypass).
    const clerkUserId = req.devAuthBypass ? null : getAuth(req).userId;
    if (!req.devAuthBypass && !clerkUserId) {
      res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
      return;
    }

    if (RESERVED_SUBDOMAINS.has(data.subdomain)) {
      res.status(409).json({ error: "Subdomain is reserved", code: "SUBDOMAIN_RESERVED" });
      return;
    }

    const existing = await prisma.tenant.findFirst({
      where: { subdomain: data.subdomain },
      select: { id: true },
    });
    if (existing) {
      res.status(409).json({ error: "Subdomain already taken", code: "SUBDOMAIN_CONFLICT" });
      return;
    }

    const { tenant, adminUser } = await prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          name: data.marinaName,
          subdomain: data.subdomain,
          status: "ACTIVE",
          timezone: data.timezone,
          fiscalYearEnd: data.fiscalYearEnd.replace("-", "/"),
          brandingJson: {},
        },
        select: { id: true, name: true, subdomain: true, timezone: true, fiscalYearEnd: true },
      });

      const adminUser = await tx.user.create({
        data: {
          tenantId: tenant.id,
          clerkUserId,
          email: data.adminEmail,
          firstName: data.adminFirstName,
          lastName: data.adminLastName,
          role: "MARINA_OWNER",
        },
        select: { id: true, email: true, firstName: true, lastName: true, role: true },
      });

      return { tenant, adminUser };
    });

    const setupSteps = {
      branding: { complete: false, label: "Configure branding" },
      stripe: { complete: false, label: "Connect Stripe account" },
      qbo: { complete: false, label: "Connect QuickBooks Online" },
      chartOfAccounts: { complete: false, label: "Seed chart of accounts" },
      twilio: { complete: false, label: "Provision phone number" },
    };

    res.status(201).json({ tenant, adminUser, setupSteps });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: "Validation failed", details: err.errors });
      return;
    }
    next(err);
  }
});

// --------------------------------------------------------------------------
// GET /api/onboarding/stripe/callback — Stripe Connect OAuth redirect
// (no user auth; verified by single-use server-side state)
// --------------------------------------------------------------------------
router.get("/stripe/callback", async (req, res, next) => {
  try {
    const binding = await consumeOAuthState("stripe_connect", req.query.state);
    if (!binding) {
      finishStripe(res, "error", 400, "INVALID_STATE");
      return;
    }

    const code = req.query.code;
    if (req.query.error || typeof code !== "string" || !code) {
      finishStripe(res, "error", 400, req.query.error ? "ACCESS_DENIED" : "MISSING_CODE");
      return;
    }

    if (!(await isActiveTenantOwner(binding))) {
      finishStripe(res, "error", 403, "NOT_OWNER");
      return;
    }

    if (!stripe) {
      finishStripe(res, "error", 503, "STRIPE_NOT_CONFIGURED");
      return;
    }

    const response = await stripe.oauth.token({ grant_type: "authorization_code", code });
    const stripeAccountId = response.stripe_user_id;
    if (!stripeAccountId) {
      finishStripe(res, "error", 502, "NO_ACCOUNT");
      return;
    }

    // Tenant comes from OUR state record, never from the request.
    await tenantStore.run({ tenantId: binding.tenantId }, () =>
      prisma.tenant.update({
        where: { id: binding.tenantId },
        data: { stripeAccountId },
        select: { id: true },
      }),
    );

    finishStripe(res, "connected");
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------------
// POST /api/onboarding/:tenantId/branding — Update tenant branding
// --------------------------------------------------------------------------
router.post("/:tenantId/branding", ...ownerOfThisTenant, async (req, res, next) => {
  try {
    const data = brandingSchema.parse(req.body);
    const tenantId = req.tenantId!;

    const existing = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { brandingJson: true },
    });
    const current =
      existing?.brandingJson && typeof existing.brandingJson === "object" && !Array.isArray(existing.brandingJson)
        ? (existing.brandingJson as Record<string, unknown>)
        : {};

    const tenant = await prisma.tenant.update({
      where: { id: tenantId },
      data: {
        brandingJson: {
          ...current,
          logo: data.logo ?? "",
          primaryColor: data.primaryColor ?? "#0A2342",
          marinaName: data.marinaName ?? "",
          address: data.address ?? "",
          phone: data.phone ?? "",
          email: data.email ?? "",
          website: data.website ?? "",
        } as Prisma.InputJsonValue,
      },
      select: { id: true, name: true, brandingJson: true },
    });

    res.json({ tenant });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: "Validation failed", details: err.errors });
      return;
    }
    next(err);
  }
});

// --------------------------------------------------------------------------
// POST /api/onboarding/:tenantId/stripe — Start Stripe Connect OAuth
// --------------------------------------------------------------------------
router.post("/:tenantId/stripe", ...ownerOfThisTenant, async (req, res, next) => {
  try {
    const clientId = process.env.STRIPE_CLIENT_ID;
    const redirectUri = stripeRedirectUri();
    if (!clientId || !redirectUri) {
      res.status(503).json({ error: "Stripe Connect is not configured", code: "STRIPE_NOT_CONFIGURED" });
      return;
    }

    const state = await createOAuthState("stripe_connect", {
      tenantId: req.tenantId!,
      userId: req.userId!,
    });

    const params = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      scope: "read_write",
      redirect_uri: redirectUri,
      state,
      stripe_landing: "register",
    });

    res.json({ url: `https://connect.stripe.com/oauth/authorize?${params.toString()}` });
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------------
// POST /api/onboarding/:tenantId/chart-of-accounts — Seed default GL accounts
// --------------------------------------------------------------------------
router.post("/:tenantId/chart-of-accounts", ...ownerOfThisTenant, async (req, res, next) => {
  try {
    const tenantId = req.tenantId!;

    const already = await prisma.glAccount.count({ where: { tenantId } });
    if (already > 0) {
      res.status(409).json({ error: "Chart of accounts already seeded", code: "ALREADY_SEEDED" });
      return;
    }

    const defaultAccounts: { accountNumber: string; name: string; type: GLAccountType; isDeferredRevenue?: boolean }[] = [
      // Revenue accounts
      { accountNumber: "4010", name: "Slip Revenue", type: "REVENUE" },
      { accountNumber: "4020", name: "Transient Revenue", type: "REVENUE" },
      { accountNumber: "4030", name: "Rental Revenue", type: "REVENUE" },
      { accountNumber: "4040", name: "Damage Waiver Revenue", type: "REVENUE" },
      { accountNumber: "4050", name: "Fuel Revenue", type: "REVENUE" },
      { accountNumber: "4060", name: "Retail Revenue", type: "REVENUE" },
      { accountNumber: "4070", name: "Ramp Revenue", type: "REVENUE" },
      { accountNumber: "4080", name: "Concierge Revenue", type: "REVENUE" },
      { accountNumber: "4090", name: "Pump-Out Revenue", type: "REVENUE" },
      { accountNumber: "4100", name: "Electricity Revenue", type: "REVENUE" },
      // Liability accounts
      { accountNumber: "2100", name: "Deferred Revenue - Slips", type: "LIABILITY", isDeferredRevenue: true },
      { accountNumber: "2110", name: "Deferred Revenue - Rentals", type: "LIABILITY", isDeferredRevenue: true },
      { accountNumber: "2200", name: "Security Deposits Held", type: "LIABILITY" },
      { accountNumber: "2210", name: "Customer Deposits", type: "LIABILITY" },
      { accountNumber: "2300", name: "Tips Payable", type: "LIABILITY" },
      { accountNumber: "2400", name: "Sales Tax Payable", type: "LIABILITY" },
      // Expense accounts
      { accountNumber: "5000", name: "COGS", type: "EXPENSE" },
    ];

    await prisma.glAccount.createMany({
      data: defaultAccounts.map((a) => ({ tenantId, ...a })),
    });

    const accounts = await prisma.glAccount.findMany({
      where: { tenantId },
      orderBy: { accountNumber: "asc" },
    });

    res.status(201).json({ accounts });
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------------
// GET /api/onboarding/:tenantId/status — Onboarding progress
// --------------------------------------------------------------------------
router.get("/:tenantId/status", ...ownerOfThisTenant, async (req, res, next) => {
  try {
    const tenantId = req.tenantId!;

    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { brandingJson: true, stripeAccountId: true, qboRealmId: true, invoiceTemplateJson: true },
    });
    if (!tenant) {
      res.status(404).json({ error: "Tenant not found", code: "NOT_FOUND" });
      return;
    }

    const branding = tenant.brandingJson as Record<string, unknown> | null;
    const brandingComplete = !!branding && typeof branding === "object" && !!branding.marinaName;
    const accountCount = await prisma.glAccount.count({ where: { tenantId } });
    const settings = tenant.invoiceTemplateJson as Record<string, unknown> | null;

    const checklist = {
      branding: { status: brandingComplete ? "complete" : "incomplete", label: "Configure branding" },
      stripe: {
        status: tenant.stripeAccountId ? "connected" : "not_connected",
        label: "Connect Stripe account",
      },
      qbo: { status: tenant.qboRealmId ? "connected" : "not_connected", label: "Connect QuickBooks Online" },
      chartOfAccounts: { status: accountCount > 0 ? "seeded" : "not_seeded", label: "Seed chart of accounts" },
      twilio: {
        status: settings?.twilioPhoneNumber ? "provisioned" : "not_provisioned",
        label: "Provision phone number",
      },
    };

    res.json({ tenantId, checklist });
  } catch (err) {
    next(err);
  }
});

export default router;
