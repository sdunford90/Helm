import Stripe from "stripe";

// Stripe is optional — routes that require it should check before use.
export const stripe: Stripe | null = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: "2024-12-18.acacia" as Stripe.LatestApiVersion,
      typescript: true,
    })
  : null;

// --------------------------------------------------------------------------
// Helpers — each guard-checks that stripe is initialised
// --------------------------------------------------------------------------

export function requireStripe(): Stripe {
  if (!stripe) {
    throw new Error("Stripe is not configured. Set STRIPE_SECRET_KEY.");
  }
  return stripe;
}

/**
 * Create a PaymentIntent on a connected account with an application fee.
 */
export async function createPaymentIntent(
  amount: number,
  currency: string,
  connectedAccountId: string,
  applicationFeeAmount: number,
): Promise<Stripe.PaymentIntent> {
  return requireStripe().paymentIntents.create(
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
  return requireStripe().customers.create(
    { email, name },
    { stripeAccount: connectedAccountId },
  );
}
