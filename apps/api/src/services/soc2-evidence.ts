// Plan 63 — SOC 2 evidence collection.
//
// Builds a single JSON bundle covering the access-and-change controls a SOC 2
// auditor typically asks for during a quarterly walkthrough. The bundle is
// platform-wide (not per-tenant) because the audit is on the platform's
// operating effectiveness, not on any one customer.
//
// What's in: admin/staff access changes, impersonation history, tenant
// lifecycle transitions, data exports, period closes, webhook auto-disables,
// and high-level counts. What's out: customer PII, payloads, secrets — only
// metadata and action verbs.

import { prisma } from "../lib/prisma.js";

export interface Soc2EvidenceBundle {
  generatedAt: string;
  windowStart: string;
  windowEnd: string;
  summary: {
    tenants: { total: number; active: number; trial: number; locked: number };
    adminUsers: number;
    staffUsers: number;
    impersonationsInWindow: number;
    tenantExportsInWindow: number;
    periodsClosedInWindow: number;
    webhookAutoDisablesInWindow: number;
  };
  adminActions: Array<{
    id: string;
    action: string;
    adminEmail: string | null;
    tenantId: string | null;
    ipAddress: string | null;
    createdAt: string;
  }>;
  impersonations: Array<{
    id: string;
    adminEmail: string | null;
    tenantId: string | null;
    reason: string | null;
    startedAt: string;
    ipAddress: string | null;
  }>;
  tenantExports: Array<{
    id: string;
    tenantId: string;
    requestedBy: string | null;
    status: string;
    createdAt: string;
  }>;
  periodCloses: Array<{
    id: string;
    tenantId: string;
    locationId: string;
    periodStart: string;
    periodEnd: string;
    closedAt: string;
    closedByUserId: string | null;
  }>;
  disabledWebhooks: Array<{
    id: string;
    tenantId: string;
    url: string;
    consecutiveFailures: number;
    disabledAt: string;
  }>;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export async function buildSoc2EvidenceBundle(args: {
  windowStart?: Date;
  windowEnd?: Date;
} = {}): Promise<Soc2EvidenceBundle> {
  const windowEnd = args.windowEnd ?? new Date();
  const windowStart = args.windowStart ?? new Date(windowEnd.getTime() - 90 * DAY_MS);

  const [tenantsByStatus, adminUsers, staffUsers, impersonations, exports, periodCloses, disabledWebhooks, adminActions] = await Promise.all([
    prisma.tenant.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.user.count({ where: { role: "PLATFORM_ADMIN", active: true } }),
    prisma.user.count({ where: { active: true, role: { not: "PLATFORM_ADMIN" } } }),
    prisma.adminAuditEvent.findMany({
      where: {
        action: "IMPERSONATION_STARTED",
        createdAt: { gte: windowStart, lte: windowEnd },
      },
      orderBy: { createdAt: "desc" },
      take: 1000,
    }),
    prisma.tenantExport.findMany({
      where: { createdAt: { gte: windowStart, lte: windowEnd } },
      orderBy: { createdAt: "desc" },
      take: 1000,
      select: { id: true, tenantId: true, requestedById: true, status: true, createdAt: true },
    }),
    prisma.accountingPeriod.findMany({
      where: { closedAt: { gte: windowStart, lte: windowEnd, not: null } },
      orderBy: { closedAt: "desc" },
      take: 1000,
      select: { id: true, tenantId: true, locationId: true, periodStart: true, periodEnd: true, closedAt: true, closedByUserId: true },
    }),
    prisma.webhookDestination.findMany({
      where: {
        enabled: false,
        disabledAt: { gte: windowStart, lte: windowEnd, not: null },
      },
      orderBy: { disabledAt: "desc" },
      take: 1000,
      select: { id: true, tenantId: true, url: true, consecutiveFailures: true, disabledAt: true },
    }),
    prisma.adminAuditEvent.findMany({
      where: { createdAt: { gte: windowStart, lte: windowEnd } },
      orderBy: { createdAt: "desc" },
      take: 2000,
    }),
  ]);

  const statusCounts: Record<string, number> = {};
  for (const row of tenantsByStatus) statusCounts[row.status] = row._count._all;
  const totalTenants = Object.values(statusCounts).reduce((a, b) => a + b, 0);

  return {
    generatedAt: new Date().toISOString(),
    windowStart: windowStart.toISOString(),
    windowEnd: windowEnd.toISOString(),
    summary: {
      tenants: {
        total: totalTenants,
        active: statusCounts.ACTIVE ?? 0,
        trial: statusCounts.TRIAL ?? 0,
        locked: statusCounts.LOCKED ?? 0,
      },
      adminUsers,
      staffUsers,
      impersonationsInWindow: impersonations.length,
      tenantExportsInWindow: exports.length,
      periodsClosedInWindow: periodCloses.length,
      webhookAutoDisablesInWindow: disabledWebhooks.length,
    },
    adminActions: adminActions.map((e) => ({
      id: e.id,
      action: e.action,
      adminEmail: e.adminEmail,
      tenantId: e.tenantId,
      ipAddress: e.ipAddress,
      createdAt: e.createdAt.toISOString(),
    })),
    impersonations: impersonations.map((e) => ({
      id: e.id,
      adminEmail: e.adminEmail,
      tenantId: e.tenantId,
      reason: e.metadataJson && typeof e.metadataJson === "object" && "reason" in e.metadataJson
        ? String((e.metadataJson as { reason: unknown }).reason ?? "")
        : null,
      startedAt: e.createdAt.toISOString(),
      ipAddress: e.ipAddress,
    })),
    tenantExports: exports.map((x) => ({
      id: x.id,
      tenantId: x.tenantId,
      requestedBy: x.requestedById,
      status: x.status,
      createdAt: x.createdAt.toISOString(),
    })),
    periodCloses: periodCloses.map((p) => ({
      id: p.id,
      tenantId: p.tenantId,
      locationId: p.locationId,
      periodStart: p.periodStart.toISOString(),
      periodEnd: p.periodEnd.toISOString(),
      closedAt: p.closedAt!.toISOString(),
      closedByUserId: p.closedByUserId,
    })),
    disabledWebhooks: disabledWebhooks.map((w) => ({
      id: w.id,
      tenantId: w.tenantId,
      url: w.url,
      consecutiveFailures: w.consecutiveFailures,
      disabledAt: w.disabledAt!.toISOString(),
    })),
  };
}
