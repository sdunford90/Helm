import { prisma } from "../lib/prisma.js";

// ---------------------------------------------------------------------------
// Per-location GL account resolution
//
// Each location has its own chart of accounts (pulled from QBO when the
// location has a QBO connection). Mapping rows tell us which GL account a
// product / category / dockage rate / service fee should post to *for that
// location*. Resolution chain (first non-null wins):
//
//   1. Per-location override (Product/CategoryGlMapping for the locationId)
//   2. Per-location category default (ProductCategoryGlMapping for product's
//      category + locationId)
//   3. Tenant-level legacy FK on the product/category itself
//   4. null (caller must fall back to a hardcoded account number — but only
//      when the location is NOT QBO-connected; QBO-connected locations must
//      always have explicit mappings or the posting is rejected upstream).
// ---------------------------------------------------------------------------

export interface ResolvedProductGl {
  revenueGlAccountId: string | null;
  cogsGlAccountId: string | null;
  inventoryAssetGlAccountId: string | null;
  source:
    | "product_override"
    | "category_default"
    | "legacy_product_fk"
    | "legacy_category_fk"
    | "unmapped";
}

function pick(...vals: (string | null | undefined)[]): string | null {
  for (const v of vals) if (v) return v;
  return null;
}

// ---------------------------------------------------------------------------
// Per-location posting accounts (AR, cash/undeposited funds, deferred revenue)
//
// Locations can pin specific GL accounts for the three accounts that show up
// on every invoice/payment posting. gl-posting.ts and qbo-sync.ts call this
// helper to find them; when a slot is null the caller falls back to the
// existing account-number lookup against the location's chart of accounts
// and finally to the tenant-wide chart.
// ---------------------------------------------------------------------------

export interface LocationPostingAccount {
  id: string;
  accountNumber: string;
  name: string;
  qboAccountId: string | null;
}

export interface LocationPostingAccounts {
  ar: LocationPostingAccount | null;
  undepositedFunds: LocationPostingAccount | null;
  deferredRevenue: LocationPostingAccount | null;
  defaultRevenue: LocationPostingAccount | null;
  salesTax: LocationPostingAccount | null;
  earlyTermination: LocationPostingAccount | null;
  achReturnFee: LocationPostingAccount | null;
}

export async function getLocationPostingAccounts(
  locationId: string,
): Promise<LocationPostingAccounts> {
  const loc = await prisma.location.findUnique({
    where: { id: locationId },
    select: {
      arGlAccount: {
        select: { id: true, accountNumber: true, name: true, qboAccountId: true },
      },
      undepositedFundsGlAccount: {
        select: { id: true, accountNumber: true, name: true, qboAccountId: true },
      },
      deferredRevenueGlAccount: {
        select: { id: true, accountNumber: true, name: true, qboAccountId: true },
      },
      defaultRevenueGlAccount: {
        select: { id: true, accountNumber: true, name: true, qboAccountId: true },
      },
      salesTaxGlAccount: {
        select: { id: true, accountNumber: true, name: true, qboAccountId: true },
      },
      earlyTerminationGlAccount: {
        select: { id: true, accountNumber: true, name: true, qboAccountId: true },
      },
      achReturnFeeGlAccount: {
        select: { id: true, accountNumber: true, name: true, qboAccountId: true },
      },
    },
  });
  return {
    ar: loc?.arGlAccount ?? null,
    undepositedFunds: loc?.undepositedFundsGlAccount ?? null,
    deferredRevenue: loc?.deferredRevenueGlAccount ?? null,
    defaultRevenue: loc?.defaultRevenueGlAccount ?? null,
    salesTax: loc?.salesTaxGlAccount ?? null,
    earlyTermination: loc?.earlyTerminationGlAccount ?? null,
    achReturnFee: loc?.achReturnFeeGlAccount ?? null,
  };
}

