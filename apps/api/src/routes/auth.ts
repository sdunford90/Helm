import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { Webhook } from "svix";
import { clerkAuth } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";
import { getAuth } from "@clerk/express";

const router = Router();

// ─── Zod Schemas ─────────────────────────────────────────────────────────────

const SwitchTenantSchema = z.object({
  tenantId: z.string().uuid(),
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function appError(message: string, statusCode: number, code: string): Error {
  const err = new Error(message) as Error & {
    statusCode: number;
    code: string;
  };
  err.statusCode = statusCode;
  err.code = code;
  return err;
}

// ─── POST /webhook — Clerk webhook handler (no auth middleware) ─────────────

router.post(
  "/webhook",
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const WEBHOOK_SECRET = process.env.CLERK_WEBHOOK_SECRET;

    if (!WEBHOOK_SECRET) {
      console.error("[auth/webhook] CLERK_WEBHOOK_SECRET is not configured");
      res.status(500).json({ error: "Webhook secret not configured" });
      return;
    }

    // Svix headers required for verification
    const svixId = req.headers["svix-id"] as string | undefined;
    const svixTimestamp = req.headers["svix-timestamp"] as string | undefined;
    const svixSignature = req.headers["svix-signature"] as string | undefined;

    if (!svixId || !svixTimestamp || !svixSignature) {
      res.status(400).json({ error: "Missing svix headers" });
      return;
    }

    // Verify the webhook signature
    const wh = new Webhook(WEBHOOK_SECRET);
    let evt: WebhookEvent;

    try {
      evt = wh.verify(JSON.stringify(req.body), {
        "svix-id": svixId,
        "svix-timestamp": svixTimestamp,
        "svix-signature": svixSignature,
      }) as WebhookEvent;
    } catch (err) {
      console.error("[auth/webhook] Signature verification failed:", err);
      res.status(400).json({ error: "Invalid webhook signature" });
      return;
    }

    try {
      switch (evt.type) {
        case "user.created": {
          const userData = evt.data as unknown as ClerkUserData;
          const { id, email_addresses, first_name, last_name, public_metadata } = userData;
          const primaryEmail =
            email_addresses?.find((e) => e.id === userData.primary_email_address_id)?.email_address ??
            email_addresses?.[0]?.email_address ??
            "";
          const tenantId = (public_metadata as Record<string, unknown>)?.tenant_id as string | undefined;

          if (tenantId) {
            // Verify tenant exists before creating the user
            const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
            if (tenant) {
              await prisma.user.create({
                data: {
                  clerkUserId: id,
                  email: primaryEmail,
                  firstName: first_name ?? "",
                  lastName: last_name ?? "",
                  tenantId,
                  role: "DOCK_STAFF", // default role; admin can promote later
                },
              });
            } else {
              console.warn(`[auth/webhook] user.created: tenant ${tenantId} not found, skipping user creation`);
            }
          } else {
            console.info(`[auth/webhook] user.created: no tenant_id in metadata for clerk user ${id}, skipping`);
          }
          break;
        }

        case "user.updated": {
          const updatedData = evt.data as unknown as ClerkUserData;
          const { id, email_addresses, first_name, last_name } = updatedData;
          const primaryEmail =
            email_addresses?.find((e) => e.id === updatedData.primary_email_address_id)?.email_address ??
            email_addresses?.[0]?.email_address;

          // Update all user records linked to this clerk ID (user may exist in multiple tenants)
          const updateData: Record<string, unknown> = {};
          if (primaryEmail !== undefined) updateData.email = primaryEmail;
          if (first_name !== undefined) updateData.firstName = first_name;
          if (last_name !== undefined) updateData.lastName = last_name;

          if (Object.keys(updateData).length > 0) {
            await prisma.user.updateMany({
              where: { clerkUserId: id },
              data: updateData,
            });
          }
          break;
        }

        case "user.deleted": {
          const { id } = evt.data as { id: string };
          // Soft delete: deactivate rather than removing records
          await prisma.user.updateMany({
            where: { clerkUserId: id },
            data: { active: false },
          });
          break;
        }

        case "session.created": {
          // Optional: log session for audit purposes
          const { user_id } = evt.data as { user_id: string };
          console.info(`[auth/webhook] session.created for clerk user ${user_id}`);
          break;
        }

        case "organizationMembership.created": {
          const data = evt.data as OrgMembershipData;
          const clerkUserId = data.public_user_data?.user_id;
          const tenantId = (data.organization?.public_metadata as Record<string, unknown>)?.tenant_id as string | undefined;

          if (clerkUserId && tenantId) {
            const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
            if (!tenant) {
              console.warn(`[auth/webhook] org membership: tenant ${tenantId} not found`);
              break;
            }

            // Check if user already exists in this tenant
            const existing = await prisma.user.findFirst({
              where: { clerkUserId, tenantId },
            });

            if (!existing) {
              // Pull basic info from any existing record or create minimal
              const anyRecord = await prisma.user.findFirst({
                where: { clerkUserId },
              });

              await prisma.user.create({
                data: {
                  clerkUserId,
                  email: anyRecord?.email ?? "",
                  firstName: anyRecord?.firstName ?? "",
                  lastName: anyRecord?.lastName ?? "",
                  tenantId,
                  role: "DOCK_STAFF",
                },
              });
            }
          }
          break;
        }

        case "organizationMembership.deleted": {
          const data = evt.data as OrgMembershipData;
          const clerkUserId = data.public_user_data?.user_id;
          const tenantId = (data.organization?.public_metadata as Record<string, unknown>)?.tenant_id as string | undefined;

          if (clerkUserId && tenantId) {
            // Deactivate the user in this specific tenant
            await prisma.user.updateMany({
              where: { clerkUserId, tenantId },
              data: { active: false },
            });
          }
          break;
        }

        default:
          console.info(`[auth/webhook] Unhandled event type: ${evt.type}`);
      }

      res.status(200).json({ received: true });
    } catch (err) {
      console.error(`[auth/webhook] Error processing ${evt.type}:`, err);
      res.status(500).json({ error: "Webhook processing failed" });
    }
  },
);

// ─── Protected routes (require Clerk auth) ───────────────────────────────────

// ─── POST /sync-session — Ensure user exists in local DB after login ────────

router.post(
  "/sync-session",
  ...clerkAuth(),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const auth = getAuth(req);
      const clerkUserId = auth.userId;

      if (!clerkUserId) {
        res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
        return;
      }

      const tenantId = req.tenantId;
      if (!tenantId) {
        res.status(400).json({ error: "Tenant context required", code: "TENANT_REQUIRED" });
        return;
      }

      // Upsert: create user if not exists, update profile if they do
      const user = await prisma.user.upsert({
        where: {
          // Use a compound lookup — clerkUserId + tenantId
          // Since there's no unique constraint on this combo, use findFirst + create/update
          id: await findUserIdByClerk(clerkUserId, tenantId),
        },
        update: {
          active: true,
        },
        create: {
          clerkUserId,
          email: req.body.email ?? "",
          firstName: req.body.firstName ?? "",
          lastName: req.body.lastName ?? "",
          tenantId,
          role: "DOCK_STAFF",
          active: true,
        },
      });

      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { id: true, name: true, subdomain: true },
      });

      res.status(200).json({
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
          active: user.active,
        },
        tenant,
      });
    } catch (err) {
      next(err);
    }
  },
);

