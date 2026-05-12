import { Router, type Request, type Response, type NextFunction } from "express";
import { clerkAuth, requireRole } from "../middleware/auth.js";
import { getReportCatalog } from "../services/report-catalog.js";

// ─────────────────────────────────────────────────────────────────────────────
// Insights routes — the universal-report-builder data plane.
//
// Today this only serves the schema-introspected data catalog. The builder UI
// reads from /api/insights/catalog to render the "browse what's reportable"
// surface. Future routes will live here: POST /run (execute a spec), POST
// /save (persist a saved view), POST /schedule (cron a delivery).
// ─────────────────────────────────────────────────────────────────────────────

const router: Router = Router();

router.use(...clerkAuth());
router.use(requireRole("MARINA_OWNER", "TENANT_ADMIN", "MARINA_MANAGER", "ACCOUNTING"));

// GET /api/insights/catalog
// Returns every reportable model with its fields, types, relations, and
// scope flags. Sensitive fields (secrets, signatures, raw webhook payloads,
// Stripe IDs) are flagged so the UI can hide them; the future query engine
// will refuse to expose them regardless of UI state.
router.get("/catalog", async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const catalog = getReportCatalog();
    res.json(catalog);
  } catch (err) {
    next(err);
  }
});

export default router;
