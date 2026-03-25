import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { clerkAuth } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";

const router = Router();

// ─── Zod Schemas ─────────────────────────────────────────────────────────────

const ListProductsQuerySchema = z.object({
  category: z.string().optional(),
  active: z.coerce.boolean().optional(),
  search: z.string().optional(),
  skip: z.coerce.number().int().min(0).default(0),
  take: z.coerce.number().int().positive().max(100).default(25),
  sortBy: z.enum(["name", "priceCents", "createdAt"]).default("name"),
  sortOrder: z.enum(["asc", "desc"]).default("asc"),
});

const CreateProductSchema = z.object({
  name: z.string().min(1),
  sku: z.string().optional().nullable(),
  barcode: z.string().optional().nullable(),
  departmentId: z.string().optional().nullable(),
  costCents: z.number().int().optional().nullable(),
  priceCents: z.number().int().min(0),
  taxClass: z.string().optional().nullable(),
  trackInventory: z.boolean().optional(),
  reorderQty: z.number().int().optional().nullable(),
});

const UpdateProductSchema = z.object({
  name: z.string().min(1).optional(),
  sku: z.string().optional().nullable(),
  barcode: z.string().optional().nullable(),
  departmentId: z.string().optional().nullable(),
  costCents: z.number().int().optional().nullable(),
  priceCents: z.number().int().min(0).optional(),
  taxClass: z.string().optional().nullable(),
  trackInventory: z.boolean().optional(),
  reorderQty: z.number().int().optional().nullable(),
});

const CreateTransactionLineItemSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number().int().positive(),
  discountCents: z.number().int().min(0).default(0),
});

const CreateTransactionSchema = z.object({
  lineItems: z.array(CreateTransactionLineItemSchema).min(1),
  customerId: z.string().uuid().optional().nullable(),
  paymentMethod: z.enum(["CASH", "CARD", "ACH", "CHARGE_TO_ACCOUNT"]).default("CASH"),
  shiftId: z.string().uuid().optional().nullable(),
  tipCents: z.number().int().min(0).default(0),
});

const ListTransactionsQuerySchema = z.object({
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
  paymentMethod: z.enum(["CASH", "CARD", "ACH", "CHARGE_TO_ACCOUNT"]).optional(),
  status: z.string().optional(),
  skip: z.coerce.number().int().min(0).default(0),
  take: z.coerce.number().int().positive().max(100).default(25),
});

const RefundSchema = z.object({
  lineItems: z
    .array(
      z.object({
        lineItemId: z.string().uuid(),
        quantity: z.number().int().positive(),
      }),
    )
    .optional(),
  reason: z.string().optional(),
});

const AdjustInventorySchema = z.object({
  quantity: z.number().int(),
  reason: z.string().optional(),
});

const OpenShiftSchema = z.object({
  openingFloatCents: z.number().int().min(0),
  locationId: z.string().optional().nullable(),
});

const CloseShiftSchema = z.object({
  closingCashCents: z.number().int().min(0),
  notes: z.string().optional().nullable(),
});

const DailyReportQuerySchema = z.object({
  date: z.coerce.date().optional(),
});

// ─── Helpers ────────────────────────────────────────────────────────────────

function appError(message: string, statusCode: number, code: string): Error {
  const err = new Error(message) as Error & {
    statusCode: number;
    code: string;
  };
  err.statusCode = statusCode;
  err.code = code;
  return err;
}

// ─── Authenticated routes ───────────────────────────────────────────────────

router.use(...clerkAuth());

// ─── GET /products — List products ──────────────────────────────────────────

