import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import type Stripe from "stripe";

import { v4 as uuid } from "uuid";
import { clerkAuth } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";
import { requireStripe, calculateApplicationFee } from "../lib/stripe.js";
import { postPayment } from "../services/gl-posting.js";
import {
  createConnectionToken,
  capturePayment as captureTerminalPayment,
} from "../services/stripe-terminal.js";

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
        // The connected account the session lives on. The frontend MUST
        // initialize Stripe.js with `{ stripeAccount: stripeAccountId }`
        // (via getStripeForAccount) or the client-side init fails with
        // "No such payment_page" — Stripe scopes session lookups to the
        // account that minted them.
        stripeAccountId,
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

      // Persist a Payment row keyed on intent.id BEFORE the webhook can race
      // us. Without this, payment_intent.succeeded arrives ~1-2s later, fails
      // its `findFirst({ stripePaymentId })` lookup, and the invoice is never
      // marked PAID nor GL-posted (silent revenue leak).
      //
      // For an immediately-succeeded card charge we record COMPLETED + post GL
      // synchronously — same pattern as POST /api/payments. The webhook then
      // sees status=COMPLETED and no-ops (handler short-circuits on line ~398).
      // For requires_action / processing we leave the row PENDING; the webhook
      // promotes it once the customer completes 3DS or the bank settles.
      // Idempotency guard: a duplicate submit (double-click, retried network
      // request) hits Stripe's idempotency key and gets the SAME PaymentIntent
      // back — but the DB write below is not naturally idempotent without a
      // unique index on stripePaymentId. Check first, then skip the write +
      // GL post if a row already exists for this intent. The webhook also
      // honours this row, so we never double-post GL or duplicate Payments.
      const existing = await prisma.payment.findFirst({
        where: { tenantId, stripePaymentId: intent.id },
        select: { id: true },
      });

      if (!existing) {
        if (intent.status === "succeeded") {
          const paymentId = uuid();
          await prisma.$transaction(async (tx) => {
            await tx.payment.create({
              data: {
                id: paymentId,
                tenantId,
                customerId: invoice.customer.id,
                invoiceId: invoice.id,
                amountCents: chargeAmountCents,
                method: "CARD",
                stripePaymentId: intent.id,
                postedDate: new Date(),
                status: "COMPLETED",
              },
            });
            await postPayment(
              {
                id: paymentId,
                tenantId,
                amountCents: chargeAmountCents,
                method: "CARD",
                locationId: invoice.locationId ?? null,
              },
              tx,
            );
            const newBalance = Math.max(0, invoice.balanceCents - chargeAmountCents);
            await tx.invoice.update({
              where: { id: invoice.id },
              data: {
                balanceCents: newBalance,
                status: newBalance === 0 ? "PAID" : invoice.status,
              },
            });
          });
        } else {
          // Pending (3DS / processing). Insert a stub the webhook can promote.
          await prisma.payment.create({
            data: {
              id: uuid(),
              tenantId,
              customerId: invoice.customer.id,
              invoiceId: invoice.id,
              amountCents: chargeAmountCents,
              method: "CARD",
              stripePaymentId: intent.id,
              postedDate: new Date(),
              status: "PENDING",
            },
          });
        }
      }

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
        // The customer will complete 3DS in the UI and Stripe will fire
        // payment_intent.succeeded. Without a PENDING row keyed on this
        // intent.id the webhook silently drops — same revenue-leak class
        // as the original missing-row bug. Insert a stub now (idempotent
        // via findFirst guard) so the webhook can promote it later.
        const piId = e.payment_intent?.id;
        if (piId) {
          try {
            const ctxInvoiceId = (req.body as { invoiceId?: string })?.invoiceId;
            const ctx = ctxInvoiceId
              ? await prisma.invoice.findFirst({
                  where: { id: ctxInvoiceId, tenantId: req.tenantId! },
                  select: { id: true, customerId: true },
                })
              : null;
            const already = await prisma.payment.findFirst({
              where: { tenantId: req.tenantId!, stripePaymentId: piId },
              select: { id: true },
            });
            if (!already && ctx) {
              const parsed = CardOnFileSchema.safeParse(req.body);
              const amt = parsed.success && parsed.data.amountCents
                ? parsed.data.amountCents
                : 0;
              if (amt > 0) {
                await prisma.payment.create({
                  data: {
                    id: uuid(),
                    tenantId: req.tenantId!,
                    customerId: ctx.customerId,
                    invoiceId: ctx.id,
                    amountCents: amt,
                    method: "CARD",
                    stripePaymentId: piId,
                    postedDate: new Date(),
                    status: "PENDING",
                  },
                });
              }
            }
          } catch (stubErr) {
            console.error(
              `[charge-card-on-file] failed to write 3DS PENDING stub for ${piId}:`,
              stubErr,
            );
          }
        }
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

// Invoice-scoped staff card flow (Terminal + keyed CNP). Mirrors the POS
// card path but ties the PaymentIntent to an invoice so finalize records a
// Payment row, posts GL, and decrements the balance.

