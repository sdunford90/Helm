import { prisma } from "../lib/prisma.js";

// ---------------------------------------------------------------------------
// Sales Tax Engine
//
// Tax rates are stored per-tenant in the gl_accounts / tenant config.  Until a
// dedicated TaxRate model is added we store rates in a JSON config column or
// use a lightweight in-memory lookup seeded from the database.  This module
// provides the public API that invoice creation calls.
// ---------------------------------------------------------------------------

export interface TaxLineItem {
  description: string;
  amountCents: number;
  /** Tax category / class — e.g. "slip_rental", "electricity", "general" */
  taxCategory?: string;
}

export interface TaxBreakdown {
  taxableAmountCents: number;
  taxRate: number;
  taxCents: number;
  jurisdiction: string;
  category: string;
}

export interface TaxResult {
  /** Total tax across all line items */
  totalTaxCents: number;
  /** Per-item breakdown */
  items: {
    description: string;
    taxRate: number;
    taxCents: number;
    breakdowns: TaxBreakdown[];
  }[];
}

// Default tax rate when no tenant-specific config is found (0%)
const DEFAULT_TAX_RATE = 0;

export interface TaxRateConfig {
  jurisdiction: string;
  category: string;
  /** Fraction, e.g. 0.07 for 7%. */
  rate: number;
}

/**
 * Convert a configured PERCENT (0-100, as saved by PUT /api/settings/billing
 * into `invoiceTemplateJson.taxRate`) to a fraction. Invalid, negative or
 * >100 values are rejected (returns null) rather than guessed.
 */
export function percentToFraction(percent: unknown): number | null {
  const n = typeof percent === "string" ? Number(percent) : percent;
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > 100) return null;
  return n / 100;
}

/**
 * Normalise a rate from the legacy `taxRates[]` array, which is documented as
 * a fraction. A value > 1 can only be a percentage typed by hand (e.g. 7
 * meaning 7%); treating it as a fraction would tax at 700%. Such values are
 * converted from percent, with a warning. Anything invalid returns null.
 */
export function normalizeFractionalRate(rate: unknown): number | null {
  const n = typeof rate === "string" ? Number(rate) : rate;
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0) return null;
  if (n > 1) {
    console.warn(
      `[tax-engine] taxRates[].rate=${n} is > 1; treating it as a percentage (${n}%), not a fraction`,
    );
    return percentToFraction(n);
  }
  return n;
}

/**
 * Resolve tax rates from a tenant's invoiceTemplateJson.
 *
 * Source of truth is `taxRate` (PERCENT) written by routes/settings.ts
 * (PUT /api/settings/billing). It becomes the "general" rate. An optional
 * legacy `taxRates[]` array can still add per-category overrides.
 */
export function resolveTaxRates(invoiceTemplateJson: unknown): TaxRateConfig[] {
  const cfg =
    invoiceTemplateJson && typeof invoiceTemplateJson === "object" && !Array.isArray(invoiceTemplateJson)
      ? (invoiceTemplateJson as Record<string, unknown>)
      : {};

  const rates: TaxRateConfig[] = [];

  if (Array.isArray(cfg.taxRates)) {
    for (const raw of cfg.taxRates as unknown[]) {
      if (!raw || typeof raw !== "object") continue;
      const r = raw as Record<string, unknown>;
      const rate = normalizeFractionalRate(r.rate);
      if (rate === null) continue;
      rates.push({
        jurisdiction: typeof r.jurisdiction === "string" ? r.jurisdiction : "default",
        category: typeof r.category === "string" ? r.category : "general",
        rate,
      });
    }
  }

  // The settings value is the general rate and takes precedence over any
  // legacy "general" entry.
  const general = cfg.taxRate === undefined ? null : percentToFraction(cfg.taxRate);
  if (cfg.taxRate !== undefined && general === null) {
    console.warn(`[tax-engine] Ignoring invalid taxRate setting: ${String(cfg.taxRate)}`);
  }
  if (general !== null) {
    const withoutGeneral = rates.filter((r) => r.category !== "general");
    return [{ jurisdiction: "default", category: "general", rate: general }, ...withoutGeneral];
  }

  if (rates.length > 0) return rates;

  // Fallback — no configured rates, everything at 0%
  return [{ jurisdiction: "default", category: "general", rate: DEFAULT_TAX_RATE }];
}

/**
 * Retrieve configured tax rates for a tenant (rates are fractions).
 *
 * TODO(F-TAX-1): replace with a real TaxRate model (jurisdiction, category,
 * effective dates) shared by invoices and POS.
 */
export async function getTaxRates(tenantId: string): Promise<TaxRateConfig[]> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { invoiceTemplateJson: true },
  });
  return resolveTaxRates(tenant?.invoiceTemplateJson);
}

/**
 * Check whether a customer is tax-exempt and that the exemption has not expired.
 */
export async function checkTaxExempt(
  customerId: string,
  tenantId: string,
): Promise<boolean> {
  const customer = await prisma.customer.findFirst({
    where: { id: customerId, tenantId },
    select: { taxExempt: true, exemptionExpiry: true },
  });

  if (!customer) return false;
  if (!customer.taxExempt) return false;

  // If there is an expiry date and it has passed, the exemption is invalid
  if (customer.exemptionExpiry && customer.exemptionExpiry < new Date()) {
    return false;
  }

  return true;
}

/**
 * Calculate tax for a set of line items.
 *
 * @param tenantId   - tenant scope
 * @param customerId - used for exemption check
 * @param lineItems  - items to tax
 */
export async function calculateTax(
  tenantId: string,
  customerId: string,
  lineItems: TaxLineItem[],
): Promise<TaxResult> {
  const isExempt = await checkTaxExempt(customerId, tenantId);

  if (isExempt) {
    return {
      totalTaxCents: 0,
      items: lineItems.map((li) => ({
        description: li.description,
        taxRate: 0,
        taxCents: 0,
        breakdowns: [],
      })),
    };
  }

  const rates = await getTaxRates(tenantId);

  let totalTaxCents = 0;

  const items = lineItems.map((li) => {
    const category = li.taxCategory ?? "general";

    // Find matching rate — prefer category match, fall back to "general"
    const matchingRate =
      rates.find((r) => r.category === category) ??
      rates.find((r) => r.category === "general") ??
      rates[0];

    const rate = matchingRate?.rate ?? 0;
    const taxCents = Math.round(li.amountCents * rate);
    totalTaxCents += taxCents;

    const breakdowns: TaxBreakdown[] =
      rate > 0
        ? [
            {
              taxableAmountCents: li.amountCents,
              taxRate: rate,
              taxCents,
              jurisdiction: matchingRate?.jurisdiction ?? "default",
              category,
            },
          ]
        : [];

    return {
      description: li.description,
      taxRate: rate,
      taxCents,
      breakdowns,
    };
  });

  return { totalTaxCents, items };
}
