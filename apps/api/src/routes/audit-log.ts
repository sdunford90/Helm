import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { clerkAuth, requireRole } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";

const router: Router = Router();

// ─── Zod Schemas ─────────────────────────────────────────────────────────────

const ListAuditLogQuerySchema = z.object({
  userId: z.string().optional(),
  recordType: z.string().optional(),
  recordId: z.string().optional(),
  action: z.string().optional(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
  limit: z.coerce.number().int().positive().max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const RecordParamsSchema = z.object({
  recordType: z.string().min(1),
  recordId: z.string().min(1),
});

const UserParamsSchema = z.object({
  userId: z.string().min(1),
});

const PaginationQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

// ─── Auth: admin or manager ─────────────────────────────────────────────────

router.use(...clerkAuth());
router.use(requireRole("MARINA_OWNER", "TENANT_ADMIN", "MARINA_MANAGER"));

// ─── Helpers ────────────────────────────────────────────────────────────────

function buildWhere(tenantId: string, filters: z.infer<typeof ListAuditLogQuerySchema>) {
  const where: Record<string, unknown> = { tenantId };

  if (filters.userId) where.userId = filters.userId;
  if (filters.recordType) where.recordType = filters.recordType;
  if (filters.recordId) where.recordId = filters.recordId;
  if (filters.action) where.action = filters.action;

  if (filters.startDate || filters.endDate) {
    const createdAt: Record<string, Date> = {};
    if (filters.startDate) createdAt.gte = filters.startDate;
    if (filters.endDate) createdAt.lte = filters.endDate;
    where.createdAt = createdAt;
  }

  return where;
}

function escapeCSV(value: unknown): string {
  if (value === null || value === undefined) return "";
  const str = typeof value === "object" ? JSON.stringify(value) : String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

// ─── GET / — List audit log entries ─────────────────────────────────────────

router.get(
  "/",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const query = ListAuditLogQuerySchema.parse(req.query);
      const where = buildWhere(tenantId, query);

      const [entries, total] = await Promise.all([
        prisma.auditLog.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip: query.offset,
          take: query.limit,
        }),
        prisma.auditLog.count({ where }),
      ]);

      // Enrich with user info where userId is present
      const userIds = [...new Set(entries.map((e) => e.userId).filter(Boolean))] as string[];
      const users =
        userIds.length > 0
          ? await prisma.user.findMany({
              where: { id: { in: userIds }, tenantId },
              select: { id: true, email: true, role: true },
            })
          : [];
      const userMap = new Map(users.map((u) => [u.id, u]));

      const data = entries.map((entry) => ({
        ...entry,
        user: entry.userId ? userMap.get(entry.userId) ?? null : null,
      }));

      res.json({
        data,
        pagination: {
          offset: query.offset,
          limit: query.limit,
          total,
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

// ─── GET /export — CSV export of filtered audit logs ────────────────────────

router.get(
  "/export",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const query = ListAuditLogQuerySchema.parse(req.query);
      const where = buildWhere(tenantId, query);

      const entries = await prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        // Export up to 10 000 rows
        take: 10_000,
      });

      const headers = [
        "id",
        "createdAt",
        "userId",
        "userName",
        "recordType",
        "recordId",
        "action",
        "changedFieldsJson",
        "ipAddress",
      ];

      const rows = entries.map((entry) =>
        headers.map((h) => escapeCSV((entry as Record<string, unknown>)[h])).join(","),
      );

      const csv = [headers.join(","), ...rows].join("\n");

      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", "attachment; filename=audit-log.csv");
      res.send(csv);
    } catch (err) {
      next(err);
    }
  },
);

// ─── GET /record/:recordType/:recordId — Entries for a specific record ──────

router.get(
  "/record/:recordType/:recordId",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const { recordType, recordId } = RecordParamsSchema.parse(req.params);
      const { limit, offset } = PaginationQuerySchema.parse(req.query);

      const where = { tenantId, recordType, recordId };

      const [entries, total] = await Promise.all([
        prisma.auditLog.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip: offset,
          take: limit,
        }),
        prisma.auditLog.count({ where }),
      ]);

      res.json({
        data: entries,
        pagination: { offset, limit, total },
      });
    } catch (err) {
      next(err);
    }
  },
);

// ─── GET /user/:userId — All actions by a specific user ─────────────────────

router.get(
  "/user/:userId",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const { userId } = UserParamsSchema.parse(req.params);
      const { limit, offset } = PaginationQuerySchema.parse(req.query);

      const where = { tenantId, userId };

      const [entries, total] = await Promise.all([
        prisma.auditLog.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip: offset,
          take: limit,
        }),
        prisma.auditLog.count({ where }),
      ]);

      res.json({
        data: entries,
        pagination: { offset, limit, total },
      });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
