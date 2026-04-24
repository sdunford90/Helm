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
