import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import type Stripe from "stripe";
import { clerkAuth } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";
import { requireStripe, calculateApplicationFee } from "../lib/stripe.js";
import { postPayment, postRefund } from "../services/gl-posting.js";
import { rollbackReservedRefund } from "../services/payment-refund.js";
import { voidQboPayment, createQboRefundReceipt } from "../services/qbo-sync.js";
import { v4 as uuid } from "uuid";

const router: Router = Router();

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
        status: string;
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
          select: {
            stripeAccountId: true,
            applicationFeePctBps: true,
            applicationFeeFixedCents: true,
          },
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

        const applicationFee = calculateApplicationFee(
          data.amountCents,
          tenant.applicationFeePctBps,
          tenant.applicationFeeFixedCents,
        );

        const paymentIntentParams: Stripe.PaymentIntentCreateParams = {
          amount: data.amountCents,
          currency: "usd",
          customer: customer.stripeCustomerId,
          confirm: true,
          off_session: true,
          application_fee_amount: applicationFee,
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
          paymentIntentParams,
          {
            stripeAccount: tenant.stripeAccountId,
            // idempotency on the invoice+amount pair guards retries.
            idempotencyKey: `pay-${data.invoiceId ?? data.customerId}-${data.amountCents}`,
          },
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
          const newStatus = (newBalance <= 0 ? "PAID" : invoice.status) as "PAID" | "DRAFT" | "ISSUED" | "PAST_DUE" | "VOID" | "COLLECTIONS";

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

router.post(
  "/:id/refund",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;

      const RefundSchema = z.object({
        amountCents: z.number().int().positive().optional(),
        reason: z.string().optional(),
      });

      const { amountCents: requestedAmount, reason } = RefundSchema.parse(
        req.body,
      );

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

      const newRefundedTotal = payment.refundedCents + refundAmount;
      const isFullRefund = newRefundedTotal === payment.amountCents;

      // Reserve-then-charge: first claim the refundable balance in the DB
      // with an optimistic-concurrency guard, then call Stripe. If Stripe
      // fails, the reservation is rolled back in a compensating
      // transaction so the ledger never diverges from the processor.
      // Concurrent refund attempts that lose the optimistic race fail
      // with REFUND_CONFLICT before any external charge is issued.
      const updated = await prisma.$transaction(async (tx) => {
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

        return tx.payment.findUniqueOrThrow({ where: { id: payment.id } });
      });

      // Phase 2: external Stripe refund. We've already locked the slot in
      // the DB, so concurrent callers will fail before reaching Stripe.
      // The idempotency key includes the prior refundedCents so two
      // separate partial refunds for the same dollar amount produce
      // distinct Stripe calls instead of being collapsed into one.
      if (payment.stripePaymentId) {
        const tenant = await prisma.tenant.findUnique({
          where: { id: tenantId },
          select: { stripeAccountId: true },
        });

        if (tenant?.stripeAccountId) {
          try {
            await requireStripe().refunds.create(
              {
                payment_intent: payment.stripePaymentId,
                amount: refundAmount,
                reason: "requested_by_customer",
              },
              {
                stripeAccount: tenant.stripeAccountId,
                idempotencyKey: `refund-${payment.id}-${payment.refundedCents}-${refundAmount}`,
              },
            );
          } catch (stripeErr) {
            // Compensating rollback: undo Phase 1 using atomic
            // decrements so a concurrent successful refund (which
            // could only have raced if it committed AFTER ours) is
            // not clobbered. If the rollback itself fails we log
            // loudly so an operator can reconcile manually.
            try {
              await rollbackReservedRefund({
                paymentId: payment.id,
                tenantId,
                paymentMethod: payment.method,
                paymentAmountCents: payment.amountCents,
                refundAmountCents: refundAmount,
                invoiceId: payment.invoice?.id ?? null,
              });
            } catch (rollbackErr) {
              console.error(
                `[payments] CRITICAL: refund rollback failed for ${payment.id} after Stripe error; manual reconciliation required.`,
                { stripeErr, rollbackErr },
              );
            }
            throw stripeErr;
          }
        }
      }

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
            isFullRefund,
            reason,
            previousStatus: payment.status,
            newStatus: updated.status,
          },
        },
      });

      // Best-effort QBO sync. Three cases:
      //
      // 1. Vanilla full refund (no prior partials): void the original QBO
      //    Payment so its books match Helm's REFUNDED status. This keeps
      //    QBO's COGS reversal in lockstep with the local invoice/payment.
      //
      // 2. Pure partial refund (not yet fully refunded): push a
      //    RefundReceipt for this event so the running sum of
      //    RefundReceipts in QBO equals Helm's `refundedCents`.
      //
      // 3. Final remainder after earlier partials (mixed partial→full
      //    sequence): also push a RefundReceipt for this remaining
      //    amount. We MUST NOT void here — the original payment already
      //    has prior RefundReceipts attached, and voiding the full
      //    payment on top of them would double-count refunds in QBO.
      //
      // Both paths swallow errors: createQboRefundReceipt persists the
      // failure to qbo_inventory_sync_refs so the Settings UI surfaces it
      // and the retry sweep can re-attempt the push.
      const hadPriorPartialRefunds = payment.refundedCents > 0;
      if (isFullRefund && !hadPriorPartialRefunds) {
        try {
          await voidQboPayment(payment.id, tenantId);
        } catch (err) {
          console.warn(`[payments] QBO void propagation failed for ${payment.id}:`, err);
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
            `[payments] QBO refund-receipt push failed for ${payment.id}:`,
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

export default router;
