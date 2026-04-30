import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { clerkAuth, requireRole } from "../middleware/auth.js";
import { postInventoryReceipt } from "../services/gl-posting.js";
import { syncInventoryItems } from "../services/qbo-sync.js";

const router = Router();

// All PO routes require authentication and at minimum manager/accounting role
router.use(clerkAuth());

// ---------------------------------------------------------------------------
// GET /api/purchase-orders
// List POs for a location
// ---------------------------------------------------------------------------
router.get("/", async (req, res) => {
  try {
    const { locationId, status } = req.query as Record<string, string>;
    const tenantId = req.tenantId!;

    const where: any = { tenantId };
    if (locationId) where.locationId = locationId;
    if (status) where.status = status;

    const orders = await prisma.purchaseOrder.findMany({
      where,
      include: {
        items: {
          include: {
            product: { select: { id: true, name: true, sku: true } },
          },
        },
        location: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    res.json(orders);
  } catch (err) {
    console.error("[purchase-orders] GET / error", err);
    res.status(500).json({ error: "Failed to fetch purchase orders" });
  }
});

// ---------------------------------------------------------------------------
// GET /api/purchase-orders/:id
// ---------------------------------------------------------------------------
router.get("/:id", async (req, res) => {
  try {
    const order = await prisma.purchaseOrder.findFirst({
      where: { id: req.params.id, tenantId: req.tenantId! },
      include: {
        items: {
          include: {
            product: { select: { id: true, name: true, sku: true, costCents: true, costingMethod: true } },
          },
        },
        receipts: {
          include: {
            items: { include: { product: { select: { id: true, name: true } } } },
          },
          orderBy: { receivedAt: "desc" },
        },
        location: { select: { id: true, name: true } },
      },
    });

    if (!order) return res.status(404).json({ error: "Purchase order not found" });

    res.json(order);
  } catch (err) {
    console.error("[purchase-orders] GET /:id error", err);
    res.status(500).json({ error: "Failed to fetch purchase order" });
  }
});

// ---------------------------------------------------------------------------
// POST /api/purchase-orders
// Create a new PO
// ---------------------------------------------------------------------------
router.post(
  "/",
  requireRole("MARINA_OWNER", "MARINA_MANAGER", "ACCOUNTING"),
  async (req, res) => {
    try {
      const { locationId, vendorName, expectedDate, notes, items } = req.body;
      const tenantId = req.tenantId!;

      if (!locationId) return res.status(400).json({ error: "locationId is required" });
      if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: "At least one line item is required" });
      }

      // Validate items
      for (const item of items) {
        if (!item.productId || !item.quantityOrdered || !item.unitCostCents) {
          return res.status(400).json({ error: "Each item requires productId, quantityOrdered, unitCostCents" });
        }
      }

      const totalCents = items.reduce(
        (sum: number, item: any) => sum + item.quantityOrdered * item.unitCostCents,
        0,
      );

      const order = await prisma.purchaseOrder.create({
        data: {
          tenantId,
          locationId,
          vendorName: vendorName ?? null,
          expectedDate: expectedDate ? new Date(expectedDate) : null,
          notes: notes ?? null,
          totalCents,
          status: "DRAFT",
          createdBy: req.user?.id ?? null,
          items: {
            create: items.map((item: any) => ({
              productId: item.productId,
              quantityOrdered: item.quantityOrdered,
              unitCostCents: item.unitCostCents,
              extendedCents: item.quantityOrdered * item.unitCostCents,
            })),
          },
        },
        include: { items: { include: { product: { select: { id: true, name: true, sku: true } } } } },
      });

      res.status(201).json(order);
    } catch (err) {
      console.error("[purchase-orders] POST / error", err);
      res.status(500).json({ error: "Failed to create purchase order" });
    }
  },
);

