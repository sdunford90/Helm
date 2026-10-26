import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { clerkAuth, requireRole, FINANCE_ROLES } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";
import { requireStripe } from "../lib/stripe.js";
import type { InvoiceStatus } from "@prisma/client";
import type Stripe from "stripe";
import { postPayment, postRefund } from "../services/gl-posting.js";
import { v4 as uuid } from "uuid";

const router = Router();

// ─── Zod Schemas ─────────────────────────────────────────────────────────────

const PaymentMethodEnum = z.enum([
  "CARD",
  "ACH",
  "CASH",
  "CHARGE_TO_SLIP",
  "GIFT_CARD",
]);

const PaymentStatusEnum = z.enum([
  "PENDING",
  "COMPLETED",
  "FAILED",
  "REFUNDED",
  "PARTIALLY_REFUNDED",
]);

const ListPaymentsQuerySchema = z.object({
  method: PaymentMethodEnum.optional(),
  status: PaymentStatusEnum.optional(),
  customerId: z.string().uuid().optional(),
  invoiceId: z.string().uuid().optional(),
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
  skip: z.coerce.number().int().min(0).default(0),
  take: z.coerce.number().int().positive().max(100).default(25),
  sortBy: z.enum(["createdAt", "postedDate", "amountCents"]).default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

const CreatePaymentSchema = z.object({
  invoiceId: z.string().uuid().optional(),
  customerId: z.string().uuid(),
  amountCents: z.number().int().positive(),
  method: PaymentMethodEnum,
  stripePaymentMethodId: z.string().optional(),
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

// ─── GET / — List payments ──────────────────────────────────────────────────

router.get(
  "/",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const query = ListPaymentsQuerySchema.parse(req.query);

      const where: Record<string, unknown> = { tenantId };

      if (query.method) where.method = query.method;
      if (query.status) where.status = query.status;
      if (query.customerId) where.customerId = query.customerId;
      if (query.invoiceId) where.invoiceId = query.invoiceId;

      if (query.dateFrom || query.dateTo) {
        const dateFilter: Record<string, Date> = {};
        if (query.dateFrom) dateFilter.gte = query.dateFrom;
        if (query.dateTo) dateFilter.lte = query.dateTo;
        where.postedDate = dateFilter;
      }

      const [payments, total] = await Promise.all([
        prisma.payment.findMany({
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
              },
            },
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

      res.json({
        data: payments,
        pagination: { skip: query.skip, take: query.take, total },
      });
    } catch (err) {
      next(err);
    }
  },
);

// ─── GET /:id — Payment detail ──────────────────────────────────────────────

router.get(
  "/:id",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;

      const payment = await prisma.payment.findFirst({
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
          invoice: {
            select: {
              id: true,
              invoiceNumber: true,
              totalCents: true,
              balanceCents: true,
              status: true,
              issuedDate: true,
              dueDate: true,
            },
          },
          achReturns: {
            select: {
              id: true,
              rCode: true,
              returnedAt: true,
              returnFeeCents: true,
              achBlockedSet: true,
            },
          },
        },
      });

      if (!payment) {
        throw appError("Payment not found", 404, "NOT_FOUND");
      }

      // Fetch GL entries for this payment
      const glEntries = await prisma.glEntry.findMany({
        where: {
          tenantId,
          sourceId: payment.id,
          sourceType: { in: ["PAYMENT", "REFUND"] },
        },
        include: {
          account: {
            select: { id: true, accountNumber: true, name: true, type: true },
          },
        },
        orderBy: { postedAt: "asc" },
      });

      res.json({ ...payment, glEntries });
    } catch (err) {
      next(err);
    }
  },
);

// ─── POST / — Record payment ────────────────────────────────────────────────

router.post(
  "/",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const data = CreatePaymentSchema.parse(req.body);

      // Verify customer
      const customer = await prisma.customer.findFirst({
        where: { id: data.customerId, tenantId },
        select: {
          id: true,
          stripeCustomerId: true,
          achBlocked: true,
        },
      });
      if (!customer) {
        throw appError("Customer not found", 404, "CUSTOMER_NOT_FOUND");
      }

      // If ACH, check for ACH block
      if (data.method === "ACH" && customer.achBlocked) {
        throw appError(
          "Customer is blocked from ACH payments due to prior returns",
          400,
          "ACH_BLOCKED",
        );
      }

      // Validate invoice if provided
      let invoice: {
        id: string;
        balanceCents: number;
        status: InvoiceStatus;
        customerId: string;
      } | null = null;

      if (data.invoiceId) {
        invoice = await prisma.invoice.findFirst({
          where: { id: data.invoiceId, tenantId },
          select: {
            id: true,
            balanceCents: true,
            status: true,
            customerId: true,
          },
        });

        if (!invoice) {
          throw appError("Invoice not found", 404, "INVOICE_NOT_FOUND");
        }

        if (invoice.customerId !== data.customerId) {
          throw appError(
            "Invoice does not belong to this customer",
            400,
            "CUSTOMER_MISMATCH",
          );
        }

        if (invoice.status === "VOID") {
          throw appError(
            "Cannot apply payment to a voided invoice",
            400,
            "INVOICE_VOID",
          );
        }

        if (invoice.status === "PAID") {
          throw appError(
            "Invoice is already fully paid",
            400,
            "ALREADY_PAID",
          );
        }

        if (data.amountCents > invoice.balanceCents) {
          throw appError(
            `Payment amount (${data.amountCents}) exceeds invoice balance (${invoice.balanceCents})`,
            400,
            "OVERPAYMENT",
          );
        }
      }

      // Process payment via Stripe for card/ACH
      let stripePaymentId: string | null = null;

      if (data.method === "CARD" || data.method === "ACH") {
        const tenant = await prisma.tenant.findUnique({
          where: { id: tenantId },
          select: { stripeAccountId: true },
        });

        if (!tenant?.stripeAccountId) {
          throw appError(
            "Stripe is not configured for this marina",
            400,
            "STRIPE_NOT_CONFIGURED",
          );
        }

        if (!customer.stripeCustomerId) {
          throw appError(
            "Customer does not have a Stripe account. Register a payment method first.",
            400,
            "NO_STRIPE_CUSTOMER",
          );
        }

        const paymentIntentParams: Record<string, unknown> = {
          amount: data.amountCents,
          currency: "usd",
          customer: customer.stripeCustomerId,
          confirm: true,
          off_session: true,
          metadata: {
            tenantId,
            customerId: data.customerId,
            invoiceId: data.invoiceId ?? "",
          },
        };

        if (data.stripePaymentMethodId) {
          paymentIntentParams.payment_method = data.stripePaymentMethodId;
        }

        if (data.method === "ACH") {
          paymentIntentParams.payment_method_types = ["us_bank_account"];
        } else {
          paymentIntentParams.automatic_payment_methods = {
            enabled: true,
            allow_redirects: "never",
          };
        }

        const paymentIntent = await requireStripe().paymentIntents.create(
          paymentIntentParams as unknown as Stripe.PaymentIntentCreateParams,
          { stripeAccount: tenant.stripeAccountId },
        );

        stripePaymentId = paymentIntent.id;

        // For ACH, payment may be pending initially
        if (
          paymentIntent.status !== "succeeded" &&
          paymentIntent.status !== "processing"
        ) {
          throw appError(
            `Payment failed: ${paymentIntent.status}`,
            400,
            "PAYMENT_FAILED",
          );
        }
      }

      // Record the payment and post GL
      const paymentId = uuid();
      const paymentStatus =
        data.method === "ACH" ? "PENDING" : "COMPLETED";

      const payment = await prisma.$transaction(async (tx) => {
        const pay = await tx.payment.create({
          data: {
            id: paymentId,
            tenantId,
            customerId: data.customerId,
            invoiceId: data.invoiceId ?? null,
            amountCents: data.amountCents,
            method: data.method,
            stripePaymentId,
            postedDate: new Date(),
            status: paymentStatus,
          },
          include: {
            customer: {
              select: { id: true, firstName: true, lastName: true },
            },
            invoice: {
              select: {
                id: true,
                invoiceNumber: true,
                totalCents: true,
                balanceCents: true,
              },
            },
          },
        });

        // Post GL entry: debit Cash/Bank, credit A/R
        // For ACH, GL posting happens when payment settles (webhook)
        if (paymentStatus === "COMPLETED") {
          await postPayment(
            {
              id: paymentId,
              tenantId,
              amountCents: data.amountCents,
              method: data.method,
            },
            tx,
          );
        }

        // Update invoice balance if applicable
        if (invoice) {
          const newBalance = invoice.balanceCents - data.amountCents;
          const newStatus = newBalance <= 0 ? "PAID" : invoice.status;

          await tx.invoice.update({
            where: { id: invoice.id },
            data: {
              balanceCents: Math.max(0, newBalance),
              status: newStatus,
            },
          });
        }

        return pay;
      });

      // Audit log
      await prisma.auditLog.create({
        data: {
          tenantId,
          userId: req.userId,
          userName: req.userRecord?.email,
          recordType: "Payment",
          recordId: payment.id,
          action: "CREATED",
          changedFieldsJson: {
            amountCents: data.amountCents,
            method: data.method,
            invoiceId: data.invoiceId,
            status: paymentStatus,
          },
        },
      });

      res.status(201).json(payment);
    } catch (err) {
      next(err);
    }
  },
);

