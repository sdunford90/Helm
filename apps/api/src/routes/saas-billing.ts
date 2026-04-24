import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";

import { clerkAuth } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";
import { requireStripe } from "../lib/stripe.js";

const router: Router = Router();

router.use(...clerkAuth());

// ---------------------------------------------------------------------------
// Handlers (shared between /:tenantId/* and the convenience shortcuts that
// resolve tenantId from tenant middleware via req.tenantId).
// ---------------------------------------------------------------------------

const CheckoutSchema = z.object({
  tierId: z.string().uuid(),
  successPath: z.string().min(1).default("/settings/billing?success=true"),
  cancelPath: z.string().min(1).default("/settings/billing?canceled=true"),
});

async function handleCheckout(
  tenantId: string,
  body: unknown,
  res: Response,
): Promise<void> {
  const { tierId, successPath, cancelPath } = CheckoutSchema.parse(body);

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: {
      id: true,
      name: true,
      stripeCustomerId: true,
      stripeSubscriptionId: true,
    },
  });
  if (!tenant) {
    res.status(404).json({ error: "Tenant not found", code: "NOT_FOUND" });
    return;
  }
  if (tenant.stripeSubscriptionId) {
    res.status(409).json({
      error: "Tenant already has an active subscription",
      code: "ALREADY_SUBSCRIBED",
    });
    return;
  }

  const tier = await prisma.saasTier.findUnique({
    where: { id: tierId },
    select: { stripePriceId: true, name: true },
  });
  if (!tier?.stripePriceId) {
    res.status(400).json({
      error: "SaaS tier has no Stripe price configured",
      code: "TIER_NOT_CONFIGURED",
    });
    return;
  }

  const appUrl = process.env.APP_URL ?? "http://localhost:5000";

  // Create a platform-side Stripe Customer once per tenant so all future
  // subscriptions attach to the same record.
  let customerId = tenant.stripeCustomerId;
  if (!customerId) {
    const customer = await requireStripe().customers.create({
      name: tenant.name,
      metadata: { tenantId: tenant.id },
    });
    customerId = customer.id;
    await prisma.tenant.update({
      where: { id: tenant.id },
      data: { stripeCustomerId: customerId },
    });
  }

  const session = await requireStripe().checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: tier.stripePriceId, quantity: 1 }],
    // No trial (per product decision).
    subscription_data: {
      metadata: { tenantId: tenant.id, tierId },
    },
    success_url: `${appUrl}${successPath}&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${appUrl}${cancelPath}`,
  });

  res.json({ url: session.url, sessionId: session.id });
}

async function handlePortal(tenantId: string, res: Response): Promise<void> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { stripeCustomerId: true },
  });
  if (!tenant?.stripeCustomerId) {
    res.status(400).json({
      error: "No Stripe customer for this tenant",
      code: "NO_CUSTOMER",
    });
    return;
  }
  const appUrl = process.env.APP_URL ?? "http://localhost:5000";
  const portal = await requireStripe().billingPortal.sessions.create({
    customer: tenant.stripeCustomerId,
    return_url: `${appUrl}/settings/billing`,
  });
  res.json({ url: portal.url });
}

async function handleStatus(tenantId: string, res: Response): Promise<void> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: {
      stripeSubscriptionId: true,
      saasTierId: true,
      status: true,
      gracePeriodStartedAt: true,
    },
  });
  if (!tenant) {
    res.status(404).json({ error: "Tenant not found", code: "NOT_FOUND" });
    return;
  }

  let subscription: {
    id: string;
    status: string;
    currentPeriodEnd: number | null;
    cancelAtPeriodEnd: boolean;
  } | null = null;

  if (tenant.stripeSubscriptionId) {
    try {
      const sub = await requireStripe().subscriptions.retrieve(
        tenant.stripeSubscriptionId,
      );
      subscription = {
        id: sub.id,
        status: sub.status,
        currentPeriodEnd: sub.items.data[0]?.current_period_end ?? null,
        cancelAtPeriodEnd: sub.cancel_at_period_end,
      };
    } catch (err) {
      console.warn(
        `[saas-billing] failed to retrieve subscription ${tenant.stripeSubscriptionId}:`,
        err,
      );
    }
  }

  res.json({
    tenantStatus: tenant.status,
    saasTierId: tenant.saasTierId,
    gracePeriodStartedAt: tenant.gracePeriodStartedAt,
    subscription,
  });
}

// ---------------------------------------------------------------------------
// Shortcuts — frontend calls these without knowing the tenant UUID. They
// derive it from the tenant middleware that runs on every non-bypass route.
// ---------------------------------------------------------------------------

router.get(
  "/status",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await handleStatus(req.tenantId!, res);
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/checkout",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await handleCheckout(req.tenantId!, req.body, res);
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/portal",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await handlePortal(req.tenantId!, res);
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  "/tiers",
  async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tiers = await prisma.saasTier.findMany({
        select: {
          id: true,
          name: true,
          monthlyFeeCents: true,
          perLocationFeeCents: true,
          storageLimitGb: true,
          stripePriceId: true,
        },
        orderBy: { monthlyFeeCents: "asc" },
      });
      res.json({ tiers });
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// Explicit :tenantId routes (same handlers) — used by platform admin tools.
// ---------------------------------------------------------------------------

router.post(
  "/:tenantId/checkout",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await handleCheckout(String(req.params.tenantId), req.body, res);
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/:tenantId/portal",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await handlePortal(String(req.params.tenantId), res);
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  "/:tenantId/status",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await handleStatus(String(req.params.tenantId), res);
    } catch (err) {
      next(err);
    }
  },
);

export default router;
