import crypto from "node:crypto";

/**
 * OAuth state token helper — CSRF-safe, stateless, signed.
 *
 * We used to pass the raw tenantId as the OAuth state parameter, which is
 * predictable: anyone who learns a tenant's UUID could forge a callback and
 * bind an attacker-controlled provider account to that tenant. This module
 * issues and verifies HMAC-signed tokens that embed:
 *   - tenantId (so the callback knows which tenant the flow belongs to)
 *   - a random nonce (unguessable — this is the anti-CSRF bit)
 *   - an expiry timestamp (limits replay window)
 *
 * The signature is verified on callback with constant-time compare. No
 * server-side cache needed; works across multiple API instances.
 */

const STATE_VERSION = "v1";
const DEFAULT_TTL_SECONDS = 15 * 60; // 15 minutes

function getSecret(): Buffer {
  const secret = process.env.APP_SECRET ?? process.env.CLERK_SECRET_KEY;
  if (!secret) {
    throw new Error(
      "APP_SECRET (or CLERK_SECRET_KEY as fallback) must be set to sign OAuth state tokens.",
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

export interface IssueOAuthStateOptions {
  locationId?: string;
  ttlSeconds?: number;
}

export function issueOAuthState(tenantId: string, optionsOrTtl: IssueOAuthStateOptions | number = {}): string {
  const opts: IssueOAuthStateOptions = typeof optionsOrTtl === "number"
    ? { ttlSeconds: optionsOrTtl }
    : optionsOrTtl;
  const ttlSeconds = opts.ttlSeconds ?? DEFAULT_TTL_SECONDS;

  const payload: Record<string, unknown> = {
    v: STATE_VERSION,
    t: tenantId,
    n: crypto.randomBytes(16).toString("hex"),
    e: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  if (opts.locationId) {
    payload.l = opts.locationId;
  }
  const body = b64url(Buffer.from(JSON.stringify(payload)));
  const sig = b64url(
    crypto.createHmac("sha256", getSecret()).update(body).digest(),
  );
  return `${body}.${sig}`;
}

export interface VerifiedOAuthState {
  tenantId: string;
  locationId?: string;
  nonce: string;
  expiresAt: Date;
}

export function verifyOAuthState(token: string): VerifiedOAuthState {
  const parts = token.split(".");
  if (parts.length !== 2) {
    throw new Error("Invalid state token format");
  }
  const [body, sig] = parts;

  const expectedSig = b64url(
    crypto.createHmac("sha256", getSecret()).update(body).digest(),
  );
  const a = b64urlDecode(sig);
  const b = b64urlDecode(expectedSig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new Error("Invalid state signature");
  }

  let payload: { v: string; t: string; n: string; e: number; l?: string };
  try {
    payload = JSON.parse(b64urlDecode(body).toString("utf8"));
  } catch {
    throw new Error("Invalid state payload");
  }

  if (payload.v !== STATE_VERSION) {
    throw new Error(`Unsupported state version: ${payload.v}`);
  }
  if (typeof payload.t !== "string" || !payload.t) {
    throw new Error("State missing tenantId");
  }
  if (typeof payload.e !== "number" || payload.e * 1000 < Date.now()) {
    throw new Error("State token expired");
  }

  return {
    tenantId: payload.t,
    ...(payload.l ? { locationId: payload.l } : {}),
    nonce: payload.n,
    expiresAt: new Date(payload.e * 1000),
  };
}
