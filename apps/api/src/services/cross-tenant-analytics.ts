import { prisma } from "../lib/prisma.js";

// ---------------------------------------------------------------------------
// Cross-tenant analytics service
//
// Drives the platform admin Analytics page:
//   1. Cohort retention, churn, NRR, ARPU.
//   2. Trial → paid funnel + drop-off breakdown.
//   3. Per-tier feature usage heatmap.
//
// All functions accept a `from`/`to` Date window. Defaults at the route layer
// are "last 12 months ending today (UTC, calendar months)".
//
// We compute everything in JavaScript over a small set of Prisma queries
// rather than authoring per-section raw SQL because the platform is small
// (~hundreds of tenants) and the data we need (tenants, saas_invoices,
// per-feature signal rows) is already cheap to materialise.
// ---------------------------------------------------------------------------

export interface AnalyticsRange {
  from: Date;
  to: Date;
}

// ---- Helpers --------------------------------------------------------------

function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function startOfMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

function endOfMonth(d: Date): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0, 23, 59, 59, 999),
  );
}

function addMonths(d: Date, n: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
}

/** Inclusive list of YYYY-MM keys covering every month from `from`..`to`. */
function monthsBetween(from: Date, to: Date): string[] {
  const out: string[] = [];
  let cursor = startOfMonth(from);
  const end = startOfMonth(to);
  while (cursor.getTime() <= end.getTime()) {
    out.push(monthKey(cursor));
    cursor = addMonths(cursor, 1);
  }
  return out;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
    : sorted[mid];
}

// ---------------------------------------------------------------------------
// 1. Cohorts & retention
// ---------------------------------------------------------------------------

export interface CohortRow {
  cohort: string; // YYYY-MM
  signups: number;
  startingMrrCents: number;
  retainedByMonth: { month: string; retained: number; mrrCents: number }[];
  churnRate: number; // 0..1, fraction of cohort that is LOCKED today
  nrr: number; // current cohort MRR / starting cohort MRR
}

export interface ArpuPoint {
  month: string;
  activeTenants: number;
  totalMrrCents: number;
  arpuCents: number;
}

export interface CohortsReport {
  range: { from: string; to: string };
  cohorts: CohortRow[];
  arpu: ArpuPoint[];
  totals: {
    signups: number;
    activeNow: number;
    churnedNow: number;
    overallChurnRate: number;
    overallNrr: number;
  };
}

