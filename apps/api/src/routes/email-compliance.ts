import { Router, type Request, type Response, type NextFunction } from "express";
import express from "express";
import crypto from "node:crypto";
import { prisma } from "../lib/prisma.js";
import {
  suppressEmail,
  verifyUnsubscribeToken,
} from "../lib/email-suppression.js";

const router: Router = Router();

// ---------------------------------------------------------------------------
// GET/POST /api/email/unsubscribe?token=...
//
// One-click unsubscribe per RFC 8058 — Resend (and every modern mail client)
// sends POST with no body when the user clicks the header link. Support GET
// as well for manual links in email bodies. Either way, we verify the token,
// write the suppression row, and render a minimal confirmation page (GET)
// or return 200 JSON (POST).
// ---------------------------------------------------------------------------

async function handleUnsubscribe(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const token = (req.query.token ?? req.body?.token) as string | undefined;
    if (!token) {
      res.status(400).json({ error: "Missing token", code: "MISSING_TOKEN" });
      return;
    }
    let verified: { tenantId: string; email: string };
    try {
      verified = verifyUnsubscribeToken(token);
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : "Invalid token",
        code: "INVALID_TOKEN",
      });
      return;
    }

    await suppressEmail({
      tenantId: verified.tenantId,
      email: verified.email,
      reason: "UNSUBSCRIBED",
      source: "user_unsubscribe",
    });

    // For the RFC 8058 POST flow, return 200 JSON. For direct GET clicks
    // from an email body, render a tiny HTML confirmation.
    if (req.method === "POST") {
      res.json({ ok: true });
      return;
    }
    res
      .status(200)
      .type("html")
      .send(
        `<!doctype html><meta charset="utf-8"><title>Unsubscribed</title>
         <div style="font-family:system-ui;max-width:420px;margin:80px auto;padding:24px;
                     border:1px solid #e2e8f0;border-radius:8px;text-align:center;">
           <h1 style="color:#0A2342;margin:0 0 8px;font-size:22px;">You're unsubscribed</h1>
           <p style="color:#64748B;font-size:14px;">${verified.email} will no longer receive Helm emails from this marina.</p>
         </div>`,
      );
  } catch (err) {
    next(err);
  }
}

router.get("/unsubscribe", handleUnsubscribe);
router.post("/unsubscribe", handleUnsubscribe);

// ---------------------------------------------------------------------------
// POST /api/email/webhooks/resend
//
// Receives delivery events from Resend. Hard bounces and spam complaints
// add the recipient to the suppression list.
//
// Signed with a shared secret per Resend's webhook config. Raw body is
// required for signature verification; mounted with express.raw() below.
// ---------------------------------------------------------------------------

interface ResendEvent {
  type: string; // "email.bounced", "email.complained", etc
  data?: {
    to?: string[] | string;
    email_id?: string;
    bounce?: { type?: "hard" | "soft"; subType?: string };
    tags?: Array<{ name: string; value: string }>;
    [key: string]: unknown;
  };
}

router.post(
  "/webhooks/resend",
  express.raw({ type: "application/json" }),
  async (req: Request, res: Response): Promise<void> => {
    const secret = process.env.RESEND_WEBHOOK_SECRET;
    if (!secret) {
      // Fail-closed: don't accept unauthenticated webhooks even if they
      // come from Resend's real IPs.
      res.status(503).json({ error: "Webhook not configured" });
      return;
    }

    // Resend's webhook uses svix-signature (or older "webhook-signature").
    // We verify HMAC over the raw body.
    const sig = req.header("webhook-signature") ?? req.header("svix-signature");
    const timestamp = req.header("webhook-timestamp") ?? req.header("svix-timestamp");
    const messageId = req.header("webhook-id") ?? req.header("svix-id");
    if (!sig || !timestamp || !messageId) {
      res.status(401).json({ error: "Missing webhook signature" });
      return;
    }

    const raw = (req.body as Buffer).toString("utf8");
    const signedPayload = `${messageId}.${timestamp}.${raw}`;
    const expected = crypto
      .createHmac("sha256", Buffer.from(secret.replace(/^whsec_/, ""), "base64"))
      .update(signedPayload)
      .digest("base64");
    // svix-signature format: "v1,<base64> v1,<base64> ..."
    const candidates = sig.split(" ").map((s) => s.split(",")[1] ?? s);
    const ok = candidates.some(
      (c) =>
        c.length === expected.length &&
        crypto.timingSafeEqual(Buffer.from(c), Buffer.from(expected)),
    );
    if (!ok) {
      res.status(401).json({ error: "Invalid signature" });
      return;
    }

    // 200 early; do the work after.
    res.status(200).json({ received: true });

    let event: ResendEvent;
    try {
      event = JSON.parse(raw) as ResendEvent;
    } catch {
      console.error("[resend-webhook] invalid JSON body");
      return;
    }

    // Resend's event recipient is data.to (array or string). We need the
    // tenantId from somewhere — the cleanest place is our tags, which
    // sendEmail does NOT set uniformly today. As a fallback, suppress for
    // every tenant that has a Customer record with that email.
    const toList = Array.isArray(event.data?.to)
      ? event.data!.to!
      : event.data?.to
        ? [event.data.to as string]
        : [];
    const tenantTag = event.data?.tags?.find((t) => t.name === "tenantId")?.value;

    const suppressFor = (
      reason: "BOUNCED_HARD" | "COMPLAINED",
      source: "resend_bounce" | "resend_complaint",
    ) =>
      Promise.all(
        toList.map(async (addr) => {
          try {
            if (tenantTag) {
              await suppressEmail({ tenantId: tenantTag, email: addr, reason, source });
              return;
            }
            // No tenant tag — suppress for every tenant that has this email
            // on file. Over-suppresses but fails safe: we'd rather skip
            // sending than keep bouncing.
            const customers = await prisma.customer.findMany({
              where: { email: { equals: addr, mode: "insensitive" } },
              select: { tenantId: true },
            });
            for (const c of customers) {
              await suppressEmail({ tenantId: c.tenantId, email: addr, reason, source });
            }
          } catch (err) {
            console.error("[resend-webhook] suppression error:", err);
          }
        }),
      );

    if (event.type === "email.bounced") {
      if (event.data?.bounce?.type === "hard") {
        await suppressFor("BOUNCED_HARD", "resend_bounce");
      }
    } else if (event.type === "email.complained") {
      await suppressFor("COMPLAINED", "resend_complaint");
    }
  },
);

export default router;
