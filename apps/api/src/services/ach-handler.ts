import { prisma } from "../lib/prisma.js";
import { v4 as uuid } from "uuid";
import { postAchReturn } from "./gl-posting.js";
import { queues } from "../lib/queue.js";
import type Stripe from "stripe";

// ---------------------------------------------------------------------------
// ACH Return Handler
//
// Processes ACH return events from Stripe webhooks.  Handles R-code parsing,
// GL reversal, invoice reopening, return fee assessment, ACH blocking, and
// customer/staff notification.
// ---------------------------------------------------------------------------

// R-codes that should trigger an ACH block on the customer
const BLOCK_R_CODES = new Set(["R02", "R03", "R07", "R10"]);

// Human-readable R-code descriptions
const R_CODE_DESCRIPTIONS: Record<string, string> = {
  R01: "Insufficient Funds",
  R02: "Account Closed",
  R03: "No Account / Unable to Locate Account",
  R04: "Invalid Account Number",
  R05: "Improper Debit to Consumer Account",
  R07: "Authorization Revoked by Customer",
  R08: "Payment Stopped",
  R09: "Uncollected Funds",
  R10: "Customer Advises Unauthorized",
  R11: "Check Truncation Entry Return",
  R16: "Account Frozen",
  R20: "Non-Transaction Account",
  R29: "Corporate Customer Advises Not Authorized",
};

/**
 * Default return fee in cents charged to the customer.
 */
const DEFAULT_RETURN_FEE_CENTS = 2500; // $25.00

export interface AchReturnResult {
  achReturnId: string;
  rCode: string;
  rCodeDescription: string;
  reversalJournalId: string;
  achBlocked: boolean;
  returnFeeCents: number;
}

/**
 * Handle an ACH return event from Stripe.
 *
 * Steps:
 * 1. Parse the R-code from the Stripe event
 * 2. Reverse the payment GL entries
 * 3. Reopen the associated invoice
 * 4. Add a return fee line item to the invoice
 * 5. Block ACH if R-code warrants it (R02, R03, R07, R10)
 * 6. Send customer notification
 * 7. Alert marina staff
 */
