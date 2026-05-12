import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { clerkAuth, requireRole } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";
import { getReportCatalog } from "../services/report-catalog.js";
import { runReportSpec, ReportEngineError } from "../services/report-engine.js";

// ─────────────────────────────────────────────────────────────────────────────
// Insights routes — the universal-report-builder data plane.
//
//   GET  /catalog        Schema-introspected reportable surface.
//   POST /run            Execute a validated spec against the caller's tenant.
//   GET  /runs           Recent run log for the caller's tenant (R9).
//   GET  /views          List the caller's saved views (R1).
//   POST /views          Save a new view (R1).
//   GET  /views/:id      Read a single view (R1).
//   PUT  /views/:id      Rename / re-spec a view (R1).
//   DELETE /views/:id    Remove a view (R1).
//
// Future routes (deferred): POST /schedule, POST /views/:id/share.
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
  field: z.string().min(1).max(128),
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
  field: z.string().min(1).max(128),
  dir: z.enum(["asc", "desc"]),
});

const ReportSpecSchema = z.object({
  model: z.string().min(1).max(64),
  fields: z.array(z.string().min(1).max(128)).max(200).optional(),
  filters: z.array(ReportFilterSchema).max(50).optional(),
  sort: z.array(ReportSortSchema).max(8).optional(),
  limit: z.number().int().positive().optional(),
  offset: z.number().int().nonnegative().optional(),
  groupBy: z.array(z.string()).max(8).optional(),
  aggregates: z.array(z.object({
    fn: z.enum(["count", "sum", "avg", "min", "max"]),
    field: z.string().optional(),
    alias: z.string().optional(),
  })).max(20).optional(),
});

// R10: sensitive fields are gated by role. Only TENANT_ADMIN and MARINA_OWNER
// can ever opt them in (Stripe / QBO IDs, DL fields, DOB, etc.). The
// always-blocked subset (secrets, signatures, raw payloads, Clerk IDs)
// stays blocked for everyone regardless.
function canSeeSensitiveFields(req: Request): boolean {
  const role = req.userRole;
  return role === "TENANT_ADMIN" || role === "MARINA_OWNER";
}

// POST /api/insights/run
router.post("/run", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      res.status(400).json({ error: "Tenant scope is required" });
      return;
    }
    const spec = ReportSpecSchema.parse(req.body);
    const result = await runReportSpec(spec, tenantId, {
      userId: req.userId ?? null,
      allowSensitive: canSeeSensitiveFields(req),
    });
    res.json(result);
  } catch (err) {
    if (err instanceof ReportEngineError) {
      res.status(err.statusCode).json({ error: err.message });
      return;
    }
    next(err);
  }
});