export async function isLocationQboConnected(locationId: string): Promise<boolean> {
  const loc = await prisma.location.findUnique({
    where: { id: locationId },
    select: { qboAccessToken: true, qboRealmId: true },
  });
  return !!(loc?.qboAccessToken && loc?.qboRealmId);
}

// ---------------------------------------------------------------------------
// Per-location SYSTEM posting account resolution
//
// Slots that gl-posting.ts used to fall back to a hardcoded account number
// for. Each slot:
//   * has a Location.<field> column the operator pins in QuickBooks Setup;
//   * has a list of well-known account numbers used as a single-chart fallback
//     for tenants WITHOUT a per-location QBO connection;
//   * has the GLAccountType(s) the operator's pick must satisfy (the settings
//     PUT endpoint enforces this).
//
// Resolution chain:
//   1. Pinned column on `locations` (set in QuickBooks Setup).
//   2. QBO-connected locations: throw UNCONFIGURED_GL_MAPPING — silently
//      reaching for a tenant-wide row by number could resolve to an account
//      bound to a different QBO realm, which is the cross-tenant bleed this
//      whole machinery exists to prevent.
//   3. Non-QBO locations: walk `fallbackAccountNumbers` against the
//      location's chart, then the tenant-wide chart. Throw
//      UNCONFIGURED_GL_MAPPING if nothing matches (same shape as the legacy
//      `getAccountByNumber` error so call sites bubble identically).
// ---------------------------------------------------------------------------

export type LocationSystemPostingAccountSlot =
  | "defaultRevenue"
  | "salesTax"
  | "earlyTermination"
  | "achReturnFee";

interface SystemPostingAccountSpec {
  field:
    | "defaultRevenueGlAccountId"
    | "salesTaxGlAccountId"
    | "earlyTerminationGlAccountId"
    | "achReturnFeeGlAccountId";
  fallbackAccountNumbers: readonly string[];
  expectedTypes: ReadonlyArray<"REVENUE" | "LIABILITY">;
  description: string;
}

export const LOCATION_SYSTEM_POSTING_ACCOUNT_SPECS: Record<
  LocationSystemPostingAccountSlot,
  SystemPostingAccountSpec
> = {
  defaultRevenue: {
    field: "defaultRevenueGlAccountId",
    fallbackAccountNumbers: ["4500"],
    expectedTypes: ["REVENUE"],
    description: "default revenue",
  },
  salesTax: {
    field: "salesTaxGlAccountId",
    // 2400 Sales Tax Payable wins; 2401 State Sales Tax Payable mirrors the
    // legacy `getAccountByNumber(SALES_TAX_PAYABLE).catch(STATE_TAX_PAYABLE)`
    // chain in postInvoice.
    fallbackAccountNumbers: ["2400", "2401"],
    expectedTypes: ["LIABILITY"],
    description: "sales tax payable",
  },
  earlyTermination: {
    field: "earlyTerminationGlAccountId",
    fallbackAccountNumbers: ["4700"],
    expectedTypes: ["REVENUE"],
    description: "early termination income",
  },
  achReturnFee: {
    field: "achReturnFeeGlAccountId",
    fallbackAccountNumbers: ["4600"],
    expectedTypes: ["REVENUE"],
    description: "ACH return fee revenue",
  },
};

type TxClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

