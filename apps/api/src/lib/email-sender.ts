import { prisma } from "./prisma.js";

/**
 * Resolved outbound email sender for a single send. The strings are
 * already RFC 5322 ready ("Display Name <addr@example.com>" form for
 * `from`) so callers can pass `from` straight through to Resend.
 */
export interface ResolvedSender {
  from: string;
  replyTo?: string;
}

/**
 * Default sender used when no per-tenant or per-location override is set.
 * Resend must have gethelm.com verified for this to deliver.
 */
export const DEFAULT_FROM_ADDRESS = "noreply@gethelm.com";

interface SenderColumns {
  emailFromDomain: string | null;
  emailFromAddress: string | null;
  emailFromName: string | null;
  emailReplyTo: string | null;
}

function buildAddress(cols: SenderColumns | null): string | null {
  if (!cols) return null;
  if (cols.emailFromAddress) return cols.emailFromAddress;
  if (cols.emailFromDomain) return `billing@${cols.emailFromDomain}`;
  return null;
}

function withDisplayName(address: string, name: string | null | undefined): string {
  if (!name) return address;
  // Strip characters that would corrupt the header, then quote the name.
  const safe = name.replace(/["\r\n<>]/g, "").trim();
  if (!safe) return address;
  return `${safe} <${address}>`;
}

/**
 * Resolve the FROM/replyTo for an outbound email given a tenant and
 * optional location. Resolution order is **location → tenant → default**:
 * any field present on the location wins outright (so a marina can
 * override the FROM domain or reply-to mailbox per property), then any
 * field present on the tenant fills in, and finally we fall back to
 * `noreply@gethelm.com` with no display name and no reply-to.
 *
 * Returns the default sender (no DB read) when both ids are null/undefined.
 */
export async function resolveEmailSender(
  tenantId?: string | null,
  locationId?: string | null,
): Promise<ResolvedSender> {
  if (!tenantId && !locationId) {
    return { from: DEFAULT_FROM_ADDRESS };
  }

  const [tenant, location] = await Promise.all([
    tenantId
      ? prisma.tenant.findUnique({
          where: { id: tenantId },
          select: {
            emailFromDomain: true,
            emailFromAddress: true,
            emailFromName: true,
            emailReplyTo: true,
          },
        })
      : Promise.resolve(null),
    locationId
      ? prisma.location.findUnique({
          where: { id: locationId },
          select: {
            emailFromDomain: true,
            emailFromAddress: true,
            emailFromName: true,
            emailReplyTo: true,
          },
        })
      : Promise.resolve(null),
  ]);

  // Address: prefer location's, then tenant's, then default.
  const address =
    buildAddress(location) ?? buildAddress(tenant) ?? DEFAULT_FROM_ADDRESS;

  // Display name + reply-to are independently resolved field-by-field
  // (location wins, tenant fills in) so a marina can set a tenant-level
  // display name and only override the domain on a single location.
  const displayName =
    location?.emailFromName ?? tenant?.emailFromName ?? null;
  const replyTo =
    location?.emailReplyTo ?? tenant?.emailReplyTo ?? undefined;

  return {
    from: withDisplayName(address, displayName),
    ...(replyTo ? { replyTo } : {}),
  };
}

/**
 * Record an email-send failure on the tenant so the Settings UI can show
 * a "last failure" health row. updateMany() avoids throwing when the
 * tenant has been deleted between enqueue and dequeue (background workers).
 */
export async function recordEmailFailure(
  tenantId: string | undefined | null,
  recipient: string,
  reason: string,
): Promise<void> {
  if (!tenantId) return;
  try {
    await prisma.tenant.updateMany({
      where: { id: tenantId },
      data: {
        lastEmailFailureAt: new Date(),
        lastEmailFailureRecipient: recipient.slice(0, 320),
        lastEmailFailureReason: reason.slice(0, 1000),
      },
    });
  } catch (err) {
    // Don't let bookkeeping failures mask the real send error.
    console.error(
      "[email-sender] failed to record email failure on tenant:",
      err,
    );
  }
}
