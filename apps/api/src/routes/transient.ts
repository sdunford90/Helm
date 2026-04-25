import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { clerkAuth } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";
import { createPaymentIntent } from "../lib/stripe.js";
import { queues } from "../lib/queue.js";

const router: Router = Router();

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
  rateCents: z.number().int().positive(),
  totalCents: z.number().int().positive(),
  customerId: z.string().uuid().optional().nullable(),
  stripeConnectedAccountId: z.string().optional(),
});

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

      // Process payment via Stripe if connected account provided
      let stripePaymentId: string | null = null;
      if (body.stripeConnectedAccountId) {
        const pi = await createPaymentIntent(
          body.totalCents,
          "usd",
          body.stripeConnectedAccountId,
          Math.round(body.totalCents * 0.03), // 3% platform fee
        );
        stripePaymentId = pi.id;
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
          checkOut: body.checkOut ? new Date(body.checkOut) : null,
          rateCents: body.rateCents,
          totalCents: body.totalCents,
          customerId: body.customerId ?? null,
          stripePaymentId,
          status: "BOOKED",
        },
        include: { slip: true },
      });

      res.status(201).json({ data: booking });
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
      });
      const slip = await prisma.slip.findUnique({
        where: { id: updated.slipId },
        select: { slipNumber: true },
      });
      const slipNumber = slip?.slipNumber ?? "";

      // Queue notifications — best-effort, don't fail the request if the
      // queue is down (status transition has value on its own).
      try {
        if (updated.guestEmail) {
          await queues.email.add("transient-overstay-guest", {
            tenantId: updated.tenantId,
            to: updated.guestEmail,
            guestName: updated.guestName,
            slipNumber,
            expectedCheckOut: updated.checkOut,
          });
        }
        if (updated.guestPhone) {
          await queues.sms.add("transient-overstay-guest-sms", {
            tenantId: updated.tenantId,
            to: updated.guestPhone,
            message: `Your slip ${slipNumber} checkout was ${updated.checkOut?.toDateString()}. Please contact the marina.`,
          });
        }
        await queues.email.add("transient-overstay-staff", {
          tenantId: updated.tenantId,
          bookingId: updated.id,
          slipNumber,
          guestName: updated.guestName,
        });
      } catch (err) {
        console.error("[transient] failed to queue overstay alerts:", err);
      }

      res.json({ data: updated, alert: "OVERSTAY_TRIGGERED" });
    } catch (err) {
      next(err);
    }
  },
);

// DELETE /api/transient/:id — Cancel booking
router.delete(
  "/:id",
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