export async function resolveLocationSystemPostingAccount(
  tenantId: string,
  locationId: string | null | undefined,
  slot: LocationSystemPostingAccountSlot,
  context: string,
  tx?: TxClient,
): Promise<string> {
  const spec = LOCATION_SYSTEM_POSTING_ACCOUNT_SPECS[slot];
  const db = (tx ?? prisma) as typeof prisma;

  // 1. Honour the explicit per-location pin first — set in QuickBooks Setup
  //    and enforced as type-correct by the settings PUT endpoint.
  if (locationId) {
    const loc = await db.location.findUnique({
      where: { id: locationId },
      select: {
        defaultRevenueGlAccountId: true,
        salesTaxGlAccountId: true,
        earlyTerminationGlAccountId: true,
        achReturnFeeGlAccountId: true,
      },
    });
    const pinnedId = loc ? (loc[spec.field] as string | null) : null;
    if (pinnedId) return pinnedId;
  }

  // 2. QBO-connected locations: refuse the legacy-by-number fallback. The
  //    same number in a different chart belongs to a different realm; we'd
  //    rather surface the misconfiguration than silently mis-route the
  //    posting (or post into an account QBO knows nothing about).
  if (locationId && (await isLocationQboConnected(locationId))) {
    throw new Error(
      `UNCONFIGURED_GL_MAPPING: location ${locationId} is QBO-connected but ` +
      `has no ${spec.description} account pinned (${context}). Pin a ` +
      `${spec.description} account for this location in QuickBooks Setup ` +
      `before posting.`,
    );
  }

  // 3. Legacy single-chart fallback for non-QBO tenants: try each well-known
  //    account number in the location's chart first, then the tenant-wide
  //    chart. Mirrors the pre-task-222 `getAccountByNumber(…, locationId)`
  //    behaviour so single-chart tenants keep posting unchanged.
  for (const accountNumber of spec.fallbackAccountNumbers) {
    if (locationId) {
      const locScoped = await db.glAccount.findFirst({
        where: { tenantId, locationId, accountNumber },
        select: { id: true },
      });
      if (locScoped) return locScoped.id;
    }
    const tenantWide = await db.glAccount.findFirst({
      where: { tenantId, locationId: null, accountNumber },
      select: { id: true },
    });
    if (tenantWide) return tenantWide.id;
  }

  throw new Error(
    `UNCONFIGURED_GL_MAPPING: no ${spec.description} account found for ` +
    `tenant ${tenantId} (location=${locationId ?? "none"}, ${context}). ` +
    `Pin a ${spec.description} account for this location in QuickBooks ` +
    `Setup or seed account number ${spec.fallbackAccountNumbers[0]} in the ` +
    `chart of accounts.`,
  );
}

export async function resolveProductGlAccounts(
  tenantId: string,
  productId: string,
  locationId: string | null,
): Promise<ResolvedProductGl> {
  const product = await prisma.product.findFirst({
    where: { id: productId, tenantId },
    select: {
      id: true,
      productCategoryId: true,
      revenueGlAccountId: true,
      cogsGlAccountId: true,
      inventoryAssetGlAccountId: true,
      productCategory: {
        select: {
          id: true,
          defaultRevenueGlAccountId: true,
          defaultCogsGlAccountId: true,
          defaultInventoryAssetGlAccountId: true,
        },
      },
    },
  });
  if (!product) {
    return {
      revenueGlAccountId: null,
      cogsGlAccountId: null,
      inventoryAssetGlAccountId: null,
      source: "unmapped",
    };
  }

  type MappingSlots = {
    revenueGlAccountId: string | null;
    cogsGlAccountId: string | null;
    inventoryAssetGlAccountId: string | null;
  };
  let pOver: MappingSlots | null = null;
  let cOver: MappingSlots | null = null;
  if (locationId) {
    pOver = await prisma.productGlMapping.findFirst({
      where: { tenantId, productId, locationId },
      select: {
        revenueGlAccountId: true,
        cogsGlAccountId: true,
        inventoryAssetGlAccountId: true,
      },
    });
    if (product.productCategoryId) {
      cOver = await prisma.productCategoryGlMapping.findFirst({
        where: {
          tenantId,
          productCategoryId: product.productCategoryId,
          locationId,
        },
        select: {
          revenueGlAccountId: true,
          cogsGlAccountId: true,
          inventoryAssetGlAccountId: true,
        },
      });
    }
  }

  // QBO-connected locations must use per-location mappings only — legacy
  // tenant-level FKs may point at a different QBO realm's chart of accounts.
  const qboConnected = locationId ? await isLocationQboConnected(locationId) : false;
  const legacyProductRevenue = qboConnected ? null : product.revenueGlAccountId;
  const legacyProductCogs = qboConnected ? null : product.cogsGlAccountId;
  const legacyProductInv = qboConnected ? null : product.inventoryAssetGlAccountId;
  const legacyCategoryRevenue = qboConnected ? null : product.productCategory?.defaultRevenueGlAccountId;
  const legacyCategoryCogs = qboConnected ? null : product.productCategory?.defaultCogsGlAccountId;
  const legacyCategoryInv = qboConnected ? null : product.productCategory?.defaultInventoryAssetGlAccountId;

  const revenueGlAccountId = pick(
    pOver?.revenueGlAccountId,
    cOver?.revenueGlAccountId,
    legacyProductRevenue,
    legacyCategoryRevenue,
  );
  const cogsGlAccountId = pick(
    pOver?.cogsGlAccountId,
    cOver?.cogsGlAccountId,
    legacyProductCogs,
    legacyCategoryCogs,
  );
  const inventoryAssetGlAccountId = pick(
    pOver?.inventoryAssetGlAccountId,
    cOver?.inventoryAssetGlAccountId,
    legacyProductInv,
    legacyCategoryInv,
  );

  let source: ResolvedProductGl["source"] = "unmapped";
  if (pOver && (pOver.revenueGlAccountId || pOver.cogsGlAccountId || pOver.inventoryAssetGlAccountId)) {
    source = "product_override";
  } else if (cOver && (cOver.revenueGlAccountId || cOver.cogsGlAccountId || cOver.inventoryAssetGlAccountId)) {
    source = "category_default";
  } else if (legacyProductRevenue || legacyProductCogs || legacyProductInv) {
    source = "legacy_product_fk";
  } else if (legacyCategoryRevenue || legacyCategoryCogs || legacyCategoryInv) {
    source = "legacy_category_fk";
  }

  return { revenueGlAccountId, cogsGlAccountId, inventoryAssetGlAccountId, source };
}

