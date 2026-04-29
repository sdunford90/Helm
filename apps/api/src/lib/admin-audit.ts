import type { Request } from "express";
import { prisma } from "./prisma.js";

// --------------------------------------------------------------------------
// Admin audit log helper
//
// Writes an entry to admin_audit_logs with the actor pulled from the
// authenticated request. Safe to call from every admin handler — failures
// are logged but never thrown so a flaky audit DB write can't take down
// an otherwise-successful operation.
// --------------------------------------------------------------------------

export type AdminAuditAction =
  // Tenant lifecycle
  | "TENANT_CREATE"
  | "TENANT_UPDATE"
  | "TENANT_LOCK"
  | "TENANT_UNLOCK"
  | "TENANT_TIER_CHANGE"
  // Impersonation (sub-action records start, no end events captured today)
  | "TENANT_IMPERSONATE_START"
  // Billing
  | "SAAS_INVOICE_GENERATE"
  | "SAAS_INVOICE_REFUND"
  | "SAAS_TIER_UPDATE"
  // Admin role management
  | "ADMIN_ROLE_CHANGE"
  | "ADMIN_INVITE"
  | "ADMIN_DEACTIVATE"
  // Tenant data lifecycle
  | "TENANT_EXPORT_REQUEST"
  | "TENANT_EXPORT_DOWNLOAD"
  | "TENANT_DELETE_REQUEST"
  | "TENANT_DELETE_CANCEL"
  | "TENANT_DELETE_EXECUTE"
  // Locations under a tenant
  | "TENANT_LOCATION_CREATE"
  | "TENANT_LOCATION_UPDATE"
  | "TENANT_LOCATION_DELETE"
  // Queue ops
  | "QUEUES_PAUSE"
  | "QUEUES_RESUME"
  // Support tickets
  | "SUPPORT_TICKET_CREATE"
  | "SUPPORT_TICKET_UPDATE";

interface LogEntry {
  action: AdminAuditAction | string;
  targetTenantId?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  details?: Record<string, unknown> | null;
}

export async function logAdminAction(req: Request, entry: LogEntry): Promise<void> {
  try {
    const actorRecord = req.userRecord as Record<string, unknown> | undefined;
    const actorUserId = (req.userId as string | undefined) ?? "unknown";
    const actorEmail = (actorRecord?.email as string | undefined) ?? "unknown";
    const firstName = (actorRecord?.firstName as string | undefined) ?? "";
    const lastName = (actorRecord?.lastName as string | undefined) ?? "";
    const actorName = `${firstName} ${lastName}`.trim() || null;
    const actorAdminRole =
      (req.userAdminRole as string | undefined | null) ??
      (actorRecord?.adminRole as string | undefined) ??
      null;

    await prisma.adminAuditLog.create({
      data: {
        actorUserId,
        actorEmail,
        actorName,
        actorAdminRole,
        action: entry.action,
        targetTenantId: entry.targetTenantId ?? null,
        targetType: entry.targetType ?? null,
        targetId: entry.targetId ?? null,
        detailsJson: entry.details
          ? (JSON.parse(JSON.stringify(entry.details)) as object)
          : undefined,
        ipAddress: req.ip ?? null,
      },
    });
  } catch (err) {
    // Never let audit-log failures break the request pipeline.
    // eslint-disable-next-line no-console
    console.error("[admin-audit] failed to write audit entry", err);
  }
}

/**
 * Convenience for fire-and-forget logging from inside async handlers
 * where awaiting the audit write would slow down the response. Errors
 * are swallowed.
 */
export function logAdminActionDetached(req: Request, entry: LogEntry): void {
  void logAdminAction(req, entry);
}
