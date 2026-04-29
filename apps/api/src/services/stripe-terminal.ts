import { stripe as stripeClient } from "../lib/stripe.js";

function getStripe() {
  if (!stripeClient) throw new Error("Stripe is not configured. Set STRIPE_SECRET_KEY.");
  return stripeClient;
}
const stripe = { get terminal() { return getStripe().terminal; }, get paymentIntents() { return getStripe().paymentIntents; }, get charges() { return getStripe().charges; } };

// --------------------------------------------------------------------------
// Stripe Terminal Integration for WisePOS E
// --------------------------------------------------------------------------

/**
 * Create a connection token for the Terminal SDK.
 * The client-side Terminal SDK calls this to authenticate with Stripe.
 */
export async function createConnectionToken(connectedAccountId: string): Promise<string> {
  const token = await stripe.terminal.connectionTokens.create(
    {},
    { stripeAccount: connectedAccountId },
  );

  return token.secret;
}

/**
 * List all registered Terminal readers for a connected marina account.
 *
 * No `device_type` filter is applied — Stripe's allowed device-type values
 * have changed over time (e.g. the legacy `"wispos_e"` value is now invalid
 * and causes the API to 400 the entire request, returning zero readers even
 * for marinas that have a WisePOS E paired). The POS Settings → Terminal
 * health view and the POS modal both work better with the unfiltered list,
 * so we let Stripe return every reader registered to the connected account.
 */
export async function listReaders(connectedAccountId: string): Promise<any[]> {
  const readers = await stripe.terminal.readers.list(
    { limit: 100 },
    { stripeAccount: connectedAccountId },
  );

  return readers.data;
}

/**
 * Register a new hardware reader using its pairing registration code.
 * The registration code is displayed on the reader's screen during setup.
 */
export async function registerReader(
  connectedAccountId: string,
  registrationCode: string,
  label: string,
): Promise<any> {
  return stripe.terminal.readers.create(
    { registration_code: registrationCode, label } as any,
    { stripeAccount: connectedAccountId },
  );
}

/**
 * Delete (unregister) a registered reader by its Stripe reader ID.
 */
export async function deleteReader(
  connectedAccountId: string,
  readerId: string,
): Promise<void> {
  await (stripe.terminal.readers as any).del(readerId, {}, { stripeAccount: connectedAccountId });
}

/**
 * Create a PaymentIntent configured for terminal capture with optional tip support.
 * Returns the client_secret for the Terminal SDK to collect the payment.
 */
export async function createPaymentIntent(params: {
  amount: number;
  connectedAccountId: string;
  applicationFee: number;
  tipEnabled: boolean;
  tipAmounts?: number[];
}): Promise<string> {
  const { amount, connectedAccountId, applicationFee, tipEnabled, tipAmounts } = params;

  const paymentIntentParams: Record<string, unknown> = {
    amount,
    currency: "usd",
    capture_method: "manual",
    payment_method_types: ["card_present"],
    application_fee_amount: applicationFee,
    metadata: {
      source: "terminal",
      tipEnabled: tipEnabled ? "true" : "false",
    },
  };

  // Configure tip collection on the terminal
  if (tipEnabled) {
    paymentIntentParams.metadata = {
      ...paymentIntentParams.metadata as Record<string, string>,
      suggestedTipAmounts: tipAmounts ? JSON.stringify(tipAmounts) : "",
    };
  }

  const paymentIntent = await stripe.paymentIntents.create(
    paymentIntentParams as unknown as Parameters<typeof stripe.paymentIntents.create>[0],
    { stripeAccount: connectedAccountId },
  );

  if (!paymentIntent.client_secret) {
    throw new Error("PaymentIntent created without client_secret");
  }

  return paymentIntent.client_secret;
}

/**
 * Capture a terminal payment, optionally adjusting the final amount to include a tip.
 */
export async function capturePayment(
  paymentIntentId: string,
  connectedAccountId: string,
  tipAmount?: number,
): Promise<void> {
  const captureParams: Record<string, unknown> = {};

  if (tipAmount !== undefined && tipAmount > 0) {
    // Retrieve the original PI to get the base amount
    const pi = await stripe.paymentIntents.retrieve(paymentIntentId, {}, {
      stripeAccount: connectedAccountId,
    });

    const originalAmount = pi.amount;
    captureParams.amount_to_capture = originalAmount + tipAmount;

    // Update application fee proportionally if needed
    if (pi.application_fee_amount) {
      captureParams.application_fee_amount = pi.application_fee_amount;
    }

    // Store tip metadata
    captureParams.metadata = {
      ...((pi.metadata as Record<string, string>) || {}),
      tipAmountCents: String(tipAmount),
      capturedAt: new Date().toISOString(),
    };
  }

  await stripe.paymentIntents.capture(
    paymentIntentId,
    captureParams as Parameters<typeof stripe.paymentIntents.capture>[1],
    { stripeAccount: connectedAccountId },
  );
}