export async function resolveRentalProductGlAccounts(
  tenantId: string,
  rentalProductId: string,
  locationId: string | null,
): Promise<ResolvedProductGl> {
  const product = await prisma.rentalProduct.findFirst({
    where: { id: rentalProductId, tenantId },
    select: { id: true, glAccountId: true },
  });
  if (!product) {
    return {
      revenueGlAccountId: null,
      cogsGlAccountId: null,
      inventoryAssetGlAccountId: null,
      source: "unmapped",
    };
  }
  let pOver: {
    revenueGlAccountId: string | null;
    cogsGlAccountId: string | null;
    inventoryAssetGlAccountId: string | null;
  } | null = null;
  if (locationId) {
    pOver = await prisma.rentalProductGlMapping.findFirst({
      where: { tenantId, rentalProductId, locationId },
      select: {
        revenueGlAccountId: true,
        cogsGlAccountId: true,
        inventoryAssetGlAccountId: true,
      },
    });
  }
  const qboConnected = locationId ? await isLocationQboConnected(locationId) : false;
  const legacyRevenue = qboConnected ? null : product.glAccountId;
  const revenueGlAccountId = pick(pOver?.revenueGlAccountId, legacyRevenue);
  const cogsGlAccountId = pick(pOver?.cogsGlAccountId);
  const inventoryAssetGlAccountId = pick(pOver?.inventoryAssetGlAccountId);
  let source: ResolvedProductGl["source"] = "unmapped";
  if (pOver && (pOver.revenueGlAccountId || pOver.cogsGlAccountId || pOver.inventoryAssetGlAccountId)) {
    source = "product_override";
  } else if (legacyRevenue) {
    source = "legacy_product_fk";
  }
  return { revenueGlAccountId, cogsGlAccountId, inventoryAssetGlAccountId, source };
}

