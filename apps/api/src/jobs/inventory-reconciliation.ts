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
import { sendEmail } from "../lib/email.js";
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
    console.error(
      `[reconciliation] QB API unavailable for ${location.name} / ${mapping.productCategory.name}. ` +
        `Check QB connection and token expiry. Error:`,
      err instanceof Error ? err.message : String(err),
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

      // Send email notification to the location's accounting contacts
      try {
        await sendReconciliationAlertEmail({
          locationName: location.name,
          categoryName: mapping.productCategory.name,
          helmValueCents,
          qbValueCents,
          deltaCents,
          tenantId: location.tenantId,
          locationId: location.id,
        });
      } catch (emailErr) {
        console.warn('[reconciliation] Could not send alert email:', emailErr);
        // Swallow — alert is already in DB, email is best-effort
      }

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

async function sendReconciliationAlertEmail(params: {
  locationName: string;
  categoryName: string;
  helmValueCents: number;
  qbValueCents: number;
  deltaCents: number;
  tenantId: string;
  locationId: string;
}): Promise<void> {
  const { locationName, categoryName, helmValueCents, qbValueCents, deltaCents, tenantId } = params;

  // Find accounting contacts for this location (TENANT_ADMIN, MARINA_OWNER, or ACCOUNTING role users)
  const accountingUsers = await prisma.user.findMany({
    where: {
      tenantId,
      role: { in: ['TENANT_ADMIN', 'MARINA_OWNER', 'ACCOUNTING'] as any },
      active: true,
    },
    select: { email: true, firstName: true, lastName: true },
    take: 5, // cap at 5 recipients
  });

  if (accountingUsers.length === 0) return; // no one to notify

  const helmDollars = (helmValueCents / 100).toFixed(2);
  const qbDollars = (qbValueCents / 100).toFixed(2);
  const deltaDollars = (deltaCents / 100).toFixed(2);

  for (const user of accountingUsers) {
    await sendEmail({
      to: user.email,
      subject: `Inventory Variance Alert — ${locationName}: ${categoryName} ($${deltaDollars})`,
      tenantId,
      html: [
        `<p>Hi ${user.firstName ?? 'there'},</p>`,
        `<p>A significant inventory variance was detected for <strong>${locationName}</strong>.</p>`,
        `<table style="border-collapse:collapse;margin:16px 0;">`,
        `  <tr><td style="padding:6px 12px 6px 0;font-weight:600;">Category</td><td style="padding:6px 0;">${categoryName}</td></tr>`,
        `  <tr><td style="padding:6px 12px 6px 0;font-weight:600;">Helm value</td><td style="padding:6px 0;">$${helmDollars}</td></tr>`,
        `  <tr><td style="padding:6px 12px 6px 0;font-weight:600;">QuickBooks balance</td><td style="padding:6px 0;">$${qbDollars}</td></tr>`,
        `  <tr><td style="padding:6px 12px 6px 0;font-weight:600;">Variance</td><td style="padding:6px 0;color:#d73a49;font-weight:700;">$${deltaDollars}</td></tr>`,
        `</table>`,
        `<p>Please log in to Helm and visit <strong>Accounting → Reconciliation</strong> to review and resolve this alert.</p>`,
        `<p style="font-size:13px;color:#666;">This is an automated notification from the Helm accounting system.</p>`,
      ].join('\n'),
    });
  }
}
