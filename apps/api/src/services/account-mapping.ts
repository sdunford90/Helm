import { prisma } from "../lib/prisma.js";

// --------------------------------------------------------------------------
// Account Mapping Service
//
// Resolves the correct QBO-backed GL account for any accounting event.
// All GL posting goes through these lookups instead of hardcoded account numbers.
// --------------------------------------------------------------------------

export type SystemAccountKey =
  | "ACCOUNTS_RECEIVABLE"
  | "CASH"
  | "CARD_CLEARING"
  | "ACH_CLEARING"
  | "DEFERRED_REVENUE"
  | "SECURITY_DEPOSITS_HELD"
  | "SALES_TAX_PAYABLE"
  | "LATE_FEE_REVENUE"
  | "ACH_RETURN_FEE"
  | "EARLY_TERMINATION_INCOME"
  | "INVENTORY_ASSET"
  | "ACCOUNTS_PAYABLE";

export type RevenueStreamKey =
  | "DOCKAGE"
  | "ELECTRICITY"
  | "RENTAL"
  | "FUEL"
  | "RETAIL"
  | "TRANSIENT"
  | "RAMP"
  | "CONCIERGE"
  | "DAMAGE_WAIVER";

export type PaymentMethodKey =
  | "CARD"
  | "ACH"
  | "CASH"
  | "CHECK"
  | "WIRE"
  | "CHARGE_TO_SLIP";

// --------------------------------------------------------------------------
// Core resolver — looks up a mapping and returns the GlAccount id
// --------------------------------------------------------------------------

async function resolveMapping(
  locationId: string,
  mappingType: string,
  sourceKey: string,
): Promise<string> {
  const mapping = await prisma.accountMapping.findFirst({
    where: { locationId, mappingType: mappingType as any, sourceKey, active: true },
    select: { glAccountId: true },
  });

  if (!mapping) {
    throw new Error(
      `No GL account mapping configured for [${mappingType}:${sourceKey}] at location ${locationId}. ` +
      `Go to Accounting → Account Mappings to configure this.`,
    );
  }

  return mapping.glAccountId;
}

async function resolveMappingPair(
  locationId: string,
  mappingType: string,
  sourceKey: string,
): Promise<{ glAccountId: string; glCogsAccountId: string }> {
  const mapping = await prisma.accountMapping.findFirst({
    where: { locationId, mappingType: mappingType as any, sourceKey, active: true },
    select: { glAccountId: true, glCogsAccountId: true },
  });

  if (!mapping) {
    throw new Error(
      `No GL account mapping configured for [${mappingType}:${sourceKey}] at location ${locationId}.`,
    );
  }

  if (!mapping.glCogsAccountId) {
    throw new Error(
      `COGS account not configured for [${mappingType}:${sourceKey}] at location ${locationId}.`,
    );
  }

  return { glAccountId: mapping.glAccountId, glCogsAccountId: mapping.glCogsAccountId };
}

// --------------------------------------------------------------------------
// Public resolvers
// --------------------------------------------------------------------------

export async function getSystemAccount(locationId: string, key: SystemAccountKey): Promise<string> {
  return resolveMapping(locationId, "SYSTEM_ACCOUNT", key);
}

export async function getRevenueAccount(locationId: string, key: RevenueStreamKey): Promise<string> {
  return resolveMapping(locationId, "REVENUE_STREAM", key);
}

export async function getPaymentAccount(locationId: string, key: PaymentMethodKey): Promise<string> {
  return resolveMapping(locationId, "PAYMENT_METHOD", key);
}

// Resolves revenue account for a specific dockage rate (falls back to DOCKAGE stream)
export async function getDockageRateAccount(locationId: string, rateId: string): Promise<string> {
  const rate = await prisma.dockageRate.findFirst({
    where: { id: rateId, locationId },
    select: { glRevenueAccountId: true },
  });

  if (rate?.glRevenueAccountId) return rate.glRevenueAccountId;

  // Fall back to dockage revenue stream mapping
  return getRevenueAccount(locationId, "DOCKAGE");
}

// Resolves electricity account for the location (single account, no per-rate split)
export async function getElectricityAccount(locationId: string): Promise<string> {
  return getRevenueAccount(locationId, "ELECTRICITY");
}

