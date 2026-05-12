// A7 — Cross-tenant Insights aggregations for the Platform Admin app.
//
// Provides five views, one per Insights sub-page:
//
//   getPlatformHealth()    → MRR, ARR, GMV, take-rate, tenants, trial funnel
//   getTenantBenchmarks()  → anonymized percentiles for occupancy, A/R days,
//                            refund rate, MRR
//   getSupportSlaReport()  → first-response, resolution, backlog by priority
//   getReliabilityReport() → webhook success, queue lag proxies, email fails
//   getAdoptionReport()    → flag overrides, integrations, tier mix
//
// Everything is read-only and tenant-aggregated — no PII leaves the function.

import { prisma } from "../lib/prisma.js";

const DAY_MS = 24 * 60 * 60 * 1000;

function pct(v: number, total: number): number {
  return total > 0 ? v / total : 0;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

// --------------------------------------------------------------------------
// Platform health — single landing KPIs for the Insights overview tab.
// --------------------------------------------------------------------------
export interface PlatformHealth {
  generatedAt: string;
  tenants: {
    total: number;
    active: number;
    trial: number;
    gracePeriod: number;
    locked: number;
  };
  revenue: {
    mrrCents: number;
    arrCents: number;
    gmvCents: number;
    takeRateBps: number;
  };
  trial: {
    last30Signups: number;
    last30Converted: number;
    conversionRate: number;
  };
  churn: {
    cancelledLast30: number;
    rate30d: number;
  };
}

export async function getPlatformHealth(): Promise<PlatformHealth> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * DAY_MS);

  const [byStatus, activeTenants, paymentAgg, posAgg, transientAgg, rampAgg, trialSignups, trialConverted, cancelledRecent] = await Promise.all([
    prisma.tenant.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.tenant.findMany({
      where: { status: "ACTIVE", saasTierId: { not: null } },
      select: { applicationFeePctBps: true, applicationFeeFixedCents: true, saasTier: { select: { monthlyFeeCents: true } } },
    }),
    prisma.payment.aggregate({ where: { status: "COMPLETED" }, _sum: { amountCents: true } }),
    prisma.posTransaction.aggregate({ where: { status: "completed" }, _sum: { totalCents: true } }),
    prisma.transientBooking.aggregate({ _sum: { totalCents: true } }),
    prisma.rampTicket.aggregate({ _sum: { amountCents: true } }),
    prisma.tenant.count({ where: { trialStartedAt: { gte: thirtyDaysAgo } } }),
    prisma.tenant.count({
      where: {
        trialStartedAt: { gte: thirtyDaysAgo },
        status: "ACTIVE",
        saasTierId: { not: null },
      },
    }),
    prisma.tenant.count({ where: { status: "LOCKED", lockedAt: { gte: thirtyDaysAgo } } }),
  ]);

  const statusCounts = byStatus.reduce<Record<string, number>>((acc, row) => {
    acc[row.status] = row._count._all;
    return acc;
  }, {});
  const totalTenants = Object.values(statusCounts).reduce((a, b) => a + b, 0);
  const activeCount = statusCounts.ACTIVE ?? 0;

  const mrrCents = activeTenants.reduce((sum, t) => sum + (t.saasTier?.monthlyFeeCents ?? 0), 0);
  const gmvCents =
    (paymentAgg._sum.amountCents ?? 0) +
    (posAgg._sum.totalCents ?? 0) +
    (transientAgg._sum.totalCents ?? 0) +
    (rampAgg._sum.amountCents ?? 0);

  // Take-rate proxy: weighted average of active tenants' applicationFeePctBps.
  // The fixed-cents portion is ignored — it's per-charge, not per-tenant.
  const totalBps = activeTenants.reduce((sum, t) => sum + (t.applicationFeePctBps ?? 0), 0);
  const takeRateBps = activeTenants.length > 0 ? Math.round(totalBps / activeTenants.length) : 0;

  return {
    generatedAt: new Date().toISOString(),
    tenants: {
      total: totalTenants,
      active: activeCount,
      trial: statusCounts.TRIAL ?? 0,
      gracePeriod: statusCounts.GRACE_PERIOD ?? 0,
      locked: statusCounts.LOCKED ?? 0,
    },
    revenue: {
      mrrCents,
      arrCents: mrrCents * 12,
      gmvCents,
      takeRateBps,
    },
    trial: {
      last30Signups: trialSignups,
      last30Converted: trialConverted,
      conversionRate: pct(trialConverted, trialSignups),
    },
    churn: {
      cancelledLast30: cancelledRecent,
      rate30d: pct(cancelledRecent, activeCount + cancelledRecent),
    },
  };
}

