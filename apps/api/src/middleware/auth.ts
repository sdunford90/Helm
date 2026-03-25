import type { Request, Response, NextFunction } from "express";
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
    }
  }
}

/**
 * Clerk authentication middleware.
 *
 * Wraps `requireAuth` from @clerk/express and then resolves the internal
 * user record, verifying that the user belongs to the current tenant.
 */
export function clerkAuth() {
  return [
    // First: Clerk's own guard — returns 401 if no valid session
    requireAuth(),

    // Second: resolve internal user and verify tenant membership
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const auth = getAuth(req);
        const clerkUserId = auth.userId;

        if (!clerkUserId) {
          res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
          return;
        }

        // Look up the internal user record scoped to the current tenant
        const user = await prisma.user.findFirst({
          where: {
            clerk_id: clerkUserId,
            tenant_id: req.tenantId,
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
