import { prisma } from "../lib/prisma.js";
import { queues } from "../lib/queue.js";

/**
 * Scan for transient bookings whose checkOut datetime has passed but whose
 * status is still BOOKED or CHECKED_IN. Flip them to OVERSTAY and queue
 * notifications. Safe to run on a schedule; idempotent per-booking because
 * updateMany transitions only rows that haven't flipped yet.
 *
 * Returns the count of bookings transitioned so callers can log it.
 */
export async function scanOverstayTransients(
  tenantId: string,
  now: Date = new Date(),
): Promise<{ flipped: number }> {
  const candidates = await prisma.transientBooking.findMany({
    where: {
      tenantId,
      status: { in: ["BOOKED", "CHECKED_IN"] },
      checkOut: { lt: now, not: null },
    },
    include: { slip: { select: { slipNumber: true } } },
  });
  if (candidates.length === 0) return { flipped: 0 };

  await prisma.transientBooking.updateMany({
    where: { id: { in: candidates.map((b) => b.id) } },
    data: { status: "OVERSTAY" },
  });

  // Best-effort notifications.
  for (const b of candidates) {
    try {
      if (b.guestEmail) {
        await queues.email.add("transient-overstay-guest", {
          tenantId,
          to: b.guestEmail,
          guestName: b.guestName,
          slipNumber: b.slip.slipNumber,
          expectedCheckOut: b.checkOut,
        });
      }
      if (b.guestPhone) {
        await queues.sms.add("transient-overstay-guest-sms", {
          tenantId,
          to: b.guestPhone,
          message: `Your slip ${b.slip.slipNumber} checkout was ${b.checkOut?.toDateString()}. Please contact the marina.`,
        });
      }
      await queues.email.add("transient-overstay-staff", {
        tenantId,
        bookingId: b.id,
        slipNumber: b.slip.slipNumber,
        guestName: b.guestName,
      });
    } catch (err) {
      console.error(`[transient-overstay] queue error for ${b.id}:`, err);
    }
  }

  return { flipped: candidates.length };
}