export async function resolveDockageRateGlAccount(
  tenantId: string,
  dockageRateId: string,
  locationId: string | null,
): Promise<string | null> {
  if (locationId) {
    const m = await prisma.dockageRateGlMapping.findFirst({
      where: { tenantId, dockageRateId, locationId },
      select: { glAccountId: true },
    });
    if (m?.glAccountId) return m.glAccountId;
    if (await isLocationQboConnected(locationId)) return null;
  }
  const r = await prisma.dockageRate.findFirst({
    where: { id: dockageRateId, tenantId },
    select: { glAccountId: true },
  });
  return r?.glAccountId ?? null;
}

export async function resolveServiceFeeGlAccount(
  tenantId: string,
  serviceFeeId: string,
  locationId: string | null,
): Promise<string | null> {
  if (locationId) {
    const m = await prisma.serviceFeeGlMapping.findFirst({
      where: { tenantId, serviceFeeId, locationId },
      select: { glAccountId: true },
    });
    if (m?.glAccountId) return m.glAccountId;
    if (await isLocationQboConnected(locationId)) return null;
  }
  const r = await prisma.serviceFee.findFirst({
    where: { id: serviceFeeId, tenantId },
    select: { glAccountId: true },
  });
  return r?.glAccountId ?? null;
}

// ---------------------------------------------------------------------------
// Missing-mapping warnings
// ---------------------------------------------------------------------------
// For each QBO-connected location, list any catalog item (product, category,
// dockage rate, service fee) that lacks an explicit per-location GL mapping
// AND has no usable legacy fallback. Tenant locations without a QBO
// connection are skipped because they fall back to the tenant chart of
// accounts.
// ---------------------------------------------------------------------------

export interface MissingGlMappingItem {
  kind: "product" | "category" | "dockage_rate" | "service_fee" | "rental_product";
  id: string;
  name: string;
  // Which slots are missing — for products/categories there are 3 slots, for
  // the others there's just 1. Rental products only need a revenue mapping.
  missing: Array<"revenue" | "cogs" | "inventoryAsset" | "glAccount">;
}

export interface MissingGlAccountLocationWarning {
  locationId: string;
  locationName: string;
  items: MissingGlMappingItem[];
  totalIssues: number;
}

