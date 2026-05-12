// A6 — Feature flag registry + resolver.
//
// Defaults live here in code so the registry is a single source of truth that
// type-checks against the rest of the codebase. Per-tenant overrides are
// stored in FeatureFlagOverride and only differ from defaults when an
// admin has explicitly toggled them.

import { prisma } from "../lib/prisma.js";

export interface FeatureFlag {
  key: string;
  label: string;
  description: string;
  defaultEnabled: boolean;
  category: "Reporting" | "Communications" | "Beta" | "Billing" | "Ops";
}

export const FEATURE_FLAGS: FeatureFlag[] = [
  {
    key: "insights.ai-builder",
    label: "AI report builder",
    description: "Natural-language → ReportSpec on the Custom Builder.",
    defaultEnabled: false,
    category: "Beta",
  },
  {
    key: "insights.custom-builder",
    label: "Custom report builder",
    description: "The full Universal Report Builder UI on /insights/custom-builder.",
    defaultEnabled: true,
    category: "Reporting",
  },
  {
    key: "comms.two-way-sms",
    label: "Two-way SMS conversations",
    description: "Inbound Twilio webhooks and a staff SMS inbox.",
    defaultEnabled: false,
    category: "Communications",
  },
  {
    key: "comms.drip-campaigns",
    label: "Drip / sequence campaigns",
    description: "Multi-step email + SMS sequences beyond single rules.",
    defaultEnabled: false,
    category: "Communications",
  },
  {
    key: "billing.autopay-self-serve",
    label: "Customer autopay self-service",
    description: "Portal /billing/autopay page (P10).",
    defaultEnabled: true,
    category: "Billing",
  },
  {
    key: "ops.work-orders",
    label: "Service / work-order system",
    description: "Daily Ops → Work Orders.",
    defaultEnabled: false,
    category: "Beta",
  },
  {
    key: "ops.cash-drawer-shifts",
    label: "POS cash drawer / shift management",
    description: "Open/close shifts with over/short reporting.",
    defaultEnabled: false,
    category: "Ops",
  },
  {
    key: "platform.tenant-webhooks",
    label: "Tenant outbound webhooks",
    description: "Per-tenant webhook destinations (A8).",
    defaultEnabled: false,
    category: "Beta",
  },
];

const FLAGS_BY_KEY = new Map(FEATURE_FLAGS.map((f) => [f.key, f]));

export interface ResolvedFlag {
  key: string;
  label: string;
  description: string;
  category: FeatureFlag["category"];
  defaultEnabled: boolean;
  enabled: boolean;             // effective: override if set, otherwise default
  hasOverride: boolean;
  overrideReason?: string | null;
  overrideUpdatedAt?: Date | null;
  overrideUpdatedBy?: string | null;
}

/**
 * Resolve every flag for a tenant. Always returns the full registry —
 * tenants who have no overrides still get a complete list keyed by the
 * defaults.
 */
export async function resolveTenantFlags(tenantId: string): Promise<ResolvedFlag[]> {
  const overrides = await prisma.featureFlagOverride.findMany({
    where: { tenantId },
  });
  const overrideByKey = new Map(overrides.map((o) => [o.flag, o]));

  return FEATURE_FLAGS.map((f) => {
    const o = overrideByKey.get(f.key);
    return {
      key: f.key,
      label: f.label,
      description: f.description,
      category: f.category,
      defaultEnabled: f.defaultEnabled,
      enabled: o ? o.enabled : f.defaultEnabled,
      hasOverride: !!o,
      overrideReason: o?.reason ?? null,
      overrideUpdatedAt: o?.updatedAt ?? null,
      overrideUpdatedBy: o?.updatedBy ?? null,
    };
  });
}

/**
 * One-flag boolean lookup used by gated endpoints / pages. Cheap path —
 * single findUnique against the (tenantId, flag) unique key.
 */
export async function tenantHasFlag(tenantId: string, flag: string): Promise<boolean> {
  const def = FLAGS_BY_KEY.get(flag);
  if (!def) return false; // unknown flag — fail closed
  const o = await prisma.featureFlagOverride.findUnique({
    where: { tenantId_flag: { tenantId, flag } },
  });
  return o ? o.enabled : def.defaultEnabled;
}

/**
 * Upsert one flag for one tenant. Returns the resolved row.
 */
export async function setTenantFlag(args: {
  tenantId: string;
  flag: string;
  enabled: boolean;
  reason?: string | null;
  updatedBy: string | null;
}): Promise<ResolvedFlag> {
  const def = FLAGS_BY_KEY.get(args.flag);
  if (!def) {
    throw new Error(`Unknown feature flag: ${args.flag}`);
  }
  await prisma.featureFlagOverride.upsert({
    where: { tenantId_flag: { tenantId: args.tenantId, flag: args.flag } },
    create: {
      tenantId: args.tenantId,
      flag: args.flag,
      enabled: args.enabled,
      reason: args.reason ?? null,
      updatedBy: args.updatedBy,
    },
    update: {
      enabled: args.enabled,
      reason: args.reason ?? null,
      updatedBy: args.updatedBy,
    },
  });
  const resolved = await resolveTenantFlags(args.tenantId);
  return resolved.find((r) => r.key === args.flag)!;
}

/**
 * Remove a per-tenant override (the flag returns to its default).
 */
export async function clearTenantFlag(tenantId: string, flag: string): Promise<void> {
  await prisma.featureFlagOverride.deleteMany({
    where: { tenantId, flag },
  });
}
