import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { clerkAuth, requireRole, MANAGER_ROLES, FINANCE_ROLES } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";
import { createPaymentIntent } from "../lib/stripe.js";

const router = Router();

// ─── Zod Schemas ─────────────────────────────────────────────────────────────

const TransientStatusEnum = z.enum([
  "BOOKED",
  "CHECKED_IN",
  "CHECKED_OUT",
  "CANCELLED",
  "OVERSTAY",
]);

const CreateBookingSchema = z.object({
  slipId: z.string().uuid(),
  guestName: z.string().min(1),
  guestEmail: z.string().email().optional().nullable(),
  guestPhone: z.string().optional().nullable(),
  boatName: z.string().optional().nullable(),
  boatLength: z.number().positive().optional().nullable(),
  checkIn: z.string().datetime(),
  checkOut: z.string().datetime().optional().nullable(),
  // Accepted for backwards compatibility but IGNORED: price is computed
  // server-side. Any client-sent Stripe account id is dropped by zod.
  rateCents: z.number().int().optional(),
  totalCents: z.number().int().optional(),
  customerId: z.string().uuid().optional().nullable(),
  // Create a Stripe PaymentIntent for the server-computed total on the
  // tenant's own connected account.
  collectPayment: z.boolean().default(false),
});

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Server-side transient pricing: the tenant's configured nightly rate per
 * foot (settings → billing `transientRatePerFtCents`) × the slip's length
 * (DB) × nights. No client-supplied price is ever used; without a configured
 * rate the booking is refused rather than trusting the client.
 */
export function priceTransientStay(input: {
  ratePerFtCents: unknown;
  slipLengthFt: number;
  checkIn: Date;
  checkOut: Date;
}): { rateCents: number; nights: number; totalCents: number } {
  const perFt = input.ratePerFtCents;
  if (typeof perFt !== "number" || !Number.isInteger(perFt) || perFt <= 0) {
    throw appError(
      "Transient nightly rate is not configured for this marina (settings → billing → transientRatePerFtCents)",
      400,
      "TRANSIENT_RATE_NOT_CONFIGURED",
    );
  }
  if (!(input.slipLengthFt > 0)) {
    throw appError("Slip has no length on file; cannot price the stay", 400, "SLIP_NOT_PRICEABLE");
  }
  const ms = input.checkOut.getTime() - input.checkIn.getTime();
  if (!(ms > 0)) {
    throw appError("checkOut must be after checkIn", 400, "INVALID_DATES");
  }
  const nights = Math.ceil(ms / DAY_MS);
  const rateCents = Math.round(input.slipLengthFt * perFt);
  return { rateCents, nights, totalCents: rateCents * nights };
}

const ListBookingsQuerySchema = z.object({
  status: TransientStatusEnum.optional(),
  slipId: z.string().uuid().optional(),
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
  skip: z.coerce.number().int().min(0).default(0),
  take: z.coerce.number().int().positive().max(200).default(50),
});

const AvailabilityQuerySchema = z.object({
  dateFrom: z.string().datetime(),
  dateTo: z.string().datetime(),
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

// GET /api/transient/availability — Available transient-capable slips for date range
router.get(
  "/availability",
  ...clerkAuth(),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const query = AvailabilityQuerySchema.parse(req.query);
      const dateFrom = new Date(query.dateFrom);
      const dateTo = new Date(query.dateTo);

      // Find slips that are transient-capable and not booked in the range
      const bookedSlipIds = await prisma.transientBooking.findMany({
        where: {
          status: { in: ["BOOKED", "CHECKED_IN"] },
          checkIn: { lte: dateTo },
          OR: [
            { checkOut: { gte: dateFrom } },
            { checkOut: null },
          ],
        },
        select: { slipId: true },
      });

      const bookedIds = bookedSlipIds.map((b) => b.slipId);

      const availableSlips = await prisma.slip.findMany({
        where: {
          transientCapable: true,
          status: { in: ["VACANT", "RESERVED"] },
          id: { notIn: bookedIds.length > 0 ? bookedIds : undefined },
        },
        orderBy: { slipNumber: "asc" },
      });

      res.json({ data: availableSlips });
    } catch (err) {
      next(err);
    }
  },
);

