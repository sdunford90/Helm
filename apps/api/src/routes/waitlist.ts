import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { clerkAuth } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";

const router: Router = Router();

// ─── Zod Schemas ─────────────────────────────────────────────────────────────

const WaitlistStatusEnum = z.enum([
  "WAITING",
  "NOTIFIED",
  "HOLD",
  "ACCEPTED",
  "EXPIRED",
  "REMOVED",
]);

const CreateWaitlistSchema = z.object({
  customerId: z.string().uuid().optional().nullable(),
  leadId: z.string().uuid().optional().nullable(),
  slipType: z.string().optional().nullable(),
  boatLength: z.number().positive().optional().nullable(),
  desiredDate: z.coerce.date().optional().nullable(),
  locationId: z.string().uuid().optional().nullable(),
});

const UpdateWaitlistSchema = z.object({
  slipType: z.string().optional().nullable(),
  boatLength: z.number().positive().optional().nullable(),
  desiredDate: z.coerce.date().optional().nullable(),
  status: WaitlistStatusEnum.optional(),
  locationId: z.string().uuid().optional().nullable(),
});

const ListWaitlistQuerySchema = z.object({
  slipType: z.string().optional(),
  status: WaitlistStatusEnum.optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(25),
});

const NotifyNextSchema = z.object({
  slipType: z.string().min(1),
  holdDurationHours: z.number().int().positive().default(48),
});

const AcceptOfferSchema = z.object({
  slipId: z.string().uuid(),
  startDate: z.coerce.date(),
  endDate: z.coerce.date().optional(),
  rateCents: z.number().int().positive(),
  billingCycle: z
    .enum(["MONTHLY", "QUARTERLY", "SEMI_ANNUAL", "ANNUAL"])
    .default("MONTHLY"),
  autoRenew: z.boolean().default(false),
  securityDepositCents: z.number().int().optional(),
  boatId: z.string().uuid().optional(),
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

// ─── Authenticated routes ───────────────────────────────────────────────────

router.use(...clerkAuth());

// ─── GET / — List waitlist entries ──────────────────────────────────────────

router.get(
  "/",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const query = ListWaitlistQuerySchema.parse(req.query);

      const where: Record<string, unknown> = { tenantId };
      if (query.slipType) where.slipType = query.slipType;
      if (query.status) where.status = query.status;

      const [entries, total] = await Promise.all([
        prisma.waitlistEntry.findMany({
          where,
          orderBy: { queuePosition: "asc" },
          skip: (query.page - 1) * query.limit,
          take: query.limit,
          include: {
            customer: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
                phone: true,
              },
            },
            lead: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
                phone: true,
                stage: true,
              },
            },
          },
        }),
        prisma.waitlistEntry.count({ where }),
      ]);

      res.json({
        data: entries,
        pagination: {
          page: query.page,
          limit: query.limit,
          total,
          totalPages: Math.ceil(total / query.limit),
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

// ─── GET /:id — Get entry details ──────────────────────────────────────────

router.get(
  "/:id",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;

      const entry = await prisma.waitlistEntry.findFirst({
        where: { id: req.params.id as string, tenantId },
        include: {
          customer: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              phone: true,
              status: true,
            },
          },
          lead: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              phone: true,
              stage: true,
              boatLength: true,
              slipType: true,
            },
          },
        },
      });

      if (!entry) {
        throw appError("Waitlist entry not found", 404, "NOT_FOUND");
      }

      res.json(entry);
    } catch (err) {
      next(err);
    }
  },
);

// ─── POST / — Add to waitlist ───────────────────────────────────────────────

router.post(
  "/",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const data = CreateWaitlistSchema.parse(req.body);

      // Must have either a customer or a lead
      if (!data.customerId && !data.leadId) {
        throw appError(
          "Either customerId or leadId is required",
          400,
          "MISSING_REFERENCE",
        );
      }

      // Verify customer exists if provided
      if (data.customerId) {
        const customer = await prisma.customer.findFirst({
          where: { id: data.customerId, tenantId },
        });
        if (!customer) {
          throw appError("Customer not found", 404, "CUSTOMER_NOT_FOUND");
        }
      }

      // Verify lead exists if provided
      if (data.leadId) {
        const lead = await prisma.lead.findFirst({
          where: { id: data.leadId, tenantId },
        });
        if (!lead) {
          throw appError("Lead not found", 404, "LEAD_NOT_FOUND");
        }
      }

      // Auto-assign queue position: max + 1 for the given slip type
      const maxPosition = await prisma.waitlistEntry.aggregate({
        where: {
          tenantId,
          slipType: data.slipType ?? undefined,
          status: { in: ["WAITING", "NOTIFIED", "HOLD"] },
        },
        _max: { queuePosition: true },
      });

      const queuePosition = (maxPosition._max.queuePosition ?? 0) + 1;

      const entry = await prisma.waitlistEntry.create({
        data: {
          tenantId,
          customerId: data.customerId,
          leadId: data.leadId,
          slipType: data.slipType,
          boatLength: data.boatLength,
          desiredDate: data.desiredDate,
          locationId: data.locationId,
          queuePosition,
          status: "WAITING",
        },
        include: {
          customer: {
            select: { id: true, firstName: true, lastName: true },
          },
          lead: {
            select: { id: true, firstName: true, lastName: true },
          },
        },
      });

      // Audit
      await prisma.auditLog.create({
        data: {
          tenantId,
          userId: req.userId,
          recordType: "WaitlistEntry",
          recordId: entry.id,
          action: "CREATED",
          changedFieldsJson: {
            queuePosition,
            slipType: data.slipType,
            customerId: data.customerId,
            leadId: data.leadId,
          },
        },
      });

      res.status(201).json(entry);
    } catch (err) {
      next(err);
    }
  },
);

