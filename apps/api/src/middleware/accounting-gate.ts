import { Request, Response, NextFunction } from "express";
import { prisma } from "../lib/prisma.js";

// Middleware that blocks financial transaction routes if the location hasn't
// completed accounting setup. A grace period window allows existing tenants
// to continue operating while they complete setup.
export async function requireAccountingSetup(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    // Resolve locationId from body, query, or params — different routes use different conventions
    const locationId =
      ((req.body as Record<string, unknown>)?.locationId as string | undefined) ??
      (req.query.locationId as string | undefined) ??
      (req.params.locationId as string | undefined);

    if (!locationId) {
      // No specific location — can't gate, pass through
      return next();
    }

    const location = await prisma.location.findUnique({
      where: { id: locationId },
      select: {
        accountingSetupComplete: true,
        accountingGracePeriodEndsAt: true,
      },
    });

    if (!location) return next(); // location not found — let the route handle it

    if (location.accountingSetupComplete) return next(); // all good

    // Check grace period
    if (
      location.accountingGracePeriodEndsAt &&
      new Date() < location.accountingGracePeriodEndsAt
    ) {
      // Within grace period — allow but add a warning header
      res.setHeader("X-Accounting-Grace-Period", location.accountingGracePeriodEndsAt.toISOString());
      return next();
    }

    // Not complete, no grace period — block
    res.status(423).json({
      error: "Accounting setup required for this location",
      code: "ACCOUNTING_NOT_CONFIGURED",
      setupUrl: "/settings/accounting",
      locationId,
    });
  } catch (err) {
    // If we can't check (e.g., column doesn't exist yet during migration), pass through
    console.warn("[accounting-gate] Could not check setup status:", err);
    next();
  }
}
