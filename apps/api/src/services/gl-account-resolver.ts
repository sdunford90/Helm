import { prisma } from "../lib/prisma.js";

// ---------------------------------------------------------------------------
// Per-location GL account resolution
//
// Each location has its own chart of accounts (pulled from QBO when the
// location has a QBO connection). Inventory products resolve through ONE
// rung: the per-location ProductCategoryGlMapping row for the product's
// category at the target location. There are no legacy fallbacks (the
// per-product, tenant-wide product, and tenant-wide category default fields
// were retired in 20260429080000_inventory_category_only_gl). When no
// mapping exists for the (category, location) pair the slot is null and
// posting consumers MUST fail loudly with an UNCONFIGURED_GL_MAPPING error.
//
// Dockage rates / service fees still keep a tenant-wide legacy fallback
// because their per-location editor only fills the single glAccount slot
// (and they're not yet on the same migration path as inventory).
// ---------------------------------------------------------------------------

export interface ResolvedProductGl {
  revenueGlAccountId: string | null;
  cogsGlAccountId: string | null;
  inventoryAssetGlAccountId: string | null;
  // "category_default" is set by inventory products (single rung, see
  // resolveProductGlAccounts). "product_override" is set by rental products
  // since rentals still resolve through a per-(rentalProduct, location)
  // override row directly.
  source: "category_default" | "product_override" | "unmapped";
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

// Per-location SYSTEM posting accounts (Task #222). Resolver: pin → throw
// for QBO-connected (no chart-walk, prevents cross-realm bleed) →
// lowest-numbered chart row of the slot's expectedTypes for non-QBO
// (location-scoped, then tenant-wide) → throw.

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
  expectedTypes: ReadonlyArray<"REVENUE" | "LIABILITY">;
  description: string;
}

export const LOCATION_SYSTEM_POSTING_ACCOUNT_SPECS: Record<
  LocationSystemPostingAccountSlot,
  SystemPostingAccountSpec
