import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { clerkAuth, requireRole } from "../middleware/auth.js";
import { getReportCatalog } from "../services/report-catalog.js";
import { runReportSpec, ReportEngineError } from "../services/report-engine.js";

// ─────────────────────────────────────────────────────────────────────────────
// Insights routes — the universal-report-builder data plane.
//
// /catalog returns the schema-introspected reportable surface.
// /run executes a validated spec against the caller's tenant scope.
//
// Future routes (deferred):
//   POST /save        — persist a SavedReportView
//   POST /schedule    — cron a delivery
//   GET  /saved       — list a user's saved views
// ─────────────────────────────────────────────────────────────────────────────

const router: Router = Router();

router.use(...clerkAuth());
router.use(requireRole("MARINA_OWNER", "TENANT_ADMIN", "MARINA_MANAGER", "ACCOUNTING"));

// GET /api/insights/catalog
router.get("/catalog", async (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(getReportCatalog());
  } catch (err) {
    next(err);
  }
});

// Spec validator. Loose on values (the engine type-casts based on the
// catalog's field type), strict on shape and ops.
const ReportFilterSchema = z.object({
  field: z.string().min(1).max(64),
  op: z.enum([
    "eq", "ne", "lt", "lte", "gt", "gte",
    "in", "notIn", "contains", "startsWith", "endsWith",
    "isNull", "isNotNull", "between",
  ]),
  value: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional(),
  values: z.tuple([
    z.union([z.string(), z.number()]),
    z.union([z.string(), z.number()]),
  ]).optional(),
  in: z.array(z.union([z.string(), z.number()])).max(500).optional(),
});

const ReportSortSchema = z.object({
  field: z.string().min(1).max(64),
  dir: z.enum(["asc", "desc"]),
});

const ReportSpecSchema = z.object({
  model: z.string().min(1).max(64),
  fields: z.array(z.string().min(1).max(64)).max(200).optional(),
  filters: z.array(ReportFilterSchema).max(50).optional(),
  sort: z.array(ReportSortSchema).max(8).optional(),
  limit: z.number().int().positive().optional(),
  offset: z.number().int().nonnegative().optional(),
  // Reserved for the next phase — present here so client-side typings
  // line up with the spec.
  groupBy: z.array(z.string()).max(8).optional(),
  aggregates: z.array(z.object({
    fn: z.enum(["count", "sum", "avg", "min", "max"]),
    field: z.string().optional(),
    alias: z.string().optional(),
  })).max(20).optional(),
});

// POST /api/insights/run
router.post("/run", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = (req as Request & { tenantId?: string }).tenantId;
    if (!tenantId) {
      res.status(400).json({ error: "Tenant scope is required" });
      return;
    }
    const spec = ReportSpecSchema.parse(req.body);
    const result = await runReportSpec(spec, tenantId);
    res.json(result);
  } catch (err) {
    if (err instanceof ReportEngineError) {
      res.status(err.statusCode).json({ error: err.message });
      return;
    }
    next(err);
  }
});

export default router;
