import { Router, type IRouter, type Request, type Response } from "express";
import { clerkAuth, filterByAllowedLocations, requireLocationAccess } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";

const router: IRouter = Router();
router.use(...clerkAuth());

router.get("/", async (req: Request, res: Response) => {
  const tenantId = req.tenantId;
  if (!tenantId) return res.status(401).json({ error: "Unauthorized" });

  const where = filterByAllowedLocations(req, { tenantId, active: true } as Record<string, unknown>, {
    field: "id",
  });

  const locations = await prisma.location.findMany({
    where,
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      address: true,
      city: true,
      state: true,
      phone: true,
      timezone: true,
      transientEnabled: true,
      rentalsEnabled: true,
      rampEnabled: true,
      conciergeEnabled: true,
    },
  });

  res.json({ data: locations });
});

router.patch("/:id/features", async (req: Request, res: Response) => {
  const tenantId = req.tenantId;
  if (!tenantId) return res.status(401).json({ error: "Unauthorized" });

  const { id } = req.params;
  if (!requireLocationAccess(req, id)) {
    return res.status(403).json({ error: "Forbidden for this location", code: "LOCATION_FORBIDDEN" });
  }

  const { transientEnabled, rentalsEnabled, rampEnabled, conciergeEnabled } = req.body as {
    transientEnabled?: boolean;
    rentalsEnabled?: boolean;
    rampEnabled?: boolean;
    conciergeEnabled?: boolean;
  };

  const existing = await prisma.location.findFirst({
    where: { id, tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Location not found" });

  const updated = await prisma.location.update({
    where: { id },
    data: {
      ...(transientEnabled !== undefined && { transientEnabled }),
      ...(rentalsEnabled !== undefined && { rentalsEnabled }),
      ...(rampEnabled !== undefined && { rampEnabled }),
      ...(conciergeEnabled !== undefined && { conciergeEnabled }),
    },
    select: {
      id: true,
      name: true,
      transientEnabled: true,
      rentalsEnabled: true,
      rampEnabled: true,
      conciergeEnabled: true,
    },
  });

  res.json(updated);
});

export default router;
