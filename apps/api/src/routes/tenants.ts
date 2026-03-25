import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { clerkAuth, requireRole } from "../middleware/auth.js";
import { stripe } from "../lib/stripe.js";

const router = Router();

// --------------------------------------------------------------------------
// Validation schemas
// --------------------------------------------------------------------------

const createTenantSchema = z.object({
  name: z.string().min(1).max(255),
  subdomain: z.string().min(2).max(63).regex(/^[a-z0-9-]+$/),
  owner_email: z.string().email(),
  owner_name: z.string().min(1),
  settings: z.record(z.unknown()).optional(),
});

const updateTenantSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  branding: z.record(z.unknown()).optional(),
  settings: z.record(z.unknown()).optional(),
  custom_domain: z.string().nullable().optional(),
});

// --------------------------------------------------------------------------
// POST /api/tenants — create a new tenant (onboarding wizard)
// --------------------------------------------------------------------------
router.post("/", async (req, res, next) => {
  try {
    const data = createTenantSchema.parse(req.body);

    // Ensure subdomain uniqueness
    const existing = await prisma.tenant.findFirst({
      where: { subdomain: data.subdomain },
    });
    if (existing) {
      res.status(409).json({ error: "Subdomain already taken", code: "SUBDOMAIN_CONFLICT" });
      return;
    }

    const tenant = await prisma.tenant.create({
      data: {
        name: data.name,
        subdomain: data.subdomain,
        settings: data.settings ?? {},
      },
    });

    res.status(201).json({ tenant });
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------------
// GET /api/tenants/:id
// --------------------------------------------------------------------------
router.get("/:id", ...clerkAuth(), async (req, res, next) => {
  try {
    const tenant = await prisma.tenant.findUnique({
      where: { id: req.params.id },
    });

    if (!tenant) {
      res.status(404).json({ error: "Tenant not found", code: "NOT_FOUND" });
      return;
    }

    res.json({ tenant });
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------------
// PUT /api/tenants/:id — update branding / settings
// --------------------------------------------------------------------------
router.put("/:id", ...clerkAuth(), requireRole("admin"), async (req, res, next) => {
  try {
    const data = updateTenantSchema.parse(req.body);

    const tenant = await prisma.tenant.update({
      where: { id: req.params.id },
      data,
    });

    res.json({ tenant });
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------------
// POST /api/tenants/:id/stripe/connect — initiate Stripe Connect OAuth
// --------------------------------------------------------------------------
router.post("/:id/stripe/connect", ...clerkAuth(), requireRole("admin"), async (req, res, next) => {
  try {
    const accountLink = await stripe.accountLinks.create({
      account: req.params.id, // Will be the connected account id stored on tenant
      refresh_url: `${process.env.APP_URL}/settings/stripe?refresh=true`,
      return_url: `${process.env.APP_URL}/settings/stripe?success=true`,
      type: "account_onboarding",
    });

    res.json({ url: accountLink.url });
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------------
// POST /api/tenants/:id/qbo/connect — initiate QuickBooks Online OAuth
// --------------------------------------------------------------------------
router.post("/:id/qbo/connect", ...clerkAuth(), requireRole("admin"), async (req, res, next) => {
  try {
    const clientId = process.env.QBO_CLIENT_ID;
    const redirectUri = `${process.env.APP_URL}/api/callbacks/qbo`;
    const scope = "com.intuit.quickbooks.accounting";
    const state = req.params.id; // Tenant id for callback correlation

    const authUrl =
      `https://appcenter.intuit.com/connect/oauth2?` +
      `client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&scope=${scope}&response_type=code&state=${state}`;

    res.json({ url: authUrl });
  } catch (err) {
    next(err);
  }
});

export default router;
