import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import type Stripe from "stripe";

import { clerkAuth } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";
import { requireStripe, calculateApplicationFee } from "../lib/stripe.js";

const router = Router();

// All checkout endpoints require an authenticated staff/customer session.
router.use(...clerkAuth());

// ---------------------------------------------------------------------------
// POST /api/checkout/invoice-session
//
// Creates an embedded Stripe Checkout Session (ui_mode: "elements") for paying
// a single invoice. The browser mounts a Payment Element backed by the
// returned client_secret; confirmation happens client-side via
// checkout.confirm(). Works the same for staff-initiated collection (staff
// stays in Helm; return_url is the invoice detail page) and customer
// self-pay in the portal (return_url is a thank-you page).
// ---------------------------------------------------------------------------

const InvoiceSessionSchema = z.object({
  invoiceId: z.string().uuid(),
  // Where Stripe should redirect after payment attempt. Must be an app URL.
  returnPath: z.string().min(1).default("/billing/invoices"),
  // "elements" (default) returns a client_secret for embedded Payment Element
  // rendering — used by the staff PaymentModal. "hosted" returns a Stripe-hosted
  // page URL — used by the customer portal so we don't have to embed Elements
  // in the portal too.
  uiMode: z.enum(["elements", "hosted"]).default("elements"),
});

router.post(
  "/invoice-session",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const { invoiceId, returnPath, uiMode } = InvoiceSessionSchema.parse(req.body);

      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: {
          stripeAccountId: true,
          applicationFeePctBps: true,
          applicationFeeFixedCents: true,
        },
      });
      if (!tenant?.stripeAccountId) {
        res.status(400).json({
          error: "Stripe is not connected for this marina",
          code: "STRIPE_NOT_CONFIGURED",
        });
        return;
      }

      const invoice = await prisma.invoice.findFirst({
        where: { id: invoiceId, tenantId },
        include: {
          customer: { select: { email: true, stripeCustomerId: true } },
        },
      });
      if (!invoice) {
        res.status(404).json({ error: "Invoice not found", code: "NOT_FOUND" });
        return;
      }
      if (invoice.balanceCents <= 0) {
        res.status(400).json({
          error: "Invoice has no outstanding balance",
          code: "NO_BALANCE",
        });
        return;
      }

      const appUrl = process.env.APP_URL ?? "http://localhost:5000";
      const applicationFee = calculateApplicationFee(
        invoice.balanceCents,
        tenant.applicationFeePctBps,
        tenant.applicationFeeFixedCents,
      );

      // setup_future_usage saves the payment method for later off-session use
      // (the "Charge card on file" button). This requires a Stripe Customer;
      // if the Helm Customer doesn't yet have one, tell Checkout to create
      // it and we'll persist the id via the checkout.session.completed webhook.
      const hasSavedCustomer = !!invoice.customer.stripeCustomerId;

      // Hosted mode returns a redirect URL (used by the portal). Elements
      // mode returns a client_secret for the embedded Payment Element.
      // Stripe requires different url params per mode: hosted expects
      // success_url/cancel_url, elements expects return_url.
      const commonParams = {
        mode: "payment" as const,
        customer: hasSavedCustomer
          ? invoice.customer.stripeCustomerId!
          : undefined,
        customer_email: hasSavedCustomer
          ? undefined
          : invoice.customer.email ?? undefined,
        customer_creation: hasSavedCustomer ? undefined : ("always" as const),
        line_items: [
          {
            price_data: {
              currency: "usd",
              product_data: { name: `Invoice ${invoice.invoiceNumber}` },
              unit_amount: invoice.balanceCents,
            },
            quantity: 1,
          },
        ],
        payment_intent_data: {
          application_fee_amount: applicationFee,
          setup_future_usage: "off_session" as const,
          metadata: {
            tenantId,
            invoiceId: invoice.id,
            customerId: invoice.customerId,
          },
        },
        metadata: {
          tenantId,
          invoiceId: invoice.id,
          customerId: invoice.customerId,
        },
      };

      const session =
        uiMode === "hosted"
          ? await requireStripe().checkout.sessions.create(
              {
                ...commonParams,
                success_url: `${appUrl}${returnPath}?session_id={CHECKOUT_SESSION_ID}`,
                cancel_url: `${appUrl}/invoices/${invoice.id}?canceled=true`,
              },
              { stripeAccount: tenant.stripeAccountId },
            )
          : await requireStripe().checkout.sessions.create(
              {
                ...commonParams,
                ui_mode: "elements",
                return_url: `${appUrl}${returnPath}?session_id={CHECKOUT_SESSION_ID}`,
              },
              { stripeAccount: tenant.stripeAccountId },
            );

      res.json({
        clientSecret: session.client_secret,
        sessionId: session.id,
        url: session.url, // populated only in hosted mode
      });
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /api/checkout/charge-card-on-file
//
// Off-session PaymentIntent against a saved payment method. Used from the
// "Charge card on file" POS-style button on the invoice detail page — no
// Stripe Elements, no redirect, instant result.
// ---------------------------------------------------------------------------

