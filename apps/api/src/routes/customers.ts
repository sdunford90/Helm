import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { clerkAuth } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";
import { requireStripe } from "../lib/stripe.js";
import { getStripeAccountForCustomer } from "../lib/stripe-account.js";
import { mergeCustomers, undoMerge } from "../services/customer-merge.js";
import { postRefund } from "../services/gl-posting.js";
import { rollbackReservedRefund } from "../services/payment-refund.js";
import { voidQboPayment, createQboRefundReceipt } from "../services/qbo-sync.js";
import type Stripe from "stripe";

const router: Router = Router();

// Mirrors the `isCardExpired` helper used in the staff and portal UIs:
// a card is expired once the current month has passed its (exp_month,
// exp_year). Bank accounts and PMs missing expiry data are treated as
// not-expired so we only block on data we're confident is stale.
function isStripeCardExpired(
  pm: Stripe.PaymentMethod,
  now: Date = new Date(),
): boolean {
  const exp_month = pm.card?.exp_month ?? null;
  const exp_year = pm.card?.exp_year ?? null;
  if (!exp_month || !exp_year) return false;
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  if (exp_year < currentYear) return true;
  if (exp_year === currentYear && exp_month < currentMonth) return true;
  return false;
}

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

      // Per-payment refund count so the UI can decide whether the row is
      // expandable. Cheaper than fetching every refund eagerly — the full
      // detail is loaded lazily when the user expands a row.
      const refundCounts = paymentIds.length
        ? await prisma.paymentRefund.groupBy({
            by: ["paymentId"],
            where: { tenantId, paymentId: { in: paymentIds } },
            _count: { _all: true },
          })
        : [];
      const refundCountMap = new Map<string, number>();
      for (const row of refundCounts) {
        refundCountMap.set(row.paymentId, row._count._all);
      }

      const data = payments.map((p) => ({
        id: p.id,
        amountCents: p.amountCents,
        refundedCents: p.refundedCents,
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
        refundCount: refundCountMap.get(p.id) ?? 0,
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
              locationId: true,
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

      const remainingRefundable = payment.amountCents - payment.refundedCents;

      if (remainingRefundable <= 0) {
        throw appError(
          "Payment is already fully refunded",
          400,
          "ALREADY_REFUNDED",
        );
      }

      const refundAmount = requestedAmount ?? remainingRefundable;

      if (refundAmount > remainingRefundable) {
        throw appError(
          "Refund amount exceeds remaining refundable balance",
          400,
          "EXCESS_REFUND",
        );
      }

      // Resolve the Stripe Connect account up front (so we fail fast if
      // it's missing) but defer the actual processor call until after we
      // have reserved the refundable balance in the DB.
      let stripeAccountId: string | null = null;
      if (payment.stripePaymentId) {
        stripeAccountId = payment.invoice?.location?.stripeAccountId ?? null;

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
      }

      const newRefundedTotal = payment.refundedCents + refundAmount;
      const isFullRefund = newRefundedTotal === payment.amountCents;

      // Reserve-then-charge: claim the refundable balance in the DB with
      // an optimistic-concurrency guard before calling Stripe. If Stripe
      // fails, the reservation is rolled back in a compensating
      // transaction so the ledger never diverges from the processor.
      // Concurrent refund attempts that lose the optimistic race fail
      // with REFUND_CONFLICT before any external charge is issued.
      const { updated, refundRow } = await prisma.$transaction(async (tx) => {
        const updateResult = await tx.payment.updateMany({
          where: { id: payment.id, refundedCents: payment.refundedCents },
          data: {
            refundedCents: newRefundedTotal,
            status: isFullRefund ? "REFUNDED" : "PARTIALLY_REFUNDED",
          },
        });

        if (updateResult.count === 0) {
          throw appError(
            "Refund conflicted with a concurrent refund; please retry",
            409,
            "REFUND_CONFLICT",
          );
        }

        // Per-refund history row written in the same transaction as the
        // running-total bump. Deleted by `rollbackReservedRefund` if the
        // external Stripe call later fails so the ledger and the history
        // both reflect only refunds that actually happened.
        const refund = await tx.paymentRefund.create({
          data: {
            tenantId,
            paymentId: payment.id,
            amountCents: refundAmount,
            reason: reason ?? null,
            userId: req.userId ?? null,
            userName: req.userRecord?.email ?? null,
            isFullRefund,
            source: "customer-payment-history",
          },
        });

        await postRefund(
          {
            id: payment.id,
            tenantId,
            amountCents: payment.amountCents,
            method: payment.method,
            // Per-location chart of accounts: route the A/R reinstate
            // and bank credit back to the same per-location rows the
            // original payment touched.
            locationId: payment.invoice?.locationId ?? null,
          },
          refundAmount,
          tx,
        );

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

        return {
          updated: await tx.payment.findUniqueOrThrow({
            where: { id: payment.id },
          }),
          refundRow: refund,
        };
      });

      // Phase 2: external Stripe refund. The DB slot is already locked,
      // so concurrent callers will fail before reaching Stripe. The
      // idempotency key includes the prior refundedCents so two separate
      // partial refunds for the same dollar amount produce distinct
      // Stripe calls instead of being collapsed into one.
      if (payment.stripePaymentId && stripeAccountId) {
        try {
          const stripeRefund = await requireStripe().refunds.create(
            {
              payment_intent: payment.stripePaymentId,
              amount: refundAmount,
              reason: "requested_by_customer",
            },
            {
              stripeAccount: stripeAccountId,
              idempotencyKey: `refund-${payment.id}-${payment.refundedCents}-${refundAmount}`,
            },
          );
          // Best-effort: tag the history row with the Stripe refund id for
          // cross-reference. A failure here does not undo the refund.
          if (stripeRefund?.id && refundRow?.id) {
            try {
              await prisma.paymentRefund.update({
                where: { id: refundRow.id },
                data: { stripeRefundId: stripeRefund.id },
              });
            } catch (tagErr) {
              console.warn(
                `[customers] Could not persist stripeRefundId on refund ${refundRow.id}:`,
                tagErr,
              );
            }
          }
        } catch (stripeErr) {
          // Compensating rollback: undo Phase 1 using atomic decrements
          // so a concurrent successful refund (which could only have
          // raced if it committed AFTER ours) is not clobbered. If
          // the rollback itself fails we log loudly so an operator
          // can reconcile manually.
          try {
            await rollbackReservedRefund({
              paymentId: payment.id,
              tenantId,
              paymentMethod: payment.method,
              paymentAmountCents: payment.amountCents,
              refundAmountCents: refundAmount,
              invoiceId: payment.invoice?.id ?? null,
              // Per-location chart of accounts: the inverse posting
              // must hit the same rows `postRefund` touched above.
              locationId: payment.invoice?.locationId ?? null,
              paymentRefundId: refundRow?.id ?? null,
            });
          } catch (rollbackErr) {
            console.error(
              `[customers] CRITICAL: refund rollback failed for ${payment.id} after Stripe error; manual reconciliation required.`,
              { stripeErr, rollbackErr },
            );
          }
          throw stripeErr;
        }
      }

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

      // Best-effort QBO sync. Three cases (see payments.ts for the full
      // rationale):
      //   1. Vanilla full refund (no prior partials) → void the QBO Payment.
      //   2. Pure partial refund → push a RefundReceipt for this event.
      //   3. Final remainder after earlier partials (mixed sequence) →
      //      also push a RefundReceipt; voiding here would double-count
      //      against the prior RefundReceipts already in QBO.
      // Failures are caught: createQboRefundReceipt persists them to
      // qbo_inventory_sync_refs so the Settings UI surfaces them and the
      // retry sweep can re-attempt the push.
      const hadPriorPartialRefunds = payment.refundedCents > 0;
      if (isFullRefund && !hadPriorPartialRefunds) {
        try {
          await voidQboPayment(payment.id, tenantId);
        } catch (err) {
          console.warn(
            `[customers] QBO void propagation failed for ${payment.id}:`,
            err,
          );
        }
      } else {
        try {
          await createQboRefundReceipt(
            payment.id,
            refundAmount,
            payment.refundedCents,
            tenantId,
          );
        } catch (err) {
          console.warn(
            `[customers] QBO refund-receipt push failed for ${payment.id}:`,
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

// ─── GET /:id/payments/:paymentId/refunds — Per-payment refund history ─────
//
// Returns every refund recorded against a single payment, oldest first, so
// the Payment History row in CustomerDetail can expand and show each partial
// refund as its own line — date, amount, reason, who issued it, and (when
// available) the upstream Stripe refund id. Loaded lazily by the UI when an
// operator expands a row.

router.get(
  "/:id/payments/:paymentId/refunds",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const customerId = req.params.id;
      const paymentId = req.params.paymentId;

      // Confirm the payment belongs to this customer (prevents leaking a
      // refund history by guessing a paymentId under a different customer).
      const payment = await prisma.payment.findFirst({
        where: { id: paymentId, tenantId, customerId },
        select: { id: true },
      });
      if (!payment) {
        throw appError("Payment not found", 404, "NOT_FOUND");
      }

      const refunds = await prisma.paymentRefund.findMany({
        where: { tenantId, paymentId },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          amountCents: true,
          reason: true,
          userId: true,
          userName: true,
          stripeRefundId: true,
          isFullRefund: true,
          source: true,
          createdAt: true,
        },
      });

      res.json({ data: refunds });
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
      // Optional ?locationId — used when the customer has multiple onboarded
      // locations and staff explicitly picked which one's Stripe account to
      // pull cards from. The resolver validates this against the tenant's
      // candidates list.
      const preferredLocationId =
        typeof req.query.locationId === "string" && req.query.locationId
          ? req.query.locationId
          : undefined;

      const customer = await prisma.customer.findFirst({
        where: { id: customerId, tenantId },
        select: { id: true, stripeCustomerId: true },
      });
      if (!customer) throw appError("Customer not found", 404, "NOT_FOUND");

      const account = await getStripeAccountForCustomer(
        customerId,
        tenantId,
        preferredLocationId,
      );

      // No Stripe configured anywhere: surface a clear empty/no-config state.
      if (!account.stripeAccountId) {
        res.json({
          methods: [],
          defaultMethodId: null,
          autopay: false,
          stripeConfigured: false,
          locationConnected: account.locationConnected,
          locationId: account.locationId,
          locationName: account.locationName,
          candidates: account.candidates,
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
          locationId: account.locationId,
          locationName: account.locationName,
          candidates: account.candidates,
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
          locationId: account.locationId,
          locationName: account.locationName,
          candidates: account.candidates,
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
        locationId: account.locationId,
        locationName: account.locationName,
        candidates: account.candidates,
      });
    } catch (err) {
      next(err);
    }
  },
);

const SetupSessionSchema = z.object({
  type: z.enum(["card", "bank"]).default("card"),
  returnUrl: z.string().url(),
  // Optional: when staff explicitly picked a location via the picker, pin
  // the setup session to that location's Stripe account.
  locationId: z.string().optional(),
});

router.post(
  "/:id/payment-methods/setup-session",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const customerId = req.params.id;
      const { type, returnUrl, locationId } = SetupSessionSchema.parse(req.body);

      const customer = await prisma.customer.findFirst({
        where: { id: customerId, tenantId },
        select: { id: true },
      });
      if (!customer) throw appError("Customer not found", 404, "NOT_FOUND");

      const account = await getStripeAccountForCustomer(
        customerId,
        tenantId,
        locationId,
      );
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
      // Also block when the default payment method is an expired card —
      // Stripe would decline the next off-session charge and produce a
      // confusing failure for the customer. The UI also disables the toggle
      // in that state; this is the server-side belt to the UI suspenders.
      // The "turn OFF" path is always allowed so staff can disable autopay
      // even if the customer's last card was just removed.
      if (autopay && customer.stripeCustomerId) {
        const stripe = requireStripe();
        const stripeOpts = { stripeAccount: account.stripeAccountId };
        const [cards, banks, stripeCustomer] = await Promise.all([
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
        if (cards.data.length === 0 && banks.data.length === 0) {
          res.status(400).json({
            error: "Add a card or bank account before enabling autopay.",
            code: "NO_PAYMENT_METHOD",
          });
          return;
        }
        const sc = stripeCustomer as Stripe.Customer;
        const defaultPmId =
          (typeof sc.invoice_settings?.default_payment_method === "string"
            ? sc.invoice_settings.default_payment_method
            : null) ??
          (typeof sc.default_source === "string" ? sc.default_source : null);
        const defaultCard = defaultPmId
          ? cards.data.find((c) => c.id === defaultPmId)
          : null;
        if (defaultCard && isStripeCardExpired(defaultCard)) {
          res.status(400).json({
            error:
              "The default card on file is expired. Pick a different default payment method or add a new card before enabling autopay.",
            code: "DEFAULT_CARD_EXPIRED",
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
