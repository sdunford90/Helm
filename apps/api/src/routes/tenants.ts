import { Router } from "express";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { clerkAuth, requireRole } from "../middleware/auth.js";

const router = Router();

// --------------------------------------------------------------------------
// Tenant self-service. Everything here operates on the Host-resolved
// req.tenantId of the authenticated staff user — never on an id from the URL
// or body. Removed (Phase 0):
//   POST /api/tenants                 unauthenticated tenant creation;
//                                     onboarding/start is the only create path
//   GET/PUT /api/tenants/:id          cross-tenant read/write by id
//   POST /api/tenants/:id/stripe/connect, /:id/qbo/connect
//                                     duplicates of settings/stripe/connect
//                                     and /api/qbo/authorize
// --------------------------------------------------------------------------

/**
 * Explicit allow-list of tenant columns returned to the UI. Never return
 * integration secrets/ids (QBO realm/tokens, Stripe account id): expose
 * only whether they are connected.
 */
const tenantPublicSelect = {
  id: true,
  name: true,
  subdomain: true,
  customDomain: true,
  brandingJson: true,
  timezone: true,
  fiscalYearEnd: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  stripeAccountId: true,
  qboRealmId: true,
} satisfies Prisma.TenantSelect;

type TenantRow = Prisma.TenantGetPayload<{ select: typeof tenantPublicSelect }>;

function toPublicTenant(t: TenantRow) {
  const { stripeAccountId, qboRealmId, ...rest } = t;
  return {
    ...rest,
    stripeConnected: !!stripeAccountId,
    qboConnected: !!qboRealmId,
  };
}

const updateTenantSchema = z
  .object({
    name: z.string().min(1).max(255).optional(),
    branding: z.record(z.unknown()).optional(),
  })
  .strict();

// --------------------------------------------------------------------------
// GET /api/tenants/current
// --------------------------------------------------------------------------
router.get("/current", ...clerkAuth(), async (req, res, next) => {
  try {
    const tenant = await prisma.tenant.findUnique({
      where: { id: req.tenantId! },
      select: tenantPublicSelect,
    });

    if (!tenant) {
      res.status(404).json({ error: "Tenant not found", code: "NOT_FOUND" });
      return;
    }

    res.json({ tenant: toPublicTenant(tenant) });
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------------
// PUT /api/tenants/current — update name / branding (owner only)
// --------------------------------------------------------------------------
router.put("/current", ...clerkAuth(), requireRole("MARINA_OWNER"), async (req, res, next) => {
  try {
    const parsed = updateTenantSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
      return;
    }
    const data = parsed.data;

    const tenant = await prisma.tenant.update({
      where: { id: req.tenantId! },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.branding !== undefined && {
          brandingJson: data.branding as Prisma.InputJsonValue,
        }),
      },
      select: tenantPublicSelect,
    });

    res.json({ tenant: toPublicTenant(tenant) });
  } catch (err) {
    next(err);
  }
});

export default router;
