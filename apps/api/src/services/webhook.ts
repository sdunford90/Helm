import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";

/**
 * Webhook idempotency service.
 *
 * Guards against duplicate Stripe event processing by recording each event
 * id in the `processed_webhooks` table (Prisma model ProcessedWebhook, unique
 * on stripeEventId). The insert itself is the guard: if two deliveries of the
 * same event race, the unique constraint lets exactly one of them win.
 *
 * NOTE: ProcessedWebhook has no event-type column; the event type is stored
 * in `status` as "processed:<eventType>" until the schema grows one.
 *
 * @returns `true` if the event is **new** and was marked as processed.
 *          `false` if the event was already handled.
 */
export async function checkAndMarkProcessed(
  stripeEventId: string,
  tenantId: string,
  eventType: string,
): Promise<boolean> {
  try {
    await prisma.processedWebhook.create({
      data: {
        stripeEventId,
        tenantId,
        status: `processed:${eventType}`,
        processedAt: new Date(),
      },
    });
    return true;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return false; // unique violation: already processed
    }
    throw err;
  }
}
