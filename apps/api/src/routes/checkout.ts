import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import type Stripe from "stripe";

import { clerkAuth } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";
import { requireStripe, calculateApplicationFee } from "../lib/stripe.js";

const router: Router = Router();

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

      // Fetch the tenant (for fee settings and fallback Stripe account) and the
      // invoice (for location-specific Stripe account routing) in parallel.
      const [tenant, invoice] = await Promise.all([
        prisma.tenant.findUnique({
          where: { id: tenantId },
          select: {
            stripeAccountId: true,
            applicationFeePctBps: true,
            applicationFeeFixedCents: true,
          },
        }),
        prisma.invoice.findFirst({
          where: { id: invoiceId, tenantId },
          include: {
            customer: { select: { email: true, stripeCustomerId: true } },
            location: { select: { stripeAccountId: true, stripeOnboardingComplete: true } },
          },
        }),
      ]);

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

      // Resolve the Stripe account: prefer the invoice's location account, fall
      // back to the tenant-level account, and error clearly when neither is set.
      let stripeAccountId: string | null = null;
      if (invoice.location?.stripeAccountId) {
        // Location has a Stripe account — use it. If onboarding is incomplete
        // the account won't accept payments; return a clear error.
        if (!invoice.location.stripeOnboardingComplete) {
          res.status(400).json({
            error: "Stripe payments are not yet configured for this location. Please contact the marina.",
            code: "LOCATION_STRIPE_NOT_CONFIGURED",
          });
          return;
        }
        stripeAccountId = invoice.location.stripeAccountId;
      } else if (invoice.locationId) {
        // Invoice has a location but it has no Stripe account connected at all.
        res.status(400).json({
          error: "Stripe payments are not yet configured for this location. Please contact the marina.",
          code: "LOCATION_STRIPE_NOT_CONFIGURED",
        });
        return;
      } else {
        // No location on the invoice — fall back to tenant-level account.
        stripeAccountId = tenant?.stripeAccountId ?? null;
      }

      if (!stripeAccountId) {
        res.status(400).json({
          error: "Stripe is not connected for this marina",
          code: "STRIPE_NOT_CONFIGURED",
        });
        return;
      }

      const appUrl = process.env.APP_URL ?? "http://localhost:5000";
      const applicationFee = calculateApplicationFee(
        invoice.balanceCents,
        tenant?.applicationFeePctBps ?? 0,
        tenant?.applicationFeeFixedCents ?? 0,
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

      // Build the return/success URL with proper query-string handling.
      // returnPath may already contain query params (e.g. /thank-you?invoiceId=…)
      // so we must use '&' rather than '?' in that case to avoid a malformed URL.
      const qs = returnPath.includes("?") ? "&" : "?";
      const returnUrlWithSession = `${appUrl}${returnPath}${qs}session_id={CHECKOUT_SESSION_ID}`;

      const session =
        uiMode === "hosted"
          ? await requireStripe().checkout.sessions.create(
              {
                ...commonParams,
                success_url: returnUrlWithSession,
                cancel_url: `${appUrl}/invoices/${invoice.id}?canceled=true`,
              },
              { stripeAccount: stripeAccountId },
            )
          : await requireStripe().checkout.sessions.create(
              {
                ...commonParams,
                ui_mode: "elements",
                return_url: returnUrlWithSession,
              },
              { stripeAccount: stripeAccountId },
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
  // Optional: charge a partial amount (in cents). When omitted, the full
  // invoice balance is charged. Must be a positive integer no greater than
  // the current balance due.
  amountCents: z.number().int().positive().optional(),
});