// GET /api/transient — List bookings with filters
router.get(
  "/",
  ...clerkAuth(),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const query = ListBookingsQuerySchema.parse(req.query);
      const where: Record<string, unknown> = {};

      if (query.status) where.status = query.status;
      if (query.slipId) where.slipId = query.slipId;
      if (query.dateFrom || query.dateTo) {
        where.checkIn = {};
        if (query.dateFrom) (where.checkIn as Record<string, unknown>).gte = new Date(query.dateFrom);
        if (query.dateTo) (where.checkIn as Record<string, unknown>).lte = new Date(query.dateTo);
      }

      const [data, total] = await Promise.all([
        prisma.transientBooking.findMany({
          where,
          include: { slip: true, customer: true },
          skip: query.skip,
          take: query.take,
          orderBy: { checkIn: "desc" },
        }),
        prisma.transientBooking.count({ where }),
      ]);

      res.json({ data, total });
    } catch (err) {
      next(err);
    }
  },
);

// GET /api/transient/:id — Booking detail
router.get(
  "/:id",
  ...clerkAuth(),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const booking = await prisma.transientBooking.findUnique({
        where: { id: req.params.id },
        include: { slip: true, customer: true },
      });

      if (!booking) throw appError("Booking not found", 404, "NOT_FOUND");
      res.json({ data: booking });
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/transient — Create booking
router.post(
  "/",
  ...clerkAuth(),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = CreateBookingSchema.parse(req.body);

      // Verify slip exists and is transient-capable
      const slip = await prisma.slip.findUnique({ where: { id: body.slipId } });
      if (!slip) throw appError("Slip not found", 404, "SLIP_NOT_FOUND");
      if (!slip.transientCapable) {
        throw appError("Slip is not transient-capable", 400, "SLIP_NOT_TRANSIENT");
      }

      if (!body.checkOut) {
        throw appError("checkOut is required to price a transient booking", 400, "CHECKOUT_REQUIRED");
      }

      if (body.customerId) {
        const customer = await prisma.customer.findFirst({
          where: { id: body.customerId, tenantId: req.tenantId! },
          select: { id: true },
        });
        if (!customer) throw appError("Customer not found", 404, "CUSTOMER_NOT_FOUND");
      }

      const tenant = await prisma.tenant.findUnique({
        where: { id: req.tenantId! },
        select: { invoiceTemplateJson: true, stripeAccountId: true },
      });
      const billing = (tenant?.invoiceTemplateJson ?? {}) as Record<string, unknown>;

      // Price comes from DB data only (tenant rate × slip length × nights).
      const { rateCents, totalCents } = priceTransientStay({
        ratePerFtCents: billing.transientRatePerFtCents,
        slipLengthFt: slip.lengthFt,
        checkIn: new Date(body.checkIn),
        checkOut: new Date(body.checkOut),
      });

      // Charge on the tenant's OWN connected account (never a client-sent id).
      let stripePaymentId: string | null = null;
      let paymentClientSecret: string | null = null;
      if (body.collectPayment) {
        if (!tenant?.stripeAccountId) {
          throw appError("Stripe is not connected for this marina", 400, "STRIPE_NOT_CONFIGURED");
        }
        const pi = await createPaymentIntent(
          totalCents,
          "usd",
          tenant.stripeAccountId,
          Math.round(totalCents * 0.03), // 3% platform fee
        );
        stripePaymentId = pi.id;
        paymentClientSecret = pi.client_secret ?? null;
      }

      const booking = await prisma.transientBooking.create({
        data: {
          tenantId: (req as any).tenantId,
          slipId: body.slipId,
          guestName: body.guestName,
          guestEmail: body.guestEmail ?? null,
          guestPhone: body.guestPhone ?? null,
          boatName: body.boatName ?? null,
          boatLength: body.boatLength ?? null,
          checkIn: new Date(body.checkIn),
          checkOut: new Date(body.checkOut),
          rateCents,
          totalCents,
          customerId: body.customerId ?? null,
          stripePaymentId,
          status: "BOOKED",
        },
        include: { slip: true },
      });

      res.status(201).json({ data: booking, paymentClientSecret });
    } catch (err) {
      next(err);
    }
  },
);

