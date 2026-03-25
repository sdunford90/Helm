import { Router } from "express";
import { clerkAuth } from "../middleware/auth.js";

const router = Router();

// All slip routes require authentication
router.use(...clerkAuth());

// TODO: CRUD for marina slips, availability, assignments

export default router;
