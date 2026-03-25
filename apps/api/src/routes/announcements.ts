import { Router } from "express";
import { clerkAuth } from "../middleware/auth.js";

const router = Router();

router.use(...clerkAuth());

// TODO: Announcement CRUD, broadcast to customer portal, push notifications

export default router;