// ─── GET /me — Current user profile with tenant info ────────────────────────

router.get(
  "/me",
  ...clerkAuth(),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userRecord = req.userRecord;
      if (!userRecord) {
        res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
        return;
      }

      const tenant = await prisma.tenant.findUnique({
        where: { id: req.tenantId! },
        select: { id: true, name: true, subdomain: true, timezone: true },
      });

      // Derive permissions from role
      const permissions = getPermissionsForRole(userRecord.role);

      res.status(200).json({
        user: {
          id: userRecord.id,
          email: userRecord.email,
          firstName: (userRecord as Record<string, unknown>).firstName ?? (userRecord as Record<string, unknown>).first_name,
          lastName: (userRecord as Record<string, unknown>).lastName ?? (userRecord as Record<string, unknown>).last_name,
          role: userRecord.role,
          active: (userRecord as Record<string, unknown>).active,
        },
        tenant,
        permissions,
      });
    } catch (err) {
      next(err);
    }
  },
);

// ─── POST /switch-tenant — Switch tenant context ────────────────────────────

router.post(
  "/switch-tenant",
  ...clerkAuth(),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = SwitchTenantSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: "Validation failed",
          code: "VALIDATION_ERROR",
          details: parsed.error.flatten(),
        });
        return;
      }

      const { tenantId: targetTenantId } = parsed.data;
      const auth = getAuth(req);
      const clerkUserId = auth.userId;

      if (!clerkUserId) {
        res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
        return;
      }

      // Verify user has an active membership in the target tenant
      const membership = await prisma.user.findFirst({
        where: {
          clerkUserId,
          tenantId: targetTenantId,
          active: true,
        },
      });

      if (!membership) {
        res.status(403).json({
          error: "You do not have access to this tenant",
          code: "TENANT_ACCESS_DENIED",
        });
        return;
      }

      const tenant = await prisma.tenant.findUnique({
        where: { id: targetTenantId },
        select: { id: true, name: true, subdomain: true, timezone: true },
      });

      if (!tenant) {
        throw appError("Tenant not found", 404, "TENANT_NOT_FOUND");
      }

      res.status(200).json({
        user: {
          id: membership.id,
          email: membership.email,
          firstName: membership.firstName,
          lastName: membership.lastName,
          role: membership.role,
          active: membership.active,
        },
        tenant,
      });
    } catch (err) {
      next(err);
    }
  },
);

