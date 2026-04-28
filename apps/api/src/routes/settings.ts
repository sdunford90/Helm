import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { clerkAuth, requireRole } from "../middleware/auth.js";
import { stripe, requireStripe } from "../lib/stripe.js";
import { issueOAuthState } from "../lib/oauth-state.js";

const router: Router = Router();

// --------------------------------------------------------------------------
// Zod schemas
// --------------------------------------------------------------------------

const marinaProfileSchema = z.object({
  name: z.string().min(1).max(255),
  address: z.string().max(500).optional(),
  phone: z.string().max(30).optional(),
  email: z.string().email().optional(),
  website: z.string().url().optional().or(z.literal("")),
  timezone: z.string().min(1),
  fiscalYearEnd: z
    .string()
    .regex(/^\d{2}\/\d{2}$/, "Must be MM/DD format"),
});

const brandingSchema = z.object({
  logoUrl: z.string().url().optional().or(z.literal("")),
  primaryColor: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/, "Must be a valid hex color")
    .optional(),
  secondaryColor: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/, "Must be a valid hex color")
    .optional(),
  faviconUrl: z.string().url().optional().or(z.literal("")),
  companyDisplayName: z.string().max(100).optional(),
  tagline: z.string().max(200).optional(),
});

const billingSchema = z.object({
  defaultPaymentTerms: z.enum(["NET_15", "NET_30", "NET_45", "NET_60"]).optional(),
  lateFeePercent: z.number().min(0).max(100).optional(),
  lateFeeGraceDays: z.number().int().min(0).optional(),
  autoChargeEnabled: z.boolean().optional(),
  invoicePrefix: z.string().max(10).optional(),
  nextInvoiceNumber: z.number().int().min(1).optional(),
  taxRate: z.number().min(0).max(100).optional(),
  electricityRatePerKwh: z.number().min(0).optional(),
  securityDepositDefault: z.number().int().min(0).optional(),
});

const notificationsSchema = z.object({
  emailNotificationsEnabled: z.boolean().optional(),
  smsNotificationsEnabled: z.boolean().optional(),
  invoiceCreatedEmail: z.boolean().optional(),
  paymentReceivedEmail: z.boolean().optional(),
  paymentOverdueEmail: z.boolean().optional(),
  contractExpiringEmail: z.boolean().optional(),
  welcomeEmail: z.boolean().optional(),
  maintenanceAlertEmail: z.boolean().optional(),
});

const inviteTeamMemberSchema = z.object({
  email: z.string().email(),
  role: z.enum([
    "MARINA_OWNER",
    "MARINA_MANAGER",
    "DOCK_STAFF",
    "POS_CASHIER",
    "ACCOUNTING",
  ]),
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
});

const updateRoleSchema = z.object({
  role: z.enum([
    "MARINA_OWNER",
    "MARINA_MANAGER",
    "DOCK_STAFF",
    "POS_CASHIER",
    "ACCOUNTING",
  ]),
});

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

function getTenantSettings(tenant: Record<string, unknown>): Record<string, unknown> {
  const raw = tenant.settings ?? tenant.invoiceTemplateJson;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return {};
}

function getTenantBranding(tenant: Record<string, unknown>): Record<string, unknown> {
  const raw = tenant.brandingJson;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return {};
}

