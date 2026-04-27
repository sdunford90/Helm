import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { clerkAuth, requireRole } from "../middleware/auth.js";
import {
  getAuthorizationUrl,
  handleCallback,
  syncAll,
  syncCustomer,
  syncInvoice,
  getStatus,
  disconnect,
  handleQboWebhook,
} from "../services/qbo-sync.js";
import crypto from "node:crypto";
import { issueOAuthState, verifyOAuthState } from "../lib/oauth-state.js";

const router: Router = Router();

// All QBO routes require admin or manager role
router.use(...clerkAuth());
router.use(requireRole("MARINA_OWNER", "TENANT_ADMIN", "MARINA_MANAGER"));

// --------------------------------------------------------------------------
// GET /authorize — Start QBO OAuth flow
// --------------------------------------------------------------------------

router.get(
  "/authorize",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      // HMAC-signed state — stateless CSRF protection, verified on callback.
      const state = issueOAuthState(tenantId);
      const authUrl = await getAuthorizationUrl(tenantId, state);
      res.json({ url: authUrl });
    } catch (err) {
      next(err);
    }
  },
);

// --------------------------------------------------------------------------
// GET /callback — Handle QBO OAuth callback
// --------------------------------------------------------------------------

router.get(
  "/callback",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const CallbackSchema = z.object({
        code: z.string(),
        realmId: z.string(),
        state: z.string(),
      });

      const { code, realmId, state } = CallbackSchema.parse(req.query);

      // Verify the HMAC-signed state. Rejects expired, tampered, or forged
      // tokens. The tenantId comes FROM the verified state, not from the
      // query string — an attacker must not be able to choose which tenant
      // the callback binds to.
      let tenantId: string;
      try {
        tenantId = verifyOAuthState(state).tenantId;
      } catch (err) {
        res.status(400).json({
          error: err instanceof Error ? err.message : "Invalid state",
        });
        return;
      }

      await handleCallback(code, realmId, tenantId);

      res.json({
        success: true,
        message: "QuickBooks Online connected successfully. Initial sync started.",
      });
    } catch (err) {
      next(err);
    }
  },
);

// --------------------------------------------------------------------------
// POST /sync — Trigger full sync
// --------------------------------------------------------------------------

router.post(
  "/sync",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const result = await syncAll(tenantId);

      res.json({
        success: true,
        synced: result.synced,
        failed: result.failed,
      });
    } catch (err) {
      next(err);
    }
  },
);

// --------------------------------------------------------------------------
// POST /sync/customer/:id — Sync single customer
// --------------------------------------------------------------------------

router.post(
  "/sync/customer/:id",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const customerId = req.params.id;

      await syncCustomer(customerId, tenantId);

      res.json({ success: true, message: `Customer ${customerId} synced to QBO` });
    } catch (err) {
      next(err);
    }
  },
);

// --------------------------------------------------------------------------
// POST /sync/invoice/:id — Sync single invoice
// --------------------------------------------------------------------------

router.post(
  "/sync/invoice/:id",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const invoiceId = req.params.id;

      await syncInvoice(invoiceId, tenantId);

      res.json({ success: true, message: `Invoice ${invoiceId} synced to QBO` });
    } catch (err) {
      next(err);
    }
  },
);

// --------------------------------------------------------------------------
// GET /status — Get QBO connection and sync status
// --------------------------------------------------------------------------

router.get(
  "/status",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const status = await getStatus(tenantId);

      res.json(status);
    } catch (err) {
      next(err);
    }
  },
);

// --------------------------------------------------------------------------
// POST /disconnect — Disconnect QBO
// --------------------------------------------------------------------------

router.post(
  "/disconnect",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      await disconnect(tenantId);

      res.json({ success: true, message: "QuickBooks Online disconnected" });
    } catch (err) {
      next(err);
    }
  },
);

// --------------------------------------------------------------------------
// POST /webhook — Handle QBO webhook notifications (no auth — verified by signature)
// --------------------------------------------------------------------------

router.post(
  "/webhook",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const payload = req.body;

      // QBO webhooks include a verifier token in the header
      const signature = req.headers["intuit-signature"] as string;
      if (!signature) {
        res.status(401).json({ error: "Missing webhook signature" });
        return;
      }

      // Verify webhook signature using HMAC-SHA256
      const webhookVerifierToken = process.env.QBO_WEBHOOK_VERIFIER_TOKEN;
      if (webhookVerifierToken) {
        const hash = crypto
          .createHmac("sha256", webhookVerifierToken)
          .update(JSON.stringify(payload))
          .digest("base64");

        if (hash !== signature) {
          res.status(401).json({ error: "Invalid webhook signature" });
          return;
        }
      }

      await handleQboWebhook(payload, req.tenantId!);

      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