// ─── PUT /:id — Update entry ────────────────────────────────────────────────

router.put(
  "/:id",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const data = UpdateWaitlistSchema.parse(req.body);

      const existing = await prisma.waitlistEntry.findFirst({
        where: { id: req.params.id as string, tenantId },
      });
      if (!existing) {
        throw appError("Waitlist entry not found", 404, "NOT_FOUND");
      }

      const updated = await prisma.waitlistEntry.update({
        where: { id: req.params.id as string },
        data,
      });

      // Audit
      await prisma.auditLog.create({
        data: {
          tenantId,
          userId: req.userId,
          recordType: "WaitlistEntry",
          recordId: updated.id,
          action: "UPDATED",
          changedFieldsJson: data,
        },
      });

      res.json(updated);
    } catch (err) {
      next(err);
    }
  },
);

// ─── DELETE /:id — Remove from waitlist ─────────────────────────────────────

router.delete(
  "/:id",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;

      const existing = await prisma.waitlistEntry.findFirst({
        where: { id: req.params.id as string, tenantId },
      });
      if (!existing) {
        throw appError("Waitlist entry not found", 404, "NOT_FOUND");
      }

      const removed = await prisma.waitlistEntry.update({
        where: { id: req.params.id as string },
        data: { status: "REMOVED" },
      });

      // Audit
      await prisma.auditLog.create({
        data: {
          tenantId,
          userId: req.userId,
          recordType: "WaitlistEntry",
          recordId: removed.id,
          action: "REMOVED",
          changedFieldsJson: { previousStatus: existing.status },
        },
      });

      res.json(removed);
    } catch (err) {
      next(err);
    }
  },
);

// ─── POST /notify-next — Trigger vacancy notification ───────────────────────

router.post(
  "/notify-next",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const { slipType, holdDurationHours } = NotifyNextSchema.parse(req.body);

      // Find next WAITING entry for the given slip type
      const nextEntry = await prisma.waitlistEntry.findFirst({
        where: {
          tenantId,
          slipType,
          status: "WAITING",
        },
        orderBy: { queuePosition: "asc" },
        include: {
          customer: {
            select: { id: true, firstName: true, lastName: true, email: true, phone: true },
          },
          lead: {
            select: { id: true, firstName: true, lastName: true, email: true, phone: true },
          },
        },
      });

      if (!nextEntry) {
        throw appError(
          `No waiting entries found for slip type: ${slipType}`,
          404,
          "NO_WAITING_ENTRIES",
        );
      }

      // Set HOLD status with expiry
      const holdExpiresAt = new Date();
      holdExpiresAt.setHours(holdExpiresAt.getHours() + holdDurationHours);

      const updated = await prisma.waitlistEntry.update({
        where: { id: nextEntry.id },
        data: {
          status: "HOLD",
          notifiedAt: new Date(),
          holdExpiresAt,
        },
        include: {
          customer: {
            select: { id: true, firstName: true, lastName: true, email: true, phone: true },
          },
          lead: {
            select: { id: true, firstName: true, lastName: true, email: true, phone: true },
          },
        },
      });

      // Audit
      await prisma.auditLog.create({
        data: {
          tenantId,
          userId: req.userId,
          recordType: "WaitlistEntry",
          recordId: updated.id,
          action: "NOTIFIED",
          changedFieldsJson: {
            slipType,
            holdExpiresAt: holdExpiresAt.toISOString(),
            holdDurationHours,
          },
        },
      });

      // In a real system, this would trigger an email/SMS notification.
      // For now, we return the entry so the caller can send the notification.

      res.json({
        message: "Next waitlist entry has been notified and placed on hold.",
        entry: updated,
        holdExpiresAt,
      });
    } catch (err) {
      next(err);
    }
  },
);

// ─── PUT /:id/accept — Customer accepts offer ──────────────────────────────

