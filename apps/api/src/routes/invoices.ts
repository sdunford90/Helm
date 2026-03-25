import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { clerkAuth } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";
import { calculateTax } from "../services/tax-engine.js";
import { postInvoice, postVoid } from "../services/gl-posting.js";
import { createDeferredSchedule } from "../services/deferred-revenue.js";
import { queues } from "../lib/queue.js";
import { v4 as uuid } from "uuid";

const router = Router();

// ─── Zod Schemas ─────────────────────────────────────────────────────────────

const InvoiceStatusEnum = z.enum([
  "DRAFT",
  "ISSUED",
  "PAID",
  "PAST_DUE",
  "VOID",
  "COLLECTIONS",
]);

const ListInvoicesQuerySchema = z.object({
  status: InvoiceStatusEnum.optional(),
  customerId: z.string().uuid().optional(),
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
  overdue: z.coerce.boolean().optional(),
  skip: z.coerce.number().int().min(0).default(0),
  take: z.coerce.number().int().positive().max(100).default(25),
  sortBy: z
    .enum(["createdAt", "issuedDate", "dueDate", "totalCents", "invoiceNumber"])
    .default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

const LineItemSchema = z.object({
  description: z.string().min(1),
  quantity: z.number().positive().default(1),
  unitPriceCents: z.number().int(),
  discountCents: z.number().int().min(0).default(0),
  glAccountId: z.string().uuid().optional().nullable(),
  isDeferred: z.boolean().default(false),
  taxCategory: z.string().optional(),
  sourceType: z.string().optional().nullable(),
  sourceId: z.string().optional().nullable(),
  deferredStartDate: z.coerce.date().optional(),
  deferredEndDate: z.coerce.date().optional(),
});

const CreateInvoiceSchema = z.object({
  customerId: z.string().uuid(),
  issuedDate: z.coerce.date(),
  dueDate: z.coerce.date(),
  lineItems: z.array(LineItemSchema).min(1),
});

const UpdateInvoiceSchema = z.object({
  issuedDate: z.coerce.date().optional(),
  dueDate: z.coerce.date().optional(),
  lineItems: z.array(LineItemSchema).min(1).optional(),
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

// ─── GET / — List invoices ──────────────────────────────────────────────────

router.get(
  "/",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const query = ListInvoicesQuerySchema.parse(req.query);

      const where: Record<string, unknown> = { tenantId };

      if (query.status) where.status = query.status;
      if (query.customerId) where.customerId = query.customerId;

      if (query.dateFrom || query.dateTo) {
        const dateFilter: Record<string, Date> = {};
        if (query.dateFrom) dateFilter.gte = query.dateFrom;
        if (query.dateTo) dateFilter.lte = query.dateTo;
        where.issuedDate = dateFilter;
      }

      if (query.overdue) {
        where.dueDate = { lt: new Date() };
        where.status = { in: ["ISSUED", "PAST_DUE"] };
      }

      const [invoices, total] = await Promise.all([
        prisma.invoice.findMany({
          where,
          orderBy: { [query.sortBy]: query.sortOrder },
          skip: query.skip,
          take: query.take,
          include: {
            customer: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
                company: true,
              },
            },
            _count: { select: { lineItems: true, payments: true } },
          },
        }),
        prisma.invoice.count({ where }),
      ]);

      res.json({
        data: invoices,
        pagination: { skip: query.skip, take: query.take, total },
      });
    } catch (err) {
      next(err);
    }
  },
);

// ─── GET /:id — Invoice detail ──────────────────────────────────────────────

router.get(
  "/:id",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;

      const invoice = await prisma.invoice.findFirst({
        where: { id: req.params.id, tenantId },
        include: {
          customer: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              company: true,
            },
          },
          lineItems: {
            include: {
              glAccount: {
                select: { id: true, accountNumber: true, name: true },
              },
            },
          },
          payments: {
            select: {
              id: true,
              amountCents: true,
              method: true,
              status: true,
              postedDate: true,
              stripePaymentId: true,
            },
          },
        },
      });

      if (!invoice) {
        throw appError("Invoice not found", 404, "NOT_FOUND");
      }

      // Fetch GL entries for this invoice
      const glEntries = await prisma.glEntry.findMany({
        where: {
          tenantId,
          sourceId: invoice.id,
          sourceType: { in: ["INVOICE", "VOID"] },
        },
        include: {
          account: {
            select: { id: true, accountNumber: true, name: true, type: true },
          },
        },
        orderBy: { postedAt: "asc" },
      });

      res.json({ ...invoice, glEntries });
    } catch (err) {
      next(err);
    }
  },
);

// ─── POST / — Create invoice ────────────────────────────────────────────────