router.get(
  "/products",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const query = ListProductsQuerySchema.parse(req.query);

      const where: Record<string, unknown> = { tenantId };

      if (query.category) where.departmentId = query.category;

      if (query.search) {
        const search = query.search;
        where.OR = [
          { name: { contains: search, mode: "insensitive" } },
          { sku: { contains: search, mode: "insensitive" } },
          { barcode: { contains: search, mode: "insensitive" } },
        ];
      }

      const [products, total] = await Promise.all([
        prisma.product.findMany({
          where,
          orderBy: { [query.sortBy]: query.sortOrder },
          skip: query.skip,
          take: query.take,
          include: {
            inventory: {
              select: { id: true, qtyOnHand: true, qtyOnOrder: true, lastCountDate: true },
            },
          },
        }),
        prisma.product.count({ where }),
      ]);

      res.json({
        data: products,
        pagination: {
          skip: query.skip,
          take: query.take,
          total,
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

// ─── GET /products/:id — Single product with inventory ──────────────────────

router.get(
  "/products/:id",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;

      const product = await prisma.product.findFirst({
        where: { id: req.params.id, tenantId },
        include: {
          inventory: true,
        },
      });

      if (!product) {
        throw appError("Product not found", 404, "NOT_FOUND");
      }

      res.json(product);
    } catch (err) {
      next(err);
    }
  },
);

// ─── POST /products — Create product ────────────────────────────────────────

router.post(
  "/products",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const data = CreateProductSchema.parse(req.body);

      const product = await prisma.product.create({
        data: {
          tenantId,
          ...data,
        },
      });

      // Auto-create inventory record if tracking inventory
      if (data.trackInventory) {
        await prisma.inventory.create({
          data: {
            tenantId,
            productId: product.id,
            qtyOnHand: 0,
            qtyOnOrder: 0,
          },
        });
      }

      await prisma.auditLog.create({
        data: {
          tenantId,
          userId: req.userId,
          userName: req.userRecord?.email,
          recordType: "Product",
          recordId: product.id,
          action: "CREATED",
        },
      });

      res.status(201).json(product);
    } catch (err) {
      next(err);
    }
  },
);

// ─── PUT /products/:id — Update product ─────────────────────────────────────

router.put(
  "/products/:id",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const data = UpdateProductSchema.parse(req.body);

      const existing = await prisma.product.findFirst({
        where: { id: req.params.id, tenantId },
      });
      if (!existing) {
        throw appError("Product not found", 404, "NOT_FOUND");
      }

      const updated = await prisma.product.update({
        where: { id: req.params.id },
        data,
      });

      // If trackInventory was just turned on, ensure inventory record exists
      if (data.trackInventory && !existing.trackInventory) {
        const existingInv = await prisma.inventory.findFirst({
          where: { productId: updated.id, tenantId },
        });
        if (!existingInv) {
          await prisma.inventory.create({
            data: {
              tenantId,
              productId: updated.id,
              qtyOnHand: 0,
              qtyOnOrder: 0,
            },
          });
        }
      }

      const changedFields: Record<string, unknown> = {};
      for (const key of Object.keys(data) as (keyof typeof data)[]) {
        if (data[key] !== undefined) {
          changedFields[key] = {
            from: (existing as Record<string, unknown>)[key],
            to: data[key],
          };
        }
      }

      await prisma.auditLog.create({
        data: {
          tenantId,
          userId: req.userId,
          recordType: "Product",
          recordId: updated.id,
          action: "UPDATED",
          changedFieldsJson: changedFields,
        },
      });

      res.json(updated);
    } catch (err) {
      next(err);
    }
  },
);

// ─── DELETE /products/:id — Deactivate product ─────────────────────────────

router.delete(
  "/products/:id",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;

      const product = await prisma.product.findFirst({
        where: { id: req.params.id, tenantId },
      });
      if (!product) {
        throw appError("Product not found", 404, "NOT_FOUND");
      }

      // Soft-delete: we mark trackInventory false and remove from active catalog
      // Since Product model doesn't have an "active" field, we use a convention
      // of setting the name prefix or using departmentId = "__DEACTIVATED__"
      const updated = await prisma.product.update({
        where: { id: req.params.id },
        data: { departmentId: "__DEACTIVATED__" },
      });

      await prisma.auditLog.create({
        data: {
          tenantId,
          userId: req.userId,
          recordType: "Product",
          recordId: updated.id,
          action: "DEACTIVATED",
        },
      });

      res.json(updated);
    } catch (err) {
      next(err);
    }
  },
);

// ─── POST /transactions — Create POS transaction ────────────────────────────

