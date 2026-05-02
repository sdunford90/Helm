import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { clerkAuth, requireLocationAccess, filterByAllowedLocations } from "../middleware/auth.js";
import { requireAccountingSetup } from "../middleware/accounting-gate.js";
import { prisma } from "../lib/prisma.js";
import {
  createConnectionToken,
  listReaders,
  registerReader,
  deleteReader,
  createPaymentIntent as createTerminalPaymentIntent,
  capturePayment,
} from "../services/stripe-terminal.js";
import { calculateTax, getTaxProvider } from "../services/tax-engine.js";
import { resolveProductTaxCategory } from "../services/product-defaults.js";
import { syncPosTicketAsReceipt } from "../services/qbo-sync.js";

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
  // Optional in the API: when omitted (POS create has no category picker),
  // the route auto-resolves the tenant's "Uncategorized" category so
  // Product.productCategoryId (NOT NULL since
  // 20260429080000_inventory_category_only_gl) is always populated.
  productCategoryId: z.string().uuid().optional().nullable(),
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
  // taxCents intentionally omitted — computed server-side via calculateTax.
});

const CreateTransactionSchema = z.object({
  lineItems: z.array(TransactionLineItemSchema).min(1),
  customerId: z.string().optional().nullable(),
  shiftId: z.string().optional().nullable(),
  paymentMethod: z.enum(["CASH", "CARD", "ACH", "CHARGE_TO_ACCOUNT"]).default("CASH"),
  tipCents: z.number().int().min(0).default(0),
  // Card-only metadata so reports can show the Terminal-vs-CNP split per
  // location and surface how often the keyed form was a silent fallback.
  // Server validates that fallback reasons only apply to CNP card sales.
  cardRail: z.enum(["TERMINAL", "CNP"]).optional().nullable(),
  cnpFallbackReason: z
    .enum(["NO_READER", "DISCOVERY_FAILED", "MANUAL_CHOICE"])
    .optional()
    .nullable(),
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

      // Resolve the tenant's "Uncategorized" category when the caller
      // didn't supply one (the POS form has no category picker). The
      // migration seeds this row for every existing tenant; we
      // findOrCreate to cover tenants provisioned after the migration ran.
      let productCategoryId = data.productCategoryId ?? null;
      if (!productCategoryId) {
        const uncategorized = await prisma.productCategory.upsert({
          where: { tenantId_name: { tenantId, name: "Uncategorized" } },
          create: { tenantId, name: "Uncategorized", taxable: true, active: true },
          update: {},
          select: { id: true },
        });
        productCategoryId = uncategorized.id;
      }
      const { productCategoryId: _ignored, ...rest } = data;
      const product = await prisma.product.create({
        data: {
          tenantId,
          productCategoryId,
          ...rest,
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
  requireAccountingSetup,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const data = CreateTransactionSchema.parse(req.body);

      // Look up products and compute line item totals
      const productIds = data.lineItems.map((li) => li.productId);
      const products = await prisma.product.findMany({
        where: { id: { in: productIds }, tenantId },
        include: {
          productCategory: {
            select: { defaultTaxCategory: true, taxable: true },
          },
        },
      });

      const productMap = new Map(products.map((p) => [p.id, p]));

      // Resolve location for tax — taken from the open shift, if any.
      let locationId: string | null = null;
      let locationTaxProvider: import("@prisma/client").TaxProvider | null = null;
      if (data.shiftId) {
        const shift = await prisma.shift.findFirst({
          where: { id: data.shiftId, tenantId },
          select: { locationId: true },
        });
        locationId = shift?.locationId ?? null;
        if (locationId) {
          const loc = await prisma.location.findUnique({
            where: { id: locationId },
            select: { taxProvider: true },
          });
          locationTaxProvider = loc?.taxProvider ?? null;
        }
      }

      // Build tax engine input. Per-line tax category resolves via:
      //   product.taxClass override → category.defaultTaxCategory → "general"
      // A product (or its category) marked tax-exempt yields a null
      // taxCategory and gets skipped by the engine.
      const lineCalcs = data.lineItems.map((li) => {
        const product = productMap.get(li.productId);
        const unitPrice = li.unitPriceCents ?? product?.priceCents ?? 0;
        const lineSubtotal = unitPrice * li.quantity - li.discountCents;

        // Single-source precedence rule (per-product → category → "general"
        // with exempt short-circuits) lives in product-defaults.ts.
        const { taxCategory, taxable } = product
          ? resolveProductTaxCategory(product)
          : { taxCategory: "general" as string | null, taxable: true };

        return { li, unitPrice, lineSubtotal, taxCategory, taxable };
      });

      // Server-side tax calc — never trust client-supplied taxCents.
      // Run regardless of whether a customer was attached so anonymous POS
      // sales still collect tax based on the location's jurisdiction stack.
      // calculateTax internally short-circuits to 0 when the (optional)
      // customer is tax-exempt or when no jurisdictions are configured.
      let taxCents = 0;
      const taxByIndex: number[] = lineCalcs.map(() => 0);
      const taxableLines = lineCalcs
        .map((c, idx) => ({ ...c, idx }))
        .filter((c) => c.taxable && c.taxCategory && c.lineSubtotal > 0);

      if (taxableLines.length) {
        const taxResult = await calculateTax({
          tenantId,
          locationId,
          customerId: data.customerId ?? null,
          lineItems: taxableLines.map((c) => ({
            description: productMap.get(c.li.productId)?.name ?? "",
            amountCents: c.lineSubtotal,
            taxCategory: c.taxCategory!,
          })),
        });
        taxResult.items.forEach((item, i) => {
          const targetIdx = taxableLines[i].idx;
          taxByIndex[targetIdx] = item.taxCents;
        });
        taxCents = taxResult.totalTaxCents;
      }

      let subtotalCents = 0;
      const lineItemsData = lineCalcs.map((c, idx) => {
        const lineTax = taxByIndex[idx];
        subtotalCents += c.lineSubtotal;
        return {
          productId: c.li.productId,
          quantity: c.li.quantity,
          unitPriceCents: c.unitPrice,
          discountCents: c.li.discountCents,
          taxCents: lineTax,
          extendedCents: c.lineSubtotal + lineTax,
        };
      });

      const totalCents = subtotalCents + taxCents + data.tipCents;

      // Card-rail metadata is only meaningful for CARD sales. Silently drop
      // any rail/fallback fields for cash/ACH/charge so a buggy client can't
      // pollute the report dataset, and clear fallback reason for Terminal.
      const cardRail = data.paymentMethod === "CARD" ? data.cardRail ?? null : null;
      const cnpFallbackReason =
        cardRail === "CNP" ? data.cnpFallbackReason ?? null : null;

      // GL contract note (Task #235 — inventory category-only GL collapse):
      // POS sales record `posTransaction` rows + decrement inventory but
      // do NOT post a journal entry to the GL ledger themselves. Any
      // downstream aggregation that DOES post to the GL ledger (end-of-day
      // settlement jobs, QBO inventory sync, ad-hoc adjustment journals)
      // is required to resolve product GL accounts via
      // `resolveProductGlAccountsStrict(..., ["revenue", "cogs",
      // "inventoryAsset"])` so an absent per-(category, location)
      // mapping fails loudly with the canonical
      //   `MISSING_GL_MAPPING: Missing GL mapping for category "X" at location "Y"`
      // wording. Sale time itself stays GL-free on purpose so cash sales
      // can still complete in the offline/no-shift cases — the contract is
      // re-asserted at the GL boundary, never silently fallen back to a
      // tenant-wide default.
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
          cardRail,
          cnpFallbackReason,
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
            ...(cardRail ? { cardRail } : {}),
            ...(cnpFallbackReason ? { cnpFallbackReason } : {}),
          },
        },
      });

      // Best-effort QB SalesReceipt push. Runs after the audit log so the POS
      // transaction is fully committed before we touch QBO. Failure here is
      // non-fatal — the POS sale has already succeeded and the cashier should
      // not see a payment error because QBO is temporarily offline.
      if (locationId) {
        try {
          const loc = await prisma.location.findUnique({
            where: { id: locationId },
            select: { qboRealmId: true } as any,
          });
          if ((loc as any)?.qboRealmId) {
            await syncPosTicketAsReceipt(transaction.id, tenantId);
          }
        } catch (err) {
          console.error("[pos] QB SalesReceipt push failed:", err);
        }
      }

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

      const where = filterByAllowedLocations(req, { tenantId } as Record<string, unknown>, {
        includeNull: true,
      });
      const shifts = await prisma.shift.findMany({
        where,
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

      if (data.locationId && !requireLocationAccess(req, data.locationId)) {
        res.status(403).json({ error: "Forbidden for this location", code: "LOCATION_FORBIDDEN" });
        return;
      }

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

// ─── GET /reports/card-rail-mix — Terminal vs CNP split ─────────────────────
//
// Owners need visibility into how often POS card sales fall back to keyed
// (card-not-present) entry — silently or by choice — because CNP is the more
// expensive rail. This endpoint aggregates successful (non-refunded) card
// sales over a date range and breaks them down per location:
//   - terminalCount / terminalCents   — paid via reader
//   - cnpCount / cnpCents             — keyed entry
//   - cnpFallbackBreakdown            — among CNP, how the cashier got there
//                                       (no_reader / discovery_failed / manual_choice / unknown)
// Pre-migration rows have no rail tagged and surface in `unknownCardCount`.

const CardRailMixQuerySchema = z.object({
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  locationId: z.string().optional(),
});

router.get(
  "/reports/card-rail-mix",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const query = CardRailMixQuerySchema.parse(req.query);

      // Default: last 30 days, inclusive of today.
      const now = new Date();
      const defaultStart = new Date(now);
      defaultStart.setDate(defaultStart.getDate() - 30);
      defaultStart.setHours(0, 0, 0, 0);

      const dateFrom = query.dateFrom ? new Date(query.dateFrom) : defaultStart;
      const dateTo = query.dateTo
        ? new Date(query.dateTo + "T23:59:59.999Z")
        : new Date();

      // Only consider card sales (status === "CARD"). Cash/ACH/etc. don't
      // belong in a rail-mix report. Refunded rows are excluded so the split
      // reflects what the customer actually paid.
      const cardSales = await prisma.posTransaction.findMany({
        where: {
          tenantId,
          status: "CARD",
          createdAt: { gte: dateFrom, lte: dateTo },
        },
        select: {
          totalCents: true,
          cardRail: true,
          cnpFallbackReason: true,
          createdAt: true,
          shift: { select: { locationId: true } },
        },
      });

      // Optional per-location filter — applied after the query because the
      // location lives on the joined Shift row (and shift can be null).
      const filtered = query.locationId
        ? cardSales.filter((t) => t.shift?.locationId === query.locationId)
        : cardSales;

      type Bucket = {
        locationId: string | null;
        terminalCount: number;
        terminalCents: number;
        cnpCount: number;
        cnpCents: number;
        unknownCardCount: number;
        unknownCardCents: number;
        cnpFallbackBreakdown: {
          no_reader: number;
          discovery_failed: number;
          manual_choice: number;
          unknown: number;
        };
      };

      const makeBucket = (locationId: string | null): Bucket => ({
        locationId,
        terminalCount: 0,
        terminalCents: 0,
        cnpCount: 0,
        cnpCents: 0,
        unknownCardCount: 0,
        unknownCardCents: 0,
        cnpFallbackBreakdown: {
          no_reader: 0,
          discovery_failed: 0,
          manual_choice: 0,
          unknown: 0,
        },
      });

      const overall = makeBucket(null);
      const byLocation = new Map<string, Bucket>();

      for (const t of filtered) {
        const locId = t.shift?.locationId ?? null;
        const locKey = locId ?? "__no_location__";
        if (!byLocation.has(locKey)) byLocation.set(locKey, makeBucket(locId));
        const locBucket = byLocation.get(locKey)!;

        const apply = (b: Bucket) => {
          if (t.cardRail === "TERMINAL") {
            b.terminalCount++;
            b.terminalCents += t.totalCents;
          } else if (t.cardRail === "CNP") {
            b.cnpCount++;
            b.cnpCents += t.totalCents;
            const reason = t.cnpFallbackReason;
            if (reason === "NO_READER") b.cnpFallbackBreakdown.no_reader++;
            else if (reason === "DISCOVERY_FAILED")
              b.cnpFallbackBreakdown.discovery_failed++;
            else if (reason === "MANUAL_CHOICE")
              b.cnpFallbackBreakdown.manual_choice++;
            else b.cnpFallbackBreakdown.unknown++;
          } else {
            // Pre-migration rows or any card sale that didn't tag a rail.
            b.unknownCardCount++;
            b.unknownCardCents += t.totalCents;
          }
        };

        apply(overall);
        apply(locBucket);
      }

      // Hydrate location names for nicer client-side rendering.
      const locationIds = Array.from(byLocation.values())
        .map((b) => b.locationId)
        .filter((id): id is string => !!id);
      const locations = locationIds.length
        ? await prisma.location.findMany({
            where: { id: { in: locationIds }, tenantId },
            select: { id: true, name: true },
          })
        : [];
      const nameById = new Map(locations.map((l) => [l.id, l.name]));

      res.json({
        dateFrom: dateFrom.toISOString(),
        dateTo: dateTo.toISOString(),
        overall,
        byLocation: Array.from(byLocation.values()).map((b) => ({
          ...b,
          locationName: b.locationId ? nameById.get(b.locationId) ?? null : null,
        })),
      });
    } catch (err) {
      next(err);
    }
  },
);

// ─── Helper: resolve Stripe account for Terminal routes ─────────────────────
//
// Priority order:
//  1. shiftId  — look up the Shift's locationId (trusted server-side context)
//  2. locationId — explicit location override (e.g. reader management)
//  3. Tenant-level fallback for single-location marinas
//
// Returns null when no Stripe account is configured so callers can respond
// with STRIPE_NOT_CONFIGURED.

async function resolveStripeAccount(
  tenantId: string,
  opts: { shiftId?: string | null; locationId?: string | null } = {},
): Promise<string | null> {
  let resolvedLocationId: string | null = null;

  if (opts.shiftId) {
    const shift = await prisma.shift.findFirst({
      where: { id: opts.shiftId, tenantId },
      select: { locationId: true },
    });
    if (shift?.locationId) {
      resolvedLocationId = shift.locationId;
    }
  }

  if (!resolvedLocationId && opts.locationId) {
    resolvedLocationId = opts.locationId;
  }

  if (resolvedLocationId) {
    // When an explicit location is specified, resolve strictly — if the
    // location doesn't belong to this tenant or has no Stripe account we
    // return null rather than silently routing to the tenant account.
    const location = await prisma.location.findFirst({
      where: { id: resolvedLocationId, tenantId },
      select: { stripeAccountId: true },
    });
    return location?.stripeAccountId ?? null;
  }

  // No location context: fall back to the tenant-level account (single-location
  // marinas that haven't configured per-location Stripe accounts).
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { stripeAccountId: true },
  });
  return tenant?.stripeAccountId ?? null;
}

