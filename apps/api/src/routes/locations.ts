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
      // Per-location POS toggles. POS reads these to decide which payment
      // buttons to render (ACH, Charge to A/R) alongside Cash and Card.
      posAchEnabled: true,
      posChargeToARAllowed: true,
      // Z-report distribution list (Task #320). Returned here so the
      // Locations settings UI can render + edit the configured
      // recipients alongside the other per-location toggles.
      zReportRecipients: true,
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

  const { transientEnabled, rentalsEnabled, rampEnabled, conciergeEnabled, zReportRecipients } = req.body as {
    transientEnabled?: boolean;
    rentalsEnabled?: boolean;
    rampEnabled?: boolean;
    conciergeEnabled?: boolean;
    zReportRecipients?: string[];
  };

  // Validate the optional Z-report distribution list. We accept an array
  // of email addresses, dedupe + lowercase, and reject anything that
  // doesn't look like an email so a typo can't silently break end-of-day
  // reporting. Empty array is allowed and clears the list.
  let normalizedRecipients: string[] | undefined;
  if (zReportRecipients !== undefined) {
    if (!Array.isArray(zReportRecipients)) {
      return res.status(400).json({ error: "zReportRecipients must be an array", code: "BAD_INPUT" });
    }
    const cleaned = Array.from(
      new Set(zReportRecipients.map((s) => String(s).trim().toLowerCase()).filter(Boolean)),
    );
    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const bad = cleaned.find((e) => !emailRe.test(e));
    if (bad) {
      return res.status(400).json({ error: `Invalid email: ${bad}`, code: "BAD_INPUT" });
    }
    normalizedRecipients = cleaned;
  }

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
      ...(normalizedRecipients !== undefined && { zReportRecipients: normalizedRecipients }),
    },
    select: {
      id: true,
      name: true,
      transientEnabled: true,
      rentalsEnabled: true,
      rampEnabled: true,
      conciergeEnabled: true,
      zReportRecipients: true,
    },
  });

  res.json(updated);
});

export default router;