async function resolveInvoiceStripeAccount(
  tenantId: string,
  invoiceId: string,
): Promise<
  | { ok: true; stripeAccountId: string; invoice: { id: string; balanceCents: number; status: string; customerId: string; locationId: string | null } }
  | { ok: false; status: number; body: { error: string; code: string } }
> {
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
      select: {
        id: true,
        balanceCents: true,
        status: true,
        customerId: true,
        locationId: true,
        location: { select: { stripeAccountId: true, stripeOnboardingComplete: true } },
      },
    }),
  ]);
  if (!invoice) {
    return { ok: false, status: 404, body: { error: "Invoice not found", code: "NOT_FOUND" } };
  }
  let stripeAccountId: string | null = null;
  if (invoice.location?.stripeAccountId) {
    if (!invoice.location.stripeOnboardingComplete) {
      return {
        ok: false,
        status: 400,
        body: {
          error: "Stripe payments are not yet configured for this location.",
          code: "LOCATION_STRIPE_NOT_CONFIGURED",
        },
      };
    }
    stripeAccountId = invoice.location.stripeAccountId;
  } else if (invoice.locationId) {
    return {
      ok: false,
      status: 400,
      body: {
        error: "Stripe payments are not yet configured for this location.",
        code: "LOCATION_STRIPE_NOT_CONFIGURED",
      },
    };
  } else {
    stripeAccountId = tenant?.stripeAccountId ?? null;
  }
  if (!stripeAccountId) {
    return {
      ok: false,
      status: 400,
      body: { error: "Stripe is not connected for this marina", code: "STRIPE_NOT_CONFIGURED" },
    };
  }
  return {
    ok: true,
    stripeAccountId,
    invoice: {
      id: invoice.id,
      balanceCents: invoice.balanceCents,
      status: invoice.status,
      customerId: invoice.customerId,
      locationId: invoice.locationId,
    },
  };
}

