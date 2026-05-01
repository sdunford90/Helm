import { prisma } from "../lib/prisma.js";
import { TaxProvider } from "@prisma/client";

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

// ---------------------------------------------------------------------------
// Provider interface — every tax engine implementation must satisfy this.
// ---------------------------------------------------------------------------

export interface TaxEngineProvider {
  calculateTax(params: {
    locationId: string;
    tenantId: string;
    lineItems: TaxLineItem[];
    customerExempt: boolean;
    transactionDate?: Date;
  }): Promise<TaxResult>;
}

// ---------------------------------------------------------------------------
// InternalTaxProvider — the existing multi-jurisdiction engine.
// ---------------------------------------------------------------------------

class InternalTaxProvider implements TaxEngineProvider {
  async calculateTax(params: {
    locationId: string;
    tenantId: string;
    lineItems: TaxLineItem[];
    customerExempt: boolean;
    transactionDate?: Date;
  }): Promise<TaxResult> {
    const { locationId, tenantId, lineItems, customerExempt, transactionDate } = params;
    const asOfDate = transactionDate ?? new Date();

    if (!lineItems.length) return DEFAULT_TAX_RESULT(lineItems);

    if (customerExempt) return DEFAULT_TAX_RESULT(lineItems);

    // Load jurisdiction stack for the location, ordered by sortOrder
    const locationLinks = await prisma.locationTaxJurisdiction.findMany({
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
    });

    if (!locationLinks.length) return DEFAULT_TAX_RESULT(lineItems);

    let totalTaxCents = 0;

    const items: TaxResultItem[] = lineItems.map((li) => {
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
}

// ---------------------------------------------------------------------------
// Stub providers — throw descriptive errors until the integration is wired up.
// ---------------------------------------------------------------------------

class AvalaraTaxProvider implements TaxEngineProvider {
  async calculateTax(): Promise<TaxResult> {
    throw new Error(
      "Avalara integration not yet configured. Contact support to enable.",
    );
  }
}

class TaxJarProvider implements TaxEngineProvider {
  async calculateTax(): Promise<TaxResult> {
    throw new Error(
      "TaxJar integration not yet configured. Contact support to enable.",
    );
  }
}

// ---------------------------------------------------------------------------
// Factory — callers resolve the correct provider from Location.taxProvider.
// ---------------------------------------------------------------------------

export function getTaxProvider(
  taxProvider?: TaxProvider | null,
): TaxEngineProvider {
  switch (taxProvider) {
    case "AVALARA":
      return new AvalaraTaxProvider();
    case "TAXJAR":
      return new TaxJarProvider();
    default:
      return new InternalTaxProvider();
  }
}

// ---------------------------------------------------------------------------
// BACKWARD COMPATIBILITY: The original calculateTax export is preserved as a
// shim so existing callers don't break.  New code should use getTaxProvider()
// instead so the correct provider is selected per-location.
// ---------------------------------------------------------------------------

/**
 * Calculate tax for a set of line items using the jurisdiction stack
 * assigned to the given Location.
 *
 * Falls back gracefully to 0% when no location or no rates are configured.
 */
export async function calculateTax(params: {
  tenantId: string;
  locationId?: string | null;
  // customerId is optional: anonymous POS sales still owe tax based on the
  // location's jurisdiction stack. When absent we simply skip the customer
  // exempt-check below.
  customerId?: string | null;
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
        customerId?: string | null;
        asOfDate?: Date;
        lineItems: TaxLineItem[];
      }
    | string,
  customerId?: string,
  lineItems?: TaxLineItem[],
): Promise<TaxResult> {
  let tenantId: string;
  let locationId: string | null | undefined;
  let resolvedCustomerId: string | null | undefined;
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

  // Customer-level exempt status only applies when a customer was supplied.
  // Anonymous POS sales fall through to the location jurisdiction stack.
  let customerExempt = false;
  if (resolvedCustomerId) {
    customerExempt = await checkTaxExempt(resolvedCustomerId, tenantId);
    if (customerExempt) return DEFAULT_TAX_RESULT(resolvedLineItems);
  }

  // No locationId → no jurisdiction stack → zero tax.
  if (!locationId) return DEFAULT_TAX_RESULT(resolvedLineItems);

  return new InternalTaxProvider().calculateTax({
    locationId,
    tenantId,
    lineItems: resolvedLineItems,
    customerExempt,
    transactionDate: asOfDate,
  });
}

/** Legacy helper — returns all currently-active tax rates for the tenant. */
export async function getTaxRates(
  tenantId: string,
): Promise<{ jurisdiction: string; category: string; rate: number }[]> {
  const now = new Date();
  const rates = await prisma.taxRate.findMany({
    where: {
      tenantId,
      effectiveFrom: { lte: now },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
    },
    include: { jurisdiction: { select: { name: true } } },
  });
  return rates.map((r) => ({
    jurisdiction: r.jurisdiction.name,
    category: r.category,
    rate: r.ratePctBps / 10_000,
  }));
}
