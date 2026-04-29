import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import {
  handleCallback,
  handleCallbackForLocation,
} from "../services/qbo-sync.js";
import { verifyOAuthState } from "../lib/oauth-state.js";

const router: Router = Router();

function frontendUrl(): string {
  return process.env.APP_URL ?? "http://localhost:5000";
}

function failureRedirect(
  res: Response,
  reason: string,
  locationId?: string,
): void {
  const params = new URLSearchParams({
    provider: "qbo",
    success: "false",
    reason,
  });
  if (locationId) params.set("locationId", locationId);
  res.redirect(`${frontendUrl()}/oauth-complete?${params.toString()}`);
}

router.get(
  "/",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    let verifiedLocationId: string | undefined;
    try {
      const CallbackSchema = z.object({
        code: z.string(),
        realmId: z.string(),
        state: z.string(),
      });

      const parsed = CallbackSchema.safeParse(req.query);
      if (!parsed.success) {
        console.error("[qbo-callback] missing/invalid query params", {
          issues: parsed.error.flatten(),
        });
        failureRedirect(res, "missing_params");
        return;
      }
      const { code, realmId, state } = parsed.data;

      let verified: { tenantId: string; locationId?: string };
      try {
        verified = verifyOAuthState(state);
      } catch (err) {
        console.error("[qbo-callback] state verification failed", {
          error: err instanceof Error ? err.message : String(err),
        });
        failureRedirect(res, "invalid_state");
        return;
      }

      const { tenantId, locationId } = verified;
      verifiedLocationId = locationId;

      try {
        if (verifiedLocationId) {
          await handleCallbackForLocation(
            code,
            realmId,
            verifiedLocationId,
            tenantId,
          );
        } else {
          await handleCallback(code, realmId, tenantId);
        }
      } catch (err) {
        console.error("[qbo-callback] token exchange / persist failed", {
          tenantId,
          locationId: verifiedLocationId,
          error: err instanceof Error ? err.message : String(err),
        });
        failureRedirect(res, "token_exchange_failed", verifiedLocationId);
        return;
      }

      const params = new URLSearchParams({
        provider: "qbo",
        success: "true",
      });
      if (verifiedLocationId) params.set("locationId", verifiedLocationId);
      res.redirect(`${frontendUrl()}/oauth-complete?${params.toString()}`);
    } catch (err) {
      console.error("[qbo-callback] unexpected error", err);
      try {
        failureRedirect(res, "unexpected_error", verifiedLocationId);
      } catch {
        next(err);
      }
    }
  },
);

export default router;
