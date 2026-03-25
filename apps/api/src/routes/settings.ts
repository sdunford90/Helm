import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { clerkAuth, requireRole } from "../middleware/auth.js";
import { stripe } from "../lib/stripe.js";

const router = Router();

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
// GET /api/settings/stripe
// --------------------------------------------------------------------------
router.get("/stripe", ...clerkAuth(), requireRole("MARINA_OWNER", "MARINA_MANAGER"), async (req, res, next) => {
  try {
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
// POST /api/settings/stripe/connect
// --------------------------------------------------------------------------
router.post("/stripe/connect", ...clerkAuth(), requireRole("MARINA_OWNER"), async (req, res, next) => {
  try {
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
      const account = await stripe.accounts.create({ type: "standard" });
      accountId = account.id;
      await prisma.tenant.update({
        where: { id: req.tenantId! },
        data: { stripeAccountId: accountId },
      });
    }

    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${process.env.APP_URL}/settings?section=stripe&refresh=true`,
      return_url: `${process.env.APP_URL}/settings?section=stripe&success=true`,
      type: "account_onboarding",
    });

    res.json({ url: accountLink.url });
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------------
// POST /api/settings/stripe/disconnect
// --------------------------------------------------------------------------
router.post("/stripe/disconnect", ...clerkAuth(), requireRole("MARINA_OWNER"), async (req, res, next) => {
  try {
    const { confirm } = req.body;
    if (confirm !== true) {
      res.status(400).json({ error: "Confirmation required", code: "CONFIRMATION_REQUIRED" });
      return;
    }

    await prisma.tenant.update({
      where: { id: req.tenantId! },
      data: { stripeAccountId: null },
    });

    res.json({ disconnected: true });
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------------
// GET /api/settings/qbo
// --------------------------------------------------------------------------
router.get("/qbo", ...clerkAuth(), requireRole("MARINA_OWNER", "MARINA_MANAGER", "ACCOUNTING"), async (req, res, next) => {
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

    const realmId = tenant.qboRealmId;
    const connected = !!realmId;

    res.json({
      connected,
      realmId: realmId ?? null,
      lastSync: settings.qboLastSync ?? null,
    });
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------------
// POST /api/settings/qbo/connect
// --------------------------------------------------------------------------
router.post("/qbo/connect", ...clerkAuth(), requireRole("MARINA_OWNER"), async (req, res, next) => {
  try {
    const tenant = await prisma.tenant.findUnique({
      where: { id: req.tenantId! },
    });

    if (!tenant) {
      res.status(404).json({ error: "Tenant not found", code: "NOT_FOUND" });
      return;
    }

    const clientId = process.env.QBO_CLIENT_ID;
    const redirectUri = `${process.env.APP_URL}/api/callbacks/qbo`;
    const scope = "com.intuit.quickbooks.accounting";
    const state = req.tenantId!;

    const authUrl =
      `https://appcenter.intuit.com/connect/oauth2?` +
      `client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&scope=${scope}&response_type=code&state=${state}`;

    res.json({ url: authUrl });
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------------
// POST /api/settings/qbo/disconnect
// --------------------------------------------------------------------------
router.post("/qbo/disconnect", ...clerkAuth(), requireRole("MARINA_OWNER"), async (req, res, next) => {
  try {
    const { confirm } = req.body;
    if (confirm !== true) {
      res.status(400).json({ error: "Confirmation required", code: "CONFIRMATION_REQUIRED" });
      return;
    }

    await prisma.tenant.update({
      where: { id: req.tenantId! },
      data: { qboRealmId: null },
    });

    res.json({ disconnected: true });
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------------
// POST /api/settings/qbo/sync
// --------------------------------------------------------------------------
router.post("/qbo/sync", ...clerkAuth(), requireRole("MARINA_OWNER", "MARINA_MANAGER", "ACCOUNTING"), async (req, res, next) => {
  try {
    const tenant = await prisma.tenant.findUnique({
      where: { id: req.tenantId! },
    });

    if (!tenant) {
      res.status(404).json({ error: "Tenant not found", code: "NOT_FOUND" });
      return;
    }

    if (!tenant.qboRealmId) {
      res.status(400).json({ error: "QuickBooks is not connected", code: "QBO_NOT_CONNECTED" });
      return;
    }

    // Update last sync timestamp
    const t = tenant as unknown as Record<string, unknown>;
    const existingTemplate = (t.invoiceTemplateJson && typeof t.invoiceTemplateJson === "object")
      ? t.invoiceTemplateJson as Record<string, unknown>
      : {};

    await prisma.tenant.update({
      where: { id: req.tenantId! },
      data: {
        invoiceTemplateJson: {
          ...existingTemplate,
          qboLastSync: new Date().toISOString(),
        },
      },
    });

    res.json({ syncing: true, startedAt: new Date().toISOString() });
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

export default router;
