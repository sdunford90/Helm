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

/**
 * Retrieve configured tax rates for a tenant.
 *
 * In a production system these would come from a `tax_rates` table with
 * jurisdiction, category, effective dates, etc.  For now we look for a JSON
 * column on the tenant or fall back to a sensible default.
 */
export async function getTaxRates(
  tenantId: string,
): Promise<{ jurisdiction: string; category: string; rate: number }[]> {
  const rates = await prisma.taxRate.findMany({
    where: { tenantId, active: true },
    orderBy: [{ jurisdiction: "asc" }, { taxClass: "asc" }],
  });

  if (rates.length > 0) {
    return rates.map((r) => ({ jurisdiction: r.jurisdiction, category: r.taxClass, rate: r.rate }));
  }

  // Fallback — no configured rates, everything at 0%
  return [{ jurisdiction: "default", category: "general", rate: DEFAULT_TAX_RATE }];
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
