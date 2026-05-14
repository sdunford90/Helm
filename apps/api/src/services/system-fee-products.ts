import { prisma } from "../lib/prisma.js";
import { isLocationQboConnected } from "./gl-account-resolver.js";

// ---------------------------------------------------------------------------
// System-managed ServiceFee products (Task #353)
//
// Two ServiceFee rows are auto-seeded per location with a system kind:
//   - EARLY_TERMINATION_FEE — defaults to FLAT $0 (operator must edit)
//   - ACH_RETURN_FEE        — defaults to FLAT $25
//
// Operators may edit feeType / amountCents / pct / glAccountId / taxClass
// on these rows, but they cannot rename, change kind, change location,
// or delete them. The DB enforces at-most-one of each system kind per
// location via a partial unique index declared in
// 20260514000000_service_fee_kinds_replace_pins.
// ---------------------------------------------------------------------------

type PrismaLike = typeof prisma;
type TxClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

export const SYSTEM_FEE_NAMES = {
  EARLY_TERMINATION_FEE: "Early Termination Fee",
  ACH_RETURN_FEE: "ACH Return Fee",
} as const;

export const SYSTEM_FEE_DEFAULTS: Array<{
  kind: "EARLY_TERMINATION_FEE" | "ACH_RETURN_FEE";
  name: string;
  amountCents: number;
}> = [
  { kind: "EARLY_TERMINATION_FEE", name: SYSTEM_FEE_NAMES.EARLY_TERMINATION_FEE, amountCents: 0 },
  { kind: "ACH_RETURN_FEE",        name: SYSTEM_FEE_NAMES.ACH_RETURN_FEE,        amountCents: 2500 },
];

/**
 * Idempotently seed the per-location system fee products for a single
 * location. Safe to call from provisioning paths and backfills — the
 * partial unique `(locationId, kind)` index ensures we never create
 * duplicates.
 */
export async function seedSystemFeeProducts(
  prismaLike: PrismaLike | TxClient,
  tenantId: string,
  locationId: string,
): Promise<{ created: number }> {
  const db = prismaLike as PrismaLike;
  const existing = await db.serviceFee.findMany({
    where: { tenantId, locationId, kind: { not: "STANDARD" } },
    select: { kind: true },
  });
  const existingKinds = new Set(existing.map((r) => r.kind));
  const toCreate = SYSTEM_FEE_DEFAULTS.filter((d) => !existingKinds.has(d.kind));
  if (toCreate.length === 0) return { created: 0 };

  for (const def of toCreate) {
    await db.serviceFee.create({
      data: {
        tenantId,
        locationId,
        name: def.name,
        feeType: "FLAT",
        amountCents: def.amountCents,
        pct: null,
        taxClass: "Tax Exempt",
        active: true,
        kind: def.kind,
      },
    });
  }
  return { created: toCreate.length };
}

export interface ResolvedSystemFee {
  serviceFeeId: string;
  feeType: "FLAT" | "PERCENT";
  amountCents: number | null;
  pct: number | null;
  taxClass: string | null;
  /** GL account resolved through ServiceFeeGlMapping → ServiceFee.glAccountId.
   *  Null when the operator hasn't mapped one yet — callers MUST enforce
   *  via `assertSystemFeeGlAccountId()` before posting a non-zero leg. */
  glAccountId: string | null;
}

/**
 * Look up the per-location system ServiceFee for a given kind. Always
 * returns the fee row (self-heals by seeding if missing) so callers can
 * read the amount even when GL isn't configured yet — critical because
 * a $0 default penalty must not be blocked by a missing GL mapping.
 *
 * GL resolution (mapping → row fallback) is best-effort: on QBO-
 * connected locations we never chart-walk, so we return `glAccountId:
 * null` instead of throwing. Callers post the GL-bearing leg only when
 * the resolved amount > 0 and are expected to call
 * `assertSystemFeeGlAccountId()` at that point to surface an actionable
 * UNCONFIGURED_GL_MAPPING error.
 */
