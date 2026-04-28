import { prisma } from "../lib/prisma.js";
import { handleQboWebhook } from "./qbo-sync.js";

// --------------------------------------------------------------------------
// QBO webhook delivery persistence + replay.
//
// The webhook receiver in apps/api/src/routes/webhooks-qbo.ts responds 200
// to Intuit immediately and processes entities in a background dispatcher.
// Without persistence, any error in that dispatcher is silently dropped —
// Intuit will not retry once we've ack'd. These helpers save each accepted
// delivery so failures can be reviewed and replayed by an operator.
// --------------------------------------------------------------------------

/** Resolve the realmId on the payload to a tenant/location, if possible. */
async function resolveRealm(payload: any): Promise<{ tenantId: string | null; locationId: string | null; realmId: string }> {
  const realmId: string =
    payload?.eventNotifications?.[0]?.realmId ?? "";

  if (!realmId) {
    return { tenantId: null, locationId: null, realmId: "" };
  }

  // Per-Location QBO connections are primary — check Location first and
  // fall back to legacy tenant-level connections.
  const location = await prisma.location.findFirst({
    where: { qboRealmId: realmId } as any,
    select: { id: true, tenantId: true },
  });

  if (location) {
    return {
      tenantId: location.tenantId,
      locationId: location.id,
      realmId,
    };
  }

  const tenant = await prisma.tenant.findFirst({
    where: { qboRealmId: realmId } as any,
    select: { id: true },
  });

  return {
    tenantId: tenant?.id ?? null,
    locationId: null,
    realmId,
  };
}

/**
 * Persist an accepted Intuit webhook delivery in PENDING state. Returns the
 * row id so the caller can update status when the background dispatcher
 * completes.
 */
export async function recordIncomingDelivery(
  payload: unknown,
  signature: string,
): Promise<string> {
  const { tenantId, locationId, realmId } = await resolveRealm(payload);

  const row = await (prisma as any).qboWebhookDelivery.create({
    data: {
      realmId,
      tenantId,
      locationId,
      signature,
      payloadJson: payload as any,
      status: "PENDING",
      attempts: 0,
    },
  });

  return row.id as string;
}

/**
 * Run the dispatcher for a saved delivery and update its status. Used both
 * by the live webhook receiver (immediately after persisting) and by the
 * admin replay endpoint.
 */
export async function processDelivery(deliveryId: string): Promise<{ status: "PROCESSED" | "FAILED"; error?: string }> {
  const row = await (prisma as any).qboWebhookDelivery.findUnique({
    where: { id: deliveryId },
  });
  if (!row) {
    throw new Error(`QBO webhook delivery ${deliveryId} not found`);
  }

  // Mark in-flight and bump the attempt counter so concurrent replays don't
  // double-process and operators can see how many tries a delivery has had.
  await (prisma as any).qboWebhookDelivery.update({
    where: { id: deliveryId },
    data: {
      status: "PENDING",
      attempts: { increment: 1 },
      lastError: null,
    },
  });

  try {
    await handleQboWebhook(row.payloadJson);
    await (prisma as any).qboWebhookDelivery.update({
      where: { id: deliveryId },
      data: {
        status: "PROCESSED",
        processedAt: new Date(),
        lastError: null,
      },
    });
    return { status: "PROCESSED" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await (prisma as any).qboWebhookDelivery.update({
      where: { id: deliveryId },
      data: {
        status: "FAILED",
        processedAt: new Date(),
        lastError: message.slice(0, 4000),
      },
    });
    return { status: "FAILED", error: message };
  }
}

/** List recent webhook deliveries for a tenant, optionally filtered by status. */
export async function listDeliveries(
  tenantId: string,
  opts: { status?: string; limit?: number } = {},
): Promise<unknown[]> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  return (prisma as any).qboWebhookDelivery.findMany({
    where: {
      tenantId,
      ...(opts.status ? { status: opts.status } : {}),
    },
    orderBy: { receivedAt: "desc" },
    take: limit,
  });
}

/** Replay a saved delivery. Caller must enforce tenant ownership. */
export async function replayDelivery(
  deliveryId: string,
  tenantId: string,
): Promise<{ status: "PROCESSED" | "FAILED"; error?: string }> {
  const row = await (prisma as any).qboWebhookDelivery.findUnique({
    where: { id: deliveryId },
    select: { id: true, tenantId: true },
  });
  if (!row || row.tenantId !== tenantId) {
    throw new Error(`QBO webhook delivery ${deliveryId} not found for tenant`);
  }
  return processDelivery(deliveryId);
}
