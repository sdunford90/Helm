import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { clerkAuth } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";
import { requireStripe } from "../lib/stripe.js";
import { getStripeAccountForCustomer } from "../lib/stripe-account.js";
import { mergeCustomers, undoMerge } from "../services/customer-merge.js";
import { postRefund } from "../services/gl-posting.js";
import { voidQboPayment } from "../services/qbo-sync.js";
import type Stripe from "stripe";

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

// ─── Stripe account resolver for customers ─────────────────────────────────
//
// Marina-staff payment-method operations need to talk to the Stripe Connect
// account that owns the customer's Stripe customer record. The shared
// resolver in `lib/stripe-account.ts` is the single source of truth for
// that mapping — both this route file and the recurring billing job import
// it so reads and writes always target the same account.

// Ensures the customer has a Stripe customer record in the given Connect
// account, creating one on the fly if missing. Persists the new id back to
// the local Customer row so subsequent calls reuse it.
async function ensureStripeCustomer(
  customerId: string,
  tenantId: string,
  stripeAccountId: string,
): Promise<string> {
  const customer = await prisma.customer.findFirst({
    where: { id: customerId, tenantId },
    select: {
      id: true,
      stripeCustomerId: true,
      email: true,
      firstName: true,
      lastName: true,
    },
  });
  if (!customer) {
    throw appError("Customer not found", 404, "NOT_FOUND");
  }
  if (customer.stripeCustomerId) return customer.stripeCustomerId;

  const stripe = requireStripe();
  const sc = await stripe.customers.create(
    {
      email: customer.email ?? undefined,
      name:
        [customer.firstName, customer.lastName].filter(Boolean).join(" ") ||
        undefined,
      metadata: { helmCustomerId: customer.id, tenantId },
    },
    { stripeAccount: stripeAccountId },
  );
  await prisma.customer.update({
    where: { id: customer.id },
    data: { stripeCustomerId: sc.id },
  });
  return sc.id;
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

      // Aggregate open invoice balance per customer
      const customerIds = customers.map((c) => c.id);
      const balanceRows = customerIds.length > 0
        ? await prisma.invoice.groupBy({
            by: ["customerId"],
            _sum: { balanceCents: true },
            where: {
              customerId: { in: customerIds },
              tenantId,
              status: { in: ["ISSUED", "PAST_DUE"] },
            },
          })
        : [];

      const balanceMap = new Map(
        balanceRows.map((r) => [r.customerId, r._sum.balanceCents ?? 0]),
      );

      const data = customers.map((c) => ({
        ...c,
        openBalanceCents: balanceMap.get(c.id) ?? 0,
      }));

      res.json({
        data,
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
      const [openInvoices, credits, depositsHeld, lifetimeValueAgg] = await Promise.all([
        prisma.invoice.aggregate({
          _sum: { balanceCents: true },
          where: { customerId: customer.id, tenantId, status: { in: ["ISSUED", "PAST_DUE"] } },
        }),
        prisma.payment.aggregate({
          _sum: { amountCents: true },
          where: { customerId: customer.id, tenantId, invoiceId: null, status: "COMPLETED" },
        }),
        prisma.securityDeposit.aggregate({
          _sum: { amountCents: true },
          where: { customerId: customer.id, tenantId, status: "HELD" },
        }),
        prisma.invoice.aggregate({
          _sum: { totalCents: true },
          where: { customerId: customer.id, tenantId, status: "PAID" },
        }),
      ]);

      res.json({
        ...customer,
        invoiceSummary,
        complianceScore,
        // Flat fields expected by CustomerDetail.tsx
        totalBoats: customer.boats.length,
        activeContracts: customer.slipContracts.filter((c: any) => c.status === "ACTIVE").length,
        lifetimeValue: ((lifetimeValueAgg._sum.totalCents ?? 0) / 100),
        openInvoices: ((openInvoices._sum.balanceCents ?? 0) / 100),
        credits: ((credits._sum.amountCents ?? 0) / 100),
        deposits: ((depositsHeld._sum.amountCents ?? 0) / 100),
        // Also keep nested for any other consumers
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

// ─── Customer Documents ─────────────────────────────────────────────────────

const CreateDocumentSchema = z.object({
  category: z.string().min(1).max(64),
  filename: z.string().min(1).max(255),
  contentType: z.string().min(1).max(128),
  sizeBytes: z.number().int().nonnegative(),
  storageKey: z.string().min(1).max(512),
});

router.get(
  "/:id/documents",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const customerId = req.params.id;

      const customer = await prisma.customer.findFirst({
        where: { id: customerId, tenantId },
        select: { id: true },
      });
      if (!customer) throw appError("Customer not found", 404, "NOT_FOUND");

      const docs = await prisma.customerDocument.findMany({
        where: { customerId },
        orderBy: { createdAt: "desc" },
      });
      res.json(docs);
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/:id/documents",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const customerId = req.params.id;
      const body = CreateDocumentSchema.parse(req.body);

      // Ensure key belongs to this tenant (presigned upload places objects
      // under `${tenantId}/...`). This prevents cross-tenant linking.
      if (!body.storageKey.startsWith(`${tenantId}/`)) {
        throw appError("Invalid storage key", 400, "INVALID_STORAGE_KEY");
      }

      const customer = await prisma.customer.findFirst({
        where: { id: customerId, tenantId },
        select: { id: true },
      });
      if (!customer) throw appError("Customer not found", 404, "NOT_FOUND");

      const doc = await prisma.customerDocument.create({
        data: {
          tenantId,
          customerId,
          category: body.category,
          filename: body.filename,
          contentType: body.contentType,
          sizeBytes: body.sizeBytes,
          storageKey: body.storageKey,
          uploadedById: req.userId ?? null,
        } as any,
      });

      res.status(201).json(doc);
    } catch (err) {
      next(err);
    }
  },
);

router.delete(
  "/:id/documents/:docId",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const { id: customerId, docId } = req.params;

      const doc = await prisma.customerDocument.findFirst({
        where: { id: docId, customerId, tenantId },
      });
      if (!doc) throw appError("Document not found", 404, "NOT_FOUND");

      await prisma.customerDocument.delete({ where: { id: docId } });
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  },
);

// ─── Payment History ────────────────────────────────────────────────────────
//
// Returns this customer's payments newest-first with the fields needed for
// the marina-portal payment-history view: date, amount, method, status,
// related invoice (if any), and who recorded the payment (looked up from
// the Payment-CREATED audit log).

const PaymentHistoryQuerySchema = z.object({
  skip: z.coerce.number().int().min(0).default(0),
  take: z.coerce.number().int().positive().max(100).default(25),
});

router.get(
  "/:id/payment-history",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const customerId = req.params.id;
      const { skip, take } = PaymentHistoryQuerySchema.parse(req.query);

      const customer = await prisma.customer.findFirst({
        where: { id: customerId, tenantId },
        select: { id: true },
      });
      if (!customer) throw appError("Customer not found", 404, "NOT_FOUND");

      const where = { customerId, tenantId };

      const [payments, total] = await Promise.all([
        prisma.payment.findMany({
          where,
          orderBy: [{ postedDate: "desc" }, { createdAt: "desc" }],
          skip,
          take,
          include: {
            invoice: {
              select: {
                id: true,
                invoiceNumber: true,
                totalCents: true,
                balanceCents: true,
                status: true,
              },
            },
          },
        }),
        prisma.payment.count({ where }),
      ]);

      // Resolve "recorded by" via the Payment-CREATED audit log entries.
      const paymentIds = payments.map((p) => p.id);
      const auditLogs = paymentIds.length
        ? await prisma.auditLog.findMany({
            where: {
              tenantId,
              recordType: "Payment",
              recordId: { in: paymentIds },
              action: "CREATED",
            },
            select: { recordId: true, userName: true, userId: true },
          })
        : [];

      const recordedByMap = new Map<string, { userId: string | null; userName: string | null }>();
      for (const log of auditLogs) {
        if (!recordedByMap.has(log.recordId)) {
          recordedByMap.set(log.recordId, {
            userId: log.userId,
            userName: log.userName,
          });
        }
      }

      const data = payments.map((p) => ({
        id: p.id,
        amountCents: p.amountCents,
        method: p.method,
        status: p.status,
        postedDate: p.postedDate,
        createdAt: p.createdAt,
        stripePaymentId: p.stripePaymentId,
        invoice: p.invoice
          ? {
              id: p.invoice.id,
              invoiceNumber: p.invoice.invoiceNumber,
              totalCents: p.invoice.totalCents,
              balanceCents: p.invoice.balanceCents,
              status: p.invoice.status,
            }
          : null,
        recordedBy: recordedByMap.get(p.id) ?? { userId: null, userName: null },
      }));

      res.json({
        data,
        pagination: { skip, take, total },
      });
    } catch (err) {
      next(err);
    }
  },
);

