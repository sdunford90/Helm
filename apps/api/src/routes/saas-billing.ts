import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";

import {
  clerkAuth,
  requireLocationAccess,
  filterByAllowedLocations,
} from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";
import { requireStripe } from "../lib/stripe.js";
import {
  BillingError,
  BillingLocationSelect,
  openPortalForLocation,
  startCheckoutForLocation,
  type BillingLocation,
} from "../services/saas-billing-service.js";

const router: Router = Router();

router.use(...clerkAuth());

// ---------------------------------------------------------------------------
// Per-location SaaS billing.
//
// Each marina (= Location) is its own billable unit with its own Stripe
// Customer + Subscription + tier. The handlers below take a locationId,
// authorize it against the requesting tenant + the user's location ACL,
// and operate on that location's subscription record.
// ---------------------------------------------------------------------------

async function resolveLocation(
  req: Request,
  res: Response,
  locationId: string,
): Promise<BillingLocation | null> {
  const location = await prisma.location.findUnique({
    where: { id: locationId },
    select: BillingLocationSelect,
  });
  if (!location) {
    res.status(404).json({ error: "Location not found", code: "NOT_FOUND" });
    return null;
  }
  if (location.tenantId !== req.tenantId) {
    res
      .status(404)
      .json({ error: "Location not found", code: "NOT_FOUND" });
    return null;
  }
  if (!requireLocationAccess(req, location.id)) {
    res
      .status(403)
      .json({ error: "Forbidden for this location", code: "FORBIDDEN" });
    return null;
  }
  return location;
}

async function handleCheckout(
  location: BillingLocation,
  body: unknown,
  res: Response,
): Promise<void> {
  try {
    const result = await startCheckoutForLocation(location, body);
    res.json(result);
  } catch (err) {
    if (err instanceof BillingError) {
      res.status(err.status).json({ error: err.message, code: err.code });
      return;
    }
    throw err;
  }
}

async function handlePortal(
  location: BillingLocation,
  res: Response,
): Promise<void> {
  try {
    const result = await openPortalForLocation(location);
    res.json(result);
  } catch (err) {
    if (err instanceof BillingError) {
      res.status(err.status).json({ error: err.message, code: err.code });
      return;
    }
    throw err;
  }
}

async function handleStatus(
  location: BillingLocation,
  res: Response,
): Promise<void> {
  let subscription: {
    id: string;
    status: string;
    currentPeriodEnd: number | null;
    cancelAtPeriodEnd: boolean;
  } | null = null;

  if (location.stripeSubscriptionId) {
    try {
      const sub = await requireStripe().subscriptions.retrieve(
        location.stripeSubscriptionId,
      );
      subscription = {
        id: sub.id,
        status: sub.status,
        currentPeriodEnd: sub.items.data[0]?.current_period_end ?? null,
        cancelAtPeriodEnd: sub.cancel_at_period_end,
      };
    } catch (err) {
      console.warn(
        `[saas-billing] failed to retrieve subscription ${location.stripeSubscriptionId}:`,
        err,
      );
    }
  }

  res.json({
    locationId: location.id,
    locationName: location.name,
    saasTierId: location.saasTierId,
    subscriptionStatus: location.subscriptionStatus,
    gracePeriodStartedAt: location.gracePeriodStartedAt,
    subscription,
  });
}

// ---------------------------------------------------------------------------
// Tier catalog (unchanged — tiers themselves are tenant-agnostic).
// ---------------------------------------------------------------------------

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
// GET /api/saas-billing/locations
//
// Returns one row per location the signed-in user can see, with the
// subscription status for each. Used by the marina-side Settings → Billing
// page to render a row per marina they own.
// ---------------------------------------------------------------------------

router.get(
  "/locations",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const where = filterByAllowedLocations(
        req,
        { tenantId: req.tenantId! },
        { field: "id" },
      );
      const locations = await prisma.location.findMany({
        where,
        orderBy: { name: "asc" },
        select: {
          id: true,
          name: true,
          active: true,
          saasTierId: true,
          stripeCustomerId: true,
          stripeSubscriptionId: true,
          subscriptionStatus: true,
          gracePeriodStartedAt: true,
        },
      });
      res.json({
        locations: locations.map((l) => ({
          id: l.id,
          name: l.name,
          active: l.active,
          saasTierId: l.saasTierId,
          subscriptionStatus: l.subscriptionStatus,
          hasStripeCustomer: !!l.stripeCustomerId,
          hasSubscription: !!l.stripeSubscriptionId,
          gracePeriodStartedAt: l.gracePeriodStartedAt,
        })),
      });
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// Per-location subscription endpoints.
// ---------------------------------------------------------------------------

router.get(
  "/locations/:locationId/status",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const loc = await resolveLocation(req, res, String(req.params.locationId));
      if (!loc) return;
      await handleStatus(loc, res);
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/locations/:locationId/checkout",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const loc = await resolveLocation(req, res, String(req.params.locationId));
      if (!loc) return;
      await handleCheckout(loc, req.body, res);
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/locations/:locationId/portal",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const loc = await resolveLocation(req, res, String(req.params.locationId));
      if (!loc) return;
      await handlePortal(loc, res);
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// Convenience aliases — `locationId` may be passed as a query/body param.
// Used by the marina UI when the user has only one location and the page
// has already resolved which one to operate on.
// ---------------------------------------------------------------------------

function pickLocationIdFromRequest(req: Request): string | null {
  const fromQuery = typeof req.query.locationId === "string" ? req.query.locationId : null;
  const body = req.body as Record<string, unknown> | undefined;
  const fromBody = typeof body?.locationId === "string" ? (body.locationId as string) : null;
  return fromQuery ?? fromBody ?? null;
}

router.get(
  "/status",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const locationId = pickLocationIdFromRequest(req);
      if (!locationId) {
        res.status(400).json({
          error: "locationId is required",
          code: "LOCATION_ID_REQUIRED",
        });
        return;
      }
      const loc = await resolveLocation(req, res, locationId);
      if (!loc) return;
      await handleStatus(loc, res);
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/checkout",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const locationId = pickLocationIdFromRequest(req);
      if (!locationId) {
        res.status(400).json({
          error: "locationId is required",
          code: "LOCATION_ID_REQUIRED",
        });
        return;
      }
      const loc = await resolveLocation(req, res, locationId);
      if (!loc) return;
      await handleCheckout(loc, req.body, res);
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/portal",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const locationId = pickLocationIdFromRequest(req);
      if (!locationId) {
        res.status(400).json({
          error: "locationId is required",
          code: "LOCATION_ID_REQUIRED",
        });
        return;
      }
      const loc = await resolveLocation(req, res, locationId);
      if (!loc) return;
      await handlePortal(loc, res);
    } catch (err) {
      next(err);
    }
  },
);

export default router;
