import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { clerkAuth } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";

const router: Router = Router();

// ─── Zod Schemas ─────────────────────────────────────────────────────────────

const DockWalkStatusEnum = z.enum(["IN_PROGRESS", "COMPLETED"]);
const DockWalkItemStatusEnum = z.enum(["OK", "VIOLATION", "NEEDS_ATTENTION"]);

const ListDockWalksQuerySchema = z.object({
  status: DockWalkStatusEnum.optional(),
  inspectorId: z.string().optional(),
  dockId: z.string().optional(),
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
  skip: z.coerce.number().int().min(0).default(0),
  take: z.coerce.number().int().positive().max(100).default(25),
  sortBy: z.enum(["startedAt", "completedAt", "status"]).default("startedAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

const CreateDockWalkSchema = z.object({
  inspectorId: z.string().min(1),
  dockId: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

const UpdateDockWalkSchema = z.object({
  notes: z.string().optional().nullable(),
  status: DockWalkStatusEnum.optional(),
  dockId: z.string().optional().nullable(),
});

const CreateDockWalkItemSchema = z.object({
  slipId: z.string().optional().nullable(),
  status: DockWalkItemStatusEnum.default("OK"),
  notes: z.string().optional().nullable(),
  violationType: z.string().optional().nullable(),
  photoUrls: z.array(z.string()).optional().nullable(),
  feeCents: z.coerce.number().int().optional().nullable(),
  lineCheck: z.boolean().optional(),
  powerCheck: z.boolean().optional(),
  bilgeCheck: z.boolean().optional(),
  boatCondition: z.string().optional().nullable(),
  // Inspection results (per-slip walk flow)
  boatPresent: z.boolean().optional().nullable(),
  expectedMatch: z.boolean().optional().nullable(),
  expectedBoatId: z.string().optional().nullable(),
});

const UpdateDockWalkItemSchema = z.object({
  status: DockWalkItemStatusEnum.optional(),
  notes: z.string().optional().nullable(),
  violationType: z.string().optional().nullable(),
  photoUrls: z.array(z.string()).optional().nullable(),
  feeCents: z.coerce.number().int().optional().nullable(),
  lineCheck: z.boolean().optional(),
  powerCheck: z.boolean().optional(),
  bilgeCheck: z.boolean().optional(),
  boatCondition: z.string().optional().nullable(),
  boatPresent: z.boolean().optional().nullable(),
  expectedMatch: z.boolean().optional().nullable(),
  expectedBoatId: z.string().optional().nullable(),
});

const ListIssuesQuerySchema = z.object({
  severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).optional(),
  skip: z.coerce.number().int().min(0).default(0),
  take: z.coerce.number().int().positive().max(100).default(25),
});

const CreatePumpOutSchema = z.object({
  slipId: z.string().min(1),
  staffId: z.string().optional().nullable(),
  eventDate: z.coerce.date(),
  gallons: z.coerce.number().positive(),
  feeCents: z.coerce.number().int().optional().nullable(),
});

const ListPumpOutsQuerySchema = z.object({
  slipId: z.string().optional(),
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
  skip: z.coerce.number().int().min(0).default(0),
  take: z.coerce.number().int().positive().max(100).default(25),
  sortBy: z.enum(["eventDate", "gallons"]).default("eventDate"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

// ─── Helpers ────────────────────────────────────────────────────────────────

function appError(message: string, statusCode: number, code: string): Error {
  const err = new Error(message) as Error & {
    statusCode: number;
    code: string;
  };
  err.statusCode = statusCode;
  err.code = code;
  return err;
}

// ─── Authenticated routes ───────────────────────────────────────────────────

router.use(...clerkAuth());

// ─── GET / — List dock walks ────────────────────────────────────────────────

router.get(
  "/",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const query = ListDockWalksQuerySchema.parse(req.query);

      const where: Record<string, unknown> = { tenantId };

      if (query.status) where.status = query.status;
      if (query.inspectorId) where.inspectorId = query.inspectorId;
      if (query.dockId) where.dockId = query.dockId;

      if (query.dateFrom || query.dateTo) {
        const dateFilter: Record<string, Date> = {};
        if (query.dateFrom) dateFilter.gte = query.dateFrom;
        if (query.dateTo) dateFilter.lte = query.dateTo;
        where.startedAt = dateFilter;
      }

      const [dockWalks, total] = await Promise.all([
        prisma.dockWalk.findMany({
          where,
          orderBy: { [query.sortBy]: query.sortOrder },
          skip: query.skip,
          take: query.take,
          include: {
            items: {
              select: {
                id: true,
                status: true,
                slipId: true,
              },
            },
          },
        }),
        prisma.dockWalk.count({ where }),
      ]);

      res.json({
        data: dockWalks,
        pagination: {
          skip: query.skip,
          take: query.take,
          total,
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

// ─── GET /issues — List all open/unresolved issues ──────────────────────────

router.get(
  "/issues",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const query = ListIssuesQuerySchema.parse(req.query);

      const where: Record<string, unknown> = {
        status: { in: ["VIOLATION", "NEEDS_ATTENTION"] },
        dockWalk: { tenantId },
      };

      const [items, total] = await Promise.all([
        prisma.dockWalkItem.findMany({
          where,
          skip: query.skip,
          take: query.take,
          orderBy: { dockWalk: { startedAt: "desc" } },
          include: {
            slip: {
              select: { id: true, slipNumber: true, dockId: true },
            },
            dockWalk: {
              select: { id: true, startedAt: true, inspectorId: true, status: true },
            },
          },
        }),
        prisma.dockWalkItem.count({ where }),
      ]);

      res.json({
        data: items,
        pagination: {
          skip: query.skip,
          take: query.take,
          total,
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

// ─── POST /pump-outs — Record a pump-out ────────────────────────────────────

router.post(
  "/pump-outs",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const data = CreatePumpOutSchema.parse(req.body);

      const pumpOut = await prisma.pumpOut.create({
        data: {
          tenantId,
          slipId: data.slipId,
          staffId: data.staffId ?? null,
          eventDate: data.eventDate,
          gallons: data.gallons,
          feeCents: data.feeCents ?? null,
        },
      });

      await prisma.auditLog.create({
        data: {
          tenantId,
          userId: req.userId,
          userName: req.userRecord?.email,
          recordType: "PumpOut",
          recordId: pumpOut.id,
          action: "CREATED",
        },
      });

      res.status(201).json(pumpOut);
    } catch (err) {
      next(err);
    }
  },
);

// ─── GET /pump-outs — List pump-outs ────────────────────────────────────────

router.get(
  "/pump-outs",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const query = ListPumpOutsQuerySchema.parse(req.query);

      const where: Record<string, unknown> = { tenantId };

      if (query.slipId) where.slipId = query.slipId;

      if (query.dateFrom || query.dateTo) {
        const dateFilter: Record<string, Date> = {};
        if (query.dateFrom) dateFilter.gte = query.dateFrom;
        if (query.dateTo) dateFilter.lte = query.dateTo;
        where.eventDate = dateFilter;
      }

      const [pumpOuts, total] = await Promise.all([
        prisma.pumpOut.findMany({
          where,
          orderBy: { [query.sortBy]: query.sortOrder },
          skip: query.skip,
          take: query.take,
          include: {
            slip: {
              select: { id: true, slipNumber: true, dockId: true },
            },
          },
        }),
        prisma.pumpOut.count({ where }),
      ]);

      res.json({
        data: pumpOuts,
        pagination: {
          skip: query.skip,
          take: query.take,
          total,
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

// ─── GET /:id — Get single dock walk with all items ─────────────────────────

router.get(
  "/:id",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;

      const dockWalk = await prisma.dockWalk.findFirst({
        where: { id: req.params.id, tenantId },
        include: {
          items: {
            include: {
              slip: {
                select: { id: true, slipNumber: true, dockId: true, status: true },
              },
            },
          },
        },
      });

      if (!dockWalk) {
        throw appError("Dock walk not found", 404, "NOT_FOUND");
      }

      res.json(dockWalk);
    } catch (err) {
      next(err);
    }
  },
);

// ─── GET /:id/walk-list — Slips to inspect for a dock walk ────────────────
//
// Returns the ordered list of slips that the inspector should walk for this
// dock walk, plus, for each slip, the expected boat / customer (taken from
// the slip's currently active SlipContract) and any DockWalkItem already
// filed against that slip during this walk. This powers the mobile-first
// "walk runner" UI: one slip per row, inspector marks boat-present / right-
// boat / issues, page survives reloads because already-filed items come back.
//
// Walks scoped to a single dock (DockWalk.dockId set) only return that
// dock's slips. Walks with no dock return every slip in the tenant — the
// inspector can still pick through them, but typically a dock is selected.

router.get(
  "/:id/walk-list",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;

      const dockWalk = await prisma.dockWalk.findFirst({
        where: { id: req.params.id, tenantId },
      });
      if (!dockWalk) {
        throw appError("Dock walk not found", 404, "NOT_FOUND");
      }

      const slips = await prisma.slip.findMany({
        where: {
          tenantId,
          ...(dockWalk.dockId ? { dockId: dockWalk.dockId } : {}),
        },
        include: {
          contracts: {
            where: { status: "ACTIVE" },
            // Deterministic pick when (rarely) more than one ACTIVE contract
            // exists on a slip — newest start wins, then newest createdAt.
            orderBy: [{ startDate: "desc" }, { createdAt: "desc" }],
            include: {
              boat: {
                select: {
                  id: true,
                  name: true,
                  registrationNumber: true,
                  lengthFt: true,
                  beamFt: true,
                  make: true,
                  model: true,
                },
              },
              customer: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  company: true,
                  phone: true,
                  email: true,
                },
              },
            },
            take: 1,
          },
        },
      });

      // Stable, human-friendly slip ordering: numeric prefix when present,
      // then lexical fallback. "A-12" < "A-101" should not flip just because
      // strings sort differently from numbers.
      const slipNumKey = (s: string): [string, number, string] => {
        const m = /^([^\d]*)(\d+)(.*)$/.exec(s);
        if (!m) return [s, Number.POSITIVE_INFINITY, ""];
        return [m[1], parseInt(m[2], 10), m[3]];
      };
      slips.sort((a, b) => {
        const [pa, na, sa] = slipNumKey(a.slipNumber);
        const [pb, nb, sb] = slipNumKey(b.slipNumber);
        if (pa !== pb) return pa.localeCompare(pb);
        if (na !== nb) return na - nb;
        return sa.localeCompare(sb);
      });

      const items = await prisma.dockWalkItem.findMany({
        where: { dockWalkId: dockWalk.id },
      });
      const itemsBySlip = new Map<string, (typeof items)[number]>();
      for (const it of items) {
        if (it.slipId) itemsBySlip.set(it.slipId, it);
      }

      const walkList = slips.map((slip) => {
        const contract = slip.contracts[0] ?? null;
        return {
          slip: {
            id: slip.id,
            slipNumber: slip.slipNumber,
            dockId: slip.dockId,
            lengthFt: slip.lengthFt,
            beamFt: slip.beamFt,
            status: slip.status,
          },
          expectedBoat: contract?.boat ?? null,
          expectedCustomer: contract?.customer ?? null,
          item: itemsBySlip.get(slip.id) ?? null,
        };
      });

      res.json({
        dockWalk: {
          id: dockWalk.id,
          dockId: dockWalk.dockId,
          status: dockWalk.status,
          startedAt: dockWalk.startedAt,
          completedAt: dockWalk.completedAt,
        },
        slips: walkList,
      });
    } catch (err) {
      next(err);
    }
  },
);

// ─── POST / — Start a new dock walk ────────────────────────────────────────

router.post(
  "/",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const data = CreateDockWalkSchema.parse(req.body);

      const dockWalk = await prisma.dockWalk.create({
        data: {
          tenantId,
          inspectorId: data.inspectorId,
          dockId: data.dockId ?? null,
          status: "IN_PROGRESS",
          startedAt: new Date(),
        },
      });

      await prisma.auditLog.create({
        data: {
          tenantId,
          userId: req.userId,
          userName: req.userRecord?.email,
          recordType: "DockWalk",
          recordId: dockWalk.id,
          action: "CREATED",
        },
      });

      res.status(201).json(dockWalk);
    } catch (err) {
      next(err);
    }
  },
);

// ─── PUT /:id — Update dock walk ───────────────────────────────────────────

router.put(
  "/:id",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const data = UpdateDockWalkSchema.parse(req.body);

      const existing = await prisma.dockWalk.findFirst({
        where: { id: req.params.id, tenantId },
      });
      if (!existing) {
        throw appError("Dock walk not found", 404, "NOT_FOUND");
      }

      const updateData: Record<string, unknown> = {};
      if (data.notes !== undefined) updateData.notes = data.notes;
      if (data.status !== undefined) updateData.status = data.status;
      if (data.dockId !== undefined) updateData.dockId = data.dockId;

      const updated = await prisma.dockWalk.update({
        where: { id: req.params.id },
        data: updateData,
      });

      await prisma.auditLog.create({
        data: {
          tenantId,
          userId: req.userId,
          userName: req.userRecord?.email,
          recordType: "DockWalk",
          recordId: updated.id,
          action: "UPDATED",
          changedFieldsJson: updateData,
        },
      });

      res.json(updated);
    } catch (err) {
      next(err);
    }
  },
);

// ─── POST /:id/items — Add item to dock walk ───────────────────────────────

router.post(
  "/:id/items",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const data = CreateDockWalkItemSchema.parse(req.body);

      const dockWalk = await prisma.dockWalk.findFirst({
        where: { id: req.params.id, tenantId },
      });
      if (!dockWalk) {
        throw appError("Dock walk not found", 404, "NOT_FOUND");
      }

      if (dockWalk.status === "COMPLETED") {
        throw appError(
          "Cannot add items to a completed dock walk",
          400,
          "WALK_COMPLETED",
        );
      }

      // Store check flags in photoUrls JSON for extensibility
      const checkFlags: Record<string, unknown> = {};
      if (data.lineCheck !== undefined) checkFlags.lineCheck = data.lineCheck;
      if (data.powerCheck !== undefined) checkFlags.powerCheck = data.powerCheck;
      if (data.bilgeCheck !== undefined) checkFlags.bilgeCheck = data.bilgeCheck;
      if (data.boatCondition !== undefined) checkFlags.boatCondition = data.boatCondition;

      const item = await prisma.dockWalkItem.create({
        data: {
          dockWalkId: dockWalk.id,
          slipId: data.slipId ?? null,
          status: data.status,
          notes: data.notes ?? null,
          violationType: data.violationType ?? null,
          photoUrls: (data.photoUrls ?? null) as any,
          feeCents: data.feeCents ?? null,
          boatPresent: data.boatPresent ?? null,
          expectedMatch: data.expectedMatch ?? null,
          expectedBoatId: data.expectedBoatId ?? null,
        },
      });

      res.status(201).json(item);
    } catch (err) {
      next(err);
    }
  },
);

// ─── PUT /:id/items/:itemId — Update a dock walk item ──────────────────────

router.put(
  "/:id/items/:itemId",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const data = UpdateDockWalkItemSchema.parse(req.body);

      const dockWalk = await prisma.dockWalk.findFirst({
        where: { id: req.params.id, tenantId },
      });
      if (!dockWalk) {
        throw appError("Dock walk not found", 404, "NOT_FOUND");
      }

      const existingItem = await prisma.dockWalkItem.findFirst({
        where: { id: req.params.itemId, dockWalkId: dockWalk.id },
      });
      if (!existingItem) {
        throw appError("Dock walk item not found", 404, "NOT_FOUND");
      }

      const updateData: Record<string, unknown> = {};
      if (data.status !== undefined) updateData.status = data.status;
      if (data.notes !== undefined) updateData.notes = data.notes;
      if (data.violationType !== undefined) updateData.violationType = data.violationType;
      if (data.photoUrls !== undefined) updateData.photoUrls = data.photoUrls;
      if (data.feeCents !== undefined) updateData.feeCents = data.feeCents;
      if (data.boatPresent !== undefined) updateData.boatPresent = data.boatPresent;
      if (data.expectedMatch !== undefined) updateData.expectedMatch = data.expectedMatch;
      if (data.expectedBoatId !== undefined) updateData.expectedBoatId = data.expectedBoatId;

      const updated = await prisma.dockWalkItem.update({
        where: { id: req.params.itemId },
        data: updateData,
      });

      res.json(updated);
    } catch (err) {
      next(err);
    }
  },
);

// ─── POST /:id/complete — Mark dock walk as completed ───────────────────────

router.post(
  "/:id/complete",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;

      const dockWalk = await prisma.dockWalk.findFirst({
        where: { id: req.params.id, tenantId },
        include: { items: true },
      });
      if (!dockWalk) {
        throw appError("Dock walk not found", 404, "NOT_FOUND");
      }

      if (dockWalk.status === "COMPLETED") {
        throw appError("Dock walk is already completed", 400, "ALREADY_COMPLETED");
      }

      const updated = await prisma.dockWalk.update({
        where: { id: req.params.id },
        data: {
          status: "COMPLETED",
          completedAt: new Date(),
        },
        include: { items: true },
      });

      await prisma.auditLog.create({
        data: {
          tenantId,
          userId: req.userId,
          userName: req.userRecord?.email,
          recordType: "DockWalk",
          recordId: updated.id,
          action: "COMPLETED",
          changedFieldsJson: {
            itemsChecked: updated.items.length,
            issuesFound: updated.items.filter(
              (i) => i.status === "VIOLATION" || i.status === "NEEDS_ATTENTION",
            ).length,
          },
        },
      });

      res.json(updated);
    } catch (err) {
      next(err);
    }
  },
);

export default router;