// ─── POST /:id/payments/:paymentId/refund — Refund a payment from history ──
//
// Lets staff issue a full or partial refund directly from the customer's
// Payment History without navigating to the underlying invoice. Mirrors the
// existing /api/payments/:id/refund handler but routes the Stripe refund
// through the per-location Stripe Connect account (derived from the
// payment's invoice's location, with a customer-level fallback for legacy
// payments that have no invoice attached).

const RefundPaymentFromHistorySchema = z.object({
  amountCents: z.number().int().positive().optional(),
  reason: z.string().max(500).optional(),
});

router.post(
  "/:id/payments/:paymentId/refund",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const customerId = req.params.id;
      const paymentId = req.params.paymentId;

      const { amountCents: requestedAmount, reason } =
        RefundPaymentFromHistorySchema.parse(req.body);

      const customer = await prisma.customer.findFirst({
        where: { id: customerId, tenantId },
        select: { id: true },
      });
      if (!customer) {
        throw appError("Customer not found", 404, "NOT_FOUND");
      }

      const payment = await prisma.payment.findFirst({
        where: { id: paymentId, tenantId, customerId },
        include: {
          invoice: {
            select: {
              id: true,
              balanceCents: true,
              totalCents: true,
              status: true,
              location: {
                select: {
                  stripeAccountId: true,
                },
              },
            },
          },
        },
      });

      if (!payment) {
        throw appError("Payment not found", 404, "NOT_FOUND");
      }

      if (payment.status === "REFUNDED") {
        throw appError(
          "Payment is already fully refunded",
          400,
          "ALREADY_REFUNDED",
        );
      }

      if (payment.status === "FAILED") {
        throw appError(
          "Cannot refund a failed payment",
          400,
          "PAYMENT_FAILED",
        );
      }

      const refundAmount = requestedAmount ?? payment.amountCents;

      if (refundAmount > payment.amountCents) {
        throw appError(
          "Refund amount exceeds payment amount",
          400,
          "EXCESS_REFUND",
        );
      }

      // Process Stripe refund if applicable. Resolve the Stripe Connect
      // account the same way payments are routed: prefer the payment's
      // invoice's location, fall back to the customer-derived account
      // (most-recent invoice's location, then tenant) for legacy payments.
      if (payment.stripePaymentId) {
        let stripeAccountId: string | null =
          payment.invoice?.location?.stripeAccountId ?? null;

        if (!stripeAccountId) {
          const fallback = await getStripeAccountForCustomer(
            customerId,
            tenantId,
          );
          stripeAccountId = fallback.stripeAccountId;
        }

        if (!stripeAccountId) {
          throw appError(
            "Stripe is not configured for this payment's location",
            400,
            "STRIPE_NOT_CONFIGURED",
          );
        }

        await requireStripe().refunds.create(
          {
            payment_intent: payment.stripePaymentId,
            amount: refundAmount,
            reason: "requested_by_customer",
          },
          {
            stripeAccount: stripeAccountId,
            idempotencyKey: `refund-${payment.id}-${refundAmount}`,
          },
        );
      }

      const isFullRefund = refundAmount === payment.amountCents;

      const updated = await prisma.$transaction(async (tx) => {
        // Reverse GL entries
        await postRefund(
          {
            id: payment.id,
            tenantId,
            amountCents: payment.amountCents,
            method: payment.method,
          },
          refundAmount,
          tx,
        );

        // Update payment status
        const pay = await tx.payment.update({
          where: { id: payment.id },
          data: {
            status: isFullRefund ? "REFUNDED" : "PARTIALLY_REFUNDED",
          },
        });

        // Reinstate invoice balance if applicable
        if (payment.invoice) {
          const newBalance = payment.invoice.balanceCents + refundAmount;
          await tx.invoice.update({
            where: { id: payment.invoice.id },
            data: {
              balanceCents: newBalance,
              status: newBalance > 0 ? "ISSUED" : payment.invoice.status,
            },
          });
        }

        return pay;
      });

      // Audit log records who issued the refund.
      await prisma.auditLog.create({
        data: {
          tenantId,
          userId: req.userId,
          userName: req.userRecord?.email,
          recordType: "Payment",
          recordId: payment.id,
          action: "REFUNDED",
          changedFieldsJson: {
            refundAmount,
            isFullRefund,
            reason,
            previousStatus: payment.status,
            newStatus: updated.status,
            issuedFrom: "customer-payment-history",
            customerId,
          },
        },
      });

      // Best-effort QBO void on full refund — keeps QBO's payment + COGS
      // state consistent. Partial refunds are not pushed (QBO models a
      // partial as a separate Refund Receipt which is out of scope).
      if (isFullRefund) {
        try {
          await voidQboPayment(payment.id, tenantId);
        } catch (err) {
          console.warn(
            `[customers] QBO void propagation failed for ${payment.id}:`,
            err,
          );
        }
      }

      res.json(updated);
    } catch (err) {
      next(err);
    }
  },
);

