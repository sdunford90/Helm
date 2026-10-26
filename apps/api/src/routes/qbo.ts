import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import crypto from "node:crypto";
import { clerkAuth, requireRole, FINANCE_ROLES } from "../middleware/auth.js";
import { tenantStore } from "../lib/prisma.js";
import { consumeOAuthState, createOAuthState, isActiveTenantOwner } from "../lib/oauth-state.js";
import {
  handleCallback,
  syncAll,
  syncCustomer,
  syncInvoice,
  getStatus,
  disconnect,
  handleQboWebhook,
} from "../services/qbo-sync.js";

// --------------------------------------------------------------------------
// QuickBooks Online — the ONLY QBO connect flow (the duplicates in
// onboarding.ts, settings.ts and tenants.ts were removed).
//
//   GET  /api/qbo/authorize  staff, MARINA_OWNER  → Intuit consent URL
//   GET  /api/qbo/callback   PUBLIC (Intuit redirect) — verified by state
//   POST /api/qbo/webhook    PUBLIC (Intuit)          — verified by signature
//   everything else          staff, owner/manager/accounting
//
// /callback and /webhook bypass tenant resolution (middleware/tenant.ts):
// Intuit calls one fixed URL, so the tenant comes from the verified
// server-side state (callback) or the payload's realmId (webhook).
// --------------------------------------------------------------------------

const router = Router();

const QBO_AUTH_BASE = "https://appcenter.intuit.com/connect/oauth2";
const QBO_SCOPE = "com.intuit.quickbooks.accounting";

function finish(res: Response, outcome: "connected" | "error", status = 200, code?: string): void {
  const appUrl = process.env.APP_URL;
  if (appUrl) {
    const url = new URL("/settings", appUrl);
    url.searchParams.set("section", "qbo");
    url.searchParams.set("qbo", outcome);
    if (code) url.searchParams.set("code", code);
    res.redirect(302, url.toString());
    return;
  }
  res.status(status).json(
    outcome === "connected"
      ? { success: true, message: "QuickBooks Online connected. Initial sync started." }
      : { error: "QuickBooks connection failed", code },
  );
}

// --------------------------------------------------------------------------
// GET /callback — Intuit OAuth redirect (no user auth; state-verified)
// --------------------------------------------------------------------------

const CallbackSchema = z.object({
  code: z.string().min(1).optional(),
  realmId: z.string().min(1).optional(),
  state: z.string().optional(),
  error: z.string().optional(),
});

router.get(
  "/callback",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = CallbackSchema.safeParse(req.query);
      const query = parsed.success ? parsed.data : {};

      // Always consume the state first so it can never be replayed.
      const binding = await consumeOAuthState("qbo", query.state);
      if (!binding) {
        finish(res, "error", 400, "INVALID_STATE");
        return;
      }

      if (query.error || !query.code || !query.realmId) {
        finish(res, "error", 400, query.error ? "ACCESS_DENIED" : "MISSING_CODE");
        return;
      }

      if (!(await isActiveTenantOwner(binding))) {
        finish(res, "error", 403, "NOT_OWNER");
        return;
      }

      const { code, realmId } = query;
      await tenantStore.run({ tenantId: binding.tenantId }, () =>
        handleCallback(code, realmId, binding.tenantId),
      );

      finish(res, "connected");
    } catch (err) {
      next(err);
    }
  },
);

// --------------------------------------------------------------------------
// POST /webhook — Intuit notifications (no user auth; signature-verified)
//
// index.ts mounts express.raw() for this path so req.body is the exact raw
// bytes Intuit signed. The verifier token is mandatory: without it every
// request is refused.
// --------------------------------------------------------------------------

export function verifyIntuitSignature(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  verifierToken: string | undefined,
): boolean {
  if (!verifierToken || !signatureHeader) return false;
  const expected = crypto.createHmac("sha256", verifierToken).update(rawBody).digest();
  let provided: Buffer;
  try {
    provided = Buffer.from(signatureHeader, "base64");
  } catch {
    return false;
  }
  if (provided.length !== expected.length) return false;
  return crypto.timingSafeEqual(provided, expected);
}

router.post(
  "/webhook",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const verifierToken = process.env.QBO_WEBHOOK_VERIFIER_TOKEN;
      if (!verifierToken) {
        console.error("[qbo/webhook] QBO_WEBHOOK_VERIFIER_TOKEN is not set; refusing webhook");
        res.status(503).json({ error: "Webhook verification is not configured" });
        return;
      }

      if (!Buffer.isBuffer(req.body)) {
        // Raw body parser not mounted → we cannot verify what Intuit signed.
        res.status(400).json({ error: "Raw body required" });
        return;
      }

      const signature = req.headers["intuit-signature"];
      if (
        !verifyIntuitSignature(
          req.body,
          typeof signature === "string" ? signature : undefined,
          verifierToken,
        )
      ) {
        res.status(401).json({ error: "Invalid webhook signature" });
        return;
      }

      let payload: unknown;
      try {
        payload = JSON.parse(req.body.toString("utf8"));
      } catch {
        res.status(400).json({ error: "Invalid JSON" });
        return;
      }

      // Tenant is resolved inside from each notification's realmId.
      await handleQboWebhook(payload, "");

      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  },
);

// --------------------------------------------------------------------------
// Staff routes
// --------------------------------------------------------------------------

router.use(...clerkAuth());
router.use(requireRole(...FINANCE_ROLES));

// GET /authorize — Start QBO OAuth flow (owner only)
router.get(
  "/authorize",
  requireRole("MARINA_OWNER"),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const clientId = process.env.QBO_CLIENT_ID;
      const redirectUri = process.env.QBO_REDIRECT_URI;
      if (!clientId || !redirectUri) {
        res.status(503).json({ error: "QuickBooks is not configured", code: "QBO_NOT_CONFIGURED" });
        return;
      }

      const state = await createOAuthState("qbo", {
        tenantId: req.tenantId!,
        userId: req.userId!,
      });

      const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: QBO_SCOPE,
        state,
      });

      res.json({ url: `${QBO_AUTH_BASE}?${params.toString()}` });
    } catch (err) {
      next(err);
    }
  },
);

// POST /sync — Trigger full sync
router.post(
  "/sync",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await syncAll(req.tenantId!);
      res.json({ success: true, synced: result.synced, failed: result.failed });
    } catch (err) {
      next(err);
    }
  },
);

// POST /sync/customer/:id — Sync single customer
router.post(
  "/sync/customer/:id",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const customerId = req.params.id;
      await syncCustomer(customerId, req.tenantId!);
      res.json({ success: true, message: `Customer ${customerId} synced to QBO` });
    } catch (err) {
      next(err);
    }
  },
);

// POST /sync/invoice/:id — Sync single invoice
router.post(
  "/sync/invoice/:id",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const invoiceId = req.params.id;
      await syncInvoice(invoiceId, req.tenantId!);
      res.json({ success: true, message: `Invoice ${invoiceId} synced to QBO` });
    } catch (err) {
      next(err);
    }
  },
);

// GET /status — QBO connection and sync status
router.get(
  "/status",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      res.json(await getStatus(req.tenantId!));
    } catch (err) {
      next(err);
    }
  },
);

// POST /disconnect — Disconnect QBO (owner only)
router.post(
  "/disconnect",
  requireRole("MARINA_OWNER"),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await disconnect(req.tenantId!);
      res.json({ success: true, message: "QuickBooks Online disconnected" });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