/**
 * Process queued offline transactions when connectivity returns.
 * Creates payment intents and immediately confirms/captures them.
 */
export async function processOfflineQueue(
  queue: Array<{ amount: number; method: string; metadata: any }>,
  connectedAccountId: string,
): Promise<{ processed: number; failed: number }> {
  let processed = 0;
  let failed = 0;

  for (const item of queue) {
    try {
      const paymentIntent = await stripe.paymentIntents.create(
        {
          amount: item.amount,
          currency: "usd",
          confirm: true,
          capture_method: "automatic",
          payment_method_types: ["card_present"],
          metadata: {
            ...item.metadata,
            source: "terminal_offline",
            offlineProcessedAt: new Date().toISOString(),
          },
        } as Parameters<typeof stripe.paymentIntents.create>[0],
        { stripeAccount: connectedAccountId },
      );

      if (
        paymentIntent.status === "succeeded" ||
        paymentIntent.status === "requires_capture"
      ) {
        // If requires_capture, capture immediately
        if (paymentIntent.status === "requires_capture") {
          await stripe.paymentIntents.capture(paymentIntent.id, {}, {
            stripeAccount: connectedAccountId,
          });
        }
        processed++;
      } else {
        console.error("[stripe-terminal] Offline payment failed", {
          id: paymentIntent.id,
          status: paymentIntent.status,
        });
        failed++;
      }
    } catch (err) {
      console.error("[stripe-terminal] Offline queue item failed", err);
      failed++;
    }
  }

  return { processed, failed };
}

/**
 * Generate a tip report for terminal payments within a date range.
 * Queries captured terminal payments that have tip metadata.
 */
export async function getTipReport(
  connectedAccountId: string,
  startDate: string,
  endDate: string,
): Promise<{
  totalTipsCents: number;
  byEmployee: Array<{ employeeId: string; name: string; tipsCents: number }>;
  byDay: Array<{ date: string; tipsCents: number }>;
}> {
  const startTimestamp = Math.floor(new Date(startDate).getTime() / 1000);
  const endTimestamp = Math.floor(new Date(endDate).getTime() / 1000);

  // Fetch all captured terminal payments in the date range
  const charges: any[] = [];
  let hasMore = true;
  let startingAfter: string | undefined;

  while (hasMore) {
    const listParams: Record<string, unknown> = {
      limit: 100,
      created: { gte: startTimestamp, lte: endTimestamp },
    };
    if (startingAfter) {
      listParams.starting_after = startingAfter;
    }

    const page = await stripe.charges.list(
      listParams as Parameters<typeof stripe.charges.list>[0],
      { stripeAccount: connectedAccountId },
    );

    // Filter for terminal payments with tips
    const terminalCharges = page.data.filter(
      (c) =>
        c.payment_method_details?.type === "card_present" &&
        c.metadata?.tipAmountCents &&
        parseInt(c.metadata.tipAmountCents, 10) > 0,
    );

    charges.push(...terminalCharges);
    hasMore = page.has_more;

    if (page.data.length > 0) {
      startingAfter = page.data[page.data.length - 1].id;
    } else {
      hasMore = false;
    }
  }

  // Aggregate tips
  let totalTipsCents = 0;
  const employeeMap = new Map<string, { name: string; tipsCents: number }>();
  const dayMap = new Map<string, number>();

  for (const charge of charges) {
    const tipCents = parseInt(charge.metadata.tipAmountCents, 10);
    totalTipsCents += tipCents;

    // Aggregate by employee
    const employeeId = charge.metadata.employeeId || "unassigned";
    const employeeName = charge.metadata.employeeName || "Unassigned";
    const existing = employeeMap.get(employeeId);
    if (existing) {
      existing.tipsCents += tipCents;
    } else {
      employeeMap.set(employeeId, { name: employeeName, tipsCents: tipCents });
    }

    // Aggregate by day
    const chargeDate = new Date(charge.created * 1000).toISOString().split("T")[0];
    dayMap.set(chargeDate, (dayMap.get(chargeDate) || 0) + tipCents);
  }

  const byEmployee = Array.from(employeeMap.entries()).map(([employeeId, data]) => ({
    employeeId,
    name: data.name,
    tipsCents: data.tipsCents,
  }));

  const byDay = Array.from(dayMap.entries())
    .map(([date, tipsCents]) => ({ date, tipsCents }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return { totalTipsCents, byEmployee, byDay };
}