const CardOnFileSchema = z.object({
  invoiceId: z.string().uuid(),
  // Optional: pick a specific saved payment method. If omitted, Stripe uses
  // the customer's default.
  paymentMethodId: z.string().optional(),
});

router.post(
  "/charge-card-on-file",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const { invoiceId, paymentMethodId } = CardOnFileSchema.parse(req.body);

      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: {
          stripeAccountId: true,
          applicationFeePctBps: true,
          applicationFeeFixedCents: true,
        },
      });
      if (!tenant?.stripeAccountId) {
        res.status(400).json({
          error: "Stripe is not connected for this marina",
          code: "STRIPE_NOT_CONFIGURED",
        });
        return;
      }

      const invoice = await prisma.invoice.findFirst({
        where: { id: invoiceId, tenantId },
        include: {
          customer: { select: { id: true, stripeCustomerId: true } },
        },
      });
      if (!invoice || invoice.balanceCents <= 0) {
        res.status(400).json({
          error: "Invoice not found or fully paid",
          code: "INVOICE_INVALID",
        });
        return;
      }
      if (!invoice.customer.stripeCustomerId) {
        res.status(400).json({
          error:
            "No saved card on file. The customer needs to complete a Checkout flow first.",
          code: "NO_CARD_ON_FILE",
        });
        return;
      }

      const applicationFee = calculateApplicationFee(
        invoice.balanceCents,
        tenant.applicationFeePctBps,
        tenant.applicationFeeFixedCents,
      );

      const params: Stripe.PaymentIntentCreateParams = {
        amount: invoice.balanceCents,
        currency: "usd",
        customer: invoice.customer.stripeCustomerId,
        confirm: true,
        off_session: true,
        application_fee_amount: applicationFee,
        metadata: {
          tenantId,
          invoiceId: invoice.id,
          customerId: invoice.customer.id,
        },
      };
      if (paymentMethodId) params.payment_method = paymentMethodId;

      const intent = await requireStripe().paymentIntents.create(params, {
        stripeAccount: tenant.stripeAccountId,
        idempotencyKey: `charge-on-file-${invoice.id}-${invoice.balanceCents}`,
      });

      // The PaymentIntent webhook (payment_intent.succeeded) will promote the
      // Payment row to COMPLETED and post GL. Here we just surface the
      // immediate status so the UI can show "Charged" or "Authentication
      // required".
      res.json({
        paymentIntentId: intent.id,
        status: intent.status,
        requiresAction: intent.status === "requires_action",
        clientSecret:
          intent.status === "requires_action" ? intent.client_secret : undefined,
      });
    } catch (err) {
      // Stripe throws a specific error on off-session auth required; surface
      // the client_secret so the UI can remediate with 3DS.
      const e = err as {
        code?: string;
        payment_intent?: { id?: string; client_secret?: string | null };
      };
      if (e?.code === "authentication_required") {
        res.status(402).json({
          error: "Card requires authentication",
          code: "AUTHENTICATION_REQUIRED",
          paymentIntentId: e.payment_intent?.id,
          clientSecret: e.payment_intent?.client_secret,
        });
        return;
      }
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// GET /api/checkout/session-status?session_id=cs_…
//
// Used by the return page (after staff-initiated or customer-facing checkout)
// to report whether the payment completed.
// ---------------------------------------------------------------------------

router.get(
  "/session-status",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const sessionId = req.query.session_id;
      if (!sessionId || typeof sessionId !== "string") {
        res.status(400).json({ error: "Missing session_id" });
        return;
      }

      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { stripeAccountId: true },
      });
      if (!tenant?.stripeAccountId) {
        res.status(400).json({
          error: "Stripe is not connected for this marina",
          code: "STRIPE_NOT_CONFIGURED",
        });
        return;
      }

      const session = await requireStripe().checkout.sessions.retrieve(
        sessionId,
        { expand: ["payment_intent"] },
        { stripeAccount: tenant.stripeAccountId },
      );

      res.json({
        status: session.status,
        paymentStatus: session.payment_status,
        paymentIntentId:
          typeof session.payment_intent === "string"
            ? session.payment_intent
            : session.payment_intent?.id ?? null,
        paymentIntentStatus:
          typeof session.payment_intent === "object" && session.payment_intent
            ? session.payment_intent.status
            : null,
      });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
