// Plan 6 — Unified resolver for "where does revenue from this sellable thing
// post in the GL?"
//
// Replaces the scattered resolution chains across pos.ts / contracts.ts /
// transient.ts / etc. with a single function callers can ask for an
// answer. The resolver walks four layers and stops at the first hit:
//
//   1. Per-instance mapping table (ProductCategoryGlMapping,
//      DockageRateGlMapping, RentalProductGlMapping, ServiceFeeGlMapping).
//   2. Per-location revenue-kind pin (Location.transientRevenueGlAccountId,
//      rampRevenueGlAccountId, conciergeRevenueGlAccountId,
//      fuelRevenueGlAccountId, electricityRevenueGlAccountId).
//   3. Per-location default revenue pin (Location.defaultRevenueGlAccountId).
//   4. Tenant chart fallback — first REVENUE account by number (only fires
//      for non-QBO tenants; QBO-connected ones throw).
//
// `inventoryAssetGlAccountId` and `cogsGlAccountId` are only returned for
// inventory-tracked kinds (PRODUCT). The other kinds don't carry inventory.

import { prisma } from "../lib/prisma.js";

export type SellableKind =
  | "PRODUCT"
  | "RENTAL"
  | "DOCKAGE"
  | "SERVICE_FEE"
  | "TRANSIENT"
  | "RAMP"
  | "CONCIERGE"
  | "FUEL"
  | "ELECTRICITY";

export interface SellableGlAccounts {
  revenueGlAccountId: string;
  cogsGlAccountId: string | null;
  inventoryAssetGlAccountId: string | null;
  deferredRevenueGlAccountId: string | null;
  /** Which step of the resolution chain produced the revenue account. */
  source: "instance-mapping" | "location-kind-pin" | "location-default" | "tenant-chart-fallback";
}

export interface ResolveArgs {
  tenantId: string;
  locationId: string | null;
  kind: SellableKind;
  /** For PRODUCT: the Product.id (used to look up its category mapping). */
  productId?: string;
  /** For DOCKAGE: the DockageRate.id. */
  dockageRateId?: string;
  /** For RENTAL: the RentalProduct.id. */
  rentalProductId?: string;
  /** For SERVICE_FEE: the ServiceFee.id. */
  serviceFeeId?: string;
}

const LOCATION_PIN_BY_KIND: Record<SellableKind, keyof {
  transientRevenueGlAccountId: string | null;
  rampRevenueGlAccountId: string | null;
  conciergeRevenueGlAccountId: string | null;
  fuelRevenueGlAccountId: string | null;
  electricityRevenueGlAccountId: string | null;
  defaultRevenueGlAccountId: string | null;
} | null> = {
  PRODUCT: null, // covered by per-category mapping
  RENTAL: null,  // covered by per-product mapping
  DOCKAGE: null, // covered by per-rate mapping
  SERVICE_FEE: null, // covered by per-fee mapping
  TRANSIENT:   "transientRevenueGlAccountId",
  RAMP:        "rampRevenueGlAccountId",
  CONCIERGE:   "conciergeRevenueGlAccountId",
  FUEL:        "fuelRevenueGlAccountId",
  ELECTRICITY: "electricityRevenueGlAccountId",
};

export class MissingSellableMappingError extends Error {
  constructor(public kind: SellableKind, public locationId: string | null, public detail: string) {
    super(`MISSING_GL_MAPPING: ${kind} at location ${locationId ?? "(tenant-wide)"} — ${detail}`);
  }
}

