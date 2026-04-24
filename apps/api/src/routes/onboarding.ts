import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireStripe } from "../lib/stripe.js";

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
    .regex(/^\d{2}-\d{2}$/, "Must be MM-DD format")
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

// --------------------------------------------------------------------------
// POST /api/onboarding/start — Create tenant + admin user
// --------------------------------------------------------------------------
router.post("/start", async (req, res, next) => {
  try {
    const data = startSchema.parse(req.body);

    // Validate subdomain uniqueness
    const existing = await prisma.tenant.findFirst({
      where: { subdomain: data.subdomain },
    });
    if (existing) {
      res
        .status(409)
        .json({ error: "Subdomain already taken", code: "SUBDOMAIN_CONFLICT" });
      return;
    }

    // Create tenant
    const tenant = await prisma.tenant.create({
      data: {
        name: data.marinaName,
        subdomain: data.subdomain,
        status: "ACTIVE",
        timezone: data.timezone,
        fiscalYearEnd: data.fiscalYearEnd,
        brandingJson: {},
      },
    });

    // Create tenant-specific PostgreSQL schema
    const schemaName = `tenant_${tenant.id.replace(/-/g, "_")}`;
    await prisma.$executeRawUnsafe(`CREATE SCHEMA IF NOT EXISTS "${schemaName}"`);

    // Create admin user with MARINA_OWNER role
    const adminUser = await prisma.user.create({
      data: {
        tenantId: tenant.id,
        email: data.adminEmail,
        firstName: data.adminFirstName,
        lastName: data.adminLastName,
        role: "MARINA_OWNER",
      },
    });

    // Setup steps checklist
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
// POST /api/onboarding/:tenantId/branding — Update tenant branding
// --------------------------------------------------------------------------
router.post("/:tenantId/branding", async (req, res, next) => {
  try {
    const { tenantId } = req.params;
    const data = brandingSchema.parse(req.body);

    const tenant = await prisma.tenant.update({
      where: { id: tenantId },
      data: {
        brandingJson: {
          logo: data.logo ?? "",
          primaryColor: data.primaryColor ?? "#0A2342",
          marinaName: data.marinaName ?? "",
          address: data.address ?? "",
          phone: data.phone ?? "",
          email: data.email ?? "",
          website: data.website ?? "",
        },
      },
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
// POST /api/onboarding/:tenantId/stripe — Begin or resume Stripe onboarding
// --------------------------------------------------------------------------
// Uses Accounts v2 (Stripe's recommended API for new Connect platforms):
//   - dashboard: "full"       → marina gets access to the real Stripe Dashboard
//   - fees_collector: stripe  → marina pays Stripe processing fees directly
//   - losses_collector: stripe → marina is liable for negative balances
//   - merchant configuration + card_payments capability
//
// The marina pays Stripe fees and handles their own disputes/payouts.
// Helm captures its cut per transaction via application_fee_amount.
//
// If Accounts v2 isn't yet enabled on the platform (request access in the
// Stripe Dashboard under Connect > Platform setup), the create call will
// error and the message is surfaced verbatim.
// --------------------------------------------------------------------------
router.post("/:tenantId/stripe", async (req, res, next) => {
  try {
    const { tenantId } = req.params;

    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) {
      res.status(404).json({ error: "Tenant not found", code: "NOT_FOUND" });
      return;
    }

    const s = requireStripe();

    // If we don't have a connected account yet, create one.
    let stripeAccountId = tenant.stripeAccountId;
    if (!stripeAccountId) {
      // Stripe's v2 Accounts API is reached via stripe.v2.core.accounts.
      // The TypeScript SDK may mark this as unknown until v2 support ships;
      // cast to call it.
      const v2 = (s as unknown as {
        v2: {
          core: {
            accounts: {
              create: (params: Record<string, unknown>) => Promise<{ id: string }>;
            };
          };
        };
      }).v2;

      const account = await v2.core.accounts.create({
        contact_email: req.body?.ownerEmail ?? undefined,
        display_name: tenant.name,
        dashboard: "full",
        identity: {
          country: req.body?.country ?? "us",
          entity_type: req.body?.entityType ?? "company",
          business_details: { registered_name: tenant.name },
        },
        configuration: {
          merchant: {
            capabilities: {
              card_payments: { requested: true },
            },
          },
        },
        defaults: {
          currency: "usd",
          responsibilities: {
            fees_collector: "stripe",
            losses_collector: "stripe",
          },
          locales: ["en-US"],
        },
      });

      stripeAccountId = account.id;

      await prisma.tenant.update({
        where: { id: tenantId },
        data: { stripeAccountId },
      });
    }

    // Hand the marina a hosted onboarding URL. AccountLinks accepts the v2
    // account id; Stripe renders its own onboarding flow.
    const appUrl = process.env.APP_URL ?? "http://localhost:5000";
    const link = await s.accountLinks.create({
      account: stripeAccountId,
      refresh_url: `${appUrl}/settings/stripe?refresh=true`,
      return_url: `${appUrl}/settings/stripe?success=true`,
      type: "account_onboarding",
    });

    res.json({ url: link.url, stripeAccountId });
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------------
// POST /api/onboarding/:tenantId/qbo — Initiate QBO OAuth
// --------------------------------------------------------------------------
router.post("/:tenantId/qbo", async (req, res, next) => {
  try {
    const { tenantId } = req.params;

    // Verify tenant exists
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) {
      res.status(404).json({ error: "Tenant not found", code: "NOT_FOUND" });
      return;
    }

    const clientId = process.env.QBO_CLIENT_ID;
    const redirectUri = `${process.env.APP_URL}/api/onboarding/${tenantId}/qbo/callback`;
    const scope = "com.intuit.quickbooks.accounting";

    const authUrl =
      `https://appcenter.intuit.com/connect/oauth2?` +
      `client_id=${clientId}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&scope=${scope}` +
      `&response_type=code` +
      `&state=${tenantId}`;

    res.json({ url: authUrl });
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------------
// GET /api/onboarding/:tenantId/qbo/callback — QBO OAuth callback
// --------------------------------------------------------------------------
router.get("/:tenantId/qbo/callback", async (req, res, next) => {
  try {
    const { tenantId } = req.params;
    const { code, realmId } = req.query;

    if (!code || typeof code !== "string") {
      res.status(400).json({ error: "Missing authorization code" });
      return;
    }
    if (!realmId || typeof realmId !== "string") {
      res.status(400).json({ error: "Missing realmId" });
      return;
    }

    // Exchange code for tokens
    const clientId = process.env.QBO_CLIENT_ID;
    const clientSecret = process.env.QBO_CLIENT_SECRET;
    const redirectUri = `${process.env.APP_URL}/api/onboarding/${tenantId}/qbo/callback`;

    const tokenResponse = await fetch(
      "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
          Accept: "application/json",
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: redirectUri,
        }).toString(),
      },
    );

    if (!tokenResponse.ok) {
      const errBody = await tokenResponse.text();
      res.status(502).json({ error: "QBO token exchange failed", details: errBody });
      return;
    }

    // Store realmId on tenant
    const tenant = await prisma.tenant.update({
      where: { id: tenantId },
      data: { qboRealmId: realmId as string },
    });

    res.json({ success: true, qboRealmId: realmId, tenant });
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------------
// POST /api/onboarding/:tenantId/chart-of-accounts — Seed default GL accounts
// --------------------------------------------------------------------------
router.post("/:tenantId/chart-of-accounts", async (req, res, next) => {
  try {
    const { tenantId } = req.params;

    // Verify tenant exists
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) {
      res.status(404).json({ error: "Tenant not found", code: "NOT_FOUND" });
      return;
    }

    const defaultAccounts = [
      // Revenue accounts
      { code: "4010", name: "Slip Revenue", type: "REVENUE" },
      { code: "4020", name: "Transient Revenue", type: "REVENUE" },
      { code: "4030", name: "Rental Revenue", type: "REVENUE" },
      { code: "4040", name: "Damage Waiver Revenue", type: "REVENUE" },
      { code: "4050", name: "Fuel Revenue", type: "REVENUE" },
      { code: "4060", name: "Retail Revenue", type: "REVENUE" },
      { code: "4070", name: "Ramp Revenue", type: "REVENUE" },
      { code: "4080", name: "Concierge Revenue", type: "REVENUE" },
      { code: "4090", name: "Pump-Out Revenue", type: "REVENUE" },
      { code: "4100", name: "Electricity Revenue", type: "REVENUE" },
      // Liability accounts
      { code: "2100", name: "Deferred Revenue - Slips", type: "LIABILITY" },
      { code: "2110", name: "Deferred Revenue - Rentals", type: "LIABILITY" },
      { code: "2200", name: "Security Deposits Held", type: "LIABILITY" },
      { code: "2210", name: "Customer Deposits", type: "LIABILITY" },
      { code: "2300", name: "Tips Payable", type: "LIABILITY" },
      { code: "2400", name: "Sales Tax Payable", type: "LIABILITY" },
      // Expense accounts
      { code: "5000", name: "COGS", type: "EXPENSE" },
    ];

    const createdAccounts = await Promise.all(
      defaultAccounts.map((account) =>
        prisma.gLAccount.create({
          data: {
            tenant_id: tenantId,
            code: account.code,
            name: account.name,
            type: account.type,
            active: true,
            balance_cents: 0,
          },
        }),
      ),
    );

    res.status(201).json({ accounts: createdAccounts });
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------------
// GET /api/onboarding/:tenantId/status — Get onboarding progress
// --------------------------------------------------------------------------
router.get("/:tenantId/status", async (req, res, next) => {
  try {
    const { tenantId } = req.params;

    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) {
      res.status(404).json({ error: "Tenant not found", code: "NOT_FOUND" });
      return;
    }

    // Check branding
    const branding = (tenant as Record<string, unknown>).branding as Record<string, unknown> | null;
    const brandingComplete =
      !!branding && typeof branding === "object" && !!branding.marinaName;

    // Check Stripe
    const stripeConnected = !!tenant.stripeAccountId;

    // Check QBO
    const qboConnected = !!(tenant as Record<string, unknown>).qbo_realm_id;

    // Check chart of accounts
    const accountCount = await prisma.gLAccount.count({
      where: { tenant_id: tenantId },
    });
    const chartOfAccountsSeeded = accountCount > 0;

    // Check Twilio (phone provisioning) — look for a settings flag
    const settings = (tenant as Record<string, unknown>).settings as Record<string, unknown> | null;
    const twilioProvisioned = !!settings?.twilioPhoneNumber;

    const checklist = {
      branding: {
        status: brandingComplete ? "complete" : "incomplete",
        label: "Configure branding",
      },
      stripe: {
        status: stripeConnected ? "connected" : "not_connected",
        label: "Connect Stripe account",
      },
      qbo: {
        status: qboConnected ? "connected" : "not_connected",
        label: "Connect QuickBooks Online",
      },
      chartOfAccounts: {
        status: chartOfAccountsSeeded ? "seeded" : "not_seeded",
        label: "Seed chart of accounts",
      },
      twilio: {
        status: twilioProvisioned ? "provisioned" : "not_provisioned",
        label: "Provision phone number",
      },
    };

    res.json({ tenantId, checklist });
  } catch (err) {
    next(err);
  }
});

export default router;
