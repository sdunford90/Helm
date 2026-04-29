import { Router } from "express";
import { getInventorySyncStatus } from "../services/qbo-sync.js";
import {
  startQboInventoryResyncJob,
  getQboInventoryResyncJob,
} from "../services/qbo-inventory-resync-jobs.js";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { clerkAuth, requireRole, requireLocationAccess, filterByAllowedLocations } from "../middleware/auth.js";
import { stripe, requireStripe } from "../lib/stripe.js";
import { issueOAuthState } from "../lib/oauth-state.js";
import {
  getMissingGlAccountWarnings,
  isLocationQboConnected,
} from "../services/gl-account-resolver.js";

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
  locationIds: z.array(z.string().uuid()).optional(),
});

const updateRoleSchema = z.object({
  role: z.enum([
    "MARINA_OWNER",
    "MARINA_MANAGER",
    "DOCK_STAFF",
    "POS_CASHIER",
    "ACCOUNTING",
  ]).optional(),
  locationIds: z.array(z.string().uuid()).optional(),
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
      if (!requireLocationAccess(req, locationId)) {
        res.status(403).json({ error: "Forbidden for this location", code: "LOCATION_FORBIDDEN" });
        return;
      }
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
// POST /api/settings/stripe/refresh-status  { locationId? }
//
// Pulls the latest Stripe Account capabilities for the location's (or
// tenant's) connected account and reflects `charges_enabled` into
// `Location.stripeOnboardingComplete`. Used by the web client when the
// Stripe Connect onboarding popup closes, so the UI doesn't have to wait
// for the `account.updated` webhook to flip the connected/incomplete flag.
// The webhook (`handleAccountUpdated` in webhooks-stripe.ts) remains the
// source of truth for ongoing capability changes.
// --------------------------------------------------------------------------
// Marina managers also operate the customer-file Cards on File flow and need
// to be able to clear stale onboarding flags when a location finishes Stripe
// setup, so this endpoint is gated to OWNER+MANAGER (same as GET /stripe).
router.post("/stripe/refresh-status", ...clerkAuth(), requireRole("MARINA_OWNER", "MARINA_MANAGER"), async (req, res, next) => {
  try {
    const { locationId } = req.body as { locationId?: string };

    if (locationId) {
      if (!requireLocationAccess(req, locationId)) {
        res.status(403).json({ error: "Forbidden for this location", code: "LOCATION_FORBIDDEN" });
        return;
      }
      const location = await prisma.location.findFirst({
        where: { id: locationId, tenantId: req.tenantId! },
        select: { id: true, stripeAccountId: true, stripeOnboardingComplete: true },
      });
      if (!location) {
        res.status(404).json({ error: "Location not found", code: "NOT_FOUND" });
        return;
      }
      if (!location.stripeAccountId) {
        res.json({
          connected: false,
          onboardingComplete: false,
          accountId: null,
          dashboardUrl: null,
        });
        return;
      }

      let account: import("stripe").Stripe.Account;
      try {
        account = await requireStripe().accounts.retrieve(location.stripeAccountId);
      } catch (err) {
        console.error("[settings/stripe/refresh-status] retrieve failed", {
          tenantId: req.tenantId,
          locationId,
          accountId: location.stripeAccountId,
          error: err instanceof Error ? err.message : String(err),
        });
        res.status(502).json({ error: "Failed to retrieve Stripe account", code: "STRIPE_ERROR" });
        return;
      }

      const chargesEnabled = account.charges_enabled ?? false;
      const payoutsEnabled = account.payouts_enabled ?? false;
      const detailsSubmitted = account.details_submitted ?? false;
      const requirements = {
        currentlyDue: account.requirements?.currently_due ?? [],
        pastDue: account.requirements?.past_due ?? [],
        eventuallyDue: account.requirements?.eventually_due ?? [],
        pendingVerification: account.requirements?.pending_verification ?? [],
        disabledReason: account.requirements?.disabled_reason ?? null,
      };

      // Mirror handleAccountUpdated: mark onboarding complete when the
      // account can accept charges. Do not flip back to false here — the
      // webhook owns ongoing capability state.
      if (chargesEnabled && !location.stripeOnboardingComplete) {
        await prisma.location.update({
          where: { id: locationId },
          data: { stripeOnboardingComplete: true },
        });
        await prisma.auditLog.create({
          data: {
            tenantId: req.tenantId!,
            recordType: "Location",
            recordId: locationId,
            action: "STRIPE_ACCOUNT_UPDATED",
            changedFieldsJson: {
              source: "settings/stripe/refresh-status",
              chargesEnabled,
              payoutsEnabled,
              detailsSubmitted,
              locationId,
            },
          },
        });
      }

      const onboardingComplete = chargesEnabled || !!location.stripeOnboardingComplete;
      res.json({
        connected: !!location.stripeAccountId && onboardingComplete,
        onboardingComplete,
        chargesEnabled,
        payoutsEnabled,
        detailsSubmitted,
        requirements,
        accountId: `****${location.stripeAccountId.slice(-4)}`,
        dashboardUrl: `https://dashboard.stripe.com/${location.stripeAccountId}`,
      });
      return;
    }

    // Tenant-level (legacy) — there is no `stripeOnboardingComplete`
    // column on Tenant, so we just report current Stripe state without
    // persisting anything.
    const tenant = await prisma.tenant.findUnique({ where: { id: req.tenantId! } });
    if (!tenant) {
      res.status(404).json({ error: "Tenant not found", code: "NOT_FOUND" });
      return;
    }
    if (!tenant.stripeAccountId) {
      res.json({ connected: false, accountId: null, dashboardUrl: null });
      return;
    }
    let account: import("stripe").Stripe.Account;
    try {
      account = await requireStripe().accounts.retrieve(tenant.stripeAccountId);
    } catch (err) {
      console.error("[settings/stripe/refresh-status] tenant retrieve failed", {
        tenantId: req.tenantId,
        accountId: tenant.stripeAccountId,
        error: err instanceof Error ? err.message : String(err),
      });
      res.status(502).json({ error: "Failed to retrieve Stripe account", code: "STRIPE_ERROR" });
      return;
    }
    res.json({
      connected: !!tenant.stripeAccountId,
      chargesEnabled: account.charges_enabled ?? false,
      payoutsEnabled: account.payouts_enabled ?? false,
      detailsSubmitted: account.details_submitted ?? false,
      accountId: `****${tenant.stripeAccountId.slice(-4)}`,
      dashboardUrl: `https://dashboard.stripe.com/${tenant.stripeAccountId}`,
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
      if (!requireLocationAccess(req, locationId)) {
        res.status(403).json({ error: "Forbidden for this location", code: "LOCATION_FORBIDDEN" });
        return;
      }
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
      if (!requireLocationAccess(req, locationId)) {
        res.status(403).json({ error: "Forbidden for this location", code: "LOCATION_FORBIDDEN" });
        return;
      }
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
      if (!requireLocationAccess(req, locationId)) {
        res.status(403).json({ error: "Forbidden for this location", code: "LOCATION_FORBIDDEN" });
        return;
      }
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
      if (!requireLocationAccess(req, locationId)) {
        res.status(403).json({ error: "Forbidden for this location", code: "LOCATION_FORBIDDEN" });
        return;
      }
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
      if (!requireLocationAccess(req, locationId)) {
        res.status(403).json({ error: "Forbidden for this location", code: "LOCATION_FORBIDDEN" });
        return;
      }
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
      if (!requireLocationAccess(req, locationId)) {
        res.status(403).json({ error: "Forbidden for this location", code: "LOCATION_FORBIDDEN" });
        return;
      }
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
// GET /api/settings/qbo/inventory-status  — summary of inventory sync state
// --------------------------------------------------------------------------
router.get("/qbo/inventory-status", ...clerkAuth(), requireRole("MARINA_OWNER", "MARINA_MANAGER", "ACCOUNTING"), async (req, res, next) => {
  try {
    const status = await getInventorySyncStatus(req.tenantId!);
    res.json(status);
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------------
// POST /api/settings/qbo/inventory-resync — start a bulk retry job
//
// Iterates every QBO inventory sync ref currently in an error state for the
// tenant and re-attempts the appropriate push (item, bill, journal, vendor).
// For tenants with hundreds of failures the retry can take minutes per
// QuickBooks round-trip, so this endpoint kicks the work off in the
// background and returns a `jobId` immediately. The Settings UI polls
// `GET /qbo/inventory-resync/:jobId` to render a live progress counter and
// pick up the final per-record breakdown when the job finishes.
// --------------------------------------------------------------------------
router.post("/qbo/inventory-resync", ...clerkAuth(), requireRole("MARINA_OWNER", "MARINA_MANAGER", "ACCOUNTING"), async (req, res, next) => {
  try {
    const job = await startQboInventoryResyncJob(req.tenantId!);
    res.status(202).json({
      jobId: job.jobId,
      status: job.status,
      total: job.total,
      processed: job.processed,
      attempted: job.attempted,
      succeeded: job.succeeded,
      failed: job.failed,
      skipped: job.skipped,
      startedAt: job.startedAt,
    });
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------------
// GET /api/settings/qbo/inventory-resync/:jobId — poll resync job progress
//
// Returns the current snapshot of a resync job: counts, status (running |
// succeeded | failed) and, once complete, the per-record details breakdown.
// 404 if the job id is unknown or no longer cached.
// --------------------------------------------------------------------------
router.get("/qbo/inventory-resync/:jobId", ...clerkAuth(), requireRole("MARINA_OWNER", "MARINA_MANAGER", "ACCOUNTING"), async (req, res, next) => {
  try {
    const job = await getQboInventoryResyncJob(req.params.jobId, req.tenantId!);
    if (!job) {
      res.status(404).json({ error: "Resync job not found" });
      return;
    }
    res.json({
      jobId: job.jobId,
      status: job.status,
      total: job.total,
      processed: job.processed,
      attempted: job.attempted,
      succeeded: job.succeeded,
      failed: job.failed,
      skipped: job.skipped,
      startedAt: job.startedAt,
      updatedAt: job.updatedAt,
      completedAt: job.completedAt,
      error: job.error,
      details: job.status === "running" ? [] : job.details,
    });
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------------
// GET /api/settings/locations/:id  — per-location settings
// --------------------------------------------------------------------------
router.get("/locations/:id", ...clerkAuth(), requireRole("MARINA_OWNER", "MARINA_MANAGER"), async (req, res, next) => {
  try {
    if (!requireLocationAccess(req, req.params.id)) {
      res.status(403).json({ error: "Forbidden for this location", code: "LOCATION_FORBIDDEN" });
      return;
    }
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
        posAchEnabled: true,
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
    if (!requireLocationAccess(req, req.params.id)) {
      res.status(403).json({ error: "Forbidden for this location", code: "LOCATION_FORBIDDEN" });
      return;
    }
    const location = await prisma.location.findFirst({
      where: { id: req.params.id, tenantId: req.tenantId! },
    });

    if (!location) {
      res.status(404).json({ error: "Location not found", code: "NOT_FOUND" });
      return;
    }

    const { name, address, city, state, zip, phone, timezone, active, transientEnabled, rentalsEnabled, autoExecuteRenewals, posAchEnabled, logoUrl } =
      req.body as Partial<{
        name: string; address: string; city: string; state: string; zip: string; phone: string;
        timezone: string; active: boolean; transientEnabled: boolean; rentalsEnabled: boolean;
        autoExecuteRenewals: boolean; posAchEnabled: boolean; logoUrl: string;
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
        ...(posAchEnabled !== undefined && { posAchEnabled }),
        ...(logoUrl !== undefined && { logoUrl }),
      },
      select: {
        id: true, name: true, address: true, city: true, state: true, zip: true, phone: true,
        timezone: true, active: true, transientEnabled: true, rentalsEnabled: true,
        autoExecuteRenewals: true, posAchEnabled: true, logoUrl: true, qboRealmId: true, qboConnectedAt: true,
      },
    });

    res.json({ location: { ...updated, qboConnected: !!updated.qboRealmId } });
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------------
// GET /api/settings/locations/:id/posting-accounts
//
// Returns the per-location pinned posting accounts (A/R, cash / undeposited
// funds, deferred revenue) plus the candidate accounts the operator can pick
// from. Candidates are restricted to the location's own chart of accounts
// for QBO-connected locations and to the tenant-wide chart otherwise — this
// matches the validation the PUT endpoint enforces.
// --------------------------------------------------------------------------
router.get(
  "/locations/:id/posting-accounts",
  ...clerkAuth(),
  requireRole("MARINA_OWNER", "MARINA_MANAGER", "ACCOUNTING"),
  async (req, res, next) => {
    try {
      if (!requireLocationAccess(req, req.params.id)) {
        res.status(403).json({ error: "Forbidden for this location", code: "LOCATION_FORBIDDEN" });
        return;
      }
      const tenantId = req.tenantId!;
      const location = await prisma.location.findFirst({
        where: { id: req.params.id, tenantId },
        select: {
          id: true,
          arGlAccountId: true,
          undepositedFundsGlAccountId: true,
          deferredRevenueGlAccountId: true,
          defaultRevenueGlAccountId: true,
          salesTaxGlAccountId: true,
          earlyTerminationGlAccountId: true,
          achReturnFeeGlAccountId: true,
          qboRealmId: true,
        },
      });
      if (!location) {
        res.status(404).json({ error: "Location not found", code: "NOT_FOUND" });
        return;
      }

      const qboConnected = await isLocationQboConnected(req.params.id);
      // Candidate accounts: QBO-connected locations must pick from their own
      // chart so the IDs we send back to QBO match its file. For non-QBO
      // locations, the union of (this location's scoped accounts) ∪
      // (tenant-wide accounts not bound to any location). Critically,
      // accounts pinned to OTHER locations are excluded — pinning a sibling
      // marina's chart row would post into a chart this location doesn't own.
      const candidates = await prisma.glAccount.findMany({
        where: qboConnected
          ? { tenantId, locationId: req.params.id }
          : {
              tenantId,
              OR: [{ locationId: req.params.id }, { locationId: null }],
            },
        orderBy: { accountNumber: "asc" },
        select: {
          id: true,
          accountNumber: true,
          name: true,
          type: true,
          locationId: true,
          qboAccountId: true,
        },
      });

      res.json({
        locationId: location.id,
        qboConnected,
        accounts: {
          arGlAccountId: location.arGlAccountId,
          undepositedFundsGlAccountId: location.undepositedFundsGlAccountId,
          deferredRevenueGlAccountId: location.deferredRevenueGlAccountId,
          defaultRevenueGlAccountId: location.defaultRevenueGlAccountId,
          salesTaxGlAccountId: location.salesTaxGlAccountId,
          earlyTerminationGlAccountId: location.earlyTerminationGlAccountId,
          achReturnFeeGlAccountId: location.achReturnFeeGlAccountId,
        },
        candidates,
      });
    } catch (err) {
      next(err);
    }
  },
);

// --------------------------------------------------------------------------
// PUT /api/settings/locations/:id/posting-accounts
//
// Body: { arGlAccountId?, undepositedFundsGlAccountId?, deferredRevenueGlAccountId? }
//
// Each field accepts a GL account id, `null` to clear the pin, or `undefined`
// to leave it unchanged. For QBO-connected locations the chosen account
// must belong to that location's chart of accounts (mirrors the catalog
// helper); for non-QBO locations a tenant-scoped check applies.
// --------------------------------------------------------------------------
router.put(
  "/locations/:id/posting-accounts",
  ...clerkAuth(),
  requireRole("MARINA_OWNER", "MARINA_MANAGER", "ACCOUNTING"),
  async (req, res, next) => {
    try {
      if (!requireLocationAccess(req, req.params.id)) {
        res.status(403).json({ error: "Forbidden for this location", code: "LOCATION_FORBIDDEN" });
        return;
      }
      const tenantId = req.tenantId!;
      const locationId = req.params.id;

      const location = await prisma.location.findFirst({
        where: { id: locationId, tenantId },
        select: { id: true },
      });
      if (!location) {
        res.status(404).json({ error: "Location not found", code: "NOT_FOUND" });
        return;
      }

      const body = req.body as {
        arGlAccountId?: string | null;
        undepositedFundsGlAccountId?: string | null;
        deferredRevenueGlAccountId?: string | null;
        defaultRevenueGlAccountId?: string | null;
        salesTaxGlAccountId?: string | null;
        earlyTerminationGlAccountId?: string | null;
        achReturnFeeGlAccountId?: string | null;
      };

      const qboConnected = await isLocationQboConnected(locationId);

      // Each system-posting slot expects a particular GLAccountType. We
      // enforce that here so operators can't pin (say) a LIABILITY row to
      // the default-revenue slot from the UI and have postings silently
      // book the wrong side of the ledger. Mirrors
      // LOCATION_SYSTEM_POSTING_ACCOUNT_SPECS in gl-account-resolver.ts.
      const SYSTEM_SLOT_TYPES: Record<string, ReadonlyArray<string>> = {
        defaultRevenueGlAccountId: ["REVENUE"],
        salesTaxGlAccountId: ["LIABILITY"],
        earlyTerminationGlAccountId: ["REVENUE"],
        achReturnFeeGlAccountId: ["REVENUE"],
      };

      // Validate each provided id against the same constraint the catalog
      // helper uses (QBO-connected ⇒ must belong to this location;
      // otherwise ⇒ tenant-scoped) plus the per-slot type expectation.
      // null clears the pin and is always OK.
      async function validate(id: string | null | undefined, field: string) {
        if (id === undefined || id === null) return;
        const acct = await prisma.glAccount.findFirst({
          where: { id, tenantId },
          select: { id: true, locationId: true, type: true },
        });
        if (!acct) {
          throw Object.assign(
            new Error(`GL account for ${field} not found in this tenant`),
            { status: 400, code: "GL_ACCOUNT_NOT_FOUND" },
          );
        }
        if (qboConnected && acct.locationId !== locationId) {
          throw Object.assign(
            new Error(
              `GL account for ${field} must belong to this QBO-connected location`,
            ),
            { status: 400, code: "GL_ACCOUNT_WRONG_LOCATION" },
          );
        }
        // Non-QBO locations: tenant-wide (locationId=null) is allowed, but
        // a row bound to a sibling location is not — that would post into
        // a chart this location doesn't own.
        if (!qboConnected && acct.locationId !== null && acct.locationId !== locationId) {
          throw Object.assign(
            new Error(
              `GL account for ${field} belongs to a different location and cannot be pinned here`,
            ),
            { status: 400, code: "GL_ACCOUNT_WRONG_LOCATION" },
          );
        }
        const expected = SYSTEM_SLOT_TYPES[field];
        if (expected && !expected.includes(acct.type)) {
          throw Object.assign(
            new Error(
              `GL account for ${field} must be of type ${expected.join("/")} (got ${acct.type})`,
            ),
            { status: 400, code: "GL_ACCOUNT_WRONG_TYPE" },
          );
        }
      }

      try {
        await Promise.all([
          validate(body.arGlAccountId, "arGlAccountId"),
          validate(body.undepositedFundsGlAccountId, "undepositedFundsGlAccountId"),
          validate(body.deferredRevenueGlAccountId, "deferredRevenueGlAccountId"),
          validate(body.defaultRevenueGlAccountId, "defaultRevenueGlAccountId"),
          validate(body.salesTaxGlAccountId, "salesTaxGlAccountId"),
          validate(body.earlyTerminationGlAccountId, "earlyTerminationGlAccountId"),
          validate(body.achReturnFeeGlAccountId, "achReturnFeeGlAccountId"),
        ]);
      } catch (e: any) {
        res
          .status(e.status ?? 400)
          .json({ error: e.message, code: e.code ?? "VALIDATION_ERROR" });
        return;
      }

      const updated = await prisma.location.update({
        where: { id: locationId },
        data: {
          ...(body.arGlAccountId !== undefined && { arGlAccountId: body.arGlAccountId }),
          ...(body.undepositedFundsGlAccountId !== undefined && {
            undepositedFundsGlAccountId: body.undepositedFundsGlAccountId,
          }),
          ...(body.deferredRevenueGlAccountId !== undefined && {
            deferredRevenueGlAccountId: body.deferredRevenueGlAccountId,
          }),
          ...(body.defaultRevenueGlAccountId !== undefined && {
            defaultRevenueGlAccountId: body.defaultRevenueGlAccountId,
          }),
          ...(body.salesTaxGlAccountId !== undefined && {
            salesTaxGlAccountId: body.salesTaxGlAccountId,
          }),
          ...(body.earlyTerminationGlAccountId !== undefined && {
            earlyTerminationGlAccountId: body.earlyTerminationGlAccountId,
          }),
          ...(body.achReturnFeeGlAccountId !== undefined && {
            achReturnFeeGlAccountId: body.achReturnFeeGlAccountId,
          }),
        },
        select: {
          id: true,
          arGlAccountId: true,
          undepositedFundsGlAccountId: true,
          deferredRevenueGlAccountId: true,
          defaultRevenueGlAccountId: true,
          salesTaxGlAccountId: true,
          earlyTerminationGlAccountId: true,
          achReturnFeeGlAccountId: true,
        },
      });

      res.json({
        locationId: updated.id,
        accounts: {
          arGlAccountId: updated.arGlAccountId,
          undepositedFundsGlAccountId: updated.undepositedFundsGlAccountId,
          deferredRevenueGlAccountId: updated.deferredRevenueGlAccountId,
          defaultRevenueGlAccountId: updated.defaultRevenueGlAccountId,
          salesTaxGlAccountId: updated.salesTaxGlAccountId,
          earlyTerminationGlAccountId: updated.earlyTerminationGlAccountId,
          achReturnFeeGlAccountId: updated.achReturnFeeGlAccountId,
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

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
        userLocations: {
          select: { locationId: true },
        },
      },
    });

    const members = users.map((u) => {
      const { userLocations, ...rest } = u as typeof u & {
        userLocations: { locationId: string }[];
      };
      return { ...rest, locationIds: userLocations.map((l) => l.locationId) };
    });

    res.json({ members });
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------------
// Helper: validate locationIds belong to tenant
// --------------------------------------------------------------------------
async function validateLocationIds(tenantId: string, locationIds: string[]): Promise<string[]> {
  if (locationIds.length === 0) return [];
  const found = await prisma.location.findMany({
    where: { id: { in: locationIds }, tenantId },
    select: { id: true },
  });
  return found.map((l) => l.id);
}

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

    const requestedIds = data.locationIds ?? [];
    const validIds = await validateLocationIds(req.tenantId!, requestedIds);
    if (validIds.length !== requestedIds.length) {
      res.status(400).json({ error: "One or more locationIds are invalid for this tenant", code: "INVALID_LOCATION" });
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

    if (validIds.length > 0) {
      await prisma.userLocation.createMany({
        data: validIds.map((locationId) => ({
          userId: user.id,
          locationId,
          tenantId: req.tenantId!,
        })),
        skipDuplicates: true,
      });
    }

    await prisma.auditLog.create({
      data: {
        tenantId: req.tenantId!,
        userId: req.userId ?? null,
        userName: req.userRecord ? `${req.userRecord.firstName ?? ""} ${req.userRecord.lastName ?? ""}`.trim() || null : null,
        recordType: "User",
        recordId: user.id,
        action: "INVITE",
        changedFieldsJson: { role: data.role, locationIds: validIds },
        ipAddress: req.ip ?? null,
      },
    });

    res.status(201).json({ member: { ...user, locationIds: validIds } });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: "Validation failed", details: err.errors });
      return;
    }
    next(err);
  }
});

// --------------------------------------------------------------------------
// PUT /api/settings/team/:userId  — update role and/or locationIds
// --------------------------------------------------------------------------
router.put("/team/:userId", ...clerkAuth(), requireRole("MARINA_OWNER"), async (req, res, next) => {
  try {
    const data = updateRoleSchema.parse(req.body);

    if (req.params.userId === req.userId && data.role !== undefined) {
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

    const changed: Record<string, unknown> = {};

    if (data.role !== undefined && data.role !== user.role) {
      await prisma.user.update({
        where: { id: req.params.userId },
        data: { role: data.role },
      });
      changed.role = { from: user.role, to: data.role };
    }

    let finalLocationIds: string[] | undefined;
    if (data.locationIds !== undefined) {
      const validIds = await validateLocationIds(req.tenantId!, data.locationIds);
      if (validIds.length !== data.locationIds.length) {
        res.status(400).json({ error: "One or more locationIds are invalid for this tenant", code: "INVALID_LOCATION" });
        return;
      }
      await prisma.$transaction([
        prisma.userLocation.deleteMany({ where: { userId: req.params.userId } }),
        ...(validIds.length > 0
          ? [prisma.userLocation.createMany({
              data: validIds.map((locationId) => ({
                userId: req.params.userId,
                locationId,
                tenantId: req.tenantId!,
              })),
              skipDuplicates: true,
            })]
          : []),
      ]);
      finalLocationIds = validIds;
      changed.locationIds = validIds;
    }

    if (Object.keys(changed).length > 0) {
      await prisma.auditLog.create({
        data: {
          tenantId: req.tenantId!,
          userId: req.userId ?? null,
          userName: req.userRecord ? `${req.userRecord.firstName ?? ""} ${req.userRecord.lastName ?? ""}`.trim() || null : null,
          recordType: "User",
          recordId: req.params.userId,
          action: "UPDATE",
          changedFieldsJson: changed,
          ipAddress: req.ip ?? null,
        },
      });
    }

    if (finalLocationIds === undefined) {
      const links = await prisma.userLocation.findMany({
        where: { userId: req.params.userId },
        select: { locationId: true },
      });
      finalLocationIds = links.map((l) => l.locationId);
    }

    const updated = await prisma.user.findUnique({ where: { id: req.params.userId } });
    res.json({ member: { ...updated, locationIds: finalLocationIds } });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: "Validation failed", details: err.errors });
      return;
    }
    next(err);
  }
});

// Backward-compat: PUT /team/:userId/role (role only)
router.put("/team/:userId/role", ...clerkAuth(), requireRole("MARINA_OWNER"), async (req, res, next) => {
  try {
    const data = z.object({ role: updateRoleSchema.shape.role.unwrap() }).parse(req.body);

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

    await prisma.auditLog.create({
      data: {
        tenantId: req.tenantId!,
        userId: req.userId ?? null,
        userName: null,
        recordType: "User",
        recordId: req.params.userId,
        action: "UPDATE",
        changedFieldsJson: { role: { from: user.role, to: data.role } },
        ipAddress: req.ip ?? null,
      },
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

// Helper: when a catalog item (dockage rate / service fee) is created or
// updated through its legacy single-glAccountId field, enforce per-location
// integrity for QBO-connected locations. The chosen GL account must belong
// to the same location's chart-of-accounts. For non-QBO locations, the
// legacy tenant-scoped check applies.
async function assertGlAccountForCatalogItem(
  tenantId: string,
  locationId: string,
  glAccountId: string,
): Promise<void> {
  const acct = await prisma.glAccount.findFirst({
    where: { id: glAccountId, tenantId },
    select: { id: true, locationId: true },
  });
  if (!acct) throw new Error(`GL account ${glAccountId} not found`);
  if (await isLocationQboConnected(locationId)) {
    if (acct.locationId !== locationId) {
      throw new Error(
        `GL account ${glAccountId} belongs to a different location`,
      );
    }
  }
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
    if (glAccountId) {
      try {
        await assertGlAccountForCatalogItem(req.tenantId!, locationId, glAccountId);
      } catch (e) {
        res.status(400).json({ error: (e as Error).message });
        return;
      }
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
    if (glAccountId !== undefined && (await isLocationQboConnected(locationId))) {
      await prisma.dockageRateGlMapping.upsert({
        where: { dockageRateId_locationId: { dockageRateId: rate.id, locationId } },
        create: {
          tenantId: req.tenantId!,
          dockageRateId: rate.id,
          locationId,
          glAccountId: glAccountId ?? null,
        },
        update: { glAccountId: glAccountId ?? null },
      });
    }
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
    if (glAccountId && existing.locationId) {
      try {
        await assertGlAccountForCatalogItem(req.tenantId!, existing.locationId, glAccountId);
      } catch (e) {
        res.status(400).json({ error: (e as Error).message });
        return;
      }
    } else if (glAccountId && !(await assertGlAccountBelongsToTenant(glAccountId, req.tenantId!))) {
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
    // Dual-write the per-location mapping table only for QBO-connected
    // locations so the new resolver / warning helper picks up edits made
    // via the legacy field. Validation above guarantees same-location
    // ownership before this write.
    if (
      glAccountId !== undefined
      && existing.locationId
      && (await isLocationQboConnected(existing.locationId))
    ) {
      await prisma.dockageRateGlMapping.upsert({
        where: {
          dockageRateId_locationId: {
            dockageRateId: req.params.id,
            locationId: existing.locationId,
          },
        },
        create: {
          tenantId: req.tenantId!,
          dockageRateId: req.params.id,
          locationId: existing.locationId,
          glAccountId: glAccountId ?? null,
        },
        update: { glAccountId: glAccountId ?? null },
      });
    }
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
    if (glAccountId) {
      try {
        await assertGlAccountForCatalogItem(req.tenantId!, locationId, glAccountId);
      } catch (e) {
        res.status(400).json({ error: (e as Error).message });
        return;
      }
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
    if (glAccountId !== undefined && (await isLocationQboConnected(locationId))) {
      await prisma.serviceFeeGlMapping.upsert({
        where: { serviceFeeId_locationId: { serviceFeeId: fee.id, locationId } },
        create: {
          tenantId: req.tenantId!,
          serviceFeeId: fee.id,
          locationId,
          glAccountId: glAccountId ?? null,
        },
        update: { glAccountId: glAccountId ?? null },
      });
    }
    res.status(201).json({ data: fee });
  } catch (err) { next(err); }
});

// PUT /api/settings/catalog/service-fees/:id
router.put("/catalog/service-fees/:id", ...clerkAuth(), requireRole("MARINA_OWNER", "MARINA_MANAGER"), async (req, res, next) => {
  try {
    const existing = await prisma.serviceFee.findFirst({ where: { id: req.params.id, tenantId: req.tenantId! } });
    if (!existing) { res.status(404).json({ error: "Fee not found" }); return; }
    const { name, feeType, amountCents, pct, glAccountId, taxClass, active } = req.body;
    if (glAccountId && existing.locationId) {
      try {
        await assertGlAccountForCatalogItem(req.tenantId!, existing.locationId, glAccountId);
      } catch (e) {
        res.status(400).json({ error: (e as Error).message });
        return;
      }
    } else if (glAccountId && !(await assertGlAccountBelongsToTenant(glAccountId, req.tenantId!))) {
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
    if (
      glAccountId !== undefined
      && existing.locationId
      && (await isLocationQboConnected(existing.locationId))
    ) {
      await prisma.serviceFeeGlMapping.upsert({
        where: {
          serviceFeeId_locationId: {
            serviceFeeId: req.params.id,
            locationId: existing.locationId,
          },
        },
        create: {
          tenantId: req.tenantId!,
          serviceFeeId: req.params.id,
          locationId: existing.locationId,
          glAccountId: glAccountId ?? null,
        },
        update: { glAccountId: glAccountId ?? null },
      });
    }
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
    const where = filterByAllowedLocations(req, { tenantId: req.tenantId! } as Record<string, unknown>, {
      field: "id",
    });
    const locations = await prisma.location.findMany({
      where,
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
  // `active` is the legacy boolean; `isActive` is the QBO-aligned name added
  // alongside per-location chart of accounts. Both columns exist on the row
  // and we keep them synchronized in writes — accept either from the client
  // and mirror to both when persisting.
  active: z.boolean().optional(),
  isActive: z.boolean().optional(),
  locationId: z.string().optional().nullable(),
});

// GET /api/settings/gl-accounts?locationId=...
router.get("/gl-accounts", ...clerkAuth(), requireRole("MARINA_OWNER", "MARINA_MANAGER", "ACCOUNTING"), async (req, res, next) => {
  try {
    const tenantId = req.tenantId!;
    const locationId = typeof req.query.locationId === "string" ? req.query.locationId : undefined;
    const where: any = { tenantId };
    if (locationId === "TENANT") where.locationId = null;
    else if (locationId) where.locationId = locationId;
    const accounts = await prisma.glAccount.findMany({
      where,
      select: {
        id: true,
        accountNumber: true,
        name: true,
        type: true,
        subType: true,
        description: true,
        isDeferredRevenue: true,
        active: true,
        isActive: true,
        qboAccountId: true,
        source: true,
        locationId: true,
        location: { select: { id: true, name: true } },
      },
      orderBy: [{ locationId: "asc" }, { accountNumber: "asc" }],
    });
    res.json({ data: accounts });
  } catch (err) {
    next(err);
  }
});

// POST /api/settings/gl-accounts
router.post("/gl-accounts", ...clerkAuth(), requireRole("MARINA_OWNER", "MARINA_MANAGER", "ACCOUNTING"), async (req, res, next) => {
  try {
    const tenantId = req.tenantId!;
    const body = glAccountSchema.parse(req.body);

    const locationId = body.locationId ?? null;
    if (locationId) {
      const loc = await prisma.location.findFirst({ where: { id: locationId, tenantId } });
      if (!loc) { res.status(404).json({ error: "Location not found" }); return; }
    }

    // Check for duplicate account number within tenant + same scope
    const existing = await prisma.glAccount.findFirst({
      where: { tenantId, accountNumber: body.accountNumber, locationId },
    });
    if (existing) {
      res.status(409).json({ error: "An account with this number already exists" });
      return;
    }

    const activeFlag = body.isActive ?? body.active ?? true;
    const account = await prisma.glAccount.create({
      data: {
        tenantId,
        locationId,
        accountNumber: body.accountNumber,
        name: body.name,
        type: body.type,
        subType: body.subType ?? null,
        description: body.description ?? null,
        qboAccountId: body.qboAccountId ?? null,
        isDeferredRevenue: body.isDeferredRevenue ?? false,
        // Mirror both columns on every write — see schema comment.
        active: activeFlag,
        isActive: activeFlag,
        source: "MANUAL",
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
    const tenantId = req.tenantId!;
    const existing = await prisma.glAccount.findFirst({
      where: { id: req.params.id, tenantId },
    });
    if (!existing) {
      res.status(404).json({ error: "GL account not found" });
      return;
    }

    const body = glAccountSchema.partial().parse(req.body);
    const isQboSourced = existing.source === "QBO";

    // If changing account number, check for duplicates within the same scope
    if (body.accountNumber && body.accountNumber !== existing.accountNumber) {
      if (isQboSourced) {
        res.status(409).json({ error: "Account number is managed by QuickBooks for this account", code: "QBO_LOCKED_FIELD" });
        return;
      }
      const dup = await prisma.glAccount.findFirst({
        where: {
          tenantId,
          accountNumber: body.accountNumber,
          locationId: existing.locationId,
          id: { not: existing.id },
        },
      });
      if (dup) {
        res.status(409).json({ error: "An account with this number already exists" });
        return;
      }
    }

    // QBO-sourced rows: only isDeferredRevenue / isActive are editable.
    type GlAccountUpdate = {
      accountNumber?: string;
      name?: string;
      type?: typeof body.type;
      subType?: string | null;
      description?: string | null;
      qboAccountId?: string | null;
      isDeferredRevenue?: boolean;
      active?: boolean;
      isActive?: boolean;
    };
    const data: GlAccountUpdate = {};
    if (!isQboSourced) {
      if (body.accountNumber != null) data.accountNumber = body.accountNumber;
      if (body.name != null) data.name = body.name;
      if (body.type != null) data.type = body.type;
      if (body.subType !== undefined) data.subType = body.subType;
      if (body.description !== undefined) data.description = body.description;
      if (body.qboAccountId !== undefined) data.qboAccountId = body.qboAccountId;
    }
    if (body.isDeferredRevenue !== undefined) data.isDeferredRevenue = body.isDeferredRevenue;
    // Mirror active/isActive together — clients may send either field.
    const nextActive = body.isActive ?? body.active;
    if (nextActive !== undefined) {
      data.active = nextActive;
      data.isActive = nextActive;
    }

    const updated = await prisma.glAccount.update({
      where: { id: req.params.id },
      data,
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
    const tenantId = req.tenantId!;
    const existing = await prisma.glAccount.findFirst({
      where: { id: req.params.id, tenantId },
    });
    if (!existing) {
      res.status(404).json({ error: "GL account not found" });
      return;
    }

    // Check if any catalog products still reference this GL account.
    // Deleting (or NULL-ing) the FK on these would silently break GL posting,
    // so block the delete until the operator reassigns them. Rental products
    // no longer carry a tenant-wide FK; their references live in the
    // per-location `rental_product_gl_mappings` table across any of the
    // revenue / COGS / inventory-asset slots.
    const [dockageRateRefs, serviceFeeRefs, productRefs, rentalProductMappingRows] = await Promise.all([
      prisma.dockageRate.count({ where: { tenantId, glAccountId: req.params.id } }),
      prisma.serviceFee.count({ where: { tenantId, glAccountId: req.params.id } }),
      prisma.product.count({ where: { tenantId, glAccountId: req.params.id } }),
      prisma.rentalProductGlMapping.findMany({
        where: {
          tenantId,
          OR: [
            { revenueGlAccountId: req.params.id },
            { cogsGlAccountId: req.params.id },
            { inventoryAssetGlAccountId: req.params.id },
          ],
        },
        select: { rentalProductId: true },
      }),
    ]);
    // Distinct rental products affected — multiple per-location mapping
    // rows can reference the same product, but the operator only needs to
    // know how many unique products require reassignment.
    const rentalProductRefs = new Set(
      rentalProductMappingRows.map((m) => m.rentalProductId),
    ).size;
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
      // Soft-delete: mark inactive instead of hard delete. Mirror both
      // legacy `active` and the new `isActive` columns so the row is
      // hidden from QBO-aware filters and legacy filters alike.
      await prisma.glAccount.update({
        where: { id: req.params.id },
        data: { active: false, isActive: false },
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

// ─── CATALOG — PRODUCTS SUMMARY (all product types with GL account info) ─────

// GET /api/settings/catalog/products-summary?locationId=xxx
// Returns a unified view of all product-generating catalog entries
router.get("/catalog/products-summary", ...clerkAuth(), requireRole("MARINA_OWNER", "MARINA_MANAGER", "ACCOUNTING"), async (req, res, next) => {
  try {
    const tenantId = req.tenantId!;
    const { locationId } = req.query as { locationId?: string };
    const where: any = { tenantId };
    if (locationId) where.locationId = locationId;

    const [dockageRates, serviceFees, rentalProducts, glAccounts, drMappings, sfMappings, rpMappings, locationsForRentals] =
      await Promise.all([
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
          select: { id: true, name: true, category: true, active: true },
        }),
        prisma.glAccount.findMany({
          // Include REVENUE, EXPENSE, and ASSET so the rental-product per-
          // location editor can populate Revenue / COGS / Inventory dropdowns.
          // Other product editors filter the list down by `type` on the
          // client side.
          where: {
            tenantId,
            active: true,
            isActive: true,
            type: { in: ["REVENUE", "EXPENSE", "ASSET"] },
          },
          select: { id: true, accountNumber: true, name: true, type: true, locationId: true },
          orderBy: [{ locationId: "asc" }, { accountNumber: "asc" }],
        }),
        prisma.dockageRateGlMapping.findMany({ where: { tenantId } }),
        prisma.serviceFeeGlMapping.findMany({ where: { tenantId } }),
        prisma.rentalProductGlMapping.findMany({
          where: { tenantId },
          select: {
            rentalProductId: true,
            locationId: true,
            revenueGlAccountId: true,
            cogsGlAccountId: true,
            inventoryAssetGlAccountId: true,
          },
        }),
        prisma.location.findMany({
          where: { tenantId },
          orderBy: { name: "asc" },
          // qboAccessToken/qboRealmId are returned so the public response
          // can flatten them down to a `qboConnected` boolean for the
          // location-aware UI controls (account-list filtering, etc.).
          select: {
            id: true,
            name: true,
            qboAccessToken: true,
            qboRealmId: true,
          },
        }),
      ]);

    // Overlay per-location mapping onto the legacy FK so the UI sees the
    // effective value. Per-location mapping wins when present.
    const drMap = new Map<string, string | null>();
    for (const m of drMappings) {
      drMap.set(`${m.dockageRateId}|${m.locationId}`, m.glAccountId ?? null);
    }
    const sfMap = new Map<string, string | null>();
    for (const m of sfMappings) {
      sfMap.set(`${m.serviceFeeId}|${m.locationId}`, m.glAccountId ?? null);
    }
    const dockageRatesEnriched = dockageRates.map((r) => {
      const override = drMap.get(`${r.id}|${r.locationId}`);
      return { ...r, glAccountId: override !== undefined ? override : r.glAccountId };
    });
    const serviceFeesEnriched = serviceFees.map((f) => {
      const override = sfMap.get(`${f.id}|${f.locationId}`);
      return { ...f, glAccountId: override !== undefined ? override : f.glAccountId };
    });

    // Build per-location mapping rows for each rental product. The
    // tenant-wide legacy RentalProduct.glAccountId column has been
    // retired, so each row's `effective` slots are sourced exclusively
    // from the per-location override (or null when unmapped).
    const rpMapByPair = new Map<
      string,
      {
        revenueGlAccountId: string | null;
        cogsGlAccountId: string | null;
        inventoryAssetGlAccountId: string | null;
      }
    >();
    for (const m of rpMappings) {
      rpMapByPair.set(`${m.rentalProductId}|${m.locationId}`, {
        revenueGlAccountId: m.revenueGlAccountId,
        cogsGlAccountId: m.cogsGlAccountId,
        inventoryAssetGlAccountId: m.inventoryAssetGlAccountId,
      });
    }
    // When a single locationId is provided, narrow the per-location
    // expansion to just that location so the rental-products section can
    // render as a flat one-row-per-product table instead of a grid.
    // Tenant-wide mode (no locationId param) keeps the full per-location
    // expansion across every location.
    const rentalLocations = locationId
      ? locationsForRentals.filter((l) => l.id === locationId)
      : locationsForRentals;

    const rentalProductsEnriched = rentalProducts.map((p) => {
      const perLocation = rentalLocations.map((l) => {
        const mm = rpMapByPair.get(`${p.id}|${l.id}`);
        return {
          locationId: l.id,
          locationName: l.name,
          override: {
            revenueGlAccountId: mm?.revenueGlAccountId ?? null,
            cogsGlAccountId: mm?.cogsGlAccountId ?? null,
            inventoryAssetGlAccountId: mm?.inventoryAssetGlAccountId ?? null,
          },
          effective: {
            revenueGlAccountId: mm?.revenueGlAccountId ?? null,
            cogsGlAccountId: mm?.cogsGlAccountId ?? null,
            inventoryAssetGlAccountId: mm?.inventoryAssetGlAccountId ?? null,
          },
        };
      });
      return { ...p, perLocation };
    });

    // Don't leak QBO tokens/realm IDs to the client — strip them down to a
    // boolean `qboConnected` flag the UI can use for option-filtering and
    // optimistic recomputation. Always return the *full* set of locations
    // so the UI can populate any location-aware controls (e.g. the GL
    // dropdown's tenant-wide vs location-scoped split) regardless of which
    // location is currently selected.
    const locationsForRentalsPublic = locationsForRentals.map((l) => ({
      id: l.id,
      name: l.name,
      qboConnected: !!(l.qboAccessToken && l.qboRealmId),
    }));

    // Count unconfigured items (no effective revenue mapping). For rental
    // products this means *any* location that lacks an effective revenue
    // mapping counts toward the warning total — every location now needs an
    // explicit per-location override since the legacy tenant-wide FK was
    // retired. In single-location mode the gap count is naturally narrowed
    // because `perLocation` only contains that one location. A tenant with
    // zero locations counts each active product as a single gap.
    const rentalUnconfigured = rentalProductsEnriched
      .filter((p) => p.active)
      .reduce((acc, p) => {
        const gaps = rentalLocations.length === 0
          ? 1
          : p.perLocation.filter((row) => !row.effective.revenueGlAccountId).length;
        return acc + gaps;
      }, 0);
    const unconfiguredCount =
      dockageRatesEnriched.filter((r) => !r.glAccountId).length +
      serviceFeesEnriched.filter((f) => !f.glAccountId).length +
      rentalUnconfigured;

    // In single-location mode, narrow missing-mapping warnings to that
    // location so the banner doesn't list other marinas the operator
    // isn't currently looking at.
    const allWarnings = await getMissingGlAccountWarnings(tenantId);
    const warnings = locationId
      ? allWarnings.filter((w) => w.locationId === locationId)
      : allWarnings;
    res.json({
      data: {
        dockageRates: dockageRatesEnriched,
        serviceFees: serviceFeesEnriched,
        rentalProducts: rentalProductsEnriched,
        locations: locationsForRentalsPublic,
        glAccounts,
        unconfiguredCount,
        // The "no GL accounts configured" banner is about *revenue*
        // accounts; the EXPENSE/ASSET rows we now include are only for
        // populating COGS/inventory dropdowns on rental products.
        hasGlAccounts: glAccounts.some((a) => a.type === "REVENUE"),
        missingMappingWarnings: warnings,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ─── PER-LOCATION GL MAPPINGS ────────────────────────────────────────────────
//
// Each catalog item (product, category, dockage rate, service fee) can have
// a GlAccount mapping per location. These endpoints return one row per
// location for the tenant: { locationId, locationName, override, effective }.
// Effective resolution: per-location override → category default → tenant
// legacy FK → null. Write endpoints validate that the chosen GL account
// belongs to the same location.
// ─────────────────────────────────────────────────────────────────────────────

const productMappingPutSchema = z.object({
  revenueGlAccountId: z.string().nullable().optional(),
  cogsGlAccountId: z.string().nullable().optional(),
  inventoryAssetGlAccountId: z.string().nullable().optional(),
});

const singleMappingPutSchema = z.object({
  glAccountId: z.string().nullable().optional(),
});

async function listLocations(tenantId: string) {
  return prisma.location.findMany({
    where: { tenantId },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
}

async function validateGlAccountForLocation(
  tenantId: string,
  locationId: string,
  glAccountId: string | null | undefined,
) {
  if (!glAccountId) return;
  const a = await prisma.glAccount.findFirst({
    where: { id: glAccountId, tenantId },
    select: { id: true, locationId: true },
  });
  if (!a) throw new Error(`GL account ${glAccountId} not found`);
  // For QBO-connected locations every mapping has to point at an account
  // pulled from that location's QBO chart — tenant-wide and other-location
  // accounts are rejected so postings cannot land in the wrong realm.
  // For non-QBO locations we still accept tenant-wide accounts (locationId
  // === null) so single-chart tenants can keep using their legacy chart as
  // a coherent fallback. Other locations' accounts are always rejected.
  if (a.locationId === locationId) return;
  if (a.locationId === null && !(await isLocationQboConnected(locationId))) {
    return;
  }
  throw new Error(
    `GL account ${glAccountId} belongs to a different location`,
  );
}

// NOTE: per-product GL mapping endpoints (GET/PUT /products/:id/gl-mappings)
// were removed in 20260429080000_inventory_category_only_gl. Inventory GL
// resolves through the per-(category, location) row only — manage mappings
// at /product-categories/:id/gl-mappings below.

// GET /api/settings/product-categories/:id/gl-mappings
router.get(
  "/product-categories/:id/gl-mappings",
  ...clerkAuth(),
  requireRole("MARINA_OWNER", "MARINA_MANAGER", "ACCOUNTING"),
  async (req, res, next) => {
    try {
      const tenantId = req.tenantId!;
      const cat = await prisma.productCategory.findFirst({
        where: { id: req.params.id, tenantId },
        select: { id: true },
      });
      if (!cat) {
        res.status(404).json({ error: "Category not found" });
        return;
      }
      const [locs, mappings] = await Promise.all([
        listLocations(tenantId),
        prisma.productCategoryGlMapping.findMany({
          where: { tenantId, productCategoryId: req.params.id },
        }),
      ]);
      const qboFlags = await Promise.all(
        locs.map((l) => isLocationQboConnected(l.id)),
      );
      const data = locs.map((l, i) => {
        const mm = mappings.find((m) => m.locationId === l.id);
        const qboConnected = qboFlags[i];
        return {
          locationId: l.id,
          locationName: l.name,
          qboConnected,
          override: {
            revenueGlAccountId: mm?.revenueGlAccountId ?? null,
            cogsGlAccountId: mm?.cogsGlAccountId ?? null,
            inventoryAssetGlAccountId: mm?.inventoryAssetGlAccountId ?? null,
          },
          // Effective == override now that legacy tenant-wide defaults are
          // gone. The per-(category, location) row is the only source.
          effective: {
            revenueGlAccountId: mm?.revenueGlAccountId ?? null,
            cogsGlAccountId: mm?.cogsGlAccountId ?? null,
            inventoryAssetGlAccountId: mm?.inventoryAssetGlAccountId ?? null,
          },
        };
      });
      res.json({ data });
    } catch (err) {
      next(err);
    }
  },
);

// PUT /api/settings/product-categories/:id/gl-mappings/:locationId
router.put(
  "/product-categories/:id/gl-mappings/:locationId",
  ...clerkAuth(),
  requireRole("MARINA_OWNER", "MARINA_MANAGER", "ACCOUNTING"),
  async (req, res, next) => {
    try {
      const tenantId = req.tenantId!;
      const body = productMappingPutSchema.parse(req.body);
      const { id, locationId } = req.params;
      const [cat, location] = await Promise.all([
        prisma.productCategory.findFirst({
          where: { id, tenantId },
          select: { id: true },
        }),
        prisma.location.findFirst({
          where: { id: locationId, tenantId },
          select: { id: true },
        }),
      ]);
      if (!cat) {
        res.status(404).json({ error: "Category not found" });
        return;
      }
      if (!location) {
        res.status(404).json({ error: "Location not found" });
        return;
      }
      await Promise.all([
        validateGlAccountForLocation(tenantId, locationId, body.revenueGlAccountId),
        validateGlAccountForLocation(tenantId, locationId, body.cogsGlAccountId),
        validateGlAccountForLocation(
          tenantId,
          locationId,
          body.inventoryAssetGlAccountId,
        ),
      ]);
      const data = {
        revenueGlAccountId: body.revenueGlAccountId ?? null,
        cogsGlAccountId: body.cogsGlAccountId ?? null,
        inventoryAssetGlAccountId: body.inventoryAssetGlAccountId ?? null,
      };
      const result = await prisma.productCategoryGlMapping.upsert({
        where: {
          productCategoryId_locationId: { productCategoryId: id, locationId },
        },
        create: { tenantId, productCategoryId: id, locationId, ...data },
        update: data,
      });
      res.json({ data: result });
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ error: "Validation failed", details: err.errors });
        return;
      }
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("not found") || msg.includes("different location")) {
        res.status(400).json({ error: msg });
        return;
      }
      next(err);
    }
  },
);

// GET /api/settings/catalog/dockage-rates/:id/gl-mappings
router.get(
  "/catalog/dockage-rates/:id/gl-mappings",
  ...clerkAuth(),
  requireRole("MARINA_OWNER", "MARINA_MANAGER", "ACCOUNTING"),
  async (req, res, next) => {
    try {
      const tenantId = req.tenantId!;
      const rate = await prisma.dockageRate.findFirst({
        where: { id: req.params.id, tenantId },
        select: { id: true, locationId: true, glAccountId: true },
      });
      if (!rate) {
        res.status(404).json({ error: "Dockage rate not found" });
        return;
      }
      const [locs, mappings] = await Promise.all([
        listLocations(tenantId),
        prisma.dockageRateGlMapping.findMany({
          where: { tenantId, dockageRateId: req.params.id },
        }),
      ]);
      const ownLocations = locs.filter((l) => l.id === rate.locationId);
      const qboFlags = await Promise.all(
        ownLocations.map((l) => isLocationQboConnected(l.id)),
      );
      const data = ownLocations.map((l, i) => {
        const mm = mappings.find((m) => m.locationId === l.id);
        const qboConnected = qboFlags[i];
        return {
          locationId: l.id,
          locationName: l.name,
          qboConnected,
          override: { glAccountId: mm?.glAccountId ?? null },
          effective: {
            glAccountId:
              mm?.glAccountId ??
              (qboConnected ? null : rate.glAccountId ?? null),
          },
        };
      });
      res.json({ data });
    } catch (err) {
      next(err);
    }
  },
);

// PUT /api/settings/catalog/dockage-rates/:id/gl-mappings/:locationId
router.put(
  "/catalog/dockage-rates/:id/gl-mappings/:locationId",
  ...clerkAuth(),
  requireRole("MARINA_OWNER", "MARINA_MANAGER", "ACCOUNTING"),
  async (req, res, next) => {
    try {
      const tenantId = req.tenantId!;
      const body = singleMappingPutSchema.parse(req.body);
      const { id, locationId } = req.params;
      const rate = await prisma.dockageRate.findFirst({
        where: { id, tenantId },
        select: { id: true, locationId: true },
      });
      if (!rate) {
        res.status(404).json({ error: "Dockage rate not found" });
        return;
      }
      if (rate.locationId !== locationId) {
        res.status(400).json({
          error: "Dockage rate does not belong to that location",
        });
        return;
      }
      await validateGlAccountForLocation(tenantId, locationId, body.glAccountId);
      const data = { glAccountId: body.glAccountId ?? null };
      const result = await prisma.dockageRateGlMapping.upsert({
        where: {
          dockageRateId_locationId: { dockageRateId: id, locationId },
        },
        create: { tenantId, dockageRateId: id, locationId, ...data },
        update: data,
      });
      res.json({ data: result });
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ error: "Validation failed", details: err.errors });
        return;
      }
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("not found") || msg.includes("different location")) {
        res.status(400).json({ error: msg });
        return;
      }
      next(err);
    }
  },
);

// GET /api/settings/catalog/service-fees/:id/gl-mappings
router.get(
  "/catalog/service-fees/:id/gl-mappings",
  ...clerkAuth(),
  requireRole("MARINA_OWNER", "MARINA_MANAGER", "ACCOUNTING"),
  async (req, res, next) => {
    try {
      const tenantId = req.tenantId!;
      const fee = await prisma.serviceFee.findFirst({
        where: { id: req.params.id, tenantId },
        select: { id: true, locationId: true, glAccountId: true },
      });
      if (!fee) {
        res.status(404).json({ error: "Service fee not found" });
        return;
      }
      const [locs, mappings] = await Promise.all([
        listLocations(tenantId),
        prisma.serviceFeeGlMapping.findMany({
          where: { tenantId, serviceFeeId: req.params.id },
        }),
      ]);
      const ownLocations = locs.filter((l) => l.id === fee.locationId);
      const qboFlags = await Promise.all(
        ownLocations.map((l) => isLocationQboConnected(l.id)),
      );
      const data = ownLocations.map((l, i) => {
        const mm = mappings.find((m) => m.locationId === l.id);
        const qboConnected = qboFlags[i];
        return {
          locationId: l.id,
          locationName: l.name,
          qboConnected,
          override: { glAccountId: mm?.glAccountId ?? null },
          effective: {
            glAccountId:
              mm?.glAccountId ??
              (qboConnected ? null : fee.glAccountId ?? null),
          },
        };
      });
      res.json({ data });
    } catch (err) {
      next(err);
    }
  },
);

// GET /api/settings/catalog/rental-products/:id/gl-mappings
//
// Returns one row per location for the tenant: { locationId, locationName,
// qboConnected, override, effective }. Override is the per-location mapping
// row if any. The legacy tenant-wide RentalProduct.glAccountId column has
// been retired, so the per-location mapping is now the sole source for the
// `effective` slots — there is no further fallback.
router.get(
  "/catalog/rental-products/:id/gl-mappings",
  ...clerkAuth(),
  requireRole("MARINA_OWNER", "MARINA_MANAGER", "ACCOUNTING"),
  async (req, res, next) => {
    try {
      const tenantId = req.tenantId!;
      const product = await prisma.rentalProduct.findFirst({
        where: { id: req.params.id, tenantId },
        select: { id: true },
      });
      if (!product) {
        res.status(404).json({ error: "Rental product not found" });
        return;
      }
      const [locs, mappings] = await Promise.all([
        listLocations(tenantId),
        prisma.rentalProductGlMapping.findMany({
          where: { tenantId, rentalProductId: req.params.id },
        }),
      ]);
      const qboFlags = await Promise.all(
        locs.map((l) => isLocationQboConnected(l.id)),
      );
      const data = locs.map((l, i) => {
        const mm = mappings.find((m) => m.locationId === l.id);
        const qboConnected = qboFlags[i];
        return {
          locationId: l.id,
          locationName: l.name,
          qboConnected,
          override: {
            revenueGlAccountId: mm?.revenueGlAccountId ?? null,
            cogsGlAccountId: mm?.cogsGlAccountId ?? null,
            inventoryAssetGlAccountId: mm?.inventoryAssetGlAccountId ?? null,
          },
          effective: {
            revenueGlAccountId: mm?.revenueGlAccountId ?? null,
            cogsGlAccountId: mm?.cogsGlAccountId ?? null,
            inventoryAssetGlAccountId: mm?.inventoryAssetGlAccountId ?? null,
          },
        };
      });
      res.json({ data });
    } catch (err) {
      next(err);
    }
  },
);

// PUT /api/settings/catalog/rental-products/:id/gl-mappings/:locationId
router.put(
  "/catalog/rental-products/:id/gl-mappings/:locationId",
  ...clerkAuth(),
  requireRole("MARINA_OWNER", "MARINA_MANAGER", "ACCOUNTING"),
  async (req, res, next) => {
    try {
      const tenantId = req.tenantId!;
      const body = productMappingPutSchema.parse(req.body);
      const { id, locationId } = req.params;
      const [product, location] = await Promise.all([
        prisma.rentalProduct.findFirst({
          where: { id, tenantId },
          select: { id: true },
        }),
        prisma.location.findFirst({
          where: { id: locationId, tenantId },
          select: { id: true },
        }),
      ]);
      if (!product) {
        res.status(404).json({ error: "Rental product not found" });
        return;
      }
      if (!location) {
        res.status(404).json({ error: "Location not found" });
        return;
      }
      await Promise.all([
        validateGlAccountForLocation(tenantId, locationId, body.revenueGlAccountId),
        validateGlAccountForLocation(tenantId, locationId, body.cogsGlAccountId),
        validateGlAccountForLocation(
          tenantId,
          locationId,
          body.inventoryAssetGlAccountId,
        ),
      ]);
      const data = {
        revenueGlAccountId: body.revenueGlAccountId ?? null,
        cogsGlAccountId: body.cogsGlAccountId ?? null,
        inventoryAssetGlAccountId: body.inventoryAssetGlAccountId ?? null,
      };
      const result = await prisma.rentalProductGlMapping.upsert({
        where: {
          rentalProductId_locationId: { rentalProductId: id, locationId },
        },
        create: { tenantId, rentalProductId: id, locationId, ...data },
        update: data,
      });
      res.json({ data: result });
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ error: "Validation failed", details: err.errors });
        return;
      }
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("not found") || msg.includes("different location")) {
        res.status(400).json({ error: msg });
        return;
      }
      next(err);
    }
  },
);

// PUT /api/settings/catalog/service-fees/:id/gl-mappings/:locationId
router.put(
  "/catalog/service-fees/:id/gl-mappings/:locationId",
  ...clerkAuth(),
  requireRole("MARINA_OWNER", "MARINA_MANAGER", "ACCOUNTING"),
  async (req, res, next) => {
    try {
      const tenantId = req.tenantId!;
      const body = singleMappingPutSchema.parse(req.body);
      const { id, locationId } = req.params;
      const fee = await prisma.serviceFee.findFirst({
        where: { id, tenantId },
        select: { id: true, locationId: true },
      });
      if (!fee) {
        res.status(404).json({ error: "Service fee not found" });
        return;
      }
      if (fee.locationId !== locationId) {
        res.status(400).json({
          error: "Service fee does not belong to that location",
        });
        return;
      }
      await validateGlAccountForLocation(tenantId, locationId, body.glAccountId);
      const data = { glAccountId: body.glAccountId ?? null };
      const result = await prisma.serviceFeeGlMapping.upsert({
        where: {
          serviceFeeId_locationId: { serviceFeeId: id, locationId },
        },
        create: { tenantId, serviceFeeId: id, locationId, ...data },
        update: data,
      });
      res.json({ data: result });
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ error: "Validation failed", details: err.errors });
        return;
      }
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("not found") || msg.includes("different location")) {
        res.status(400).json({ error: msg });
        return;
      }
      next(err);
    }
  },
);

export default router;
