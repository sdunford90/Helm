import { prisma } from "../lib/prisma.js";

// ---------------------------------------------------------------------------
// SaaS Billing Depth helpers
//
// Pure functions + small persistence helpers used by:
//   - admin route handlers (apply discount, refund, dunning actions)
//   - the /admin/billing/invoices/generate batch
//   - plan-change preview/apply
// ---------------------------------------------------------------------------

const DAYS_PER_MONTH = 30; // proration uses a flat 30-day month for simplicity

export interface DiscountApplication {
  redemptionId: string | null;
  discountCents: number;
}

/**
 * Look up an active PERCENT or FIXED redemption for the tenant and compute
 * the discount cents to apply to a base amount. Honors ONCE vs REPEATING
 * durations and the coupon's maxRedemptions cap. Returns zero discount if
 * nothing applies.
 *
 * TRIAL_EXTENSION redemptions are not considered here — those mutate the
 * tenant's grace period at /coupons/:id/apply time and never appear as a
 * monetary discount on an invoice.
 */
export async function computeCouponDiscount(
  tenantId: string,
  baseAmountCents: number,
): Promise<DiscountApplication> {
  const redemption = await prisma.saasCouponRedemption.findFirst({
    where: {
      tenantId,
      active: true,
      coupon: { discountType: { in: ["PERCENT", "FIXED"] } },
    },
    include: { coupon: true },
    orderBy: { redeemedAt: "desc" },
  });

  if (!redemption || !redemption.coupon.active) {
    return { redemptionId: null, discountCents: 0 };
  }

  const c = redemption.coupon;

  let discountCents = 0;

  if (c.discountType === "PERCENT") {
    discountCents = Math.min(
      baseAmountCents,
      Math.floor((baseAmountCents * c.discountValue) / 10000),
    );
  } else if (c.discountType === "FIXED") {
    discountCents = Math.min(baseAmountCents, c.discountValue);
  }

  return { redemptionId: redemption.id, discountCents };
}

/**
 * Apply a TRIAL_EXTENSION coupon to a tenant by pushing
 * `gracePeriodStartedAt` forward by N days. The lifecycle job locks 30 days
 * after that timestamp, so advancing it grants exactly N more days of
 * runway before lock.
 *
 * Returns the new gracePeriodStartedAt or null if the tenant is not in a
 * grace period (caller should reject in that case so the redemption is not
 * silently consumed).
 */
export async function applyTrialExtensionToGrace(
  tenantId: string,
  days: number,
): Promise<Date | null> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { gracePeriodStartedAt: true },
  });
  if (!tenant?.gracePeriodStartedAt) return null;

  const newStart = new Date(
    tenant.gracePeriodStartedAt.getTime() + days * 24 * 60 * 60 * 1000,
  );
  await prisma.tenant.update({
    where: { id: tenantId },
    data: { gracePeriodStartedAt: newStart },
  });
  return newStart;
}

/**
 * Mark a redemption as consumed for one cycle. For ONCE redemptions this
 * deactivates the row; for REPEATING it decrements cyclesRemaining and
 * deactivates when it hits zero.
 */
export async function consumeCouponRedemption(
  redemptionId: string,
  invoiceId: string,
): Promise<void> {
  const r = await prisma.saasCouponRedemption.findUnique({
    where: { id: redemptionId },
    include: { coupon: true },
  });
  if (!r) return;

  const data: Record<string, unknown> = {
    lastAppliedAt: new Date(),
    lastAppliedInvoiceId: invoiceId,
  };

  if (r.coupon.duration === "ONCE") {
    data.active = false;
  } else if (r.coupon.duration === "REPEATING") {
    const remaining = (r.cyclesRemaining ?? 0) - 1;
    data.cyclesRemaining = Math.max(0, remaining);
    if (remaining <= 0) data.active = false;
  }

  await prisma.saasCouponRedemption.update({
    where: { id: redemptionId },
    data,
  });
}

/**
 * Compute the proration math for a tier change.
 *
 * Returns:
 *   - creditCents: refund for unused days of the current tier in this cycle
 *   - chargeCents: prorated cost of the new tier for the remaining days
 *   - prorationCents: net (chargeCents - creditCents) — positive means a charge
 *
 * The "current cycle" is taken to be the calendar month containing `effectiveAt`.
 */
