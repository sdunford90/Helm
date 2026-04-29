import { prisma } from "./prisma.js";

/**
 * A location considered when resolving which Stripe Connect account to use
 * for a customer. Only fully-onboarded locations (`stripeOnboardingComplete`
 * = true) ever appear here. The UI renders these as picker options when the
 * customer has no clear "home" location.
 */
export interface StripeAccountCandidate {
  locationId: string;
  locationName: string;
  stripeAccountId: string;
}

/**
 * Canonical Stripe-Connect-account resolver for everything keyed off a
 * Customer (saved cards, autopay metadata, recurring auto-charges).
 *
 * Resolution order:
 *   1. If `preferredLocationId` is supplied AND it points at a tenant-owned,
 *      fully-onboarded location, use it. This is how the customer-file UI
 *      lets staff pick which marina's Stripe account holds a new card when
 *      multiple locations are connected.
 *   2. The Stripe account on the customer's most recent invoice's location.
 *      The customer's saved payment methods + Stripe customer record live
 *      in this account because that's the account the original charge ran
 *      through. Reading or writing autopay metadata anywhere else would
 *      hit a different (or non-existent) Stripe customer.
 *   3. Any other fully-onboarded Location in the tenant. When the
 *      most-recent-invoice location is missing, not connected, or has
 *      `stripeOnboardingComplete = false`, the resolver tries the rest of
 *      the tenant's locations rather than declaring the marina "not
 *      connected".
 *   4. The tenant-level Stripe account, as a final fallback for legacy
 *      single-Connect-account marinas.
 *
 * `candidates` lists every fully-onboarded location in the tenant so the
 * UI can prompt staff to choose when more than one is available. The
 * resolver still picks one for unambiguous backend use, but the picker UI
 * uses `candidates` to show the choices.
 *
 * Both the staff `PUT /api/customers/:id/autopay` route and the recurring
 * billing job MUST use this helper so the metadata they read and write
 * always targets the same Connect account.
 */
export async function getStripeAccountForCustomer(
  customerId: string,
  tenantId: string,
  preferredLocationId?: string | null,
): Promise<{
  stripeAccountId: string | null;
  locationId: string | null;
  locationConnected: boolean;
  locationName: string | null;
  candidates: StripeAccountCandidate[];
}> {
  // Pull every connected location in one query so we can fall back across
  // them and also surface the picker.
  const onboardedLocations = await prisma.location.findMany({
    where: {
      tenantId,
      stripeAccountId: { not: null },
      stripeOnboardingComplete: true,
    },
    select: { id: true, name: true, stripeAccountId: true },
    orderBy: { name: "asc" },
  });

  const candidates: StripeAccountCandidate[] = onboardedLocations
    .filter((l): l is { id: string; name: string; stripeAccountId: string } => !!l.stripeAccountId)
    .map((l) => ({
      locationId: l.id,
      locationName: l.name,
      stripeAccountId: l.stripeAccountId,
    }));

  // 1. Caller asked for a specific location — honor it if it is one of the
  // tenant's fully-onboarded candidates. Anything else (missing, wrong
  // tenant, mid-onboarding) silently falls through to the resolver's
  // automatic selection so a stale UI choice can't break a save.
  if (preferredLocationId) {
    const preferred = candidates.find((c) => c.locationId === preferredLocationId);
    if (preferred) {
      return {
        stripeAccountId: preferred.stripeAccountId,
        locationId: preferred.locationId,
        locationConnected: true,
        locationName: preferred.locationName,
        candidates,
      };
    }
  }

  // 2. The customer's most-recent-invoice location.
  const recentInvoice = await prisma.invoice.findFirst({
    where: { customerId, tenantId, locationId: { not: null } },
    orderBy: { issuedDate: "desc" },
    select: {
      location: {
        select: {
          id: true,
          name: true,
          stripeAccountId: true,
          stripeOnboardingComplete: true,
        },
      },
    },
  });

  const recentLocation = recentInvoice?.location ?? null;

  if (
    recentLocation?.stripeAccountId &&
    recentLocation.stripeOnboardingComplete
  ) {
    return {
      stripeAccountId: recentLocation.stripeAccountId,
      locationId: recentLocation.id,
      locationConnected: true,
      locationName: recentLocation.name,
      candidates,
    };
  }

  // 3. Recent location exists but is stale / not onboarded — fall back to
  // any fully-onboarded location. If exactly one is available we use it; if
  // multiple are available we still pick the first deterministically (the
  // UI shows the picker so staff can override) but expose the full list as
  // candidates so the UI can make staff pick.
  if (candidates.length === 1) {
    const only = candidates[0];
    return {
      stripeAccountId: only.stripeAccountId,
      locationId: only.locationId,
      locationConnected: true,
      locationName: only.locationName,
      candidates,
    };
  }
  if (candidates.length > 1) {
    const first = candidates[0];
    return {
      stripeAccountId: first.stripeAccountId,
      locationId: first.locationId,
      locationConnected: true,
      locationName: first.locationName,
      candidates,
    };
  }

  // 4. No fully-onboarded location anywhere — fall back to the tenant-level
  // Connect account if the marina is still on the legacy single-account
  // model. If even that's missing we report the customer's most-recent
  // location's name (when available) so the UI's warning is specific.
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { stripeAccountId: true },
  });

  if (tenant?.stripeAccountId) {
    return {
      stripeAccountId: tenant.stripeAccountId,
      locationId: null,
      locationConnected: true,
      locationName: null,
      candidates,
    };
  }

  // Truly nothing connected anywhere.
  return {
    stripeAccountId: null,
    locationId: recentLocation?.id ?? null,
    locationConnected: false,
    locationName: recentLocation?.name ?? null,
    candidates,
  };
}
