import { Router } from "express";
import { clerkAuth, requireRole } from "../middleware/auth.js";

const router = Router();

router.use(...clerkAuth());
router.use(requireRole("admin", "manager"));

// TODO: Occupancy reports, revenue reports, deferred revenue, aging receivables

export default router;