// Resolves rental revenue account — respects location.rentalGlMode toggle
export async function getRentalAccount(locationId: string, rentalProductId: string): Promise<string> {
  const location = await prisma.location.findUnique({
    where: { id: locationId },
    select: { rentalGlMode: true },
  });

  if (location?.rentalGlMode === "PER_PRODUCT") {
    const product = await prisma.rentalProduct.findFirst({
      where: { id: rentalProductId, locationId },
      select: { glRevenueAccountId: true },
    });
    if (product?.glRevenueAccountId) return product.glRevenueAccountId;
  }

  // Fall back to single rental account
  return getRevenueAccount(locationId, "RENTAL");
}

// Resolves service fee account for a specific fee
export async function getServiceFeeAccount(locationId: string, feeId: string): Promise<string> {
  const fee = await prisma.serviceFee.findFirst({
    where: { id: feeId, locationId },
    select: { glAccountId: true },
  });

  if (fee?.glAccountId) return fee.glAccountId;

  throw new Error(`No GL account configured for service fee ${feeId} at location ${locationId}.`);
}

// Resolves revenue + COGS for a product category
export async function getProductCategoryAccounts(
  locationId: string,
  categoryId: string,
): Promise<{ revenueAccountId: string; cogsAccountId: string }> {
  const category = await prisma.productCategory.findFirst({
    where: { id: categoryId, locationId },
    select: { glRevenueAccountId: true, glCogsAccountId: true },
  });

  if (!category?.glRevenueAccountId || !category?.glCogsAccountId) {
    throw new Error(
      `Revenue or COGS account not configured for category ${categoryId} at location ${locationId}.`,
    );
  }

  return {
    revenueAccountId: category.glRevenueAccountId,
    cogsAccountId: category.glCogsAccountId,
  };
}

// --------------------------------------------------------------------------
// Validation — check if a location is fully configured before going live
// --------------------------------------------------------------------------

export interface MappingValidationResult {
  isValid: boolean;
  missingMappings: string[];
}

const REQUIRED_SYSTEM_ACCOUNTS: SystemAccountKey[] = [
  "ACCOUNTS_RECEIVABLE",
  "CASH",
  "CARD_CLEARING",
  "ACH_CLEARING",
  "DEFERRED_REVENUE",
  "SECURITY_DEPOSITS_HELD",
  "SALES_TAX_PAYABLE",
  "INVENTORY_ASSET",
  "ACCOUNTS_PAYABLE",
];

const REQUIRED_REVENUE_STREAMS: RevenueStreamKey[] = [
  "DOCKAGE",
  "ELECTRICITY",
  "RENTAL",
  "FUEL",
  "RETAIL",
  "TRANSIENT",
  "RAMP",
  "CONCIERGE",
];

const REQUIRED_PAYMENT_METHODS: PaymentMethodKey[] = [
  "CARD",
  "ACH",
  "CASH",
];

export async function validateLocationMappings(locationId: string): Promise<MappingValidationResult> {
  const missing: string[] = [];

  for (const key of REQUIRED_SYSTEM_ACCOUNTS) {
    const exists = await prisma.accountMapping.findFirst({
      where: { locationId, mappingType: "SYSTEM_ACCOUNT", sourceKey: key, active: true },
      select: { id: true },
    });
    if (!exists) missing.push(`System Account: ${key}`);
  }

  for (const key of REQUIRED_REVENUE_STREAMS) {
    const exists = await prisma.accountMapping.findFirst({
      where: { locationId, mappingType: "REVENUE_STREAM", sourceKey: key, active: true },
      select: { id: true },
    });
    if (!exists) missing.push(`Revenue Stream: ${key}`);
  }

  for (const key of REQUIRED_PAYMENT_METHODS) {
    const exists = await prisma.accountMapping.findFirst({
      where: { locationId, mappingType: "PAYMENT_METHOD", sourceKey: key, active: true },
      select: { id: true },
    });
    if (!exists) missing.push(`Payment Method: ${key}`);
  }

  return { isValid: missing.length === 0, missingMappings: missing };
}

// --------------------------------------------------------------------------
// CRUD with audit logging
// --------------------------------------------------------------------------

interface UpsertMappingInput {
  locationId: string;
  tenantId: string;
  mappingType: string;
  sourceKey: string;
  glAccountId: string;
  glCogsAccountId?: string;
  availablePOS?: boolean;
  availableBilling?: boolean;
  userId: string;
  userName: string;
  mappingLabel: string;
  mappingSection: string;
}

