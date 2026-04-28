import type { Request, Response, NextFunction, RequestHandler } from "express";
import { requireAuth, getAuth } from "@clerk/express";
import { prisma } from "../lib/prisma.js";

// --------------------------------------------------------------------------
// Extend Express Request with authenticated user context
// --------------------------------------------------------------------------

declare global {
  namespace Express {
    interface Request {
      userId?: string;
      userRole?: string;
      userRecord?: {
        id: string;
        clerk_id: string;
        tenant_id: string;
        role: string;
        email: string;
        [key: string]: unknown;
      };
      // Locations the current user is allowed to access. `null` means no
      // restriction (PLATFORM_ADMIN, TENANT_ADMIN, MARINA_OWNER bypass).
      // Empty array means the user has explicitly been granted no Locations.
      allowedLocationIds?: string[] | null;
    }
  }
}

// Roles that bypass location scoping — they can act on every Location in
// their tenant. PLATFORM_ADMIN further bypasses tenant scoping but uses
// requirePlatformAdmin, not this list.
const LOCATION_BYPASS_ROLES = new Set([
  "PLATFORM_ADMIN",
  "TENANT_ADMIN",
  "MARINA_OWNER",
]);

export function isLocationBypassRole(role: string | undefined | null): boolean {
  return !!role && LOCATION_BYPASS_ROLES.has(role);
}

/**
 * Resolve the set of Location IDs that the current request is allowed to
 * touch. Returns `null` when the user bypasses scoping entirely.
 */
export async function loadAllowedLocationIds(
  userId: string,
  role: string,
): Promise<string[] | null> {
  if (isLocationBypassRole(role)) return null;
  const rows = await prisma.userLocation.findMany({
    where: { userId },
    select: { locationId: true },
  });
  return rows.map((r) => r.locationId);
}

/**
 * Guard helper: throws a 403-shaped error if the request is not allowed to
 * touch the given Location. Bypass roles always pass.
 *
 * Usage:
 *   if (!requireLocationAccess(req, locationId)) {
 *     res.status(403).json({ error: ..., code: "LOCATION_FORBIDDEN" });
 *     return;
 *   }
 */
export function requireLocationAccess(
  req: Request,
  locationId: string | null | undefined,
): boolean {
  if (!locationId) return true; // tenant-level requests with no location are OK
  if (req.allowedLocationIds === null || req.allowedLocationIds === undefined) {
    // null = bypass; undefined = middleware not run (treat as bypass to avoid
    // accidentally locking out unauthenticated/legacy code paths)
    return true;
  }
  return req.allowedLocationIds.includes(locationId);
}

/**
 * Helper for list endpoints: merges the request's allowed-location filter
 * into a Prisma `where` object. Bypass roles get an unmodified where.
 *
 * Field defaults to `locationId`. For nullable columns, set
 * `includeNull = true` so unscoped records still appear.
 */
export function filterByAllowedLocations<T extends Record<string, unknown>>(
  req: Request,
  where: T,
  opts: { field?: string; includeNull?: boolean } = {},
): T {
  if (req.allowedLocationIds === null || req.allowedLocationIds === undefined) {
    return where;
  }
  const field = opts.field ?? "locationId";
  const ids = req.allowedLocationIds;
  const w = where as Record<string, unknown>;

  if (opts.includeNull) {
    // Unscoped (locationId = null) records are visible to everyone in the
    // tenant; scoped records must be in the allowed set.
    const orClause: unknown[] = [{ [field]: null }];
    if (ids.length > 0) orClause.push({ [field]: { in: ids } });
    const existing = Array.isArray(w.AND) ? (w.AND as unknown[]) : w.AND ? [w.AND] : [];
    existing.push({ OR: orClause });
    w.AND = existing;
    return where;
  }

  w[field] = ids.length > 0 ? { in: ids } : { in: [] };
  return where;
}

// --------------------------------------------------------------------------
// Dev bypass gate
//
// Previously: `if (NODE_ENV !== "production") skip auth`. That's unsafe —
// one misconfigured staging environment and admin routes are wide open.
// Now: require an explicit opt-in env var AND refuse to honour it when
// NODE_ENV is production. You have to deliberately enable it in dev.
// --------------------------------------------------------------------------