export async function getCohortsReport(range: AnalyticsRange): Promise<CohortsReport> {
  const months = monthsBetween(range.from, range.to);
  const cohortRangeEnd = startOfMonth(range.to);

  // Tenants in the cohort window define the cohorts themselves.
  const tenants = await prisma.tenant.findMany({
    where: { createdAt: { gte: startOfMonth(range.from), lte: range.to } },
    select: {
      id: true,
      createdAt: true,
      lockedAt: true,
      status: true,
    },
  });

  const tenantIds = tenants.map((t) => t.id);

  // Pull every paid SaaS invoice for these tenants from the cohort window
  // forward. We use periodStart to bucket revenue into the calendar month it
  // covers, and amountCents for the actual revenue (so upgrades / downgrades
  // / pro-rations land in the right month, no current-tier proxy required).
  const paidInvoices =
    tenantIds.length > 0
      ? await prisma.saasInvoice.findMany({
          where: {
            tenantId: { in: tenantIds },
            paidAt: { not: null },
            periodStart: {
              gte: startOfMonth(range.from),
              lte: range.to,
            },
          },
          select: {
            tenantId: true,
            periodStart: true,
            amountCents: true,
          },
        })
      : [];

  // Index invoices by month: month -> tenantId -> total cents that month.
  const invoicesByMonth = new Map<string, Map<string, number>>();
  for (const inv of paidInvoices) {
    const m = monthKey(inv.periodStart);
    if (!invoicesByMonth.has(m)) invoicesByMonth.set(m, new Map());
    const tenantMap = invoicesByMonth.get(m)!;
    tenantMap.set(inv.tenantId, (tenantMap.get(inv.tenantId) ?? 0) + inv.amountCents);
  }

  // Bucket tenants by signup cohort month.
  const buckets = new Map<string, typeof tenants>();
  for (const m of months) buckets.set(m, []);
  for (const t of tenants) {
    const key = monthKey(t.createdAt);
    if (!buckets.has(key)) continue;
    buckets.get(key)!.push(t);
  }

  const cohorts: CohortRow[] = [];

  for (const cohortMonth of months) {
    const cohortTenants = buckets.get(cohortMonth) ?? [];
    const signups = cohortTenants.length;
    const cohortTenantIds = cohortTenants.map((t) => t.id);

    // Per-month retained tenant count + MRR for this cohort, using paid
    // invoices as the source of truth.
    const retainedByMonth: { month: string; retained: number; mrrCents: number }[] = [];
    let cursor = new Date(`${cohortMonth}-01T00:00:00Z`);
    while (cursor.getTime() <= cohortRangeEnd.getTime()) {
      const m = monthKey(cursor);
      const tenantMap = invoicesByMonth.get(m);
      let retained = 0;
      let mrr = 0;
      if (tenantMap) {
        for (const tid of cohortTenantIds) {
          const cents = tenantMap.get(tid);
          if (cents !== undefined && cents > 0) {
            retained++;
            mrr += cents;
          }
        }
      }
      retainedByMonth.push({ month: m, retained, mrrCents: mrr });
      cursor = addMonths(cursor, 1);
    }

    // Starting MRR = cohort revenue in the first month with any paid invoices
    // (typically the cohort month, but tolerates pro-rated trial-end billing).
    const firstWithRevenue = retainedByMonth.find((r) => r.mrrCents > 0);
    const startingMrrCents = firstWithRevenue?.mrrCents ?? 0;
    // Current MRR = cohort revenue in the most recent month in window.
    const currentMrrCents =
      retainedByMonth.length > 0
        ? retainedByMonth[retainedByMonth.length - 1].mrrCents
        : 0;

    const churnedNow = cohortTenants.filter((t) => t.status === "LOCKED").length;
    const churnRate = signups > 0 ? churnedNow / signups : 0;
    const nrr = startingMrrCents > 0 ? currentMrrCents / startingMrrCents : 0;

    cohorts.push({
      cohort: cohortMonth,
      signups,
      startingMrrCents,
      retainedByMonth,
      churnRate: Math.round(churnRate * 10000) / 10000,
      nrr: Math.round(nrr * 10000) / 10000,
    });
  }

  // ARPU per month: sum of paid-invoice revenue / unique paying tenants
  // that month. Source: invoice history, not current tier fee.
  const arpu: ArpuPoint[] = months.map((m) => {
    const tenantMap = invoicesByMonth.get(m);
    if (!tenantMap || tenantMap.size === 0) {
      return { month: m, activeTenants: 0, totalMrrCents: 0, arpuCents: 0 };
    }
    let total = 0;
    for (const cents of tenantMap.values()) total += cents;
    const activeTenants = tenantMap.size;
    return {
      month: m,
      activeTenants,
      totalMrrCents: total,
      arpuCents: activeTenants > 0 ? Math.round(total / activeTenants) : 0,
    };
  });

  // Totals across the window.
  const churnedInWindow = tenants.filter((t) => t.status === "LOCKED").length;
  const totalStartingMrr = cohorts.reduce(
    (sum, c) => sum + c.startingMrrCents,
    0,
  );
  const totalCurrentMrr = cohorts.reduce(
    (sum, c) =>
      sum +
      (c.retainedByMonth.length > 0
        ? c.retainedByMonth[c.retainedByMonth.length - 1].mrrCents
        : 0),
    0,
  );

  return {
    range: {
      from: range.from.toISOString().slice(0, 10),
      to: range.to.toISOString().slice(0, 10),
    },
    cohorts,
    arpu,
    totals: {
      signups: tenants.length,
      activeNow: tenants.length - churnedInWindow,
      churnedNow: churnedInWindow,
      overallChurnRate:
        tenants.length > 0
          ? Math.round((churnedInWindow / tenants.length) * 10000) / 10000
          : 0,
      overallNrr:
        totalStartingMrr > 0
          ? Math.round((totalCurrentMrr / totalStartingMrr) * 10000) / 10000
          : 0,
    },
  };
}

// ---------------------------------------------------------------------------
// 2. Trial → paid funnel
// ---------------------------------------------------------------------------

export interface FunnelReport {
  range: { from: string; to: string };
  trialSignups: number;
  converted: number;
  conversionRate: number;
  medianTimeToPaidDays: number | null;
  dropoff: {
    neverActivated: number; // never engaged: ≤1 user, no Stripe customer, no tier picked
    expired: number; // LOCKED — trial ran out without converting
    downgraded: number; // engaged with billing (Stripe customer / tier picked) but never paid
  };
  monthly: {
    month: string;
    signups: number;
    converted: number;
    conversionRate: number;
  }[];
}

