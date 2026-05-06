import type { Request, Response, NextFunction, RequestHandler } from "express";
import { requireAuth, getAuth } from "@clerk/express";
import type { UserRole } from "@prisma/client";
import { prisma } from "../lib/prisma.js";

// --------------------------------------------------------------------------
// Extend Express Request with authenticated user context
// --------------------------------------------------------------------------

declare global {
  namespace Express {
    interface Request {
      userId?: string;
      userRole?: string;
      // Sub-role on PLATFORM_ADMIN users. `null` for non-admins. Set by
      // requirePlatformAdmin and used by requireAdminRole gating.
      userAdminRole?: string | null;
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

// --------------------------------------------------------------------------
// Admin sub-role policy
//
// Each platform admin has one of three sub-roles. They form a strict
// permission hierarchy enforced by `requireAdminRole` below.
//
//   READ_ONLY_SUPPORT — read-only across the entire admin console.
//   BILLING_ADMIN     — can mutate billing + tenant lifecycle (lock,
//                       unlock, tier change, refund, impersonate).
//   SUPERUSER         — everything BILLING_ADMIN can do plus role
//                       management, tenant export, tenant hard-delete.
//
// Helpers below define the allow-list per action class so admin route
// handlers can opt in via `requireAdminRole("SUPERUSER")` or
// `requireAdminRole("SUPERUSER", "BILLING_ADMIN")`.
// --------------------------------------------------------------------------

export type AdminRole = "SUPERUSER" | "BILLING_ADMIN" | "READ_ONLY_SUPPORT";

export const ADMIN_ROLES: readonly AdminRole[] = [
  "SUPERUSER",
  "BILLING_ADMIN",
  "READ_ONLY_SUPPORT",
];

export function isAdminRole(value: unknown): value is AdminRole {
  return typeof value === "string" && (ADMIN_ROLES as readonly string[]).includes(value);
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
    // Dev bypass: prefer the highest-privilege user in the tenant so the
    // local preview behaves like an owner/admin testing the full app.
    // Falls back to the oldest user if no privileged user exists.
    const DEV_BYPASS_ROLE_PRIORITY: UserRole[] = [
      "PLATFORM_ADMIN",
      "TENANT_ADMIN",
      "MARINA_OWNER",
      "MARINA_MANAGER",
      "ACCOUNTING",
    ];
    return [
      async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
        try {
          let user = null;
          for (const role of DEV_BYPASS_ROLE_PRIORITY) {
            user = await prisma.user.findFirst({
              where: { tenantId: req.tenantId, role },
              orderBy: { createdAt: "asc" },
            });
            if (user) break;
          }
          if (!user) {
            user = await prisma.user.findFirst({
              where: { tenantId: req.tenantId },
              orderBy: { createdAt: "asc" },
            });
          }
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
    // NOTE: we intentionally do NOT use Clerk's `requireAuth()` here. That
    // middleware issues a 302 redirect on unauthenticated requests, which
    // breaks XHR/fetch callers — the browser silently follows the redirect
    // to `/`, the SPA's index.html comes back, and the frontend's
    // `await res.json()` blows up with "Unexpected token '<'". Instead we
    // call `getAuth()` ourselves and respond with a clean JSON 401 the
    // SPA can detect and route to the sign-in page on its own.
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
    // PLATFORM_ADMIN superusers bypass tenant-staff role gates so they can
    // operate on any route for support/debugging purposes. clerkAuth above
    // still requires the platform admin to have a user row in this tenant
    // (or to be using impersonation), so this does not weaken cross-tenant
    // isolation — it only lets a platform admin act inside a tenant where
    // they are already a member without first being granted a tenant role
    // like MARINA_OWNER. This matches the intent documented on
    // LOCATION_BYPASS_ROLES above.
    if (req.userRole === "PLATFORM_ADMIN") {
      next();
      return;
    }
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
      async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
        try {
          // Reuse a real PLATFORM_ADMIN if one exists so dev impersonation
          // and admin-audit entries get a sensible actor identity.
          const admin = await prisma.user.findFirst({
            where: { role: "PLATFORM_ADMIN" },
            orderBy: { createdAt: "asc" },
          });
          if (admin) {
            req.userId = admin.id;
            req.userRole = admin.role;
            req.userAdminRole = admin.adminRole ?? "SUPERUSER";
            req.userRecord = admin as unknown as Express.Request["userRecord"];
          } else {
            req.userId = "dev-admin";
            req.userRole = "PLATFORM_ADMIN";
            req.userAdminRole = "SUPERUSER";
          }
          req.allowedLocationIds = null;
          next();
        } catch (err) {
          next(err);
        }
      },
    ];
  }


  return [
    // NOTE: we intentionally do NOT use Clerk's `requireAuth()` here. That
    // middleware issues a 302 redirect on unauthenticated requests, which
    // breaks XHR/fetch callers — the browser silently follows the redirect
    // to `/`, the SPA's index.html comes back, and the frontend's
    // `await res.json()` blows up with "Unexpected token '<'". Instead we
    // call `getAuth()` ourselves and respond with a clean JSON 401 the
    // SPA can detect and route to the sign-in page on its own.
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
            active: true,
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
        // Admins without an explicit sub-role are treated as
        // READ_ONLY_SUPPORT — fail safe.
        req.userAdminRole = user.adminRole ?? "READ_ONLY_SUPPORT";
        req.userRecord = user as unknown as Express.Request["userRecord"];
        req.allowedLocationIds = null; // platform admins bypass

        next();
      } catch (err) {
        next(err);
      }
    },
  ];
}

/**
 * Admin sub-role guard — call AFTER requirePlatformAdmin in the route stack.
 * Pass the admin sub-roles permitted to perform the action.
 *
 * Example: only Superusers may delete tenants:
 *   router.post("/tenants/:id/delete", requireAdminRole("SUPERUSER"), ...);
 *
 * READ_ONLY_SUPPORT is always rejected from any list that does not include
 * it explicitly, which is what we want for every mutating action.
 */
export function requireAdminRole(...allowed: AdminRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const role = req.userAdminRole;
    if (!role || !allowed.includes(role as AdminRole)) {
      res.status(403).json({
        error: "Insufficient admin permissions",
        code: "ADMIN_FORBIDDEN",
        required: allowed,
        actual: role,
      });
      return;
    }
    next();
  };
}
