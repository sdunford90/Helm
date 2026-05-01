import { Router } from "express";
import { z } from "zod";
import { clerkClient } from "@clerk/express";
import { prisma } from "../lib/prisma.js";
import { requireStripe } from "../lib/stripe.js";
import { issueOAuthState, verifyOAuthState } from "../lib/oauth-state.js";
import { seedChartOfAccounts } from "../services/tenant-provisioning.js";

const router: Router = Router();

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
  // When present, the backend creates a Clerk Organization linked to this
  // tenant and adds the given Clerk user as its admin. The frontend /signup
  // flow passes this; automated tests can omit it.
  clerkUserId: z.string().optional(),
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

    // Create the marina's first Location. Stripe Connect and QuickBooks now
    // bind to a Location (each property files its own books and routes its
    // own payments), so the onboarding wizard needs at least one to exist
    // before its Stripe/QBO steps. The owner can rename or add more later
    // from Settings → Locations.
    const defaultLocation = await prisma.location.create({
      data: {
        tenantId: tenant.id,
        name: data.marinaName,
        timezone: data.timezone,
        active: true,
        accountingGracePeriodEndsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });

    // Create admin user with MARINA_OWNER role. If the request came from an
    // authenticated Clerk sign-up, link the clerkUserId so subsequent
    // auth webhooks don't re-create the record.
    const adminUser = await prisma.user.create({
      data: {
        tenantId: tenant.id,
        email: data.adminEmail,
        firstName: data.adminFirstName,
        lastName: data.adminLastName,
        role: "MARINA_OWNER",
        ...(data.clerkUserId ? { clerkUserId: data.clerkUserId } : {}),
      },
    });

    // Create a Clerk Organization for this tenant when we have an
    // authenticated user to anchor it to. The org's public_metadata.tenant_id
    // is what the auth.ts webhooks use to correlate future sign-ups that
    // join the org.
    let clerkOrganizationId: string | null = null;
    if (data.clerkUserId) {
      try {
        const org = await clerkClient.organizations.createOrganization({
          name: data.marinaName,
          createdBy: data.clerkUserId,
          publicMetadata: { tenant_id: tenant.id },
        });
        clerkOrganizationId = org.id;
      } catch (err) {
        // Non-fatal: tenant is created, the owner can retry the Clerk link.
        // Log with enough context for operators to diagnose.
        console.error(
          `[onboarding/start] Clerk org creation failed for tenant ${tenant.id}:`,
          err,
        );
      }
    }

    // Seed the default chart of accounts. Idempotent — the UI can re-run the
    // explicit /chart-of-accounts endpoint if this fails.
    let chartSeeded = false;
    try {
      const result = await seedChartOfAccounts(prisma, tenant.id);
      chartSeeded = result.created > 0;
    } catch (err) {
      console.error(
        `[onboarding/start] Chart-of-accounts seed failed for tenant ${tenant.id}:`,
        err,
      );
    }

    const setupSteps = {
      branding: { complete: false, label: "Configure branding" },
      stripe: { complete: false, label: "Connect Stripe account" },
      qbo: { complete: false, label: "Connect QuickBooks Online" },
      chartOfAccounts: { complete: chartSeeded, label: "Seed chart of accounts" },
      twilio: { complete: false, label: "Provision phone number" },
    };

    res.status(201).json({
      tenant,
      adminUser,
      clerkOrganizationId,
      defaultLocation: { id: defaultLocation.id, name: defaultLocation.name },
      setupSteps,
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
    const locationId: string | undefined = typeof req.body?.locationId === "string" && req.body.locationId
      ? req.body.locationId
      : undefined;

    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) {
      res.status(404).json({ error: "Tenant not found", code: "NOT_FOUND" });
      return;
    }

    // When the caller targets a specific Location (the per-location model),
    // verify it belongs to this tenant and use its existing stripeAccountId
    // as the seed; otherwise fall back to the tenant-level account.
    let location: { id: string; stripeAccountId: string | null } | null = null;
    if (locationId) {
      location = await prisma.location.findFirst({
        where: { id: locationId, tenantId },
        select: { id: true, stripeAccountId: true },
      });
      if (!location) {
        res.status(404).json({ error: "Location not found", code: "LOCATION_NOT_FOUND" });
        return;
      }
    }

    const s = requireStripe();

    // If we don't have a connected account yet, create one.
    let stripeAccountId = location ? location.stripeAccountId : tenant.stripeAccountId;
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

      if (location) {
        await prisma.location.update({
          where: { id: location.id },
          data: { stripeAccountId, stripeOnboardingComplete: false },
        });
      } else {
        await prisma.tenant.update({
          where: { id: tenantId },
          data: { stripeAccountId },
        });
      }
    }

    // Hand the marina a hosted onboarding URL. AccountLinks accepts the v2
    // account id; Stripe renders its own onboarding flow.
    const appUrl = process.env.APP_URL ?? "http://localhost:5000";
    const link = await s.accountLinks.create({
      account: stripeAccountId,
      refresh_url: `${appUrl}/oauth-complete?provider=stripe&success=false`,
      return_url: `${appUrl}/oauth-complete?provider=stripe&success=true`,
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
    const locationId: string | undefined = typeof req.body?.locationId === "string" && req.body.locationId
      ? req.body.locationId
      : undefined;

    // Verify tenant exists
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) {
      res.status(404).json({ error: "Tenant not found", code: "NOT_FOUND" });
      return;
    }

    // If a Location is targeted, verify it belongs to this tenant before
    // embedding it into the signed OAuth state.
    if (locationId) {
      const location = await prisma.location.findFirst({
        where: { id: locationId, tenantId },
        select: { id: true },
      });
      if (!location) {
        res.status(404).json({ error: "Location not found", code: "LOCATION_NOT_FOUND" });
        return;
      }
    }

    const clientId = process.env.QBO_CLIENT_ID;
    const redirectUri = `${process.env.APP_URL}/api/onboarding/${tenantId}/qbo/callback`;
    const scope = "com.intuit.quickbooks.accounting";
    // Sign the state so an attacker who knows the tenantId can't forge the
    // callback. Verified on the callback route. The optional locationId is
    // carried through so the callback knows whether to write the realmId to
    // the Location row or the Tenant row.
    const state = issueOAuthState(tenantId, { locationId });

    const authUrl =
      `https://appcenter.intuit.com/connect/oauth2?` +
      `client_id=${clientId}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&scope=${scope}` +
      `&response_type=code` +
      `&state=${encodeURIComponent(state)}`;

    res.json({ url: authUrl });
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------------
// GET /api/onboarding/:tenantId/qbo/callback — QBO OAuth callback
// --------------------------------------------------------------------------
router.get("/:tenantId/qbo/callback", async (req, res, next) => {
  const frontendUrl = process.env.APP_URL ?? "http://localhost:5000";
  const failRedirect = (reason: string, locationId?: string) => {
    const params = new URLSearchParams({
      provider: "qbo",
      success: "false",
      reason,
    });
    if (locationId) params.set("locationId", locationId);
    res.redirect(`${frontendUrl}/oauth-complete?${params.toString()}`);
  };

  let stateLocationId: string | undefined;
  try {
    const { tenantId } = req.params;
    const { code, realmId, state } = req.query;

    if (!code || typeof code !== "string") {
      console.error("[onboarding-qbo-callback] missing authorization code", { tenantId });
      failRedirect("missing_code");
      return;
    }
    if (!realmId || typeof realmId !== "string") {
      console.error("[onboarding-qbo-callback] missing realmId", { tenantId });
      failRedirect("missing_realm");
      return;
    }
    if (!state || typeof state !== "string") {
      console.error("[onboarding-qbo-callback] missing state", { tenantId });
      failRedirect("missing_state");
      return;
    }

    // CSRF: verify the signed state matches this tenant before doing anything
    // sensitive. Rejects expired tokens, bad signatures, and state from a
    // different tenant's authorize call. Also extracts the optional
    // locationId so we can write the realmId to the right row.
    try {
      const verified = verifyOAuthState(state);
      if (verified.tenantId !== tenantId) {
        console.error("[onboarding-qbo-callback] state tenant mismatch", {
          urlTenantId: tenantId,
          stateTenantId: verified.tenantId,
        });
        failRedirect("tenant_mismatch");
        return;
      }
      stateLocationId = verified.locationId;
    } catch (err) {
      console.error("[onboarding-qbo-callback] state verification failed", {
        tenantId,
        error: err instanceof Error ? err.message : String(err),
      });
      failRedirect("invalid_state");
      return;
    }

    // Validate that the location (if any) still belongs to this tenant.
    if (stateLocationId) {
      const loc = await prisma.location.findFirst({
        where: { id: stateLocationId, tenantId },
        select: { id: true },
      });
      if (!loc) {
        console.error("[onboarding-qbo-callback] location no longer belongs to tenant", {
          tenantId,
          locationId: stateLocationId,
        });
        failRedirect("location_mismatch", stateLocationId);
        return;
      }
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
      console.error("[onboarding-qbo-callback] QBO token exchange failed", {
        tenantId,
        locationId: stateLocationId,
        status: tokenResponse.status,
        body: errBody,
      });
      failRedirect("token_exchange_failed", stateLocationId);
      return;
    }

    // Store realmId on the targeted Location (per-location model) or fall
    // back to the legacy tenant-level field.
    if (stateLocationId) {
      await prisma.location.update({
        where: { id: stateLocationId },
        data: { qboRealmId: realmId as string, qboConnectedAt: new Date() },
      });
    } else {
      await prisma.tenant.update({
        where: { id: tenantId },
        data: { qboRealmId: realmId as string },
      });
    }

    const params = new URLSearchParams({
      provider: "qbo",
      success: "true",
    });
    if (stateLocationId) params.set("locationId", stateLocationId);
    res.redirect(`${frontendUrl}/oauth-complete?${params.toString()}`);
  } catch (err) {
    console.error("[onboarding-qbo-callback] unexpected error", err);
    try {
      failRedirect("unexpected_error", stateLocationId);
    } catch {
      next(err);
    }
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

    const result = await seedChartOfAccounts(prisma, tenantId);
    const accounts = await prisma.glAccount.findMany({
      where: { tenantId },
      orderBy: { accountNumber: "asc" },
    });
    res.status(201).json({ accounts, created: result.created });
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

    const branding = tenant.brandingJson as Record<string, unknown> | null;
    const brandingComplete =
      !!branding && typeof branding === "object" && !!branding.marinaName;

    const stripeConnected = !!tenant.stripeAccountId;
    const qboConnected = !!tenant.qboRealmId;

    const accountCount = await prisma.glAccount.count({
      where: { tenantId },
    });
    const chartOfAccountsSeeded = accountCount > 0;

    // Twilio provisioning flag is surfaced via tenant.brandingJson for now
    // (tenant.settings doesn't exist as a column). Treat as incomplete when
    // unset.
    const twilioProvisioned =
      !!branding && typeof branding === "object" && !!branding.twilioPhoneNumber;

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
