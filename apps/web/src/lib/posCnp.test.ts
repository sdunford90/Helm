import { describe, it, expect, vi } from "vitest";
import { chargeCnp } from "./posCnp";
import type { CnpApiCall, CnpStripe } from "./posCnp";

// These tests pin the contract that protects us from regressing the task
// #254 fix. The keyed-card flow MUST:
//   1. POST /api/pos/payments/cnp first to mint an account-scoped client_secret
//   2. then call stripe.confirmCardPayment(clientSecret, { payment_method: { card } })
//   3. then POST /api/pos/payments/cnp/finalize so the server can verify
//      success on the connected account (browser is untrusted).
// Any change that re-introduces stripe.createPaymentMethod() or sends
// paymentMethodId to the backend would resurrect the original
// "platform-owned payment method ID" Stripe rejection at marinas with
// per-location Stripe Connect accounts.

function fakeCardEl() {
  // chargeCnp only forwards this object to stripe.confirmCardPayment — we
  // don't need a real CardElement, just a stable identity to assert on.
  return { __isFakeCardEl: true } as unknown as Parameters<typeof chargeCnp>[0]["cardEl"];
}

/** Build an apiCall that routes by path, defaulting to a successful
 *  create + finalize. Tests override individual paths as needed. */
function makeApiCall(overrides: Record<string, unknown> = {}) {
  const create = overrides["/api/pos/payments/cnp"] ?? {
    id: "pi_cnp_1",
    clientSecret: "pi_cnp_1_secret_abc",
    status: "requires_confirmation",
  };
  const finalize = overrides["/api/pos/payments/cnp/finalize"] ?? {
    id: "pi_cnp_1",
    status: "succeeded",
    amount: 5000,
  };
  return vi.fn(async (_method: string, path: string) => {
    if (path === "/api/pos/payments/cnp") return create;
    if (path === "/api/pos/payments/cnp/finalize") return finalize;
    throw new Error(`Unexpected apiCall path: ${path}`);
  }) as unknown as ReturnType<typeof vi.fn> & CnpApiCall;
}

