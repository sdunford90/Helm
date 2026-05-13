// Plan 33 — POST /api/compose-assist
//
// Thin route over the compose-assist service. Validates the payload, calls
// the model, returns the rewritten text. Auth comes from the global Clerk
// middleware mounted on /api routes — any signed-in staff user can call this.

import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { composeAssist } from "../services/compose-assist.js";

const router: Router = Router();

const BodySchema = z.object({
  draft: z.string().max(8000),
  tone: z.enum(["friendly", "firm", "formal", "concise"]),
  context: z.string().max(1000).optional(),
});

router.post("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = BodySchema.parse(req.body ?? {});
    const result = await composeAssist(body);
    res.json(result);
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.message, code: "INVALID_BODY" });
      return;
    }
    next(err);
  }
});

export default router;
