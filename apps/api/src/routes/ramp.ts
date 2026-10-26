import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { clerkAuth } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";
import { createPaymentIntent } from "../lib/stripe.js";

const router = Router();

// ─── Zod Schemas ─────────────────────────────────────────────────────────────

const RampTicketTypeEnum = z.enum(["SINGLE_LAUNCH", "DAILY_PASS", "SEASONAL_PASS"]);

const CreateTicketSchema = z.object({
  guestName: z.string().min(1).optional().nullable(),
  customerId: z.string().uuid().optional().nullable(),
  licensePlate: z.string().optional().nullable(),
  boatRegistration: z.string().optional().nullable(),
  ticketType: RampTicketTypeEnum,
  // Accepted for backwards compatibility but IGNORED: the price comes from
  // the tenant's configured ramp prices. Client Stripe account ids are dropped.
  amountCents: z.number().int().optional(),
  paymentMethod: z.enum(["CARD", "CASH", "CHARGE_TO_SLIP"]).optional(),
  locationId: z.string().uuid().optional().nullable(),
});

/**
 * Server-side ramp price: tenant settings → billing
 * `rampPricesCents[ticketType]`. Refuses (400) when not configured rather
 * than trusting a client amount.
 */
export function rampPriceCents(config: unknown, ticketType: string): number {
  const prices =
    config && typeof config === "object" && !Array.isArray(config)
      ? ((config as Record<string, unknown>).rampPricesCents as Record<string, unknown> | undefined)
      : undefined;
  const price = prices?.[ticketType];
  if (typeof price !== "number" || !Number.isInteger(price) || price < 0) {
    throw appError(
      `Ramp price for ${ticketType} is not configured (settings → billing → rampPricesCents)`,
      400,
      "RAMP_PRICE_NOT_CONFIGURED",
    );
  }
  return price;
}

const ListTicketsQuerySchema = z.object({
  ticketType: RampTicketTypeEnum.optional(),
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
  skip: z.coerce.number().int().min(0).default(0),
  take: z.coerce.number().int().positive().max(200).default(50),
});

const ValidatePassSchema = z.object({
  ticketId: z.string().uuid(),
});

// ─── Helpers ────────────────────────────────────────────────────────────────

function appError(message: string, statusCode: number, code: string): Error {
  const err = new Error(message) as Error & {
    statusCode: number;
    code: string;
  };
  err.statusCode = statusCode;
  err.code = code;
  return err;
}

// ─── Routes ─────────────────────────────────────────────────────────────────

