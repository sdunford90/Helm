import { prisma } from "../lib/prisma.js";

/**
 * Webhook idempotency service.
 *
 * Guards against duplicate Stripe event processing by recording each event
 * id in the `processed_webhooks` table. The check-and-insert is wrapped in a
 * serialisable transaction so concurrent deliveries of the same event cannot
 * both pass the guard.
 *
 * @returns `true` if the event is **new** and was marked as processed.
 *          `false` if the event was already handled.
 */
export async function checkAndMarkProcessed(
  stripeEventId: string,
  status: string,
  tenantId: string | null = null,
): Promise<boolean> {
  return prisma.$transaction(
    async (tx) => {
      const existing = await tx.processedWebhook.findUnique({
        where: { stripeEventId },
      });

      if (existing) {
        return false;
      }

      await tx.processedWebhook.create({
        data: {
          stripeEventId,
          tenantId,
          status,
          processedAt: new Date(),
        },
      });

      return true;
    },
    { isolationLevel: "Serializable" },
  );
}
