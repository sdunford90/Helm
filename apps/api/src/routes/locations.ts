import { Router, type IRouter, type Request, type Response } from "express";
import { clerkAuth } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";

const router: IRouter = Router();
router.use(...clerkAuth());

router.get("/", async (req: Request, res: Response) => {
  const tenantId = req.tenantId;
  if (!tenantId) return res.status(401).json({ error: "Unauthorized" });

  const locations = await prisma.location.findMany({
    where: { tenantId, active: true },
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
    },
  });

  res.json({ data: locations });
});

router.patch("/:id/features", async (req: Request, res: Response) => {
  const tenantId = req.tenantId;
  if (!tenantId) return res.status(401).json({ error: "Unauthorized" });

  const { id } = req.params;
  const { transientEnabled, rentalsEnabled } = req.body as {
    transientEnabled?: boolean;
    rentalsEnabled?: boolean;
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
    },
    select: {
      id: true,
      name: true,
      transientEnabled: true,
      rentalsEnabled: true,
    },
  });

  res.json(updated);
});

export default router;