// ─── Saved payment methods (cards on file) ─────────────────────────────────
//
// These endpoints mirror the customer-portal payment-method routes but are
// scoped per-customer and routed through the customer's location's Stripe
// Connect account (matching how invoice payments are routed per-location).
// Staff initiate "save a card" via a Stripe-hosted Checkout setup session,
// so they never see or type the customer's raw card number.
//
// The response also exposes the customer's `autopay` flag (read from the
// Stripe customer's metadata) so the staff UI can show whether automatic
// charging is on for this customer.

router.get(
  "/:id/payment-methods",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const customerId = req.params.id;

      const customer = await prisma.customer.findFirst({
        where: { id: customerId, tenantId },
        select: { id: true, stripeCustomerId: true },
      });
      if (!customer) throw appError("Customer not found", 404, "NOT_FOUND");

      const account = await getStripeAccountForCustomer(customerId, tenantId);

      // No Stripe configured anywhere: surface a clear empty/no-config state.
      if (!account.stripeAccountId) {
        res.json({
          methods: [],
          defaultMethodId: null,
          autopay: false,
          stripeConfigured: false,
          locationConnected: account.locationConnected,
          locationName: account.locationName,
        });
        return;
      }

      // Account exists but onboarding still pending: surface the same warning
      // so staff don't see actionable buttons that will fail at submit time.
      if (!account.locationConnected) {
        res.json({
          methods: [],
          defaultMethodId: null,
          autopay: false,
          stripeConfigured: false,
          locationConnected: false,
          locationName: account.locationName,
        });
        return;
      }

      // No Stripe customer record yet — nothing to list, but Stripe IS set up.
      if (!customer.stripeCustomerId) {
        res.json({
          methods: [],
          defaultMethodId: null,
          autopay: false,
          stripeConfigured: true,
          locationConnected: true,
          locationName: account.locationName,
        });
        return;
      }

      const stripe = requireStripe();
      const stripeOpts = { stripeAccount: account.stripeAccountId };

      const [cardList, bankList, stripeCustomer] = await Promise.all([
        stripe.paymentMethods.list(
          { customer: customer.stripeCustomerId, type: "card" },
          stripeOpts,
        ),
        stripe.paymentMethods.list(
          { customer: customer.stripeCustomerId, type: "us_bank_account" },
          stripeOpts,
        ),
        stripe.customers.retrieve(customer.stripeCustomerId, {}, stripeOpts),
      ]);

      const sc = stripeCustomer as Stripe.Customer;
      const defaultMethodId =
        (typeof sc.invoice_settings?.default_payment_method === "string"
          ? sc.invoice_settings.default_payment_method
          : null) ??
        (typeof sc.default_source === "string" ? sc.default_source : null);
      const autopay = sc.metadata?.autopay === "true";

      const methods = [
        ...cardList.data.map((pm) => ({
          id: pm.id,
          kind: "card" as const,
          brand: pm.card?.brand ?? "card",
          label: (pm.card?.brand ?? "Card").replace(/^\w/, (c) => c.toUpperCase()),
          last4: pm.card?.last4 ?? "****",
          expMonth: pm.card?.exp_month ?? null,
          expYear: pm.card?.exp_year ?? null,
          expiry:
            pm.card?.exp_month && pm.card?.exp_year
              ? `${String(pm.card.exp_month).padStart(2, "0")}/${String(pm.card.exp_year).slice(-2)}`
              : null,
          isDefault: pm.id === defaultMethodId,
        })),
        ...bankList.data.map((pm) => ({
          id: pm.id,
          kind: "bank" as const,
          brand: "bank",
          label: pm.us_bank_account?.bank_name ?? "Bank Account",
          last4: pm.us_bank_account?.last4 ?? "****",
          expMonth: null,
          expYear: null,
          expiry: null,
          isDefault: pm.id === defaultMethodId,
        })),
      ];

      res.json({
        methods,
        defaultMethodId,
        autopay,
        stripeConfigured: true,
        locationConnected: true,
        locationName: account.locationName,
      });
    } catch (err) {
      next(err);
    }
  },
);