export async function upsertMapping(input: UpsertMappingInput): Promise<void> {
  const existing = await prisma.accountMapping.findFirst({
    where: {
      locationId: input.locationId,
      mappingType: input.mappingType as any,
      sourceKey: input.sourceKey,
    },
    include: { glAccount: { select: { name: true, qboAccountId: true } } },
  });

  const newAccount = await prisma.glAccount.findUnique({
    where: { id: input.glAccountId },
    select: { name: true, qboAccountId: true },
  });

  await prisma.accountMapping.upsert({
    where: {
      locationId_mappingType_sourceKey: {
        locationId: input.locationId,
        mappingType: input.mappingType as any,
        sourceKey: input.sourceKey,
      },
    },
    create: {
      tenantId: input.tenantId,
      locationId: input.locationId,
      mappingType: input.mappingType as any,
      sourceKey: input.sourceKey,
      glAccountId: input.glAccountId,
      glCogsAccountId: input.glCogsAccountId ?? null,
      availablePOS: input.availablePOS ?? true,
      availableBilling: input.availableBilling ?? true,
      active: true,
    },
    update: {
      glAccountId: input.glAccountId,
      glCogsAccountId: input.glCogsAccountId ?? null,
      availablePOS: input.availablePOS ?? true,
      availableBilling: input.availableBilling ?? true,
      active: true,
    },
  });

  // Write audit log for the change
  if (!existing || existing.glAccountId !== input.glAccountId) {
    await prisma.accountMappingAuditLog.create({
      data: {
        tenantId: input.tenantId,
        locationId: input.locationId,
        userId: input.userId,
        userName: input.userName,
        mappingSection: input.mappingSection,
        mappingLabel: input.mappingLabel,
        fieldChanged: "glAccountId",
        oldAccountName: existing?.glAccount?.name ?? null,
        oldAccountId: existing?.glAccount?.qboAccountId ?? null,
        newAccountName: newAccount?.name ?? null,
        newAccountId: newAccount?.qboAccountId ?? null,
      },
    });
  }
}

// --------------------------------------------------------------------------
// Fetch all mappings for a location (for the Account Mappings UI)
// --------------------------------------------------------------------------

export async function getLocationMappings(locationId: string) {
  const [mappings, dockageRates, serviceFees, categories, rentalProducts, location] =
    await Promise.all([
      prisma.accountMapping.findMany({
        where: { locationId, active: true },
        include: {
          glAccount: { select: { id: true, name: true, type: true, qboAccountId: true, accountNumber: true } },
          glCogsAccount: { select: { id: true, name: true, type: true, qboAccountId: true, accountNumber: true } },
        },
        orderBy: [{ mappingType: "asc" }, { sourceKey: "asc" }],
      }),
      prisma.dockageRate.findMany({
        where: { locationId, active: true },
        include: {
          glRevenueAccount: { select: { id: true, name: true, type: true, qboAccountId: true } },
        },
        orderBy: { slipType: "asc" },
      }),
      prisma.serviceFee.findMany({
        where: { locationId, active: true },
        include: {
          glAccount: { select: { id: true, name: true, type: true, qboAccountId: true } },
        },
        orderBy: { name: "asc" },
      }),
      prisma.productCategory.findMany({
        where: { locationId, active: true },
        include: {
          glRevenueAccount: { select: { id: true, name: true, type: true, qboAccountId: true } },
          glCogsAccount: { select: { id: true, name: true, type: true, qboAccountId: true } },
        },
        orderBy: { name: "asc" },
      }),
      prisma.rentalProduct.findMany({
        where: { locationId, active: true },
        include: {
          glRevenueAccount: { select: { id: true, name: true, type: true, qboAccountId: true } },
        },
        orderBy: { name: "asc" },
      }),
      prisma.location.findUnique({
        where: { id: locationId },
        select: { rentalGlMode: true },
      }),
    ]);

  return {
    systemAccounts: mappings.filter((m) => m.mappingType === "SYSTEM_ACCOUNT"),
    revenueStreams: mappings.filter((m) => m.mappingType === "REVENUE_STREAM"),
    paymentMethods: mappings.filter((m) => m.mappingType === "PAYMENT_METHOD"),
    dockageRates,
    serviceFees,
    productCategories: categories,
    rentalProducts,
    rentalGlMode: location?.rentalGlMode ?? "SINGLE",
  };
}
