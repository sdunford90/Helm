import { loadStripe, type Stripe } from "@stripe/stripe-js";

// Memoized loader. loadStripe returns a Promise; Stripe.js is fetched once.
let stripePromise: Promise<Stripe | null> | null = null;

export function getStripe(): Promise<Stripe | null> {
  if (stripePromise) return stripePromise;
  const key = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;
  if (!key) {
    console.warn(
      "VITE_STRIPE_PUBLISHABLE_KEY is not set — Stripe Elements will not load.",
    );
    return Promise.resolve(null);
  }
  stripePromise = loadStripe(key);
  return stripePromise;
}

// Per-connected-account Stripe.js loader for POS keyed-card payments.
//
// PaymentIntents minted on a connected Stripe account can ONLY be confirmed
// by a Stripe.js instance that was initialized with `{ stripeAccount }` set
// to that same account id. Using the platform-scoped instance from
// `getStripe()` makes `confirmCardPayment` query the platform account and
// fail with "No such payment_intent: pi_..." even though the PI exists on
// the connected account.
//
// Memoized per-account so repeated POS modal opens for the same location
// don't refetch Stripe.js. Returns null if the publishable key is missing.
const stripeByAccount = new Map<string, Promise<Stripe | null>>();

export function getStripeForAccount(
  stripeAccountId: string,
): Promise<Stripe | null> {
  const cached = stripeByAccount.get(stripeAccountId);
  if (cached) return cached;
  const key = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;
  if (!key) {
    console.warn(
      "VITE_STRIPE_PUBLISHABLE_KEY is not set — Stripe Elements will not load.",
    );
    return Promise.resolve(null);
  }
  const promise = loadStripe(key, { stripeAccount: stripeAccountId });
  stripeByAccount.set(stripeAccountId, promise);
  return promise;
}