// ─── Helper: enforce location access for payment endpoints ──────────────────

async function ensurePaymentLocationAccess(
  req: Request,
  opts: { shiftId?: string | null; locationId?: string | null },
): Promise<{ ok: true } | { ok: false; status: number; body: { error: string; code: string } }> {
  if (opts.locationId) {
    if (!requireLocationAccess(req, opts.locationId)) {
      return { ok: false, status: 403, body: { error: "Forbidden for this location", code: "LOCATION_FORBIDDEN" } };
    }
  }
  if (opts.shiftId) {
    const shift = await prisma.shift.findFirst({
      where: { id: opts.shiftId, tenantId: req.tenantId! },
      select: { locationId: true },
    });
    if (shift?.locationId && !requireLocationAccess(req, shift.locationId)) {
      return { ok: false, status: 403, body: { error: "Forbidden for this location", code: "LOCATION_FORBIDDEN" } };
    }
  }
  return { ok: true };
}

// ─── POST /terminal/connection-token — Terminal SDK auth ────────────────────

router.post(
  "/terminal/connection-token",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const locationId = (req.query.locationId ?? req.body?.locationId) as string | undefined;
      const guard = await ensurePaymentLocationAccess(req, { locationId });
      if (!guard.ok) { res.status(guard.status).json(guard.body); return; }
      const stripeAccountId = await resolveStripeAccount(req.tenantId!, { locationId });
      if (!stripeAccountId) {
        res.status(400).json({ error: "STRIPE_NOT_CONFIGURED" });
        return;
      }
      const secret = await createConnectionToken(stripeAccountId);
      res.json({ secret });
    } catch (err) {
      next(err);
    }
  },
);