// ---------------------------------------------------------------------------
// PUT /api/purchase-orders/:id
// Update PO (only DRAFT status)
// ---------------------------------------------------------------------------
router.put(
  "/:id",
  requireRole("MARINA_OWNER", "MARINA_MANAGER", "ACCOUNTING"),
  async (req, res) => {
    try {
      const { vendorName, expectedDate, notes, items } = req.body;
      const tenantId = req.tenantId!;

      const existing = await prisma.purchaseOrder.findFirst({
        where: { id: req.params.id, tenantId },
      });

      if (!existing) return res.status(404).json({ error: "Purchase order not found" });
      if (existing.status !== "DRAFT") {
        return res.status(400).json({ error: "Only DRAFT purchase orders can be edited" });
      }

      const totalCents = items
        ? items.reduce((sum: number, item: any) => sum + item.quantityOrdered * item.unitCostCents, 0)
        : existing.totalCents;

      const order = await prisma.$transaction(async (tx) => {
        if (items) {
          await tx.purchaseOrderItem.deleteMany({ where: { purchaseOrderId: req.params.id } });
        }

        return tx.purchaseOrder.update({
          where: { id: req.params.id },
          data: {
            vendorName: vendorName ?? existing.vendorName,
            expectedDate: expectedDate ? new Date(expectedDate) : existing.expectedDate,
            notes: notes ?? existing.notes,
            totalCents,
            ...(items
              ? {
                  items: {
                    create: items.map((item: any) => ({
                      productId: item.productId,
                      quantityOrdered: item.quantityOrdered,
                      unitCostCents: item.unitCostCents,
                      extendedCents: item.quantityOrdered * item.unitCostCents,
                    })),
                  },
                }
              : {}),
          },
          include: { items: { include: { product: { select: { id: true, name: true } } } } },
        });
      });

      res.json(order);
    } catch (err) {
      console.error("[purchase-orders] PUT /:id error", err);
      res.status(500).json({ error: "Failed to update purchase order" });
    }
  },
);

// ---------------------------------------------------------------------------
// POST /api/purchase-orders/:id/submit
// Submit PO for receiving
// ---------------------------------------------------------------------------
router.post(
  "/:id/submit",
  requireRole("MARINA_OWNER", "MARINA_MANAGER", "ACCOUNTING"),
  async (req, res) => {
    try {
      const order = await prisma.purchaseOrder.findFirst({
        where: { id: req.params.id, tenantId: req.tenantId! },
      });

      if (!order) return res.status(404).json({ error: "Purchase order not found" });
      if (order.status !== "DRAFT") {
        return res.status(400).json({ error: "Only DRAFT orders can be submitted" });
      }

      const updated = await prisma.purchaseOrder.update({
        where: { id: req.params.id },
        data: { status: "SUBMITTED" },
      });

      res.json(updated);
    } catch (err) {
      res.status(500).json({ error: "Failed to submit purchase order" });
    }
  },
);

