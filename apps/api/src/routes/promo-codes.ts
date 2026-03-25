import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { clerkAuth } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";

const router = Router();

// ─── Zod Schemas ─────────────────────────────────────────────────────────────

const CreatePromoCodeSchema = z.object({
  code: z.string().min(1).max(50).transform((v) => v.toUpperCase().trim()),
  description: z.string().optional().nullable(),
  discountType: z.enum(["PERCENTAGE", "FIXED_AMOUNT"]),
  discountValue: z.number().positive(),
  maxUses: z.number().int().positive().optional().nullable(),
  startsAt: z.string().datetime().optional().nullable(),
  expiresAt: z.string().datetime().optional().nullable(),
  minimumAmountCents: z.number().int().min(0).optional().default(0),
  applicableTo: z.enum(["ALL", "RENTALS", "CONTRACTS", "POS"]).optional().default("ALL"),
});

const UpdatePromoCodeSchema = z.object({
  description: z.string().optional().nullable(),
  maxUses: z.number().int().positive().optional().nullable(),
  startsAt: z.string().datetime().optional().nullable(),
  expiresAt: z.string().datetime().optional().nullable(),
  minimumAmountCents: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
});

const ValidatePromoSchema = z.object({
  code: z.string().min(1).transform((v) => v.toUpperCase().trim()),
  amountCents: z.number().int().positive(),
  context: z.enum(["ALL", "RENTALS", "CONTRACTS", "POS"]).optional().default("ALL"),
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

// GET /api/promo-codes — List all promo codes
router.get(
  "/",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = (req as any).tenantId;

      const codes = await prisma.promoCode.findMany({
        where: { tenantId },
        orderBy: { createdAt: "desc" },
      });

      res.json({ data: codes });
    } catch (err) {
      next(err);
    }
  },
);

// GET /api/promo-codes/:id — Promo code detail
router.get(
  "/:id",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = (req as any).tenantId;

      const code = await prisma.promoCode.findFirst({
        where: { id: req.params.id, tenantId },
      });

      if (!code) throw appError("Promo code not found", 404, "NOT_FOUND");
      res.json({ data: code });
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/promo-codes — Create promo code
router.post(
  "/",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = (req as any).tenantId;
      const body = CreatePromoCodeSchema.parse(req.body);

      // Check for duplicate code
      const existing = await prisma.promoCode.findFirst({
        where: { tenantId, code: body.code },
      });
      if (existing) {
        throw appError("Promo code already exists", 409, "DUPLICATE_CODE");
      }

      const code = await prisma.promoCode.create({
        data: {
          tenantId,
          code: body.code,
          description: body.description ?? null,
          discountType: body.discountType,
          discountValue: body.discountValue,
          maxUses: body.maxUses ?? null,
          currentUses: 0,
          startsAt: body.startsAt ? new Date(body.startsAt) : null,
          expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
          minimumAmountCents: body.minimumAmountCents,
          applicableTo: body.applicableTo,
          isActive: true,
        },
      });

      res.status(201).json({ data: code });
    } catch (err) {
      next(err);
    }
  },
);

// PUT /api/promo-codes/:id — Update promo code
router.put(
  "/:id",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = (req as any).tenantId;
      const body = UpdatePromoCodeSchema.parse(req.body);

      const existing = await prisma.promoCode.findFirst({
        where: { id: req.params.id, tenantId },
      });
      if (!existing) throw appError("Promo code not found", 404, "NOT_FOUND");

      const data: Record<string, unknown> = {};
      if (body.description !== undefined) data.description = body.description;
      if (body.maxUses !== undefined) data.maxUses = body.maxUses;
      if (body.startsAt !== undefined) data.startsAt = body.startsAt ? new Date(body.startsAt) : null;
      if (body.expiresAt !== undefined) data.expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;
      if (body.minimumAmountCents !== undefined) data.minimumAmountCents = body.minimumAmountCents;
      if (body.isActive !== undefined) data.isActive = body.isActive;

      const updated = await prisma.promoCode.update({
        where: { id: req.params.id },
        data,
      });

      res.json({ data: updated });
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/promo-codes/validate — Validate and calculate discount
router.post(
  "/validate",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = (req as any).tenantId;
      const { code, amountCents, context } = ValidatePromoSchema.parse(req.body);

      const promo = await prisma.promoCode.findFirst({
        where: { tenantId, code },
      });

      if (!promo) {
        throw appError("Invalid promo code", 404, "INVALID_CODE");
      }

      // Check if active
      if (!promo.isActive) {
        throw appError("Promo code is no longer active", 400, "INACTIVE_CODE");
      }

      // Check expiration
      const now = new Date();
      if (promo.startsAt && now < new Date(promo.startsAt)) {
        throw appError("Promo code is not yet valid", 400, "NOT_YET_VALID");
      }
      if (promo.expiresAt && now > new Date(promo.expiresAt)) {
        throw appError("Promo code has expired", 400, "EXPIRED_CODE");
      }

      // Check usage limit
      if (promo.maxUses && promo.currentUses >= promo.maxUses) {
        throw appError("Promo code usage limit reached", 400, "USAGE_LIMIT");
      }

      // Check minimum amount
      if (amountCents < promo.minimumAmountCents) {
        throw appError(
          `Minimum order amount is $${(promo.minimumAmountCents / 100).toFixed(2)}`,
          400,
          "BELOW_MINIMUM",
        );
      }

      // Check applicability
      if (promo.applicableTo !== "ALL" && promo.applicableTo !== context) {
        throw appError("Promo code not applicable to this purchase type", 400, "NOT_APPLICABLE");
      }

      // Calculate discount
      let discountCents: number;
      if (promo.discountType === "PERCENTAGE") {
        discountCents = Math.round(amountCents * (promo.discountValue / 100));
      } else {
        discountCents = Math.round(promo.discountValue * 100); // discountValue is in dollars for fixed
      }

      // Cap discount at order total
      discountCents = Math.min(discountCents, amountCents);

      res.json({
        data: {
          valid: true,
          code: promo.code,
          discountType: promo.discountType,
          discountValue: promo.discountValue,
          discountCents,
          finalAmountCents: amountCents - discountCents,
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/promo-codes/:id/redeem — Increment usage counter
router.post(
  "/:id/redeem",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = (req as any).tenantId;

      const promo = await prisma.promoCode.findFirst({
        where: { id: req.params.id, tenantId },
      });
      if (!promo) throw appError("Promo code not found", 404, "NOT_FOUND");

      const updated = await prisma.promoCode.update({
        where: { id: req.params.id },
        data: { currentUses: { increment: 1 } },
      });

      res.json({ data: updated });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
