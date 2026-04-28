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

      // The handler resolves tenant/location from the payload's realmId —
      // no tenant context is required from the request.
      await handleQboWebhook(payload);

      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
