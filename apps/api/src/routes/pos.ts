import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { clerkAuth } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";

const router: Router = Router();

// ─── Zod Schemas ─────────────────────────────────────────────────────────────

const ListProductsQuerySchema = z.object({
  category: z.string().optional(),
  active: z.coerce.boolean().optional(),
  search: z.string().optional(),
  skip: z.coerce.number().int().min(0).default(0),
  take: z.coerce.number().int().positive().max(100).default(25),
  sortBy: z
    .enum(["name", "priceCents", "sku", "createdAt"])
    .default("name"),
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

const TransactionLineItemSchema = z.object({
  productId: z.string().min(1),
  quantity: z.number().int().positive(),
  unitPriceCents: z.number().int().min(0),
  discountCents: z.number().int().min(0).default(0),
});

const CreateTransactionSchema = z.object({
  lineItems: z.array(TransactionLineItemSchema).min(1),
  customerId: z.string().optional().nullable(),
  shiftId: z.string().optional().nullable(),
  paymentMethod: z.enum(["CASH", "CARD", "ACH", "CHARGE_TO_ACCOUNT"]).default("CASH"),
  tipCents: z.number().int().min(0).default(0),
});

const ListTransactionsQuerySchema = z.object({
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  paymentMethod: z.string().optional(),
  customerId: z.string().optional(),
  status: z.string().optional(),
  skip: z.coerce.number().int().min(0).default(0),
  take: z.coerce.number().int().positive().max(100).default(25),
  sortBy: z.enum(["createdAt", "totalCents"]).default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

const RefundSchema = z.object({
  lineItems: z
    .array(
      z.object({
        lineItemId: z.string().min(1),
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
  date: z.string().optional(),
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

// ═══════════════════════════════════════════════════════════════════════════════
// PRODUCTS
// ═══════════════════════════════════════════════════════════════════════════════

// ─── GET /products — List products ──────────────────────────────────────────

router.get(
  "/products",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const query = ListProductsQuerySchema.parse(req.query);

      const where: Record<string, unknown> = { tenantId };

      if (query.category) where.departmentId = query.category;
      if (query.active !== undefined) {
        // Products don't have an 'active' column; we treat presence of
        // trackInventory or a positive price as a proxy. Since the schema
        // lacks an explicit active flag, we skip this filter gracefully.
      }

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
            inventory: true,
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

// ─── GET /products/:id — Single product ─────────────────────────────────────

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

      // If tracking inventory, create an inventory record
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

      const result = await prisma.product.findFirst({
        where: { id: product.id, tenantId },
        include: { inventory: true },
      });

      res.status(201).json(result);
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
        include: { inventory: true },
      });

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

// ─── DELETE /products/:id — Deactivate product ──────────────────────────────

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

      // Soft delete: set price to 0 and track as deactivated via audit log
      // The schema lacks an active flag so we record deactivation in the audit.
      const updated = await prisma.product.update({
        where: { id: req.params.id },
        data: { priceCents: 0 },
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

// ═══════════════════════════════════════════════════════════════════════════════
// TRANSACTIONS
// ═══════════════════════════════════════════════════════════════════════════════

// ─── POST /transactions — Create POS transaction ────────────────────────────

router.post(
  "/transactions",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const data = CreateTransactionSchema.parse(req.body);

      // Look up products and compute line item totals
      const productIds = data.lineItems.map((li) => li.productId);
      const products = await prisma.product.findMany({
        where: { id: { in: productIds }, tenantId },
      });

      const productMap = new Map(products.map((p) => [p.id, p]));

      let subtotalCents = 0;
      let taxCents = 0;

      const lineItemsData = data.lineItems.map((li) => {
        const product = productMap.get(li.productId);
        const unitPrice = li.unitPriceCents ?? product?.priceCents ?? 0;
        const lineSubtotal = unitPrice * li.quantity - li.discountCents;
        // Calculate tax based on taxClass; use 7% default if taxClass exists
        const taxRate = product?.taxClass ? 0.07 : 0;
        const lineTax = Math.round(lineSubtotal * taxRate);
        const lineTotal = lineSubtotal + lineTax;

        subtotalCents += lineSubtotal;
        taxCents += lineTax;

        return {
          productId: li.productId,
          quantity: li.quantity,
          unitPriceCents: unitPrice,
          discountCents: li.discountCents,
          taxCents: lineTax,
          extendedCents: lineTotal,
        };
      });

      const totalCents = subtotalCents + taxCents + data.tipCents;

      const transaction = await prisma.posTransaction.create({
        data: {
          tenantId,
          cashierId: req.userId,
          shiftId: data.shiftId ?? null,
          subtotalCents,
          taxCents,
          tipCents: data.tipCents,
          totalCents,
          status: data.paymentMethod,
          offlineQueued: false,
          lineItems: {
            create: lineItemsData,
          },
        },
        include: {
          lineItems: {
            include: { product: true },
          },
        },
      });

      // Decrement inventory for tracked products
      for (const li of lineItemsData) {
        if (li.productId) {
          const product = productMap.get(li.productId);
          if (product?.trackInventory) {
            await prisma.inventory.updateMany({
              where: { productId: li.productId, tenantId },
              data: {
                qtyOnHand: { decrement: li.quantity },
              },
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
          recordId: transaction.id,
          action: "CREATED",
          changedFieldsJson: {
            totalCents,
            paymentMethod: data.paymentMethod,
            lineItemCount: data.lineItems.length,
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

      if (query.paymentMethod) where.status = query.paymentMethod;
      if (query.status) where.status = query.status;

      if (query.dateFrom || query.dateTo) {
        const createdAt: Record<string, unknown> = {};
        if (query.dateFrom) createdAt.gte = new Date(query.dateFrom);
        if (query.dateTo) createdAt.lte = new Date(query.dateTo + "T23:59:59.999Z");
        where.createdAt = createdAt;
      }

      const [transactions, total] = await Promise.all([
        prisma.posTransaction.findMany({
          where,
          orderBy: { [query.sortBy]: query.sortOrder },
          skip: query.skip,
          take: query.take,
          include: {
            lineItems: {
              include: { product: true },
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

// ─── GET /transactions/:id — Single transaction ─────────────────────────────

router.get(
  "/transactions/:id",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;

      const transaction = await prisma.posTransaction.findFirst({
        where: { id: req.params.id, tenantId },
        include: {
          lineItems: {
            include: { product: true },
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
      const data = RefundSchema.parse(req.body);

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

      let refundSubtotal = 0;
      let refundTax = 0;
      let refundLineItems: Array<{
        productId: string | null;
        quantity: number;
        unitPriceCents: number;
        discountCents: number;
        taxCents: number;
        extendedCents: number;
      }> = [];

      if (data.lineItems && data.lineItems.length > 0) {
        // Partial refund — only specified line items
        const originalLineMap = new Map(
          original.lineItems.map((li) => [li.id, li]),
        );

        for (const refundItem of data.lineItems) {
          const originalLine = originalLineMap.get(refundItem.lineItemId);
          if (!originalLine) {
            throw appError(
              `Line item ${refundItem.lineItemId} not found`,
              400,
              "LINE_ITEM_NOT_FOUND",
            );
          }
          if (refundItem.quantity > originalLine.quantity) {
            throw appError(
              `Refund quantity exceeds original for line ${refundItem.lineItemId}`,
              400,
              "QUANTITY_EXCEEDS_ORIGINAL",
            );
          }

          const ratio = refundItem.quantity / originalLine.quantity;
          const lineRefundTax = Math.round(originalLine.taxCents * ratio);
          const lineRefundExtended = Math.round(originalLine.extendedCents * ratio);
          const lineRefundSubtotal =
            originalLine.unitPriceCents * refundItem.quantity -
            Math.round(originalLine.discountCents * ratio);

          refundSubtotal += lineRefundSubtotal;
          refundTax += lineRefundTax;

          refundLineItems.push({
            productId: originalLine.productId,
            quantity: -refundItem.quantity,
            unitPriceCents: originalLine.unitPriceCents,
            discountCents: Math.round(originalLine.discountCents * ratio),
            taxCents: -lineRefundTax,
            extendedCents: -lineRefundExtended,
          });
        }
      } else {
        // Full refund
        refundSubtotal = original.subtotalCents;
        refundTax = original.taxCents;

        refundLineItems = original.lineItems.map((li) => ({
          productId: li.productId,
          quantity: -li.quantity,
          unitPriceCents: li.unitPriceCents,
          discountCents: li.discountCents,
          taxCents: -li.taxCents,
          extendedCents: -li.extendedCents,
        }));
      }

      const refundTotal = refundSubtotal + refundTax;

      // Create refund transaction
      const refund = await prisma.posTransaction.create({
        data: {
          tenantId,
          cashierId: req.userId,
          shiftId: original.shiftId,
          subtotalCents: -refundSubtotal,
          taxCents: -refundTax,
          tipCents: 0,
          totalCents: -refundTotal,
          status: "REFUNDED",
          offlineQueued: false,
          lineItems: {
            create: refundLineItems,
          },
        },
        include: {
          lineItems: {
            include: { product: true },
          },
        },
      });

      // Mark original as refunded
      await prisma.posTransaction.update({
        where: { id: original.id },
        data: { status: "REFUNDED" },
      });

      // Restore inventory for refunded items
      for (const li of refundLineItems) {
        if (li.productId) {
          const product = await prisma.product.findFirst({
            where: { id: li.productId, tenantId },
          });
          if (product?.trackInventory) {
            await prisma.inventory.updateMany({
              where: { productId: li.productId, tenantId },
              data: {
                qtyOnHand: { increment: Math.abs(li.quantity) },
              },
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
            reason: data.reason ?? null,
          },
        },
      });

      res.status(201).json(refund);
    } catch (err) {
      next(err);
    }
  },
);

// ═══════════════════════════════════════════════════════════════════════════════
// INVENTORY
// ═══════════════════════════════════════════════════════════════════════════════

// ─── GET /inventory — Inventory levels ──────────────────────────────────────

router.get(
  "/inventory",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;

      const inventory = await prisma.inventory.findMany({
        where: { tenantId },
        include: {
          product: true,
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
      const data = AdjustInventorySchema.parse(req.body);

      const inventory = await prisma.inventory.findFirst({
        where: { productId: req.params.productId, tenantId },
      });

      if (!inventory) {
        throw appError("Inventory record not found", 404, "NOT_FOUND");
      }

      const updated = await prisma.inventory.update({
        where: { id: inventory.id },
        data: {
          qtyOnHand: data.quantity,
          lastCountDate: new Date(),
        },
        include: { product: true },
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
            previousQty: inventory.qtyOnHand,
            newQty: data.quantity,
            reason: data.reason ?? null,
          },
        },
      });

      res.json(updated);
    } catch (err) {
      next(err);
    }
  },
);

// ═══════════════════════════════════════════════════════════════════════════════
// SHIFTS
// ═══════════════════════════════════════════════════════════════════════════════

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

      // Enrich shifts with sales totals
      const enriched = shifts.map((shift) => {
        const salesTotal = shift.transactions
          .filter((t) => t.status !== "REFUNDED")
          .reduce((sum, t) => sum + t.totalCents, 0);
        const cashSales = shift.transactions
          .filter((t) => t.status === "CASH")
          .reduce((sum, t) => sum + t.totalCents, 0);
        const expectedCash = shift.openingFloatCents + cashSales;
        const variance =
          shift.closingCashCents != null
            ? shift.closingCashCents - expectedCash
            : null;

        return {
          ...shift,
          salesTotal,
          expectedCashCents: expectedCash,
          varianceCents: variance,
          transactionCount: shift.transactions.length,
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
      const data = OpenShiftSchema.parse(req.body);

      // Check for already open shift for this cashier
      const existing = await prisma.shift.findFirst({
        where: {
          tenantId,
          cashierId: req.userId!,
          status: "OPEN",
        },
      });

      if (existing) {
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
          locationId: data.locationId ?? null,
          openingFloatCents: data.openingFloatCents,
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
            openingFloatCents: data.openingFloatCents,
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
      const data = CloseShiftSchema.parse(req.body);

      const shift = await prisma.shift.findFirst({
        where: { id: req.params.id, tenantId },
        include: { transactions: true },
      });

      if (!shift) {
        throw appError("Shift not found", 404, "NOT_FOUND");
      }

      if (shift.status !== "OPEN") {
        throw appError("Shift is not open", 400, "SHIFT_NOT_OPEN");
      }

      // Calculate expected cash
      const cashSales = shift.transactions
        .filter((t) => t.status === "CASH")
        .reduce((sum, t) => sum + t.totalCents, 0);
      const expectedCash = shift.openingFloatCents + cashSales;
      const variance = data.closingCashCents - expectedCash;

      const updated = await prisma.shift.update({
        where: { id: shift.id },
        data: {
          closedAt: new Date(),
          closingCashCents: data.closingCashCents,
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
            closingCashCents: data.closingCashCents,
            expectedCashCents: expectedCash,
            varianceCents: variance,
            notes: data.notes ?? null,
          },
        },
      });

      res.json({
        ...updated,
        expectedCashCents: expectedCash,
        varianceCents: variance,
      });
    } catch (err) {
      next(err);
    }
  },
);

// ═══════════════════════════════════════════════════════════════════════════════
// REPORTS
// ═══════════════════════════════════════════════════════════════════════════════

// ─── GET /reports/daily — Daily sales summary ───────────────────────────────

router.get(
  "/reports/daily",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const query = DailyReportQuerySchema.parse(req.query);

      const reportDate = query.date ? new Date(query.date) : new Date();
      const dayStart = new Date(reportDate);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(reportDate);
      dayEnd.setHours(23, 59, 59, 999);

      const transactions = await prisma.posTransaction.findMany({
        where: {
          tenantId,
          createdAt: {
            gte: dayStart,
            lte: dayEnd,
          },
        },
        include: {
          lineItems: {
            include: { product: true },
          },
        },
      });

      const sales = transactions.filter((t) => t.status !== "REFUNDED");
      const refunds = transactions.filter((t) => t.status === "REFUNDED");

      const totalSales = sales.reduce((sum, t) => sum + t.totalCents, 0);
      const totalRefunds = refunds.reduce(
        (sum, t) => sum + Math.abs(t.totalCents),
        0,
      );
      const netSales = totalSales - totalRefunds;
      const totalTax = sales.reduce((sum, t) => sum + t.taxCents, 0);
      const totalTips = sales.reduce((sum, t) => sum + t.tipCents, 0);

      // Breakdown by payment method
      const byMethod: Record<string, { count: number; totalCents: number }> = {};
      for (const t of sales) {
        const method = t.status;
        if (!byMethod[method]) {
          byMethod[method] = { count: 0, totalCents: 0 };
        }
        byMethod[method].count++;
        byMethod[method].totalCents += t.totalCents;
      }

      // Top products
      const productSales: Record<
        string,
        { name: string; quantity: number; totalCents: number }
      > = {};
      for (const t of sales) {
        for (const li of t.lineItems) {
          const name = li.product?.name ?? "Unknown";
          const key = li.productId ?? name;
          if (!productSales[key]) {
            productSales[key] = { name, quantity: 0, totalCents: 0 };
          }
          productSales[key].quantity += li.quantity;
          productSales[key].totalCents += li.extendedCents;
        }
      }

      const topProducts = Object.values(productSales)
        .sort((a, b) => b.totalCents - a.totalCents)
        .slice(0, 10);

      res.json({
        date: reportDate.toISOString().slice(0, 10),
        transactionCount: sales.length,
        refundCount: refunds.length,
        totalSalesCents: totalSales,
        totalRefundsCents: totalRefunds,
        netSalesCents: netSales,
        totalTaxCents: totalTax,
        totalTipsCents: totalTips,
        byPaymentMethod: byMethod,
        topProducts,
      });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
