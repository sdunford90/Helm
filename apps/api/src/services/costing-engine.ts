import { prisma } from "../lib/prisma.js";
import { Prisma } from "@prisma/client";

// ─── Receipt: Update cost basis when inventory is received ─────────────────

export async function recordInventoryReceipt(params: {
  tenantId: string;
  productId: string;
  locationId: string;
  qtyReceived: number;
  unitCostCents: number;
  purchaseOrderId?: string;
  tx?: Prisma.TransactionClient;
}): Promise<void> {
  const { tenantId, productId, locationId, qtyReceived, unitCostCents, purchaseOrderId, tx } = params;
  const db = tx ?? prisma;

  // Get the product's category to determine costing method
  const product = await (db as typeof prisma).product.findUnique({
    where: { id: productId },
    select: { averageCostCents: true, productCategory: { select: { costingMethod: true, isFuelCategory: true } } },
  });

  if (!product) throw new Error(`Product ${productId} not found`);

  const costingMethod = product.productCategory?.isFuelCategory
    ? "FIFO"
    : (product.productCategory?.costingMethod ?? "WAC");

  if (costingMethod === "FIFO") {
    // Create a new inventory lot
    try {
      await (db as typeof prisma).inventoryLot.create({
        data: {
          tenantId,
          productId,
          locationId,
          qtyRemaining: qtyReceived,
          unitCostCents,
          purchaseOrderId: purchaseOrderId ?? null,
        },
      });
    } catch {
      // InventoryLot table may not exist yet — log and continue
      console.warn("[costing-engine] InventoryLot table not available, skipping lot creation");
    }
  } else {
    // WAC: recalculate weighted average cost
    const inventory = await (db as typeof prisma).inventory.findFirst({
      where: { productId, locationId },
      select: { qtyOnHand: true },
    });

    const currentQty = inventory?.qtyOnHand ?? 0;
    const currentAvgCost = product.averageCostCents ?? 0;
    const newTotalValue = currentQty * currentAvgCost + qtyReceived * unitCostCents;
    const newQty = currentQty + qtyReceived;
    const newAvgCost = newQty > 0 ? Math.round(newTotalValue / newQty) : unitCostCents;

    await (db as typeof prisma).product.update({
      where: { id: productId },
      data: { averageCostCents: newAvgCost },
    });
  }

  // Update QOH — Inventory has no composite unique key, so use findFirst + upsert by id
  const existing = await (db as typeof prisma).inventory.findFirst({
    where: { productId, locationId },
    select: { id: true },
  });

  if (existing) {
    await (db as typeof prisma).inventory.update({
      where: { id: existing.id },
      data: { qtyOnHand: { increment: qtyReceived } },
    });
  } else {
    await (db as typeof prisma).inventory.create({
      data: { tenantId, productId, locationId, qtyOnHand: qtyReceived },
    });
  }
}

// ─── Sale: Get COGS per unit for a sale ────────────────────────────────────

export interface CogsSaleResult {
  unitCostCents: number;
  totalCostCents: number;
  method: "FIFO" | "WAC";
  lotsConsumed?: Array<{ lotId: string; qty: number; unitCostCents: number }>;
}

export async function consumeInventoryForSale(params: {
  tenantId: string;
  productId: string;
  locationId: string;
  qtySold: number;
  tx?: Prisma.TransactionClient;
}): Promise<CogsSaleResult | null> {
  const { tenantId, productId, locationId, qtySold, tx } = params;
  const db = tx ?? prisma;

  const product = await (db as typeof prisma).product.findUnique({
    where: { id: productId },
    select: {
      averageCostCents: true,
      productCategory: { select: { costingMethod: true, isFuelCategory: true } },
    },
  });

  if (!product) return null;

  const isFifo = product.productCategory?.isFuelCategory ||
    product.productCategory?.costingMethod === "FIFO";

  if (isFifo) {
    // FIFO: consume oldest lots first
    let remaining = qtySold;
    const lotsConsumed: Array<{ lotId: string; qty: number; unitCostCents: number }> = [];
    let totalCost = 0;

    try {
      const lots = await (db as typeof prisma).inventoryLot.findMany({
        where: { productId, locationId, qtyRemaining: { gt: 0 } },
        orderBy: { receivedAt: "asc" },
      });

      for (const lot of lots) {
        if (remaining <= 0) break;
        const consumed = Math.min(remaining, lot.qtyRemaining);
        lotsConsumed.push({ lotId: lot.id, qty: consumed, unitCostCents: lot.unitCostCents });
        totalCost += consumed * lot.unitCostCents;
        remaining -= consumed;

        await (db as typeof prisma).inventoryLot.update({
          where: { id: lot.id },
          data: { qtyRemaining: { decrement: consumed } },
        });
      }
    } catch {
      console.warn("[costing-engine] InventoryLot not available, falling back to averageCostCents");
      const wacCost = (product.averageCostCents ?? 0) * qtySold;
      return { unitCostCents: product.averageCostCents ?? 0, totalCostCents: wacCost, method: "WAC" };
    }

    // Decrement QOH
    await (db as typeof prisma).inventory.updateMany({
      where: { productId, locationId },
      data: { qtyOnHand: { decrement: qtySold } },
    });

    const unitCost = qtySold > 0 ? Math.round(totalCost / qtySold) : 0;
    return { unitCostCents: unitCost, totalCostCents: totalCost, method: "FIFO", lotsConsumed };
  } else {
    // WAC: use averageCostCents
    const unitCost = product.averageCostCents ?? 0;
    const totalCost = unitCost * qtySold;

    await (db as typeof prisma).inventory.updateMany({
      where: { productId, locationId },
      data: { qtyOnHand: { decrement: qtySold } },
    });

    return { unitCostCents: unitCost, totalCostCents: totalCost, method: "WAC" };
  }
}

// ─── Return: Restore inventory on a return/refund ──────────────────────────

export async function restoreInventoryOnReturn(params: {
  tenantId: string;
  productId: string;
  locationId: string;
  qtyReturned: number;
  tx?: Prisma.TransactionClient;
}): Promise<{ unitCostCents: number; totalCostCents: number }> {
  const { tenantId, productId, locationId, qtyReturned, tx } = params;
  const db = tx ?? prisma;

  // Returns always go back at current WAC (not sale price, not FIFO lot).
  // This is standard accounting practice.
  const product = await (db as typeof prisma).product.findUnique({
    where: { id: productId },
    select: { averageCostCents: true },
  });

  const unitCost = product?.averageCostCents ?? 0;
  const totalCost = unitCost * qtyReturned;

  // Restore QOH
  await (db as typeof prisma).inventory.updateMany({
    where: { productId, locationId },
    data: { qtyOnHand: { increment: qtyReturned } },
  });

  // Note: For FIFO, we do NOT put items back into specific lots.
  // They return at current WAC. This simplifies the accounting.

  return { unitCostCents: unitCost, totalCostCents: totalCost };
}