export async function getFunnelReport(range: AnalyticsRange): Promise<FunnelReport> {
  const tenants = await prisma.tenant.findMany({
    where: { createdAt: { gte: range.from, lte: range.to } },
    select: {
      id: true,
      createdAt: true,
      stripeSubscriptionId: true,
      stripeCustomerId: true,
      saasTierId: true,
      status: true,
      lockedAt: true,
      _count: { select: { users: true } },
    },
  });

  const tenantIds = tenants.map((t) => t.id);

  // Pull every "paid" SaaS invoice for these tenants — used for both
  // conversion detection and median time-to-paid.
  const paidInvoices = await prisma.saasInvoice.findMany({
    where: { tenantId: { in: tenantIds }, paidAt: { not: null } },
    select: { tenantId: true, paidAt: true },
    orderBy: { paidAt: "asc" },
  });

  // First-paid timestamp per tenant.
  const firstPaidAt = new Map<string, Date>();
  for (const inv of paidInvoices) {
    if (!inv.paidAt) continue;
    const existing = firstPaidAt.get(inv.tenantId);
    if (!existing || inv.paidAt.getTime() < existing.getTime()) {
      firstPaidAt.set(inv.tenantId, inv.paidAt);
    }
  }

  // A tenant is "converted" if they have either a Stripe subscription on file
  // OR a paid SaaS invoice on record.
  const converted = tenants.filter(
    (t) => Boolean(t.stripeSubscriptionId) || firstPaidAt.has(t.id),
  );
  const convertedIds = new Set(converted.map((t) => t.id));

  const timeToPaidDays: number[] = [];
  for (const t of converted) {
    const paidAt = firstPaidAt.get(t.id);
    if (!paidAt) continue;
    const days = Math.max(
      0,
      (paidAt.getTime() - t.createdAt.getTime()) / (1000 * 60 * 60 * 24),
    );
    timeToPaidDays.push(days);
  }
  const medianDays = median(timeToPaidDays);

  const nonConverted = tenants.filter((t) => !convertedIds.has(t.id));

  // Drop-off categories — MECE within the non-converted set.
  let neverActivated = 0;
  let expired = 0;
  let downgraded = 0;

  for (const t of nonConverted) {
    if (t.status === "LOCKED") {
      expired++;
    } else if (t.stripeCustomerId || t.saasTierId) {
      downgraded++;
    } else if (t._count.users <= 1) {
      neverActivated++;
    }
  }

  // Monthly breakdown for the small chart on the page.
  const months = monthsBetween(range.from, range.to);
  const monthly = months.map((m) => {
    const inMonth = tenants.filter((t) => monthKey(t.createdAt) === m);
    const conv = inMonth.filter((t) => convertedIds.has(t.id)).length;
    return {
      month: m,
      signups: inMonth.length,
      converted: conv,
      conversionRate:
        inMonth.length > 0 ? Math.round((conv / inMonth.length) * 10000) / 10000 : 0,
    };
  });

  return {
    range: {
      from: range.from.toISOString().slice(0, 10),
      to: range.to.toISOString().slice(0, 10),
    },
    trialSignups: tenants.length,
    converted: converted.length,
    conversionRate:
      tenants.length > 0
        ? Math.round((converted.length / tenants.length) * 10000) / 10000
        : 0,
    medianTimeToPaidDays: medianDays === null ? null : Math.round(medianDays * 10) / 10,
    dropoff: { neverActivated, expired, downgraded },
    monthly,
  };
}

// ---------------------------------------------------------------------------
// 3. Per-tier feature usage
// ---------------------------------------------------------------------------

export interface FeatureUsageReport {
  range: { from: string; to: string };
  tiers: { id: string; name: string; tenantCount: number }[];
  features: string[];
  /** matrix[featureIndex][tierIndex] = % (0..1) of tier on that feature */
  matrix: number[][];
  /** raw tenant counts: counts[featureIndex][tierIndex] */
  counts: number[][];
}