// ─── Internal helpers ────────────────────────────────────────────────────────

/**
 * Find the internal user ID by clerk user ID and tenant — returns a sentinel
 * UUID when no match is found so the upsert falls through to the `create` path.
 */
async function findUserIdByClerk(
  clerkUserId: string,
  tenantId: string,
): Promise<string> {
  const user = await prisma.user.findFirst({
    where: { clerkUserId, tenantId },
    select: { id: true },
  });
  // Return existing id or a UUID that won't match, triggering `create`
  return user?.id ?? "00000000-0000-0000-0000-000000000000";
}

/**
 * Derive a permission set from the user role.
 */
function getPermissionsForRole(role: string): string[] {
  const rolePermissions: Record<string, string[]> = {
    PLATFORM_ADMIN: [
      "manage:tenants",
      "manage:users",
      "manage:slips",
      "manage:customers",
      "manage:invoices",
      "manage:payments",
      "manage:leads",
      "manage:boats",
      "manage:dock-walks",
      "manage:pos",
      "manage:rentals",
      "manage:announcements",
      "manage:reports",
      "manage:contracts",
      "manage:settings",
    ],
    MARINA_OWNER: [
      "manage:users",
      "manage:slips",
      "manage:customers",
      "manage:invoices",
      "manage:payments",
      "manage:leads",
      "manage:boats",
      "manage:dock-walks",
      "manage:pos",
      "manage:rentals",
      "manage:announcements",
      "manage:reports",
      "manage:contracts",
      "manage:settings",
    ],
    MARINA_MANAGER: [
      "manage:slips",
      "manage:customers",
      "manage:invoices",
      "manage:payments",
      "manage:leads",
      "manage:boats",
      "manage:dock-walks",
      "manage:pos",
      "manage:rentals",
      "manage:announcements",
      "manage:reports",
      "manage:contracts",
    ],
    DOCK_STAFF: [
      "read:slips",
      "manage:dock-walks",
      "read:customers",
      "manage:boats",
    ],
    POS_CASHIER: [
      "manage:pos",
      "read:customers",
    ],
    ACCOUNTING: [
      "manage:invoices",
      "manage:payments",
      "manage:reports",
      "read:customers",
      "read:slips",
    ],
    PORTAL_USER: [
      "read:own-slips",
      "read:own-invoices",
      "read:own-payments",
      "read:announcements",
    ],
  };

  return rolePermissions[role] ?? [];
}

// ─── Webhook event types ─────────────────────────────────────────────────────

interface ClerkEmailAddress {
  id: string;
  email_address: string;
}

interface ClerkUserData {
  id: string;
  email_addresses?: ClerkEmailAddress[];
  primary_email_address_id?: string;
  first_name?: string;
  last_name?: string;
  public_metadata?: Record<string, unknown>;
}

interface OrgMembershipData {
  public_user_data?: {
    user_id?: string;
  };
  organization?: {
    public_metadata?: Record<string, unknown>;
  };
}

interface WebhookEvent {
  type: string;
  data: Record<string, unknown>;
}

export default router;