// GET /api/ramp/stats — Launch stats
router.get(
  "/stats",
  ...clerkAuth(),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const weekStart = new Date(todayStart);
      weekStart.setDate(weekStart.getDate() - weekStart.getDay());

      const [todayCount, weekCount, weekRevenue, breakdown] = await Promise.all([
        prisma.rampTicket.count({
          where: { createdAt: { gte: todayStart } },
        }),
        prisma.rampTicket.count({
          where: { createdAt: { gte: weekStart } },
        }),
        prisma.rampTicket.aggregate({
          where: { createdAt: { gte: weekStart } },
          _sum: { amountCents: true },
        }),
        prisma.rampTicket.groupBy({
          by: ["ticketType"],
          where: { createdAt: { gte: weekStart } },
          _count: true,
          _sum: { amountCents: true },
        }),
      ]);

      res.json({
        data: {
          launchesToday: todayCount,
          launchesThisWeek: weekCount,
          weekRevenueCents: weekRevenue._sum.amountCents ?? 0,
          breakdown: breakdown.map((b) => ({
            type: b.ticketType,
            count: b._count,
            revenueCents: b._sum.amountCents ?? 0,
          })),
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

// GET /api/ramp/tickets — List tickets with filters
router.get(
  "/tickets",
  ...clerkAuth(),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const query = ListTicketsQuerySchema.parse(req.query);
      const where: Record<string, unknown> = {};

      if (query.ticketType) where.ticketType = query.ticketType;
      if (query.dateFrom || query.dateTo) {
        where.createdAt = {};
        if (query.dateFrom) (where.createdAt as Record<string, unknown>).gte = new Date(query.dateFrom);
        if (query.dateTo) (where.createdAt as Record<string, unknown>).lte = new Date(query.dateTo);
      }

      const [data, total] = await Promise.all([
        prisma.rampTicket.findMany({
          where,
          include: { customer: true },
          skip: query.skip,
          take: query.take,
          orderBy: { createdAt: "desc" },
        }),
        prisma.rampTicket.count({ where }),
      ]);

      res.json({ data, total });
    } catch (err) {
      next(err);
    }
  },
);

// GET /api/ramp/tickets/:id — Ticket detail
router.get(
  "/tickets/:id",
  ...clerkAuth(),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ticket = await prisma.rampTicket.findUnique({
        where: { id: req.params.id },
        include: { customer: true },
      });

      if (!ticket) throw appError("Ticket not found", 404, "NOT_FOUND");
      res.json({ data: ticket });
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/ramp/tickets — Create ticket
router.post(
  "/tickets",
  ...clerkAuth(),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = CreateTicketSchema.parse(req.body);

      const tenantId = req.tenantId!;
      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { invoiceTemplateJson: true, stripeAccountId: true },
      });

      // Check slip holder discount if customerId provided
      let discountApplied = false;
      let amountCents: number;
      if (body.customerId) {
        const customer = await prisma.customer.findFirst({
          where: { id: body.customerId, tenantId },
          select: { id: true },
        });
        if (!customer) throw appError("Customer not found", 404, "CUSTOMER_NOT_FOUND");
      }
      const activeContract = body.customerId
        ? await prisma.slipContract.findFirst({
            where: {
              tenantId,
              customerId: body.customerId,
              status: "ACTIVE",
            },
          })
        : null;
      if (activeContract) {
        discountApplied = true;
        // Slip holders get free launches
        amountCents = 0;
      } else {
        amountCents = rampPriceCents(tenant?.invoiceTemplateJson, body.ticketType);
      }

      // Card payments are charged on the tenant's OWN connected account.
      let stripePaymentId: string | null = null;
      let paymentClientSecret: string | null = null;
      if (body.paymentMethod === "CARD" && amountCents > 0) {
        if (!tenant?.stripeAccountId) {
          throw appError("Stripe is not connected for this marina", 400, "STRIPE_NOT_CONFIGURED");
        }
        const pi = await createPaymentIntent(
          amountCents,
          "usd",
          tenant.stripeAccountId,
          Math.round(amountCents * 0.03),
        );
        stripePaymentId = pi.id;
        paymentClientSecret = pi.client_secret ?? null;
      }

      const ticket = await prisma.rampTicket.create({
        data: {
          tenantId,
          guestName: body.guestName ?? null,
          customerId: body.customerId ?? null,
          licensePlate: body.licensePlate ?? null,
          boatRegistration: body.boatRegistration ?? null,
          ticketType: body.ticketType,
          amountCents,
          paymentMethod: body.paymentMethod ?? null,
          locationId: body.locationId ?? null,
          stripePaymentId,
        },
        include: { customer: true },
      });

      res.status(201).json({ data: ticket, discountApplied, paymentClientSecret });
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/ramp/passes/validate — Validate seasonal pass at POS scan
router.post(
  "/passes/validate",
  ...clerkAuth(),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = ValidatePassSchema.parse(req.body);

      const ticket = await prisma.rampTicket.findUnique({
        where: { id: body.ticketId },
        include: { customer: true },
      });

      if (!ticket) throw appError("Pass not found", 404, "NOT_FOUND");
      if (ticket.ticketType !== "SEASONAL_PASS") {
        throw appError("Ticket is not a seasonal pass", 400, "NOT_SEASONAL");
      }

      // Check if pass is still within valid season (assume calendar year)
      const now = new Date();
      const passYear = ticket.createdAt.getFullYear();
      const isValid = passYear === now.getFullYear();

      res.json({
        data: {
          valid: isValid,
          ticket,
          message: isValid ? "Seasonal pass is valid" : "Seasonal pass has expired",
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
