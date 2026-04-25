import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { clerkAuth, requireRole } from "../middleware/auth.js";

const router: Router = Router();

router.use(...clerkAuth());
router.use(requireRole("admin", "manager", "accounting"));

// ─── Helpers ─────────────────────────────────────────────────────────────────

function appError(message: string, status: number, code: string) {
  const err = new Error(message) as any;
  err.statusCode = status;
  err.code = code;
  return err;
}

// ─── Schemas ─────────────────────────────────────────────────────────────────

const JurisdictionSchema = z.object({
  code: z.string().min(1).max(50),
  name: z.string().min(1).max(200),
  kind: z.enum(["STATE", "COUNTY", "CITY", "SPECIAL"]),
});

const TaxRateSchema = z.object({
  jurisdictionId: z.string().uuid(),
  category: z.string().min(1),
  ratePctBps: z.number().int().min(0).max(100_000),
  effectiveFrom: z.string().datetime(),
  effectiveTo: z.string().datetime().optional().nullable(),
  glAccountId: z.string().uuid().optional().nullable(),
});

const LocationAssignmentSchema = z.object({
  locationId: z.string().uuid(),
  jurisdictionIds: z.array(z.string().uuid()),
});

const LocationSortSchema = z.object({
  locationId: z.string().uuid(),
  assignments: z.array(
    z.object({ jurisdictionId: z.string().uuid(), sortOrder: z.number().int() }),
  ),
});

// ─── Jurisdiction CRUD ───────────────────────────────────────────────────────

router.get(
  "/jurisdictions",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = (req as any).tenantId;
      const rows = await prisma.taxJurisdiction.findMany({
        where: { tenantId },
        include: { rates: { orderBy: { effectiveFrom: "desc" } } },
        orderBy: [{ kind: "asc" }, { code: "asc" }],
      });
      res.json({ data: rows });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/jurisdictions",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = (req as any).tenantId;
      const body = JurisdictionSchema.parse(req.body);

      const jurisdiction = await prisma.taxJurisdiction.create({
        data: { tenantId, ...body },
      });
      res.status(201).json({ data: jurisdiction });
    } catch (err) {
      next(err);
    }
  },
);

router.put(
  "/jurisdictions/:id",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = (req as any).tenantId;
      const body = JurisdictionSchema.partial().parse(req.body);

      const existing = await prisma.taxJurisdiction.findFirst({
        where: { id: req.params.id, tenantId },
      });
      if (!existing) throw appError("Jurisdiction not found", 404, "NOT_FOUND");

      const updated = await prisma.taxJurisdiction.update({
        where: { id: req.params.id },
        data: body,
      });
      res.json({ data: updated });
    } catch (err) {
      next(err);
    }
  },
);

router.delete(
  "/jurisdictions/:id",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = (req as any).tenantId;
      const existing = await prisma.taxJurisdiction.findFirst({
        where: { id: req.params.id, tenantId },
      });
      if (!existing) throw appError("Jurisdiction not found", 404, "NOT_FOUND");

      await prisma.taxJurisdiction.delete({ where: { id: req.params.id } });
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  },
);

// ─── Tax Rate CRUD ────────────────────────────────────────────────────────────

router.get(
  "/rates",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = (req as any).tenantId;
      const { jurisdictionId } = req.query;
      const where: any = { tenantId };
      if (jurisdictionId) where.jurisdictionId = jurisdictionId as string;

      const rows = await prisma.taxRate.findMany({
        where,
        include: { jurisdiction: { select: { code: true, name: true, kind: true } } },
        orderBy: [{ jurisdictionId: "asc" }, { effectiveFrom: "desc" }],
      });
      res.json({ data: rows });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/rates",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = (req as any).tenantId;
      const body = TaxRateSchema.parse(req.body);

      const jurisdiction = await prisma.taxJurisdiction.findFirst({
        where: { id: body.jurisdictionId, tenantId },
      });
      if (!jurisdiction) throw appError("Jurisdiction not found", 404, "NOT_FOUND");

      const rate = await prisma.taxRate.create({
        data: {
          tenantId,
          jurisdictionId: body.jurisdictionId,
          category: body.category,
          ratePctBps: body.ratePctBps,
          effectiveFrom: new Date(body.effectiveFrom),
          effectiveTo: body.effectiveTo ? new Date(body.effectiveTo) : null,
          glAccountId: body.glAccountId ?? null,
        },
        include: { jurisdiction: { select: { code: true, name: true, kind: true } } },
      });
      res.status(201).json({ data: rate });
    } catch (err) {
      next(err);
    }
  },
);

router.put(
  "/rates/:id",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = (req as any).tenantId;
      const body = TaxRateSchema.partial().parse(req.body);

      const existing = await prisma.taxRate.findFirst({
        where: { id: req.params.id, tenantId },
      });
      if (!existing) throw appError("Tax rate not found", 404, "NOT_FOUND");

      const updated = await prisma.taxRate.update({
        where: { id: req.params.id },
        data: {
          ...body,
          effectiveFrom: body.effectiveFrom ? new Date(body.effectiveFrom) : undefined,
          effectiveTo: body.effectiveTo ? new Date(body.effectiveTo) : body.effectiveTo === null ? null : undefined,
        },
        include: { jurisdiction: { select: { code: true, name: true, kind: true } } },
      });
      res.json({ data: updated });
    } catch (err) {
      next(err);
    }
  },
);

router.delete(
  "/rates/:id",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = (req as any).tenantId;
      const existing = await prisma.taxRate.findFirst({
        where: { id: req.params.id, tenantId },
      });
      if (!existing) throw appError("Tax rate not found", 404, "NOT_FOUND");

      await prisma.taxRate.delete({ where: { id: req.params.id } });
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  },
);

// ─── Location ↔ Jurisdiction assignments ─────────────────────────────────────

router.get(
  "/locations/:locationId/jurisdictions",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = (req as any).tenantId;
      const { locationId } = req.params;

      const rows = await prisma.locationTaxJurisdiction.findMany({
        where: { locationId, tenantId },
        orderBy: { sortOrder: "asc" },
        include: {
          jurisdiction: {
            include: {
              rates: { orderBy: { effectiveFrom: "desc" }, take: 5 },
            },
          },
        },
      });
      res.json({ data: rows });
    } catch (err) {
      next(err);
    }
  },
);

router.put(
  "/locations/assign",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = (req as any).tenantId;
      const { locationId, jurisdictionIds } = LocationAssignmentSchema.parse(req.body);

      await prisma.$transaction(async (tx) => {
        await tx.locationTaxJurisdiction.deleteMany({
          where: { locationId, tenantId },
        });

        if (jurisdictionIds.length > 0) {
          await tx.locationTaxJurisdiction.createMany({
            data: jurisdictionIds.map((jurisdictionId, idx) => ({
              tenantId,
              locationId,
              jurisdictionId,
              sortOrder: idx,
            })),
          });
        }
      });

      const updated = await prisma.locationTaxJurisdiction.findMany({
        where: { locationId, tenantId },
        orderBy: { sortOrder: "asc" },
        include: { jurisdiction: true },
      });
      res.json({ data: updated });
    } catch (err) {
      next(err);
    }
  },
);

router.put(
  "/locations/sort",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = (req as any).tenantId;
      const { locationId, assignments } = LocationSortSchema.parse(req.body);

      await prisma.$transaction(
        assignments.map((a) =>
          prisma.locationTaxJurisdiction.updateMany({
            where: { locationId, jurisdictionId: a.jurisdictionId, tenantId },
            data: { sortOrder: a.sortOrder },
          }),
        ),
      );

      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