router.post(
  "/",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const data = CreateInvoiceSchema.parse(req.body);

      // Verify customer exists
      const customer = await prisma.customer.findFirst({
        where: { id: data.customerId, tenantId },
        select: { id: true },
      });
      if (!customer) {
        throw appError("Customer not found", 404, "CUSTOMER_NOT_FOUND");
      }

      // Calculate tax for each line item
      const taxResult = await calculateTax(
        tenantId,
        data.customerId,
        data.lineItems.map((li) => ({
          description: li.description,
          amountCents: li.unitPriceCents * li.quantity - li.discountCents,
          taxCategory: li.taxCategory,
        })),
      );

      // Build line items with tax
      let subtotalCents = 0;
      let totalTaxCents = 0;

      const lineItemData = data.lineItems.map((li, idx) => {
        const extendedCents =
          li.unitPriceCents * li.quantity - li.discountCents;
        const taxCents = taxResult.items[idx]?.taxCents ?? 0;
        const taxRate = taxResult.items[idx]?.taxRate ?? 0;
        subtotalCents += extendedCents;
        totalTaxCents += taxCents;

        return {
          id: uuid(),
          description: li.description,
          quantity: li.quantity,
          unitPriceCents: li.unitPriceCents,
          discountCents: li.discountCents,
          taxRate,
          taxCents,
          extendedCents,
          glAccountId: li.glAccountId ?? null,
          isDeferred: li.isDeferred,
          sourceType: li.sourceType ?? null,
          sourceId: li.sourceId ?? null,
        };
      });

      const totalCents = subtotalCents + totalTaxCents;
      const invoiceNumber = `INV-${Date.now().toString(36).toUpperCase()}`;

      const invoice = await prisma.invoice.create({
        data: {
          tenantId,
          customerId: data.customerId,
          invoiceNumber,
          issuedDate: data.issuedDate,
          dueDate: data.dueDate,
          status: "DRAFT",
          subtotalCents,
          taxCents: totalTaxCents,
          totalCents,
          balanceCents: totalCents,
          lineItems: {
            createMany: { data: lineItemData },
          },
        },
        include: {
          lineItems: true,
          customer: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
        },
      });

      // Audit log
      await prisma.auditLog.create({
        data: {
          tenantId,
          userId: req.userId,
          userName: req.userRecord?.email,
          recordType: "Invoice",
          recordId: invoice.id,
          action: "CREATED",
          changedFieldsJson: { invoiceNumber, totalCents, status: "DRAFT" },
        },
      });

      res.status(201).json(invoice);
    } catch (err) {
      next(err);
    }
  },
);

// ─── PUT /:id — Update draft invoice ────────────────────────────────────────

router.put(
  "/:id",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const data = UpdateInvoiceSchema.parse(req.body);

      const existing = await prisma.invoice.findFirst({
        where: { id: req.params.id, tenantId },
        include: { lineItems: true },
      });

      if (!existing) {
        throw appError("Invoice not found", 404, "NOT_FOUND");
      }

      if (existing.status !== "DRAFT") {
        throw appError(
          "Only DRAFT invoices can be updated",
          400,
          "INVALID_STATUS",
        );
      }

      const updateData: Record<string, unknown> = {};
      if (data.issuedDate) updateData.issuedDate = data.issuedDate;
      if (data.dueDate) updateData.dueDate = data.dueDate;

      if (data.lineItems) {
        // Recalculate tax
        const taxResult = await calculateTax(
          tenantId,
          existing.customerId,
          data.lineItems.map((li) => ({
            description: li.description,
            amountCents: li.unitPriceCents * li.quantity - li.discountCents,
            taxCategory: li.taxCategory,
          })),
        );

        let subtotalCents = 0;
        let totalTaxCents = 0;

        const newLineItems = data.lineItems.map((li, idx) => {
          const extendedCents =
            li.unitPriceCents * li.quantity - li.discountCents;
          const taxCents = taxResult.items[idx]?.taxCents ?? 0;
          const taxRate = taxResult.items[idx]?.taxRate ?? 0;
          subtotalCents += extendedCents;
          totalTaxCents += taxCents;

          return {
            id: uuid(),
            description: li.description,
            quantity: li.quantity,
            unitPriceCents: li.unitPriceCents,
            discountCents: li.discountCents,
            taxRate,
            taxCents,
            extendedCents,
            glAccountId: li.glAccountId ?? null,
            isDeferred: li.isDeferred,
            sourceType: li.sourceType ?? null,
            sourceId: li.sourceId ?? null,
          };
        });

        const totalCents = subtotalCents + totalTaxCents;

        // Replace line items in a transaction
        const updated = await prisma.$transaction(async (tx) => {
          await tx.invoiceLineItem.deleteMany({
            where: { invoiceId: existing.id },
          });

          return tx.invoice.update({
            where: { id: existing.id },
            data: {
              ...updateData,
              subtotalCents,
              taxCents: totalTaxCents,
              totalCents,
              balanceCents: totalCents,
              lineItems: {
                createMany: { data: newLineItems },
              },
            },
            include: { lineItems: true },
          });
        });

        res.json(updated);
      } else {
        const updated = await prisma.invoice.update({
          where: { id: existing.id },
          data: updateData,
          include: { lineItems: true },
        });
        res.json(updated);
      }
    } catch (err) {
      next(err);
    }
  },
);

// ─── POST /:id/finalize — Finalize invoice ─────────────────────────────────

