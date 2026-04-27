import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { clerkAuth, requireRole } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";
import {
  parseInsuranceDocument,
  validateCoverage,
  processInsuranceUpload,
} from "../services/insurance-ai.js";

const router: Router = Router();

// ─── Zod Schemas ─────────────────────────────────────────────────────────────

const UploadSchema = z.object({
  documentUrl: z.string().url(),
  documentText: z.string().min(1, "Document text is required"),
  customerId: z.string().uuid(),
  boatId: z.string().uuid().optional().default(""),
});

const ReviewSchema = z.object({
  status: z.enum(["APPROVED", "REJECTED"]),
  insurer: z.string().optional().nullable(),
  policyNumber: z.string().optional().nullable(),
  startDate: z.coerce.date().optional().nullable(),
  expiryDate: z.coerce.date().optional().nullable(),
  coverageLimits: z
    .object({
      bodilyInjury: z.number().optional().nullable(),
      propertyDamage: z.number().optional().nullable(),
      medicalPayments: z.number().optional().nullable(),
      generalAggregate: z.number().optional().nullable(),
    })
    .optional(),
  notes: z.string().optional().nullable(),
});

const CustomerParamsSchema = z.object({
  customerId: z.string().uuid(),
});

const IdParamsSchema = z.object({
  id: z.string().uuid(),
});

const ComplianceQuerySchema = z.object({
  days: z.coerce.number().int().positive().default(30),
});

const ReviewQueueQuerySchema = z.object({
  skip: z.coerce.number().int().min(0).default(0),
  take: z.coerce.number().int().positive().max(100).default(25),
});

const ManualInsuranceSchema = z.object({
  customerId: z.string().uuid(),
  boatId: z.string().uuid().optional().nullable(),
  insurer: z.string().optional().nullable(),
  policyNumber: z.string().optional().nullable(),
  startDate: z.coerce.date().optional().nullable(),
  expiryDate: z.coerce.date().optional().nullable(),
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

// ─── POST / — Upload and parse insurance document ───────────────────────────

router.post(
  "/upload",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const data = UploadSchema.parse(req.body);

      // Verify customer exists in this tenant
      const customer = await prisma.customer.findFirst({
        where: { id: data.customerId, tenantId },
        select: { id: true },
      });
      if (!customer) {
        throw appError("Customer not found", 404, "CUSTOMER_NOT_FOUND");
      }

      // Verify boat exists in this tenant (if provided)
      if (data.boatId) {
        const boat = await prisma.boat.findFirst({
          where: { id: data.boatId, tenantId },
          select: { id: true },
        });
        if (!boat) {
          throw appError("Boat not found", 404, "BOAT_NOT_FOUND");
        }
      }

      const recordId = await processInsuranceUpload(
        data.documentUrl,
        data.documentText,
        data.customerId,
        data.boatId,
        tenantId,
      );

      // Fetch the created record to return full details
      const record = await prisma.insuranceRecord.findUnique({
        where: { id: recordId },
        include: {
          customer: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
          boat: {
            select: { id: true, name: true, make: true, model: true },
          },
        },
      });

      res.status(201).json(record);
    } catch (err) {
      next(err);
    }
  },
);

// ─── POST /manual — Create insurance record without document upload ──────────

router.post(
  "/manual",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const data = ManualInsuranceSchema.parse(req.body);

      const customer = await prisma.customer.findFirst({
        where: { id: data.customerId, tenantId },
        select: { id: true },
      });
      if (!customer) {
        throw appError("Customer not found", 404, "CUSTOMER_NOT_FOUND");
      }

      if (data.boatId) {
        const boat = await prisma.boat.findFirst({
          where: { id: data.boatId, tenantId },
          select: { id: true },
        });
        if (!boat) {
          throw appError("Boat not found", 404, "BOAT_NOT_FOUND");
        }
      }

      const record = await prisma.insuranceRecord.create({
        data: {
          tenantId,
          customerId: data.customerId,
          boatId: data.boatId ?? null,
          insurer: data.insurer ?? null,
          policyNumber: data.policyNumber ?? null,
          startDate: data.startDate ?? null,
          expiryDate: data.expiryDate ?? null,
          status: "APPROVED",
        },
      });

      res.status(201).json(record);
    } catch (err) {
      next(err);
    }
  },
);

