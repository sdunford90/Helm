import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { clerkAuth } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";

const router: Router = Router();

router.use(...clerkAuth());

// ─── GET / — list support tickets for the current tenant ─────────────────────

router.get(
  "/",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const tickets = await prisma.supportTicket.findMany({
        where: { tenantId },
        orderBy: { createdAt: "desc" },
        take: 50,
        select: {
          id: true,
          subject: true,
          description: true,
          status: true,
          priority: true,
          createdAt: true,
          updatedAt: true,
        },
      });
      res.json({ data: tickets });
    } catch (err) {
      next(err);
    }
  },
);

// ─── POST / — create a support ticket for the current tenant ─────────────────

const CreateTicketSchema = z.object({
  subject: z.string().min(1).max(200),
  description: z.string().min(1),
  priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"),
});

router.post(
  "/",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const data = CreateTicketSchema.parse(req.body);
      const ticket = await prisma.supportTicket.create({
        data: {
          tenantId,
          subject: data.subject,
          description: data.description,
          priority: data.priority,
          status: "open",
        },
      });
      res.status(201).json(ticket);
    } catch (err) {
      next(err);
    }
  },
);

export default router;