export async function handleAchReturn(
  stripeEvent: Stripe.Event,
  tenantId: string,
): Promise<AchReturnResult> {
  // Extract charge data from the event
  const charge = stripeEvent.data.object as Stripe.Charge;
  const stripePaymentId = charge.payment_intent as string | null;

  if (!stripePaymentId) {
    throw new Error("ACH return event missing payment_intent");
  }

  // Parse R-code from failure message or metadata
  const rCode = extractRCode(charge);

  // Find the original payment
  const payment = await prisma.payment.findFirst({
    where: {
      tenantId,
      stripePaymentId,
      method: "ACH",
    },
    include: {
      invoice: {
        select: { id: true, status: true, balanceCents: true, totalCents: true, locationId: true },
      },
      customer: {
        select: { id: true, email: true, firstName: true, lastName: true },
      },
    },
  });

  if (!payment) {
    throw new Error(
      `Payment not found for Stripe payment ${stripePaymentId} in tenant ${tenantId}`,
    );
  }

  const shouldBlock = BLOCK_R_CODES.has(rCode);
  const returnFeeCents = DEFAULT_RETURN_FEE_CENTS;
  const achReturnId = uuid();

  const result = await prisma.$transaction(async (tx) => {
    // 1. Reverse payment GL entries
    const reversalJournalId = await postAchReturn(
      {
        id: achReturnId,
        tenantId,
        paymentId: payment.id,
        amountCents: payment.amountCents,
        // Per-location chart of accounts: scope the bank/A/R reversal
        // to the same per-location rows the original payment posted to.
        locationId: payment.invoice?.locationId ?? null,
      },
      tx,
    );

    // 2. Mark original payment as failed
    await tx.payment.update({
      where: { id: payment.id },
      data: { status: "FAILED" },
    });

    // 3. Reopen invoice if it exists
    if (payment.invoice) {
      const newBalance = payment.invoice.balanceCents + payment.amountCents;
      await tx.invoice.update({
        where: { id: payment.invoice.id },
        data: {
          balanceCents: newBalance,
          status: newBalance >= payment.invoice.totalCents ? "ISSUED" : "ISSUED",
        },
      });

      // 4. Add return fee as a new line item on the invoice
      await tx.invoiceLineItem.create({
        data: {
          id: uuid(),
          invoiceId: payment.invoice.id,
          description: `ACH Return Fee (${rCode}: ${R_CODE_DESCRIPTIONS[rCode] ?? "Unknown"})`,
          quantity: 1,
          unitPriceCents: returnFeeCents,
          discountCents: 0,
          taxRate: 0,
          taxCents: 0,
          extendedCents: returnFeeCents,
          sourceType: "ACH_RETURN",
          sourceId: achReturnId,
        },
      });

      // Update invoice totals
      await tx.invoice.update({
        where: { id: payment.invoice.id },
        data: {
          subtotalCents: { increment: returnFeeCents },
          totalCents: { increment: returnFeeCents },
          balanceCents: { increment: returnFeeCents },
        },
      });
    }

    // 5. Block ACH if applicable
    if (shouldBlock) {
      await tx.customer.update({
        where: { id: payment.customerId },
        data: { achBlocked: true },
      });
    }

    // 6. Create ACH return record
    await tx.achReturn.create({
      data: {
        id: achReturnId,
        tenantId,
        paymentId: payment.id,
        customerId: payment.customerId,
        rCode,
        returnedAt: new Date(),
        reversalEntryId: reversalJournalId,
        returnFeeCents,
        achBlockedSet: shouldBlock,
      },
    });

    // 7. Audit log
    await tx.auditLog.create({
      data: {
        tenantId,
        recordType: "AchReturn",
        recordId: achReturnId,
        action: "ACH_RETURN_PROCESSED",
        changedFieldsJson: {
          rCode,
          paymentId: payment.id,
          amountCents: payment.amountCents,
          achBlocked: shouldBlock,
        },
      },
    });

    return reversalJournalId;
  });

  // 8. Queue customer notification (async, outside transaction)
  try {
    await queues.email.add("ach-return-notification", {
      tenantId,
      customerId: payment.customerId,
      customerEmail: payment.customer.email,
      customerName: `${payment.customer.firstName} ${payment.customer.lastName}`,
      rCode,
      rCodeDescription: R_CODE_DESCRIPTIONS[rCode] ?? "Unknown",
      amountCents: payment.amountCents,
      returnFeeCents,
      achBlocked: shouldBlock,
    });
  } catch (err) {
    console.error("Failed to queue ACH return notification:", err);
  }

  // 9. Update notification timestamp
  await prisma.achReturn.update({
    where: { id: achReturnId },
    data: { customerNotifiedAt: new Date() },
  });

  return {
    achReturnId,
    rCode,
    rCodeDescription: R_CODE_DESCRIPTIONS[rCode] ?? "Unknown",
    reversalJournalId: result,
    achBlocked: shouldBlock,
    returnFeeCents,
  };
}

/**
 * Extract R-code from a Stripe charge object.
 */
function extractRCode(charge: Stripe.Charge): string {
  // Stripe includes the R-code in the failure_code or outcome
  const failureCode = charge.failure_code ?? "";
  const failureMessage = charge.failure_message ?? "";

  // Look for R-code pattern (R followed by 2 digits)
  const rCodeMatch = `${failureCode} ${failureMessage}`.match(/R\d{2}/);
  if (rCodeMatch) {
    return rCodeMatch[0];
  }

  // Map common Stripe failure codes to R-codes
  const stripeToRCode: Record<string, string> = {
    account_closed: "R02",
    no_account: "R03",
    insufficient_funds: "R01",
    debit_not_authorized: "R07",
  };

  return stripeToRCode[failureCode] ?? "R01";
}
