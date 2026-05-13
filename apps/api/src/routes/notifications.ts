// Plan 17 — In-app notifications: list, mark-read, mark-all-read.
//
// Tenant-side staff and platform admins authenticate via Clerk; the same
// route distinguishes by checking whether the User has role=PLATFORM_ADMIN
// (audienceAdminUserId column) vs a tenant staff role (audienceUserId).
// Portal customers consume `/api/portal/notifications` (separate route, in
// portal.ts) so they hit `audiencePortalCustomerId`.

import { Router, type Request, type Response, type NextFunction } from "express";
import { prisma } from "../lib/prisma.js";

const router: Router = Router();

function actorScope(req: Request): {
  audienceUserId?: string;
  audienceAdminUserId?: string;
  tenantId: string;
} {
  const tenantId = req.tenantId!;
  const role = req.userRecord?.role ?? null;
  if (role === "PLATFORM_ADMIN") {
    return { audienceAdminUserId: req.userId!, tenantId };
  }
  return { audienceUserId: req.userId!, tenantId };
}

// GET /api/notifications — list with unread-first ordering.
router.get("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const scope = actorScope(req);
    const where = scope.audienceAdminUserId
      ? { audienceAdminUserId: scope.audienceAdminUserId }
      : { audienceUserId: scope.audienceUserId, tenantId: scope.tenantId };
    const [unread, recent] = await Promise.all([
      prisma.notification.findMany({
        where: { ...where, readAt: null },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
      prisma.notification.findMany({
        where: { ...where, readAt: { not: null } },
        orderBy: { createdAt: "desc" },
        take: 25,
      }),
    ]);
    res.json({
      unread,
      recent,
      unreadCount: unread.length,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/notifications/:id/read — mark a single notification read.
router.post("/:id/read", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const scope = actorScope(req);
    const where = scope.audienceAdminUserId
      ? { id: req.params.id, audienceAdminUserId: scope.audienceAdminUserId }
      : { id: req.params.id, audienceUserId: scope.audienceUserId, tenantId: scope.tenantId };
    const existing = await prisma.notification.findFirst({ where });
    if (!existing) {
      res.status(404).json({ error: "Notification not found" });
      return;
    }
    const updated = await prisma.notification.update({
      where: { id: existing.id },
      data: { readAt: new Date() },
    });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// POST /api/notifications/read-all — mark every unread row read.
router.post("/read-all", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const scope = actorScope(req);
    const where = scope.audienceAdminUserId
      ? { audienceAdminUserId: scope.audienceAdminUserId, readAt: null }
      : { audienceUserId: scope.audienceUserId, tenantId: scope.tenantId, readAt: null };
    const { count } = await prisma.notification.updateMany({
      where,
      data: { readAt: new Date() },
    });
    res.json({ markedRead: count });
  } catch (err) {
    next(err);
  }
});

export default router;