// ─── GET /terminal/readers — list registered readers ────────────────────────

router.get(
  "/terminal/readers",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const locationId = req.query.locationId as string | undefined;
      const guard = await ensurePaymentLocationAccess(req, { locationId });
      if (!guard.ok) { res.status(guard.status).json(guard.body); return; }
      const stripeAccountId = await resolveStripeAccount(req.tenantId!, { locationId });
      if (!stripeAccountId) {
        res.status(400).json({ error: "STRIPE_NOT_CONFIGURED" });
        return;
      }
      const readers = await listReaders(stripeAccountId);
      res.json({ data: readers });
    } catch (err) {
      next(err);
    }
  },
);

// ─── POST /terminal/readers/register — pair a physical reader ────────────────

const RegisterReaderSchema = z.object({
  registrationCode: z.string().min(1),
  label: z.string().min(1).max(80),
  locationId: z.string().optional(),
});

router.post(
  "/terminal/readers/register",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { registrationCode, label, locationId } = RegisterReaderSchema.parse(req.body);
      const guard = await ensurePaymentLocationAccess(req, { locationId });
      if (!guard.ok) { res.status(guard.status).json(guard.body); return; }
      const stripeAccountId = await resolveStripeAccount(req.tenantId!, { locationId });
      if (!stripeAccountId) {
        res.status(400).json({ error: "STRIPE_NOT_CONFIGURED" });
        return;
      }
      const reader = await registerReader(stripeAccountId, registrationCode, label);
      res.json(reader);
    } catch (err) {
      next(err);
    }
  },
);