// ─── GET /customer/:customerId — All insurance records for a customer ───────

router.get(
  "/customer/:customerId",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const { customerId } = CustomerParamsSchema.parse(req.params);

      // Verify customer exists in this tenant
      const customer = await prisma.customer.findFirst({
        where: { id: customerId, tenantId },
        select: { id: true },
      });
      if (!customer) {
        throw appError("Customer not found", 404, "CUSTOMER_NOT_FOUND");
      }

      const records = await prisma.insuranceRecord.findMany({
        where: { customerId, tenantId },
        orderBy: { expiryDate: "desc" },
        include: {
          boat: {
            select: { id: true, name: true, make: true, model: true },
          },
        },
      });

      res.json({ data: records });
    } catch (err) {
      next(err);
    }
  },
);

// ─── GET /compliance — Compliance dashboard data ────────────────────────────

router.get(
  "/compliance",
  requireRole("admin", "manager"),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const { days } = ComplianceQuerySchema.parse(req.query);

      const now = new Date();
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() + days);

      // Count by status
      const [compliant, pendingReview, expired, expiringSoon, total] =
        await Promise.all([
          prisma.insuranceRecord.count({
            where: {
              tenantId,
              status: "APPROVED",
              expiryDate: { gt: cutoff },
            },
          }),
          prisma.insuranceRecord.count({
            where: { tenantId, status: "PENDING_REVIEW" },
          }),
          prisma.insuranceRecord.count({
            where: {
              tenantId,
              OR: [
                { status: "EXPIRED" },
                {
                  status: "APPROVED",
                  expiryDate: { lt: now },
                },
              ],
            },
          }),
          prisma.insuranceRecord.count({
            where: {
              tenantId,
              status: "APPROVED",
              expiryDate: { gte: now, lte: cutoff },
            },
          }),
          prisma.insuranceRecord.count({
            where: { tenantId },
          }),
        ]);

      // Upcoming expirations with details
      const upcomingExpirations = await prisma.insuranceRecord.findMany({
        where: {
          tenantId,
          status: "APPROVED",
          expiryDate: { gte: now, lte: cutoff },
        },
        orderBy: { expiryDate: "asc" },
        take: 20,
        include: {
          customer: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
          boat: {
            select: { id: true, name: true },
          },
        },
      });

      const expirations = upcomingExpirations.map((r) => ({
        id: r.id,
        customer: r.customer,
        boat: r.boat,
        insurer: r.insurer,
        policyNumber: r.policyNumber,
        expiryDate: r.expiryDate,
        daysUntilExpiry: r.expiryDate
          ? Math.ceil(
              (r.expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
            )
          : null,
      }));

      res.json({
        summary: {
          total,
          compliant,
          expiringSoon,
          expired,
          pendingReview,
        },
        upcomingExpirations: expirations,
      });
    } catch (err) {
      next(err);
    }
  },
);

// ─── GET /review-queue — Low-confidence extractions needing staff review ────

router.get(
  "/review-queue",
  requireRole("admin", "manager"),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const { skip, take } = ReviewQueueQuerySchema.parse(req.query);

      const where = { tenantId, status: "PENDING_REVIEW" as const };

      const [records, total] = await Promise.all([
        prisma.insuranceRecord.findMany({
          where,
          orderBy: { expiryDate: "asc" },
          skip,
          take,
          include: {
            customer: {
              select: { id: true, firstName: true, lastName: true, email: true },
            },
            boat: {
              select: { id: true, name: true, make: true, model: true },
            },
          },
        }),
        prisma.insuranceRecord.count({ where }),
      ]);

      // Enrich with confidence data and coverage validation
      const enriched = await Promise.all(
        records.map(async (record) => {
          let confidence: Record<string, string> = {};
          try {
            confidence = record.extractionConfidence
              ? JSON.parse(record.extractionConfidence)
              : {};
          } catch {
            // ignore parse errors
          }

          const hasLowConfidence = Object.values(confidence).some(
            (c) => c === "low",
          );

          // Compute coverage validation
          const coverageJson = record.coverageJson as Record<string, unknown> | null;
          const validation = coverageJson?.validation ?? null;

          return {
            ...record,
            confidenceParsed: confidence,
            hasLowConfidence,
            validation,
          };
        }),
      );

      res.json({
        data: enriched,
        pagination: { skip, take, total },
      });
    } catch (err) {
      next(err);
    }
  },
);

