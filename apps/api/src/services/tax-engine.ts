import { prisma } from "../lib/prisma.js";

// ---------------------------------------------------------------------------
// Multi-Jurisdiction Sales Tax Engine
//
// Tax rates live in TaxJurisdiction / TaxRate / LocationTaxJurisdiction tables.
// A Location carries a stack of jurisdictions ordered by sortOrder.  Each line
// item is taxed additively across every jurisdiction in the stack.
//
// Basis-point storage: 600 bps = 6.00%.  Integer arithmetic throughout.
// ---------------------------------------------------------------------------

export interface TaxLineItem {
  id?: string;
  description: string;
  amountCents: number;
  taxCategory?: string;
}

export interface TaxBreakdown {
  jurisdictionId: string;
  jurisdictionCode: string;
  jurisdictionName: string;
  kind: string;
  ratePctBps: number;
  taxableAmountCents: number;
  taxCents: number;
  glAccountId: string | null;
  taxRate: number;
  jurisdiction: string;
  category: string;
}

export interface TaxResultItem {
  description: string;
  taxRate: number;
  taxCents: number;
  breakdowns: TaxBreakdown[];
}

export interface TaxResult {
  totalTaxCents: number;
  items: TaxResultItem[];
}

const DEFAULT_TAX_RESULT = (lineItems: TaxLineItem[]): TaxResult => ({
  totalTaxCents: 0,
  items: lineItems.map((li) => ({
    description: li.description,
    taxRate: 0,
    taxCents: 0,
    breakdowns: [],
  })),
});

export async function checkTaxExempt(
  customerId: string,
  tenantId: string,
): Promise<boolean> {
  const customer = await prisma.customer.findFirst({
    where: { id: customerId, tenantId },
    select: { taxExempt: true, exemptionExpiry: true },
  });

  if (!customer?.taxExempt) return false;
  if (customer.exemptionExpiry && customer.exemptionExpiry < new Date()) return false;
  return true;
}

/**
 * Calculate tax for a set of line items using the jurisdiction stack
 * assigned to the given Location.
 *
 * Falls back gracefully to 0% when no location or no rates are configured.
 */
export async function calculateTax(params: {
  tenantId: string;
  locationId?: string | null;
  customerId: string;
  asOfDate?: Date;
  lineItems: TaxLineItem[];
}): Promise<TaxResult>;

/** Legacy 3-argument overload for backwards-compat with billing.ts callers. */
export async function calculateTax(
  tenantId: string,
  customerId: string,
  lineItems: TaxLineItem[],
): Promise<TaxResult>;

export async function calculateTax(
  paramsOrTenantId:
    | {
        tenantId: string;
        locationId?: string | null;
        customerId: string;
        asOfDate?: Date;
        lineItems: TaxLineItem[];
      }
    | string,
  customerId?: string,
  lineItems?: TaxLineItem[],
): Promise<TaxResult> {
  let tenantId: string;
  let locationId: string | null | undefined;
  let resolvedCustomerId: string;
  let resolvedLineItems: TaxLineItem[];
  let asOfDate: Date;

  if (typeof paramsOrTenantId === "string") {
    tenantId = paramsOrTenantId;
    resolvedCustomerId = customerId!;
    resolvedLineItems = lineItems!;
    locationId = null;
    asOfDate = new Date();
  } else {
    tenantId = paramsOrTenantId.tenantId;
    locationId = paramsOrTenantId.locationId;
    resolvedCustomerId = paramsOrTenantId.customerId;
    resolvedLineItems = paramsOrTenantId.lineItems;
    asOfDate = paramsOrTenantId.asOfDate ?? new Date();
  }

  if (!resolvedLineItems.length) return DEFAULT_TAX_RESULT(resolvedLineItems);

  const isExempt = await checkTaxExempt(resolvedCustomerId, tenantId);
  if (isExempt) return DEFAULT_TAX_RESULT(resolvedLineItems);

  // Load jurisdiction stack for the location, ordered by sortOrder
  const locationLinks = locationId
    ? await prisma.locationTaxJurisdiction.findMany({
        where: { locationId, tenantId },
        orderBy: { sortOrder: "asc" },
        include: {
          jurisdiction: {
            include: {
              rates: {
                where: {
                  tenantId,
                  effectiveFrom: { lte: asOfDate },
                  OR: [
                    { effectiveTo: null },
                    { effectiveTo: { gt: asOfDate } },
                  ],
                },
              },
            },
          },
        },
      })
    : [];

  if (!locationLinks.length) return DEFAULT_TAX_RESULT(resolvedLineItems);

  let totalTaxCents = 0;

  const items: TaxResultItem[] = resolvedLineItems.map((li) => {
    const category = li.taxCategory ?? "general";
    const breakdowns: TaxBreakdown[] = [];

    for (const link of locationLinks) {
      const { jurisdiction } = link;
      const rates = jurisdiction.rates;

      // Prefer exact category match, fall back to "general"
      const rate =
        rates.find((r) => r.category === category) ??
        rates.find((r) => r.category === "general");

      if (!rate || rate.ratePctBps === 0) continue;

      const taxCents = Math.round((li.amountCents * rate.ratePctBps) / 10_000);

      breakdowns.push({
        jurisdictionId: jurisdiction.id,
        jurisdictionCode: jurisdiction.code,
        jurisdictionName: jurisdiction.name,
        kind: jurisdiction.kind,
        ratePctBps: rate.ratePctBps,
        taxableAmountCents: li.amountCents,
        taxCents,
        glAccountId: rate.glAccountId,
        taxRate: rate.ratePctBps / 10_000,
        jurisdiction: jurisdiction.code,
        category,
      });
    }

    const itemTaxCents = breakdowns.reduce((s, b) => s + b.taxCents, 0);
    const totalBps = breakdowns.reduce((s, b) => s + b.ratePctBps, 0);
    totalTaxCents += itemTaxCents;

    return {
      description: li.description,
      taxRate: totalBps / 10_000,
      taxCents: itemTaxCents,
      breakdowns,
    };
  });

  return { totalTaxCents, items };
}

/** Legacy helper — kept for any callers that still use it. */
export async function getTaxRates(
  tenantId: string,
): Promise<{ jurisdiction: string; category: string; rate: number }[]> {
  return [];
}
