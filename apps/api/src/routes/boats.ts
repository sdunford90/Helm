import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { clerkAuth } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";
import {
  calculateBoatCompliance,
  getExpiringCompliance,
} from "../services/compliance.js";

const router = Router();

// ─── Zod Schemas ─────────────────────────────────────────────────────────────

const CreateBoatSchema = z.object({
  customerId: z.string().uuid(),
  name: z.string().optional().nullable(),
  registrationNumber: z.string().optional().nullable(),
  registrationState: z.string().optional().nullable(),
  registrationExpiry: z.coerce.date().optional().nullable(),
  hin: z.string().optional().nullable(),
  make: z.string().optional().nullable(),
  model: z.string().optional().nullable(),
  year: z.number().int().optional().nullable(),
  lengthFt: z.number().positive(),
  beamFt: z.number().positive().optional().nullable(),
  draftFt: z.number().positive().optional().nullable(),
  fuelType: z.string().optional().nullable(),
  engineCount: z.number().int().optional().nullable(),
  engineHp: z.number().int().optional().nullable(),
});

const UpdateBoatSchema = z.object({
  customerId: z.string().uuid().optional(),
  name: z.string().optional().nullable(),
  registrationNumber: z.string().optional().nullable(),
  registrationState: z.string().optional().nullable(),
  registrationExpiry: z.coerce.date().optional().nullable(),
  hin: z.string().optional().nullable(),
  make: z.string().optional().nullable(),
  model: z.string().optional().nullable(),
  year: z.number().int().optional().nullable(),
  lengthFt: z.number().positive().optional(),
  beamFt: z.number().positive().optional().nullable(),
  draftFt: z.number().positive().optional().nullable(),
  fuelType: z.string().optional().nullable(),
  engineCount: z.number().int().optional().nullable(),
  engineHp: z.number().int().optional().nullable(),
});