router.post(
  "/transactions",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const body = CreateTransactionSchema.parse(req.body);

      // Resolve products and calculate totals
      const productIds = body.lineItems.map((li) => li.productId);
      const products = await prisma.product.findMany({
        where: { id: { in: productIds }, tenantId },
      });

      const productMap = new Map(products.map((p) => [p.id, p]));

      let subtotalCents = 0;
      let taxCents = 0;
      let totalDiscountCents = 0;

      const lineItemsData = body.lineItems.map((li) => {
        const product = productMap.get(li.productId);
        if (!product) {
          throw appError(
            `Product not found: ${li.productId}`,
            400,
            "PRODUCT_NOT_FOUND",
          );
        }

        const unitPrice = product.priceCents;
        const lineSubtotal = unitPrice * li.quantity;
        const discount = li.discountCents;
        // Calculate tax: default 7% if no taxClass, otherwise use taxClass as percentage
        const taxRate = product.taxClass ? parseFloat(product.taxClass) / 100 : 0.07;
        const lineTax = Math.round((lineSubtotal - discount) * taxRate);
        const lineTotal = lineSubtotal - discount + lineTax;

        subtotalCents += lineSubtotal;
        taxCents += lineTax;
        totalDiscountCents += discount;

        return {
          productId: product.id,
          quantity: li.quantity,
          unitPriceCents: unitPrice,
          discountCents: discount,
          taxCents: lineTax,
          extendedCents: lineTotal,
        };
      });

      const totalCents = subtotalCents - totalDiscountCents + taxCents + body.tipCents;

      const transaction = await prisma.posTransaction.create({
        data: {
          tenantId,
          cashierId: req.userId ?? null,
          shiftId: body.shiftId ?? null,
          subtotalCents,
          taxCents,
          tipCents: body.tipCents,
          totalCents,
          status: "COMPLETED",
          lineItems: {
            create: lineItemsData,
          },
        },
        include: {
          lineItems: {
            include: {
              product: { select: { id: true, name: true, sku: true } },
            },
          },
        },
      });

      // Decrement inventory for tracked products
      for (const li of body.lineItems) {
        const product = productMap.get(li.productId);
        if (product?.trackInventory) {
          await prisma.inventory.updateMany({
            where: { productId: li.productId, tenantId },
            data: { qtyOnHand: { decrement: li.quantity } },
          });
        }
      }

      await prisma.auditLog.create({
        data: {
          tenantId,
          userId: req.userId,
          userName: req.userRecord?.email,
          recordType: "PosTransaction",
          recordId: transaction.id,
          action: "CREATED",
          changedFieldsJson: {
            totalCents,
            lineItemCount: lineItemsData.length,
            paymentMethod: body.paymentMethod,
          },
        },
      });

      res.status(201).json(transaction);
    } catch (err) {
      next(err);
    }
  },
);

// ─── GET /transactions — List transactions ──────────────────────────────────