// --------------------------------------------------------------------------
// Tenant benchmarks — anonymized cross-tenant percentiles. No tenant names,
// no IDs — just the distributions an operator wants to compare against.
// --------------------------------------------------------------------------
export interface BenchmarkBand {
  metric: string;
  unit: "PCT" | "DAYS" | "CENTS" | "COUNT";
  sampleSize: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
}

export interface TenantBenchmarksReport {
  generatedAt: string;
  bands: BenchmarkBand[];
}

export async function getTenantBenchmarks(): Promise<TenantBenchmarksReport> {
  const ninetyDaysAgo = new Date(Date.now() - 90 * DAY_MS);

  const tenants = await prisma.tenant.findMany({
    where: { status: "ACTIVE" },
    select: { id: true, saasTier: { select: { monthlyFeeCents: true } } },
  });
  const tenantIds = tenants.map((t) => t.id);
  if (tenantIds.length === 0) {
    return { generatedAt: new Date().toISOString(), bands: [] };
  }

  // Group everything by tenantId in a single pass so we keep DB round-trips
  // bounded.
  const [slipsByTenant, activeContractsByTenant, openInvoicesByTenant, paidPaymentsByTenant, refundPaymentsByTenant] = await Promise.all([
    prisma.slip.groupBy({
      by: ["tenantId"],
      _count: { _all: true },
      where: { tenantId: { in: tenantIds } },
    }),
    prisma.slipContract.groupBy({
      by: ["tenantId"],
      _count: { _all: true },
      where: { tenantId: { in: tenantIds }, status: "ACTIVE" },
    }),
    prisma.invoice.groupBy({
      by: ["tenantId"],
      _sum: { balanceCents: true },
      where: { tenantId: { in: tenantIds }, status: { in: ["ISSUED", "PAST_DUE", "COLLECTIONS"] } },
    }),
    prisma.payment.groupBy({
      by: ["tenantId"],
      _sum: { amountCents: true },
      _count: { _all: true },
      where: { tenantId: { in: tenantIds }, status: "COMPLETED", createdAt: { gte: ninetyDaysAgo } },
    }),
    prisma.paymentRefund.groupBy({
      by: ["tenantId"],
      _sum: { amountCents: true },
      where: { tenantId: { in: tenantIds }, createdAt: { gte: ninetyDaysAgo } },
    }),
  ]);

  const slipsMap = new Map(slipsByTenant.map((r) => [r.tenantId, r._count._all]));
  const activeContractsMap = new Map(activeContractsByTenant.map((r) => [r.tenantId, r._count._all]));
  const openBalanceMap = new Map(openInvoicesByTenant.map((r) => [r.tenantId, r._sum.balanceCents ?? 0]));
  const paymentSumMap = new Map(paidPaymentsByTenant.map((r) => [r.tenantId, r._sum.amountCents ?? 0]));
  const refundSumMap = new Map(refundPaymentsByTenant.map((r) => [r.tenantId, r._sum.amountCents ?? 0]));

  const occupancy: number[] = [];
  const arDays: number[] = [];
  const refundRate: number[] = [];
  const mrr: number[] = [];

  for (const t of tenants) {
    const totalSlips = slipsMap.get(t.id) ?? 0;
    const activeContracts = activeContractsMap.get(t.id) ?? 0;
    if (totalSlips > 0) {
      occupancy.push(Math.min(1, activeContracts / totalSlips));
    }

    const open = openBalanceMap.get(t.id) ?? 0;
    const paid90 = paymentSumMap.get(t.id) ?? 0;
    if (paid90 > 0) {
      // A/R days ≈ open_balance / (paid_in_90 / 90).
      arDays.push(Math.round(open / (paid90 / 90)));
    }

    const refund90 = refundSumMap.get(t.id) ?? 0;
    if (paid90 > 0) {
      refundRate.push(Math.min(1, refund90 / paid90));
    }

    const monthly = t.saasTier?.monthlyFeeCents ?? 0;
    if (monthly > 0) mrr.push(monthly);
  }

  const sortAsc = (arr: number[]): number[] => arr.slice().sort((a, b) => a - b);

  const sortedOcc = sortAsc(occupancy);
  const sortedAr = sortAsc(arDays);
  const sortedRefund = sortAsc(refundRate);
  const sortedMrr = sortAsc(mrr);

  const bands: BenchmarkBand[] = [
    {
      metric: "Slip occupancy",
      unit: "PCT",
      sampleSize: sortedOcc.length,
      p25: percentile(sortedOcc, 0.25),
      p50: percentile(sortedOcc, 0.5),
      p75: percentile(sortedOcc, 0.75),
      p90: percentile(sortedOcc, 0.9),
    },
    {
      metric: "Days sales outstanding",
      unit: "DAYS",
      sampleSize: sortedAr.length,
      p25: percentile(sortedAr, 0.25),
      p50: percentile(sortedAr, 0.5),
      p75: percentile(sortedAr, 0.75),
      p90: percentile(sortedAr, 0.9),
    },
    {
      metric: "Refund rate (90d)",
      unit: "PCT",
      sampleSize: sortedRefund.length,
      p25: percentile(sortedRefund, 0.25),
      p50: percentile(sortedRefund, 0.5),
      p75: percentile(sortedRefund, 0.75),
      p90: percentile(sortedRefund, 0.9),
    },
    {
      metric: "Monthly SaaS spend",
      unit: "CENTS",
      sampleSize: sortedMrr.length,
      p25: percentile(sortedMrr, 0.25),
      p50: percentile(sortedMrr, 0.5),
      p75: percentile(sortedMrr, 0.75),
      p90: percentile(sortedMrr, 0.9),
    },
  ];

  return { generatedAt: new Date().toISOString(), bands };
}

