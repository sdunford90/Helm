import { Router } from "express";
import { clerkAuth } from "../middleware/auth.js";

const router = Router();

router.use(...clerkAuth());

// TODO: Invoice generation, PDF, send, payment application

export default router;