const SetupSessionSchema = z.object({
  type: z.enum(["card", "bank"]).default("card"),
  returnUrl: z.string().url(),
});

router.post(
  "/:id/payment-methods/setup-session",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const customerId = req.params.id;
      const { type, returnUrl } = SetupSessionSchema.parse(req.body);

      const customer = await prisma.customer.findFirst({
        where: { id: customerId, tenantId },
        select: { id: true },
      });
      if (!customer) throw appError("Customer not found", 404, "NOT_FOUND");

      const account = await getStripeAccountForCustomer(customerId, tenantId);
      if (!account.stripeAccountId || !account.locationConnected) {
        res.status(400).json({
          error: account.locationName
            ? `Stripe is not set up for ${account.locationName}.`
            : "Stripe is not set up for this location.",
          code: "STRIPE_NOT_CONFIGURED",
        });
        return;
      }

      const stripeCustomerId = await ensureStripeCustomer(
        customerId,
        tenantId,
        account.stripeAccountId,
      );

      const successUrl = returnUrl.includes("?")
        ? `${returnUrl}&setup=success`
        : `${returnUrl}?setup=success`;
      const cancelUrl = returnUrl.includes("?")
        ? `${returnUrl}&setup=cancelled`
        : `${returnUrl}?setup=cancelled`;

      const stripe = requireStripe();
      const session = await stripe.checkout.sessions.create(
        {
          mode: "setup",
          customer: stripeCustomerId,
          payment_method_types:
            type === "bank" ? ["us_bank_account"] : ["card"],
          success_url: successUrl,
          cancel_url: cancelUrl,
        },
        { stripeAccount: account.stripeAccountId },
      );

      await prisma.auditLog.create({
        data: {
          tenantId,
          userId: req.userId,
          userName: req.userRecord?.email,
          recordType: "Customer",
          recordId: customerId,
          action: "PAYMENT_METHOD_SETUP_STARTED",
          changedFieldsJson: { type },
        },
      });

      res.json({ url: session.url });
    } catch (err) {
      next(err);
    }
  },
);