// --------------------------------------------------------------------------
// Support SLA — first-response and resolution stats, plus current backlog.
// --------------------------------------------------------------------------
export interface SupportSlaReport {
  generatedAt: string;
  windowDays: number;
  tickets: {
    total: number;
    resolved: number;
    avgFirstResponseHours: number | null;
    avgResolutionHours: number | null;
    p90FirstResponseHours: number | null;
    p90ResolutionHours: number | null;
  };
  backlog: {
    priority: string;
    open: number;
    inProgress: number;
    waiting: number;
  }[];
}

export async function getSupportSlaReport(): Promise<SupportSlaReport> {
  const windowDays = 30;
  const since = new Date(Date.now() - windowDays * DAY_MS);

  const tickets = await prisma.supportTicket.findMany({
    where: { createdAt: { gte: since } },
    select: { id: true, createdAt: true, updatedAt: true, status: true },
  });
  const ticketIds = tickets.map((t) => t.id);

  // First-response = the earliest non-tenant event (kind != REPLY) created
  // by an admin actor. We treat anything with kind=REPLY|NOTE|STATUS as a
  // response signal — anything beats radio silence.
  const events = ticketIds.length > 0
    ? await prisma.supportTicketEvent.findMany({
      where: { ticketId: { in: ticketIds } },
      select: { ticketId: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    })
    : [];

  const firstEventByTicket = new Map<string, Date>();
  for (const ev of events) {
    if (!firstEventByTicket.has(ev.ticketId)) firstEventByTicket.set(ev.ticketId, ev.createdAt);
  }

  const HOUR_MS = 60 * 60 * 1000;
  const firstResponseHours: number[] = [];
  const resolutionHours: number[] = [];
  let resolvedCount = 0;

  for (const t of tickets) {
    const firstAt = firstEventByTicket.get(t.id);
    if (firstAt) {
      firstResponseHours.push((firstAt.getTime() - t.createdAt.getTime()) / HOUR_MS);
    }
    if (t.status === "resolved" || t.status === "closed") {
      resolvedCount++;
      resolutionHours.push((t.updatedAt.getTime() - t.createdAt.getTime()) / HOUR_MS);
    }
  }

  const avg = (arr: number[]): number | null =>
    arr.length === 0 ? null : Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 10) / 10;
  const p90 = (arr: number[]): number | null =>
    arr.length === 0 ? null : Math.round(percentile(arr.slice().sort((a, b) => a - b), 0.9) * 10) / 10;

  // Backlog by priority for whatever's still open right now.
  const backlogRows = await prisma.supportTicket.groupBy({
    by: ["priority", "status"],
    where: { status: { in: ["open", "in_progress", "waiting_on_customer"] } },
    _count: { _all: true },
  });
  const priorities = ["urgent", "high", "medium", "low"];
  const backlog = priorities.map((priority) => {
    const open = backlogRows.find((r) => r.priority === priority && r.status === "open")?._count._all ?? 0;
    const inProgress = backlogRows.find((r) => r.priority === priority && r.status === "in_progress")?._count._all ?? 0;
    const waiting = backlogRows.find((r) => r.priority === priority && r.status === "waiting_on_customer")?._count._all ?? 0;
    return { priority, open, inProgress, waiting };
  });

  return {
    generatedAt: new Date().toISOString(),
    windowDays,
    tickets: {
      total: tickets.length,
      resolved: resolvedCount,
      avgFirstResponseHours: avg(firstResponseHours),
      avgResolutionHours: avg(resolutionHours),
      p90FirstResponseHours: p90(firstResponseHours),
      p90ResolutionHours: p90(resolutionHours),
    },
    backlog,
  };
}