export async function getMissingGlAccountWarnings(
  tenantId: string,
): Promise<MissingGlAccountLocationWarning[]> {
  const locations = await prisma.location.findMany({
    where: { tenantId, qboAccessToken: { not: null }, qboRealmId: { not: null } },
    select: { id: true, name: true },
  });
  if (locations.length === 0) return [];

  const out: MissingGlAccountLocationWarning[] = [];
  for (const loc of locations) {
    const items: MissingGlMappingItem[] = [];

    // Products — only flag inventory products (need full triple) or
    // non-inventory products (need at least revenue).
    const products = await prisma.product.findMany({
      where: { tenantId, active: true },
      select: {
        id: true,
        name: true,
        trackInventory: true,
        productCategoryId: true,
      },
    });
    const [productMappings, categoryMappingsForProducts] = await Promise.all([
      prisma.productGlMapping.findMany({
        where: { tenantId, locationId: loc.id },
        select: {
          productId: true,
          revenueGlAccountId: true,
          cogsGlAccountId: true,
          inventoryAssetGlAccountId: true,
        },
      }),
      prisma.productCategoryGlMapping.findMany({
        where: { tenantId, locationId: loc.id },
        select: {
          productCategoryId: true,
          revenueGlAccountId: true,
          cogsGlAccountId: true,
          inventoryAssetGlAccountId: true,
        },
      }),
    ]);
    type SlotMapping = {
      revenueGlAccountId: string | null;
      cogsGlAccountId: string | null;
      inventoryAssetGlAccountId: string | null;
    };
    const pmByProduct = new Map<string, SlotMapping>();
    for (const m of productMappings) pmByProduct.set(m.productId, m);
    const cmByCat = new Map<string, SlotMapping>();
    for (const m of categoryMappingsForProducts) cmByCat.set(m.productCategoryId, m);

    for (const p of products) {
      const m = pmByProduct.get(p.id);
      const cm = p.productCategoryId ? cmByCat.get(p.productCategoryId) : null;
      const isInventory = !!p.trackInventory;
      const missing: MissingGlMappingItem["missing"] = [];
      // Effective resolution chain: per-product override -> category default
      // (legacy FKs are intentionally ignored for QBO-connected locations).
      const revenue = m?.revenueGlAccountId ?? cm?.revenueGlAccountId ?? null;
      const cogs = m?.cogsGlAccountId ?? cm?.cogsGlAccountId ?? null;
      const inv = m?.inventoryAssetGlAccountId ?? cm?.inventoryAssetGlAccountId ?? null;
      if (!revenue) missing.push("revenue");
      if (isInventory) {
        if (!cogs) missing.push("cogs");
        if (!inv) missing.push("inventoryAsset");
      }
      if (missing.length > 0) {
        items.push({ kind: "product", id: p.id, name: p.name, missing });
      }
    }

    // Categories
    const categories = await prisma.productCategory.findMany({
      where: { tenantId },
      select: { id: true, name: true },
    });
    for (const c of categories) {
      const m = cmByCat.get(c.id);
      if (!m?.revenueGlAccountId) {
        items.push({
          kind: "category",
          id: c.id,
          name: c.name,
          missing: ["revenue"],
        });
      }
    }

    // Dockage rates (scoped to this location)
    const dockageRates = await prisma.dockageRate.findMany({
      where: { tenantId, locationId: loc.id, active: true },
      select: { id: true, slipType: true },
    });
    const drMappings = await prisma.dockageRateGlMapping.findMany({
      where: { tenantId, locationId: loc.id },
      select: { dockageRateId: true, glAccountId: true },
    });
    const drByRate = new Map<string, string | null>();
    for (const m of drMappings) drByRate.set(m.dockageRateId, m.glAccountId);
    for (const r of dockageRates) {
      if (!drByRate.get(r.id)) {
        items.push({
          kind: "dockage_rate",
          id: r.id,
          name: `${r.slipType} dockage`,
          missing: ["glAccount"],
        });
      }
    }

    // Service fees (scoped to this location)
    const serviceFees = await prisma.serviceFee.findMany({
      where: { tenantId, locationId: loc.id, active: true },
      select: { id: true, name: true },
    });
    const sfMappings = await prisma.serviceFeeGlMapping.findMany({
      where: { tenantId, locationId: loc.id },
      select: { serviceFeeId: true, glAccountId: true },
    });
    const sfByFee = new Map<string, string | null>();
    for (const m of sfMappings) sfByFee.set(m.serviceFeeId, m.glAccountId);
    for (const f of serviceFees) {
      if (!sfByFee.get(f.id)) {
        items.push({
          kind: "service_fee",
          id: f.id,
          name: f.name,
          missing: ["glAccount"],
        });
      }
    }

    // Rental products — tenant-wide entities, so each one needs an explicit
    // revenue mapping for every QBO-connected location. Tenant-level legacy
    // FK is intentionally ignored here because it may point at the wrong
    // QBO realm.
    const rentalProducts = await prisma.rentalProduct.findMany({
      where: { tenantId, active: true },
      select: { id: true, name: true },
    });
    const rpMappings = await prisma.rentalProductGlMapping.findMany({
      where: { tenantId, locationId: loc.id },
      select: { rentalProductId: true, revenueGlAccountId: true },
    });
    const rpByProduct = new Map<string, string | null>();
    for (const m of rpMappings) rpByProduct.set(m.rentalProductId, m.revenueGlAccountId);
    for (const p of rentalProducts) {
      if (!rpByProduct.get(p.id)) {
        items.push({
          kind: "rental_product",
          id: p.id,
          name: p.name,
          missing: ["revenue"],
        });
      }
    }

    out.push({
      locationId: loc.id,
      locationName: loc.name,
      items,
      totalIssues: items.length,
    });
  }

  return out;
}