// PUT /api/transient/:id/check-in — Check in guest
router.put(
  "/:id/check-in",
  ...clerkAuth(),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const booking = await prisma.transientBooking.findUnique({
        where: { id: req.params.id },
      });
      if (!booking) throw appError("Booking not found", 404, "NOT_FOUND");
      if (booking.status !== "BOOKED") {
        throw appError("Booking is not in BOOKED status", 400, "INVALID_STATUS");
      }

      // Mark slip as occupied
      await prisma.slip.update({
        where: { id: booking.slipId },
        data: { status: "OCCUPIED" },
      });

      const updated = await prisma.transientBooking.update({
        where: { id: req.params.id },
        data: {
          status: "CHECKED_IN",
          checkIn: new Date(),
        },
        include: { slip: true },
      });

      res.json({ data: updated });
    } catch (err) {
      next(err);
    }
  },
);

// PUT /api/transient/:id/check-out — Check out guest
router.put(
  "/:id/check-out",
  ...clerkAuth(),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const booking = await prisma.transientBooking.findUnique({
        where: { id: req.params.id },
      });
      if (!booking) throw appError("Booking not found", 404, "NOT_FOUND");
      if (booking.status !== "CHECKED_IN" && booking.status !== "OVERSTAY") {
        throw appError("Guest is not checked in", 400, "INVALID_STATUS");
      }

      // Release slip
      await prisma.slip.update({
        where: { id: booking.slipId },
        data: { status: "VACANT" },
      });

      const updated = await prisma.transientBooking.update({
        where: { id: req.params.id },
        data: {
          status: "CHECKED_OUT",
          checkOut: new Date(),
        },
        include: { slip: true },
      });

      res.json({ data: updated });
    } catch (err) {
      next(err);
    }
  },
);

// PUT /api/transient/:id/overstay — Mark as overstay
router.put(
  "/:id/overstay",
  ...clerkAuth(),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const booking = await prisma.transientBooking.findUnique({
        where: { id: req.params.id },
      });
      if (!booking) throw appError("Booking not found", 404, "NOT_FOUND");
      if (booking.status !== "CHECKED_IN") {
        throw appError("Guest is not checked in", 400, "INVALID_STATUS");
      }

      const updated = await prisma.transientBooking.update({
        where: { id: req.params.id },
        data: { status: "OVERSTAY" },
        include: { slip: true },
      });

      // TODO: Trigger overstay alert (email/SMS notification)

      res.json({ data: updated, alert: "OVERSTAY_TRIGGERED" });
    } catch (err) {
      next(err);
    }
  },
);

// DELETE /api/transient/:id — Cancel booking
router.delete(
  "/:id",
  requireRole(...MANAGER_ROLES),
  ...clerkAuth(),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const booking = await prisma.transientBooking.findUnique({
        where: { id: req.params.id },
      });
      if (!booking) throw appError("Booking not found", 404, "NOT_FOUND");
      if (booking.status === "CHECKED_OUT" || booking.status === "CANCELLED") {
        throw appError("Cannot cancel this booking", 400, "INVALID_STATUS");
      }

      // Release slip if currently occupied
      if (booking.status === "CHECKED_IN" || booking.status === "OVERSTAY") {
        await prisma.slip.update({
          where: { id: booking.slipId },
          data: { status: "VACANT" },
        });
      }

      const updated = await prisma.transientBooking.update({
        where: { id: req.params.id },
        data: { status: "CANCELLED" },
        include: { slip: true },
      });

      res.json({ data: updated });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