const FEATURE_DEFINITIONS: {
  key: string;
  label: string;
  /** Returns the set of tenant IDs that used this feature in the window. */
  detect: (range: AnalyticsRange, allTenantIds: string[]) => Promise<Set<string>>;
}[] = [
  {
    key: "online_payments",
    label: "Online Payments",
    detect: async (range, ids) => {
      const rows = await prisma.payment.findMany({
        where: {
          tenantId: { in: ids },
          stripePaymentId: { not: null },
          createdAt: { gte: range.from, lte: range.to },
        },
        select: { tenantId: true },
        distinct: ["tenantId"],
      });
      return new Set(rows.map((r) => r.tenantId));
    },
  },
  {
    key: "automated_invoicing",
    label: "Automated Invoicing",
    detect: async (range, ids) => {
      const rows = await prisma.invoice.findMany({
        where: {
          tenantId: { in: ids },
          createdAt: { gte: range.from, lte: range.to },
        },
        select: { tenantId: true },
        distinct: ["tenantId"],
      });
      return new Set(rows.map((r) => r.tenantId));
    },
  },
  {
    key: "waitlist",
    label: "Waitlist Management",
    detect: async (range, ids) => {
      const rows = await prisma.waitlistEntry.findMany({
        where: {
          tenantId: { in: ids },
          createdAt: { gte: range.from, lte: range.to },
        },
        select: { tenantId: true },
        distinct: ["tenantId"],
      });
      return new Set(rows.map((r) => r.tenantId));
    },
  },
  {
    key: "customer_portal",
    label: "Customer Portal",
    detect: async (range, ids) => {
      // Tenants that activated a portal user during the period.
      const rows = await prisma.user.findMany({
        where: {
          tenantId: { in: ids },
          role: "PORTAL_USER",
          active: true,
          createdAt: { gte: range.from, lte: range.to },
        },
        select: { tenantId: true },
        distinct: ["tenantId"],
      });
      return new Set(rows.map((r) => r.tenantId));
    },
  },
  {
    key: "transient_bookings",
    label: "Transient Bookings",
    detect: async (range, ids) => {
      const rows = await prisma.transientBooking.findMany({
        where: {
          tenantId: { in: ids },
          createdAt: { gte: range.from, lte: range.to },
        },
        select: { tenantId: true },
        distinct: ["tenantId"],
      });
      return new Set(rows.map((r) => r.tenantId));
    },
  },
  {
    key: "pos_sales",
    label: "Point of Sale",
    detect: async (range, ids) => {
      const rows = await prisma.posTransaction.findMany({
        where: {
          tenantId: { in: ids },
          createdAt: { gte: range.from, lte: range.to },
        },
        select: { tenantId: true },
        distinct: ["tenantId"],
      });
      return new Set(rows.map((r) => r.tenantId));
    },
  },
  {
    key: "quickbooks",
    label: "QuickBooks Sync",
    detect: async (range, ids) => {
      // Tenants that either connected QBO or received a QBO webhook during
      // the period (i.e. real sync activity in window, not just an old setup).
      const [connected, deliveries] = await Promise.all([
        prisma.tenant.findMany({
          where: {
            id: { in: ids },
            qboRealmId: { not: null },
            qboConnectedAt: { gte: range.from, lte: range.to },
          },
          select: { id: true },
        }),
        prisma.qboWebhookDelivery.findMany({
          where: {
            tenantId: { in: ids },
            receivedAt: { gte: range.from, lte: range.to },
          },
          select: { tenantId: true },
          distinct: ["tenantId"],
        }),
      ]);
      const out = new Set<string>();
      for (const r of connected) out.add(r.id);
      for (const r of deliveries) {
        if (r.tenantId) out.add(r.tenantId);
      }
      return out;
    },
  },
  {
    key: "custom_domain",
    label: "Custom Domain",
    detect: async (range, ids) => {
      // Tenants that had a custom domain configured AND were touched during
      // the period (proxy for "the domain was actually serving traffic for
      // an active tenant in window"). updatedAt advances on any tenant
      // mutation, so an idle dormant tenant won't qualify.
      const rows = await prisma.tenant.findMany({
        where: {
          id: { in: ids },
          customDomain: { not: null },
          updatedAt: { gte: range.from, lte: range.to },
        },
        select: { id: true },
      });
      return new Set(rows.map((r) => r.id));
    },
  },
  {
    key: "api_keys",
    label: "API Integration",
    detect: async (range, ids) => {
      // Tenants whose API key was actually used during the period.
      const rows = await prisma.apiKey.findMany({
        where: {
          tenantId: { in: ids },
          revokedAt: null,
          lastUsedAt: { gte: range.from, lte: range.to },
        },
        select: { tenantId: true },
        distinct: ["tenantId"],
      });
      return new Set(rows.map((r) => r.tenantId));
    },
  },
];

