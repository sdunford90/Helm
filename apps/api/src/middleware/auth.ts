import type { Request, Response, NextFunction } from "express";
import { clerkMiddleware, getAuth } from "@clerk/express";
import type { UserRole } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { isDevAuthBypassEnabled, parseList } from "../lib/env.js";

// --------------------------------------------------------------------------
// Extend Express Request with authenticated user context
// --------------------------------------------------------------------------

declare global {
  namespace Express {
    interface Request {
      userId?: string;
      userRole?: UserRole;
      /** Set when the explicit HELM_DEV_AUTH_BYPASS flag let this request skip Clerk. */
      devAuthBypass?: boolean;
      userRecord?: {
        id: string;
        clerk_id: string;
        tenant_id: string;
        role: string;
        email: string;
        [key: string]: unknown;
      };
    }
  }
}

// --------------------------------------------------------------------------
// Role groups for the interim (Phase 0) role guards. The permission catalog
// in docs/audit/11 §3 replaces these in Phase 1.
// --------------------------------------------------------------------------

/** Roles that are not staff and must never pass clerkAuth (the staff API). */
export const NON_STAFF_ROLES: readonly UserRole[] = ["PORTAL_USER"];

/** Owner + manager: deletes, destructive ops, config/pricing, team invites. */
export const MANAGER_ROLES = ["MARINA_OWNER", "MARINA_MANAGER"] as const satisfies readonly UserRole[];

/** Owner + manager + accounting: refunds, voids, write-offs, finance data/exports. */
export const FINANCE_ROLES = [
  "MARINA_OWNER",
  "MARINA_MANAGER",
  "ACCOUNTING",
] as const satisfies readonly UserRole[];

/**
 * Which roles a user may grant (invite as / promote to). Nobody can grant a
 * role above their own: a manager cannot create owners or accounting users,
 * and PLATFORM_ADMIN is never grantable from a tenant.
 */
const GRANTABLE_ROLES: Partial<Record<UserRole, readonly UserRole[]>> = {
  MARINA_OWNER: ["MARINA_OWNER", "MARINA_MANAGER", "DOCK_STAFF", "POS_CASHIER", "ACCOUNTING"],
  MARINA_MANAGER: ["MARINA_MANAGER", "DOCK_STAFF", "POS_CASHIER"],
};

export function canGrantRole(granter: UserRole | undefined, role: UserRole): boolean {
  if (!granter) return false;
  return GRANTABLE_ROLES[granter]?.includes(role) ?? false;
}

/**
 * Clerk authentication middleware for the staff API (fail-closed).
 *
 * 1. Verifies the Clerk session (401 JSON when missing/invalid — never a
 *    redirect, never an anonymous pass-through).
 * 2. Resolves the internal user record and verifies it belongs to the
 *    current tenant, is active, and is a staff role (not PORTAL_USER).
 *
 * The ONLY way to skip Clerk is the explicit local-development flag
 * `HELM_DEV_AUTH_BYPASS=true`, which is refused (throws, and `loadEnv()`
 * exits at boot) when NODE_ENV=production. NODE_ENV alone never disables auth.
 */
export function clerkAuth() {
  return [
    authenticateSession(),

    // Resolve internal user and verify tenant membership
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        if (req.devAuthBypass) {
          // Act as the tenant's oldest active owner (else oldest active staff user).
          const user =
            (await prisma.user.findFirst({
              where: { tenantId: req.tenantId, active: true, role: "MARINA_OWNER" },
              orderBy: { createdAt: "asc" },
            })) ??
            (await prisma.user.findFirst({
              where: { tenantId: req.tenantId, active: true, role: { notIn: [...NON_STAFF_ROLES] } },
              orderBy: { createdAt: "asc" },
            }));
          if (!user) {
            res.status(401).json({
              error: "Dev bypass: no active staff user in this tenant",
              code: "UNAUTHORIZED",
            });
            return;
          }
          req.userId = user.id;
          req.userRole = user.role;
          req.userRecord = user as unknown as Express.Request["userRecord"];
          next();
          return;
        }

        const clerkUserId = getAuth(req).userId;

        if (!clerkUserId) {
          res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
          return;
        }

        // Look up the internal user record scoped to the current tenant
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

        // Deactivated users (removed from the team / deleted in Clerk) lose access.
        if (user.active === false) {
          res.status(403).json({ error: "User is deactivated", code: "USER_INACTIVE" });
          return;
        }

        // clerkAuth guards the *staff* API. Portal (boater) identities never pass.
        if (NON_STAFF_ROLES.includes(user.role)) {
          res.status(403).json({
            error: "Portal users cannot access the staff API",
            code: "STAFF_ONLY",
          });
          return;
        }

        req.userId = user.id;
        req.userRole = user.role;
        req.userRecord = user as unknown as Express.Request["userRecord"];

        next();
      } catch (err) {
        next(err);
      }
    },
  ];
}

