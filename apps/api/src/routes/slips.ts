import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { clerkAuth } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";

const router = Router();

// ─── Zod Schemas ─────────────────────────────────────────────────────────────

const SlipStatusEnum = z.enum(["VACANT", "OCCUPIED", "MAINTENANCE", "RESERVED"]);
const ElectricityModeEnum = z.enum(["FLAT_FEE", "METERED"]);

const CreateSlipSchema = z.object({
  slipNumber: z.string().min(1),
  dockId: z.string().optional().nullable(),
  lengthFt: z.number().positive(),
  beamFt: z.number().positive().optional().nullable(),
  depthFt: z.number().positive().optional().nullable(),
  slipType: z.string().optional().nullable(),
  shorePower: z.string().optional().nullable(),
  transientCapable: z.boolean().optional(),
  electricityMode: ElectricityModeEnum.optional(),
  flatFeeCents: z.number().int().optional().nullable(),
  kwhRateCents: z.number().int().optional().nullable(),
});

const UpdateSlipSchema = z.object({
  slipNumber: z.string().min(1).optional(),
  dockId: z.string().optional().nullable(),
  lengthFt: z.number().positive().optional(),
  beamFt: z.number().positive().optional().nullable(),
  depthFt: z.number().positive().optional().nullable(),
  slipType: z.string().optional().nullable(),
  shorePower: z.string().optional().nullable(),
  status: SlipStatusEnum.optional(),
  transientCapable: z.boolean().optional(),
  electricityMode: ElectricityModeEnum.optional(),
  flatFeeCents: z.number().int().optional().nullable(),
  kwhRateCents: z.number().int().optional().nullable(),
});

const ListSlipsQuerySchema = z.object({
  status: SlipStatusEnum.optional(),
  dockId: z.string().optional(),
  slipType: z.string().optional(),
  transientCapable: z.coerce.boolean().optional(),
  electricityMode: ElectricityModeEnum.optional(),
  skip: z.coerce.number().int().min(0).default(0),
  take: z.coerce.number().int().positive().max(200).default(50),
  sortBy: z
    .enum(["slipNumber", "lengthFt", "status"])
    .default("slipNumber"),
  sortOrder: z.enum(["asc", "desc"]).default("asc"),
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

// ─── GET /dock-map — Visual dock map data ───────────────────────────────────
// Registered before /:id so Express doesn't treat "dock-map" as a UUID param.

router.get(
  "/dock-map",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;

      const slips = await prisma.slip.findMany({
        where: { tenantId },
        include: {
          contracts: {
            where: { status: "ACTIVE" },
            include: {
              customer: {
                select: { id: true, firstName: true, lastName: true },
              },
              boat: {
                select: {
                  id: true,
                  name: true,
                  lengthFt: true,
                  beamFt: true,
                },
              },
            },
            take: 1,
          },
          dockWalkItems: {
            orderBy: { dockWalk: { startedAt: "desc" } },
            take: 1,
            include: {
              dockWalk: {
                select: { startedAt: true, status: true },
              },
            },
          },
        },
        orderBy: { slipNumber: "asc" },
      });

      // Build compliance overlay — check active boats' compliance
      const mapData = await Promise.all(
        slips.map(async (slip) => {
          const activeContract = slip.contracts[0] ?? null;
          const lastDockWalk = slip.dockWalkItems[0] ?? null;

          let boatCompliance: string | null = null;
          if (activeContract?.boat) {
            const boat = await prisma.boat.findUnique({
              where: { id: activeContract.boat.id },
              include: {
                insuranceRecords: {
                  orderBy: { expiryDate: "desc" },
                  take: 1,
                },
              },
            });
            const now = new Date();
            if (boat) {
              const latestIns = boat.insuranceRecords[0];
              if (!latestIns) {
                boatCompliance = "NON_COMPLIANT";
              } else if (latestIns.expiryDate && latestIns.expiryDate < now) {
                boatCompliance = "ATTENTION_REQUIRED";
              } else {
                boatCompliance = "ALL_GOOD";
              }
            }
          }

          return {
            id: slip.id,
            slipNumber: slip.slipNumber,
            dockId: slip.dockId,
            lengthFt: slip.lengthFt,
            beamFt: slip.beamFt,
            status: slip.status,
            slipType: slip.slipType,
            shorePower: slip.shorePower,
            transientCapable: slip.transientCapable,
            occupant: activeContract
              ? {
                  contractId: activeContract.id,
                  customer: activeContract.customer,
                  boat: activeContract.boat,
                }
              : null,
            boatCompliance,
            lastDockWalk: lastDockWalk
              ? {
                  status: lastDockWalk.status,
                  date: lastDockWalk.dockWalk.startedAt,
                  notes: lastDockWalk.notes,
                }
              : null,
          };
        }),
      );

      res.json({ data: mapData });
    } catch (err) {
      next(err);
    }
  },
);