// ─── DELETE /terminal/readers/:id — unregister a reader ──────────────────────

router.delete(
  "/terminal/readers/:id",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const locationId = req.query.locationId as string | undefined;
      const guard = await ensurePaymentLocationAccess(req, { locationId });
      if (!guard.ok) { res.status(guard.status).json(guard.body); return; }
      const stripeAccountId = await resolveStripeAccount(req.tenantId!, { locationId });
      if (!stripeAccountId) {
        res.status(400).json({ error: "STRIPE_NOT_CONFIGURED" });
        return;
      }
      await deleteReader(stripeAccountId, req.params.id);
      res.json({ deleted: true });
    } catch (err) {
      next(err);
    }
  },
);

// ─── POST /terminal/payment-intents — create a terminal payment intent ────────

const TerminalPaymentSchema = z.object({
  amountCents: z.number().int().positive(),
  tipEnabled: z.boolean().default(false),
  tipAmounts: z.array(z.number().int().min(0)).optional(),
  shiftId: z.string().optional(),
  locationId: z.string().optional(),
});

router.post(
  "/terminal/payment-intents",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const data = TerminalPaymentSchema.parse(req.body);
      const guard = await ensurePaymentLocationAccess(req, { shiftId: data.shiftId, locationId: data.locationId });
      if (!guard.ok) { res.status(guard.status).json(guard.body); return; }
      const stripeAccountId = await resolveStripeAccount(req.tenantId!, {
        shiftId: data.shiftId,
        locationId: data.locationId,
      });
      if (!stripeAccountId) {
        res.status(400).json({ error: "STRIPE_NOT_CONFIGURED" });
        return;
      }
      const clientSecret = await createTerminalPaymentIntent({
        amount: data.amountCents,
        connectedAccountId: stripeAccountId,
        applicationFee: Math.round(data.amountCents * 0.005),
        tipEnabled: data.tipEnabled,
        tipAmounts: data.tipAmounts,
      });
      res.json({ clientSecret });
    } catch (err) {
      next(err);
    }
  },
);

