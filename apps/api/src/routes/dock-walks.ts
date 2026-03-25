import { Router } from "express";
import { clerkAuth } from "../middleware/auth.js";

const router = Router();

router.use(...clerkAuth());

// TODO: Dock walk scheduling, checklist items, photo uploads, issue flagging

export default router;
