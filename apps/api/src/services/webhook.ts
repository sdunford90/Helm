import { prisma } from "../lib/prisma.js";

/**
 * Webhook idempotency service.
 *
 * Guards against duplicate Stripe event processing by recording each event
 * id in the `processed_webhooks` table.  The check-and-insert is wrapped in
 * a serialisable transaction so concurrent deliveries of the same event
 * cannot both pass the guard.
 *
 * @returns `true` if the event is **new** and was marked as processed.
 *          `false` if the event was already handled.
 */
export async function checkAndMarkProcessed(
  stripeEventId: string,
  tenantId: string,
  eventType: string,
): Promise<boolean> {
  // Use an interactive transaction with serialisable isolation to prevent
  // race conditions between concurrent webhook deliveries.
  return prisma.$transaction(
    async (tx) => {
      const existing = await tx.processed_webhooks.findUnique({
        where: { stripe_event_id: stripeEventId },
      });

      if (existing) {
        return false;
      }

      await tx.processed_webhooks.create({
        data: {
          stripe_event_id: stripeEventId,
          tenant_id: tenantId,
          event_type: eventType,
          processed_at: new Date(),
        },
      });

      return true;
    },
    {
      isolationLevel: "Serializable",
    },
  );
}