// ─── POST /terminal/payment-intents/:id/capture — capture after reader ───────

const CaptureSchema = z.object({
  tipAmountCents: z.number().int().min(0).optional(),
  shiftId: z.string().optional(),
  locationId: z.string().optional(),
});

// ─── POST /payments/cnp — Card-not-present (keyed-in) payment ────────────────
//
// Returns an unconfirmed PaymentIntent's `client_secret` (and id) scoped to
// the resolved location's connected account. The browser then runs
// `stripe.confirmCardPayment(clientSecret, { payment_method: { card: cardEl } })`
// against that same connected account so the card is tokenized on the right
// Stripe account — eliminating the previous "platform-owned payment method ID"
// mismatch that broke per-location marinas.
//
// Direct-charge on the connected account (header), with the platform's slice
// collected as `application_fee_amount`. Mirrors checkout.ts / portal.ts /
// stripe-terminal.ts so onboarding's existing `card_payments` capability is
// sufficient — no `transfer_data`, no `transfers` capability requirement.

// `.strict()` rejects unknown keys with a 400. This is deliberate belt-and-
// suspenders for the task #254 migration: if a stale frontend ships the old
// `paymentMethodId` we want the request to FAIL LOUDLY rather than silently
// drop the field and confuse a debugging session ("but the browser is
// sending it!"). Forces every client to be on the new server-confirmed flow.
const CnpPaymentSchema = z.object({
  amountCents: z.number().int().min(50),
  description: z.string().optional(),
  shiftId: z.string().optional(),
  locationId: z.string().optional(),
}).strict();

