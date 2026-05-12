import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { clerkAuth } from "../middleware/auth.js";
import {
  locationContext,
  scopedWhere,
  requireActiveLocation,
} from "../middleware/location-context.js";
import { prisma } from "../lib/prisma.js";
import { convertLeadToCustomer } from "../services/lead-conversion.js";

const router: Router = Router();

// ─── Zod Schemas ─────────────────────────────────────────────────────────────

const LeadStageEnum = z.enum([
  "NEW",
  "CONTACTED",
  "QUALIFIED",
  "PROPOSAL_SENT",
  "WON",
  "LOST",
]);

const LeadSourceEnum = z.enum([
  "WEBSITE",
  "REFERRAL",
  "WALK_IN",
  "PHONE",
  "SOCIAL_MEDIA",
  "EMAIL",
  "OTHER",
]);

/** Ordered pipeline stages (index = ordinal position). */
const STAGE_ORDER: z.infer<typeof LeadStageEnum>[] = [
  "NEW",
  "CONTACTED",
  "QUALIFIED",
  "PROPOSAL_SENT",
  "WON",
  "LOST",
];

const CreateLeadSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email().optional().nullable(),
  phone: z.string().optional().nullable(),
  boatLength: z.number().positive().optional().nullable(),
  slipType: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  assignedTo: z.string().uuid().optional().nullable(),
  locationId: z.string().uuid().optional().nullable(),
  source: LeadSourceEnum.optional(),
  sourceDetail: z.string().optional().nullable(),
  sourceFormId: z.string().uuid().optional().nullable(),
  sourceUrl: z.string().optional().nullable(),
  utmSource: z.string().optional().nullable(),
  utmMedium: z.string().optional().nullable(),
  referralCode: z.string().optional().nullable(),
  stage: LeadStageEnum.optional(),
});

const UpdateLeadSchema = z.object({
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  email: z.string().email().optional().nullable(),
  phone: z.string().optional().nullable(),
  boatLength: z.number().positive().optional().nullable(),
  slipType: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  assignedTo: z.string().uuid().optional().nullable(),
  locationId: z.string().uuid().optional().nullable(),
  source: LeadSourceEnum.optional(),
  sourceDetail: z.string().optional().nullable(),
});

const StageTransitionSchema = z.object({
  stage: LeadStageEnum,
  lostReason: z.string().optional(),
});

const ConvertLeadSchema = z.object({
  customerOverrides: z
    .object({
      company: z.string().optional(),
      phone: z.string().optional(),
      email: z.string().email().optional(),
      addressJson: z.object({ address: z.string().optional(), city: z.string().optional(), state: z.string().max(2).optional(), zip: z.string().max(10).optional() }).optional(),
    })
    .optional(),
  boat: z
    .object({
      name: z.string().optional(),
      registrationNumber: z.string().optional(),
      registrationState: z.string().optional(),
      hin: z.string().optional(),
      make: z.string().optional(),
      model: z.string().optional(),
      year: z.number().int().optional(),
      lengthFt: z.number().positive(),
      beamFt: z.number().positive().optional(),
      draftFt: z.number().positive().optional(),
      fuelType: z.string().optional(),
      engineCount: z.number().int().optional(),
      engineHp: z.number().int().optional(),
    })
    .optional(),
  slipAssignment: z
    .object({
      slipId: z.string().uuid(),
      startDate: z.coerce.date(),
      endDate: z.coerce.date().optional(),
      rateCents: z.number().int().positive(),
      billingCycle: z
        .enum(["MONTHLY", "QUARTERLY", "SEMI_ANNUAL", "ANNUAL"])
        .optional(),
      autoRenew: z.boolean().optional(),
      securityDepositCents: z.number().int().optional(),
    })
    .optional(),
});