function isDevBypassEnabled(): boolean {
  const enabled = process.env.ENABLE_AUTH_DEV_BYPASS === "true";
  if (enabled && process.env.NODE_ENV === "production") {
    // Fail loud — never honour the bypass in prod, no matter how the env
    // was set. This log line is intentional so misconfiguration is obvious.
    console.error(
      "[auth] ENABLE_AUTH_DEV_BYPASS=true ignored because NODE_ENV=production",
    );
    return false;
  }
  return enabled;
}

// Optional: fail-closed at boot when prod config looks incomplete.
// Called once from index.ts.
export function assertAuthConfigOrExit(): void {
  if (process.env.NODE_ENV !== "production") return;
  const missing: string[] = [];
  if (!process.env.CLERK_SECRET_KEY) missing.push("CLERK_SECRET_KEY");
  if (!process.env.CLERK_PUBLISHABLE_KEY) missing.push("CLERK_PUBLISHABLE_KEY");
  if (missing.length > 0) {
    console.error(
      `[auth] refusing to start in production without: ${missing.join(", ")}`,
    );
    process.exit(1);
  }
  if (process.env.ENABLE_AUTH_DEV_BYPASS === "true") {
    console.error(
      "[auth] ENABLE_AUTH_DEV_BYPASS must not be set in production — unsetting",
    );
  }
}

/**
 * Clerk authentication middleware.
 *
 * Wraps `requireAuth` from @clerk/express and then resolves the internal
 * user record, verifying that the user belongs to the current tenant.
 */
export function clerkAuth(): RequestHandler[] {
  if (isDevBypassEnabled()) {
    return [
      async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
        try {
          const user = await prisma.user.findFirst({
            where: { tenantId: req.tenantId },
            orderBy: { createdAt: "asc" },
          });
          req.userId = user?.id ?? "dev-user";
          req.userRole = user?.role ?? "MARINA_OWNER";
          req.userRecord = user as unknown as Express.Request["userRecord"];
          req.allowedLocationIds = user
            ? await loadAllowedLocationIds(user.id, user.role)
            : null;
          next();
        } catch (err) {
          next(err);
        }
      },
    ];
  }

  return [
    requireAuth(),
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const auth = getAuth(req);
        const clerkUserId = auth.userId;

        if (!clerkUserId) {
          res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
          return;
        }

        const user = await prisma.user.findFirst({
          where: {
            clerkUserId,
            tenantId: req.tenantId,
          },
        });

        if (!user) {
          res.status(403).json({
            error: "User does not belong to this tenant",
            code: "TENANT_MISMATCH",
          });
          return;
        }

        req.userId = user.id;
        req.userRole = user.role;
        req.userRecord = user as unknown as Express.Request["userRecord"];
        req.allowedLocationIds = await loadAllowedLocationIds(user.id, user.role);

        next();
      } catch (err) {
        next(err);
      }
    },
  ];
}

/**
 * Role-based access control middleware factory.
 *
 * Usage:
 *   router.post("/slips", clerkAuth(), requireRole("MARINA_OWNER", "MARINA_MANAGER"), handler)
 */
export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.userRole || !roles.includes(req.userRole)) {
      res.status(403).json({
        error: "Insufficient permissions",
        code: "FORBIDDEN",
      });
      return;
    }
    next();
  };
}

/**
 * Platform admin guard — checks for the PLATFORM_ADMIN role.
 * Used on /api/admin routes.
 */
export function requirePlatformAdmin(): RequestHandler[] {
  if (isDevBypassEnabled()) {
    return [
      async (_req: Request, _res: Response, next: NextFunction): Promise<void> => {
        next();
      },
    ];
  }


  return [
    requireAuth(),
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const auth = getAuth(req);
        const clerkUserId = auth.userId;

        if (!clerkUserId) {
          res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
          return;
        }

        // Fixed from the pre-bug version: field was `clerk_id` (doesn't
        // exist on User; schema uses `clerkUserId`) and role value was
        // lowercased "platform_admin" (enum is PLATFORM_ADMIN). That
        // combination meant this middleware returned 403 for every
        // request in production.
        const user = await prisma.user.findFirst({
          where: {
            clerkUserId,
            role: "PLATFORM_ADMIN",
          },
        });

        if (!user) {
          res.status(403).json({
            error: "Platform admin access required",
            code: "FORBIDDEN",
          });
          return;
        }

        req.userId = user.id;
        req.userRole = user.role;
        req.userRecord = user as unknown as Express.Request["userRecord"];
        req.allowedLocationIds = null; // platform admins bypass

        next();
      } catch (err) {
        next(err);
      }
    },
  ];
}
