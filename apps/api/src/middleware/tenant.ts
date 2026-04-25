import type { Request, Response, NextFunction } from "express";
import { prisma, tenantStore } from "../lib/prisma.js";

// --------------------------------------------------------------------------
// Extend Express Request to carry tenant context
// --------------------------------------------------------------------------

declare global {
  namespace Express {
    interface Request {
      tenantId?: string;
      tenant?: {
        id: string;
        name: string;
        subdomain: string;
        custom_domain?: string | null;
        settings?: Record<string, unknown>;
        [key: string]: unknown;
      };
    }
  }
}

/** Routes that should bypass tenant resolution. */
const BYPASS_PREFIXES = [
  "/api/health",
  "/api/admin",
  "/api/onboarding",
  "/api/auth/webhook",
  "/api/webhooks", // Stripe webhooks resolve tenant from event.account, not subdomain
  "/api/email", // unsubscribe + Resend webhook — tenant comes from signed token or event payload
];

function shouldBypass(path: string): boolean {
  return BYPASS_PREFIXES.some((prefix) => path.startsWith(prefix));
}

/**
 * Tenant resolution middleware.
 *
 * Extracts the subdomain (or matches a custom_domain) from the incoming
 * request and loads the corresponding tenant from the database.  The tenant
 * is then attached to `req.tenantId` / `req.tenant` and propagated via
 * AsyncLocalStorage so the Prisma middleware can automatically scope queries.
 */
export async function tenantMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (shouldBypass(req.path)) {
    next();
    return;
  }

  try {
    const hostname = req.hostname; // e.g. "harborview.gethelm.com"

    // Attempt subdomain extraction: take the first label if at least 3 labels
    const parts = hostname.split(".");
    const subdomain = parts.length >= 3 ? parts[0] : null;

    // Look up tenant by subdomain or customDomain
    let tenant = await prisma.tenant.findFirst({
      where: subdomain
        ? { OR: [{ subdomain }, { customDomain: hostname }] }
        : { customDomain: hostname },
    });

    // ── Dev fallback: use the first tenant when hostname doesn't resolve.
    // Gated on the same explicit opt-in as the auth dev bypass so that a
    // misconfigured staging env can't silently serve the first tenant.
    const devBypass =
      process.env.ENABLE_AUTH_DEV_BYPASS === "true" &&
      process.env.NODE_ENV !== "production";
    if (!tenant && devBypass) {
      tenant = await prisma.tenant.findFirst({ orderBy: { createdAt: "asc" } });
    }

    if (!tenant) {
      res.status(404).json({ error: "Tenant not found", code: "TENANT_NOT_FOUND" });
      return;
    }

    req.tenantId = tenant.id;
    req.tenant = tenant as unknown as Express.Request["tenant"];

    // Propagate tenantId through async-local storage for the Prisma middleware
    tenantStore.run({ tenantId: tenant.id }, () => {
      next();
    });
  } catch (err) {
    next(err);
  }
}
