import Stripe from "stripe";

// Pinned to a known-tested Stripe API version. Bump deliberately after
// reviewing the upgrade guide.
export const STRIPE_API_VERSION = "2026-03-25.dahlia" as const;

// Stripe is optional — routes that require it should check before use.
export const stripe: Stripe | null = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY, {
      // Cast needed because the exact version type isn't exported as a named alias in v22.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      apiVersion: STRIPE_API_VERSION as any,
      typescript: true,
    })
  : null;

export function requireStripe(): Stripe {
  if (!stripe) {
    throw new Error("Stripe is not configured. Set STRIPE_SECRET_KEY.");
  }
  return stripe;
}

/**
 * Create a PaymentIntent on a connected account with an application fee.
 * Kept for callers that haven't yet migrated to Checkout Sessions.
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
