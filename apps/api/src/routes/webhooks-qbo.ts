import { Router, type Request, type Response, type NextFunction } from "express";
import crypto from "node:crypto";
import { handleQboWebhook } from "../services/qbo-sync.js";

// --------------------------------------------------------------------------
// Intuit QuickBooks Online webhook receiver.
//
// Mounted at /api/qbo/webhook from index.ts BEFORE the authenticated
// /api/qbo router, and listed in the tenant-middleware bypass set, so
// Intuit can deliver events without a Clerk session or a tenant subdomain.
// Authentication is provided by the Intuit-Signature HMAC-SHA256 header,
// verified below against QBO_WEBHOOK_VERIFIER_TOKEN.
//
// Per Intuit's docs we must respond 200 within a few seconds or they will
// retry the delivery (and eventually suspend the subscription on repeated
// timeouts). Entity processing fans out to QBO API calls and DB writes for
// every changed entity, which can easily exceed that budget. Following the
// same pattern as the Stripe webhook handler, we respond 200 as soon as the
// signature is verified and run the dispatcher in the background.
// --------------------------------------------------------------------------

const router: Router = Router();

router.post(
  "/",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const signature = req.headers["intuit-signature"];
      if (!signature || typeof signature !== "string") {
        res.status(401).json({ error: "Missing webhook signature" });
        return;
      }

      const payload = req.body;

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
        .update(JSON.stringify(payload))
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

      // Acknowledge the delivery immediately, then process in the background.
      // Intuit retries on slow/non-2xx responses; we must not block the
      // response on the per-entity QBO API calls inside handleQboWebhook.
      // The handler resolves tenant/location from the payload's realmId —
      // no tenant context is required from the request.
      res.status(200).json({ success: true });

      void processWebhookInBackground(payload);
    } catch (err) {
      next(err);
    }
  },
);

async function processWebhookInBackground(payload: unknown): Promise<void> {
  try {
    await handleQboWebhook(payload);
  } catch (err) {
    // Already responded 200 to Intuit; log so operators can investigate.
    console.error("[qbo-webhook] background processing failed:", err);
  }
}

export default router;
