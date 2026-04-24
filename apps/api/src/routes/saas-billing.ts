import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";

import { clerkAuth } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";
import { requireStripe } from "../lib/stripe.js";

const router = Router();

router.use(...clerkAuth());

// ---------------------------------------------------------------------------
// POST /api/saas-billing/:tenantId/checkout
//
// Creates a Stripe Checkout Session (mode: "subscription") on Helm's platform
// account for the tenant to subscribe to a Helm SaaS tier. No trial.
//
// Billing failures are handled leniently: the platform webhook logs
// invoice.payment_failed but does NOT auto-lock the tenant — we give grace
// and operators decide when to suspend.
// ---------------------------------------------------------------------------

const CheckoutSchema = z.object({
  tierId: z.string().uuid(),
  successPath: z.string().min(1).default("/settings/billing?success=true"),
  cancelPath: z.string().min(1).default("/settings/billing?canceled=true"),
});

router.post(
  "/:tenantId/checkout",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = String(req.params.tenantId);
      const { tierId, successPath, cancelPath } = CheckoutSchema.parse(req.body);

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
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /api/saas-billing/:tenantId/portal
//
// Creates a Stripe Customer Portal session so the tenant can self-service:
// update payment method, cancel subscription, view invoices.
// ---------------------------------------------------------------------------

router.post(
  "/:tenantId/portal",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = String(req.params.tenantId);
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
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// GET /api/saas-billing/:tenantId/status
//
// Reports the tenant's current SaaS subscription state — used by the
// Settings > Billing page.
// ---------------------------------------------------------------------------

router.get(
  "/:tenantId/status",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = String(req.params.tenantId);
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
            // items.data[0].current_period_end is the per-item period end
            currentPeriodEnd:
              sub.items.data[0]?.current_period_end ?? null,
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
    } catch (err) {
      next(err);
    }
  },
);

export default router;
