// ---------------------------------------------------------------------------
// Nightly inventory reconciliation job
//
// Compares Helm's QOH-based inventory value (WAC or FIFO lots) against the
// corresponding inventory asset account balance in QuickBooks Online, per
// product category and location. Creates or updates ReconciliationAlert rows
// when the variance exceeds $50, and auto-resolves alerts when the variance
// drops back below threshold.
// ---------------------------------------------------------------------------

import { prisma } from "../lib/prisma.js";
import { qboRequest } from "../services/qbo-sync.js";

const ALERT_THRESHOLD_CENTS = 5000; // $50.00 — alert if variance > $50

export async function runInventoryReconciliation(tenantId?: string): Promise<void> {
  // Get all locations with QB connections
  const locations = await prisma.location.findMany({
    where: {
      ...(tenantId ? { tenantId } : {}),
      qboRealmId: { not: null },
      accountingSetupComplete: true,
    },
    select: {
      id: true,
      tenantId: true,
      name: true,
      qboRealmId: true,
      qboAccessToken: true,
      qboRefreshToken: true,
      qboTokenExpiresAt: true,
    },
  });

  for (const location of locations) {
    try {
      await reconcileLocation(location);
    } catch (err) {
      console.error(`[reconciliation] Failed for location ${location.name}:`, err);
      // Continue to next location
    }
  }
}

async function reconcileLocation(location: {
  id: string;
  tenantId: string;
  name: string;
  qboRealmId: string | null;
  qboAccessToken: string | null;
  qboRefreshToken: string | null;
  qboTokenExpiresAt: Date | null;
}): Promise<void> {
  // Get all GL mappings for this location (category → inventory asset GL account)
  const glMappings = await prisma.productCategoryGlMapping.findMany({
    where: { locationId: location.id, inventoryAssetGlAccountId: { not: null } },
    select: {
      productCategoryId: true,
      inventoryAssetGlAccountId: true,
      inventoryAssetGlAccount: { select: { qboAccountId: true, name: true } },
      productCategory: { select: { name: true, costingMethod: true, isFuelCategory: true } },
    },
  });

  for (const mapping of glMappings) {
    try {
      await reconcileCategory(location, mapping);
    } catch (err) {
      console.error(
        `[reconciliation] Category ${mapping.productCategory.name} failed for location ${location.name}:`,
        err,
      );
    }
  }
}

async function reconcileCategory(
  location: {
    id: string;
    tenantId: string;
    name: string;
    qboRealmId: string | null;
    qboAccessToken: string | null;
    qboRefreshToken: string | null;
    qboTokenExpiresAt: Date | null;
  },
  mapping: {
    productCategoryId: string;
    inventoryAssetGlAccountId: string | null;
    inventoryAssetGlAccount: { qboAccountId: string | null; name: string } | null;
    productCategory: { name: string; costingMethod: string; isFuelCategory: boolean };
  },
): Promise<void> {
  if (!mapping.inventoryAssetGlAccount?.qboAccountId) return; // no QB account to compare

  // ── Helm side: calculate inventory value ──────────────────────────────

  const isFifo =
    mapping.productCategory.isFuelCategory ||
    mapping.productCategory.costingMethod === "FIFO";

  let helmValueCents = 0;

  if (isFifo) {
    // FIFO: sum of (lot.qtyRemaining × lot.unitCostCents) for this category and location
    try {
      const lots = await prisma.inventoryLot.findMany({
        where: {
          locationId: location.id,
          product: { productCategoryId: mapping.productCategoryId },
          qtyRemaining: { gt: 0 },
        },
        select: { qtyRemaining: true, unitCostCents: true },
      });
      helmValueCents = lots.reduce(
        (sum, lot) => sum + lot.qtyRemaining * lot.unitCostCents,
        0,
      );
    } catch {
      // InventoryLot table may not exist yet — fall back to WAC
      helmValueCents = await getWacInventoryValue(location.id, mapping.productCategoryId);
    }
  } else {
    // WAC: sum of (inventory.qtyOnHand × product.averageCostCents) for products in this category
    helmValueCents = await getWacInventoryValue(location.id, mapping.productCategoryId);
  }

  // ── QB side: get inventory asset account balance ───────────────────────

  let qbValueCents = 0;
  try {
    const ctx = { tenantId: location.tenantId, locationId: location.id };
    const response = await qboRequest(
      ctx,
      "GET",
      `account/${mapping.inventoryAssetGlAccount.qboAccountId}?minorversion=73`,
    );
    const balanceDollars = (response as any)?.Account?.CurrentBalance ?? 0;
    qbValueCents = Math.round(balanceDollars * 100);
  } catch (err) {
    console.warn(
      `[reconciliation] Could not fetch QB balance for ${mapping.productCategory.name} ` +
        `(location: ${location.name}):`,
      err,
    );
    return; // can't compare without QB data
  }

  // ── Compare and alert ─────────────────────────────────────────────────

  const deltaCents = Math.abs(helmValueCents - qbValueCents);

  if (deltaCents > ALERT_THRESHOLD_CENTS) {
    // Check if an unresolved alert already exists for this category
    const existing = await prisma.reconciliationAlert.findFirst({
      where: {
        locationId: location.id,
        categoryId: mapping.productCategoryId,
        resolvedAt: null,
      },
    });

    if (existing) {
      // Update the existing alert with fresh values
      await prisma.reconciliationAlert.update({
        where: { id: existing.id },
        data: { helmValueCents, qbValueCents, deltaCents, detectedAt: new Date() },
      });
    } else {
      // Create a new alert
      await prisma.reconciliationAlert.create({
        data: {
          tenantId: location.tenantId,
          locationId: location.id,
          categoryId: mapping.productCategoryId,
          helmValueCents,
          qbValueCents,
          deltaCents,
        },
      });

      console.log(
        `[reconciliation] ALERT: ${location.name} / ${mapping.productCategory.name} ` +
          `variance $${(deltaCents / 100).toFixed(2)} ` +
          `(Helm: $${(helmValueCents / 100).toFixed(2)}, QB: $${(qbValueCents / 100).toFixed(2)})`,
      );
    }
  } else {
    // Variance is within threshold — resolve any existing open alert
    await prisma.reconciliationAlert.updateMany({
      where: {
        locationId: location.id,
        categoryId: mapping.productCategoryId,
        resolvedAt: null,
      },
      data: { resolvedAt: new Date() },
    });
  }
}

async function getWacInventoryValue(locationId: string, categoryId: string): Promise<number> {
  const inventoryItems = await prisma.inventory.findMany({
    where: { locationId, product: { productCategoryId: categoryId } },
    select: {
      qtyOnHand: true,
      product: { select: { averageCostCents: true } },
    },
  });
  return inventoryItems.reduce(
    (sum, inv) => sum + inv.qtyOnHand * (inv.product.averageCostCents ?? 0),
    0,
  );
}
