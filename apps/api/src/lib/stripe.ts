import Stripe from "stripe";
import { prisma } from "./prisma.js";

if (!process.env.STRIPE_SECRET_KEY) {
  console.warn("[helm-api] STRIPE_SECRET_KEY not set — Stripe features will be unavailable");
}

export const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: "2024-12-18.acacia" as Stripe.LatestApiVersion,
      typescript: true,
    })
  : null;

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

/**
 * Create a PaymentIntent on a connected account with an application fee.
 */
export async function createPaymentIntent(
  amount: number,
  currency: string,
  connectedAccountId: string,
  applicationFeeAmount: number,
): Promise<Stripe.PaymentIntent> {
  return stripe.paymentIntents.create(
    {
      amount,
      currency,
      application_fee_amount: applicationFeeAmount,
    },
    {
      stripeAccount: connectedAccountId,
    },
  );
}

/**
 * Create a Customer on a connected account.
 */
export async function createCustomer(
  email: string,
  name: string,
  connectedAccountId: string,
): Promise<Stripe.Customer> {
  return stripe.customers.create(
    { email, name },
    { stripeAccount: connectedAccountId },
  );
}

/**
 * Verify a webhook signature and parse the event.  Returns null if the event
 * has already been processed (idempotency guard).
 */
export async function processWebhook(
  payload: string | Buffer,
  signature: string,
  webhookSecret: string,
  tenantId: string,
): Promise<Stripe.Event | null> {
  const event = stripe.webhooks.constructEvent(payload, signature, webhookSecret);

  // Idempotency: check if we already processed this event
  const existing = await prisma.processed_webhooks.findUnique({
    where: { stripe_event_id: event.id },
  });

  if (existing) {
    return null; // Already handled
  }

  // Mark as processed — the actual handler should wrap its work in a
  // transaction that also includes this insert, but we do a preliminary
  // insert here to guard against concurrent deliveries.
  await prisma.processed_webhooks.create({
    data: {
      stripe_event_id: event.id,
      tenant_id: tenantId,
      event_type: event.type,
      processed_at: new Date(),
    },
  });

  return event;
}