router.get(
  "/transactions",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const query = ListTransactionsQuerySchema.parse(req.query);

      const where: Record<string, unknown> = { tenantId };

      if (query.status) where.status = query.status;

      if (query.dateFrom || query.dateTo) {
        const createdAt: Record<string, unknown> = {};
        if (query.dateFrom) createdAt.gte = query.dateFrom;
        if (query.dateTo) createdAt.lte = query.dateTo;
        where.createdAt = createdAt;
      }

      const [transactions, total] = await Promise.all([
        prisma.posTransaction.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip: query.skip,
          take: query.take,
          include: {
            lineItems: {
              include: {
                product: { select: { id: true, name: true, sku: true } },
              },
            },
          },
        }),
        prisma.posTransaction.count({ where }),
      ]);

      res.json({
        data: transactions,
        pagination: {
          skip: query.skip,
          take: query.take,
          total,
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

// ─── GET /transactions/:id — Single transaction with line items ─────────────

router.get(
  "/transactions/:id",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;

      const transaction = await prisma.posTransaction.findFirst({
        where: { id: req.params.id, tenantId },
        include: {
          lineItems: {
            include: {
              product: { select: { id: true, name: true, sku: true } },
            },
          },
          shift: true,
        },
      });

      if (!transaction) {
        throw appError("Transaction not found", 404, "NOT_FOUND");
      }

      res.json(transaction);
    } catch (err) {
      next(err);
    }
  },
);

// ─── POST /transactions/:id/refund — Process refund ─────────────────────────

router.post(
  "/transactions/:id/refund",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const body = RefundSchema.parse(req.body);

      const original = await prisma.posTransaction.findFirst({
        where: { id: req.params.id, tenantId },
        include: { lineItems: true },
      });

      if (!original) {
        throw appError("Transaction not found", 404, "NOT_FOUND");
      }

      if (original.status === "REFUNDED") {
        throw appError("Transaction already refunded", 400, "ALREADY_REFUNDED");
      }

      let refundLineItems;
      let refundSubtotal = 0;
      let refundTax = 0;
      let refundTotal = 0;

      if (body.lineItems && body.lineItems.length > 0) {
        // Partial refund
        const originalItemMap = new Map(
          original.lineItems.map((li) => [li.id, li]),
        );

        refundLineItems = body.lineItems.map((ri) => {
          const origItem = originalItemMap.get(ri.lineItemId);
          if (!origItem) {
            throw appError(
              `Line item not found: ${ri.lineItemId}`,
              400,
              "LINE_ITEM_NOT_FOUND",
            );
          }
          if (ri.quantity > origItem.quantity) {
            throw appError(
              `Refund quantity exceeds original for line item ${ri.lineItemId}`,
              400,
              "QUANTITY_EXCEEDED",
            );
          }

          const ratio = ri.quantity / origItem.quantity;
          const itemSubtotal = Math.round(origItem.unitPriceCents * ri.quantity);
          const itemDiscount = Math.round(origItem.discountCents * ratio);
          const itemTax = Math.round(origItem.taxCents * ratio);
          const itemTotal = itemSubtotal - itemDiscount + itemTax;

          refundSubtotal += itemSubtotal;
          refundTax += itemTax;
          refundTotal += itemTotal;

          return {
            productId: origItem.productId,
            quantity: ri.quantity,
            unitPriceCents: origItem.unitPriceCents,
            discountCents: itemDiscount,
            taxCents: itemTax,
            extendedCents: -itemTotal,
          };
        });
      } else {
        // Full refund
        refundSubtotal = original.subtotalCents;
        refundTax = original.taxCents;
        refundTotal = original.totalCents;

        refundLineItems = original.lineItems.map((li) => ({
          productId: li.productId,
          quantity: li.quantity,
          unitPriceCents: li.unitPriceCents,
          discountCents: li.discountCents,
          taxCents: li.taxCents,
          extendedCents: -li.extendedCents,
        }));
      }

      // Create refund transaction
      const refund = await prisma.posTransaction.create({
        data: {
          tenantId,
          cashierId: req.userId ?? null,
          shiftId: original.shiftId,
          subtotalCents: -refundSubtotal,
          taxCents: -refundTax,
          tipCents: 0,
          totalCents: -refundTotal,
          status: "REFUNDED",
          lineItems: {
            create: refundLineItems,
          },
        },
        include: {
          lineItems: {
            include: {
              product: { select: { id: true, name: true, sku: true } },
            },
          },
        },
      });

      // Mark original as refunded if full refund
      if (!body.lineItems || body.lineItems.length === 0) {
        await prisma.posTransaction.update({
          where: { id: original.id },
          data: { status: "REFUNDED" },
        });
      }

      // Restore inventory for refunded items
      for (const li of refundLineItems) {
        if (li.productId) {
          const product = await prisma.product.findFirst({
            where: { id: li.productId, tenantId },
          });
          if (product?.trackInventory) {
            await prisma.inventory.updateMany({
              where: { productId: li.productId, tenantId },
              data: { qtyOnHand: { increment: li.quantity } },
            });
          }
        }
      }

      await prisma.auditLog.create({
        data: {
          tenantId,
          userId: req.userId,
          userName: req.userRecord?.email,
          recordType: "PosTransaction",
          recordId: refund.id,
          action: "REFUNDED",
          changedFieldsJson: {
            originalTransactionId: original.id,
            refundTotalCents: refundTotal,
            reason: body.reason,
          },
        },
      });

      res.status(201).json(refund);
    } catch (err) {
      next(err);
    }
  },
);

