import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { clerkAuth } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";

const router = Router();

// ─── Zod Schemas ─────────────────────────────────────────────────────────────

const CreatePartnerSchema = z.object({
  name: z.string().min(1),
  contactName: z.string().optional().nullable(),
  email: z.string().email().optional().nullable(),
  phone: z.string().optional().nullable(),
  commissionPct: z.number().min(0).max(100).optional().default(0),
  notes: z.string().optional().nullable(),
});

const UpdatePartnerSchema = z.object({
  name: z.string().min(1).optional(),
  contactName: z.string().optional().nullable(),
  email: z.string().email().optional().nullable(),
  phone: z.string().optional().nullable(),
  commissionPct: z.number().min(0).max(100).optional(),
  notes: z.string().optional().nullable(),
  active: z.boolean().optional(),
});

// ─── Helpers ────────────────────────────────────────────────────────────────

function appError(message: string, statusCode: number, code: string): Error {
  const err = new Error(message) as Error & { statusCode: number; code: string };
  err.statusCode = statusCode;
  err.code = code;
  return err;
}

// ─── Routes ─────────────────────────────────────────────────────────────────

router.use(...clerkAuth());

// GET /api/referral-partners — List all partners with lead counts
router.get(
  "/",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = (req as any).tenantId;

      const partners = await prisma.referralPartner.findMany({
        where: { tenantId },
        orderBy: { name: "asc" },
        include: {
          _count: { select: { leads: true } },
        },
      });

      res.json({
        data: partners.map((p) => ({
          ...p,
          leadCount: p._count.leads,
        })),
      });
    } catch (err) {
      next(err);
    }
  },
);

// GET /api/referral-partners/:id — Partner detail with leads
router.get(
  "/:id",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = (req as any).tenantId;

      const partner = await prisma.referralPartner.findFirst({
        where: { id: req.params.id, tenantId },
        include: {
          leads: {
            orderBy: { createdAt: "desc" },
            take: 50,
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              stage: true,
              createdAt: true,
            },
          },
          _count: { select: { leads: true } },
        },
      });

      if (!partner) throw appError("Partner not found", 404, "NOT_FOUND");

      const wonLeads = await prisma.lead.count({
        where: { referralPartnerId: partner.id, stage: "WON" },
      });

      res.json({
        data: {
          ...partner,
          leadCount: partner._count.leads,
          wonLeads,
          conversionRate:
            partner._count.leads > 0
              ? Math.round((wonLeads / partner._count.leads) * 10000) / 100
              : 0,
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/referral-partners — Create partner
router.post(
  "/",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = (req as any).tenantId;
      const body = CreatePartnerSchema.parse(req.body);

      const partner = await prisma.referralPartner.create({
        data: {
          tenantId,
          name: body.name,
          contactName: body.contactName ?? null,
          email: body.email ?? null,
          phone: body.phone ?? null,
          commissionPct: body.commissionPct,
          notes: body.notes ?? null,
          active: true,
        },
      });

      res.status(201).json({ data: partner });
    } catch (err) {
      next(err);
    }
  },
);

// PUT /api/referral-partners/:id — Update partner
router.put(
  "/:id",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = (req as any).tenantId;
      const body = UpdatePartnerSchema.parse(req.body);

      const existing = await prisma.referralPartner.findFirst({
        where: { id: req.params.id, tenantId },
      });
      if (!existing) throw appError("Partner not found", 404, "NOT_FOUND");

      const updated = await prisma.referralPartner.update({
        where: { id: req.params.id },
        data: body,
      });

      res.json({ data: updated });
    } catch (err) {
      next(err);
    }
  },
);

// DELETE /api/referral-partners/:id — Deactivate partner
router.delete(
  "/:id",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = (req as any).tenantId;

      const existing = await prisma.referralPartner.findFirst({
        where: { id: req.params.id, tenantId },
      });
      if (!existing) throw appError("Partner not found", 404, "NOT_FOUND");

      await prisma.referralPartner.update({
        where: { id: req.params.id },
        data: { active: false },
      });

      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },
);

export default router;
