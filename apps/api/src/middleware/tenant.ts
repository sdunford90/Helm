import type { Request, Response, NextFunction } from "express";
import { prisma, tenantStore } from "../lib/prisma.js";
import { isDevAuthBypassEnabled } from "../lib/env.js";

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

/**
 * Routes that bypass Host-based tenant resolution. Keep this list minimal:
 * each entry must establish its own trust (platform-admin auth, a verified
 * webhook signature, a verified single-use OAuth state, or an API key whose
 * own tenant becomes the query scope).
 */
const BYPASS_PREFIXES = [
  "/api/health", // liveness, no data
  "/api/admin", // platform admin (requirePlatformAdmin), cross-tenant by design
  "/api/bi", // API-key auth; the key's own tenant is the query scope (bi-api.ts)
];
const BYPASS_EXACT = [
  "/api/auth/webhook", // Clerk (svix signature)
  "/api/onboarding/start", // creates a brand-new tenant (Clerk session required)
  "/api/onboarding/stripe/callback", // Stripe redirect (verified OAuth state)
  "/api/qbo/callback", // Intuit redirect (verified OAuth state)
  "/api/qbo/webhook", // Intuit (verified signature)
  "/api/webhooks/stripe", // Stripe (signature) — mount point reserved in index.ts
];

export function shouldBypassTenant(path: string): boolean {
  const p = path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
  return (
    BYPASS_EXACT.includes(p) ||
    BYPASS_PREFIXES.some((prefix) => p === prefix || p.startsWith(`${prefix}/`))
  );
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
  if (shouldBypassTenant(req.path)) {
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

    // ── Dev fallback: only with the explicit HELM_DEV_AUTH_BYPASS flag ──
    // (isDevAuthBypassEnabled() throws if the flag is set in production).
    // Without the flag an unknown host is always a 404 — never "some tenant".
    if (!tenant && isDevAuthBypassEnabled()) {
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