// ─── GET / — List slips ─────────────────────────────────────────────────────

router.get(
  "/",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const query = ListSlipsQuerySchema.parse(req.query);

      const where: Record<string, unknown> = { tenantId };

      if (query.status) where.status = query.status;
      if (query.dockId) where.dockId = query.dockId;
      if (query.slipType) where.slipType = query.slipType;
      if (query.transientCapable !== undefined)
        where.transientCapable = query.transientCapable;
      if (query.electricityMode) where.electricityMode = query.electricityMode;

      const [slips, total] = await Promise.all([
        prisma.slip.findMany({
          where,
          orderBy: { [query.sortBy]: query.sortOrder },
          skip: query.skip,
          take: query.take,
          include: {
            contracts: {
              where: { status: "ACTIVE" },
              include: {
                customer: {
                  select: { id: true, firstName: true, lastName: true },
                },
                boat: {
                  select: { id: true, name: true, lengthFt: true },
                },
              },
              take: 1,
            },
          },
        }),
        prisma.slip.count({ where }),
      ]);

      // Flatten current occupant
      const data = slips.map((slip) => ({
        ...slip,
        currentOccupant: slip.contracts[0] ?? null,
        contracts: undefined,
      }));

      res.json({
        data,
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

// ─── GET /:id — Get single slip ─────────────────────────────────────────────

router.get(
  "/:id",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;

      const slip = await prisma.slip.findFirst({
        where: { id: req.params.id, tenantId },
        include: {
          contracts: {
            include: {
              customer: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  email: true,
                },
              },
              boat: {
                select: { id: true, name: true, lengthFt: true, beamFt: true },
              },
            },
            orderBy: { startDate: "desc" },
          },
          meterReadings: {
            orderBy: { readingDate: "desc" },
            take: 12,
          },
          dockWalkItems: {
            include: {
              dockWalk: {
                select: {
                  id: true,
                  inspectorId: true,
                  startedAt: true,
                  status: true,
                },
              },
            },
            orderBy: { dockWalk: { startedAt: "desc" } },
            take: 20,
          },
        },
      });

      if (!slip) {
        throw appError("Slip not found", 404, "NOT_FOUND");
      }

      // Separate current vs historical contracts
      const currentContract =
        slip.contracts.find((c) => c.status === "ACTIVE") ?? null;

      res.json({
        ...slip,
        currentContract,
      });
    } catch (err) {
      next(err);
    }
  },
);

// ─── POST / — Create slip ───────────────────────────────────────────────────

router.post(
  "/",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const data = CreateSlipSchema.parse(req.body);

      // Check for duplicate slip number in tenant
      const existing = await prisma.slip.findFirst({
        where: { tenantId, slipNumber: data.slipNumber },
        select: { id: true },
      });
      if (existing) {
        throw appError(
          `Slip number "${data.slipNumber}" already exists`,
          409,
          "DUPLICATE_SLIP_NUMBER",
        );
      }

      const slip = await prisma.slip.create({
        data: {
          tenantId,
          ...data,
        },
      });

      await prisma.auditLog.create({
        data: {
          tenantId,
          userId: req.userId,
          recordType: "Slip",
          recordId: slip.id,
          action: "CREATED",
        },
      });

      res.status(201).json(slip);
    } catch (err) {
      next(err);
    }
  },
);

