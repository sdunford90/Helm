import { prisma } from "../lib/prisma.js";
import { reversePostRefund } from "./gl-posting.js";

/**
 * Concurrency-safe rollback of a previously-reserved partial refund.
 *
 * Phase 1 of the refund flow atomically reserves a slot on the payment
 * (`refundedCents += refundAmount`) and updates dependent state (GL,
 * invoice balance, status). If Phase 2 (the external processor call,
 * e.g. Stripe) fails, this helper undoes Phase 1 in a way that does
 * NOT clobber concurrent successful refunds.
 *
 * Critical: rollback must NOT restore absolute snapshots. If another
 * refund completed between our reservation commit and our rollback,
 * blindly writing back our pre-request snapshot would erase that
 * other refund. Instead we use atomic decrements, then recompute
 * payment + invoice status from the resulting row state so the
 * remaining refund (if any) stays correctly reflected.
 */
export async function rollbackReservedRefund(args: {
  paymentId: string;
  tenantId: string;
  paymentMethod: string;
  paymentAmountCents: number;
  refundAmountCents: number;
  invoiceId: string | null;
  /**
   * Optional id of the `PaymentRefund` history row that was inserted in
   * Phase 1 alongside the `refundedCents` reservation. When provided, the
   * row is deleted in the same rollback transaction so the per-refund
   * history reflects only refunds that actually completed externally.
   */
  paymentRefundId?: string | null;
}): Promise<void> {
  const {
    paymentId,
    tenantId,
    paymentMethod,
    paymentAmountCents,
    refundAmountCents,
    invoiceId,
    paymentRefundId = null,
  } = args;

  await prisma.$transaction(async (tx) => {
    // Drop the per-refund history row first so we don't leave a dangling
    // entry pointing at a refund that never actually went through.
    // deleteMany is safe even if the id is missing or already gone.
    if (paymentRefundId) {
      await tx.paymentRefund.deleteMany({
        where: { id: paymentRefundId, tenantId },
      });
    }
    // Atomically subtract our reserved amount from the payment ledger.
    // Any concurrent refund that committed between our reservation and
    // our rollback remains intact because we're using a SQL-level
    // decrement rather than overwriting the field.
    await tx.payment.update({
      where: { id: paymentId },
      data: { refundedCents: { decrement: refundAmountCents } },
    });

    // Recompute payment status from the post-decrement value so a
    // concurrent refund that took the payment to PARTIALLY_REFUNDED
    // (or REFUNDED) stays at the correct status after we back out.
    const current = await tx.payment.findUniqueOrThrow({
      where: { id: paymentId },
      select: { refundedCents: true, status: true },
    });

    const recomputedStatus =
      current.refundedCents <= 0
        ? "COMPLETED"
        : current.refundedCents >= paymentAmountCents
        ? "REFUNDED"
        : "PARTIALLY_REFUNDED";

    if (recomputedStatus !== current.status) {
      await tx.payment.update({
        where: { id: paymentId },
        data: { status: recomputedStatus },
      });
    }

    // Reverse the GL entries we posted in Phase 1 (a balanced inverse
    // entry rather than deleting rows, so the audit trail stays intact).
    await reversePostRefund(
      { id: paymentId, tenantId, method: paymentMethod },
      refundAmountCents,
      tx,
    );

    // Restore the invoice using the same atomic-decrement pattern, then
    // recompute invoice status from the post-decrement balance.
    if (invoiceId) {
      await tx.invoice.update({
        where: { id: invoiceId },
        data: { balanceCents: { decrement: refundAmountCents } },
      });

      const inv = await tx.invoice.findUniqueOrThrow({
        where: { id: invoiceId },
        select: { balanceCents: true, status: true },
      });

      // Mirror the forward-path rule: a positive balance means ISSUED,
      // a zero balance after we back out means PAID. We don't touch
      // VOID or other terminal statuses.
      if (inv.status === "ISSUED" && inv.balanceCents <= 0) {
        await tx.invoice.update({
          where: { id: invoiceId },
          data: { status: "PAID" },
        });
      } else if (inv.status === "PAID" && inv.balanceCents > 0) {
        await tx.invoice.update({
          where: { id: invoiceId },
          data: { status: "ISSUED" },
        });
      }
    }
  });
}
