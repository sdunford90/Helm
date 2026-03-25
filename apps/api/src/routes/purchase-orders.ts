import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { clerkAuth } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";

const router = Router();

// ─── Zod Schemas ─────────────────────────────────────────────────────────────

const PurchaseOrderStatusEnum = z.enum([
  "DRAFT",
  "SUBMITTED",
  "APPROVED",
  "ORDERED",
  "PARTIALLY_RECEIVED",
  "RECEIVED",
  "CANCELLED",
]);

const LineItemSchema = z.object({
  productId: z.string().uuid(),
  quantityOrdered: z.number().int().positive(),
  unitCostCents: z.number().int().min(0),
  notes: z.string().optional().nullable(),
});

const CreatePurchaseOrderSchema = z.object({
  vendorName: z.string().min(1),
  vendorEmail: z.string().email().optional().nullable(),
  expectedDeliveryDate: z.string().datetime().optional().nullable(),
  notes: z.string().optional().nullable(),
  lineItems: z.array(LineItemSchema).min(1),
});

const ReceiveItemSchema = z.object({
  lineItemId: z.string().uuid(),
  quantityReceived: z.number().int().positive(),
});

// ─── Helpers ────────────────────────────────────────────────────────────────

function appError(message: string, statusCode: number, code: string): Error {
  const err = new Error(message) as Error & { statusCode: number; code: string };
  err.statusCode = statusCode;
  err.code = code;
  return err;
}

// ─── Routes ─────────────────────────────────────────────────────────────────

router.use(...clerkAuth());

// GET /api/purchase-orders — List purchase orders
router.get(
  "/",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = (req as any).tenantId;
      const status = req.query.status as string | undefined;

      const where: Record<string, unknown> = { tenantId };
      if (status) where.status = status;

      const orders = await prisma.purchaseOrder.findMany({
        where,
        include: {
          lineItems: {
            include: { product: { select: { id: true, name: true, sku: true } } },
          },
        },
        orderBy: { createdAt: "desc" },
      });

      res.json({ data: orders });
    } catch (err) {
      next(err);
    }
  },
);

// GET /api/purchase-orders/:id — PO detail
router.get(
  "/:id",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = (req as any).tenantId;

      const order = await prisma.purchaseOrder.findFirst({
        where: { id: req.params.id, tenantId },
        include: {
          lineItems: {
            include: { product: true },
          },
        },
      });

      if (!order) throw appError("Purchase order not found", 404, "NOT_FOUND");
      res.json({ data: order });
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/purchase-orders — Create PO
router.post(
  "/",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = (req as any).tenantId;
      const body = CreatePurchaseOrderSchema.parse(req.body);

      const totalCents = body.lineItems.reduce(
        (sum, li) => sum + li.quantityOrdered * li.unitCostCents,
        0,
      );

      // Generate PO number
      const count = await prisma.purchaseOrder.count({ where: { tenantId } });
      const poNumber = `PO-${String(count + 1).padStart(5, "0")}`;

      const order = await prisma.purchaseOrder.create({
        data: {
          tenantId,
          poNumber,
          vendorName: body.vendorName,
          vendorEmail: body.vendorEmail ?? null,
          expectedDeliveryDate: body.expectedDeliveryDate
            ? new Date(body.expectedDeliveryDate)
            : null,
          notes: body.notes ?? null,
          status: "DRAFT",
          totalCents,
          lineItems: {
            create: body.lineItems.map((li) => ({
              tenantId,
              productId: li.productId,
              quantityOrdered: li.quantityOrdered,
              quantityReceived: 0,
              unitCostCents: li.unitCostCents,
              notes: li.notes ?? null,
            })),
          },
        },
        include: {
          lineItems: {
            include: { product: { select: { id: true, name: true, sku: true } } },
          },
        },
      });

      await prisma.auditLog.create({
        data: {
          tenantId,
          userId: (req as any).userId,
          recordType: "PurchaseOrder",
          recordId: order.id,
          action: "CREATED",
        },
      });

      res.status(201).json({ data: order });
    } catch (err) {
      next(err);
    }
  },
);

// PUT /api/purchase-orders/:id/status — Update PO status
router.put(
  "/:id/status",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = (req as any).tenantId;
      const { status } = z.object({ status: PurchaseOrderStatusEnum }).parse(req.body);

      const existing = await prisma.purchaseOrder.findFirst({
        where: { id: req.params.id, tenantId },
      });
      if (!existing) throw appError("Purchase order not found", 404, "NOT_FOUND");

      const updated = await prisma.purchaseOrder.update({
        where: { id: req.params.id },
        data: { status },
      });

      await prisma.auditLog.create({
        data: {
          tenantId,
          userId: (req as any).userId,
          recordType: "PurchaseOrder",
          recordId: updated.id,
          action: "STATUS_CHANGED",
          changedFieldsJson: { from: existing.status, to: status },
        },
      });

      res.json({ data: updated });
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/purchase-orders/:id/receive — Receive items and update inventory
router.post(
  "/:id/receive",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = (req as any).tenantId;
      const { lineItemId, quantityReceived } = ReceiveItemSchema.parse(req.body);

      const order = await prisma.purchaseOrder.findFirst({
        where: { id: req.params.id, tenantId },
        include: { lineItems: true },
      });
      if (!order) throw appError("Purchase order not found", 404, "NOT_FOUND");

      const lineItem = order.lineItems.find((li) => li.id === lineItemId);
      if (!lineItem) throw appError("Line item not found", 404, "LINE_ITEM_NOT_FOUND");

      const newReceived = lineItem.quantityReceived + quantityReceived;
      if (newReceived > lineItem.quantityOrdered) {
        throw appError("Cannot receive more than ordered quantity", 400, "OVER_RECEIVED");
      }

      // Update line item received quantity
      await prisma.purchaseOrderLineItem.update({
        where: { id: lineItemId },
        data: { quantityReceived: newReceived },
      });

      // Update product inventory
      await prisma.inventory.updateMany({
        where: { productId: lineItem.productId, tenantId },
        data: { qtyOnHand: { increment: quantityReceived } },
      });

      // Check if all items fully received
      const updatedOrder = await prisma.purchaseOrder.findFirst({
        where: { id: req.params.id },
        include: { lineItems: true },
      });

      const allReceived = updatedOrder?.lineItems.every(
        (li) => li.quantityReceived >= li.quantityOrdered,
      );
      const someReceived = updatedOrder?.lineItems.some(
        (li) => li.quantityReceived > 0,
      );

      let newStatus = order.status;
      if (allReceived) {
        newStatus = "RECEIVED";
      } else if (someReceived) {
        newStatus = "PARTIALLY_RECEIVED";
      }

      if (newStatus !== order.status) {
        await prisma.purchaseOrder.update({
          where: { id: req.params.id },
          data: { status: newStatus },
        });
      }

      await prisma.auditLog.create({
        data: {
          tenantId,
          userId: (req as any).userId,
          recordType: "PurchaseOrder",
          recordId: order.id,
          action: "ITEMS_RECEIVED",
          changedFieldsJson: { lineItemId, quantityReceived, newStatus },
        },
      });

      res.json({ data: { lineItemId, quantityReceived: newReceived, orderStatus: newStatus } });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