// ─── POST /:id/refund — Refund payment ──────────────────────────────────────
//
// Refund safety:
//   * Cumulative cap: refundedCents tracks what has already been refunded;
//     a refund may never exceed amountCents - refundedCents (repeated partial
//     refunds used to be able to exceed the original payment).
//   * Atomic: the cap check and the increment are ONE conditional UPDATE
//     (`refundedCents <= amountCents - refund`) inside an interactive
//     transaction. The row stays locked until commit, so concurrent refunds
//     serialize; the loser sees count = 0 and gets 400.
//   * The Stripe refund runs inside that transaction, after the reservation:
//     if Stripe fails, the transaction rolls back and nothing is recorded.
//     A deterministic idempotency key (payment + cumulative position) makes a
//     retried request re-use the same Stripe refund instead of issuing a
//     second one.

const RefundSchema = z.object({
  amountCents: z.number().int().positive().optional(),
  reason: z.string().max(500).optional(),
});

/** Remaining refundable amount for a payment. */
export function refundableCents(payment: { amountCents: number; refundedCents: number }): number {
  return Math.max(0, payment.amountCents - payment.refundedCents);
}

router.post(
  "/:id/refund",
  requireRole(...FINANCE_ROLES),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const { amountCents: requestedAmount, reason } = RefundSchema.parse(req.body);

      const payment = await prisma.payment.findFirst({
        where: { id: req.params.id, tenantId },
        include: {
          invoice: {
            select: { id: true, balanceCents: true, totalCents: true, status: true },
          },
        },
      });

      if (!payment) {
        throw appError("Payment not found", 404, "NOT_FOUND");
      }

      if (payment.status === "REFUNDED") {
        throw appError("Payment is already fully refunded", 400, "ALREADY_REFUNDED");
      }

      if (payment.status === "FAILED") {
        throw appError("Cannot refund a failed payment", 400, "PAYMENT_FAILED");
      }

      const remaining = refundableCents(payment);
      const refundAmount = requestedAmount ?? remaining;

      if (refundAmount <= 0 || refundAmount > remaining) {
        throw appError(
          `Refund amount exceeds the refundable balance (${remaining} cents)`,
          400,
          "EXCESS_REFUND",
        );
      }

      // Resolve the Stripe account up front (outside the transaction).
      let stripeAccount: string | null = null;
      if (payment.stripePaymentId) {
        const tenant = await prisma.tenant.findUnique({
          where: { id: tenantId },
          select: { stripeAccountId: true },
        });
        if (!tenant?.stripeAccountId) {
          throw appError(
            "Stripe is not connected for this marina; cannot refund a card/ACH payment",
            400,
            "STRIPE_NOT_CONFIGURED",
          );
        }
        stripeAccount = tenant.stripeAccountId;
      }

      const updated = await prisma.$transaction(
        async (tx) => {
          // 1. Atomically reserve the refund against the cumulative cap.
          const reserved = await tx.payment.updateMany({
            where: {
              id: payment.id,
              tenantId,
              status: { notIn: ["REFUNDED", "FAILED"] },
              refundedCents: { lte: payment.amountCents - refundAmount },
            },
            data: { refundedCents: { increment: refundAmount } },
          });
          if (reserved.count !== 1) {
            throw appError(
              "Refund amount exceeds the refundable balance",
              400,
              "EXCESS_REFUND",
            );
          }

          const after = await tx.payment.findFirstOrThrow({
            where: { id: payment.id, tenantId },
            select: { refundedCents: true, amountCents: true },
          });
          const isFullRefund = after.refundedCents >= after.amountCents;

          // 2. Money movement (rolls the reservation back if it fails).
          if (payment.stripePaymentId && stripeAccount) {
            await requireStripe().refunds.create(
              {
                payment_intent: payment.stripePaymentId,
                amount: refundAmount,
                reason: "requested_by_customer",
              },
              {
                stripeAccount,
                idempotencyKey: `refund:${payment.id}:${after.refundedCents}:${refundAmount}`,
              },
            );
          }

          // 3. Ledger + status + invoice balance, same transaction.
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

          const pay = await tx.payment.update({
            where: { id: payment.id },
            data: { status: isFullRefund ? "REFUNDED" : "PARTIALLY_REFUNDED" },
          });

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
        },
        { timeout: 20_000 },
      );

      // Audit log
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
            refundedCentsTotal: updated.refundedCents,
            isFullRefund: updated.status === "REFUNDED",
            reason,
            previousStatus: payment.status,
            newStatus: updated.status,
          },
        },
      });

      res.json(updated);
    } catch (err) {
      next(err);
    }
  },
);

export default router;
