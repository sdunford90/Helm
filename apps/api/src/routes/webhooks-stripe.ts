import { Router, type Request, type Response } from "express";
import express from "express";
import type Stripe from "stripe";
import { requireStripe } from "../lib/stripe.js";
import { prisma } from "../lib/prisma.js";
import { checkAndMarkProcessed } from "../services/webhook.js";
import { handleAchReturn } from "../services/ach-handler.js";
import { postPayment } from "../services/gl-posting.js";

const router = Router();

// ---------------------------------------------------------------------------
// Shared helper: parse + verify a webhook signature, then dispatch.
//
// Webhooks MUST be mounted with express.raw({type:"application/json"}) BEFORE
// the global express.json() middleware so the raw body is preserved for
// signature verification.
// ---------------------------------------------------------------------------

type Handler = (event: Stripe.Event) => Promise<void>;

function makeWebhookHandler(secretEnvVar: string, dispatch: Handler) {
  return async (req: Request, res: Response): Promise<void> => {
    const secret = process.env[secretEnvVar];
    if (!secret) {
      res.status(500).json({ error: `${secretEnvVar} is not configured` });
      return;
    }

    const sig = req.headers["stripe-signature"];
    if (!sig || Array.isArray(sig)) {
      res.status(400).json({ error: "Missing Stripe-Signature header" });
      return;
    }

    let event: Stripe.Event;
    try {
      event = requireStripe().webhooks.constructEvent(
        req.body as Buffer,
        sig,
        secret,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Webhook signature verification failed: ${message}`);
      res.status(400).json({ error: `Webhook Error: ${message}` });
      return;
    }

    // Acknowledge the event immediately, then do the work.
    // Stripe retries on non-2xx so we respond 200 before long-running work.
    res.status(200).json({ received: true });

    try {
      await dispatch(event);
    } catch (err) {
      // Already responded 200 to Stripe; log for operators.
      console.error(
        `[stripe-webhook] handler error for ${event.type} (${event.id}):`,
        err,
      );
    }
  };
}

// ---------------------------------------------------------------------------
// Connect webhook (per-connected-account events)
// ---------------------------------------------------------------------------

async function dispatchConnectEvent(event: Stripe.Event): Promise<void> {
  // event.account is set for events fired on a connected account.
  const connectedAccountId = (event as Stripe.Event & { account?: string }).account ?? null;

  // Resolve which Helm tenant this event belongs to.
  const tenant = connectedAccountId
    ? await prisma.tenant.findFirst({
        where: { stripeAccountId: connectedAccountId },
        select: { id: true },
      })
    : null;

  const tenantId = tenant?.id ?? null;

  // Idempotency: skip if we've already processed this event.
  const isNew = await checkAndMarkProcessed(event.id, event.type, tenantId);
  if (!isNew) {
    console.log(`[stripe-webhook] skipping already-processed event ${event.id}`);
    return;
  }

  switch (event.type) {
    case "payment_intent.succeeded":
      await handlePaymentIntentSucceeded(event, tenantId);
      break;

    case "payment_intent.payment_failed":
      await handlePaymentIntentFailed(event, tenantId);
      break;

    case "charge.refunded":
      // Refunds are applied synchronously via POST /api/payments/:id/refund.
      // This handler is a safety net for refunds issued out-of-band in Stripe.
      console.log(
        `[stripe-webhook] charge.refunded for tenant ${tenantId ?? "unknown"}`,
      );
      break;

    case "charge.failed":
      // ACH failures surface as charge.failed with a failure_code. Route to
      // the ACH return handler if this was an ACH payment.
      if (tenantId) {
        await maybeHandleAchReturn(event, tenantId);
      }
      break;

    case "charge.dispute.created":
    case "charge.dispute.closed":
    case "charge.dispute.updated":
      await handleDispute(event, tenantId);
      break;

    case "payout.failed":
      // Marina's payout to their bank failed. Log and alert staff.
      console.warn(
        `[stripe-webhook] payout.failed for tenant ${tenantId ?? "unknown"}:`,
        event.data.object,
      );
      break;

    case "account.updated":
      await handleAccountUpdated(event, tenantId);
      break;

    default:
      // Accounts v2 event types (prefix v2.core.account.*) aren't in the v22
      // SDK's typed EventType union yet; match by string.
      if (event.type.startsWith("v2.core.account")) {
        await handleAccountUpdated(event, tenantId);
      } else {
        console.log(`[stripe-webhook] connect event unhandled: ${event.type}`);
      }
  }
}

// ---------------------------------------------------------------------------
// Platform webhook (events on Helm's own Stripe account — SaaS billing)
// ---------------------------------------------------------------------------

async function dispatchPlatformEvent(event: Stripe.Event): Promise<void> {
  const isNew = await checkAndMarkProcessed(event.id, event.type, null);
  if (!isNew) return;

  switch (event.type) {
    case "checkout.session.completed": {
      // Fires when a tenant completes Stripe Checkout for a SaaS subscription.
      // Record the subscription id and tier on the tenant.
      const session = event.data.object as Stripe.Checkout.Session;
      const tenantId = session.metadata?.tenantId ?? null;
      const tierId = session.metadata?.tierId ?? null;
      if (tenantId && session.subscription) {
        await prisma.tenant.update({
          where: { id: tenantId },
          data: {
            stripeSubscriptionId:
              typeof session.subscription === "string"
                ? session.subscription
                : session.subscription.id,
            ...(tierId ? { saasTierId: tierId } : {}),
          },
        });
      }
      break;
    }

    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const sub = event.data.object as Stripe.Subscription;
      const tenantId = sub.metadata?.tenantId;
      if (tenantId) {
        await prisma.tenant.update({
          where: { id: tenantId },
          data: { stripeSubscriptionId: sub.id },
        });
      }
      break;
    }

    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      const tenantId = sub.metadata?.tenantId;
      if (tenantId) {
        await prisma.tenant.update({
          where: { id: tenantId },
          data: {
            stripeSubscriptionId: null,
            saasTierId: null,
          },
        });
      }
      break;
    }

    case "invoice.payment_failed": {
      // Grace policy: log and audit. Do NOT auto-lock the tenant; operators
      // decide when to suspend. Mark gracePeriodStartedAt to track aging.
      const invoice = event.data.object as Stripe.Invoice;
      const customerId =
        typeof invoice.customer === "string"
          ? invoice.customer
          : invoice.customer?.id;
      if (customerId) {
        const tenant = await prisma.tenant.findFirst({
          where: { stripeCustomerId: customerId },
          select: { id: true, gracePeriodStartedAt: true },
        });
        if (tenant) {
          await prisma.tenant.update({
            where: { id: tenant.id },
            data: tenant.gracePeriodStartedAt
              ? {}
              : { gracePeriodStartedAt: new Date() },
          });
          await prisma.auditLog.create({
            data: {
              tenantId: tenant.id,
              recordType: "Tenant",
              recordId: tenant.id,
              action: "SAAS_INVOICE_PAYMENT_FAILED",
              changedFieldsJson: {
                invoiceId: invoice.id,
                amountDue: invoice.amount_due,
                attemptCount: invoice.attempt_count,
              },
            },
          });
          // TODO(email): notify tenant admin via Resend.
        }
      }
      break;
    }

    case "invoice.paid": {
      // Clear any grace-period flag on the tenant when a subsequent invoice
      // clears successfully.
      const invoice = event.data.object as Stripe.Invoice;
      const customerId =
        typeof invoice.customer === "string"
          ? invoice.customer
          : invoice.customer?.id;
      if (customerId) {
        const tenant = await prisma.tenant.findFirst({
          where: { stripeCustomerId: customerId },
          select: { id: true, gracePeriodStartedAt: true },
        });
        if (tenant?.gracePeriodStartedAt) {
          await prisma.tenant.update({
            where: { id: tenant.id },
            data: { gracePeriodStartedAt: null },
          });
        }
      }
      break;
    }

    case "customer.subscription.trial_will_end":
      // No trials today; noop.
      break;

    default:
      console.log(`[stripe-webhook] platform event unhandled: ${event.type}`);
  }
}

// ---------------------------------------------------------------------------
// Per-event handlers
// ---------------------------------------------------------------------------

async function handlePaymentIntentSucceeded(
  event: Stripe.Event,
  tenantId: string | null,
): Promise<void> {
  const pi = event.data.object as Stripe.PaymentIntent;

  // Match by Stripe PaymentIntent id (stored on Payment.stripePaymentId).
  const payment = await prisma.payment.findFirst({
    where: { stripePaymentId: pi.id, ...(tenantId ? { tenantId } : {}) },
    include: { invoice: { select: { id: true, balanceCents: true, status: true } } },
  });

  if (!payment) {
    console.warn(
      `[stripe-webhook] payment_intent.succeeded: no Payment row for ${pi.id}`,
    );
    return;
  }

  // If we already marked it COMPLETED synchronously (card path), there's
  // nothing to do. ACH enters PENDING and is promoted to COMPLETED here.
  if (payment.status === "COMPLETED") return;

  await prisma.$transaction(async (tx) => {
    await tx.payment.update({
      where: { id: payment.id },
      data: { status: "COMPLETED" },
    });

    await postPayment(
      {
        id: payment.id,
        tenantId: payment.tenantId,
        amountCents: payment.amountCents,
        method: payment.method,
      },
      tx,
    );

    if (payment.invoice) {
      const newBalance = Math.max(
        0,
        payment.invoice.balanceCents - payment.amountCents,
      );
      await tx.invoice.update({
        where: { id: payment.invoice.id },
        data: {
          balanceCents: newBalance,
          status: newBalance === 0 ? "PAID" : payment.invoice.status,
        },
      });
    }
  });
}

async function handlePaymentIntentFailed(
  event: Stripe.Event,
  tenantId: string | null,
): Promise<void> {
  const pi = event.data.object as Stripe.PaymentIntent;

  const payment = await prisma.payment.findFirst({
    where: { stripePaymentId: pi.id, ...(tenantId ? { tenantId } : {}) },
  });

  if (!payment) return;

  await prisma.payment.update({
    where: { id: payment.id },
    data: { status: "FAILED" },
  });

  await prisma.auditLog.create({
    data: {
      tenantId: payment.tenantId,
      recordType: "Payment",
      recordId: payment.id,
      action: "PAYMENT_FAILED",
      changedFieldsJson: {
        stripePaymentId: pi.id,
        lastPaymentError: pi.last_payment_error?.message ?? null,
      },
    },
  });
}

async function maybeHandleAchReturn(
  event: Stripe.Event,
  tenantId: string,
): Promise<void> {
  const charge = event.data.object as Stripe.Charge;
  if (charge.payment_method_details?.type !== "us_bank_account") return;
  await handleAchReturn(event, tenantId);
}

async function handleDispute(
  event: Stripe.Event,
  tenantId: string | null,
): Promise<void> {
  const dispute = event.data.object as Stripe.Dispute;
  if (!tenantId) return;

  const payment = await prisma.payment.findFirst({
    where: { stripePaymentId: dispute.payment_intent as string, tenantId },
  });

  await prisma.auditLog.create({
    data: {
      tenantId,
      recordType: "Payment",
      recordId: payment?.id ?? dispute.id,
      action: event.type.toUpperCase().replace(/\./g, "_"),
      changedFieldsJson: {
        disputeId: dispute.id,
        reason: dispute.reason,
        status: dispute.status,
        amountCents: dispute.amount,
      },
    },
  });
}

async function handleAccountUpdated(
  event: Stripe.Event,
  tenantId: string | null,
): Promise<void> {
  if (!tenantId) return;
  // Record the capability/account update so operators can see onboarding progress.
  await prisma.auditLog.create({
    data: {
      tenantId,
      recordType: "Tenant",
      recordId: tenantId,
      action: "STRIPE_ACCOUNT_UPDATED",
      changedFieldsJson: {
        eventType: event.type,
        eventId: event.id,
      },
    },
  });
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

router.post(
  "/stripe/connect",
  express.raw({ type: "application/json" }),
  makeWebhookHandler("STRIPE_WEBHOOK_SECRET_CONNECT", dispatchConnectEvent),
);

router.post(
  "/stripe/platform",
  express.raw({ type: "application/json" }),
  makeWebhookHandler("STRIPE_WEBHOOK_SECRET_PLATFORM", dispatchPlatformEvent),
);

export default router;