router.put(
  "/:id/accept",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const body = AcceptOfferSchema.parse(req.body);

      const entry = await prisma.waitlistEntry.findFirst({
        where: { id: req.params.id as string, tenantId },
      });

      if (!entry) {
        throw appError("Waitlist entry not found", 404, "NOT_FOUND");
      }

      if (entry.status !== "HOLD" && entry.status !== "NOTIFIED") {
        throw appError(
          `Entry must be in HOLD or NOTIFIED status to accept. Current: ${entry.status}`,
          400,
          "INVALID_STATUS",
        );
      }

      // Check hold hasn't expired
      if (entry.holdExpiresAt && entry.holdExpiresAt < new Date()) {
        throw appError(
          "Hold period has expired. The offer is no longer available.",
          400,
          "HOLD_EXPIRED",
        );
      }

      // Must have a customer to create a contract
      if (!entry.customerId) {
        throw appError(
          "Entry must have a customer to accept. Convert the lead first.",
          400,
          "NO_CUSTOMER",
        );
      }

      // Verify slip is available
      const slip = await prisma.slip.findFirst({
        where: { id: body.slipId, tenantId },
      });
      if (!slip) {
        throw appError("Slip not found", 404, "SLIP_NOT_FOUND");
      }
      if (slip.status !== "VACANT" && slip.status !== "RESERVED") {
        throw appError(
          `Slip is not available. Current status: ${slip.status}`,
          400,
          "SLIP_UNAVAILABLE",
        );
      }

      // Create contract and update everything in a transaction
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await prisma.$transaction(async (tx: any) => {
        // Create SlipContract
        const contract = await tx.slipContract.create({
          data: {
            tenantId,
            slipId: body.slipId,
            customerId: entry.customerId!,
            boatId: body.boatId,
            startDate: body.startDate,
            endDate: body.endDate,
            rateCents: body.rateCents,
            billingCycle: body.billingCycle,
            autoRenew: body.autoRenew,
            securityDepositCents: body.securityDepositCents,
            status: "ACTIVE",
          },
        });

        // Mark slip as occupied
        await tx.slip.update({
          where: { id: body.slipId },
          data: { status: "OCCUPIED" },
        });

        // Update waitlist entry
        const updatedEntry = await tx.waitlistEntry.update({
          where: { id: req.params.id as string },
          data: { status: "ACCEPTED" },
        });

        // Audit
        await tx.auditLog.create({
          data: {
            tenantId,
            userId: req.userId,
            recordType: "WaitlistEntry",
            recordId: entry.id,
            action: "ACCEPTED",
            changedFieldsJson: {
              contractId: contract.id,
              slipId: body.slipId,
              customerId: entry.customerId,
            },
          },
        });

        return { entry: updatedEntry, contract };
      });

      res.json({
        message: "Offer accepted. Contract created.",
        entry: result.entry,
        contract: result.contract,
      });
    } catch (err) {
      next(err);
    }
  },
);

// ─── PUT /:id/expire — Hold expired, notify next ───────────────────────────

router.put(
  "/:id/expire",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;

      const entry = await prisma.waitlistEntry.findFirst({
        where: { id: req.params.id as string, tenantId },
      });

      if (!entry) {
        throw appError("Waitlist entry not found", 404, "NOT_FOUND");
      }

      if (entry.status !== "HOLD" && entry.status !== "NOTIFIED") {
        throw appError(
          `Can only expire entries in HOLD or NOTIFIED status. Current: ${entry.status}`,
          400,
          "INVALID_STATUS",
        );
      }

      // Mark as expired
      const expired = await prisma.waitlistEntry.update({
        where: { id: req.params.id as string },
        data: { status: "EXPIRED" },
      });

      // Audit
      await prisma.auditLog.create({
        data: {
          tenantId,
          userId: req.userId,
          recordType: "WaitlistEntry",
          recordId: entry.id,
          action: "EXPIRED",
          changedFieldsJson: {
            previousStatus: entry.status,
            holdExpiresAt: entry.holdExpiresAt?.toISOString(),
          },
        },
      });

      // Find the next WAITING entry for the same slip type and auto-notify
      let nextEntry = null;
      if (entry.slipType) {
        const next = await prisma.waitlistEntry.findFirst({
          where: {
            tenantId,
            slipType: entry.slipType,
            status: "WAITING",
          },
          orderBy: { queuePosition: "asc" },
        });

        if (next) {
          const holdExpiresAt = new Date();
          holdExpiresAt.setHours(holdExpiresAt.getHours() + 48); // default 48h hold

          nextEntry = await prisma.waitlistEntry.update({
            where: { id: next.id },
            data: {
              status: "HOLD",
              notifiedAt: new Date(),
              holdExpiresAt,
            },
            include: {
              customer: {
                select: { id: true, firstName: true, lastName: true, email: true },
              },
              lead: {
                select: { id: true, firstName: true, lastName: true, email: true },
              },
            },
          });

          // Audit for the next entry
          await prisma.auditLog.create({
            data: {
              tenantId,
              userId: req.userId,
              recordType: "WaitlistEntry",
              recordId: next.id,
              action: "NOTIFIED",
              changedFieldsJson: {
                reason: "Previous entry expired",
                expiredEntryId: entry.id,
                holdExpiresAt: holdExpiresAt.toISOString(),
              },
            },
          });
        }
      }

      res.json({
        message: "Entry expired." + (nextEntry ? " Next in queue has been notified." : " No more entries in queue."),
        expiredEntry: expired,
        nextEntry,
      });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
