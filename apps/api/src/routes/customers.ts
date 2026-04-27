import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { clerkAuth } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";
import { mergeCustomers, undoMerge } from "../services/customer-merge.js";

const router: Router = Router();

// ─── Zod Schemas ─────────────────────────────────────────────────────────────

const CustomerStatusEnum = z.enum([
  "ACTIVE",
  "INACTIVE",
  "WAITLIST",
  "COLLECTIONS_HOLD",
  "SEASONAL",
]);

const CustomerAddressSchema = z
  .object({
    address: z.string().optional(),
    city: z.string().optional(),
    state: z.string().max(2).optional(),
    zip: z.string().max(10).optional(),
  })
  .optional()
  .nullable();

const CustomerEmergencyContactSchema = z
  .object({
    name: z.string().optional(),
    relationship: z.string().optional(),
    phone: z.string().optional(),
    email: z.string().email().optional().or(z.literal('')).optional(),
  })
  .optional()
  .nullable();

const CreateCustomerSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email().optional().nullable(),
  phone: z.string().optional().nullable(),
  company: z.string().optional().nullable(),
  addressJson: CustomerAddressSchema,
  dob: z.coerce.date().optional().nullable(),
  dlNumber: z.string().optional().nullable(),
  dlState: z.string().optional().nullable(),
  dlExpiry: z.coerce.date().optional().nullable(),
  emergencyContactJson: CustomerEmergencyContactSchema,
  status: CustomerStatusEnum.optional(),
  taxExempt: z.boolean().optional(),
  exemptionCertUrl: z.string().optional().nullable(),
  exemptionExpiry: z.coerce.date().optional().nullable(),
});

const UpdateCustomerSchema = z.object({
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  email: z.string().email().optional().nullable(),
  phone: z.string().optional().nullable(),
  company: z.string().optional().nullable(),
  addressJson: CustomerAddressSchema,
  dob: z.coerce.date().optional().nullable(),
  dlNumber: z.string().optional().nullable(),
  dlState: z.string().optional().nullable(),
  dlExpiry: z.coerce.date().optional().nullable(),
  emergencyContactJson: CustomerEmergencyContactSchema,
  status: CustomerStatusEnum.optional(),
  taxExempt: z.boolean().optional(),
  exemptionCertUrl: z.string().optional().nullable(),
  exemptionExpiry: z.coerce.date().optional().nullable(),
  achBlocked: z.boolean().optional(),
  stripeCustomerId: z.string().optional().nullable(),
});

const ListCustomersQuerySchema = z.object({
  status: CustomerStatusEnum.optional(),
  search: z.string().optional(),
  taxExempt: z.coerce.boolean().optional(),
  achBlocked: z.coerce.boolean().optional(),
  skip: z.coerce.number().int().min(0).default(0),
  take: z.coerce.number().int().positive().max(100).default(25),
  sortBy: z
    .enum(["createdAt", "updatedAt", "firstName", "lastName", "company"])
    .default("lastName"),
  sortOrder: z.enum(["asc", "desc"]).default("asc"),
});

const MergeCustomerSchema = z.object({
  targetCustomerId: z.string().uuid(),
  fieldChoices: z
    .object({
      email: z.enum(["primary", "secondary"]).optional(),
      phone: z.enum(["primary", "secondary"]).optional(),
      company: z.enum(["primary", "secondary"]).optional(),
      addressJson: z.enum(["primary", "secondary"]).optional(),
      emergencyContactJson: z.enum(["primary", "secondary"]).optional(),
    })
    .optional()
    .default({}),
});

const UndoMergeSchema = z.object({
  mergeId: z.string().min(1),
});

