import { Router } from "express";
import { clerkAuth } from "../middleware/auth.js";

const router = Router();

router.use(...clerkAuth());

// TODO: Lead capture, pipeline management, conversion

export default router;