// ─── PUT /:id — Update slip ────────────────────────────────────────────────

router.put(
  "/:id",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const data = UpdateSlipSchema.parse(req.body);

      const existing = await prisma.slip.findFirst({
        where: { id: req.params.id, tenantId },
      });
      if (!existing) {
        throw appError("Slip not found", 404, "NOT_FOUND");
      }

      // If changing slip number, check for duplicates
      if (data.slipNumber && data.slipNumber !== existing.slipNumber) {
        const duplicate = await prisma.slip.findFirst({
          where: {
            tenantId,
            slipNumber: data.slipNumber,
            id: { not: req.params.id },
          },
          select: { id: true },
        });
        if (duplicate) {
          throw appError(
            `Slip number "${data.slipNumber}" already exists`,
            409,
            "DUPLICATE_SLIP_NUMBER",
          );
        }
      }

      const updated = await prisma.slip.update({
        where: { id: req.params.id },
        data,
      });

      const changedFields: Record<string, unknown> = {};
      for (const key of Object.keys(data) as (keyof typeof data)[]) {
        if (data[key] !== undefined) {
          changedFields[key] = {
            from: (existing as Record<string, unknown>)[key],
            to: data[key],
          };
        }
      }

      await prisma.auditLog.create({
        data: {
          tenantId,
          userId: req.userId,
          recordType: "Slip",
          recordId: updated.id,
          action: "UPDATED",
          changedFieldsJson: changedFields,
        },
      });

      res.json(updated);
    } catch (err) {
      next(err);
    }
  },
);

// ─── DELETE /:id — Remove slip (only if VACANT) ────────────────────────────

router.delete(
  "/:id",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;

      const slip = await prisma.slip.findFirst({
        where: { id: req.params.id, tenantId },
      });
      if (!slip) {
        throw appError("Slip not found", 404, "NOT_FOUND");
      }

      if (slip.status !== "VACANT") {
        throw appError(
          `Cannot delete slip with status "${slip.status}". Slip must be VACANT.`,
          400,
          "SLIP_NOT_VACANT",
        );
      }

      // Also ensure no active/draft contracts
      const activeContracts = await prisma.slipContract.count({
        where: {
          slipId: req.params.id,
          tenantId,
          status: { in: ["ACTIVE", "DRAFT"] },
        },
      });
      if (activeContracts > 0) {
        throw appError(
          "Cannot delete slip with active contracts",
          400,
          "HAS_ACTIVE_CONTRACTS",
        );
      }

      await prisma.slip.delete({
        where: { id: req.params.id },
      });

      await prisma.auditLog.create({
        data: {
          tenantId,
          userId: req.userId,
          recordType: "Slip",
          recordId: req.params.id,
          action: "DELETED",
        },
      });

      res.json({ success: true, message: "Slip deleted" });
    } catch (err) {
      next(err);
    }
  },
);

// ─── POST /:id/qr-code — Generate QR code URL ─────────────────────────────

router.post(
  "/:id/qr-code",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;

      const slip = await prisma.slip.findFirst({
        where: { id: req.params.id, tenantId },
      });
      if (!slip) {
        throw appError("Slip not found", 404, "NOT_FOUND");
      }

      // Generate a deterministic QR code URL using the slip ID
      // In production this would call a QR code generation service
      const baseUrl = process.env.APP_BASE_URL ?? "https://app.helmhq.com";
      const qrCodeUrl = `${baseUrl}/qr/slip/${slip.id}`;

      const updated = await prisma.slip.update({
        where: { id: req.params.id },
        data: { qrCodeUrl },
      });

      await prisma.auditLog.create({
        data: {
          tenantId,
          userId: req.userId,
          recordType: "Slip",
          recordId: updated.id,
          action: "QR_CODE_GENERATED",
        },
      });

      res.json({ qrCodeUrl: updated.qrCodeUrl });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
