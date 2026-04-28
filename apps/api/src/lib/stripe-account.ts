import { prisma } from "./prisma.js";

/**
 * Canonical Stripe-Connect-account resolver for everything keyed off a
 * Customer (saved cards, autopay metadata, recurring auto-charges).
 *
 * Resolution order:
 *   1. The Stripe account on the customer's most recent invoice's location.
 *      The customer's saved payment methods + Stripe customer record live
 *      in this account because that's the account the original charge ran
 *      through. Reading or writing autopay metadata anywhere else would
 *      hit a different (or non-existent) Stripe customer.
 *   2. The tenant-level Stripe account, as a fallback for customers with
 *      no invoices yet (single-Connect-account marinas land here too).
 *
 * Both the staff `PUT /api/customers/:id/autopay` route and the recurring
 * billing job MUST use this helper so the metadata they read and write
 * always targets the same Connect account.
 */
export async function getStripeAccountForCustomer(
  customerId: string,
  tenantId: string,
): Promise<{
  stripeAccountId: string | null;
  locationConnected: boolean;
  locationName: string | null;
}> {
  const recentInvoice = await prisma.invoice.findFirst({
    where: { customerId, tenantId, locationId: { not: null } },
    orderBy: { issuedDate: "desc" },
    select: {
      location: {
        select: {
          name: true,
          stripeAccountId: true,
          stripeOnboardingComplete: true,
        },
      },
    },
  });

  if (recentInvoice?.location?.stripeAccountId) {
    return {
      stripeAccountId: recentInvoice.location.stripeAccountId,
      locationConnected: recentInvoice.location.stripeOnboardingComplete,
      locationName: recentInvoice.location.name,
    };
  }

  // Location attached but it has no Stripe account configured yet.
  if (recentInvoice?.location && !recentInvoice.location.stripeAccountId) {
    return {
      stripeAccountId: null,
      locationConnected: false,
      locationName: recentInvoice.location.name,
    };
  }

  // No invoices yet — fall back to tenant-level account.
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { stripeAccountId: true },
  });

  return {
    stripeAccountId: tenant?.stripeAccountId ?? null,
    locationConnected: !!tenant?.stripeAccountId,
    locationName: null,
  };
}
