import { z } from "zod";

import { prisma } from "../lib/prisma.js";
import { requireStripe } from "../lib/stripe.js";

// ---------------------------------------------------------------------------
// Per-location SaaS billing service.
//
// Shared by both the marina-facing `/api/saas-billing/*` routes (where the
// caller is the marina owner authenticated via Clerk) AND the platform-admin
// `/api/admin/locations/:id/billing/*` routes (where the caller is a Replit
// platform admin acting on behalf of any tenant). All Stripe and Prisma
// writes live here so the two surfaces can never drift apart.
// ---------------------------------------------------------------------------

export interface BillingLocation {
  id: string;
  tenantId: string;
  name: string;
  saasTierId: string | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  subscriptionStatus: string | null;
  gracePeriodStartedAt: Date | null;
}

export const BillingLocationSelect = {
  id: true,
  tenantId: true,
  name: true,
  saasTierId: true,
  stripeCustomerId: true,
  stripeSubscriptionId: true,
  subscriptionStatus: true,
  gracePeriodStartedAt: true,
} as const;

export const CheckoutInput = z.object({
  tierId: z.string().uuid(),
  successPath: z.string().min(1).default("/settings/billing?success=true"),
  cancelPath: z.string().min(1).default("/settings/billing?canceled=true"),
});

export type CheckoutInputT = z.infer<typeof CheckoutInput>;

export class BillingError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "BillingError";
  }
}

export async function startCheckoutForLocation(
  location: BillingLocation,
  body: unknown,
): Promise<{ url: string | null; sessionId: string }> {
  const { tierId, successPath, cancelPath } = CheckoutInput.parse(body);

  if (location.stripeSubscriptionId) {
    throw new BillingError(
      409,
      "ALREADY_SUBSCRIBED",
      "Location already has an active subscription",
    );
  }

  const tier = await prisma.saasTier.findUnique({
    where: { id: tierId },
    select: { stripePriceId: true, name: true },
  });
  if (!tier?.stripePriceId) {
    throw new BillingError(
      400,
      "TIER_NOT_CONFIGURED",
      "SaaS tier has no Stripe price configured",
    );
  }

  const appUrl = process.env.APP_URL ?? "http://localhost:5000";

  let customerId = location.stripeCustomerId;
  if (!customerId) {
    const customer = await requireStripe().customers.create({
      name: location.name,
      metadata: { tenantId: location.tenantId, locationId: location.id },
    });
    customerId = customer.id;
    await prisma.location.update({
      where: { id: location.id },
      data: { stripeCustomerId: customerId },
    });
  }

  const session = await requireStripe().checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: tier.stripePriceId, quantity: 1 }],
    subscription_data: {
      metadata: {
        tenantId: location.tenantId,
        locationId: location.id,
        tierId,
      },
    },
    success_url: `${appUrl}${successPath}&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${appUrl}${cancelPath}`,
  });

  return { url: session.url, sessionId: session.id };
}

export async function openPortalForLocation(
  location: BillingLocation,
): Promise<{ url: string }> {
  if (!location.stripeCustomerId) {
    throw new BillingError(
      400,
      "NO_CUSTOMER",
      "No Stripe customer for this location",
    );
  }
  const appUrl = process.env.APP_URL ?? "http://localhost:5000";
  const portal = await requireStripe().billingPortal.sessions.create({
    customer: location.stripeCustomerId,
    return_url: `${appUrl}/settings/billing`,
  });
  return { url: portal.url };
}