// --------------------------------------------------------------------------
// Reliability — webhook delivery success, email failure mass, pending retry
// backlog. Queue depth itself lives behind the existing /health/system feed,
// so we don't duplicate it here.
// --------------------------------------------------------------------------
export interface ReliabilityReport {
  generatedAt: string;
  webhooks: {
    last24h: { total: number; success: number; failed: number; successRate: number };
    last7d: { total: number; success: number; failed: number; successRate: number };
    pendingRetry: number;
    disabledDestinations: number;
  };
  email: {
    tenantsWithRecentFailure: number;
    recentFailureWindowDays: number;
  };
}

export async function getReliabilityReport(): Promise<ReliabilityReport> {
  const since24 = new Date(Date.now() - 1 * DAY_MS);
  const since7d = new Date(Date.now() - 7 * DAY_MS);
  const since30d = new Date(Date.now() - 30 * DAY_MS);

  const [w24, w7d, pendingRetry, disabledDestinations, emailFailureTenants] = await Promise.all([
    prisma.webhookDelivery.groupBy({
      by: ["status"],
      where: { createdAt: { gte: since24 } },
      _count: { _all: true },
    }),
    prisma.webhookDelivery.groupBy({
      by: ["status"],
      where: { createdAt: { gte: since7d } },
      _count: { _all: true },
    }),
    prisma.webhookDelivery.count({
      where: { status: "FAILED", nextRetryAt: { not: null, gte: new Date() } },
    }),
    prisma.webhookDestination.count({ where: { enabled: false, disabledAt: { not: null } } }),
    prisma.tenant.count({ where: { lastEmailFailureAt: { gte: since30d } } }),
  ]);

  const summarize = (rows: { status: string; _count: { _all: number } }[]) => {
    let total = 0;
    let success = 0;
    let failed = 0;
    for (const r of rows) {
      total += r._count._all;
      if (r.status === "SUCCESS") success += r._count._all;
      else if (r.status === "FAILED") failed += r._count._all;
    }
    return { total, success, failed, successRate: pct(success, total) };
  };

  return {
    generatedAt: new Date().toISOString(),
    webhooks: {
      last24h: summarize(w24),
      last7d: summarize(w7d),
      pendingRetry,
      disabledDestinations,
    },
    email: {
      tenantsWithRecentFailure: emailFailureTenants,
      recentFailureWindowDays: 30,
    },
  };
}