router.post(
  "/payments/cnp",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { amountCents, description, shiftId, locationId } = CnpPaymentSchema.parse(req.body);
      const guard = await ensurePaymentLocationAccess(req, { shiftId, locationId });
      if (!guard.ok) { res.status(guard.status).json(guard.body); return; }
      const stripeAccountId = await resolveStripeAccount(req.tenantId!, { shiftId, locationId });
      if (!stripeAccountId) {
        res.status(400).json({ error: "STRIPE_NOT_CONFIGURED" });
        return;
      }

      const stripeMod = await import("../lib/stripe.js");
      const stripeClient = stripeMod.stripe;
      if (!stripeClient) {
        res.status(500).json({ error: "Stripe is not configured." });
        return;
      }

      const tenant = await prisma.tenant.findUnique({
        where: { id: req.tenantId! },
        select: {
          applicationFeePctBps: true,
          applicationFeeFixedCents: true,
        },
      });
      const applicationFee = stripeMod.calculateApplicationFee(
        amountCents,
        tenant?.applicationFeePctBps ?? 0,
        tenant?.applicationFeeFixedCents ?? 0,
      );

      // Create the PI **unconfirmed** — confirmation happens client-side via
      // `confirmCardPayment(clientSecret, …)` so Stripe.js tokenizes the card
      // on the connected account (the `client_secret` is account-scoped). No
      // `payment_method`, no `confirm: true` here — that was the source of
      // the cross-account mismatch.
      const intent = await stripeClient.paymentIntents.create(
        {
          amount: amountCents,
          currency: "usd",
          payment_method_types: ["card"],
          application_fee_amount: applicationFee,
          description: description ?? "POS card-not-present payment",
        },
        { stripeAccount: stripeAccountId },
      );

      res.json({
        id: intent.id,
        clientSecret: intent.client_secret,
        status: intent.status,
        amount: intent.amount,
      });
    } catch (err) {
      next(err);
    }
  },
);