// POST /api/insights/run.csv — R2: same engine, CSV response.
//
// Streams a text/csv body. Values are escaped per RFC 4180 (double-quote
// any cell containing comma, quote, newline; double up internal quotes).
// Up to HARD_ROW_CAP rows; for bigger results the async-export path will
// eventually take over (queued job → R2 → Export Center). The MVP just
// inlines the response since 10k rows is small enough for any browser.
function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  let s: string;
  if (typeof v === "object") {
    try { s = JSON.stringify(v); }
    catch { s = String(v); }
  } else {
    s = String(v);
  }
  if (s.includes('"') || s.includes(",") || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

router.post("/run.csv", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      res.status(400).json({ error: "Tenant scope is required" });
      return;
    }
    const spec = ReportSpecSchema.parse(req.body);
    const result = await runReportSpec(spec, tenantId, {
      userId: req.userId ?? null,
      allowSensitive: canSeeSensitiveFields(req),
    });

    const header = result.fields.map(csvCell).join(",");
    const body = result.rows
      .map((row) => result.fields.map((f) => csvCell(row[f])).join(","))
      .join("\n");
    const csv = `${header}\n${body}\n`;

    const filename = `${result.model}-${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    // Surface warnings in a header so the UI can show them even though
    // the body is binary-ish CSV.
    if (result.warnings.length > 0) {
      res.setHeader("X-Helm-Report-Warnings", JSON.stringify(result.warnings).slice(0, 1024));
    }
    res.setHeader("X-Helm-Report-Rows", String(result.rowCount));
    res.setHeader("X-Helm-Report-HasMore", String(result.hasMore));
    res.status(200).send(csv);
  } catch (err) {
    if (err instanceof ReportEngineError) {
      res.status(err.statusCode).json({ error: err.message });
      return;
    }
    next(err);
  }
});

// GET /api/insights/runs — recent run-log entries for the tenant. Default
// limit 50, max 200. Returns the spec hash + summary (not the full spec
// JSON) for the listing; the per-row endpoint expands.
router.get("/runs", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      res.status(400).json({ error: "Tenant scope is required" });
      return;
    }
    const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 50)));
    const rows = await prisma.insightsRunLog.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true, userId: true, specHash: true, model: true,
        rowCount: true, hasMore: true, runtimeMs: true,
        warningCount: true, errorMessage: true, createdAt: true,
      },
    });
    res.json({ runs: rows });
  } catch (err) {
    next(err);
  }
});

// ─── Saved Views (R1) ─────────────────────────────────────────────────────

const SavedViewBodySchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional().nullable(),
  spec: ReportSpecSchema,
});

// GET /api/insights/views — list this user's saved views (newest first).
router.get("/views", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      res.status(400).json({ error: "Tenant scope is required" });
      return;
    }
    const rows = await prisma.savedReportView.findMany({
      where: { tenantId, userId: req.userId ?? undefined },
      orderBy: { updatedAt: "desc" },
      take: 100,
      select: {
        id: true, name: true, description: true,
        createdAt: true, updatedAt: true,
        // Surface enough of the spec to render a list row without
        // hydrating the full thing — the model is the most useful tag.
        specJson: true,
      },
    });
    res.json({
      views: rows.map((v) => ({
        id: v.id,
        name: v.name,
        description: v.description,
        model: (v.specJson as { model?: string })?.model ?? "—",
        createdAt: v.createdAt,
        updatedAt: v.updatedAt,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/insights/views
router.post("/views", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      res.status(400).json({ error: "Tenant scope is required" });
      return;
    }
    const body = SavedViewBodySchema.parse(req.body);
    const created = await prisma.savedReportView.create({
      data: {
        tenantId,
        userId: req.userId ?? null,
        name: body.name,
        description: body.description ?? null,
        specJson: body.spec as unknown as object,
      },
      select: { id: true, name: true, description: true, createdAt: true, updatedAt: true },
    });
    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

// GET /api/insights/views/:id — return the full spec for a saved view.
router.get("/views/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      res.status(400).json({ error: "Tenant scope is required" });
      return;
    }
    const row = await prisma.savedReportView.findFirst({
      where: { id: req.params.id, tenantId },
    });
    if (!row) {
      res.status(404).json({ error: "Saved view not found" });
      return;
    }
    res.json(row);
  } catch (err) {
    next(err);
  }
});

// PUT /api/insights/views/:id — rename or update spec.
router.put("/views/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      res.status(400).json({ error: "Tenant scope is required" });
      return;
    }
    const body = SavedViewBodySchema.parse(req.body);
    const existing = await prisma.savedReportView.findFirst({
      where: { id: req.params.id, tenantId },
      select: { id: true },
    });
    if (!existing) {
      res.status(404).json({ error: "Saved view not found" });
      return;
    }
    const updated = await prisma.savedReportView.update({
      where: { id: req.params.id },
      data: {
        name: body.name,
        description: body.description ?? null,
        specJson: body.spec as unknown as object,
      },
    });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/insights/views/:id
router.delete("/views/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      res.status(400).json({ error: "Tenant scope is required" });
      return;
    }
    const existing = await prisma.savedReportView.findFirst({
      where: { id: req.params.id, tenantId },
      select: { id: true },
    });
    if (!existing) {
      res.status(404).json({ error: "Saved view not found" });
      return;
    }
    await prisma.savedReportView.delete({ where: { id: req.params.id } });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export default router;