router.put(
  "/:id/payment-methods/:pmId/default",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const customerId = req.params.id;
      const pmId = req.params.pmId;

      const customer = await prisma.customer.findFirst({
        where: { id: customerId, tenantId },
        select: { id: true, stripeCustomerId: true },
      });
      if (!customer) throw appError("Customer not found", 404, "NOT_FOUND");
      if (!customer.stripeCustomerId) {
        throw appError(
          "Customer has no saved payment methods",
          400,
          "NO_STRIPE_CUSTOMER",
        );
      }

      const account = await getStripeAccountForCustomer(customerId, tenantId);
      if (!account.stripeAccountId || !account.locationConnected) {
        res.status(400).json({
          error: account.locationName
            ? `Stripe is not set up for ${account.locationName}.`
            : "Stripe is not set up for this location.",
          code: "STRIPE_NOT_CONFIGURED",
        });
        return;
      }

      const stripe = requireStripe();
      const stripeOpts = { stripeAccount: account.stripeAccountId };

      // Verify the payment method belongs to this customer before mutating.
      const pm = await stripe.paymentMethods.retrieve(pmId, {}, stripeOpts);
      if (pm.customer !== customer.stripeCustomerId) {
        res.status(403).json({
          error: "Payment method does not belong to this customer",
          code: "FORBIDDEN",
        });
        return;
      }

      await stripe.customers.update(
        customer.stripeCustomerId,
        { invoice_settings: { default_payment_method: pmId } },
        stripeOpts,
      );

      await prisma.auditLog.create({
        data: {
          tenantId,
          userId: req.userId,
          userName: req.userRecord?.email,
          recordType: "Customer",
          recordId: customerId,
          action: "PAYMENT_METHOD_DEFAULT_SET",
          changedFieldsJson: { paymentMethodId: pmId },
        },
      });

      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  },
);