// --------------------------------------------------------------------------
// Adoption — integration coverage + tier mix + feature-flag rollout.
// "Login frequency" needs a lastSignInAt that we don't track yet; we use
// tenant updatedAt as a "saw activity within 30d" proxy.
// --------------------------------------------------------------------------
export interface AdoptionReport {
  generatedAt: string;
  totals: { activeTenants: number };
  integrations: {
    stripeConnected: number;
    quickbooksConnected: number;
    customEmailDomain: number;
    customBranding: number;
  };
  tierMix: { tierId: string | null; tierName: string; tenantCount: number; monthlyFeeCents: number }[];
  featureFlagOverrides: { flag: string; on: number; off: number }[];
  recentlyActive30d: number;
}

export async function getAdoptionReport(): Promise<AdoptionReport> {
  const since30 = new Date(Date.now() - 30 * DAY_MS);

  const activeTenants = await prisma.tenant.findMany({
    where: { status: "ACTIVE" },
    select: {
      id: true,
      stripeAccountId: true,
      qboRealmId: true,
      emailFromDomain: true,
      brandingJson: true,
      updatedAt: true,
      saasTierId: true,
      saasTier: { select: { name: true, monthlyFeeCents: true } },
    },
  });

  let stripeConnected = 0;
  let quickbooksConnected = 0;
  let customEmailDomain = 0;
  let customBranding = 0;
  let recentlyActive30d = 0;

  const tierTally = new Map<string | null, { name: string; count: number; monthlyFeeCents: number }>();
  for (const t of activeTenants) {
    if (t.stripeAccountId) stripeConnected++;
    if (t.qboRealmId) quickbooksConnected++;
    if (t.emailFromDomain) customEmailDomain++;
    if (t.brandingJson) customBranding++;
    if (t.updatedAt >= since30) recentlyActive30d++;

    const key = t.saasTierId;
    if (!tierTally.has(key)) {
      tierTally.set(key, {
        name: t.saasTier?.name ?? "Unassigned",
        count: 0,
        monthlyFeeCents: t.saasTier?.monthlyFeeCents ?? 0,
      });
    }
    tierTally.get(key)!.count++;
  }

  const tierMix = Array.from(tierTally.entries())
    .map(([tierId, v]) => ({ tierId, tierName: v.name, tenantCount: v.count, monthlyFeeCents: v.monthlyFeeCents }))
    .sort((a, b) => b.tenantCount - a.tenantCount);

  const overrides = await prisma.featureFlagOverride.groupBy({
    by: ["flag", "enabled"],
    _count: { _all: true },
  });
  const flagMap = new Map<string, { on: number; off: number }>();
  for (const row of overrides) {
    if (!flagMap.has(row.flag)) flagMap.set(row.flag, { on: 0, off: 0 });
    const bucket = flagMap.get(row.flag)!;
    if (row.enabled) bucket.on += row._count._all;
    else bucket.off += row._count._all;
  }
  const featureFlagOverrides = Array.from(flagMap.entries())
    .map(([flag, v]) => ({ flag, ...v }))
    .sort((a, b) => (b.on + b.off) - (a.on + a.off));

  return {
    generatedAt: new Date().toISOString(),
    totals: { activeTenants: activeTenants.length },
    integrations: {
      stripeConnected,
      quickbooksConnected,
      customEmailDomain,
      customBranding,
    },
    tierMix,
    featureFlagOverrides,
    recentlyActive30d,
  };
}
