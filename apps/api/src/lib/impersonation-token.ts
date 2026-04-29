import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

export interface ImpersonationPayload {
  jti: string;
  sub: string;
  tenantId: string;
  tenantSubdomain: string;
  tenantName: string;
  email: string;
  role: string;
  impersonatedBy: string;
  adminEmail: string;
  iat: number;
  exp: number;
}

function getSecret(): string {
  const secret = process.env.IMPERSONATION_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error(
      "IMPERSONATION_SECRET is not configured (must be at least 16 chars). " +
        "Refusing to mint or verify impersonation tokens.",
    );
  }
  return secret;
}

function b64urlEncode(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input, "utf8") : input;
  return buf
    .toString("base64")
    .replace(/=+$/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function b64urlDecode(input: string): Buffer {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/") +
    "=".repeat((4 - (input.length % 4)) % 4);
  return Buffer.from(padded, "base64");
}

function sign(payloadEncoded: string, secret: string): string {
  return createHmac("sha256", secret).update(payloadEncoded).digest("hex");
}

export interface MintArgs {
  sub: string;
  email: string;
  role: string;
  tenantId: string;
  tenantSubdomain: string;
  tenantName: string;
  impersonatedBy: string;
  adminEmail: string;
  ttlSeconds?: number;
}

export interface MintedToken {
  token: string;
  tokenId: string;
  expiresAt: Date;
  payload: ImpersonationPayload;
}

export function mintImpersonationToken(args: MintArgs): MintedToken {
  const secret = getSecret();
  const ttl = args.ttlSeconds ?? 3600;
  const now = Math.floor(Date.now() / 1000);
  const payload: ImpersonationPayload = {
    jti: randomUUID(),
    sub: args.sub,
    email: args.email,
    role: args.role,
    tenantId: args.tenantId,
    tenantSubdomain: args.tenantSubdomain,
    tenantName: args.tenantName,
    impersonatedBy: args.impersonatedBy,
    adminEmail: args.adminEmail,
    iat: now,
    exp: now + ttl,
  };
  const encoded = b64urlEncode(JSON.stringify(payload));
  const signature = sign(encoded, secret);
  return {
    token: `imp_${encoded}.${signature}`,
    tokenId: payload.jti,
    expiresAt: new Date(payload.exp * 1000),
    payload,
  };
}

export type VerifyResult =
  | { ok: true; payload: ImpersonationPayload }
  | { ok: false; reason: "malformed" | "bad_signature" | "expired" | "unconfigured" };

export function verifyImpersonationToken(token: unknown): VerifyResult {
  if (typeof token !== "string" || !token.startsWith("imp_")) {
    return { ok: false, reason: "malformed" };
  }
  const stripped = token.slice(4);
  const dot = stripped.indexOf(".");
  if (dot <= 0) return { ok: false, reason: "malformed" };
  const encoded = stripped.slice(0, dot);
  const signature = stripped.slice(dot + 1);
  if (!encoded || !signature) return { ok: false, reason: "malformed" };

  let secret: string;
  try {
    secret = getSecret();
  } catch {
    return { ok: false, reason: "unconfigured" };
  }

  const expected = sign(encoded, secret);
  // Constant-time comparison
  const a = Buffer.from(signature, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: "bad_signature" };
  }

  let payload: ImpersonationPayload;
  try {
    payload = JSON.parse(b64urlDecode(encoded).toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }

  if (!payload || typeof payload !== "object" || !payload.jti || !payload.tenantId) {
    return { ok: false, reason: "malformed" };
  }

  const nowSec = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== "number" || payload.exp < nowSec) {
    return { ok: false, reason: "expired" };
  }

  return { ok: true, payload };
}
