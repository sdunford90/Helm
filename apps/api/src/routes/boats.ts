import { Router } from "express";
import { clerkAuth } from "../middleware/auth.js";

const router = Router();

router.use(...clerkAuth());

// TODO: Boat CRUD, insurance tracking, registration details

export default router;
