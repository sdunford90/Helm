import express, { Router, type Request, type Response, type NextFunction } from "express";
import crypto from "node:crypto";
import {
  recordIncomingDelivery,
  processDelivery,
} from "../services/qbo-webhook-deliveries.js";

// --------------------------------------------------------------------------
// Intuit QuickBooks Online webhook receiver.
//
// Mounted at /api/qbo/webhook from index.ts BEFORE the global express.json()
// middleware (and before the authenticated /api/qbo router), and listed in
// the tenant-middleware bypass set, so Intuit can deliver events without a
// Clerk session or a tenant subdomain.
//
// Authentication is provided by the Intuit-Signature HMAC-SHA256 header,
// verified below against QBO_WEBHOOK_VERIFIER_TOKEN. Intuit signs the *raw*
// bytes it sends, so we use express.raw() to capture the body byte-for-byte
// and HMAC against that buffer — re-serialising via JSON.stringify would
// produce different bytes (key order, whitespace, number formatting) and
// reject legitimate deliveries.
//
// Per Intuit's docs we must respond 200 within a few seconds or they will
// retry the delivery (and eventually suspend the subscription on repeated
// timeouts). Entity processing fans out to QBO API calls and DB writes for
// every changed entity, which can easily exceed that budget. Following the
// same pattern as the Stripe webhook handler, we respond 200 as soon as the
// signature is verified and the payload is parsed, then run the dispatcher
// in the background.
//
// Because we ack immediately, Intuit will NOT retry on dispatcher errors.
// Every accepted delivery is persisted to qbo_webhook_deliveries with its
// raw payload + signature so operators can review FAILED rows and replay
// them via the admin endpoints on /api/qbo/webhook-deliveries.
// --------------------------------------------------------------------------

const router: Router = Router();

router.post(
  "/",
  express.raw({ type: "application/json" }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const signature = req.headers["intuit-signature"];
      if (!signature || typeof signature !== "string") {
        res.status(401).json({ error: "Missing webhook signature" });
        return;
      }

      // express.raw populates req.body as a Buffer when the Content-Type
      // matches; otherwise it leaves req.body as {}. Fall back to an empty
      // buffer so length checks below behave predictably.
      const rawBody: Buffer = Buffer.isBuffer(req.body)
        ? req.body
        : Buffer.alloc(0);

      // Verify webhook signature using HMAC-SHA256. When the verifier token
      // is not configured we refuse the request rather than silently letting
      // unsigned traffic through — production must be explicitly configured.
      const webhookVerifierToken = process.env.QBO_WEBHOOK_VERIFIER_TOKEN;
      if (!webhookVerifierToken) {
        console.error(
          "[qbo-webhook] QBO_WEBHOOK_VERIFIER_TOKEN is not configured; rejecting delivery",
        );
        res.status(500).json({ error: "Webhook verifier not configured" });
        return;
      }

      const expected = crypto
        .createHmac("sha256", webhookVerifierToken)
        .update(rawBody)
        .digest("base64");

      const sigBuf = Buffer.from(signature);
      const expBuf = Buffer.from(expected);
      const valid =
        sigBuf.length === expBuf.length &&
        crypto.timingSafeEqual(sigBuf, expBuf);

      if (!valid) {
        res.status(401).json({ error: "Invalid webhook signature" });
        return;
      }

      // Only parse JSON after the signature has been verified — a malformed
      // body from an unsigned/forged request must never reach the parser.
      let payload: unknown;
      try {
        payload = rawBody.length > 0 ? JSON.parse(rawBody.toString("utf8")) : {};
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        res
          .status(400)
          .json({ error: `Invalid JSON payload: ${message}` });
        return;
      }

      // Persist the delivery before responding so a crash between the ack
      // and the background dispatcher doesn't lose the event entirely.
      // recordIncomingDelivery resolves the realmId to a tenant/location
      // when it can — unrouted deliveries are still saved for inspection.
      let deliveryId: string | null = null;
      try {
        deliveryId = await recordIncomingDelivery(payload, signature);
      } catch (err) {
        // Don't 500 to Intuit when the log write fails — that would only
        // trigger a retry that the dispatcher already handles in-process.
        console.error("[qbo-webhook] failed to persist delivery:", err);
      }

      // Acknowledge the delivery immediately, then process in the background.
      // Intuit retries on slow/non-2xx responses; we must not block the
      // response on the per-entity QBO API calls inside handleQboWebhook.
      res.status(200).json({ success: true });

      if (deliveryId) {
        void processDeliveryInBackground(deliveryId);
      }
    } catch (err) {
      next(err);
    }
  },
);

async function processDeliveryInBackground(deliveryId: string): Promise<void> {
  try {
    const result = await processDelivery(deliveryId);
    if (result.status === "FAILED") {
      console.error(
        `[qbo-webhook] delivery ${deliveryId} marked FAILED: ${result.error}`,
      );
    }
  } catch (err) {
    // processDelivery already records FAILED status in the dispatcher's
    // catch path; this top-level catch only fires if the row update itself
    // throws (e.g. brief DB outage). Already responded 200 to Intuit.
    console.error(
      `[qbo-webhook] background dispatch crashed for ${deliveryId}:`,
      err,
    );
  }
}

export default router;
