import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { clerkAuth } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";
import { deleteFile as deleteFileFromStorage } from "../lib/storage.js";
import {
  calculateBoatCompliance,
  computeBoatCompliance,
  getExpiringCompliance,
} from "../services/compliance.js";

const router: Router = Router();

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
  // `insuranceExpiry` is not a column on `boats`; the route sorts by it in
  // application code. All other options map to real columns on the model.
  sortBy: z
    .enum([
      "createdAt",
      "updatedAt",
      "name",
      "lengthFt",
      "make",
      "registrationExpiry",
      "insuranceExpiry",
    ])
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

      // `insuranceExpiry` is not a column on `boats`, so defer ordering to
      // application code in that case. Otherwise let the DB sort.
      const dbOrderBy =
        query.sortBy === "insuranceExpiry"
          ? { name: query.sortOrder }
          : { [query.sortBy]: query.sortOrder };

      const [boats, total] = await Promise.all([
        prisma.boat.findMany({
          where,
          orderBy: dbOrderBy,
          // When a compliance filter is applied we have to post-filter, so
          // skip/take are applied after filtering instead of by the DB.
          skip: query.complianceStatus ? undefined : query.skip,
          take: query.complianceStatus ? undefined : query.take,
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
            slipContracts: {
              where: { status: "ACTIVE" },
              include: {
                slip: { select: { id: true, slipNumber: true } },
              },
              orderBy: { startDate: "desc" },
            },
          },
        }),
        prisma.boat.count({ where }),
      ]);

      // Always compute compliance using the same scoring as the customer
      // detail page so the Boats list and detail views stay in sync.
      let enrichedBoats = boats.map((b) => ({
        ...b,
        compliance: computeBoatCompliance(b),
      }));

      if (query.complianceStatus) {
        enrichedBoats = enrichedBoats.filter(
          (b) => b.compliance.overallScore === query.complianceStatus,
        );
      }

      // Application-side sort for insurance expiry (latest insurance record).
      if (query.sortBy === "insuranceExpiry") {
        const dir = query.sortOrder === "asc" ? 1 : -1;
        enrichedBoats = [...enrichedBoats].sort((a, b) => {
          const ax = a.insuranceRecords[0]?.expiryDate?.getTime() ?? null;
          const bx = b.insuranceRecords[0]?.expiryDate?.getTime() ?? null;
          // Nulls always sort last regardless of direction.
          if (ax === null && bx === null) return 0;
          if (ax === null) return 1;
          if (bx === null) return -1;
          return (ax - bx) * dir;
        });
      }

      const totalCount = query.complianceStatus ? enrichedBoats.length : total;
      const pagedBoats = query.complianceStatus
        ? enrichedBoats.slice(query.skip, query.skip + query.take)
        : enrichedBoats;

      res.json({
        data: pagedBoats,
        pagination: {
          skip: query.skip,
          take: query.take,
          total: totalCount,
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

// ─── Boat Photos ────────────────────────────────────────────────────────────
//
// Photo bytes live in R2 under `${tenantId}/boats/...`, uploaded directly
// from the browser via the existing presign flow. These routes only manage
// the metadata rows that link a stored object back to a boat.

const BOAT_PHOTO_MAX_BYTES = 10 * 1024 * 1024;
const BOAT_PHOTO_ALLOWED_MIME = ["image/png", "image/jpeg", "image/webp"] as const;

const CreateBoatPhotoSchema = z.object({
  filename: z.string().min(1).max(255),
  contentType: z.enum(BOAT_PHOTO_ALLOWED_MIME),
  sizeBytes: z.number().int().nonnegative().max(BOAT_PHOTO_MAX_BYTES),
  storageKey: z.string().min(1).max(512),
});

router.get(
  "/:id/photos",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const boat = await prisma.boat.findFirst({
        where: { id: req.params.id, tenantId },
        select: { id: true },
      });
      if (!boat) throw appError("Boat not found", 404, "NOT_FOUND");

      const photos = await prisma.boatPhoto.findMany({
        where: { boatId: req.params.id, tenantId },
        orderBy: { createdAt: "desc" },
      });
      res.json(photos);
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/:id/photos",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const body = CreateBoatPhotoSchema.parse(req.body);

      // Presigned uploads for boat photos always land under
      // `${tenantId}/boats/...`. Reject anything outside that prefix so a
      // client can't attach an object that was signed for a different
      // category (documents, insurance, etc.).
      if (!body.storageKey.startsWith(`${tenantId}/boats/`)) {
        throw appError("Invalid storage key", 400, "INVALID_STORAGE_KEY");
      }

      const boat = await prisma.boat.findFirst({
        where: { id: req.params.id, tenantId },
        select: { id: true },
      });
      if (!boat) throw appError("Boat not found", 404, "NOT_FOUND");

      const photo = await prisma.boatPhoto.create({
        data: {
          tenantId,
          boatId: req.params.id,
          filename: body.filename,
          contentType: body.contentType,
          sizeBytes: body.sizeBytes,
          storageKey: body.storageKey,
          uploadedById: req.userId ?? null,
        },
      });

      res.status(201).json(photo);
    } catch (err) {
      next(err);
    }
  },
);

router.delete(
  "/:id/photos/:photoId",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const { id: boatId, photoId } = req.params;

      const photo = await prisma.boatPhoto.findFirst({
        where: { id: photoId, boatId, tenantId },
      });
      if (!photo) throw appError("Photo not found", 404, "NOT_FOUND");

      await prisma.boatPhoto.delete({ where: { id: photoId } });
      // Best-effort R2 cleanup so the object doesn't outlive its metadata
      // even when the caller skips the client-side cleanup step.
      await deleteFileFromStorage(photo.storageKey).catch((err) => {
        console.warn("[boat-photo] R2 cleanup failed", {
          storageKey: photo.storageKey,
          error: err instanceof Error ? err.message : err,
        });
      });
      res.json({ success: true });
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