// ─── GET /:id — Single insurance record with extraction details ─────────────

router.get(
  "/:id",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const { id } = IdParamsSchema.parse(req.params);

      const record = await prisma.insuranceRecord.findFirst({
        where: { id, tenantId },
        include: {
          customer: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
          boat: {
            select: { id: true, name: true, make: true, model: true },
          },
        },
      });

      if (!record) {
        throw appError("Insurance record not found", 404, "NOT_FOUND");
      }

      // Parse confidence data
      let confidence: Record<string, string> = {};
      try {
        confidence = record.extractionConfidence
          ? JSON.parse(record.extractionConfidence)
          : {};
      } catch {
        // ignore parse errors
      }

      // Re-run coverage validation to get current gap analysis
      const coverageJson = record.coverageJson as Record<string, unknown> | null;
      const limits = (coverageJson?.limits ?? {}) as Record<string, unknown>;

      const extraction = {
        insurer: record.insurer,
        policyNumber: record.policyNumber,
        startDate: record.startDate?.toISOString() ?? null,
        expiryDate: record.expiryDate?.toISOString() ?? null,
        coverageLimits: {
          bodilyInjury: (limits.bodilyInjury as number) ?? null,
          propertyDamage: (limits.propertyDamage as number) ?? null,
          medicalPayments: (limits.medicalPayments as number) ?? null,
          generalAggregate: (limits.generalAggregate as number) ?? null,
        },
        additionalInsured: (coverageJson?.additionalInsured as string) ?? null,
        confidence,
        rawExtraction: "",
      };

      const validation = await validateCoverage(extraction as any, tenantId);

      res.json({
        ...record,
        extraction: {
          confidence,
          coverageLimits: extraction.coverageLimits,
          additionalInsured: extraction.additionalInsured,
        },
        validation,
      });
    } catch (err) {
      next(err);
    }
  },
);

// ─── PUT /:id/review — Staff reviews extracted data ─────────────────────────

router.put(
  "/:id/review",
  requireRole("admin", "manager"),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const { id } = IdParamsSchema.parse(req.params);
      const data = ReviewSchema.parse(req.body);

      const existing = await prisma.insuranceRecord.findFirst({
        where: { id, tenantId },
      });
      if (!existing) {
        throw appError("Insurance record not found", 404, "NOT_FOUND");
      }

      // Build update payload — staff can correct any extracted field
      const updateData: Record<string, unknown> = {
        status: data.status,
      };

      if (data.insurer !== undefined) updateData.insurer = data.insurer;
      if (data.policyNumber !== undefined) updateData.policyNumber = data.policyNumber;
      if (data.startDate !== undefined) updateData.startDate = data.startDate;
      if (data.expiryDate !== undefined) updateData.expiryDate = data.expiryDate;

      // Merge coverage limit corrections into existing coverageJson
      if (data.coverageLimits) {
        const existingCoverage =
          (existing.coverageJson as Record<string, unknown>) ?? {};
        const existingLimits =
          (existingCoverage.limits as Record<string, unknown>) ?? {};

        updateData.coverageJson = {
          ...existingCoverage,
          limits: {
            ...existingLimits,
            ...data.coverageLimits,
          },
          reviewNotes: data.notes ?? null,
          reviewedBy: req.userId,
          reviewedAt: new Date().toISOString(),
        };
      } else if (data.notes) {
        const existingCoverage =
          (existing.coverageJson as Record<string, unknown>) ?? {};
        updateData.coverageJson = {
          ...existingCoverage,
          reviewNotes: data.notes,
          reviewedBy: req.userId,
          reviewedAt: new Date().toISOString(),
        };
      }

      const updated = await prisma.insuranceRecord.update({
        where: { id },
        data: updateData,
        include: {
          customer: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
          boat: {
            select: { id: true, name: true, make: true, model: true },
          },
        },
      });

      // Audit log
      await prisma.auditLog.create({
        data: {
          tenantId,
          userId: req.userId,
          recordType: "InsuranceRecord",
          recordId: id,
          action: "UPDATED",
          changedFieldsJson: {
            reviewAction: data.status,
            correctedFields: Object.keys(data).filter((k) => k !== "status" && k !== "notes"),
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
