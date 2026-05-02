// POS Card-Not-Present (keyed-card) charge orchestration.
//
// Extracted from `CnpForm.handleCharge` so the server-confirmed PaymentIntent
// flow added in task #254 has a single, framework-free unit-test target.
//
// The whole point of this helper is to *prove* that the browser:
//   1. POSTs to `/api/pos/payments/cnp` to obtain a `clientSecret` minted on
//      the **resolved location's connected Stripe account**, and
//   2. Calls `stripe.confirmCardPayment(clientSecret, …)` against that same
//      account — never `stripe.createPaymentMethod(…)` against the platform
//      account, which is what caused the original "platform-owned payment
//      method ID" rejection.
//
// Keeping this orchestration small and dependency-injected means a regression
// (e.g. someone re-adding `createPaymentMethod`) can be caught by a focused
// vitest unit, rather than requiring a full Stripe.js / DOM harness.

import type { Stripe, StripeCardElement, PaymentIntent } from "@stripe/stripe-js";

export type CardRail = "TERMINAL" | "CNP";
export type CnpFallbackReason = "NO_READER" | "DISCOVERY_FAILED" | "MANUAL_CHOICE";
export type CardPaymentMeta = { cardRail: CardRail; cnpFallbackReason: CnpFallbackReason | null };

/**
 * Subset of the Stripe.js client surface we actually use, narrowed so tests
 * can supply a tiny fake without re-implementing all of Stripe.js.
 */
export type CnpStripe = Pick<Stripe, "confirmCardPayment">;

/**
 * Subset of `apiCall` used by the orchestration. Returns `unknown` because
 * the helper validates the shape itself.
 */
export type CnpApiCall = (
  method: string,
  path: string,
  body?: unknown,
) => Promise<unknown>;

export type ChargeCnpResult =
  | { ok: true; meta: CardPaymentMeta; paymentIntent: Pick<PaymentIntent, "id" | "status"> }
  | { ok: false; error: string };

export interface ChargeCnpInput {
  /** Total in dollars (decimal). Converted to cents internally. */
  total: number;
  /** Resolved location id, or null to let the backend fall back to tenant scope. */
  locationId: string | null;
  /** How the cashier landed on the keyed form (NO_READER / DISCOVERY_FAILED / MANUAL_CHOICE). */
  fallbackReason: CnpFallbackReason;
  /**
   * Per-CnpForm random id (e.g. crypto.randomUUID()). The backend folds it
   * into the Stripe `Idempotency-Key` so a double-clicked or network-retried
   * "Charge Card" stops creating a second abandoned PaymentIntent on the
   * marina's connected account. Must be stable across retries of the SAME
   * cashier attempt — generated once when the form mounts, reused across
   * every charge of that form.
   */
  clientNonce: string;
  stripe: CnpStripe;
  cardEl: StripeCardElement;
  apiCall: CnpApiCall;
}

/**
 * Run the full CNP charge.
 *
 * Order of operations is contractually important and asserted by tests:
 *   1. POST `/api/pos/payments/cnp` -> `{ id, clientSecret }`
 *   2. `stripe.confirmCardPayment(clientSecret, { payment_method: { card } })`
 *   3. Bail unless `paymentIntent.status === "succeeded"`
 *   4. POST `/api/pos/payments/cnp/finalize` with the PI id so the server
 *      can re-fetch the PI on the connected account and verify success
 *      (the browser is untrusted; Stripe is the source of truth).
 *
 * The helper *must not* call `stripe.createPaymentMethod`, *must not* send a
 * `paymentMethodId` to the backend, and *must* pass the secret straight from
 * step 1 into step 2 unchanged. Those invariants are what protect us from
 * regressing into the cross-account mismatch this task was opened to fix.
 */
export async function chargeCnp(input: ChargeCnpInput): Promise<ChargeCnpResult> {
  const { total, locationId, fallbackReason, clientNonce, stripe, cardEl, apiCall } = input;

  const amountCents = Math.round(total * 100);

  // Step 1 — backend creates an unconfirmed PaymentIntent on the location's
  // connected Stripe account and returns the account-scoped client_secret.
  // `clientNonce` is forwarded so the server can build a stable Stripe
  // `Idempotency-Key`; double-clicks / retries collapse to the same PI.
  const created = (await apiCall("POST", "/api/pos/payments/cnp", {
    amountCents,
    clientNonce,
    ...(locationId ? { locationId } : {}),
  })) as { id?: string; clientSecret?: string } | null | undefined;

  const clientSecret = created?.clientSecret;
  const paymentIntentId = created?.id;
  if (!clientSecret || !paymentIntentId) {
    return { ok: false, error: "Could not start payment" };
  }

  // Step 2 — confirm client-side. Stripe.js tokenizes the card on the same
  // connected account the secret is scoped to, so the cross-account
  // "platform-owned payment method ID" rejection becomes structurally
  // impossible. 3-D Secure / `requires_action` flows are handled by
  // Stripe.js automatically.
  const { paymentIntent, error: confirmErr } = await stripe.confirmCardPayment(clientSecret, {
    payment_method: { card: cardEl },
  });

  if (confirmErr) {
    return { ok: false, error: confirmErr.message ?? "Card declined" };
  }
  if (!paymentIntent || paymentIntent.status !== "succeeded") {
    return {
      ok: false,
      error: `Payment did not complete (${paymentIntent?.status ?? "unknown"})`,
    };
  }

  // Step 3 — server-side finalization. The browser is untrusted; the
  // server re-fetches the PI on the connected account and refuses to
  // record the sale unless Stripe agrees the payment succeeded for the
  // expected amount. Also writes an audit row that ties the PI id to
  // this sale for downstream reconciliation (no schema change).
  try {
    await apiCall("POST", "/api/pos/payments/cnp/finalize", {
      paymentIntentId,
      expectedAmountCents: amountCents,
      ...(locationId ? { locationId } : {}),
    });
  } catch (err: unknown) {
    return {
      ok: false,
      error: (err as Error)?.message ?? "Could not finalize payment",
    };
  }

  return {
    ok: true,
    meta: { cardRail: "CNP", cnpFallbackReason: fallbackReason },
    paymentIntent: { id: paymentIntent.id, status: paymentIntent.status },
  };
}