export async function resolveSystemFeeProduct(
  tenantId: string,
  locationId: string,
  kind: "EARLY_TERMINATION_FEE" | "ACH_RETURN_FEE",
  context: string,
  tx?: TxClient,
): Promise<ResolvedSystemFee> {
  const db = (tx ?? prisma) as PrismaLike;
  let fee = await db.serviceFee.findFirst({
    where: { tenantId, locationId, kind },
    select: {
      id: true, feeType: true, amountCents: true, pct: true, taxClass: true,
      glAccountId: true,
    },
  });
  // Self-heal: if a tenant somehow has no system fee for this kind (e.g.
  // location created before the backfill ran on a stale clone), seed it
  // now so the caller doesn't fail with a hard error mid-flow.
  if (!fee) {
    await seedSystemFeeProducts(db, tenantId, locationId);
    fee = await db.serviceFee.findFirst({
      where: { tenantId, locationId, kind },
      select: {
        id: true, feeType: true, amountCents: true, pct: true, taxClass: true,
        glAccountId: true,
      },
    });
  }
  if (!fee) {
    throw new Error(
      `UNCONFIGURED_SYSTEM_FEE: failed to seed ${kind} fee at location ${locationId} (${context}).`,
    );
  }

  // Mapping → row fallback for the GL account, *without* a chart-walk
  // on QBO-connected locations. Null is allowed; the caller decides
  // whether the missing GL is a real problem (i.e. amount > 0).
  const mapping = await db.serviceFeeGlMapping.findFirst({
    where: { tenantId, locationId, serviceFeeId: fee.id },
    select: { glAccountId: true },
  });
  let resolvedGlId: string | null = mapping?.glAccountId ?? null;
  if (!resolvedGlId && !(await isLocationQboConnected(locationId))) {
    // Non-QBO locations may rely on the row's own glAccountId fallback.
    resolvedGlId = fee.glAccountId;
  }

  return {
    serviceFeeId: fee.id,
    feeType: fee.feeType as "FLAT" | "PERCENT",
    amountCents: fee.amountCents,
    pct: fee.pct,
    taxClass: fee.taxClass,
    glAccountId: resolvedGlId,
  };
}

/**
 * Enforce that a resolved system fee has a GL account mapped. Throws an
 * operator-friendly UNCONFIGURED_GL_MAPPING error pointing at Settings
 * → Products. Call this only when you're about to post a non-zero leg
 * — a zero-amount fee never needs a GL account.
 */
export function assertSystemFeeGlAccountId(
  fee: ResolvedSystemFee,
  kind: "EARLY_TERMINATION_FEE" | "ACH_RETURN_FEE",
  locationId: string,
  context: string,
): string {
  if (fee.glAccountId) return fee.glAccountId;
  const label = kind === "EARLY_TERMINATION_FEE"
    ? "Early Termination Fee"
    : "ACH Return Fee";
  throw new Error(
    `UNCONFIGURED_GL_MAPPING: ${label} at location ${locationId} has no GL ` +
    `account mapped (${context}). Set the GL account on the system fee in ` +
    `Settings → Products.`,
  );
}

/**
 * Compute the early-termination penalty in cents from a system fee product.
 * Used as the fallback when a contract has no `earlyTerminationType`/Value
 * override of its own. PERCENT means percent of the contract's monthly rate.
 */
export function computeSystemEarlyTerminationPenaltyCents(
  fee: Pick<ResolvedSystemFee, "feeType" | "amountCents" | "pct">,
  contractRateCents: number,
): number {
  if (fee.feeType === "FLAT") return Math.max(0, fee.amountCents ?? 0);
  if (fee.feeType === "PERCENT") {
    const pct = fee.pct ?? 0;
    return Math.max(0, Math.round((pct / 100) * contractRateCents));
  }
  return 0;
}