> = {
  defaultRevenue: {
    field: "defaultRevenueGlAccountId",
    expectedTypes: ["REVENUE"],
    description: "default revenue",
  },
  salesTax: {
    field: "salesTaxGlAccountId",
    expectedTypes: ["LIABILITY"],
    description: "sales tax payable",
  },
  earlyTermination: {
    field: "earlyTerminationGlAccountId",
    expectedTypes: ["REVENUE"],
    description: "early termination income",
  },
  achReturnFee: {
    field: "achReturnFeeGlAccountId",
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

  // 1. Pin wins.
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

  // 2. QBO-connected: require pin (no chart-walk → no cross-realm bleed).
  if (locationId && (await isLocationQboConnected(locationId))) {
    throw new Error(
      `UNCONFIGURED_GL_MAPPING: location ${locationId} is QBO-connected but ` +
      `has no ${spec.description} account pinned (${context}). Pin a ` +
      `${spec.description} account for this location in QuickBooks Setup ` +
      `before posting.`,
    );
  }

  // 3. Non-QBO: lowest-numbered typed row, location-scoped then tenant-wide.
  const expectedTypes = [...spec.expectedTypes];
  if (locationId) {
    const locScoped = await db.glAccount.findFirst({
      where: { tenantId, locationId, type: { in: expectedTypes } },
      orderBy: { accountNumber: "asc" },
      select: { id: true },
    });
    if (locScoped) return locScoped.id;
  }
  const tenantWide = await db.glAccount.findFirst({
    where: { tenantId, locationId: null, type: { in: expectedTypes } },
    orderBy: { accountNumber: "asc" },
    select: { id: true },
  });
  if (tenantWide) return tenantWide.id;

  throw new Error(
    `UNCONFIGURED_GL_MAPPING: no ${spec.description} account found for ` +
    `tenant ${tenantId} (location=${locationId ?? "none"}, ${context}). ` +
    `Pin a ${spec.description} account for this location in QuickBooks ` +
    `Setup, or add a ${expectedTypes.join("/")}-typed row to the chart.`,
  );
}

/**
 * Strict variant of `resolveProductGlAccounts` for posting consumers
 * (invoice creation, POS checkout, COGS, inventory adjustments, QBO sync).
 * Throws a `MISSING_GL_MAPPING` error in the exact form
 *   `Missing GL mapping for category "{name}" at location "{name}"`
 * when the resolver would have returned `unmapped` (no per-(category,
 * location) row) OR when the requested slot itself is null on an existing
 * row. The exact wording is part of our operator-facing error contract — UI
 * code keys off the prefix to deep-link operators to the category editor.
 *
 * `requireSlots` defaults to `["revenue"]` because that's the minimum every
 * posting flow needs. POS / COGS / inventory adjustments pass `["revenue",
 * "cogs", "inventoryAsset"]` for tracked items so they fail before posting
 * a half-mapped journal entry.
 */
export async function resolveProductGlAccountsStrict(
  tenantId: string,
  productId: string,
  locationId: string,
  requireSlots: ReadonlyArray<"revenue" | "cogs" | "inventoryAsset"> = ["revenue"],
): Promise<ResolvedProductGl & { revenueGlAccountId: string }> {
  const product = await prisma.product.findFirst({
    where: { id: productId, tenantId },
    select: {
      id: true,
      productCategoryId: true,
      productCategory: { select: { name: true } },
    },
  });
  if (!product) {
    throw new Error(
      `MISSING_GL_MAPPING: product ${productId} not found in tenant ${tenantId}`,
    );
  }
  const loc = await prisma.location.findFirst({
    where: { id: locationId, tenantId },
    select: { name: true },
  });
  const locationName = loc?.name ?? locationId;
  const categoryName = product.productCategory?.name ?? "(uncategorized)";

  const cOver = await prisma.productCategoryGlMapping.findFirst({
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

  const slotValue = (slot: "revenue" | "cogs" | "inventoryAsset"): string | null => {
    if (!cOver) return null;
    if (slot === "revenue") return cOver.revenueGlAccountId;
    if (slot === "cogs") return cOver.cogsGlAccountId;
    return cOver.inventoryAssetGlAccountId;
  };

  for (const slot of requireSlots) {
    if (!slotValue(slot)) {
      throw new Error(
        `MISSING_GL_MAPPING: Missing GL mapping for category "${categoryName}" ` +
        `at location "${locationName}". Configure the ${slot} GL account in ` +
        `Settings → Categories → Per-location mappings.`,
      );
    }
  }

  return {
    revenueGlAccountId: slotValue("revenue") as string,
    cogsGlAccountId: slotValue("cogs"),
    inventoryAssetGlAccountId: slotValue("inventoryAsset"),
    source: "category_default",
  };
}

export async function resolveProductGlAccounts(
  tenantId: string,
  productId: string,
  locationId: string | null,
): Promise<ResolvedProductGl> {
  const product = await prisma.product.findFirst({
    where: { id: productId, tenantId },
    select: { id: true, productCategoryId: true },
  });
  if (!product || !locationId) {
    return {
      revenueGlAccountId: null,
      cogsGlAccountId: null,
      inventoryAssetGlAccountId: null,
      source: "unmapped",
    };
  }

  const cOver = await prisma.productCategoryGlMapping.findFirst({
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

  const hasAny =
    !!cOver &&
    !!(
      cOver.revenueGlAccountId ||
      cOver.cogsGlAccountId ||
      cOver.inventoryAssetGlAccountId
    );

  return {
    revenueGlAccountId: cOver?.revenueGlAccountId ?? null,
    cogsGlAccountId: cOver?.cogsGlAccountId ?? null,
    inventoryAssetGlAccountId: cOver?.inventoryAssetGlAccountId ?? null,
    source: hasAny ? "category_default" : "unmapped",
  };
}

export async function resolveRentalProductGlAccounts(
  tenantId: string,
  rentalProductId: string,
  locationId: string | null,
): Promise<ResolvedProductGl> {
  // Rental products are non-inventory: the marina retains the asset and
  // lends it out, so there is no COGS or inventory-asset posting. Only a
  // per-location revenue mapping is configurable; the other slots in
  // ResolvedProductGl are always null for rentals.
  const product = await prisma.rentalProduct.findFirst({
    where: { id: rentalProductId, tenantId },
    select: { id: true },
  });
  if (!product) {
    return {
      revenueGlAccountId: null,
      cogsGlAccountId: null,
      inventoryAssetGlAccountId: null,
      source: "unmapped",
    };
  }
  let pOver: { revenueGlAccountId: string | null } | null = null;
  if (locationId) {
    pOver = await prisma.rentalProductGlMapping.findFirst({
      where: { tenantId, rentalProductId, locationId },
      select: { revenueGlAccountId: true },
    });
  }
  const revenueGlAccountId = pick(pOver?.revenueGlAccountId);
  const source: ResolvedProductGl["source"] =
    pOver && pOver.revenueGlAccountId ? "product_override" : "unmapped";
  return {
    revenueGlAccountId,
    cogsGlAccountId: null,
    inventoryAssetGlAccountId: null,
    source,
  };
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
    const categoryMappingsForProducts = await prisma.productCategoryGlMapping.findMany({
      where: { tenantId, locationId: loc.id },
      select: {
        productCategoryId: true,
        revenueGlAccountId: true,
        cogsGlAccountId: true,
        inventoryAssetGlAccountId: true,
      },
    });
    type SlotMapping = {
      revenueGlAccountId: string | null;
      cogsGlAccountId: string | null;
      inventoryAssetGlAccountId: string | null;
    };
    const cmByCat = new Map<string, SlotMapping>();
    for (const m of categoryMappingsForProducts) cmByCat.set(m.productCategoryId, m);

    for (const p of products) {
      // Resolution is single-rung now: the per-(category, location) mapping.
      // Per-product overrides and tenant-wide legacy FKs were retired in
      // 20260429080000_inventory_category_only_gl. productCategoryId is NOT
      // NULL after that migration, but stay defensive in case the read
      // races with a partial backfill.
      const cm = p.productCategoryId ? cmByCat.get(p.productCategoryId) : null;
      const isInventory = !!p.trackInventory;
      const missing: MissingGlMappingItem["missing"] = [];
      const revenue = cm?.revenueGlAccountId ?? null;
      const cogs = cm?.cogsGlAccountId ?? null;
      const inv = cm?.inventoryAssetGlAccountId ?? null;
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