// ─── POST /payments/cnp/finalize — Verify a confirmed CNP PaymentIntent ─────
//
// Companion to /payments/cnp. After the browser runs `confirmCardPayment`,
// it MUST round-trip through this endpoint before recording the
// PosTransaction so the server can:
//
//   1. Re-resolve the connected account (same shift/location lookup as the
//      create step) — guarantees the verification happens on the SAME
//      account the PI lives on, even if a malicious client lies about it.
//   2. `paymentIntents.retrieve(piId, { stripeAccount })` — read the truth
//      from Stripe. Refuse to finalize unless `status === "succeeded"`.
//   3. Cross-check the amount against what the client claimed. A mismatch
//      means either replay against a stale PI or a tampered cart total —
//      both should fail loudly.
//   4. Audit-log the PI id (no schema change: stored on
//      `auditLog.changedFieldsJson` so reconciliation jobs can join
//      `pos_transactions.createdAt` ↔ `audit_logs.recordType=PosPayment`
//      to recover the PI id without a migration).
//
// GL parity: POS sales DO NOT post to the GL ledger at sale time (per
// task #235 — see comment on POST /transactions). End-of-day settlement
// jobs are the GL boundary. By keeping that contract unchanged and only
// adding a verification + audit row here, fee/GL reporting stays
// bit-identical to the pre-fix code path.
const CnpFinalizeSchema = z.object({
  paymentIntentId: z.string().min(1),
  expectedAmountCents: z.number().int().min(50),
  shiftId: z.string().optional(),
  locationId: z.string().optional(),
}).strict();

router.post(
  "/payments/cnp/finalize",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { paymentIntentId, expectedAmountCents, shiftId, locationId } =
        CnpFinalizeSchema.parse(req.body);
      const guard = await ensurePaymentLocationAccess(req, { shiftId, locationId });
      if (!guard.ok) { res.status(guard.status).json(guard.body); return; }
      const stripeAccountId = await resolveStripeAccount(req.tenantId!, { shiftId, locationId });
      if (!stripeAccountId) {
        res.status(400).json({ error: "STRIPE_NOT_CONFIGURED" });
        return;
      }

      const stripeMod = await import("../lib/stripe.js");
      const stripeClient = stripeMod.stripe;
      if (!stripeClient) {
        res.status(500).json({ error: "Stripe is not configured." });
        return;
      }

      // Authoritative read on the connected account. Even if the client
      // lies about the PI status, Stripe's view wins.
      const intent = await stripeClient.paymentIntents.retrieve(
        paymentIntentId,
        {},
        { stripeAccount: stripeAccountId },
      );

      if (intent.status !== "succeeded") {
        res.status(400).json({
          error: "PAYMENT_NOT_SUCCEEDED",
          status: intent.status,
        });
        return;
      }

      if (intent.amount !== expectedAmountCents) {
        res.status(400).json({
          error: "AMOUNT_MISMATCH",
          expectedAmountCents,
          stripeAmountCents: intent.amount,
        });
        return;
      }

      // Audit-log the verified PI so we can reconcile pos_transactions ↔
      // Stripe charges later without a schema change. recordType is
      // "PosPayment" (vs. PosTransaction) so it doesn't collide with the
      // existing per-sale audit row written by POST /transactions.
      await prisma.auditLog.create({
        data: {
          tenantId: req.tenantId!,
          userId: req.userId,
          userName: req.userRecord?.email,
          recordType: "PosPayment",
          recordId: paymentIntentId,
          action: "FINALIZED",
          changedFieldsJson: {
            paymentIntentId,
            stripeAccountId,
            amountCents: intent.amount,
            cardRail: "CNP",
            shiftId: shiftId ?? null,
            locationId: locationId ?? null,
          },
        },
      });

      res.json({
        id: intent.id,
        status: intent.status,
        amount: intent.amount,
      });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/terminal/payment-intents/:id/capture",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { tipAmountCents, shiftId, locationId } = CaptureSchema.parse(req.body);
      const guard = await ensurePaymentLocationAccess(req, { shiftId, locationId });
      if (!guard.ok) { res.status(guard.status).json(guard.body); return; }
      const stripeAccountId = await resolveStripeAccount(req.tenantId!, { shiftId, locationId });
      if (!stripeAccountId) {
        res.status(400).json({ error: "STRIPE_NOT_CONFIGURED" });
        return;
      }
      await capturePayment(
        req.params.id,
        stripeAccountId,
        tipAmountCents,
      );
      res.json({ captured: true });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
