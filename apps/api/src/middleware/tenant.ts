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
const BYPASS_PREFIXES = ["/api/health", "/api/admin", "/api/onboarding", "/api/auth/webhook"];

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

    // Look up tenant by subdomain or custom_domain
    const tenant = await prisma.tenant.findFirst({
      where: subdomain
        ? {
            OR: [{ subdomain }, { custom_domain: hostname }],
          }
        : { custom_domain: hostname },
    });

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