// ─── GET /inventory — Inventory levels across all products ──────────────────

router.get(
  "/inventory",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;

      const inventory = await prisma.inventory.findMany({
        where: { tenantId },
        include: {
          product: {
            select: {
              id: true,
              name: true,
              sku: true,
              priceCents: true,
              trackInventory: true,
              reorderQty: true,
            },
          },
        },
        orderBy: { product: { name: "asc" } },
      });

      res.json({ data: inventory });
    } catch (err) {
      next(err);
    }
  },
);

// ─── PUT /inventory/:productId — Adjust inventory ───────────────────────────

router.put(
  "/inventory/:productId",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const { quantity, reason } = AdjustInventorySchema.parse(req.body);

      const inv = await prisma.inventory.findFirst({
        where: { productId: req.params.productId, tenantId },
      });

      if (!inv) {
        throw appError("Inventory record not found", 404, "NOT_FOUND");
      }

      const updated = await prisma.inventory.update({
        where: { id: inv.id },
        data: {
          qtyOnHand: quantity,
          lastCountDate: new Date(),
        },
      });

      await prisma.auditLog.create({
        data: {
          tenantId,
          userId: req.userId,
          userName: req.userRecord?.email,
          recordType: "Inventory",
          recordId: updated.id,
          action: "ADJUSTED",
          changedFieldsJson: {
            previousQty: inv.qtyOnHand,
            newQty: quantity,
            reason: reason ?? null,
          },
        },
      });

      res.json(updated);
    } catch (err) {
      next(err);
    }
  },
);

// ─── GET /shifts — List shifts ──────────────────────────────────────────────

router.get(
  "/shifts",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;

      const shifts = await prisma.shift.findMany({
        where: { tenantId },
        orderBy: { openedAt: "desc" },
        include: {
          transactions: {
            select: {
              id: true,
              totalCents: true,
              status: true,
            },
          },
        },
      });

      // Enrich with sales totals
      const enriched = shifts.map((shift) => {
        const completedTxns = shift.transactions.filter(
          (t) => t.status === "COMPLETED",
        );
        const salesTotalCents = completedTxns.reduce(
          (sum, t) => sum + t.totalCents,
          0,
        );
        const transactionCount = completedTxns.length;

        return {
          ...shift,
          salesTotalCents,
          transactionCount,
        };
      });

      res.json({ data: enriched });
    } catch (err) {
      next(err);
    }
  },
);

// ─── POST /shifts/open — Open a shift ───────────────────────────────────────

router.post(
  "/shifts/open",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const body = OpenShiftSchema.parse(req.body);

      // Check for existing open shift for this cashier
      const existingOpen = await prisma.shift.findFirst({
        where: {
          tenantId,
          cashierId: req.userId!,
          status: "OPEN",
        },
      });

      if (existingOpen) {
        throw appError(
          "You already have an open shift. Close it before opening a new one.",
          400,
          "SHIFT_ALREADY_OPEN",
        );
      }

      const shift = await prisma.shift.create({
        data: {
          tenantId,
          cashierId: req.userId!,
          openingFloatCents: body.openingFloatCents,
          locationId: body.locationId ?? null,
          status: "OPEN",
        },
      });

      await prisma.auditLog.create({
        data: {
          tenantId,
          userId: req.userId,
          userName: req.userRecord?.email,
          recordType: "Shift",
          recordId: shift.id,
          action: "OPENED",
          changedFieldsJson: {
            openingFloatCents: body.openingFloatCents,
          },
        },
      });

      res.status(201).json(shift);
    } catch (err) {
      next(err);
    }
  },
);

// ─── POST /shifts/:id/close — Close shift ──────────────────────────────────

