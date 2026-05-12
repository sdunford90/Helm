import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { clerkAuth } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";
import {
  getActiveAnnouncementsForUser,
  dismissAnnouncement,
} from "../services/announcements.js";

// A12 — Tenant-facing platform announcements. Web / portal / admin top bars
// call GET /active to render banners, then POST /:id/dismiss when the user
// closes one (if dismissable). Authentication required; tenant scope is
// honored via the user's tenant/tier.

const router: Router = Router();

router.use(...clerkAuth());

router.get("/active", async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Best-effort tier resolution. Some tenants may not have a default tier
    // assigned; that's fine, audience=ALL still surfaces.
    const tenantId = req.tenantId ?? null;
    let tenantTierId: string | null = null;
    if (tenantId) {
      // Tenant tier is usually on the Location row (per-location SaaS), so
      // we just grab any location's tier id as a coarse stand-in. If the
      // audience-TIER feature is heavily used, swap for a per-location call.
      const loc = await prisma.location.findFirst({
        where: { tenantId },
        select: { saasTierId: true },
      });
      tenantTierId = loc?.saasTierId ?? null;
    }
    const announcements = await getActiveAnnouncementsForUser({
      userId: req.userId ?? null,
      tenantTierId,
      userRole: req.userRole ?? null,
    });
    res.json({ announcements });
  } catch (err) {
    next(err);
  }
});

router.post("/:id/dismiss", async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    await dismissAnnouncement(req.params.id, req.userId);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export default router;

// Admin CRUD lives on the same Router instance, but is exported as a second
// router so it can be mounted under /api/admin with the platform-admin gate
// from the calling index.ts.
export function buildAdminAnnouncementsRouter(): Router {
  const adminRouter = Router();

  const CreateSchema = z.object({
    severity: z.enum(["INFO", "WARNING", "MAINTENANCE"]).default("INFO"),
    title: z.string().min(1).max(200),
    body: z.string().min(1).max(2000),
    link: z.string().max(500).nullable().optional(),
    audience: z.enum(["ALL", "TIER", "ROLE"]).default("ALL"),
    audienceValue: z.string().max(64).nullable().optional(),
    startsAt: z.string().datetime().optional(),
    endsAt: z.string().datetime().nullable().optional(),
    dismissable: z.boolean().optional(),
  });

  adminRouter.get("/", async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const rows = await prisma.platformAnnouncement.findMany({
        orderBy: { createdAt: "desc" },
        take: 200,
      });
      res.json({ announcements: rows });
    } catch (err) {
      next(err);
    }
  });

  adminRouter.post("/", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = CreateSchema.parse(req.body);
      const created = await prisma.platformAnnouncement.create({
        data: {
          severity: body.severity,
          title: body.title,
          body: body.body,
          link: body.link ?? null,
          audience: body.audience,
          audienceValue: body.audienceValue ?? null,
          startsAt: body.startsAt ? new Date(body.startsAt) : new Date(),
          endsAt: body.endsAt ? new Date(body.endsAt) : null,
          dismissable: body.dismissable ?? true,
          createdBy: req.userId ?? null,
        },
      });
      res.status(201).json(created);
    } catch (err) {
      next(err);
    }
  });

  adminRouter.put("/:id", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = CreateSchema.partial().parse(req.body);
      const data: Record<string, unknown> = {};
      if (body.severity !== undefined) data.severity = body.severity;
      if (body.title !== undefined) data.title = body.title;
      if (body.body !== undefined) data.body = body.body;
      if (body.link !== undefined) data.link = body.link;
      if (body.audience !== undefined) data.audience = body.audience;
      if (body.audienceValue !== undefined) data.audienceValue = body.audienceValue;
      if (body.startsAt !== undefined) data.startsAt = new Date(body.startsAt);
      if (body.endsAt !== undefined) data.endsAt = body.endsAt ? new Date(body.endsAt) : null;
      if (body.dismissable !== undefined) data.dismissable = body.dismissable;
      const updated = await prisma.platformAnnouncement.update({
        where: { id: req.params.id },
        data,
      });
      res.json(updated);
    } catch (err) {
      next(err);
    }
  });

  adminRouter.delete("/:id", async (req: Request, res: Response, next: NextFunction) => {
    try {
      await prisma.platformAnnouncement.delete({ where: { id: req.params.id } });
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  return adminRouter;
}
