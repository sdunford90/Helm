import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { clerkAuth, requireRole } from "../middleware/auth.js";

const router = Router();

// --------------------------------------------------------------------------
// GET /api/audit-logs — paginated audit logs for tenant
// --------------------------------------------------------------------------
router.get(
  "/",
  ...clerkAuth(),
  requireRole("MARINA_OWNER", "MARINA_MANAGER"),
  async (req, res, next) => {
    try {
      const take = Math.min(parseInt(req.query.limit as string) || 50, 200);
      const skip = parseInt(req.query.offset as string) || 0;
      const recordType = req.query.recordType as string | undefined;
      const recordId = req.query.recordId as string | undefined;
      const userId = req.query.userId as string | undefined;
      const action = req.query.action as string | undefined;

      const where: Record<string, unknown> = { tenantId: req.tenantId! };
      if (recordType) where.recordType = recordType;
      if (recordId) where.recordId = recordId;
      if (userId) where.userId = userId;
      if (action) where.action = action;

      const [logs, total] = await Promise.all([
        prisma.auditLog.findMany({
          where,
          orderBy: { createdAt: "desc" },
          take,
          skip,
        }),
        prisma.auditLog.count({ where }),
      ]);

      res.json({ logs, total, limit: take, offset: skip });
    } catch (err) {
      next(err);
    }
  },
);

// --------------------------------------------------------------------------
// GET /api/audit-logs/:id — get a single audit log entry
// --------------------------------------------------------------------------
router.get(
  "/:id",
  ...clerkAuth(),
  requireRole("MARINA_OWNER", "MARINA_MANAGER"),
  async (req, res, next) => {
    try {
      const log = await prisma.auditLog.findFirst({
        where: { id: req.params.id, tenantId: req.tenantId! },
      });

      if (!log) {
        res.status(404).json({ error: "Audit log not found" });
        return;
      }

      res.json({ log });
    } catch (err) {
      next(err);
    }
  },
);

// --------------------------------------------------------------------------
// GET /api/audit-logs/record/:recordType/:recordId — logs for a record
// --------------------------------------------------------------------------
router.get(
  "/record/:recordType/:recordId",
  ...clerkAuth(),
  requireRole("MARINA_OWNER", "MARINA_MANAGER"),
  async (req, res, next) => {
    try {
      const logs = await prisma.auditLog.findMany({
        where: {
          tenantId: req.tenantId!,
          recordType: req.params.recordType,
          recordId: req.params.recordId,
        },
        orderBy: { createdAt: "desc" },
      });

      res.json({ logs });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
