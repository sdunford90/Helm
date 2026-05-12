// A8 — Tenant outbound webhooks service.
//
// `dispatchWebhook` is the public API for the rest of the codebase to call
// when an internal event happens (invoice paid, contract signed, etc.). It
// fans out to every enabled WebhookDestination that has subscribed to the
// event and writes a WebhookDelivery row per attempt.
//
// MVP delivery: best-effort fire on the request thread, capture the
// response in the delivery row, increment consecutiveFailures on non-2xx.
// A retry queue is queued behind nextRetryAt — wiring the BullMQ job that
// drains it is a follow-up.

import { createHmac, randomBytes } from "node:crypto";
import { prisma } from "../lib/prisma.js";

export const STANDARD_EVENTS = [
  "invoice.issued",
  "invoice.paid",
  "invoice.voided",
  "payment.refunded",
  "contract.signed",
  "contract.expired",
  "contract.terminated",
  "customer.created",
  "dock-walk.completed",
] as const;

export type StandardEvent = (typeof STANDARD_EVENTS)[number];

const MAX_RESPONSE_SNIPPET = 1024;
const AUTO_DISABLE_FAILURES = 25;

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

/** Generate a 64-char hex secret for a new destination. */
export function generateSigningSecret(): string {
  return randomBytes(32).toString("hex");
}

/**
 * Fan-out an event to every subscribed destination for the tenant. Each
 * destination's call is independent — one failure doesn't block the rest.
 *
 * Best-effort: caller should not await this in the request path if latency
 * matters. For now we do await so the audit row exists before the response
 * returns; swap to fire-and-forget when the retry queue lands.
 */
export async function dispatchWebhook(args: {
  tenantId: string;
  event: string;
  payload: unknown;
}): Promise<void> {
  const destinations = await prisma.webhookDestination.findMany({
    where: { tenantId: args.tenantId, enabled: true },
  });
  const subscribed = destinations.filter((d) =>
    Array.isArray(d.events) && d.events.includes(args.event),
  );
  if (subscribed.length === 0) return;

  const body = JSON.stringify({
    event: args.event,
    tenantId: args.tenantId,
    sentAt: new Date().toISOString(),
    data: args.payload,
  });

  await Promise.allSettled(
    subscribed.map(async (dest) => {
      const signature = sign(body, dest.signingSecret);
      let httpStatus: number | null = null;
      let responseSnippet: string | null = null;
      let success = false;

      try {
        const res = await fetch(dest.url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Helm-Event": args.event,
            "X-Helm-Signature": signature,
            "X-Helm-Tenant": args.tenantId,
          },
          body,
          // Hard 10s per-call timeout; tenants who time out get retried.
          signal: AbortSignal.timeout(10_000),
        });
        httpStatus = res.status;
        success = res.ok;
        try {
          const text = await res.text();
          responseSnippet = text.slice(0, MAX_RESPONSE_SNIPPET);
        } catch { /* response read errors are non-fatal */ }
      } catch (err) {
        responseSnippet = (err instanceof Error ? err.message : String(err)).slice(0, MAX_RESPONSE_SNIPPET);
      }

      // Persist delivery row.
      await prisma.webhookDelivery.create({
        data: {
          destinationId: dest.id,
          event: args.event,
          payloadJson: args.payload as object,
          status: success ? "SUCCESS" : "FAILED",
          httpStatus,
          responseSnippet,
          attempts: 1,
          deliveredAt: success ? new Date() : null,
          nextRetryAt: success ? null : new Date(Date.now() + 60_000),
        },
      });

      // Update destination's health counters.
      if (success) {
        await prisma.webhookDestination.update({
          where: { id: dest.id },
          data: { lastSuccessAt: new Date(), consecutiveFailures: 0 },
        });
      } else {
        const nextFailureCount = dest.consecutiveFailures + 1;
        await prisma.webhookDestination.update({
          where: { id: dest.id },
          data: {
            lastFailureAt: new Date(),
            consecutiveFailures: nextFailureCount,
            // Auto-disable after AUTO_DISABLE_FAILURES consecutive failures.
            ...(nextFailureCount >= AUTO_DISABLE_FAILURES
              ? { enabled: false, disabledAt: new Date() }
              : {}),
          },
        });
      }
    }),
  );
}