router.post(
  "/shifts/:id/close",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const body = CloseShiftSchema.parse(req.body);

      const shift = await prisma.shift.findFirst({
        where: { id: req.params.id, tenantId },
        include: {
          transactions: {
            select: { totalCents: true, status: true },
          },
        },
      });

      if (!shift) {
        throw appError("Shift not found", 404, "NOT_FOUND");
      }

      if (shift.status !== "OPEN") {
        throw appError("Shift is not open", 400, "SHIFT_NOT_OPEN");
      }

      // Calculate expected cash: opening float + cash transactions
      const cashSales = shift.transactions
        .filter((t) => t.status === "COMPLETED")
        .reduce((sum, t) => sum + t.totalCents, 0);

      const expectedCashCents = shift.openingFloatCents + cashSales;
      const varianceCents = body.closingCashCents - expectedCashCents;

      const updated = await prisma.shift.update({
        where: { id: shift.id },
        data: {
          closedAt: new Date(),
          closingCashCents: body.closingCashCents,
          status: "CLOSED",
        },
      });

      await prisma.auditLog.create({
        data: {
          tenantId,
          userId: req.userId,
          userName: req.userRecord?.email,
          recordType: "Shift",
          recordId: updated.id,
          action: "CLOSED",
          changedFieldsJson: {
            closingCashCents: body.closingCashCents,
            expectedCashCents,
            varianceCents,
            notes: body.notes ?? null,
          },
        },
      });

      res.json({
        ...updated,
        expectedCashCents,
        varianceCents,
        salesTotalCents: cashSales,
      });
    } catch (err) {
      next(err);
    }
  },
);

// ─── GET /reports/daily — Daily sales summary ───────────────────────────────

router.get(
  "/reports/daily",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const { date } = DailyReportQuerySchema.parse(req.query);

      const targetDate = date ?? new Date();
      const startOfDay = new Date(targetDate);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(targetDate);
      endOfDay.setHours(23, 59, 59, 999);

      const transactions = await prisma.posTransaction.findMany({
        where: {
          tenantId,
          createdAt: { gte: startOfDay, lte: endOfDay },
        },
        include: {
          lineItems: {
            include: {
              product: { select: { id: true, name: true, departmentId: true } },
            },
          },
        },
      });

      const completed = transactions.filter((t) => t.status === "COMPLETED");
      const refunded = transactions.filter((t) => t.status === "REFUNDED");

      const totalSalesCents = completed.reduce(
        (sum, t) => sum + t.totalCents,
        0,
      );
      const totalRefundsCents = refunded.reduce(
        (sum, t) => sum + Math.abs(t.totalCents),
        0,
      );
      const netSalesCents = totalSalesCents - totalRefundsCents;
      const totalTaxCents = completed.reduce((sum, t) => sum + t.taxCents, 0);
      const totalTipsCents = completed.reduce((sum, t) => sum + t.tipCents, 0);

      // Category breakdown
      const categoryBreakdown: Record<
        string,
        { count: number; totalCents: number }
      > = {};
      for (const txn of completed) {
        for (const li of txn.lineItems) {
          const cat = li.product?.departmentId ?? "Uncategorized";
          if (!categoryBreakdown[cat]) {
            categoryBreakdown[cat] = { count: 0, totalCents: 0 };
          }
          categoryBreakdown[cat].count += li.quantity;
          categoryBreakdown[cat].totalCents += li.extendedCents;
        }
      }

      // Top products
      const productSales: Record<
        string,
        { name: string; quantity: number; totalCents: number }
      > = {};
      for (const txn of completed) {
        for (const li of txn.lineItems) {
          const pid = li.productId ?? "unknown";
          if (!productSales[pid]) {
            productSales[pid] = {
              name: li.product?.name ?? "Unknown",
              quantity: 0,
              totalCents: 0,
            };
          }
          productSales[pid].quantity += li.quantity;
          productSales[pid].totalCents += li.extendedCents;
        }
      }

      const topProducts = Object.entries(productSales)
        .map(([id, data]) => ({ id, ...data }))
        .sort((a, b) => b.totalCents - a.totalCents)
        .slice(0, 10);

      res.json({
        date: startOfDay.toISOString().split("T")[0],
        transactionCount: completed.length,
        refundCount: refunded.length,
        totalSalesCents,
        totalRefundsCents,
        netSalesCents,
        totalTaxCents,
        totalTipsCents,
        categoryBreakdown,
        topProducts,
      });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