/**
 * First stage of every auth chain: either the explicit dev bypass (flag on,
 * not production) or a verified Clerk session. Exported for routes that need
 * a Clerk identity but have no tenant user yet (e.g. onboarding/start).
 */
export function authenticateSession() {
  const verifyClerkSession = clerkSessionVerifier();

  return (req: Request, res: Response, next: NextFunction): void => {
    let bypass: boolean;
    try {
      bypass = isDevAuthBypassEnabled();
    } catch (err) {
      next(err);
      return;
    }
    if (bypass) {
      req.devAuthBypass = true;
      next();
      return;
    }
    verifyClerkSession(req, res, next);
  };
}

/**
 * Returns middleware that runs Clerk's session verification and responds
 * 401 JSON when there is no authenticated Clerk user. Unlike Clerk's
 * `requireAuth()` it never redirects (the SPA expects JSON).
 */
function clerkSessionVerifier() {
  let clerk: ReturnType<typeof clerkMiddleware> | undefined;

  return (req: Request, res: Response, next: NextFunction): void => {
    if (!process.env.CLERK_SECRET_KEY || !process.env.CLERK_PUBLISHABLE_KEY) {
      // Fail closed: without Clerk configured nobody can authenticate.
      res.status(401).json({ error: "Unauthorized", code: "AUTH_NOT_CONFIGURED" });
      return;
    }

    if (!clerk) {
      const authorizedParties = parseList(process.env.CLERK_AUTHORIZED_PARTIES);
      clerk = clerkMiddleware(authorizedParties.length > 0 ? { authorizedParties } : undefined);
    }

    clerk(req, res, (err?: unknown) => {
      if (err) {
        next(err);
        return;
      }
      let userId: string | null | undefined;
      try {
        userId = getAuth(req).userId;
      } catch {
        userId = null;
      }
      if (!userId) {
        res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
        return;
      }
      next();
    });
  };
}

/**
 * Role-based access control middleware factory.
 *
 * Roles are the Prisma `UserRole` enum, so a typo or a lowercase string
 * ("admin", "manager") is a compile error rather than a silent 403.
 *
 * Usage:
 *   router.delete("/:id", requireRole("MARINA_OWNER", "MARINA_MANAGER"), handler)
 *   router.post("/:id/refund", requireRole(...FINANCE_ROLES), handler)
 */
export function requireRole(...roles: UserRole[]) {
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
 * Platform admin guard — requires an active user with role PLATFORM_ADMIN.
 * Used on /api/admin routes (which run without a tenant context).
 */
export function requirePlatformAdmin() {
  return [
    authenticateSession(),
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        let user;
        if (req.devAuthBypass) {
          user = await prisma.user.findFirst({
            where: { role: "PLATFORM_ADMIN", active: true },
            orderBy: { createdAt: "asc" },
          });
        } else {
          const clerkUserId = getAuth(req).userId;
          if (!clerkUserId) {
            res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
            return;
          }
          user = await prisma.user.findFirst({
            where: {
              clerkUserId,
              role: "PLATFORM_ADMIN",
              active: true,
            },
          });
        }

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

        next();
      } catch (err) {
        next(err);
      }
    },
  ];
}