router.delete(
  "/:id/payment-methods/:pmId",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const customerId = req.params.id;
      const pmId = req.params.pmId;

      const customer = await prisma.customer.findFirst({
        where: { id: customerId, tenantId },
        select: { id: true, stripeCustomerId: true },
      });
      if (!customer) throw appError("Customer not found", 404, "NOT_FOUND");
      if (!customer.stripeCustomerId) {
        throw appError(
          "Customer has no saved payment methods",
          400,
          "NO_STRIPE_CUSTOMER",
        );
      }

      const account = await getStripeAccountForCustomer(customerId, tenantId);
      if (!account.stripeAccountId || !account.locationConnected) {
        res.status(400).json({
          error: account.locationName
            ? `Stripe is not set up for ${account.locationName}.`
            : "Stripe is not set up for this location.",
          code: "STRIPE_NOT_CONFIGURED",
        });
        return;
      }

      const stripe = requireStripe();
      const stripeOpts = { stripeAccount: account.stripeAccountId };

      // Verify ownership before detaching.
      const pm = await stripe.paymentMethods.retrieve(pmId, {}, stripeOpts);
      if (pm.customer !== customer.stripeCustomerId) {
        res.status(403).json({
          error: "Payment method does not belong to this customer",
          code: "FORBIDDEN",
        });
        return;
      }

      await stripe.paymentMethods.detach(pmId, {}, stripeOpts);

      await prisma.auditLog.create({
        data: {
          tenantId,
          userId: req.userId,
          userName: req.userRecord?.email,
          recordType: "Customer",
          recordId: customerId,
          action: "PAYMENT_METHOD_REMOVED",
          changedFieldsJson: { paymentMethodId: pmId },
        },
      });

      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// PUT /api/customers/:id/autopay  — staff-side autopay toggle
//
// Mirrors the customer-portal PUT /api/portal/autopay route: writes the
// `autopay` flag onto the Stripe customer's metadata on the correct Connect
// account, creating the Stripe customer record on the fly if needed (so the
// flag can be flipped from "off" → "on" before the customer ever logs in
// to the portal themselves). The recurring-billing job reads this same flag
// to decide whether to charge.
//
// Tenant-scoped: the customer is resolved with `{ id, tenantId }` and the
// Stripe call always uses `stripeAccount` from getStripeAccountForCustomer.
// ---------------------------------------------------------------------------
const AutopaySchema = z.object({ autopay: z.boolean() });

router.put(
  "/:id/autopay",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const customerId = req.params.id;
      const { autopay } = AutopaySchema.parse(req.body);

      const customer = await prisma.customer.findFirst({
        where: { id: customerId, tenantId },
        select: { id: true, stripeCustomerId: true },
      });
      if (!customer) throw appError("Customer not found", 404, "NOT_FOUND");

      const account = await getStripeAccountForCustomer(customerId, tenantId);
      if (!account.stripeAccountId || !account.locationConnected) {
        res.status(400).json({
          error: account.locationName
            ? `Stripe is not set up for ${account.locationName}.`
            : "Stripe is not set up for this location.",
          code: "STRIPE_NOT_CONFIGURED",
        });
        return;
      }

      // Block "turn ON" when there's no card on file. Staff still need a real
      // payment method before autopay can run, and silently letting them flip
      // the flag would leave the customer's next invoice open with no charge.
      // The "turn OFF" path is always allowed so staff can disable autopay
      // even if the customer's last card was just removed.
      if (autopay && customer.stripeCustomerId) {
        const stripe = requireStripe();
        const stripeOpts = { stripeAccount: account.stripeAccountId };
        const [cards, banks] = await Promise.all([
          stripe.paymentMethods.list(
            { customer: customer.stripeCustomerId, type: "card" },
            stripeOpts,
          ),
          stripe.paymentMethods.list(
            { customer: customer.stripeCustomerId, type: "us_bank_account" },
            stripeOpts,
          ),
        ]);
        if (cards.data.length === 0 && banks.data.length === 0) {
          res.status(400).json({
            error: "Add a card or bank account before enabling autopay.",
            code: "NO_PAYMENT_METHOD",
          });
          return;
        }
      } else if (autopay && !customer.stripeCustomerId) {
        res.status(400).json({
          error: "Add a card or bank account before enabling autopay.",
          code: "NO_PAYMENT_METHOD",
        });
        return;
      }

      const stripeCustomerId = await ensureStripeCustomer(
        customerId,
        tenantId,
        account.stripeAccountId,
      );

      const stripe = requireStripe();
      await stripe.customers.update(
        stripeCustomerId,
        { metadata: { autopay: String(autopay) } },
        { stripeAccount: account.stripeAccountId },
      );

      await prisma.auditLog.create({
        data: {
          tenantId,
          userId: req.userId,
          userName: req.userRecord?.email,
          recordType: "Customer",
          recordId: customerId,
          action: "AUTOPAY_CHANGED",
          changedFieldsJson: { autopay },
        },
      });

      res.json({ autopay });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
