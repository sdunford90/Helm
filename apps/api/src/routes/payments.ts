import { Router } from "express";
import { clerkAuth } from "../middleware/auth.js";

const router = Router();

router.use(...clerkAuth());

// TODO: Payment processing, refunds, Stripe webhooks

export default router;
