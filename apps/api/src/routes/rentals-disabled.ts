import { Router, type Request, type Response } from "express";

// ---------------------------------------------------------------------------
// Rentals module: disabled (Phase 0)
//
// routes/rentals.ts does not match the Prisma schema (93 type errors: wrong
// model/field names, a pricing engine that disagrees with the job and the
// widgets, no payment capture or tax) and will be rebuilt in Phase 3 (see
// docs/audit/04-rentals-dynamic-pricing.md). Until then every rentals
// endpoint answers 503 so nothing half-works. routes/rentals.ts is kept,
// excluded from compilation in tsconfig.json, as the rebuild reference.
// ---------------------------------------------------------------------------

const router = Router();

router.all("*", (_req: Request, res: Response) => {
  res.status(503).json({
    error: "Rentals module is being rebuilt",
    code: "MODULE_DISABLED",
  });
});

export default router;
