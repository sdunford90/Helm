import type { Request, Response, NextFunction } from "express";
import { clerkMiddleware, requireAuth, getAuth } from "@clerk/express";
import { prisma } from "../lib/prisma.js";
import { isDevAuthBypassEnabled, parseList } from "../lib/env.js";

// --------------------------------------------------------------------------
// Extend Express Request with authenticated user context
// --------------------------------------------------------------------------

declare global {
  namespace Express {
    interface Request {
      userId?: string;
      userRole?: string;
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

/**
 * Clerk authentication middleware (fail-closed).
 *
 * 1. Verifies the Clerk session (401 JSON when missing/invalid — never a
 *    redirect, never an anonymous pass-through).
 * 2. Resolves the internal user record and verifies it belongs to the
 *    current tenant.
 *
 * The ONLY way to skip Clerk is the explicit local-development flag
 * `HELM_DEV_AUTH_BYPASS=true`, which is refused (throws, and `loadEnv()`
 * exits at boot) when NODE_ENV=production. NODE_ENV alone never disables auth.
 */
export function clerkAuth() {
  const verifyClerkSession = clerkSessionVerifier();

  return [
    // First: authenticate (Clerk session, or explicit dev bypass)
    (req: Request, res: Response, next: NextFunction): void => {
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
    },

    // Second: resolve internal user and verify tenant membership
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        if (req.devAuthBypass) {
          const user = await prisma.user.findFirst({
            where: { tenantId: req.tenantId },
            orderBy: { createdAt: "asc" },
          });
          if (!user) {
            res.status(401).json({ error: "Dev bypass: no user in this tenant", code: "UNAUTHORIZED" });
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
 * Usage:
 *   router.post("/slips", clerkAuth(), requireRole("admin", "manager"), handler)
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
 * Platform admin guard — checks for the special "platform_admin" role.
 * Used on /api/admin routes.
 */
export function requirePlatformAdmin() {
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
            clerk_id: clerkUserId,
            role: "platform_admin",
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

        next();
      } catch (err) {
        next(err);
      }
    },
  ];
}