const ListLeadsQuerySchema = z.object({
  stage: LeadStageEnum.optional(),
  source: LeadSourceEnum.optional(),
  assignedTo: z.string().uuid().optional(),
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
  search: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(25),
  sortBy: z
    .enum(["createdAt", "updatedAt", "firstName", "lastName", "stage"])
    .default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

const DeleteLeadSchema = z.object({
  lostReason: z.string().optional(),
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
router.use(locationContext());

// ─── GET /stats — Pipeline statistics ───────────────────────────────────────
// Registered before /:id so Express doesn't treat "stats" as a UUID param.

router.get(
  "/stats",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      // Task #339: scope all stats aggregations to the active location so
      // pipeline numbers reflect the marina the user is looking at, not a
      // tenant-wide total.
      const locationScope = scopedWhere(req, { includeNull: true });

      // Count by stage
      const stageCounts = await prisma.lead.groupBy({
        by: ["stage"],
        _count: { id: true },
        where: { tenantId, ...locationScope },
      });

      const countByStage: Record<string, number> = {};
      let totalLeads = 0;
      for (const row of stageCounts) {
        countByStage[row.stage] = row._count.id;
        totalLeads += row._count.id;
      }

      // Conversion rate: WON / (total - still in pipeline NEW/CONTACTED/QUALIFIED/PROPOSAL_SENT)
      const wonCount = countByStage["WON"] ?? 0;
      const lostCount = countByStage["LOST"] ?? 0;
      const closedCount = wonCount + lostCount;
      const conversionRate =
        closedCount > 0
          ? Math.round((wonCount / closedCount) * 10000) / 100
          : 0;

      // Average time-to-convert (days) for WON leads that have convertedAt
      const convertedLeads = await prisma.lead.findMany({
        where: { tenantId, ...locationScope, stage: "WON", convertedAt: { not: null } },
        select: { createdAt: true, convertedAt: true },
      });

      let avgDaysToConvert: number | null = null;
      if (convertedLeads.length > 0) {
        const totalDays = convertedLeads.reduce((sum: number, l: { createdAt: Date; convertedAt: Date | null }) => {
          const diffMs =
            (l.convertedAt as Date).getTime() - l.createdAt.getTime();
          return sum + diffMs / (1000 * 60 * 60 * 24);
        }, 0);
        avgDaysToConvert =
          Math.round((totalDays / convertedLeads.length) * 10) / 10;
      }

      // Conversion rate broken out by source — one groupBy across (source, stage)
      // and we fold totals/won/lost in code so we don't N+1.
      const sourceStageCounts = await prisma.lead.groupBy({
        by: ["source", "stage"],
        _count: { id: true },
        where: { tenantId, ...locationScope },
      });

      const sourceTotals: Record<string, { total: number; won: number; lost: number }> = {};
      for (const row of sourceStageCounts) {
        const src = row.source as string;
        if (!sourceTotals[src]) sourceTotals[src] = { total: 0, won: 0, lost: 0 };
        sourceTotals[src].total += row._count.id;
        if (row.stage === "WON") sourceTotals[src].won += row._count.id;
        if (row.stage === "LOST") sourceTotals[src].lost += row._count.id;
      }

      const ALL_SOURCES = [
        "WEBSITE",
        "REFERRAL",
        "WALK_IN",
        "PHONE",
        "SOCIAL_MEDIA",
        "EMAIL",
        "OTHER",
      ] as const;

      const bySource = ALL_SOURCES.map((src) => {
        const t = sourceTotals[src] ?? { total: 0, won: 0, lost: 0 };
        const closed = t.won + t.lost;
        const conversionRate =
          closed > 0 ? Math.round((t.won / closed) * 10000) / 100 : 0;
        return {
          source: src,
          total: t.total,
          won: t.won,
          lost: t.lost,
          conversionRate,
        };
      });

      res.json({
        totalLeads,
        countByStage,
        conversionRate,
        avgDaysToConvert,
        bySource,
      });
    } catch (err) {
      next(err);
    }
  },
);

// ─── GET / — List leads ─────────────────────────────────────────────────────

router.get(
  "/",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const query = ListLeadsQuerySchema.parse(req.query);

      const where: Record<string, unknown> = {
        tenantId,
        // Task #339: scope leads to active location.
        ...scopedWhere(req, { includeNull: true }),
      };

      if (query.stage) where.stage = query.stage;
      if (query.assignedTo) where.assignedTo = query.assignedTo;
      if (query.source) where.source = query.source;
      if (query.dateFrom || query.dateTo) {
        where.createdAt = {
          ...(query.dateFrom ? { gte: query.dateFrom } : {}),
          ...(query.dateTo ? { lte: query.dateTo } : {}),
        };
      }
      if (query.search) {
        const search = query.search;
        where.OR = [
          ...(Array.isArray(where.OR) ? (where.OR as unknown[]) : []),
          { firstName: { contains: search, mode: "insensitive" } },
          { lastName: { contains: search, mode: "insensitive" } },
          { email: { contains: search, mode: "insensitive" } },
        ];
      }

      const [leads, total] = await Promise.all([
        prisma.lead.findMany({
          where,
          orderBy: { [query.sortBy]: query.sortOrder },
          skip: (query.page - 1) * query.limit,
          take: query.limit,
          include: { sourceForm: { select: { id: true, name: true, formType: true } } },
        }),
        prisma.lead.count({ where }),
      ]);

      res.json({
        data: leads,
        pagination: {
          page: query.page,
          limit: query.limit,
          total,
          totalPages: Math.ceil(total / query.limit),
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

// ─── GET /:id — Get single lead ────────────────────────────────────────────

router.get(
  "/:id",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;

      const lead = await prisma.lead.findFirst({
        where: {
          id: req.params.id,
          tenantId,
          ...scopedWhere(req, { includeNull: true }),
        },
        include: {
          sourceForm: { select: { id: true, name: true, formType: true } },
          waitlistEntries: true,
        },
      });

      if (!lead) {
        throw appError("Lead not found", 404, "NOT_FOUND");
      }

      // Fetch activity / audit history
      const auditLogs = await prisma.auditLog.findMany({
        where: { tenantId, recordType: "Lead", recordId: lead.id },
        orderBy: { createdAt: "desc" },
        take: 50,
      });

      res.json({ ...lead, activityHistory: auditLogs });
    } catch (err) {
      next(err);
    }
  },
);

// ─── POST / — Create lead ──────────────────────────────────────────────────

router.post(
  "/",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const data = CreateLeadSchema.parse(req.body);
      // Task #339: stamp active location (caller may override).
      const locationId = requireActiveLocation(req, data.locationId ?? null);

      const lead = await prisma.lead.create({
        data: {
          tenantId,
          ...data,
          locationId,
        },
      });

      // Audit
      await prisma.auditLog.create({
        data: {
          tenantId,
          userId: req.userId,
          userName: req.userRecord
            ? `${req.userRecord.email}`
            : undefined,
          recordType: "Lead",
          recordId: lead.id,
          action: "CREATED",
          changedFieldsJson: { stage: lead.stage, source: lead.source },
        },
      });

      res.status(201).json(lead);
    } catch (err) {
      next(err);
    }
  },
);

// ─── PUT /:id — Update lead ────────────────────────────────────────────────

router.put(
  "/:id",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const data = UpdateLeadSchema.parse(req.body);

      const existing = await prisma.lead.findFirst({
        where: { id: req.params.id, tenantId, ...scopedWhere(req, { includeNull: true }) },
      });
      if (!existing) {
        throw appError("Lead not found", 404, "NOT_FOUND");
      }

      const updated = await prisma.lead.update({
        where: { id: req.params.id },
        data,
      });

      // Audit — log changed fields
      const changedFields: Record<string, unknown> = {};
      for (const key of Object.keys(data)) {
        const val = (data as Record<string, unknown>)[key];
        if (val !== undefined) {
          changedFields[key] = {
            from: (existing as Record<string, unknown>)[key],
            to: val,
          };
        }
      }

      await prisma.auditLog.create({
        data: {
          tenantId,
          userId: req.userId,
          recordType: "Lead",
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

// ─── PUT /:id/stage — Move lead to new pipeline stage ──────────────────────

router.put(
  "/:id/stage",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const { stage, lostReason } = StageTransitionSchema.parse(req.body);

      const lead = await prisma.lead.findFirst({
        where: { id: req.params.id, tenantId, ...scopedWhere(req, { includeNull: true }) },
      });
      if (!lead) {
        throw appError("Lead not found", 404, "NOT_FOUND");
      }

      // Validate stage transition: can advance one step at a time, can revert
      // freely, and can always move to LOST.
      const currentIdx = STAGE_ORDER.indexOf(lead.stage as typeof STAGE_ORDER[number]);
      const targetIdx = STAGE_ORDER.indexOf(stage);

      if (stage !== "LOST") {
        // Can't skip forward (must advance one step at a time)
        if (targetIdx > currentIdx + 1) {
          throw appError(
            `Cannot skip stages. Current: ${lead.stage}, target: ${stage}. Advance one stage at a time.`,
            400,
            "INVALID_STAGE_TRANSITION",
          );
        }
        // Can't move forward from WON
        if (lead.stage === "WON" && targetIdx > currentIdx) {
          throw appError(
            "Cannot advance past WON stage",
            400,
            "INVALID_STAGE_TRANSITION",
          );
        }
        // Can't move forward from LOST (must revert first)
        if (lead.stage === "LOST" && targetIdx > currentIdx) {
          throw appError(
            "Cannot advance from LOST stage. Revert to an earlier stage first.",
            400,
            "INVALID_STAGE_TRANSITION",
          );
        }
      }

      // Require lostReason when moving to LOST
      if (stage === "LOST" && !lostReason) {
        throw appError(
          "lostReason is required when moving to LOST stage",
          400,
          "LOST_REASON_REQUIRED",
        );
      }

      const updateData: Record<string, unknown> = { stage };
      if (stage === "LOST") updateData.lostReason = lostReason;
      // Clear lostReason when reverting from LOST
      if (lead.stage === "LOST" && stage !== "LOST") {
        updateData.lostReason = null;
      }

      const updated = await prisma.lead.update({
        where: { id: req.params.id },
        data: updateData,
      });

      // Audit
      await prisma.auditLog.create({
        data: {
          tenantId,
          userId: req.userId,
          recordType: "Lead",
          recordId: updated.id,
          action: "STAGE_CHANGED",
          changedFieldsJson: {
            from: lead.stage,
            to: stage,
            ...(lostReason ? { lostReason } : {}),
          },
        },
      });

      res.json(updated);
    } catch (err) {
      next(err);
    }
  },
);

// ─── POST /:id/convert — Convert WON lead to customer ──────────────────────

router.post(
  "/:id/convert",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const body = ConvertLeadSchema.parse(req.body);

      const result = await convertLeadToCustomer(req.params.id, tenantId, {
        ...body,
        performedBy: req.userId,
        performedByName: req.userRecord?.email,
      });

      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  },
);

// ─── DELETE /:id — Soft delete (mark as LOST) ───────────────────────────────

router.delete(
  "/:id",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const { lostReason } = DeleteLeadSchema.parse(req.body);

      const lead = await prisma.lead.findFirst({
        where: { id: req.params.id, tenantId, ...scopedWhere(req, { includeNull: true }) },
      });
      if (!lead) {
        throw appError("Lead not found", 404, "NOT_FOUND");
      }

      if (lead.stage === "WON" && lead.customerId) {
        throw appError(
          "Cannot delete a converted lead",
          400,
          "ALREADY_CONVERTED",
        );
      }

      const updated = await prisma.lead.update({
        where: { id: req.params.id },
        data: {
          stage: "LOST",
          lostReason: lostReason ?? "Deleted by staff",
        },
      });

      await prisma.auditLog.create({
        data: {
          tenantId,
          userId: req.userId,
          recordType: "Lead",
          recordId: updated.id,
          action: "SOFT_DELETED",
          changedFieldsJson: {
            previousStage: lead.stage,
            lostReason: updated.lostReason,
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