router.post(
  "/charge-card-on-file",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const startedAt = Date.now();
    try {
      const tenantId = req.tenantId!;
      const { invoiceId, paymentMethodId, amountCents } = CardOnFileSchema.parse(req.body);
      console.log(
        `[charge-card-on-file] start tenant=${tenantId} invoice=${invoiceId} pm=${paymentMethodId ?? "<default>"} amount=${amountCents ?? "<balance>"}`,
      );

      // Fetch tenant (for fee settings and fallback account) and invoice in parallel.
      const [tenant, invoice] = await Promise.all([
        prisma.tenant.findUnique({
          where: { id: tenantId },
          select: {
            stripeAccountId: true,
            applicationFeePctBps: true,
            applicationFeeFixedCents: true,
          },
        }),
        prisma.invoice.findFirst({
          where: { id: invoiceId, tenantId },
          include: {
            customer: { select: { id: true, stripeCustomerId: true } },
            location: { select: { stripeAccountId: true, stripeOnboardingComplete: true } },
          },
        }),
      ]);

      if (!invoice || invoice.balanceCents <= 0) {
        res.status(400).json({
          error: "Invoice not found or fully paid",
          code: "INVOICE_INVALID",
        });
        return;
      }
      // Resolve the amount to charge: caller's value when supplied, otherwise
      // the full balance. Reject anything above the balance due so partial
      // payments can never overpay an invoice.
      const chargeAmountCents = amountCents ?? invoice.balanceCents;
      if (chargeAmountCents > invoice.balanceCents) {
        res.status(400).json({
          error: "Amount exceeds invoice balance due",
          code: "AMOUNT_EXCEEDS_BALANCE",
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

      // Resolve the Stripe account: prefer location account, fall back to tenant.
      let stripeAccountId: string | null = null;
      if (invoice.location?.stripeAccountId) {
        if (!invoice.location.stripeOnboardingComplete) {
          res.status(400).json({
            error: "Stripe payments are not yet configured for this location. Please contact the marina.",
            code: "LOCATION_STRIPE_NOT_CONFIGURED",
          });
          return;
        }
        stripeAccountId = invoice.location.stripeAccountId;
      } else if (invoice.locationId) {
        res.status(400).json({
          error: "Stripe payments are not yet configured for this location. Please contact the marina.",
          code: "LOCATION_STRIPE_NOT_CONFIGURED",
        });
        return;
      } else {
        stripeAccountId = tenant?.stripeAccountId ?? null;
      }

      if (!stripeAccountId) {
        res.status(400).json({
          error: "Stripe is not connected for this marina",
          code: "STRIPE_NOT_CONFIGURED",
        });
        return;
      }

      const applicationFee = calculateApplicationFee(
        chargeAmountCents,
        tenant?.applicationFeePctBps ?? 0,
        tenant?.applicationFeeFixedCents ?? 0,
      );

      const params: Stripe.PaymentIntentCreateParams = {
        amount: chargeAmountCents,
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

      console.log(
        `[charge-card-on-file] calling Stripe acct=${stripeAccountId} amount=${chargeAmountCents} cust=${invoice.customer.stripeCustomerId} fee=${applicationFee}`,
      );
      const intent = await requireStripe().paymentIntents.create(params, {
        stripeAccount: stripeAccountId,
        // Include both the current balance and the chosen amount so retries
        // remain idempotent while distinct partial charges get distinct keys.
        idempotencyKey: `charge-on-file-${invoice.id}-${invoice.balanceCents}-${chargeAmountCents}`,
      });
      console.log(
        `[charge-card-on-file] OK pi=${intent.id} status=${intent.status} took=${Date.now() - startedAt}ms`,
      );

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
        message?: string;
        decline_code?: string;
        payment_intent?: { id?: string; client_secret?: string | null; status?: string };
      };
      console.error(
        `[charge-card-on-file] FAIL code=${e?.code ?? "<none>"} decline=${e?.decline_code ?? "<none>"} pi=${e?.payment_intent?.id ?? "<none>"} pi_status=${e?.payment_intent?.status ?? "<none>"} msg=${e?.message ?? "<none>"} took=${Date.now() - startedAt}ms`,
      );
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
// GET /api/checkout/session-status?session_id=cs_…[&invoiceId=<uuid>]
//
// Used by the return page (after staff-initiated or customer-facing checkout)
// to report whether the payment completed.
//
// Optional query param: invoiceId
// When provided, the session is retrieved from the Stripe account for that
// invoice's location (with fallback to the tenant account). Pass the same
// invoiceId that was used when creating the session so the accounts match.
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

      const invoiceIdParam = typeof req.query.invoiceId === "string" ? req.query.invoiceId : undefined;

      // Resolve the Stripe account. When invoiceId is supplied, prefer the
      // invoice's location account (same account the session was created in).
      let stripeAccountId: string | null = null;
      if (invoiceIdParam) {
        const invoice = await prisma.invoice.findFirst({
          where: { id: invoiceIdParam, tenantId },
          select: {
            locationId: true,
            location: { select: { stripeAccountId: true, stripeOnboardingComplete: true } },
          },
        });
        if (invoice?.location?.stripeAccountId && invoice.location.stripeOnboardingComplete) {
          stripeAccountId = invoice.location.stripeAccountId;
        }
      }

      if (!stripeAccountId) {
        const tenant = await prisma.tenant.findUnique({
          where: { id: tenantId },
          select: { stripeAccountId: true },
        });
        stripeAccountId = tenant?.stripeAccountId ?? null;
      }

      if (!stripeAccountId) {
        res.status(400).json({
          error: "Stripe is not connected for this marina",
          code: "STRIPE_NOT_CONFIGURED",
        });
        return;
      }

      const session = await requireStripe().checkout.sessions.retrieve(
        sessionId,
        { expand: ["payment_intent"] },
        { stripeAccount: stripeAccountId },
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