const ListBoatsQuerySchema = z.object({
  customerId: z.string().uuid().optional(),
  complianceStatus: z
    .enum(["ALL_GOOD", "ATTENTION_REQUIRED", "NON_COMPLIANT"])
    .optional(),
  skip: z.coerce.number().int().min(0).default(0),
  take: z.coerce.number().int().positive().max(100).default(25),
  sortBy: z
    .enum(["createdAt", "name", "lengthFt", "make"])
    .default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

const SafetyInspectionSchema = z.object({
  fireExtCount: z.number().int().optional().nullable(),
  fireExtExpiry: z.coerce.date().optional().nullable(),
  lifeJacketCount: z.number().int().optional().nullable(),
  flareExpiry: z.coerce.date().optional().nullable(),
  hasHorn: z.boolean().optional().nullable(),
  hasThrowable: z.boolean().optional().nullable(),
  passFail: z.enum(["PASS", "FAIL"]),
  notes: z.string().optional().nullable(),
  nextDueDate: z.coerce.date().optional().nullable(),
});

const ComplianceExpiringQuerySchema = z.object({
  days: z.coerce.number().int().positive().default(30),
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

// ─── GET / — List boats ─────────────────────────────────────────────────────

router.get(
  "/",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const query = ListBoatsQuerySchema.parse(req.query);

      const where: Record<string, unknown> = { tenantId };
      if (query.customerId) where.customerId = query.customerId;

      const [boats, total] = await Promise.all([
        prisma.boat.findMany({
          where,
          orderBy: { [query.sortBy]: query.sortOrder },
          skip: query.skip,
          take: query.take,
          include: {
            customer: {
              select: { id: true, firstName: true, lastName: true },
            },
            insuranceRecords: {
              orderBy: { expiryDate: "desc" },
              take: 1,
            },
            safetyRecords: {
              orderBy: { inspectionDate: "desc" },
              take: 1,
            },
          },
        }),
        prisma.boat.count({ where }),
      ]);

      // If compliance filter is applied, compute compliance per boat and filter
      let filteredBoats = boats;
      if (query.complianceStatus) {
        const boatsWithCompliance = await Promise.all(
          boats.map(async (boat) => {
            const compliance = await calculateBoatCompliance(boat.id, tenantId);
            return { ...boat, compliance };
          }),
        );
        filteredBoats = boatsWithCompliance.filter(
          (b) => b.compliance.overallScore === query.complianceStatus,
        );
      }

      res.json({
        data: filteredBoats,
        pagination: {
          skip: query.skip,
          take: query.take,
          total: query.complianceStatus ? filteredBoats.length : total,
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

// ─── GET /expiring-compliance — Items expiring within N days ────────────────

router.get(
  "/expiring-compliance",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const { days } = ComplianceExpiringQuerySchema.parse(req.query);

      const result = await getExpiringCompliance(tenantId, days);

      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

// ─── GET /:id — Get single boat ─────────────────────────────────────────────

router.get(
  "/:id",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;

      const boat = await prisma.boat.findFirst({
        where: { id: req.params.id, tenantId },
        include: {
          customer: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
          insuranceRecords: {
            orderBy: { expiryDate: "desc" },
          },
          safetyRecords: {
            orderBy: { inspectionDate: "desc" },
          },
          slipContracts: {
            include: {
              slip: { select: { id: true, slipNumber: true } },
            },
            orderBy: { startDate: "desc" },
          },
        },
      });

      if (!boat) {
        throw appError("Boat not found", 404, "NOT_FOUND");
      }

      // Calculate compliance score
      const compliance = await calculateBoatCompliance(boat.id, tenantId);

      res.json({ ...boat, compliance });
    } catch (err) {
      next(err);
    }
  },
);

// ─── POST / — Create boat ───────────────────────────────────────────────────

router.post(
  "/",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const data = CreateBoatSchema.parse(req.body);

      // Verify customer exists in this tenant
      const customer = await prisma.customer.findFirst({
        where: { id: data.customerId, tenantId },
        select: { id: true },
      });
      if (!customer) {
        throw appError("Customer not found", 404, "CUSTOMER_NOT_FOUND");
      }

      const boat = await prisma.boat.create({
        data: {
          tenantId,
          ...data,
        },
      });

      await prisma.auditLog.create({
        data: {
          tenantId,
          userId: req.userId,
          recordType: "Boat",
          recordId: boat.id,
          action: "CREATED",
        },
      });

      res.status(201).json(boat);
    } catch (err) {
      next(err);
    }
  },
);

// ─── PUT /:id — Update boat ────────────────────────────────────────────────

router.put(
  "/:id",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const data = UpdateBoatSchema.parse(req.body);

      const existing = await prisma.boat.findFirst({
        where: { id: req.params.id, tenantId },
      });
      if (!existing) {
        throw appError("Boat not found", 404, "NOT_FOUND");
      }

      // If changing customer, verify new customer exists
      if (data.customerId) {
        const customer = await prisma.customer.findFirst({
          where: { id: data.customerId, tenantId },
          select: { id: true },
        });
        if (!customer) {
          throw appError("Customer not found", 404, "CUSTOMER_NOT_FOUND");
        }
      }

      const updated = await prisma.boat.update({
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
          recordType: "Boat",
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

// ─── DELETE /:id — Remove boat ──────────────────────────────────────────────

router.delete(
  "/:id",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;

      const boat = await prisma.boat.findFirst({
        where: { id: req.params.id, tenantId },
        include: {
          slipContracts: {
            where: { status: { in: ["ACTIVE", "DRAFT"] } },
            select: { id: true },
          },
        },
      });
      if (!boat) {
        throw appError("Boat not found", 404, "NOT_FOUND");
      }

      if (boat.slipContracts.length > 0) {
        throw appError(
          "Cannot delete a boat with active contracts",
          400,
          "HAS_ACTIVE_CONTRACTS",
        );
      }

      await prisma.boat.delete({
        where: { id: req.params.id },
      });

      await prisma.auditLog.create({
        data: {
          tenantId,
          userId: req.userId,
          recordType: "Boat",
          recordId: req.params.id,
          action: "DELETED",
        },
      });

      res.json({ success: true, message: "Boat deleted" });
    } catch (err) {
      next(err);
    }
  },
);

// ─── GET /:id/compliance — Compliance score ────────────────────────────────

router.get(
  "/:id/compliance",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;

      const boat = await prisma.boat.findFirst({
        where: { id: req.params.id, tenantId },
        select: { id: true },
      });
      if (!boat) {
        throw appError("Boat not found", 404, "NOT_FOUND");
      }

      const compliance = await calculateBoatCompliance(req.params.id, tenantId);

      res.json(compliance);
    } catch (err) {
      next(err);
    }
  },
);

// ─── POST /:id/safety-inspection — Record safety inspection ────────────────

router.post(
  "/:id/safety-inspection",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const data = SafetyInspectionSchema.parse(req.body);

      const boat = await prisma.boat.findFirst({
        where: { id: req.params.id, tenantId },
        select: { id: true },
      });
      if (!boat) {
        throw appError("Boat not found", 404, "NOT_FOUND");
      }

      const record = await prisma.vesselSafetyRecord.create({
        data: {
          tenantId,
          boatId: req.params.id,
          inspectionDate: new Date(),
          inspectorId: req.userId,
          ...data,
        },
      });

      await prisma.auditLog.create({
        data: {
          tenantId,
          userId: req.userId,
          recordType: "VesselSafetyRecord",
          recordId: record.id,
          action: "CREATED",
          changedFieldsJson: { boatId: req.params.id, passFail: data.passFail },
        },
      });

      res.status(201).json(record);
    } catch (err) {
      next(err);
    }
  },
);

export default router;