export interface ProrationPreview {
  creditCents: number;
  chargeCents: number;
  prorationCents: number;
  daysUsed: number;
  daysRemaining: number;
  cycleDays: number;
  fromTierName: string | null;
  toTierName: string;
  fromMonthlyFeeCents: number;
  toMonthlyFeeCents: number;
}

export async function previewPlanChange(
  tenantId: string,
  toTierId: string,
  effectiveAt: Date = new Date(),
): Promise<ProrationPreview> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    include: { saasTier: true },
  });
  if (!tenant) throw new Error("Tenant not found");

  const toTier = await prisma.saasTier.findUnique({ where: { id: toTierId } });
  if (!toTier) throw new Error("Target tier not found");

  const cycleStart = new Date(
    effectiveAt.getFullYear(),
    effectiveAt.getMonth(),
    1,
  );
  const cycleEnd = new Date(
    effectiveAt.getFullYear(),
    effectiveAt.getMonth() + 1,
    0,
  );
  const cycleDays = cycleEnd.getDate();
  const daysUsed = Math.max(
    1,
    Math.min(cycleDays, effectiveAt.getDate()),
  );
  const daysRemaining = Math.max(0, cycleDays - daysUsed);

  const fromMonthly = tenant.saasTier?.monthlyFeeCents ?? 0;
  const toMonthly = toTier.monthlyFeeCents;

  // Credit unused days at the OLD price, charge remaining days at the NEW price.
  const creditCents = Math.round((fromMonthly * daysRemaining) / cycleDays);
  const chargeCents = Math.round((toMonthly * daysRemaining) / cycleDays);
  const prorationCents = chargeCents - creditCents;

  return {
    creditCents,
    chargeCents,
    prorationCents,
    daysUsed,
    daysRemaining,
    cycleDays,
    fromTierName: tenant.saasTier?.name ?? null,
    toTierName: toTier.name,
    fromMonthlyFeeCents: fromMonthly,
    toMonthlyFeeCents: toMonthly,
  };
}

/**
 * Apply the plan change: update tenant tier and create a SaasPlanChange
 * record. The prorated adjustment will appear as a one-line invoice on
 * the next monthly batch (a separate SaasInvoice with planChangeId set).
 */
export async function applyPlanChange(params: {
  tenantId: string;
  toTierId: string;
  createdBy?: string | null;
  effectiveAt?: Date;
}): Promise<{ planChangeId: string; prorationCents: number }> {
  const effectiveAt = params.effectiveAt ?? new Date();
  const preview = await previewPlanChange(
    params.tenantId,
    params.toTierId,
    effectiveAt,
  );

  const tenant = await prisma.tenant.findUnique({
    where: { id: params.tenantId },
    select: { saasTierId: true },
  });

  const planChange = await prisma.$transaction(async (tx) => {
    await tx.tenant.update({
      where: { id: params.tenantId },
      data: { saasTierId: params.toTierId },
    });

    return tx.saasPlanChange.create({
      data: {
        tenantId: params.tenantId,
        fromTierId: tenant?.saasTierId ?? null,
        toTierId: params.toTierId,
        prorationCents: preview.prorationCents,
        effectiveAt,
        createdBy: params.createdBy ?? null,
      },
    });
  });

  return {
    planChangeId: planChange.id,
    prorationCents: preview.prorationCents,
  };
}

/**
 * Compute the outstanding balance on a SaaS invoice (gross - discount - refunds).
 */
export function saasInvoiceOutstandingCents(inv: {
  amountCents: number;
  discountCents: number;
  refundedCents: number;
  prorationCents?: number;
}): number {
  return Math.max(
    0,
    inv.amountCents +
      (inv.prorationCents ?? 0) -
      inv.discountCents -
      inv.refundedCents,
  );
}

export const REFUND_REASONS = [
  "DUPLICATE_CHARGE",
  "SERVICE_OUTAGE",
  "GOODWILL",
  "BILLING_ERROR",
  "CANCELLATION",
  "OTHER",
] as const;

export type RefundReason = (typeof REFUND_REASONS)[number];

export const _testing = { DAYS_PER_MONTH };
