import { Router } from "express";
import { clerkAuth } from "../middleware/auth.js";

const router = Router();

router.use(...clerkAuth());

// TODO: Waitlist entries, position management, promotion to slip assignment

export default router;
