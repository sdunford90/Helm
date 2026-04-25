import crypto from "node:crypto";
import { prisma } from "./prisma.js";

// ---------------------------------------------------------------------------
// Email suppression list helpers
//
// `suppressEmail` is upsert-shaped so repeated bounce events for the same
// address are idempotent. `isSuppressed` is the gate every outbound send
// consults in sendEmail.
// ---------------------------------------------------------------------------

export type SuppressionReason = "BOUNCED_HARD" | "COMPLAINED" | "UNSUBSCRIBED";
export type SuppressionSource =
  | "resend_bounce"
  | "resend_complaint"
  | "user_unsubscribe";

export async function suppressEmail(params: {
  tenantId: string;
  email: string;
  reason: SuppressionReason;
  source: SuppressionSource;
}): Promise<void> {
  const email = params.email.toLowerCase().trim();
  if (!email) return;
  await prisma.emailSuppression.upsert({
    where: { tenantId_email: { tenantId: params.tenantId, email } },
    create: {
      tenantId: params.tenantId,
      email,
      reason: params.reason,
      source: params.source,
    },
    // Don't overwrite an UNSUBSCRIBE with a later BOUNCE — keep the strongest
    // signal so audit is clear. upsert with empty update does this.
    update: {},
  });
}

export async function isSuppressed(
  tenantId: string | undefined | null,
  email: string,
): Promise<boolean> {
  if (!tenantId) return false;
  const row = await prisma.emailSuppression.findUnique({
    where: {
      tenantId_email: { tenantId, email: email.toLowerCase().trim() },
    },
  });
  return !!row;
}

// ---------------------------------------------------------------------------
// Unsubscribe token (HMAC-signed)
//
// The List-Unsubscribe header embeds a URL with a token that identifies
// the tenant + address. Signed so attackers can't unsubscribe arbitrary
// addresses.
// ---------------------------------------------------------------------------

const STATE_VERSION = "u1";
const DEFAULT_TTL_SECONDS = 90 * 24 * 3600; // 90 days

function getSecret(): Buffer {
  const secret = process.env.APP_SECRET ?? process.env.CLERK_SECRET_KEY;
  if (!secret) {
    throw new Error(
      "APP_SECRET (or CLERK_SECRET_KEY fallback) must be set to sign unsubscribe tokens.",
    );
  }
  return Buffer.from(secret);
}

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}
function b64urlDecode(s: string): Buffer {
  return Buffer.from(s, "base64url");
}

export function issueUnsubscribeToken(
  tenantId: string,
  email: string,
  ttlSeconds = DEFAULT_TTL_SECONDS,
): string {
  const payload = {
    v: STATE_VERSION,
    t: tenantId,
    e: email.toLowerCase().trim(),
    x: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const body = b64url(Buffer.from(JSON.stringify(payload)));
  const sig = b64url(
    crypto.createHmac("sha256", getSecret()).update(body).digest(),
  );
  return `${body}.${sig}`;
}

export interface VerifiedUnsubscribe {
  tenantId: string;
  email: string;
  expiresAt: Date;
}

export function verifyUnsubscribeToken(token: string): VerifiedUnsubscribe {
  const [body, sig] = token.split(".");
  if (!body || !sig) throw new Error("Invalid token");
  const expected = b64url(
    crypto.createHmac("sha256", getSecret()).update(body).digest(),
  );
  const a = b64urlDecode(sig);
  const b = b64urlDecode(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new Error("Invalid token signature");
  }
  let payload: { v: string; t: string; e: string; x: number };
  try {
    payload = JSON.parse(b64urlDecode(body).toString("utf8"));
  } catch {
    throw new Error("Invalid token payload");
  }
  if (payload.v !== STATE_VERSION) throw new Error("Unsupported token version");
  if (typeof payload.x !== "number" || payload.x * 1000 < Date.now()) {
    throw new Error("Token expired");
  }
  return {
    tenantId: payload.t,
    email: payload.e,
    expiresAt: new Date(payload.x * 1000),
  };
}