// --------------------------------------------------------------------------
// GET /api/settings/marina
// --------------------------------------------------------------------------
router.get("/marina", ...clerkAuth(), requireRole("MARINA_OWNER", "MARINA_MANAGER"), async (req, res, next) => {
  try {
    const tenant = await prisma.tenant.findUnique({
      where: { id: req.tenantId! },
    });

    if (!tenant) {
      res.status(404).json({ error: "Tenant not found", code: "NOT_FOUND" });
      return;
    }

    const t = tenant as unknown as Record<string, unknown>;
    const branding = getTenantBranding(t);

    res.json({
      name: tenant.name,
      address: branding.address ?? "",
      phone: branding.phone ?? "",
      email: branding.email ?? "",
      website: branding.website ?? "",
      timezone: tenant.timezone,
      fiscalYearEnd: tenant.fiscalYearEnd,
    });
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------------
// PUT /api/settings/marina
// --------------------------------------------------------------------------
router.put("/marina", ...clerkAuth(), requireRole("MARINA_OWNER", "MARINA_MANAGER"), async (req, res, next) => {
  try {
    const data = marinaProfileSchema.parse(req.body);

    const existing = await prisma.tenant.findUnique({
      where: { id: req.tenantId! },
    });
    if (!existing) {
      res.status(404).json({ error: "Tenant not found", code: "NOT_FOUND" });
      return;
    }

    const existingBranding = getTenantBranding(existing as unknown as Record<string, unknown>);

    const tenant = await prisma.tenant.update({
      where: { id: req.tenantId! },
      data: {
        name: data.name,
        timezone: data.timezone,
        fiscalYearEnd: data.fiscalYearEnd,
        brandingJson: {
          ...existingBranding,
          address: data.address ?? "",
          phone: data.phone ?? "",
          email: data.email ?? "",
          website: data.website ?? "",
        },
      },
    });

    res.json({
      name: tenant.name,
      address: data.address ?? "",
      phone: data.phone ?? "",
      email: data.email ?? "",
      website: data.website ?? "",
      timezone: tenant.timezone,
      fiscalYearEnd: tenant.fiscalYearEnd,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: "Validation failed", details: err.errors });
      return;
    }
    next(err);
  }
});

// --------------------------------------------------------------------------
// GET /api/settings/branding
// --------------------------------------------------------------------------
router.get("/branding", ...clerkAuth(), requireRole("MARINA_OWNER", "MARINA_MANAGER"), async (req, res, next) => {
  try {
    const tenant = await prisma.tenant.findUnique({
      where: { id: req.tenantId! },
    });

    if (!tenant) {
      res.status(404).json({ error: "Tenant not found", code: "NOT_FOUND" });
      return;
    }

    const branding = getTenantBranding(tenant as unknown as Record<string, unknown>);

    res.json({
      logoUrl: branding.logo ?? branding.logoUrl ?? "",
      primaryColor: branding.primaryColor ?? "#0A2342",
      secondaryColor: branding.secondaryColor ?? "#00D4FF",
      faviconUrl: branding.faviconUrl ?? "",
      companyDisplayName: branding.companyDisplayName ?? "",
      tagline: branding.tagline ?? "",
    });
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------------
// PUT /api/settings/branding
// --------------------------------------------------------------------------
router.put("/branding", ...clerkAuth(), requireRole("MARINA_OWNER", "MARINA_MANAGER"), async (req, res, next) => {
  try {
    const data = brandingSchema.parse(req.body);

    const existing = await prisma.tenant.findUnique({
      where: { id: req.tenantId! },
    });
    if (!existing) {
      res.status(404).json({ error: "Tenant not found", code: "NOT_FOUND" });
      return;
    }

    const existingBranding = getTenantBranding(existing as unknown as Record<string, unknown>);

    const updatedBranding = {
      ...existingBranding,
      logoUrl: data.logoUrl ?? existingBranding.logoUrl ?? "",
      primaryColor: data.primaryColor ?? existingBranding.primaryColor ?? "#0A2342",
      secondaryColor: data.secondaryColor ?? existingBranding.secondaryColor ?? "#00D4FF",
      faviconUrl: data.faviconUrl ?? existingBranding.faviconUrl ?? "",
      companyDisplayName: data.companyDisplayName ?? existingBranding.companyDisplayName ?? "",
      tagline: data.tagline ?? existingBranding.tagline ?? "",
    };

    await prisma.tenant.update({
      where: { id: req.tenantId! },
      data: { brandingJson: updatedBranding },
    });

    res.json({
      logoUrl: updatedBranding.logoUrl,
      primaryColor: updatedBranding.primaryColor,
      secondaryColor: updatedBranding.secondaryColor,
      faviconUrl: updatedBranding.faviconUrl,
      companyDisplayName: updatedBranding.companyDisplayName,
      tagline: updatedBranding.tagline,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: "Validation failed", details: err.errors });
      return;
    }
    next(err);
  }
});

// --------------------------------------------------------------------------
// GET /api/settings/billing
// --------------------------------------------------------------------------
router.get("/billing", ...clerkAuth(), requireRole("MARINA_OWNER", "MARINA_MANAGER", "ACCOUNTING"), async (req, res, next) => {
  try {
    const tenant = await prisma.tenant.findUnique({
      where: { id: req.tenantId! },
    });

    if (!tenant) {
      res.status(404).json({ error: "Tenant not found", code: "NOT_FOUND" });
      return;
    }

    const t = tenant as unknown as Record<string, unknown>;
    const invoiceTemplate = (t.invoiceTemplateJson && typeof t.invoiceTemplateJson === "object")
      ? t.invoiceTemplateJson as Record<string, unknown>
      : {};

    res.json({
      defaultPaymentTerms: invoiceTemplate.defaultPaymentTerms ?? "NET_30",
      lateFeePercent: invoiceTemplate.lateFeePercent ?? 1.5,
      lateFeeGraceDays: invoiceTemplate.lateFeeGraceDays ?? 10,
      autoChargeEnabled: invoiceTemplate.autoChargeEnabled ?? false,
      invoicePrefix: invoiceTemplate.invoicePrefix ?? "INV-",
      nextInvoiceNumber: invoiceTemplate.nextInvoiceNumber ?? 1001,
      taxRate: invoiceTemplate.taxRate ?? 0,
      electricityRatePerKwh: invoiceTemplate.electricityRatePerKwh ?? 0.12,
      securityDepositDefault: invoiceTemplate.securityDepositDefault ?? 50000,
    });
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------------
// PUT /api/settings/billing
// --------------------------------------------------------------------------
router.put("/billing", ...clerkAuth(), requireRole("MARINA_OWNER", "MARINA_MANAGER", "ACCOUNTING"), async (req, res, next) => {
  try {
    const data = billingSchema.parse(req.body);

    const existing = await prisma.tenant.findUnique({
      where: { id: req.tenantId! },
    });
    if (!existing) {
      res.status(404).json({ error: "Tenant not found", code: "NOT_FOUND" });
      return;
    }

    const t = existing as unknown as Record<string, unknown>;
    const existingTemplate = (t.invoiceTemplateJson && typeof t.invoiceTemplateJson === "object")
      ? t.invoiceTemplateJson as Record<string, unknown>
      : {};

    const updated = { ...existingTemplate, ...data };

    await prisma.tenant.update({
      where: { id: req.tenantId! },
      data: { invoiceTemplateJson: updated },
    });

    res.json(updated);
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: "Validation failed", details: err.errors });
      return;
    }
    next(err);
  }
});

// --------------------------------------------------------------------------
// GET /api/settings/stripe?locationId=xxx
// --------------------------------------------------------------------------
router.get("/stripe", ...clerkAuth(), requireRole("MARINA_OWNER", "MARINA_MANAGER"), async (req, res, next) => {
  try {
    const { locationId } = req.query as { locationId?: string };

    if (locationId) {
      const location = await prisma.location.findFirst({
        where: { id: locationId, tenantId: req.tenantId! },
        select: { stripeAccountId: true, stripeOnboardingComplete: true },
      });
      if (!location) {
        res.status(404).json({ error: "Location not found", code: "NOT_FOUND" });
        return;
      }
      const accountId = location.stripeAccountId;
      const connected = !!accountId && !!location.stripeOnboardingComplete;
      res.json({
        connected,
        onboardingComplete: !!location.stripeOnboardingComplete,
        accountId: accountId ? `****${accountId.slice(-4)}` : null,
        dashboardUrl: accountId ? `https://dashboard.stripe.com/${accountId}` : null,
      });
      return;
    }

    const tenant = await prisma.tenant.findUnique({
      where: { id: req.tenantId! },
    });

    if (!tenant) {
      res.status(404).json({ error: "Tenant not found", code: "NOT_FOUND" });
      return;
    }

    const accountId = tenant.stripeAccountId;
    const connected = !!accountId;

    res.json({
      connected,
      accountId: accountId ? `****${accountId.slice(-4)}` : null,
      dashboardUrl: connected
        ? `https://dashboard.stripe.com/${accountId}`
        : null,
    });
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------------
// POST /api/settings/stripe/connect  { locationId? }
// --------------------------------------------------------------------------
router.post("/stripe/connect", ...clerkAuth(), requireRole("MARINA_OWNER"), async (req, res, next) => {
  try {
    const { locationId } = req.body as { locationId?: string };

    if (locationId) {
      const location = await prisma.location.findFirst({
        where: { id: locationId, tenantId: req.tenantId! },
        select: { id: true, stripeAccountId: true },
      });
      if (!location) {
        res.status(404).json({ error: "Location not found", code: "NOT_FOUND" });
        return;
      }

      let accountId = location.stripeAccountId;
      if (!accountId) {
        const account = await requireStripe().accounts.create({ type: "standard" });
        accountId = account.id;
        await prisma.location.update({
          where: { id: locationId },
          data: { stripeAccountId: accountId, stripeOnboardingComplete: false },
        });
      }

      const accountLink = await requireStripe().accountLinks.create({
        account: accountId,
        refresh_url: `${process.env.APP_URL}/oauth-complete?provider=stripe&success=false&locationId=${locationId}`,
        return_url: `${process.env.APP_URL}/oauth-complete?provider=stripe&success=true&locationId=${locationId}`,
        type: "account_onboarding",
      });

      res.json({ url: accountLink.url });
      return;
    }

    const tenant = await prisma.tenant.findUnique({
      where: { id: req.tenantId! },
    });

    if (!tenant) {
      res.status(404).json({ error: "Tenant not found", code: "NOT_FOUND" });
      return;
    }

    // Create a Stripe Connect account if one doesn't exist
    let accountId = tenant.stripeAccountId;
    if (!accountId) {
      const account = await requireStripe().accounts.create({ type: "standard" });
      accountId = account.id;
      await prisma.tenant.update({
        where: { id: req.tenantId! },
        data: { stripeAccountId: accountId },
      });
    }

    const accountLink = await requireStripe().accountLinks.create({
      account: accountId,
      refresh_url: `${process.env.APP_URL}/oauth-complete?provider=stripe&success=false`,
      return_url: `${process.env.APP_URL}/oauth-complete?provider=stripe&success=true`,
      type: "account_onboarding",
    });

    res.json({ url: accountLink.url });
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------------
// POST /api/settings/stripe/disconnect  { locationId?, confirm }
// --------------------------------------------------------------------------
router.post("/stripe/disconnect", ...clerkAuth(), requireRole("MARINA_OWNER"), async (req, res, next) => {
  try {
    const { confirm, locationId } = req.body;
    if (confirm !== true) {
      res.status(400).json({ error: "Confirmation required", code: "CONFIRMATION_REQUIRED" });
      return;
    }

    if (locationId) {
      const location = await prisma.location.findFirst({
        where: { id: locationId, tenantId: req.tenantId! },
      });
      if (!location) {
        res.status(404).json({ error: "Location not found", code: "NOT_FOUND" });
        return;
      }
      await prisma.location.update({
        where: { id: locationId },
        data: { stripeAccountId: null, stripeOnboardingComplete: false },
      });
    } else {
      await prisma.tenant.update({
        where: { id: req.tenantId! },
        data: { stripeAccountId: null },
      });
    }

    res.json({ disconnected: true });
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------------
// GET /api/settings/qbo?locationId=xxx
// --------------------------------------------------------------------------
router.get("/qbo", ...clerkAuth(), requireRole("MARINA_OWNER", "MARINA_MANAGER", "ACCOUNTING"), async (req, res, next) => {
  try {
    const { locationId } = req.query as { locationId?: string };

    if (locationId) {
      // Location-scoped QBO status
      const location = await prisma.location.findFirst({
        where: { id: locationId, tenantId: req.tenantId! },
        select: { qboRealmId: true, qboConnectedAt: true },
      });
      if (!location) {
        res.status(404).json({ error: "Location not found", code: "NOT_FOUND" });
        return;
      }
      res.json({
        connected: !!location.qboRealmId,
        realmId: location.qboRealmId ?? null,
        connectedAt: location.qboConnectedAt ?? null,
        lastSync: null,
      });
      return;
    }

    // Legacy tenant-level fallback
    const tenant = await prisma.tenant.findUnique({ where: { id: req.tenantId! } });
    if (!tenant) { res.status(404).json({ error: "Tenant not found", code: "NOT_FOUND" }); return; }
    const t = tenant as unknown as Record<string, unknown>;
    const settings = (t.invoiceTemplateJson && typeof t.invoiceTemplateJson === "object")
      ? t.invoiceTemplateJson as Record<string, unknown> : {};
    res.json({ connected: !!tenant.qboRealmId, realmId: tenant.qboRealmId ?? null, lastSync: settings.qboLastSync ?? null });
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------------
// POST /api/settings/qbo/connect  { locationId? }
// --------------------------------------------------------------------------
router.post("/qbo/connect", ...clerkAuth(), requireRole("MARINA_OWNER"), async (req, res, next) => {
  try {
    const { locationId } = req.body as { locationId?: string };

    if (locationId) {
      const location = await prisma.location.findFirst({ where: { id: locationId, tenantId: req.tenantId! } });
      if (!location) { res.status(404).json({ error: "Location not found", code: "NOT_FOUND" }); return; }
    }

    const clientId = process.env.QBO_CLIENT_ID;
    const redirectUri = process.env.QBO_REDIRECT_URI;
    if (!redirectUri) {
      res.status(500).json({ error: "QBO_REDIRECT_URI is not configured", code: "MISSING_CONFIG" });
      return;
    }
    const scope = "com.intuit.quickbooks.accounting";
    // Embed locationId in the signed state so the callback knows which location to bind.
    const state = issueOAuthState(req.tenantId!, { locationId: locationId ?? undefined });

    const authUrl =
      `https://appcenter.intuit.com/connect/oauth2?` +
      `client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&scope=${scope}&response_type=code&state=${encodeURIComponent(state)}`;

    res.json({ url: authUrl });
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------------
// POST /api/settings/qbo/disconnect  { locationId?, confirm }
// --------------------------------------------------------------------------
router.post("/qbo/disconnect", ...clerkAuth(), requireRole("MARINA_OWNER"), async (req, res, next) => {
  try {
    const { confirm, locationId } = req.body as { confirm: boolean; locationId?: string };
    if (confirm !== true) {
      res.status(400).json({ error: "Confirmation required", code: "CONFIRMATION_REQUIRED" });
      return;
    }

    if (locationId) {
      const location = await prisma.location.findFirst({ where: { id: locationId, tenantId: req.tenantId! } });
      if (!location) { res.status(404).json({ error: "Location not found", code: "NOT_FOUND" }); return; }
      await prisma.location.update({
        where: { id: locationId },
        data: { qboRealmId: null, qboAccessToken: null, qboRefreshToken: null, qboTokenExpiresAt: null, qboConnectedAt: null },
      });
    } else {
      await prisma.tenant.update({ where: { id: req.tenantId! }, data: { qboRealmId: null } });
    }

    res.json({ disconnected: true });
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------------
// POST /api/settings/qbo/sync  { locationId? }
// --------------------------------------------------------------------------
router.post("/qbo/sync", ...clerkAuth(), requireRole("MARINA_OWNER", "MARINA_MANAGER", "ACCOUNTING"), async (req, res, next) => {
  try {
    const { locationId } = req.body as { locationId?: string };

    if (locationId) {
      const location = await prisma.location.findFirst({ where: { id: locationId, tenantId: req.tenantId! } });
      if (!location) { res.status(404).json({ error: "Location not found", code: "NOT_FOUND" }); return; }
      if (!location.qboRealmId) { res.status(400).json({ error: "QuickBooks is not connected for this location", code: "QBO_NOT_CONNECTED" }); return; }
    } else {
      const tenant = await prisma.tenant.findUnique({ where: { id: req.tenantId! } });
      if (!tenant) { res.status(404).json({ error: "Tenant not found", code: "NOT_FOUND" }); return; }
      if (!tenant.qboRealmId) { res.status(400).json({ error: "QuickBooks is not connected", code: "QBO_NOT_CONNECTED" }); return; }
      const t = tenant as unknown as Record<string, unknown>;
      const existingTemplate = (t.invoiceTemplateJson && typeof t.invoiceTemplateJson === "object")
        ? t.invoiceTemplateJson as Record<string, unknown> : {};
      await prisma.tenant.update({ where: { id: req.tenantId! }, data: { invoiceTemplateJson: { ...existingTemplate, qboLastSync: new Date().toISOString() } } });
    }

    res.json({ syncing: true, startedAt: new Date().toISOString() });
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------------
// GET /api/settings/locations/:id  — per-location settings
// --------------------------------------------------------------------------
router.get("/locations/:id", ...clerkAuth(), requireRole("MARINA_OWNER", "MARINA_MANAGER"), async (req, res, next) => {
  try {
    const location = await prisma.location.findFirst({
      where: { id: req.params.id, tenantId: req.tenantId! },
      select: {
        id: true,
        name: true,
        address: true,
        city: true,
        state: true,
        zip: true,
        phone: true,
        timezone: true,
        active: true,
        transientEnabled: true,
        rentalsEnabled: true,
        autoExecuteRenewals: true,
        logoUrl: true,
        brandingJson: true,
        qboRealmId: true,
        qboConnectedAt: true,
        stripeAccountId: true,
        stripeOnboardingComplete: true,
      },
    });

    if (!location) {
      res.status(404).json({ error: "Location not found", code: "NOT_FOUND" });
      return;
    }

    res.json({
      location: {
        ...location,
        qboConnected: !!location.qboRealmId,
        stripeConnected: !!location.stripeAccountId && !!location.stripeOnboardingComplete,
      },
    });
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------------
// PUT /api/settings/locations/:id  — update per-location settings
// --------------------------------------------------------------------------
router.put("/locations/:id", ...clerkAuth(), requireRole("MARINA_OWNER", "MARINA_MANAGER"), async (req, res, next) => {
  try {
    const location = await prisma.location.findFirst({
      where: { id: req.params.id, tenantId: req.tenantId! },
    });

    if (!location) {
      res.status(404).json({ error: "Location not found", code: "NOT_FOUND" });
      return;
    }

    const { name, address, city, state, zip, phone, timezone, active, transientEnabled, rentalsEnabled, autoExecuteRenewals, logoUrl } =
      req.body as Partial<{
        name: string; address: string; city: string; state: string; zip: string; phone: string;
        timezone: string; active: boolean; transientEnabled: boolean; rentalsEnabled: boolean;
        autoExecuteRenewals: boolean; logoUrl: string;
      }>;

    const updated = await prisma.location.update({
      where: { id: req.params.id },
      data: {
        ...(name !== undefined && { name }),
        ...(address !== undefined && { address }),
        ...(city !== undefined && { city }),
        ...(state !== undefined && { state }),
        ...(zip !== undefined && { zip }),
        ...(phone !== undefined && { phone }),
        ...(timezone !== undefined && { timezone }),
        ...(active !== undefined && { active }),
        ...(transientEnabled !== undefined && { transientEnabled }),
        ...(rentalsEnabled !== undefined && { rentalsEnabled }),
        ...(autoExecuteRenewals !== undefined && { autoExecuteRenewals }),
        ...(logoUrl !== undefined && { logoUrl }),
      },
      select: {
        id: true, name: true, address: true, city: true, state: true, zip: true, phone: true,
        timezone: true, active: true, transientEnabled: true, rentalsEnabled: true,
        autoExecuteRenewals: true, logoUrl: true, qboRealmId: true, qboConnectedAt: true,
      },
    });

    res.json({ location: { ...updated, qboConnected: !!updated.qboRealmId } });
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------------
// GET /api/settings/team
// --------------------------------------------------------------------------
router.get("/team", ...clerkAuth(), requireRole("MARINA_OWNER", "MARINA_MANAGER"), async (req, res, next) => {
  try {
    const users = await prisma.user.findMany({
      where: { tenantId: req.tenantId! },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        active: true,
        createdAt: true,
      },
    });

    res.json({ members: users });
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------------
// POST /api/settings/team/invite
// --------------------------------------------------------------------------
router.post("/team/invite", ...clerkAuth(), requireRole("MARINA_OWNER", "MARINA_MANAGER"), async (req, res, next) => {
  try {
    const data = inviteTeamMemberSchema.parse(req.body);

    // Check if user already exists in this tenant
    const existing = await prisma.user.findFirst({
      where: { tenantId: req.tenantId!, email: data.email },
    });

    if (existing) {
      res.status(409).json({ error: "User with this email already exists in this marina", code: "DUPLICATE_USER" });
      return;
    }

    const user = await prisma.user.create({
      data: {
        tenantId: req.tenantId!,
        email: data.email,
        firstName: data.firstName,
        lastName: data.lastName,
        role: data.role,
        active: true,
      },
    });

    res.status(201).json({ member: user });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: "Validation failed", details: err.errors });
      return;
    }
    next(err);
  }
});

// --------------------------------------------------------------------------
// PUT /api/settings/team/:userId/role
// --------------------------------------------------------------------------
router.put("/team/:userId/role", ...clerkAuth(), requireRole("MARINA_OWNER"), async (req, res, next) => {
  try {
    const data = updateRoleSchema.parse(req.body);

    // Prevent changing own role
    if (req.params.userId === req.userId) {
      res.status(400).json({ error: "Cannot change your own role", code: "SELF_ROLE_CHANGE" });
      return;
    }

    const user = await prisma.user.findFirst({
      where: { id: req.params.userId, tenantId: req.tenantId! },
    });

    if (!user) {
      res.status(404).json({ error: "User not found", code: "NOT_FOUND" });
      return;
    }

    const updated = await prisma.user.update({
      where: { id: req.params.userId },
      data: { role: data.role },
    });

    res.json({ member: updated });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: "Validation failed", details: err.errors });
      return;
    }
    next(err);
  }
});

// --------------------------------------------------------------------------
// DELETE /api/settings/team/:userId
// --------------------------------------------------------------------------
router.delete("/team/:userId", ...clerkAuth(), requireRole("MARINA_OWNER"), async (req, res, next) => {
  try {
    // Prevent removing self
    if (req.params.userId === req.userId) {
      res.status(400).json({ error: "Cannot remove yourself", code: "SELF_REMOVAL" });
      return;
    }

    const user = await prisma.user.findFirst({
      where: { id: req.params.userId, tenantId: req.tenantId! },
    });

    if (!user) {
      res.status(404).json({ error: "User not found", code: "NOT_FOUND" });
      return;
    }

    await prisma.user.update({
      where: { id: req.params.userId },
      data: { active: false },
    });

    res.json({ removed: true });
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------------
// GET /api/settings/notifications
// --------------------------------------------------------------------------
router.get("/notifications", ...clerkAuth(), requireRole("MARINA_OWNER", "MARINA_MANAGER"), async (req, res, next) => {
  try {
    const tenant = await prisma.tenant.findUnique({
      where: { id: req.tenantId! },
    });

    if (!tenant) {
      res.status(404).json({ error: "Tenant not found", code: "NOT_FOUND" });
      return;
    }

    const t = tenant as unknown as Record<string, unknown>;
    const settings = (t.invoiceTemplateJson && typeof t.invoiceTemplateJson === "object")
      ? t.invoiceTemplateJson as Record<string, unknown>
      : {};

    res.json({
      emailNotificationsEnabled: settings.emailNotificationsEnabled ?? true,
      smsNotificationsEnabled: settings.smsNotificationsEnabled ?? false,
      invoiceCreatedEmail: settings.invoiceCreatedEmail ?? true,
      paymentReceivedEmail: settings.paymentReceivedEmail ?? true,
      paymentOverdueEmail: settings.paymentOverdueEmail ?? true,
      contractExpiringEmail: settings.contractExpiringEmail ?? true,
      welcomeEmail: settings.welcomeEmail ?? true,
      maintenanceAlertEmail: settings.maintenanceAlertEmail ?? false,
    });
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------------
// PUT /api/settings/notifications
// --------------------------------------------------------------------------
router.put("/notifications", ...clerkAuth(), requireRole("MARINA_OWNER", "MARINA_MANAGER"), async (req, res, next) => {
  try {
    const data = notificationsSchema.parse(req.body);

    const existing = await prisma.tenant.findUnique({
      where: { id: req.tenantId! },
    });
    if (!existing) {
      res.status(404).json({ error: "Tenant not found", code: "NOT_FOUND" });
      return;
    }

    const t = existing as unknown as Record<string, unknown>;
    const existingTemplate = (t.invoiceTemplateJson && typeof t.invoiceTemplateJson === "object")
      ? t.invoiceTemplateJson as Record<string, unknown>
      : {};

    const updated = { ...existingTemplate, ...data };

    await prisma.tenant.update({
      where: { id: req.tenantId! },
      data: { invoiceTemplateJson: updated },
    });

    res.json(data);
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: "Validation failed", details: err.errors });
      return;
    }
    next(err);
  }
});

// Helper: verify a GL account belongs to this tenant (cross-tenant guard)
async function assertGlAccountBelongsToTenant(glAccountId: string, tenantId: string): Promise<boolean> {
  const acct = await prisma.glAccount.findFirst({ where: { id: glAccountId, tenantId } });
  return acct !== null;
}

// ==========================================================================
// CATALOG — DOCKAGE RATES  (location-scoped)
// ==========================================================================

// GET /api/settings/catalog/dockage-rates?locationId=xxx
router.get("/catalog/dockage-rates", ...clerkAuth(), requireRole("MARINA_OWNER", "MARINA_MANAGER"), async (req, res, next) => {
  try {
    const { locationId } = req.query as { locationId?: string };
    const where: any = { tenantId: req.tenantId! };
    if (locationId) where.locationId = locationId;
    const data = await prisma.dockageRate.findMany({
      where,
      orderBy: [{ slipType: "asc" }, { createdAt: "asc" }],
    });
    res.json({ data });
  } catch (err) { next(err); }
});

// POST /api/settings/catalog/dockage-rates
router.post("/catalog/dockage-rates", ...clerkAuth(), requireRole("MARINA_OWNER", "MARINA_MANAGER"), async (req, res, next) => {
  try {
    const {
      locationId, slipType, monthlyRateCents, quarterlyRateCents, annualRateCents,
      electricityMode, electricityRateCents, glAccountId, taxClass, active, effectiveFrom, effectiveTo,
    } = req.body;
    if (!locationId || !slipType || monthlyRateCents == null) {
      res.status(400).json({ error: "locationId, slipType, and monthlyRateCents are required" }); return;
    }
    if (glAccountId && !(await assertGlAccountBelongsToTenant(glAccountId, req.tenantId!))) {
      res.status(400).json({ error: "GL account not found" }); return;
    }
    const rate = await prisma.dockageRate.create({
      data: {
        tenantId: req.tenantId!,
        locationId,
        slipType,
        monthlyRateCents: Number(monthlyRateCents),
        quarterlyRateCents: quarterlyRateCents != null ? Number(quarterlyRateCents) : null,
        annualRateCents: annualRateCents != null ? Number(annualRateCents) : null,
        electricityMode: electricityMode ?? "METERED",
        electricityRateCents: electricityRateCents != null ? Number(electricityRateCents) : null,
        glAccountId: glAccountId ?? null,
        taxClass: taxClass ?? "Standard",
        active: active ?? true,
        effectiveFrom: effectiveFrom ? new Date(effectiveFrom) : null,
        effectiveTo: effectiveTo ? new Date(effectiveTo) : null,
      },
    });
    res.status(201).json({ data: rate });
  } catch (err) { next(err); }
});

// PUT /api/settings/catalog/dockage-rates/:id
router.put("/catalog/dockage-rates/:id", ...clerkAuth(), requireRole("MARINA_OWNER", "MARINA_MANAGER"), async (req, res, next) => {
  try {
    const existing = await prisma.dockageRate.findFirst({ where: { id: req.params.id, tenantId: req.tenantId! } });
    if (!existing) { res.status(404).json({ error: "Rate not found" }); return; }
    const {
      slipType, monthlyRateCents, quarterlyRateCents, annualRateCents,
      electricityMode, electricityRateCents, glAccountId, taxClass, active, effectiveFrom, effectiveTo,
    } = req.body;
    if (glAccountId && !(await assertGlAccountBelongsToTenant(glAccountId, req.tenantId!))) {
      res.status(400).json({ error: "GL account not found" }); return;
    }
    const updated = await prisma.dockageRate.update({
      where: { id: req.params.id },
      data: {
        ...(slipType != null && { slipType }),
        ...(monthlyRateCents != null && { monthlyRateCents: Number(monthlyRateCents) }),
        ...(quarterlyRateCents !== undefined && { quarterlyRateCents: quarterlyRateCents != null ? Number(quarterlyRateCents) : null }),
        ...(annualRateCents !== undefined && { annualRateCents: annualRateCents != null ? Number(annualRateCents) : null }),
        ...(electricityMode != null && { electricityMode }),
        ...(electricityRateCents !== undefined && { electricityRateCents: electricityRateCents != null ? Number(electricityRateCents) : null }),
        ...(glAccountId !== undefined && { glAccountId }),
        ...(taxClass != null && { taxClass }),
        ...(active !== undefined && { active }),
        ...(effectiveFrom !== undefined && { effectiveFrom: effectiveFrom ? new Date(effectiveFrom) : null }),
        ...(effectiveTo !== undefined && { effectiveTo: effectiveTo ? new Date(effectiveTo) : null }),
      },
    });
    res.json({ data: updated });
  } catch (err) { next(err); }
});

// DELETE /api/settings/catalog/dockage-rates/:id
router.delete("/catalog/dockage-rates/:id", ...clerkAuth(), requireRole("MARINA_OWNER", "MARINA_MANAGER"), async (req, res, next) => {
  try {
    const existing = await prisma.dockageRate.findFirst({ where: { id: req.params.id, tenantId: req.tenantId! } });
    if (!existing) { res.status(404).json({ error: "Rate not found" }); return; }
    await prisma.dockageRate.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ==========================================================================
// CATALOG — SERVICE FEES  (location-scoped)
// ==========================================================================

// GET /api/settings/catalog/service-fees?locationId=xxx
router.get("/catalog/service-fees", ...clerkAuth(), requireRole("MARINA_OWNER", "MARINA_MANAGER"), async (req, res, next) => {
  try {
    const { locationId } = req.query as { locationId?: string };
    const where: any = { tenantId: req.tenantId! };
    if (locationId) where.locationId = locationId;
    const data = await prisma.serviceFee.findMany({
      where,
      orderBy: { name: "asc" },
    });
    res.json({ data });
  } catch (err) { next(err); }
});

// POST /api/settings/catalog/service-fees
router.post("/catalog/service-fees", ...clerkAuth(), requireRole("MARINA_OWNER", "MARINA_MANAGER"), async (req, res, next) => {
  try {
    const { locationId, name, feeType, amountCents, pct, glAccountId, taxClass, active } = req.body;
    if (!locationId || !name) {
      res.status(400).json({ error: "locationId and name are required" }); return;
    }
    if (glAccountId && !(await assertGlAccountBelongsToTenant(glAccountId, req.tenantId!))) {
      res.status(400).json({ error: "GL account not found" }); return;
    }
    const fee = await prisma.serviceFee.create({
      data: {
        tenantId: req.tenantId!,
        locationId,
        name,
        feeType: feeType ?? "FLAT",
        amountCents: amountCents != null ? Number(amountCents) : null,
        pct: pct != null ? Number(pct) : null,
        glAccountId: glAccountId ?? null,
        taxClass: taxClass ?? "Tax Exempt",
        active: active ?? true,
      },
    });
    res.status(201).json({ data: fee });
  } catch (err) { next(err); }
});

// PUT /api/settings/catalog/service-fees/:id
router.put("/catalog/service-fees/:id", ...clerkAuth(), requireRole("MARINA_OWNER", "MARINA_MANAGER"), async (req, res, next) => {
  try {
    const existing = await prisma.serviceFee.findFirst({ where: { id: req.params.id, tenantId: req.tenantId! } });
    if (!existing) { res.status(404).json({ error: "Fee not found" }); return; }
    const { name, feeType, amountCents, pct, glAccountId, taxClass, active } = req.body;
    if (glAccountId && !(await assertGlAccountBelongsToTenant(glAccountId, req.tenantId!))) {
      res.status(400).json({ error: "GL account not found" }); return;
    }
    const updated = await prisma.serviceFee.update({
      where: { id: req.params.id },
      data: {
        ...(name != null && { name }),
        ...(feeType != null && { feeType }),
        ...(amountCents !== undefined && { amountCents: amountCents != null ? Number(amountCents) : null }),
        ...(pct !== undefined && { pct: pct != null ? Number(pct) : null }),
        ...(glAccountId !== undefined && { glAccountId }),
        ...(taxClass != null && { taxClass }),
        ...(active !== undefined && { active }),
      },
    });
    res.json({ data: updated });
  } catch (err) { next(err); }
});

// DELETE /api/settings/catalog/service-fees/:id
router.delete("/catalog/service-fees/:id", ...clerkAuth(), requireRole("MARINA_OWNER", "MARINA_MANAGER"), async (req, res, next) => {
  try {
    const existing = await prisma.serviceFee.findFirst({ where: { id: req.params.id, tenantId: req.tenantId! } });
    if (!existing) { res.status(404).json({ error: "Fee not found" }); return; }
    await prisma.serviceFee.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ─── GET /settings/locations ─────────────────────────────────────────────────
// Returns the tenant's locations for use in catalog dropdowns.

router.get("/locations", ...clerkAuth(), async (req, res, next) => {
  try {
    const locations = await prisma.location.findMany({
      where: { tenantId: req.tenantId! },
      select: {
        id: true, name: true, active: true,
        stripeAccountId: true, stripeOnboardingComplete: true,
        qboRealmId: true,
      },
      orderBy: { name: "asc" },
    });
    res.json({
      data: locations.map((l) => ({
        id: l.id,
        name: l.name,
        active: l.active,
        stripeConnected: !!l.stripeAccountId && !!l.stripeOnboardingComplete,
        qboConnected: !!l.qboRealmId,
      })),
    });
  } catch (err) { next(err); }
});

// ─── GL ACCOUNTS CRUD ────────────────────────────────────────────────────────

const glAccountSchema = z.object({
  accountNumber: z.string().min(1).max(20),
  name: z.string().min(1).max(200),
  type: z.enum(["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"]),
  subType: z.string().max(100).optional().nullable(),
  description: z.string().max(500).optional().nullable(),
  qboAccountId: z.string().max(200).optional().nullable(),
  isDeferredRevenue: z.boolean().optional(),
  active: z.boolean().optional(),
});

// GET /api/settings/gl-accounts
router.get("/gl-accounts", async (req, res, next) => {
  try {
    const tenantId = (req as any).tenantId;
    const accounts = await prisma.glAccount.findMany({
      where: { tenantId },
      select: {
        id: true,
        accountNumber: true,
        name: true,
        type: true,
        subType: true,
        description: true,
        isDeferredRevenue: true,
        active: true,
        qboAccountId: true,
      },
      orderBy: { accountNumber: "asc" },
    });
    res.json({ data: accounts });
  } catch (err) {
    next(err);
  }
});

// POST /api/settings/gl-accounts
router.post("/gl-accounts", ...clerkAuth(), requireRole("MARINA_OWNER", "MARINA_MANAGER", "ACCOUNTING"), async (req, res, next) => {
  try {
    const tenantId = (req as any).tenantId!;
    const body = glAccountSchema.parse(req.body);

    // Check for duplicate account number within tenant
    const existing = await prisma.glAccount.findFirst({
      where: { tenantId, accountNumber: body.accountNumber },
    });
    if (existing) {
      res.status(409).json({ error: "An account with this number already exists" });
      return;
    }

    const account = await prisma.glAccount.create({
      data: {
        tenantId,
        accountNumber: body.accountNumber,
        name: body.name,
        type: body.type,
        subType: body.subType ?? null,
        description: body.description ?? null,
        qboAccountId: body.qboAccountId ?? null,
        isDeferredRevenue: body.isDeferredRevenue ?? false,
        active: body.active ?? true,
      },
    });
    res.status(201).json({ data: account });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: "Validation failed", details: err.errors });
      return;
    }
    next(err);
  }
});

// PUT /api/settings/gl-accounts/:id
router.put("/gl-accounts/:id", ...clerkAuth(), requireRole("MARINA_OWNER", "MARINA_MANAGER", "ACCOUNTING"), async (req, res, next) => {
  try {
    const tenantId = (req as any).tenantId!;
    const existing = await prisma.glAccount.findFirst({
      where: { id: req.params.id, tenantId },
    });
    if (!existing) {
      res.status(404).json({ error: "GL account not found" });
      return;
    }

    const body = glAccountSchema.partial().parse(req.body);

    // If changing account number, check for duplicates
    if (body.accountNumber && body.accountNumber !== existing.accountNumber) {
      const dup = await prisma.glAccount.findFirst({
        where: { tenantId, accountNumber: body.accountNumber, id: { not: existing.id } },
      });
      if (dup) {
        res.status(409).json({ error: "An account with this number already exists" });
        return;
      }
    }

    const updated = await prisma.glAccount.update({
      where: { id: req.params.id },
      data: {
        ...(body.accountNumber != null && { accountNumber: body.accountNumber }),
        ...(body.name != null && { name: body.name }),
        ...(body.type != null && { type: body.type }),
        ...(body.subType !== undefined && { subType: body.subType }),
        ...(body.description !== undefined && { description: body.description }),
        ...(body.qboAccountId !== undefined && { qboAccountId: body.qboAccountId }),
        ...(body.isDeferredRevenue !== undefined && { isDeferredRevenue: body.isDeferredRevenue }),
        ...(body.active !== undefined && { active: body.active }),
      },
    });
    res.json({ data: updated });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: "Validation failed", details: err.errors });
      return;
    }
    next(err);
  }
});

// DELETE /api/settings/gl-accounts/:id
router.delete("/gl-accounts/:id", ...clerkAuth(), requireRole("MARINA_OWNER", "MARINA_MANAGER", "ACCOUNTING"), async (req, res, next) => {
  try {
    const tenantId = (req as any).tenantId!;
    const existing = await prisma.glAccount.findFirst({
      where: { id: req.params.id, tenantId },
    });
    if (!existing) {
      res.status(404).json({ error: "GL account not found" });
      return;
    }

    // Check if any catalog products still reference this GL account.
    // Deleting (or NULL-ing) the FK on these would silently break GL posting,
    // so block the delete until the operator reassigns them.
    const [dockageRateRefs, serviceFeeRefs, productRefs, rentalProductRefs] = await Promise.all([
      prisma.dockageRate.count({ where: { tenantId, glAccountId: req.params.id } }),
      prisma.serviceFee.count({ where: { tenantId, glAccountId: req.params.id } }),
      prisma.product.count({ where: { tenantId, glAccountId: req.params.id } }),
      prisma.rentalProduct.count({ where: { tenantId, glAccountId: req.params.id } }),
    ]);
    const totalRefs = dockageRateRefs + serviceFeeRefs + productRefs + rentalProductRefs;
    if (totalRefs > 0) {
      const parts: string[] = [];
      if (dockageRateRefs > 0) parts.push(`${dockageRateRefs} dockage rate${dockageRateRefs === 1 ? "" : "s"}`);
      if (serviceFeeRefs > 0) parts.push(`${serviceFeeRefs} service fee${serviceFeeRefs === 1 ? "" : "s"}`);
      if (productRefs > 0) parts.push(`${productRefs} product${productRefs === 1 ? "" : "s"}`);
      if (rentalProductRefs > 0) parts.push(`${rentalProductRefs} rental product${rentalProductRefs === 1 ? "" : "s"}`);
      res.status(409).json({
        error: `This GL account is assigned to ${parts.join(", ")}. Reassign them before deleting.`,
        code: "GL_ACCOUNT_IN_USE",
        references: {
          dockageRates: dockageRateRefs,
          serviceFees: serviceFeeRefs,
          products: productRefs,
          rentalProducts: rentalProductRefs,
          total: totalRefs,
        },
      });
      return;
    }

    // Check if account has any GL entries posted to it
    const entryCount = await prisma.glEntry.count({
      where: { accountId: req.params.id },
    });
    if (entryCount > 0) {
      // Soft-delete: mark inactive instead of hard delete
      await prisma.glAccount.update({
        where: { id: req.params.id },
        data: { active: false },
      });
      res.json({ success: true, archived: true, message: "Account has posted entries — it has been archived rather than deleted." });
      return;
    }

    await prisma.glAccount.delete({ where: { id: req.params.id } });
    res.json({ success: true, archived: false });
  } catch (err) {
    next(err);
  }
});

// ─── CATALOG — GL ACCOUNT ASSIGNMENT FOR PRODUCTS ────────────────────────────

// PUT /api/settings/catalog/rental-products/:id/gl-account
router.put("/catalog/rental-products/:id/gl-account", ...clerkAuth(), requireRole("MARINA_OWNER", "MARINA_MANAGER"), async (req, res, next) => {
  try {
    const tenantId = (req as any).tenantId!;
    const { glAccountId } = req.body;
    const existing = await prisma.rentalProduct.findFirst({ where: { id: req.params.id, tenantId } });
    if (!existing) { res.status(404).json({ error: "Rental product not found" }); return; }
    if (glAccountId && !(await assertGlAccountBelongsToTenant(glAccountId, tenantId))) {
      res.status(400).json({ error: "GL account not found" }); return;
    }
    const updated = await prisma.rentalProduct.update({
      where: { id: req.params.id },
      data: { glAccountId: glAccountId ?? null },
    });
    res.json({ data: updated });
  } catch (err) { next(err); }
});

// ─── CATALOG — PRODUCTS SUMMARY (all product types with GL account info) ─────

// GET /api/settings/catalog/products-summary?locationId=xxx
// Returns a unified view of all product-generating catalog entries
router.get("/catalog/products-summary", ...clerkAuth(), requireRole("MARINA_OWNER", "MARINA_MANAGER", "ACCOUNTING"), async (req, res, next) => {
  try {
    const tenantId = (req as any).tenantId!;
    const { locationId } = req.query as { locationId?: string };
    const where: any = { tenantId };
    if (locationId) where.locationId = locationId;

    const [dockageRates, serviceFees, rentalProducts, glAccounts] = await Promise.all([
      prisma.dockageRate.findMany({
        where,
        orderBy: [{ slipType: "asc" }],
        include: { location: { select: { name: true } } },
      }),
      prisma.serviceFee.findMany({
        where,
        orderBy: { name: "asc" },
        include: { location: { select: { name: true } } },
      }),
      prisma.rentalProduct.findMany({
        where: { tenantId },
        orderBy: { name: "asc" },
        select: { id: true, name: true, category: true, glAccountId: true, active: true },
      }),
      prisma.glAccount.findMany({
        where: { tenantId, active: true, type: "REVENUE" },
        select: { id: true, accountNumber: true, name: true },
        orderBy: { accountNumber: "asc" },
      }),
    ]);

    // Count unconfigured items (no GL account)
    const unconfiguredCount =
      dockageRates.filter((r) => !r.glAccountId).length +
      serviceFees.filter((f) => !f.glAccountId).length +
      rentalProducts.filter((p) => p.active && !p.glAccountId).length;

    res.json({
      data: {
        dockageRates,
        serviceFees,
        rentalProducts,
        glAccounts,
        unconfiguredCount,
        hasGlAccounts: glAccounts.length > 0,
      },
    });
  } catch (err) {
    next(err);
  }
});

export default router;
