import { Router, type Request, type Response } from "express";
import express from "express";
import type Stripe from "stripe";
import { requireStripe } from "../lib/stripe.js";
import { prisma } from "../lib/prisma.js";
import { checkAndMarkProcessed } from "../services/webhook.js";
import { handleAchReturn } from "../services/ach-handler.js";
import { postPayment } from "../services/gl-posting.js";
import { sendEmail, saasInvoicePaymentFailedHtml } from "../lib/email.js";

const router: Router = Router();

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

  // Resolve which Helm location/tenant this event belongs to.
  // Per-Location Stripe Connect accounts are now primary, so check Location
  // first and fall back to Tenant for legacy tenant-level connections.
  let tenantId: string | null = null;
  let locationId: string | null = null;

  if (connectedAccountId) {
    const location = await prisma.location.findFirst({
      where: { stripeAccountId: connectedAccountId },
      select: { id: true, tenantId: true },
    });
    if (location) {
      tenantId = location.tenantId;
      locationId = location.id;
    } else {
      const tenant = await prisma.tenant.findFirst({
        where: { stripeAccountId: connectedAccountId },
        select: { id: true },
      });
      if (tenant) {
        tenantId = tenant.id;
      }
    }
  }

  // Idempotency: skip if we've already processed this event.
  const isNew = await checkAndMarkProcessed(event.id, event.type, tenantId);
  if (!isNew) {
    console.log(`[stripe-webhook] skipping already-processed event ${event.id}`);
    return;
  }

  switch (event.type) {
    case "checkout.session.completed":
      // A connected-account Checkout Session completed — if it was an invoice
      // payment and Checkout created a Stripe customer for us, persist the id
      // back to the Helm Customer so subsequent off-session charges work.
      await handleConnectCheckoutCompleted(event, tenantId);
      break;

    case "payment_intent.succeeded":
      await handlePaymentIntentSucceeded(event, tenantId, locationId);
      break;

    case "payment_intent.payment_failed":
      await handlePaymentIntentFailed(event, tenantId, locationId);
      break;

    case "charge.refunded":
      // Refunds are applied synchronously via POST /api/payments/:id/refund.
      // This handler is a safety net for refunds issued out-of-band in Stripe.
      console.log(
        `[stripe-webhook] charge.refunded for tenant ${tenantId ?? "unknown"}${locationId ? ` location ${locationId}` : ""}`,
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
      await handleDispute(event, tenantId, locationId);
      break;

    case "payout.failed":
      // Marina's payout to their bank failed. Log and alert staff.
      await handlePayoutFailed(event, tenantId, locationId);
      break;

    case "account.updated":
      await handleAccountUpdated(event, tenantId, locationId);
      break;

    default:
      // Accounts v2 event types (prefix v2.core.account.*) aren't in the v22
      // SDK's typed EventType union yet; match by string.
      if (event.type.startsWith("v2.core.account")) {
        await handleAccountUpdated(event, tenantId, locationId);
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
      // Fires when a marina completes Stripe Checkout for a SaaS subscription.
      // Record the subscription id and tier on the LOCATION (per-marina billing).
      const session = event.data.object as Stripe.Checkout.Session;
      const locationId = session.metadata?.locationId ?? null;
      const tierId = session.metadata?.tierId ?? null;
      if (locationId && session.subscription) {
        await prisma.location.update({
          where: { id: locationId },
          data: {
            stripeSubscriptionId:
              typeof session.subscription === "string"
                ? session.subscription
                : session.subscription.id,
            subscriptionStatus: "active",
            ...(tierId ? { saasTierId: tierId } : {}),
          },
        });
      }
      break;
    }

    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const sub = event.data.object as Stripe.Subscription;
      const locationId = sub.metadata?.locationId;
      if (locationId) {
        await prisma.location.update({
          where: { id: locationId },
          data: {
            stripeSubscriptionId: sub.id,
            subscriptionStatus: sub.status,
          },
        });
      }
      break;
    }

    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      const locationId = sub.metadata?.locationId;
      if (locationId) {
        await prisma.location.update({
          where: { id: locationId },
          data: {
            stripeSubscriptionId: null,
            saasTierId: null,
            subscriptionStatus: "canceled",
          },
        });
      }
      break;
    }

    case "invoice.payment_failed": {
      // Grace policy: log, audit, email — but do NOT auto-lock the tenant.
      // Operators decide when to suspend. Mark gracePeriodStartedAt on the
      // affected location to track aging.
      const invoice = event.data.object as Stripe.Invoice;
      const customerId =
        typeof invoice.customer === "string"
          ? invoice.customer
          : invoice.customer?.id;
      if (customerId) {
        const location = await prisma.location.findFirst({
          where: { stripeCustomerId: customerId },
          select: {
            id: true,
            name: true,
            tenantId: true,
            gracePeriodStartedAt: true,
            tenant: { select: { name: true } },
          },
        });
        if (location) {
          await prisma.location.update({
            where: { id: location.id },
            data: location.gracePeriodStartedAt
              ? { subscriptionStatus: "past_due" }
              : {
                  subscriptionStatus: "past_due",
                  gracePeriodStartedAt: new Date(),
                },
          });
          await prisma.auditLog.create({
            data: {
              tenantId: location.tenantId,
              recordType: "Location",
              recordId: location.id,
              action: "SAAS_INVOICE_PAYMENT_FAILED",
              changedFieldsJson: {
                invoiceId: invoice.id,
                amountDue: invoice.amount_due,
                attemptCount: invoice.attempt_count,
                locationId: location.id,
              },
            },
          });

          // Email the tenant's MARINA_OWNER(s) so they know to update their
          // card before a retry fails again.
          const owners = await prisma.user.findMany({
            where: { tenantId: location.tenantId, role: "MARINA_OWNER" },
            select: { email: true },
          });
          const toAddresses = owners
            .map((u) => u.email)
            .filter((e): e is string => !!e);
          if (toAddresses.length > 0) {
            const appUrl = process.env.APP_URL ?? "https://gethelm.com";
            // Wrap so a Resend failure doesn't NACK the Stripe webhook
            // (Stripe would retry the whole webhook). sendEmail() now
            // throws on failure (Task #273); the failure is recorded on
            // tenant.lastEmailFailure* by recordEmailFailure().
            try {
              await sendEmail({
                to: toAddresses,
                subject: "Action required: payment failed on your Helm subscription",
                tenantId: location.tenantId,
                html: saasInvoicePaymentFailedHtml({
                  marinaName: `${location.tenant.name} — ${location.name}`,
                  amountDue: `$${(invoice.amount_due / 100).toFixed(2)}`,
                  attemptCount: invoice.attempt_count ?? 1,
                  portalUrl: `${appUrl}/settings/billing`,
                }),
                tags: [{ name: "event", value: "saas_payment_failed" }],
              });
            } catch (err) {
              console.error(
                "[stripe-webhook] saas_payment_failed email send failed:",
                err instanceof Error ? err.message : err,
              );
            }
          }
        }
      }
      break;
    }

    case "invoice.paid": {
      // Clear any grace-period flag on the location when a subsequent invoice
      // clears successfully.
      const invoice = event.data.object as Stripe.Invoice;
      const customerId =
        typeof invoice.customer === "string"
          ? invoice.customer
          : invoice.customer?.id;
      if (customerId) {
        const location = await prisma.location.findFirst({
          where: { stripeCustomerId: customerId },
          select: { id: true, gracePeriodStartedAt: true },
        });
        if (location?.gracePeriodStartedAt) {
          await prisma.location.update({
            where: { id: location.id },
            data: {
              gracePeriodStartedAt: null,
              subscriptionStatus: "active",
            },
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

async function handleConnectCheckoutCompleted(
  event: Stripe.Event,
  tenantId: string | null,
): Promise<void> {
  if (!tenantId) return;
  const session = event.data.object as Stripe.Checkout.Session;
  const helmCustomerId = session.metadata?.customerId;
  const stripeCustomerId =
    typeof session.customer === "string"
      ? session.customer
      : session.customer?.id ?? null;
  if (!helmCustomerId || !stripeCustomerId) return;

  // Only update if the Helm Customer doesn't already have a stripeCustomerId.
  await prisma.customer.updateMany({
    where: {
      id: helmCustomerId,
      tenantId,
      stripeCustomerId: null,
    },
    data: { stripeCustomerId },
  });
}

async function handlePaymentIntentSucceeded(
  event: Stripe.Event,
  tenantId: string | null,
  locationId: string | null = null,
): Promise<void> {
  const pi = event.data.object as Stripe.PaymentIntent;

  // The manual record-payment route (POST /api/payments) pre-writes a
  // PENDING Payment stub BEFORE creating the PaymentIntent and stamps the
  // local Payment id on `metadata.paymentId`. Looking up by that id is
  // race-free: the row is committed before Stripe is called, so it's
  // already visible by the time this webhook fires. Fall back to
  // `stripePaymentId` for callers that don't stamp paymentId metadata
  // (e.g. /api/checkout/charge-card-on-file, which writes the row
  // post-Stripe and keys it on the PI id directly). Retry the fallback
  // briefly to absorb the small window between Stripe responding and the
  // synchronous handler patching `stripePaymentId` onto its row.
  const paymentInclude = {
    invoice: {
      select: { id: true, balanceCents: true, status: true, locationId: true },
    },
  };

  const metadataPaymentId =
    (pi.metadata as Record<string, string> | undefined)?.paymentId ?? null;

  let payment = metadataPaymentId
    ? await prisma.payment.findFirst({
        where: {
          id: metadataPaymentId,
          ...(tenantId ? { tenantId } : {}),
        },
        include: paymentInclude,
      })
    : null;

  if (!payment) {
    const fallbackWhere = {
      stripePaymentId: pi.id,
      ...(tenantId ? { tenantId } : {}),
    };
    payment = await prisma.payment.findFirst({
      where: fallbackWhere,
      include: paymentInclude,
    });

    if (!payment) {
      const RETRY_DELAYS_MS = [150, 300, 500, 1000];
      for (const delay of RETRY_DELAYS_MS) {
        await new Promise((resolve) => setTimeout(resolve, delay));
        payment = await prisma.payment.findFirst({
          where: fallbackWhere,
          include: paymentInclude,
        });
        if (payment) break;
      }
    }
  }

  if (!payment) {
    console.warn(
      `[stripe-webhook] payment_intent.succeeded: no Payment row for ${pi.id}`,
    );
    return;
  }

  // Backfill stripePaymentId on rows located via metadata.paymentId so
  // subsequent webhooks (or refunds) that key off stripePaymentId can find
  // the row directly. Race-safe: only sets when currently null.
  if (!payment.stripePaymentId) {
    await prisma.payment.updateMany({
      where: { id: payment.id, stripePaymentId: null },
      data: { stripePaymentId: pi.id },
    });
  }

  // If we already marked it COMPLETED synchronously (card path), there's
  // nothing to do. ACH enters PENDING and is promoted to COMPLETED here.
  if (payment.status === "COMPLETED") return;

  // Race-safe promotion: the synchronous record-payment route can win the
  // race in another process between when we read PENDING above and when
  // this transaction starts. Use a conditional updateMany guarded on
  // status=PENDING and only run side effects (GL post + invoice
  // decrement) when WE were the writer that flipped it. Otherwise the
  // synchronous handler already did them and a re-run would double-post.
  const promotedHere = await prisma.$transaction(async (tx) => {
    const promoted = await tx.payment.updateMany({
      where: { id: payment.id, status: "PENDING" },
      data: { status: "COMPLETED" },
    });
    if (promoted.count === 0) return false;

    await postPayment(
      {
        id: payment.id,
        tenantId: payment.tenantId,
        amountCents: payment.amountCents,
        method: payment.method,
        // Per-location chart of accounts: prefer the invoice's location
        // (payments live under an invoice in Helm) so A/R and bank lookups
        // land on this marina's own rows. Fall back to the routing-level
        // location threaded by the dispatcher when the payment has no
        // invoice attached.
        locationId: payment.invoice?.locationId ?? locationId,
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
    return true;
  });

  // Skip the audit log when we didn't actually promote — the synchronous
  // path that did has its own audit entry.
  if (!promotedHere) return;

  // Audit so per-location reconciliation can match payments back to the
  // connected account that produced them.
  await prisma.auditLog.create({
    data: {
      tenantId: payment.tenantId,
      recordType: "Payment",
      recordId: payment.id,
      action: "PAYMENT_SUCCEEDED",
      changedFieldsJson: {
        stripePaymentId: pi.id,
        amountCents: payment.amountCents,
        locationId,
      },
    },
  });
}

async function handlePaymentIntentFailed(
  event: Stripe.Event,
  tenantId: string | null,
  locationId: string | null = null,
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
        locationId,
      },
    },
  });
}

async function handlePayoutFailed(
  event: Stripe.Event,
  tenantId: string | null,
  locationId: string | null = null,
): Promise<void> {
  const payout = event.data.object as Stripe.Payout;

  console.warn(
    `[stripe-webhook] payout.failed for tenant ${tenantId ?? "unknown"}${locationId ? ` location ${locationId}` : ""}:`,
    payout,
  );

  if (!tenantId) return;

  await prisma.auditLog.create({
    data: {
      tenantId,
      recordType: locationId ? "Location" : "Tenant",
      recordId: locationId ?? tenantId,
      action: "STRIPE_PAYOUT_FAILED",
      changedFieldsJson: {
        payoutId: payout.id,
        amount: payout.amount,
        currency: payout.currency,
        failureCode: payout.failure_code ?? null,
        failureMessage: payout.failure_message ?? null,
        locationId,
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
  locationId: string | null = null,
): Promise<void> {
  const dispute = event.data.object as Stripe.Dispute;
  if (!tenantId) return;

  const payment = await prisma.payment.findFirst({
    where: { stripePaymentId: dispute.payment_intent as string, tenantId },
    select: { id: true, customerId: true },
  });

  // Persist to the Chargeback table so staff can find + respond in-app.
  // Upsert keyed by stripeDisputeId so updates (won/lost/evidence submitted)
  // mutate the same row.
  if (payment) {
    // Map Stripe dispute.status → our ChargebackStatus enum.
    const mapStatus = (s: string | null): "OPEN" | "EVIDENCE_SUBMITTED" | "WON" | "LOST" => {
      switch (s) {
        case "won":
          return "WON";
        case "lost":
          return "LOST";
        case "under_review":
        case "warning_under_review":
          return "EVIDENCE_SUBMITTED";
        default:
          return "OPEN";
      }
    };

    const status = mapStatus(dispute.status ?? null);
    await prisma.chargeback.upsert({
      where: { stripeDisputeId: dispute.id },
      create: {
        tenantId,
        customerId: payment.customerId,
        stripeDisputeId: dispute.id,
        amountCents: dispute.amount,
        status,
        outcome: dispute.status ?? null,
      },
      update: {
        status,
        outcome: dispute.status ?? null,
        evidenceSubmittedAt:
          dispute.evidence_details?.submission_count &&
          dispute.evidence_details.submission_count > 0
            ? new Date()
            : undefined,
      },
    });
  }

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
        locationId,
      },
    },
  });
}

async function handleAccountUpdated(
  event: Stripe.Event,
  tenantId: string | null,
  locationId: string | null = null,
): Promise<void> {
  if (!tenantId) return;

  const account = event.data.object as Stripe.Account;
  const chargesEnabled = account.charges_enabled ?? false;
  const payoutsEnabled = account.payouts_enabled ?? false;
  const detailsSubmitted = account.details_submitted ?? false;

  // Mark onboarding complete when the account can accept charges.
  if (chargesEnabled) {
    if (locationId) {
      await prisma.location.update({
        where: { id: locationId },
        data: { stripeOnboardingComplete: true },
      });
    } else {
      // Tenant-level account — no separate onboarding flag, just log.
    }
  }

  // Record the capability/account update so operators can see onboarding
  // progress. The platform Health dashboard reads back the most recent
  // entry per account to populate its capability columns.
  await prisma.auditLog.create({
    data: {
      tenantId,
      recordType: locationId ? "Location" : "Tenant",
      recordId: locationId ?? tenantId,
      action: "STRIPE_ACCOUNT_UPDATED",
      changedFieldsJson: {
        eventType: event.type,
        eventId: event.id,
        chargesEnabled,
        payoutsEnabled,
        detailsSubmitted,
        locationId,
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