router.post(
  "/:id/finalize",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;

      const invoice = await prisma.invoice.findFirst({
        where: { id: req.params.id, tenantId },
        include: { lineItems: true },
      });

      if (!invoice) {
        throw appError("Invoice not found", 404, "NOT_FOUND");
      }

      if (invoice.status !== "DRAFT") {
        throw appError(
          "Only DRAFT invoices can be finalized",
          400,
          "INVALID_STATUS",
        );
      }

      const updated = await prisma.$transaction(async (tx) => {
        // Set status to ISSUED
        const inv = await tx.invoice.update({
          where: { id: invoice.id },
          data: {
            status: "ISSUED",
            pdfUrl: `/api/invoices/${invoice.id}/pdf`, // PDF generation placeholder
          },
          include: { lineItems: true },
        });

        // Post GL entries: debit A/R, credit revenue accounts
        await postInvoice(
          {
            id: inv.id,
            tenantId,
            totalCents: inv.totalCents,
            lineItems: inv.lineItems,
          },
          tx,
        );

        // Create deferred schedules for deferred line items
        for (const li of inv.lineItems) {
          if (li.isDeferred) {
            // Default: recognize over the next 12 months
            const start = new Date(inv.issuedDate);
            const end = new Date(start);
            end.setFullYear(end.getFullYear() + 1);
            end.setDate(end.getDate() - 1);

            await createDeferredSchedule(
              tenantId,
              { id: li.id, extendedCents: li.extendedCents, taxCents: li.taxCents },
              start,
              end,
            );
          }
        }

        return inv;
      });

      // QBO sync placeholder
      // await queues["qbo-sync"].add("sync-invoice", { tenantId, invoiceId: updated.id });

      // Audit log
      await prisma.auditLog.create({
        data: {
          tenantId,
          userId: req.userId,
          userName: req.userRecord?.email,
          recordType: "Invoice",
          recordId: updated.id,
          action: "FINALIZED",
          changedFieldsJson: { previousStatus: "DRAFT", newStatus: "ISSUED" },
        },
      });

      res.json(updated);
    } catch (err) {
      next(err);
    }
  },
);

// ─── POST /:id/void — Void invoice ─────────────────────────────────────────

router.post(
  "/:id/void",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;

      const invoice = await prisma.invoice.findFirst({
        where: { id: req.params.id, tenantId },
        include: {
          payments: { where: { status: "COMPLETED" } },
        },
      });

      if (!invoice) {
        throw appError("Invoice not found", 404, "NOT_FOUND");
      }

      if (invoice.status === "VOID") {
        throw appError("Invoice is already void", 400, "ALREADY_VOID");
      }

      if (invoice.payments.length > 0) {
        throw appError(
          "Cannot void an invoice with completed payments. Refund payments first.",
          400,
          "HAS_PAYMENTS",
        );
      }

      const updated = await prisma.$transaction(async (tx) => {
        // Reverse GL entries
        await postVoid({ id: invoice.id, tenantId }, tx);

        // Set status to VOID
        return tx.invoice.update({
          where: { id: invoice.id },
          data: {
            status: "VOID",
            balanceCents: 0,
          },
        });
      });

      // Audit log
      await prisma.auditLog.create({
        data: {
          tenantId,
          userId: req.userId,
          userName: req.userRecord?.email,
          recordType: "Invoice",
          recordId: updated.id,
          action: "VOIDED",
          changedFieldsJson: {
            previousStatus: invoice.status,
            newStatus: "VOID",
          },
        },
      });

      res.json(updated);
    } catch (err) {
      next(err);
    }
  },
);

// ─── POST /:id/send — Send invoice email ───────────────────────────────────

router.post(
  "/:id/send",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;

      const invoice = await prisma.invoice.findFirst({
        where: { id: req.params.id, tenantId },
        include: {
          customer: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
        },
      });

      if (!invoice) {
        throw appError("Invoice not found", 404, "NOT_FOUND");
      }

      if (invoice.status === "DRAFT") {
        throw appError(
          "Finalize the invoice before sending",
          400,
          "INVALID_STATUS",
        );
      }

      if (!invoice.customer.email) {
        throw appError(
          "Customer does not have an email address",
          400,
          "NO_EMAIL",
        );
      }

      // Queue email
      await queues.email.add("send-invoice", {
        tenantId,
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        customerId: invoice.customer.id,
        customerEmail: invoice.customer.email,
        customerName: `${invoice.customer.firstName} ${invoice.customer.lastName}`,
        totalCents: invoice.totalCents,
        dueDate: invoice.dueDate.toISOString(),
        pdfUrl: invoice.pdfUrl,
      });

      // Audit log
      await prisma.auditLog.create({
        data: {
          tenantId,
          userId: req.userId,
          userName: req.userRecord?.email,
          recordType: "Invoice",
          recordId: invoice.id,
          action: "SENT",
          changedFieldsJson: {
            sentTo: invoice.customer.email,
          },
        },
      });

      res.json({ message: "Invoice queued for delivery", invoiceId: invoice.id });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