export async function getFeatureUsageReport(
  range: AnalyticsRange,
): Promise<FeatureUsageReport> {
  const tenants = await prisma.tenant.findMany({
    select: {
      id: true,
      saasTierId: true,
      saasTier: { select: { id: true, name: true, monthlyFeeCents: true } },
    },
  });

  const tierMap = new Map<string, { id: string; name: string; tenantCount: number }>();
  const tenantsByTier = new Map<string, string[]>();
  for (const t of tenants) {
    if (!t.saasTier) continue;
    const tierId = t.saasTier.id;
    if (!tierMap.has(tierId)) {
      tierMap.set(tierId, { id: tierId, name: t.saasTier.name, tenantCount: 0 });
      tenantsByTier.set(tierId, []);
    }
    tierMap.get(tierId)!.tenantCount++;
    tenantsByTier.get(tierId)!.push(t.id);
  }

  const tiers = Array.from(tierMap.values()).sort((a, b) =>
    a.name.localeCompare(b.name),
  );

  const allTenantIds = tenants.map((t) => t.id);

  // Run feature detection in parallel.
  const featureSets = await Promise.all(
    FEATURE_DEFINITIONS.map((f) => f.detect(range, allTenantIds)),
  );

  const features = FEATURE_DEFINITIONS.map((f) => f.label);
  const matrix: number[][] = [];
  const counts: number[][] = [];

  for (let f = 0; f < FEATURE_DEFINITIONS.length; f++) {
    const usingSet = featureSets[f];
    const featureRow: number[] = [];
    const countRow: number[] = [];
    for (const tier of tiers) {
      const tierTenants = tenantsByTier.get(tier.id) ?? [];
      const using = tierTenants.filter((id) => usingSet.has(id)).length;
      countRow.push(using);
      featureRow.push(
        tier.tenantCount > 0
          ? Math.round((using / tier.tenantCount) * 10000) / 10000
          : 0,
      );
    }
    matrix.push(featureRow);
    counts.push(countRow);
  }

  return {
    range: {
      from: range.from.toISOString().slice(0, 10),
      to: range.to.toISOString().slice(0, 10),
    },
    tiers,
    features,
    matrix,
    counts,
  };
}

// ---------------------------------------------------------------------------
// CSV serialisers
// ---------------------------------------------------------------------------

function csvEscape(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function rowsToCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const keys = Object.keys(rows[0]);
  const header = keys.join(",");
  const lines = rows.map((r) => keys.map((k) => csvEscape(r[k])).join(","));
  return [header, ...lines].join("\n");
}

export function cohortsToCsv(report: CohortsReport): string {
  const rows: Record<string, unknown>[] = [];
  for (const c of report.cohorts) {
    for (const r of c.retainedByMonth) {
      rows.push({
        cohort: c.cohort,
        cohort_signups: c.signups,
        cohort_starting_mrr_cents: c.startingMrrCents,
        report_month: r.month,
        retained_tenants: r.retained,
        retained_mrr_cents: r.mrrCents,
        cohort_churn_rate: c.churnRate,
        cohort_nrr: c.nrr,
      });
    }
  }
  return rowsToCsv(rows);
}

export function funnelToCsv(report: FunnelReport): string {
  const rows: Record<string, unknown>[] = [
    {
      metric: "trial_signups",
      value: report.trialSignups,
    },
    { metric: "converted", value: report.converted },
    { metric: "conversion_rate", value: report.conversionRate },
    {
      metric: "median_time_to_paid_days",
      value: report.medianTimeToPaidDays ?? "",
    },
    { metric: "dropoff_never_activated", value: report.dropoff.neverActivated },
    { metric: "dropoff_expired", value: report.dropoff.expired },
    { metric: "dropoff_downgraded", value: report.dropoff.downgraded },
  ];
  for (const m of report.monthly) {
    rows.push({
      metric: `month_${m.month}_signups`,
      value: m.signups,
    });
    rows.push({
      metric: `month_${m.month}_converted`,
      value: m.converted,
    });
    rows.push({
      metric: `month_${m.month}_conversion_rate`,
      value: m.conversionRate,
    });
  }
  return rowsToCsv(rows);
}

export function featureUsageToCsv(report: FeatureUsageReport): string {
  const rows: Record<string, unknown>[] = [];
  for (let f = 0; f < report.features.length; f++) {
    const row: Record<string, unknown> = { feature: report.features[f] };
    for (let i = 0; i < report.tiers.length; i++) {
      const tier = report.tiers[i];
      row[`${tier.name}_tenants_using`] = report.counts[f][i];
      row[`${tier.name}_total_tenants`] = tier.tenantCount;
      row[`${tier.name}_pct`] = report.matrix[f][i];
    }
    rows.push(row);
  }
  return rowsToCsv(rows);
}