// GET /api/checkout/invoice-card/account?invoiceId=<uuid>
router.get(
  "/invoice-card/account",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const invoiceId = typeof req.query.invoiceId === "string" ? req.query.invoiceId : undefined;
      if (!invoiceId) {
        res.status(400).json({ error: "invoiceId required", code: "BAD_REQUEST" });
        return;
      }
      const resolved = await resolveInvoiceStripeAccount(tenantId, invoiceId);
      if (!resolved.ok) {
        res.status(resolved.status).json(resolved.body);
        return;
      }
      res.json({ stripeAccountId: resolved.stripeAccountId });
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/checkout/invoice-card/connection-token
const ConnectionTokenSchema = z.object({ invoiceId: z.string().uuid() });
router.post(
  "/invoice-card/connection-token",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const { invoiceId } = ConnectionTokenSchema.parse(req.body);
      const resolved = await resolveInvoiceStripeAccount(tenantId, invoiceId);
      if (!resolved.ok) {
        res.status(resolved.status).json(resolved.body);
        return;
      }
      const secret = await createConnectionToken(resolved.stripeAccountId);
      res.json({ secret });
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/checkout/invoice-card/intent
const InvoiceCardIntentSchema = z.object({
  invoiceId: z.string().uuid(),
  amountCents: z.number().int().positive(),
  mode: z.enum(["cnp", "terminal"]),
}).strict();

router.post(
  "/invoice-card/intent",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const { invoiceId, amountCents, mode } = InvoiceCardIntentSchema.parse(req.body);
      const resolved = await resolveInvoiceStripeAccount(tenantId, invoiceId);
      if (!resolved.ok) {
        res.status(resolved.status).json(resolved.body);
        return;
      }
      const { invoice, stripeAccountId } = resolved;
      if (invoice.balanceCents <= 0) {
        res.status(400).json({ error: "Invoice has no outstanding balance", code: "NO_BALANCE" });
        return;
      }
      if (amountCents > invoice.balanceCents) {
        res.status(400).json({
          error: "Amount exceeds invoice balance due",
          code: "AMOUNT_EXCEEDS_BALANCE",
        });
        return;
      }

      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { applicationFeePctBps: true, applicationFeeFixedCents: true },
      });
      const applicationFee = calculateApplicationFee(
        amountCents,
        tenant?.applicationFeePctBps ?? 0,
        tenant?.applicationFeeFixedCents ?? 0,
      );

      const params: Stripe.PaymentIntentCreateParams = {
        amount: amountCents,
        currency: "usd",
        application_fee_amount: applicationFee,
        description: `Invoice payment (${mode})`,
        metadata: {
          tenantId,
          invoiceId: invoice.id,
          customerId: invoice.customerId,
          source: mode === "terminal" ? "invoice-terminal" : "invoice-cnp",
        },
      };
      if (mode === "terminal") {
        params.payment_method_types = ["card_present"];
        params.capture_method = "manual";
      } else {
        params.payment_method_types = ["card"];
      }

      const intent = await requireStripe().paymentIntents.create(params, {
        stripeAccount: stripeAccountId,
        // Bind idempotency to invoice + amount + mode so retries collapse but
        // a corrected total or a rail switch produces a fresh PI.
        idempotencyKey: `invoice-card-${mode}-${invoice.id}-${invoice.balanceCents}-${amountCents}`,
      });

      res.json({
        paymentIntentId: intent.id,
        clientSecret: intent.client_secret,
        stripeAccountId,
      });
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/checkout/invoice-card/finalize
const InvoiceCardFinalizeSchema = z.object({
  invoiceId: z.string().uuid(),
  paymentIntentId: z.string().min(1),
  amountCents: z.number().int().positive(),
}).strict();

router.post(
  "/invoice-card/finalize",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const { invoiceId, paymentIntentId, amountCents } = InvoiceCardFinalizeSchema.parse(req.body);
      const resolved = await resolveInvoiceStripeAccount(tenantId, invoiceId);
      if (!resolved.ok) {
        res.status(resolved.status).json(resolved.body);
        return;
      }
      const { invoice, stripeAccountId } = resolved;

      // Idempotent for the SAME invoice; hard 409 if the PI was already
      // applied to a DIFFERENT invoice (one Stripe charge ↔ one A/R doc).
      const existing = await prisma.payment.findFirst({
        where: { tenantId, stripePaymentId: paymentIntentId },
        select: { id: true, status: true, invoiceId: true },
      });
      if (existing) {
        if (existing.invoiceId && existing.invoiceId !== invoice.id) {
          res.status(409).json({
            error: "PAYMENT_INTENT_ALREADY_APPLIED",
            code: "PAYMENT_INTENT_ALREADY_APPLIED",
          });
          return;
        }
        res.json({ paymentId: existing.id, status: existing.status, already: true });
        return;
      }

      let intent = await requireStripe().paymentIntents.retrieve(
        paymentIntentId,
        {},
        { stripeAccount: stripeAccountId },
      );

      // Ownership check — the PI's metadata (stamped by /invoice-card/intent)
      // must match this invoice/tenant/customer, and source must be one of
      // the invoice-card values. Otherwise a PI from another channel could
      // be replayed here to mark this invoice paid.
      const md = (intent.metadata ?? {}) as Record<string, string>;
      if (md.tenantId !== tenantId || md.invoiceId !== invoice.id) {
        res.status(403).json({
          error: "PAYMENT_INTENT_MISMATCH",
          code: "PAYMENT_INTENT_MISMATCH",
        });
        return;
      }
      if (md.customerId && md.customerId !== invoice.customerId) {
        res.status(403).json({
          error: "PAYMENT_INTENT_MISMATCH",
          code: "PAYMENT_INTENT_MISMATCH",
        });
        return;
      }
      if (md.source !== "invoice-cnp" && md.source !== "invoice-terminal") {
        res.status(403).json({
          error: "PAYMENT_INTENT_WRONG_SOURCE",
          code: "PAYMENT_INTENT_WRONG_SOURCE",
        });
        return;
      }
      const pmTypes = (intent.payment_method_types ?? []) as string[];
      const expectedRail = md.source === "invoice-terminal" ? "card_present" : "card";
      if (!pmTypes.includes(expectedRail)) {
        res.status(403).json({
          error: "PAYMENT_INTENT_WRONG_RAIL",
          code: "PAYMENT_INTENT_WRONG_RAIL",
        });
        return;
      }

      // Terminal flow leaves the PI in `requires_capture` after processPayment.
      // Capture server-side so the final amount is the source of truth.
      if (intent.status === "requires_capture") {
        await captureTerminalPayment(paymentIntentId, stripeAccountId);
        intent = await requireStripe().paymentIntents.retrieve(
          paymentIntentId,
          {},
          { stripeAccount: stripeAccountId },
        );
      }

      if (intent.status !== "succeeded") {
        res.status(400).json({ error: "PAYMENT_NOT_SUCCEEDED", status: intent.status });
        return;
      }
      if (intent.amount !== amountCents) {
        res.status(400).json({
          error: "AMOUNT_MISMATCH",
          expectedAmountCents: amountCents,
          stripeAmountCents: intent.amount,
        });
        return;
      }
      if (amountCents > invoice.balanceCents) {
        res.status(400).json({
          error: "Amount exceeds invoice balance due",
          code: "AMOUNT_EXCEEDS_BALANCE",
        });
        return;
      }

      const paymentId = uuid();
      await prisma.$transaction(async (tx) => {
        await tx.payment.create({
          data: {
            id: paymentId,
            tenantId,
            customerId: invoice.customerId,
            invoiceId: invoice.id,
            amountCents,
            method: "CARD",
            stripePaymentId: paymentIntentId,
            postedDate: new Date(),
            status: "COMPLETED",
          },
        });
        await postPayment(
          {
            id: paymentId,
            tenantId,
            amountCents,
            method: "CARD",
            locationId: invoice.locationId,
          },
          tx,
        );
        const newBalance = Math.max(0, invoice.balanceCents - amountCents);
        await tx.invoice.update({
          where: { id: invoice.id },
          data: {
            balanceCents: newBalance,
            status: newBalance === 0 ? "PAID" : (invoice.status as never),
          },
        });
      });

      res.json({ paymentId, status: "COMPLETED" });
    } catch (err) {
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