describe("chargeCnp — POS keyed-card flow (task #254)", () => {
  it("POSTs to /api/pos/payments/cnp WITHOUT a paymentMethodId, then confirms with the returned client_secret, then finalizes", async () => {
    const apiCall = makeApiCall();
    const confirmCardPayment = vi.fn().mockResolvedValue({
      paymentIntent: { id: "pi_cnp_1", status: "succeeded" },
    });
    const stripe: CnpStripe = { confirmCardPayment } as unknown as CnpStripe;
    const cardEl = fakeCardEl();

    const result = await chargeCnp({
      total: 50.0,
      locationId: "loc-A",
      fallbackReason: "MANUAL_CHOICE",
      clientNonce: "nonce-abc",
      stripe,
      cardEl,
      apiCall,
    });

    // Two backend calls in strict order: create, then finalize.
    expect(apiCall).toHaveBeenCalledTimes(2);
    expect((apiCall as ReturnType<typeof vi.fn>).mock.calls[0]).toEqual([
      "POST",
      "/api/pos/payments/cnp",
      { amountCents: 5000, clientNonce: "nonce-abc", locationId: "loc-A" },
    ]);
    // Create body must NOT carry paymentMethodId — that's the field that
    // caused the platform-vs-connected-account mismatch.
    const createBody = (apiCall as ReturnType<typeof vi.fn>).mock.calls[0][2] as Record<string, unknown>;
    expect(createBody).not.toHaveProperty("paymentMethodId");

    // Confirmation: client_secret straight through unchanged, card element
    // passed under payment_method.card. Confirmation MUST happen between
    // create and finalize.
    expect(confirmCardPayment).toHaveBeenCalledTimes(1);
    expect(confirmCardPayment).toHaveBeenCalledWith(
      "pi_cnp_1_secret_abc",
      { payment_method: { card: cardEl } },
    );

    // Finalize: PI id propagated from create response, expected amount
    // echoed so the server can detect tampering.
    expect((apiCall as ReturnType<typeof vi.fn>).mock.calls[1]).toEqual([
      "POST",
      "/api/pos/payments/cnp/finalize",
      { paymentIntentId: "pi_cnp_1", expectedAmountCents: 5000, locationId: "loc-A" },
    ]);

    expect(result).toEqual({
      ok: true,
      // `stripePaymentIntentId` mirrors paymentIntent.id and is what
      // `handlePaymentComplete` forwards to POST /api/pos/transactions so
      // the row stores the PI id for end-of-day reconciliation, refunds,
      // and Stripe dispute matching (task #255).
      meta: {
        cardRail: "CNP",
        cnpFallbackReason: "MANUAL_CHOICE",
        stripePaymentIntentId: "pi_cnp_1",
      },
      paymentIntent: { id: "pi_cnp_1", status: "succeeded" },
    });
  });

  it("does not create a PaymentMethod against the platform account (regression guard)", async () => {
    // The bug was that the old flow called stripe.createPaymentMethod on
    // the platform-account Stripe.js instance and shipped the resulting
    // pm_xxx id to the backend, which then failed to confirm on the
    // connected account. The fixed flow must never go anywhere near
    // createPaymentMethod — guarded here by giving the fake Stripe a
    // tripwire method that fails the test if anyone calls it.
    const createPaymentMethod = vi.fn().mockRejectedValue(
      new Error("createPaymentMethod must not be called in the CNP flow"),
    );
    const confirmCardPayment = vi.fn().mockResolvedValue({
      paymentIntent: { id: "pi_cnp_2", status: "succeeded" },
    });
    const apiCall = makeApiCall({
      "/api/pos/payments/cnp": { id: "pi_cnp_2", clientSecret: "pi_cnp_2_secret_def" },
      "/api/pos/payments/cnp/finalize": { id: "pi_cnp_2", status: "succeeded", amount: 1234 },
    });
    const stripe = { confirmCardPayment, createPaymentMethod } as unknown as CnpStripe;

    const result = await chargeCnp({
      total: 12.34,
      locationId: null,
      fallbackReason: "NO_READER",
      clientNonce: "nonce-def",
      stripe,
      cardEl: fakeCardEl(),
      apiCall,
    });

    expect(result.ok).toBe(true);
    expect(createPaymentMethod).not.toHaveBeenCalled();
    // No locationId on either request body when none is selected — backend
    // falls back to tenant scope. clientNonce is always present so the
    // backend can build a deterministic Stripe Idempotency-Key.
    expect((apiCall as ReturnType<typeof vi.fn>).mock.calls[0][2]).toEqual({
      amountCents: 1234,
      clientNonce: "nonce-def",
    });
    expect((apiCall as ReturnType<typeof vi.fn>).mock.calls[1][2]).toEqual({
      paymentIntentId: "pi_cnp_2",
      expectedAmountCents: 1234,
    });
  });

  it("returns an error and does NOT confirm or finalize when the backend omits clientSecret", async () => {
    const apiCall = makeApiCall({ "/api/pos/payments/cnp": { id: "pi_cnp_3" } });
    const confirmCardPayment = vi.fn();
    const stripe: CnpStripe = { confirmCardPayment } as unknown as CnpStripe;

    const result = await chargeCnp({
      total: 10,
      locationId: "loc-A",
      fallbackReason: "MANUAL_CHOICE",
      clientNonce: "nonce-3",
      stripe,
      cardEl: fakeCardEl(),
      apiCall,
    });

    expect(result).toEqual({ ok: false, error: "Could not start payment" });
    expect(confirmCardPayment).not.toHaveBeenCalled();
    // Finalize must not run if create failed.
    expect(apiCall).toHaveBeenCalledTimes(1);
  });

  it("surfaces Stripe.confirmCardPayment errors verbatim and skips finalize", async () => {
    const apiCall = makeApiCall();
    const confirmCardPayment = vi.fn().mockResolvedValue({
      error: { message: "Your card was declined." },
    });
    const stripe: CnpStripe = { confirmCardPayment } as unknown as CnpStripe;

    const result = await chargeCnp({
      total: 10,
      locationId: "loc-A",
      fallbackReason: "MANUAL_CHOICE",
      clientNonce: "nonce-4",
      stripe,
      cardEl: fakeCardEl(),
      apiCall,
    });

    expect(result).toEqual({ ok: false, error: "Your card was declined." });
    // Finalize must not run when confirmation fails.
    expect(apiCall).toHaveBeenCalledTimes(1);
  });

  it("treats non-succeeded PaymentIntent statuses as a failed sale and skips finalize", async () => {
    // E.g. requires_payment_method after a soft decline — the cashier needs
    // to see it as a failure, not silently mark the cart as paid.
    const apiCall = makeApiCall();
    const confirmCardPayment = vi.fn().mockResolvedValue({
      paymentIntent: { id: "pi_cnp_5", status: "requires_payment_method" },
    });
    const stripe: CnpStripe = { confirmCardPayment } as unknown as CnpStripe;

    const result = await chargeCnp({
      total: 10,
      locationId: "loc-A",
      fallbackReason: "MANUAL_CHOICE",
      clientNonce: "nonce-5",
      stripe,
      cardEl: fakeCardEl(),
      apiCall,
    });

    expect(result).toEqual({
      ok: false,
      error: "Payment did not complete (requires_payment_method)",
    });
    expect(apiCall).toHaveBeenCalledTimes(1);
  });

  it("surfaces finalize failures so the cashier doesn't think a rejected payment succeeded", async () => {
    // If the server-side verification disagrees with the browser (e.g.
    // amount mismatch, PI not actually succeeded) we MUST report failure
    // rather than letting the cart be recorded as paid.
    const finalizeError = new Error("AMOUNT_MISMATCH");
    const apiCall = vi.fn(async (_method: string, path: string) => {
      if (path === "/api/pos/payments/cnp") {
        return { id: "pi_cnp_6", clientSecret: "pi_cnp_6_secret" };
      }
      throw finalizeError;
    }) as unknown as CnpApiCall;
    const confirmCardPayment = vi.fn().mockResolvedValue({
      paymentIntent: { id: "pi_cnp_6", status: "succeeded" },
    });
    const stripe: CnpStripe = { confirmCardPayment } as unknown as CnpStripe;

    const result = await chargeCnp({
      total: 10,
      locationId: "loc-A",
      fallbackReason: "MANUAL_CHOICE",
      clientNonce: "nonce-6",
      stripe,
      cardEl: fakeCardEl(),
      apiCall,
    });

    expect(result).toEqual({ ok: false, error: "AMOUNT_MISMATCH" });
  });

  // Task #256: a stable per-form clientNonce is what makes the backend's
  // Stripe Idempotency-Key meaningful. If the same CnpForm is invoked
  // twice (e.g. cashier double-clicks "Charge"), both POSTs MUST carry
  // the same nonce so the server keys collapse and Stripe returns the
  // same PaymentIntent rather than minting a second abandoned PI.
  it("forwards the supplied clientNonce verbatim and reuses it across retries", async () => {
    const apiCall = makeApiCall();
    const confirmCardPayment = vi.fn().mockResolvedValue({
      paymentIntent: { id: "pi_cnp_1", status: "succeeded" },
    });
    const stripe: CnpStripe = { confirmCardPayment } as unknown as CnpStripe;

    const baseInput = {
      total: 50,
      locationId: "loc-A" as string | null,
      fallbackReason: "MANUAL_CHOICE" as const,
      clientNonce: "double-click-nonce",
      stripe,
      cardEl: fakeCardEl(),
      apiCall,
    };

    await chargeCnp(baseInput);
    await chargeCnp(baseInput);

    const calls = (apiCall as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c) => c[1] === "/api/pos/payments/cnp",
    );
    expect(calls).toHaveLength(2);
    expect((calls[0][2] as Record<string, unknown>).clientNonce).toBe("double-click-nonce");
    expect((calls[1][2] as Record<string, unknown>).clientNonce).toBe("double-click-nonce");
  });
});
