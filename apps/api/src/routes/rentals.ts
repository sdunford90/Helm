import { Router } from "express";
import { clerkAuth } from "../middleware/auth.js";

const router = Router();

router.use(...clerkAuth());

// TODO: Rental agreements, transient slip bookings, kayak/paddleboard rentals

export default router;