const TimelineQuerySchema = z.object({
  skip: z.coerce.number().int().min(0).default(0),
  take: z.coerce.number().int().positive().max(100).default(50),
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

// ─── GET / — List customers ─────────────────────────────────────────────────

router.get(
  "/",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const query = ListCustomersQuerySchema.parse(req.query);

      const where: Record<string, unknown> = { tenantId };

      if (query.status) where.status = query.status;
      if (query.taxExempt !== undefined) where.taxExempt = query.taxExempt;
      if (query.achBlocked !== undefined) where.achBlocked = query.achBlocked;

      if (query.search) {
        const search = query.search;
        where.OR = [
          { firstName: { contains: search, mode: "insensitive" } },
          { lastName: { contains: search, mode: "insensitive" } },
          { email: { contains: search, mode: "insensitive" } },
          { phone: { contains: search, mode: "insensitive" } },
          { company: { contains: search, mode: "insensitive" } },
        ];
      }

      const [customers, total] = await Promise.all([
        prisma.customer.findMany({
          where,
          orderBy: { [query.sortBy]: query.sortOrder },
          skip: query.skip,
          take: query.take,
          include: {
            boats: { select: { id: true, name: true, lengthFt: true } },
            _count: {
              select: {
                invoices: true,
                slipContracts: true,
              },
            },
          },
        }),
        prisma.customer.count({ where }),
      ]);

      res.json({
        data: customers,
        pagination: {
          skip: query.skip,
          take: query.take,
          total,
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

// ─── GET /:id — Get single customer with related data ───────────────────────

router.get(
  "/:id",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;

      const customer = await prisma.customer.findFirst({
        where: { id: req.params.id, tenantId },
        include: {
          boats: {
            include: {
              insuranceRecords: {
                orderBy: { expiryDate: "desc" },
                take: 1,
              },
              safetyRecords: {
                orderBy: { inspectionDate: "desc" },
                take: 1,
              },
            },
          },
          slipContracts: {
            include: {
              slip: { select: { id: true, slipNumber: true, dockId: true } },
              boat: { select: { id: true, name: true } },
            },
            orderBy: { startDate: "desc" },
          },
          securityDeposits: true,
        },
      });

      if (!customer) {
        throw appError("Customer not found", 404, "NOT_FOUND");
      }

      // Invoice summary
      const invoiceSummary = await prisma.invoice.groupBy({
        by: ["status"],
        _sum: { totalCents: true, balanceCents: true },
        _count: { id: true },
        where: { customerId: customer.id, tenantId },
      });

      // Compliance score: check all boats
      let complianceScore: "ALL_GOOD" | "ATTENTION_REQUIRED" | "NON_COMPLIANT" = "ALL_GOOD";
      for (const boat of customer.boats) {
        const latestInsurance = boat.insuranceRecords[0];
        const now = new Date();
        if (!latestInsurance) {
          complianceScore = "NON_COMPLIANT";
          break;
        }
        if (latestInsurance.expiryDate && latestInsurance.expiryDate < now) {
          complianceScore = "ATTENTION_REQUIRED";
        }
        if (!boat.registrationNumber) {
          complianceScore = "NON_COMPLIANT";
          break;
        }
        if (boat.registrationExpiry && boat.registrationExpiry < now) {
          complianceScore = "ATTENTION_REQUIRED";
        }
      }

      // Balance summary
      const openInvoices = await prisma.invoice.aggregate({
        _sum: { balanceCents: true },
        where: {
          customerId: customer.id,
          tenantId,
          status: { in: ["ISSUED", "PAST_DUE"] },
        },
      });

      const credits = await prisma.payment.aggregate({
        _sum: { amountCents: true },
        where: {
          customerId: customer.id,
          tenantId,
          invoiceId: null,
          status: "COMPLETED",
        },
      });

      const depositsHeld = await prisma.securityDeposit.aggregate({
        _sum: { amountCents: true },
        where: {
          customerId: customer.id,
          tenantId,
          status: "HELD",
        },
      });

      res.json({
        ...customer,
        invoiceSummary,
        complianceScore,
        balanceSummary: {
          openInvoicesTotalCents: openInvoices._sum.balanceCents ?? 0,
          creditsCents: credits._sum.amountCents ?? 0,
          securityDepositsHeldCents: depositsHeld._sum.amountCents ?? 0,
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

// ─── POST / — Create customer ───────────────────────────────────────────────

router.post(
  "/",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const data = CreateCustomerSchema.parse(req.body);

      const customer = await prisma.customer.create({
        data: {
          tenantId,
          ...data,
        } as any,
      });

      await prisma.auditLog.create({
        data: {
          tenantId,
          userId: req.userId,
          userName: req.userRecord?.email,
          recordType: "Customer",
          recordId: customer.id,
          action: "CREATED",
        },
      });

      res.status(201).json(customer);
    } catch (err) {
      next(err);
    }
  },
);

// ─── PUT /:id — Update customer ─────────────────────────────────────────────

router.put(
  "/:id",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const data = UpdateCustomerSchema.parse(req.body);

      const existing = await prisma.customer.findFirst({
        where: { id: req.params.id, tenantId },
      });
      if (!existing) {
        throw appError("Customer not found", 404, "NOT_FOUND");
      }

      const updated = await prisma.customer.update({
        where: { id: req.params.id },
        data: data as any,
      });

      // Audit changed fields
      const changedFields: Record<string, unknown> = {};
      for (const key of Object.keys(data) as (keyof typeof data)[]) {
        if (data[key] !== undefined) {
          changedFields[key] = {
            from: (existing as Record<string, unknown>)[key],
            to: data[key],
          };
        }
      }

      await prisma.auditLog.create({
        data: {
          tenantId,
          userId: req.userId,
          recordType: "Customer",
          recordId: updated.id,
          action: "UPDATED",
          changedFieldsJson: changedFields,
        },
      });

      res.json(updated);
    } catch (err) {
      next(err);
    }
  },
);

// ─── DELETE /:id — Soft delete (set INACTIVE) ──────────────────────────────

router.delete(
  "/:id",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;

      const customer = await prisma.customer.findFirst({
        where: { id: req.params.id, tenantId },
      });
      if (!customer) {
        throw appError("Customer not found", 404, "NOT_FOUND");
      }

      const updated = await prisma.customer.update({
        where: { id: req.params.id },
        data: { status: "INACTIVE" },
      });

      await prisma.auditLog.create({
        data: {
          tenantId,
          userId: req.userId,
          recordType: "Customer",
          recordId: updated.id,
          action: "DEACTIVATED",
          changedFieldsJson: { previousStatus: customer.status },
        },
      });

      res.json(updated);
    } catch (err) {
      next(err);
    }
  },
);

// ─── GET /:id/timeline — Activity timeline ─────────────────────────────────

router.get(
  "/:id/timeline",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const { skip, take } = TimelineQuerySchema.parse(req.query);

      const customer = await prisma.customer.findFirst({
        where: { id: req.params.id, tenantId },
        select: { id: true },
      });
      if (!customer) {
        throw appError("Customer not found", 404, "NOT_FOUND");
      }

      const customerId = req.params.id;

      // Gather events from multiple sources in parallel
      const [invoices, payments, auditLogs, dockWalkItems, announcements] =
        await Promise.all([
          prisma.invoice.findMany({
            where: { customerId, tenantId },
            select: {
              id: true,
              invoiceNumber: true,
              status: true,
              totalCents: true,
              issuedDate: true,
              createdAt: true,
            },
            orderBy: { createdAt: "desc" },
            take: 50,
          }),
          prisma.payment.findMany({
            where: { customerId, tenantId },
            select: {
              id: true,
              amountCents: true,
              method: true,
              status: true,
              postedDate: true,
              createdAt: true,
            },
            orderBy: { createdAt: "desc" },
            take: 50,
          }),
          prisma.auditLog.findMany({
            where: {
              tenantId,
              recordType: "Customer",
              recordId: customerId,
            },
            orderBy: { createdAt: "desc" },
            take: 50,
          }),
          // Dock walk items via slips with active contracts for this customer
          prisma.dockWalkItem.findMany({
            where: {
              slip: {
                contracts: {
                  some: { customerId, status: "ACTIVE" },
                },
              },
            },
            include: {
              dockWalk: {
                select: { id: true, startedAt: true, status: true },
              },
              slip: { select: { id: true, slipNumber: true } },
            },
            orderBy: { dockWalk: { startedAt: "desc" } },
            take: 20,
          }),
          prisma.announcementDelivery.findMany({
            where: { customerId },
            include: {
              announcement: {
                select: { id: true, subject: true, sentAt: true },
              },
            },
            orderBy: { announcement: { sentAt: "desc" } },
            take: 20,
          }),
        ]);

      // Build unified timeline
      type TimelineEvent = {
        type: string;
        id: string;
        timestamp: Date;
        data: Record<string, unknown>;
      };

      const timeline: TimelineEvent[] = [];

      for (const inv of invoices) {
        timeline.push({
          type: "INVOICE",
          id: inv.id,
          timestamp: inv.createdAt,
          data: {
            invoiceNumber: inv.invoiceNumber,
            status: inv.status,
            totalCents: inv.totalCents,
            issuedDate: inv.issuedDate,
          },
        });
      }

      for (const pay of payments) {
        timeline.push({
          type: "PAYMENT",
          id: pay.id,
          timestamp: pay.createdAt,
          data: {
            amountCents: pay.amountCents,
            method: pay.method,
            status: pay.status,
            postedDate: pay.postedDate,
          },
        });
      }

      for (const log of auditLogs) {
        timeline.push({
          type: "NOTE",
          id: log.id,
          timestamp: log.createdAt,
          data: {
            action: log.action,
            userName: log.userName,
            changedFields: log.changedFieldsJson,
          },
        });
      }

      for (const item of dockWalkItems) {
        timeline.push({
          type: "DOCK_WALK",
          id: item.id,
          timestamp: item.dockWalk.startedAt,
          data: {
            slipNumber: item.slip?.slipNumber,
            status: item.status,
            notes: item.notes,
            violationType: item.violationType,
          },
        });
      }

      for (const del of announcements) {
        timeline.push({
          type: "ANNOUNCEMENT",
          id: del.id,
          timestamp: del.announcement.sentAt ?? new Date(0),
          data: {
            subject: del.announcement.subject,
            channel: del.channel,
            deliveryStatus: del.status,
            openedAt: del.openedAt,
          },
        });
      }

      // Sort chronologically descending
      timeline.sort(
        (a, b) => b.timestamp.getTime() - a.timestamp.getTime(),
      );

      // Apply pagination
      const paginated = timeline.slice(skip, skip + take);

      res.json({
        data: paginated,
        pagination: { skip, take, total: timeline.length },
      });
    } catch (err) {
      next(err);
    }
  },
);

// ─── GET /:id/balance — Balance summary ─────────────────────────────────────

router.get(
  "/:id/balance",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const customerId = req.params.id;

      const customer = await prisma.customer.findFirst({
        where: { id: customerId, tenantId },
        select: { id: true },
      });
      if (!customer) {
        throw appError("Customer not found", 404, "NOT_FOUND");
      }

      const [openInvoices, credits, depositsHeld, achReturns] =
        await Promise.all([
          prisma.invoice.aggregate({
            _sum: { balanceCents: true },
            _count: { id: true },
            where: {
              customerId,
              tenantId,
              status: { in: ["ISSUED", "PAST_DUE"] },
            },
          }),
          prisma.payment.aggregate({
            _sum: { amountCents: true },
            where: {
              customerId,
              tenantId,
              invoiceId: null,
              status: "COMPLETED",
            },
          }),
          prisma.securityDeposit.aggregate({
            _sum: { amountCents: true },
            _count: { id: true },
            where: {
              customerId,
              tenantId,
              status: "HELD",
            },
          }),
          prisma.achReturn.findMany({
            where: { customerId, tenantId },
            orderBy: { returnedAt: "desc" },
            select: {
              id: true,
              rCode: true,
              returnedAt: true,
              returnFeeCents: true,
              achBlockedSet: true,
            },
          }),
        ]);

      res.json({
        openInvoices: {
          totalCents: openInvoices._sum.balanceCents ?? 0,
          count: openInvoices._count.id,
        },
        creditsCents: credits._sum.amountCents ?? 0,
        securityDeposits: {
          heldTotalCents: depositsHeld._sum.amountCents ?? 0,
          count: depositsHeld._count.id,
        },
        achReturnHistory: achReturns,
      });
    } catch (err) {
      next(err);
    }
  },
);

// ─── POST /:id/merge — Customer merge ──────────────────────────────────────

router.post(
  "/:id/merge",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const primaryId = req.params.id;
      const { targetCustomerId, fieldChoices } =
        MergeCustomerSchema.parse(req.body);

      const result = await mergeCustomers(
        primaryId,
        targetCustomerId,
        fieldChoices,
        tenantId,
      );

      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

// ─── POST /:id/undo-merge — Undo merge within 15-min window ────────────────

router.post(
  "/:id/undo-merge",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const { mergeId } = UndoMergeSchema.parse(req.body);

      const result = await undoMerge(mergeId, tenantId);

      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

export default router;