// ---------------------------------------------------------------------------
// POST /api/purchase-orders/:id/receive
// Receive inventory against a PO — this is the core COGS/cost capture flow
//
// Body: { items: [{ purchaseOrderItemId, quantityReceived, unitCostCents }], notes? }
//
// On success:
//   1. Creates InventoryReceipt + InventoryReceiptItems
//   2. Updates PO item quantityReceived
//   3. Updates QOH in Inventory table
//   4. Creates FIFO cost layers (or recalculates WAC)
//   5. Posts GL: DR Inventory Asset / CR Accounts Payable
//   6. Pushes QOH update to QBO
//   7. Updates PO status to PARTIAL or RECEIVED
// ---------------------------------------------------------------------------
router.post(
  "/:id/receive",
  requireRole("MARINA_OWNER", "MARINA_MANAGER", "ACCOUNTING"),
  async (req, res) => {
    try {
      const { items, notes } = req.body;
      const tenantId = req.tenantId!;

      if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: "At least one item is required" });
      }

      const order = await prisma.purchaseOrder.findFirst({
        where: { id: req.params.id, tenantId },
        include: {
          items: { include: { product: true } },
          location: true,
        },
      });

      if (!order) return res.status(404).json({ error: "Purchase order not found" });
      if (order.status === "RECEIVED" || order.status === "CANCELLED") {
        return res.status(400).json({ error: `Cannot receive against a ${order.status} order` });
      }

      const locationId = order.locationId;

      // Validate each item being received
      for (const recv of items) {
        const poItem = order.items.find((i) => i.id === recv.purchaseOrderItemId);
        if (!poItem) {
          return res.status(400).json({ error: `PO item ${recv.purchaseOrderItemId} not found` });
        }
        const remaining = poItem.quantityOrdered - poItem.quantityReceived;
        if (recv.quantityReceived > remaining) {
          return res.status(400).json({
            error: `Cannot receive ${recv.quantityReceived} of ${poItem.product.name} — only ${remaining} remaining`,
          });
        }
      }

      const totalReceiptCostCents = items.reduce(
        (sum: number, item: any) => sum + item.quantityReceived * item.unitCostCents,
        0,
      );

      const receipt = await prisma.$transaction(async (tx) => {
        // 1. Create receipt record
        const receipt = await tx.inventoryReceipt.create({
          data: {
            tenantId,
            locationId,
            purchaseOrderId: order.id,
            receivedBy: req.user?.id ?? null,
            notes: notes ?? null,
            items: {
              create: items.map((item: any) => ({
                productId: order.items.find((i) => i.id === item.purchaseOrderItemId)!.productId,
                quantityReceived: item.quantityReceived,
                unitCostCents: item.unitCostCents,
              })),
            },
          },
          include: { items: { include: { product: true } } },
        });

        // 2. Update PO item quantities + update product cost + create FIFO layers or WAC
        for (const recv of items) {
          const poItem = order.items.find((i) => i.id === recv.purchaseOrderItemId)!;
          const product = poItem.product;

          await tx.purchaseOrderItem.update({
            where: { id: recv.purchaseOrderItemId },
            data: { quantityReceived: { increment: recv.quantityReceived } },
          });

          // 3. Update QOH
          await tx.inventory.upsert({
            where: {
              // Prisma needs a unique constraint — use findFirst pattern
              id: (await prisma.inventory.findFirst({
                where: { tenantId, productId: product.id, locationId },
                select: { id: true },
              }))?.id ?? "new",
            },
            create: {
              tenantId,
              productId: product.id,
              locationId,
              qtyOnHand: recv.quantityReceived,
            },
            update: { qtyOnHand: { increment: recv.quantityReceived } },
          });

          if (product.costingMethod === "FIFO") {
            // 4a. Create FIFO cost layer
            await tx.inventoryLayer.create({
              data: {
                tenantId,
                locationId,
                productId: product.id,
                receiptId: receipt.id,
                quantityRemaining: recv.quantityReceived,
                unitCostCents: recv.unitCostCents,
                receivedAt: new Date(),
              },
            });
          } else {
            // 4b. Recalculate WAC
            const inventory = await tx.inventory.findFirst({
              where: { tenantId, productId: product.id, locationId },
              select: { qtyOnHand: true },
            });
            const currentQty = (inventory?.qtyOnHand ?? 0) - recv.quantityReceived; // before this receipt
            const currentCost = product.costCents ?? 0;
            const newQty = currentQty + recv.quantityReceived;
            const newWac = newQty > 0
              ? Math.round((currentQty * currentCost + recv.quantityReceived * recv.unitCostCents) / newQty)
              : recv.unitCostCents;

            await tx.product.update({
              where: { id: product.id },
              data: { costCents: newWac },
            });
          }
        }

        // 5. Post GL: DR Inventory Asset / CR Accounts Payable
        const journalId = await postInventoryReceipt(
          { receiptId: receipt.id, tenantId, locationId, totalCostCents: totalReceiptCostCents },
          tx,
        );

        // Store journalId on receipt
        await tx.inventoryReceipt.update({
          where: { id: receipt.id },
          data: { glJournalId: journalId },
        });

        // 6. Update PO status
        const allItems = await tx.purchaseOrderItem.findMany({ where: { purchaseOrderId: order.id } });
        const allFullyReceived = allItems.every((i) => i.quantityReceived >= i.quantityOrdered);
        const anyReceived = allItems.some((i) => i.quantityReceived > 0);

        await tx.purchaseOrder.update({
          where: { id: order.id },
          data: { status: allFullyReceived ? "RECEIVED" : anyReceived ? "PARTIAL" : "SUBMITTED" },
        });

        return receipt;
      });

      // 7. Push QOH to QBO in background (non-blocking)
      if (order.location.qboConnected) {
        syncInventoryItems(locationId, tenantId).catch((err) => {
          console.error("[purchase-orders] QOH push to QBO failed", err);
        });
      }

      res.status(201).json(receipt);
    } catch (err) {
      console.error("[purchase-orders] POST /:id/receive error", err);
      res.status(500).json({ error: "Failed to receive inventory" });
    }
  },
);

// ---------------------------------------------------------------------------
// GET /api/purchase-orders/products/:productId/layers
// View FIFO cost layers for a product at a location
// ---------------------------------------------------------------------------
router.get("/products/:productId/layers", async (req, res) => {
  try {
    const { locationId } = req.query as Record<string, string>;
    const tenantId = req.tenantId!;

    const layers = await prisma.inventoryLayer.findMany({
      where: {
        tenantId,
        productId: req.params.productId,
        ...(locationId ? { locationId } : {}),
        quantityRemaining: { gt: 0 },
      },
      orderBy: { receivedAt: "asc" }, // FIFO — oldest first
    });

    const totalQty = layers.reduce((s, l) => s + l.quantityRemaining, 0);
    const totalValue = layers.reduce((s, l) => s + l.quantityRemaining * l.unitCostCents, 0);

    res.json({ layers, totalQty, totalValueCents: totalValue });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch inventory layers" });
  }
});

export { router as purchaseOrdersRouter };
