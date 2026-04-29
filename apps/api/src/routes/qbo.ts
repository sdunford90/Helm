import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { clerkAuth, requireRole } from "../middleware/auth.js";
import {
  getAuthorizationUrl,
  syncAll,
  syncCustomer,
  syncInvoice,
  getStatus,
  disconnect,
  pullVendorsAndBillsForTenant,
} from "../services/qbo-sync.js";
import {
  listDeliveries,
  replayDelivery,
} from "../services/qbo-webhook-deliveries.js";
import { issueOAuthState } from "../lib/oauth-state.js";

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
// NOTE: The QBO OAuth callback (GET /api/qbo/callback) lives in
// `qbo-callback.ts` and is mounted directly from `index.ts` BEFORE the
// tenant + Clerk middleware. Intuit redirects the popup to that URL via a
// top-level cross-origin navigation, so it cannot reliably carry our
// Clerk session cookie. CSRF protection is provided by the HMAC-signed
// `state` token (see `lib/oauth-state.ts`), which is the only thing
// authorised to bind the resulting realmId to a tenant/location.
// --------------------------------------------------------------------------

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
// GET /webhook-deliveries — List recent QBO webhook deliveries for the
// signed-in tenant. Operators use this (and the replay endpoint below) to
// recover from background dispatcher failures, since Intuit no longer
// retries deliveries we've already ack'd 200.
// --------------------------------------------------------------------------

router.get(
  "/webhook-deliveries",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const QuerySchema = z.object({
        status: z.enum(["PENDING", "PROCESSED", "FAILED"]).optional(),
        limit: z.coerce.number().int().min(1).max(200).optional(),
      });
      const { status, limit } = QuerySchema.parse(req.query);
      const deliveries = await listDeliveries(tenantId, { status, limit });
      res.json({ deliveries });
    } catch (err) {
      next(err);
    }
  },
);

// --------------------------------------------------------------------------
// POST /webhook-deliveries/:id/replay — Re-run the saved dispatcher for a
// single delivery. The dispatcher updates the row to PROCESSED or FAILED.
// Tenant ownership is enforced inside replayDelivery.
// --------------------------------------------------------------------------

router.post(
  "/webhook-deliveries/:id/replay",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const deliveryId = req.params.id;
      const result = await replayDelivery(deliveryId, tenantId);
      res.json({ id: deliveryId, ...result });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("not found")) {
        res.status(404).json({ error: message });
        return;
      }
      next(err);
    }
  },
);

// NOTE: POST /webhook is intentionally NOT defined here. Intuit cannot
// present a Clerk session, so the webhook is mounted at /api/qbo/webhook
// from index.ts via the dedicated webhooks-qbo router (which performs
// HMAC signature verification instead). Defining it on this router would
// re-impose the clerkAuth + requireRole middleware above.

// --------------------------------------------------------------------------
// POST /pull — Pull Vendors and Bills from QBO into Helm
// --------------------------------------------------------------------------
//
// Iterates every QBO connection for this tenant (per-location and tenant-
// level) and asks QBO for everything updated since each endpoint's last
// successful pull. Safe to call repeatedly — uses qboVendorId / qboBillId
// to upsert. Each applied change writes an audit log entry.
// --------------------------------------------------------------------------

router.post(
  "/pull",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const result = await pullVendorsAndBillsForTenant(tenantId);
      res.json({ success: true, ...result });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