export async function resolveSellableGlAccounts(args: ResolveArgs): Promise<SellableGlAccounts> {
  const { tenantId, locationId, kind } = args;

  // Layer 1 — per-instance mapping for the four kinds that have one.
  if (kind === "PRODUCT" && args.productId && locationId) {
    const product = await prisma.product.findUnique({
      where: { id: args.productId },
      select: { productCategoryId: true },
    });
    if (product?.productCategoryId) {
      const m = await prisma.productCategoryGlMapping.findFirst({
        where: { productCategoryId: product.productCategoryId, locationId },
        select: { revenueGlAccountId: true, cogsGlAccountId: true, inventoryAssetGlAccountId: true },
      });
      if (m?.revenueGlAccountId) {
        return {
          revenueGlAccountId: m.revenueGlAccountId,
          cogsGlAccountId: m.cogsGlAccountId ?? null,
          inventoryAssetGlAccountId: m.inventoryAssetGlAccountId ?? null,
          deferredRevenueGlAccountId: null,
          source: "instance-mapping",
        };
      }
    }
  } else if (kind === "RENTAL" && args.rentalProductId && locationId) {
    const m = await prisma.rentalProductGlMapping.findFirst({
      where: { rentalProductId: args.rentalProductId, locationId },
      select: { revenueGlAccountId: true },
    });
    if (m?.revenueGlAccountId) {
      return {
        revenueGlAccountId: m.revenueGlAccountId,
        cogsGlAccountId: null,
        inventoryAssetGlAccountId: null,
        deferredRevenueGlAccountId: null,
        source: "instance-mapping",
      };
    }
  } else if (kind === "DOCKAGE" && args.dockageRateId && locationId) {
    // DockageRateGlMapping uses `glAccountId` (revenue-only) — the column
    // name predates the multi-account mapping convention used by Product.
    const m = await prisma.dockageRateGlMapping.findFirst({
      where: { dockageRateId: args.dockageRateId, locationId },
      select: { glAccountId: true },
    });
    if (m?.glAccountId) {
      return {
        revenueGlAccountId: m.glAccountId,
        cogsGlAccountId: null,
        inventoryAssetGlAccountId: null,
        deferredRevenueGlAccountId: null,
        source: "instance-mapping",
      };
    }
  } else if (kind === "SERVICE_FEE" && args.serviceFeeId && locationId) {
    const m = await prisma.serviceFeeGlMapping.findFirst({
      where: { serviceFeeId: args.serviceFeeId, locationId },
      select: { glAccountId: true },
    });
    if (m?.glAccountId) {
      return {
        revenueGlAccountId: m.glAccountId,
        cogsGlAccountId: null,
        inventoryAssetGlAccountId: null,
        deferredRevenueGlAccountId: null,
        source: "instance-mapping",
      };
    }
  }

  // Layer 2 — per-location revenue-kind pin for kinds that have one.
  const pinField = LOCATION_PIN_BY_KIND[kind];
  if (locationId) {
    const loc = await prisma.location.findUnique({
      where: { id: locationId },
      select: {
        qboRealmId: true,
        defaultRevenueGlAccountId: true,
        deferredRevenueGlAccountId: true,
        transientRevenueGlAccountId: true,
        rampRevenueGlAccountId: true,
        conciergeRevenueGlAccountId: true,
        fuelRevenueGlAccountId: true,
        electricityRevenueGlAccountId: true,
      },
    });

    if (pinField) {
      const pinned = (loc as Record<string, string | null> | null)?.[pinField] ?? null;
      if (pinned) {
        return {
          revenueGlAccountId: pinned,
          cogsGlAccountId: null,
          inventoryAssetGlAccountId: null,
          deferredRevenueGlAccountId: loc?.deferredRevenueGlAccountId ?? null,
          source: "location-kind-pin",
        };
      }
    }

    // Layer 3 — per-location default revenue pin.
    if (loc?.defaultRevenueGlAccountId) {
      return {
        revenueGlAccountId: loc.defaultRevenueGlAccountId,
        cogsGlAccountId: null,
        inventoryAssetGlAccountId: null,
        deferredRevenueGlAccountId: loc.deferredRevenueGlAccountId ?? null,
        source: "location-default",
      };
    }

    // QBO-connected locations: no fallback. Make the operator pin a value.
    if (loc?.qboRealmId) {
      throw new MissingSellableMappingError(
        kind,
        locationId,
        `set defaultRevenueGlAccountId on this location, or pin a revenue account for ${kind}.`,
      );
    }
  }

  // Layer 4 — non-QBO tenant chart fallback. First REVENUE account by number.
  const fallback = await prisma.glAccount.findFirst({
    where: { tenantId, type: "REVENUE", active: true, isActive: true },
    orderBy: { accountNumber: "asc" },
    select: { id: true },
  });
  if (!fallback) {
    throw new MissingSellableMappingError(
      kind,
      locationId,
      `no REVENUE accounts in the tenant chart. Add one in Settings → Chart of Accounts.`,
    );
  }
  return {
    revenueGlAccountId: fallback.id,
    cogsGlAccountId: null,
    inventoryAssetGlAccountId: null,
    deferredRevenueGlAccountId: null,
    source: "tenant-chart-fallback",
  };
}
