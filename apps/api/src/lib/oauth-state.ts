import { createHash, randomBytes } from "node:crypto";
import { prisma, tenantStore } from "./prisma.js";

// --------------------------------------------------------------------------
// OAuth `state` handling for the Stripe Connect and QuickBooks connect flows.
//
// The state sent to the provider is a random 256-bit nonce. Only its SHA-256
// is stored (oauth_states), bound to the tenant and user that started the
// flow, with a 10-minute TTL. On callback the row is looked up by hash and
// deleted; a state can therefore be used exactly once, and the tenant comes
// from OUR record — never from the URL or the state string itself.
// --------------------------------------------------------------------------

export type OAuthProvider = "stripe_connect" | "qbo";

export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

export interface OAuthStateBinding {
  tenantId: string;
  userId: string;
}

function hashState(state: string): string {
  return createHash("sha256").update(state).digest("hex");
}

/** Create a single-use state for `provider`, bound to tenant + user. */
export async function createOAuthState(
  provider: OAuthProvider,
  binding: OAuthStateBinding,
): Promise<string> {
  const state = randomBytes(32).toString("base64url");
  const now = Date.now();

  await tenantStore.exit(async () => {
    // Opportunistic cleanup of abandoned flows.
    await prisma.oAuthState.deleteMany({ where: { expiresAt: { lt: new Date(now) } } });
    await prisma.oAuthState.create({
      data: {
        provider,
        tenantId: binding.tenantId,
        userId: binding.userId,
        stateHash: hashState(state),
        expiresAt: new Date(now + OAUTH_STATE_TTL_MS),
      },
    });
  });

  return state;
}

/**
 * Verify and consume a state from a provider callback. Returns the binding
 * when the state exists, belongs to `provider`, has not expired, and this
 * call won the race to delete it; otherwise null (unknown, replayed,
 * expired, wrong provider, malformed).
 */
export async function consumeOAuthState(
  provider: OAuthProvider,
  state: unknown,
): Promise<OAuthStateBinding | null> {
  if (typeof state !== "string" || state.length < 32 || state.length > 128) return null;
  const stateHash = hashState(state);

  return tenantStore.exit(async () => {
    const row = await prisma.oAuthState.findUnique({ where: { stateHash } });
    if (!row) return null;

    // Single use: only the caller whose delete actually removed the row wins.
    const { count } = await prisma.oAuthState.deleteMany({ where: { id: row.id } });
    if (count !== 1) return null;

    if (row.provider !== provider) return null;
    if (row.expiresAt.getTime() <= Date.now()) return null;

    return { tenantId: row.tenantId, userId: row.userId };
  });
}

/**
 * The user who started the flow must still be an active owner of the tenant
 * when the callback lands (they may have been removed in the meantime).
 */
export async function isActiveTenantOwner(binding: OAuthStateBinding): Promise<boolean> {
  return tenantStore.exit(async () => {
    const user = await prisma.user.findFirst({
      where: {
        id: binding.userId,
        tenantId: binding.tenantId,
        active: true,
        role: "MARINA_OWNER",
      },
      select: { id: true },
    });
    return !!user;
  });
}
