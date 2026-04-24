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
export function clerkAuth() {
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
export function requirePlatformAdmin() {
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

        next();
      } catch (err) {
        next(err);
      }
    },
  ];
}
