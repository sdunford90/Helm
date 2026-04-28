import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { clerkAuth } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";
import { Prisma, GLAccountType } from "@prisma/client";
import {
  syncInventoryItem,
  syncReceivingBill,
  syncVendor,
  postInventoryAdjustmentJournal,
  findFailedInventorySyncRefs,
  type PoBillLineInput,
} from "../services/qbo-sync.js";
import { applyCategoryDefaultsToProductData } from "../services/product-defaults.js";

const router: Router = Router();

router.use(...clerkAuth());

// ─── QBO sync helpers ─────────────────────────────────────────────────────────
//
// All QBO calls below are best-effort: local mutations always succeed, and any
// sync failure is captured into product/PO/adjustment.qbo*SyncError so the UI
// can show retryable errors and the user can re-trigger a push.

type ProductRow = Awaited<ReturnType<typeof prisma.product.findFirstOrThrow>>;
type PurchaseOrderRow = Awaited<ReturnType<typeof prisma.purchaseOrder.findFirstOrThrow>>;
type AdjustmentRow = Awaited<ReturnType<typeof prisma.inventoryAdjustment.findFirstOrThrow>>;

async function tryPushProductToQbo(product: ProductRow): Promise<ProductRow> {
  if (!product.trackInventory) return product;
  try {
    const result = await syncInventoryItem(
      {
        productId: product.id,
        name: product.name,
        sku: product.sku,
        description: null,
        priceCents: product.priceCents,
        costCents: product.costCents ?? 0,
        qoh: product.qoh,
        incomeGlAccountId: product.revenueGlAccountId,
        inventoryAssetGlAccountId: product.inventoryAssetGlAccountId,
        cogsGlAccountId: product.cogsGlAccountId,
      },
      product.tenantId,
      product.locationId,
    );
    return await prisma.product.update({
      where: { id: product.id },
      data: {
        qboItemId: result.qboItemId,
        qboItemSyncedAt: new Date(),
        qboItemSyncError: null,
        qboItemSyncErrorAt: null,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[inventory] QBO item sync failed for ${product.id}: ${msg}`);
    return await prisma.product.update({
      where: { id: product.id },
      data: {
        qboItemSyncError: msg.slice(0, 1000),
        qboItemSyncErrorAt: new Date(),
      },
    });
  }
}

async function tryPushAdjustmentJournal(
  adjustment: AdjustmentRow,
  product: ProductRow,
): Promise<void> {
  // Skip reasons accounted for elsewhere (received → Bill, sold → auto-COGS)
  if (adjustment.reason === "received" || adjustment.reason === "sold") return;
  try {
    const result = await postInventoryAdjustmentJournal(
      {
        adjustmentId: adjustment.id,
        productId: product.id,
        productName: product.name,
        reason: adjustment.reason,
        quantityChange: adjustment.quantityChange,
        unitCostCents: product.costCents ?? 0,
        inventoryAssetGlAccountId: product.inventoryAssetGlAccountId,
        cogsGlAccountId: product.cogsGlAccountId,
        notes: adjustment.notes,
      },
      product.tenantId,
      product.locationId,
    );
    await prisma.inventoryAdjustment.update({
      where: { id: adjustment.id },
      data: {
        qboJournalEntryId: result.qboJournalEntryId,
        qboSyncedAt: result.qboJournalEntryId ? new Date() : null,
        qboSyncError: null,
        qboSyncErrorAt: null,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[inventory] QBO adjustment sync failed for ${adjustment.id}: ${msg}`);
    await prisma.inventoryAdjustment.update({
      where: { id: adjustment.id },
      data: {
        qboSyncError: msg.slice(0, 1000),
        qboSyncErrorAt: new Date(),
      },
    });
  }
}

async function tryPushReceivingBill(
  po: PurchaseOrderRow,
  receivedLines: Array<{ productId: string; productName: string; receivedQty: number; unitCostCents: number }>,
): Promise<void> {
  if (!po.vendorId) {
    await prisma.purchaseOrder.update({
      where: { id: po.id },
      data: {
        qboBillSyncError:
          "Purchase order has no linked vendor — set a Vendor before receiving to enable QBO Bill sync",
        qboBillSyncErrorAt: new Date(),
      },
    });
    return;
  }
  if (!receivedLines.length) return;
  try {
    const lines: PoBillLineInput[] = receivedLines.map((l) => ({
      productId: l.productId,
      productName: l.productName,
      receivedQty: l.receivedQty,
      unitCostCents: l.unitCostCents,
    }));
    const result = await syncReceivingBill(
      {
        purchaseOrderId: po.id,
        poNumber: po.poNumber ?? po.id,
        vendorId: po.vendorId,
        expectedDate: po.expectedDate ?? null,
        lines,
        // Force-push on each receive: each batch creates its own Bill
        forcePush: true,
      },
      po.tenantId,
      po.locationId,
    );
    await prisma.purchaseOrder.update({
      where: { id: po.id },
      data: {
        qboBillId: result.qboBillId,
        qboBillSyncedAt: new Date(),
        qboBillSyncError: null,
        qboBillSyncErrorAt: null,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[inventory] QBO bill sync failed for ${po.id}: ${msg}`);
    await prisma.purchaseOrder.update({
      where: { id: po.id },
      data: {
        qboBillSyncError: msg.slice(0, 1000),
        qboBillSyncErrorAt: new Date(),
      },
    });
  }
}

// ─── Zod Schemas ──────────────────────────────────────────────────────────────

const ListProductsQuerySchema = z.object({
  category: z.string().optional(),
  search: z.string().optional(),
  lowStockOnly: z.coerce.boolean().optional(),
  skip: z.coerce.number().int().min(0).default(0),
  take: z.coerce.number().int().positive().max(100).default(25),
  sortBy: z.enum(["name", "sku", "category", "qoh", "createdAt"]).default("name"),
  sortOrder: z.enum(["asc", "desc"]).default("asc"),
});

const CreateProductSchema = z.object({
  name: z.string().min(1),
  sku: z.string().min(1),
  barcode: z.string().optional().nullable(),
  // Legacy free-text category — kept for backwards-compat.
  category: z.string().optional().nullable(),
  // New: links to ProductCategory whose defaults flow into the per-product
  // GL/tax fields when those are left blank.
  productCategoryId: z.string().uuid().optional().nullable(),
  costCents: z.number().int().min(0),
  priceCents: z.number().int().min(0),
  taxClass: z.string().optional().nullable(),
  reorderPoint: z.number().int().min(0).default(0),
  trackInventory: z.boolean().default(true),
  cogsGlAccountId: z.string().optional().nullable(),
  revenueGlAccountId: z.string().optional().nullable(),
  inventoryAssetGlAccountId: z.string().optional().nullable(),
  locationId: z.string().optional().nullable(),
});

const UpdateProductSchema = CreateProductSchema.partial();

const CreateVendorSchema = z.object({
  name: z.string().min(1),
  email: z.string().email().optional().nullable(),
  phone: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
});

const UpdateVendorSchema = CreateVendorSchema.partial();

const CreateAdjustmentSchema = z.object({
  productId: z.string().min(1),
  quantityChange: z.number().int(),
  reason: z.enum(["received", "sold", "damaged", "count", "shrinkage", "return"]),
  notes: z.string().optional().nullable(),
  staffName: z.string().optional().nullable(),
});

const ListAdjustmentsQuerySchema = z.object({
  productId: z.string().optional(),
  reason: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  skip: z.coerce.number().int().min(0).default(0),
  take: z.coerce.number().int().positive().max(100).default(50),
});

const CreateCountSessionSchema = z.object({
  name: z.string().optional(),
  startedBy: z.string().optional(),
});

const SubmitCountItemSchema = z.object({
  productId: z.string().min(1),
  expectedQty: z.number().int().min(0),
  actualQty: z.number().int().min(0),
});

const CreatePurchaseOrderSchema = z.object({
  vendor: z.string().min(1).optional(),
  vendorId: z.string().min(1).optional(),
  locationId: z.string().optional().nullable(),
  expectedDate: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  lineItems: z.array(
    z.object({
      productId: z.string().min(1),
      quantity: z.number().int().positive(),
      unitCostCents: z.number().int().min(0),
    })
  ).min(1),
}).refine((v) => v.vendor || v.vendorId, { message: "vendor or vendorId is required" });

const ReceivePOSchema = z.object({
  lineItems: z.array(
    z.object({
      lineItemId: z.string().min(1),
      receivedQty: z.number().int().min(0),
    })
  ).min(1),
  receivedBy: z.string().optional(),
});

const GenerateLabelsSchema = z.object({
  productIds: z.array(z.string().min(1)).min(1),
  labelQty: z.number().int().positive().default(1),
});

function getTenantId(req: Request): string {
  return (req as any).tenantId ?? (req as any).userRecord?.tenant_id ?? "default";
}

/**
 * Verify that every supplied GL account ID actually belongs to this tenant.
 * GlAccount is not in TENANT_SCOPED_MODELS, so a malicious or buggy caller
 * could otherwise persist a cross-tenant FK by sending another tenant's
 * account UUID. We reject up-front with a 400 listing the offending IDs so
 * misconfigured UIs surface the problem instead of silently writing the FK.
 */
async function findInvalidGlAccountIds(
  tenantId: string,
  ids: Array<string | null | undefined>,
): Promise<string[]> {
  const requested = Array.from(
    new Set(ids.filter((v): v is string => typeof v === "string" && v.length > 0)),
  );
  if (requested.length === 0) return [];
  const found = await prisma.glAccount.findMany({
    where: { id: { in: requested }, tenantId },
    select: { id: true },
  });
  const foundSet = new Set(found.map((r) => r.id));
  return requested.filter((id) => !foundSet.has(id));
}

// Shape products for API responses — keeps the front-end fields stable
// (priceCents/costCents always numbers, etc.)
function shapeProduct(p: ProductRow) {
  return {
    id: p.id,
    tenantId: p.tenantId,
    name: p.name,
    sku: p.sku ?? "",
    barcode: p.barcode,
    category: p.category ?? "",
    productCategoryId: p.productCategoryId ?? null,
    costCents: p.costCents ?? 0,
    priceCents: p.priceCents,
    taxClass: p.taxClass,
    reorderPoint: p.reorderPoint,
    trackInventory: p.trackInventory,
    qoh: p.qoh,
    cogsGlAccountId: p.cogsGlAccountId,
    revenueGlAccountId: p.revenueGlAccountId,
    inventoryAssetGlAccountId: p.inventoryAssetGlAccountId,
    locationId: p.locationId,
    qboItemId: p.qboItemId,
    qboItemSyncedAt: p.qboItemSyncedAt ? p.qboItemSyncedAt.toISOString() : null,
    qboItemSyncError: p.qboItemSyncError,
    qboItemSyncErrorAt: p.qboItemSyncErrorAt ? p.qboItemSyncErrorAt.toISOString() : null,
    active: p.active,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

function shapeAdjustment(a: AdjustmentRow) {
  return {
    id: a.id,
    tenantId: a.tenantId,
    productId: a.productId,
    productName: a.productName,
    quantityChange: a.quantityChange,
    quantityBefore: a.quantityBefore,
    quantityAfter: a.quantityAfter,
    reason: a.reason,
    notes: a.notes,
    staffName: a.staffName,
    createdAt: a.createdAt.toISOString(),
    qboJournalEntryId: a.qboJournalEntryId,
    qboSyncedAt: a.qboSyncedAt ? a.qboSyncedAt.toISOString() : null,
    qboSyncError: a.qboSyncError,
    qboSyncErrorAt: a.qboSyncErrorAt ? a.qboSyncErrorAt.toISOString() : null,
  };
}

type PoWithLines = PurchaseOrderRow & {
  lineItems: Array<{
    id: string;
    productId: string;
    productName: string;
    quantity: number;
    unitCostCents: number;
    receivedQty: number;
  }>;
};

function shapePo(po: PoWithLines) {
  return {
    id: po.id,
    tenantId: po.tenantId,
    poNumber: po.poNumber ?? "",
    vendor: po.vendorName ?? "",
    vendorId: po.vendorId,
    locationId: po.locationId,
    status: po.status,
    expectedDate: po.expectedDate ? po.expectedDate.toISOString() : null,
    notes: po.notes,
    lineItems: po.lineItems.map((li) => ({
      id: li.id,
      productId: li.productId,
      productName: li.productName,
      quantity: li.quantity,
      unitCostCents: li.unitCostCents,
      receivedQty: li.receivedQty,
    })),
    totalCostCents: po.totalCents,
    createdAt: po.createdAt.toISOString(),
    updatedAt: po.updatedAt.toISOString(),
    qboBillId: po.qboBillId,
    qboBillSyncedAt: po.qboBillSyncedAt ? po.qboBillSyncedAt.toISOString() : null,
    qboBillSyncError: po.qboBillSyncError,
    qboBillSyncErrorAt: po.qboBillSyncErrorAt ? po.qboBillSyncErrorAt.toISOString() : null,
  };
}

// ─── Products ─────────────────────────────────────────────────────────────────

// GET /products
router.get("/products", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const query = ListProductsQuerySchema.parse(req.query);

    const where: any = { active: true };
    if (query.category) where.category = query.category;
    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: "insensitive" } },
        { sku: { contains: query.search, mode: "insensitive" } },
        { barcode: { contains: query.search } },
      ];
    }

    // Low-stock filter is applied in JS because reorderPoint comparison is
    // not directly expressible against another column in Prisma.
    if (query.lowStockOnly) {
      const all = await prisma.product.findMany({ where });
      const filtered = all.filter((p) => p.trackInventory && p.qoh <= p.reorderPoint);
      const sorted = filtered.sort((a, b) => {
        const av = (a as any)[query.sortBy] ?? "";
        const bv = (b as any)[query.sortBy] ?? "";
        if (av < bv) return query.sortOrder === "asc" ? -1 : 1;
        if (av > bv) return query.sortOrder === "asc" ? 1 : -1;
        return 0;
      });
      const total = sorted.length;
      const paged = sorted.slice(query.skip, query.skip + query.take);
      return res.json({
        data: paged.map(shapeProduct),
        total,
        skip: query.skip,
        take: query.take,
      });
    }

    const [results, total] = await Promise.all([
      prisma.product.findMany({
        where,
        orderBy: { [query.sortBy]: query.sortOrder },
        skip: query.skip,
        take: query.take,
      }),
      prisma.product.count({ where }),
    ]);

    res.json({
      data: results.map(shapeProduct),
      total,
      skip: query.skip,
      take: query.take,
    });
  } catch (err) {
    next(err);
  }
});

// POST /products
router.post("/products", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req);
    const body = CreateProductSchema.parse(req.body);
    // Tenant-scope every GL account ID we're about to persist as an FK on
    // the new product row. Stops cross-tenant FK writes if a malicious or
    // misconfigured client sends another tenant's account UUID.
    const invalidGl = await findInvalidGlAccountIds(tenantId, [
      body.revenueGlAccountId,
      body.cogsGlAccountId,
      body.inventoryAssetGlAccountId,
    ]);
    if (invalidGl.length > 0) {
      return res.status(400).json({
        error: "One or more GL account IDs do not belong to this tenant",
        code: "INVALID_GL_ACCOUNT_ID",
        invalid: invalidGl,
      });
    }
    // Resolve category defaults into the per-product fields so QBO sync,
    // reports, and tax engine all see consistent values.
    const resolved = await applyCategoryDefaultsToProductData(tenantId, {
      productCategoryId: body.productCategoryId ?? null,
      revenueGlAccountId: body.revenueGlAccountId ?? null,
      cogsGlAccountId: body.cogsGlAccountId ?? null,
      inventoryAssetGlAccountId: body.inventoryAssetGlAccountId ?? null,
      taxClass: body.taxClass ?? null,
    });
    let product = await prisma.product.create({
      data: {
        tenantId,
        name: body.name,
        sku: body.sku,
        barcode: body.barcode ?? null,
        category: body.category ?? null,
        productCategoryId: resolved.productCategoryId,
        costCents: body.costCents,
        priceCents: body.priceCents,
        taxClass: resolved.taxClass,
        reorderPoint: body.reorderPoint,
        trackInventory: body.trackInventory,
        qoh: 0,
        cogsGlAccountId: resolved.cogsGlAccountId ?? null,
        revenueGlAccountId: resolved.revenueGlAccountId ?? null,
        inventoryAssetGlAccountId: resolved.inventoryAssetGlAccountId ?? null,
        locationId: body.locationId ?? null,
        active: true,
      } satisfies Prisma.ProductUncheckedCreateInput,
    });
    // Best-effort QBO sync — local create always succeeds even if QBO is offline
    if (product.trackInventory) {
      product = await tryPushProductToQbo(product);
    }
    res.status(201).json(shapeProduct(product));
  } catch (err) {
    next(err);
  }
});

// GET /products/:id
router.get("/products/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const product = await prisma.product.findFirst({ where: { id: req.params.id } });
    if (!product) return res.status(404).json({ error: "Product not found" });

    const [productAdjustments, productPOs] = await Promise.all([
      prisma.inventoryAdjustment.findMany({
        where: { productId: product.id },
        orderBy: { createdAt: "desc" },
      }),
      prisma.purchaseOrder.findMany({
        where: {
          lineItems: { some: { productId: product.id } },
        },
        include: { lineItems: true },
        orderBy: { createdAt: "desc" },
      }),
    ]);

    res.json({
      ...shapeProduct(product),
      adjustments: productAdjustments.map(shapeAdjustment),
      purchaseOrders: productPOs.map((po) => shapePo(po as PoWithLines)),
    });
  } catch (err) {
    next(err);
  }
});

// PUT /products/:id
router.put("/products/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = UpdateProductSchema.parse(req.body);
    const existing = await prisma.product.findFirst({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: "Product not found" });

    // Tenant-scope every GL account ID the caller is trying to write so a
    // cross-tenant FK can't be slipped in via PUT.
    const invalidGl = await findInvalidGlAccountIds(existing.tenantId, [
      body.revenueGlAccountId,
      body.cogsGlAccountId,
      body.inventoryAssetGlAccountId,
    ]);
    if (invalidGl.length > 0) {
      return res.status(400).json({
        error: "One or more GL account IDs do not belong to this tenant",
        code: "INVALID_GL_ACCOUNT_ID",
        invalid: invalidGl,
      });
    }

    const data: Prisma.ProductUncheckedUpdateInput = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.sku !== undefined) data.sku = body.sku;
    if (body.barcode !== undefined) data.barcode = body.barcode;
    if (body.category !== undefined) data.category = body.category;
    if (body.productCategoryId !== undefined) data.productCategoryId = body.productCategoryId;
    if (body.costCents !== undefined) data.costCents = body.costCents;
    if (body.priceCents !== undefined) data.priceCents = body.priceCents;
    if (body.taxClass !== undefined) data.taxClass = body.taxClass;
    if (body.reorderPoint !== undefined) data.reorderPoint = body.reorderPoint;
    if (body.trackInventory !== undefined) data.trackInventory = body.trackInventory;
    if (body.cogsGlAccountId !== undefined) data.cogsGlAccountId = body.cogsGlAccountId;
    if (body.revenueGlAccountId !== undefined) data.revenueGlAccountId = body.revenueGlAccountId;
    if (body.inventoryAssetGlAccountId !== undefined) data.inventoryAssetGlAccountId = body.inventoryAssetGlAccountId;
    if (body.locationId !== undefined) data.locationId = body.locationId;

    // When the caller switches to (or arrives in) a category, copy that
    // category's defaults onto any per-product field that's still blank —
    // both fields the caller explicitly nulled in this request and fields
    // that were already null on the existing row. Per-product values that
    // already exist (and weren't being changed) stay put.
    const categoryChanged =
      body.productCategoryId !== undefined &&
      body.productCategoryId !== existing.productCategoryId;
    const effectiveCategoryId =
      body.productCategoryId !== undefined ? body.productCategoryId : existing.productCategoryId;

    if (effectiveCategoryId) {
      // Compute "would be after this update" for each per-product field, then
      // hand the partial to the helper which fills in null fields from the
      // category defaults. This preserves caller intent (explicit nulls when
      // the category is changing) while back-filling untouched columns.
      const after = {
        productCategoryId: effectiveCategoryId,
        revenueGlAccountId:
          body.revenueGlAccountId !== undefined
            ? body.revenueGlAccountId
            : categoryChanged
              ? null
              : existing.revenueGlAccountId,
        cogsGlAccountId:
          body.cogsGlAccountId !== undefined
            ? body.cogsGlAccountId
            : categoryChanged
              ? null
              : existing.cogsGlAccountId,
        inventoryAssetGlAccountId:
          body.inventoryAssetGlAccountId !== undefined
            ? body.inventoryAssetGlAccountId
            : categoryChanged
              ? null
              : existing.inventoryAssetGlAccountId,
        taxClass:
          body.taxClass !== undefined
            ? body.taxClass
            : categoryChanged
              ? null
              : existing.taxClass,
      };
      const resolved = await applyCategoryDefaultsToProductData(existing.tenantId, after);
      // Write the resolved value back whenever it differs from what's on the
      // row today — including for fields the caller didn't mention.
      if (resolved.revenueGlAccountId !== existing.revenueGlAccountId) {
        data.revenueGlAccountId = resolved.revenueGlAccountId;
      }
      if (resolved.cogsGlAccountId !== existing.cogsGlAccountId) {
        data.cogsGlAccountId = resolved.cogsGlAccountId;
      }
      if (resolved.inventoryAssetGlAccountId !== existing.inventoryAssetGlAccountId) {
        data.inventoryAssetGlAccountId = resolved.inventoryAssetGlAccountId;
      }
      if (resolved.taxClass !== existing.taxClass) {
        data.taxClass = resolved.taxClass;
      }
    }

    let product = await prisma.product.update({
      where: { id: existing.id },
      data,
    });
    // Re-sync to QBO so price/cost/account changes propagate
    if (product.trackInventory) {
      product = await tryPushProductToQbo(product);
    }
    res.json(shapeProduct(product));
  } catch (err) {
    next(err);
  }
});

// POST /products/:id/qbo-sync — manually trigger a push to QBO
router.post("/products/:id/qbo-sync", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const product = await prisma.product.findFirst({ where: { id: req.params.id } });
    if (!product) return res.status(404).json({ error: "Product not found" });
    if (!product.trackInventory) {
      return res
        .status(400)
        .json({ error: "Product does not track inventory — only inventory items sync to QBO" });
    }
    try {
      const result = await syncInventoryItem(
        {
          productId: product.id,
          name: product.name,
          sku: product.sku,
          description: null,
          priceCents: product.priceCents,
          costCents: product.costCents ?? 0,
          qoh: product.qoh,
          incomeGlAccountId: product.revenueGlAccountId,
          inventoryAssetGlAccountId: product.inventoryAssetGlAccountId,
          cogsGlAccountId: product.cogsGlAccountId,
        },
        product.tenantId,
        product.locationId,
      );
      const updated = await prisma.product.update({
        where: { id: product.id },
        data: {
          qboItemId: result.qboItemId,
          qboItemSyncedAt: new Date(),
          qboItemSyncError: null,
          qboItemSyncErrorAt: null,
        },
      });
      res.json({ success: true, qboItemId: result.qboItemId, product: shapeProduct(updated) });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const updated = await prisma.product.update({
        where: { id: product.id },
        data: {
          qboItemSyncError: msg.slice(0, 1000),
          qboItemSyncErrorAt: new Date(),
        },
      });
      res.status(502).json({ success: false, error: msg, product: shapeProduct(updated) });
    }
  } catch (err) {
    next(err);
  }
});

// DELETE /products/:id (soft delete)
router.delete("/products/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const existing = await prisma.product.findFirst({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: "Product not found" });

    await prisma.product.update({
      where: { id: existing.id },
      data: { active: false },
    });
    res.json({ message: "Product deactivated", id: existing.id });
  } catch (err) {
    next(err);
  }
});

// ─── Product Categories ──────────────────────────────────────────────────────
// Categories own default GL accounts (revenue/COGS/inventory asset) and a
// default tax category + taxable flag. Products can link to a category and
// inherit those defaults; per-product fields override.

const CategorySchema = z.object({
  name: z.string().min(1).max(120),
  defaultRevenueGlAccountId: z.string().uuid().optional().nullable(),
  defaultCogsGlAccountId: z.string().uuid().optional().nullable(),
  defaultInventoryAssetGlAccountId: z.string().uuid().optional().nullable(),
  defaultTaxCategory: z.string().optional().nullable(),
  taxable: z.boolean().default(true),
  active: z.boolean().default(true),
});

const UpdateCategorySchema = CategorySchema.partial();

router.get("/categories", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const includeInactive = req.query.includeInactive === "true";
    const rows = await prisma.productCategory.findMany({
      where: includeInactive ? {} : { active: true },
      orderBy: { name: "asc" },
    });
    res.json({ categories: rows });
  } catch (err) {
    next(err);
  }
});

router.post("/categories", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req);
    const body = CategorySchema.parse(req.body);
    // Tenant-scope every default GL ID before they're persisted so the
    // category can't be created pointing at another tenant's chart of
    // accounts (which would propagate via product inheritance).
    const invalidGl = await findInvalidGlAccountIds(tenantId, [
      body.defaultRevenueGlAccountId,
      body.defaultCogsGlAccountId,
      body.defaultInventoryAssetGlAccountId,
    ]);
    if (invalidGl.length > 0) {
      return res.status(400).json({
        error: "One or more GL account IDs do not belong to this tenant",
        code: "INVALID_GL_ACCOUNT_ID",
        invalid: invalidGl,
      });
    }
    const created = await prisma.productCategory.create({
      data: {
        tenantId,
        name: body.name,
        defaultRevenueGlAccountId: body.defaultRevenueGlAccountId ?? null,
        defaultCogsGlAccountId: body.defaultCogsGlAccountId ?? null,
        defaultInventoryAssetGlAccountId: body.defaultInventoryAssetGlAccountId ?? null,
        defaultTaxCategory: body.defaultTaxCategory ?? null,
        taxable: body.taxable,
        active: body.active,
      },
    });
    res.status(201).json(created);
  } catch (err: any) {
    if (err?.code === "P2002") {
      return res.status(409).json({ error: "A category with that name already exists" });
    }
    next(err);
  }
});

router.put("/categories/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = UpdateCategorySchema.parse(req.body);
    const existing = await prisma.productCategory.findFirst({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: "Category not found" });

    // Tenant-scope every default GL ID the caller is updating, just like
    // POST — stops cross-tenant FK rewrites via the edit form.
    const invalidGl = await findInvalidGlAccountIds(existing.tenantId, [
      body.defaultRevenueGlAccountId,
      body.defaultCogsGlAccountId,
      body.defaultInventoryAssetGlAccountId,
    ]);
    if (invalidGl.length > 0) {
      return res.status(400).json({
        error: "One or more GL account IDs do not belong to this tenant",
        code: "INVALID_GL_ACCOUNT_ID",
        invalid: invalidGl,
      });
    }

    const data: Prisma.ProductCategoryUncheckedUpdateInput = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.defaultRevenueGlAccountId !== undefined) data.defaultRevenueGlAccountId = body.defaultRevenueGlAccountId;
    if (body.defaultCogsGlAccountId !== undefined) data.defaultCogsGlAccountId = body.defaultCogsGlAccountId;
    if (body.defaultInventoryAssetGlAccountId !== undefined) data.defaultInventoryAssetGlAccountId = body.defaultInventoryAssetGlAccountId;
    if (body.defaultTaxCategory !== undefined) data.defaultTaxCategory = body.defaultTaxCategory;
    if (body.taxable !== undefined) data.taxable = body.taxable;
    if (body.active !== undefined) data.active = body.active;
    data.updatedAt = new Date();

    const updated = await prisma.productCategory.update({
      where: { id: existing.id },
      data,
    });
    res.json(updated);
  } catch (err: any) {
    if (err?.code === "P2002") {
      return res.status(409).json({ error: "A category with that name already exists" });
    }
    next(err);
  }
});

router.delete("/categories/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const existing = await prisma.productCategory.findFirst({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: "Category not found" });
    // Soft-delete: products keep their FK (ON DELETE SET NULL is the schema
    // default, but we don't want to lose data linkage on accidental clicks).
    const updated = await prisma.productCategory.update({
      where: { id: existing.id },
      data: { active: false, updatedAt: new Date() },
    });
    res.json({ message: "Category deactivated", id: updated.id });
  } catch (err) {
    next(err);
  }
});

// ─── GL Accounts (Chart of Accounts dropdown source) ─────────────────────────
// Lightweight reader so the UI can render <select> dropdowns instead of
// asking users to type raw account numbers. Filterable by type so the GL
// pickers in the category modal & product form only show plausible options.

// Allowed values mirror the Prisma `GLAccountType` enum. Kept in lockstep
// here so we can reject unknown values with a clean 400 instead of letting
// them reach the DB and surface as opaque enum cast errors.
const VALID_GL_ACCOUNT_TYPES: readonly GLAccountType[] = [
  "ASSET",
  "LIABILITY",
  "EQUITY",
  "REVENUE",
  "EXPENSE",
];

router.get("/gl-accounts", async (req: Request, res: Response, next: NextFunction) => {
  try {
    // GlAccount is not in TENANT_SCOPED_MODELS, so filter explicitly to avoid
    // cross-tenant chart-of-accounts exposure.
    const tenantId = getTenantId(req);
    const typeQ = typeof req.query.type === "string" ? req.query.type : "";
    const requested = typeQ
      ? typeQ.split(",").map((s) => s.trim()).filter(Boolean)
      : [];
    const invalid = requested.filter(
      (t) => !VALID_GL_ACCOUNT_TYPES.includes(t as GLAccountType),
    );
    if (invalid.length > 0) {
      return res.status(400).json({
        error: "Invalid GL account type",
        code: "INVALID_GL_ACCOUNT_TYPE",
        invalid,
        allowed: VALID_GL_ACCOUNT_TYPES,
      });
    }
    const types = requested as GLAccountType[];
    const rows = await prisma.glAccount.findMany({
      where: {
        tenantId,
        active: true,
        ...(types.length ? { type: { in: types } } : {}),
      },
      orderBy: [{ type: "asc" }, { accountNumber: "asc" }],
      select: {
        id: true,
        accountNumber: true,
        name: true,
        type: true,
        subType: true,
      },
    });
    res.json({ accounts: rows });
  } catch (err) {
    next(err);
  }
});

// ─── Tax Categories (distinct list for the dropdown) ─────────────────────────
// The tax engine keys off TaxRate.category strings (e.g. "general", "food",
// "fuel"). Surface the distinct set already configured for this tenant PLUS
// a few sensible marina-domain defaults so brand-new tenants without any
// TaxRates still see useful options in the categories UI dropdown.

const DEFAULT_TAX_CATEGORIES = [
  "general",
  "food",
  "fuel",
  "services",
  "lodging",
  "exempt",
] as const;

router.get("/tax-categories", async (req: Request, res: Response, next: NextFunction) => {
  try {
    // TaxRate is not in TENANT_SCOPED_MODELS — filter explicitly.
    const tenantId = getTenantId(req);
    const rates = await prisma.taxRate.findMany({
      where: { tenantId },
      select: { category: true },
      distinct: ["category"],
      orderBy: { category: "asc" },
    });
    const seen = new Set<string>(DEFAULT_TAX_CATEGORIES);
    for (const r of rates) {
      if (r.category) seen.add(r.category);
    }
    res.json({ categories: Array.from(seen).sort() });
  } catch (err) {
    next(err);
  }
});

// ─── Adjustments ──────────────────────────────────────────────────────────────

// POST /adjustments
router.post("/adjustments", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req);
    const body = CreateAdjustmentSchema.parse(req.body);
    const product = await prisma.product.findFirst({ where: { id: body.productId } });
    if (!product) return res.status(404).json({ error: "Product not found" });

    const before = product.qoh;
    const after = before + body.quantityChange;

    const updatedProduct = await prisma.product.update({
      where: { id: product.id },
      data: { qoh: after },
    });

    const adjustment = await prisma.inventoryAdjustment.create({
      data: {
        tenantId,
        productId: product.id,
        productName: product.name,
        quantityChange: body.quantityChange,
        quantityBefore: before,
        quantityAfter: after,
        reason: body.reason,
        notes: body.notes ?? null,
        staffName: body.staffName ?? null,
      },
    });

    // QBO journal entry for damaged/shrinkage/count/return-to-vendor adjustments.
    // 'received' is handled via the Bill flow and 'sold' via QBO's auto-COGS on
    // Item-referenced invoices, so postInventoryAdjustmentJournal short-circuits
    // on those reasons.
    await tryPushAdjustmentJournal(adjustment, updatedProduct);

    const refreshed = await prisma.inventoryAdjustment.findFirst({ where: { id: adjustment.id } });
    res.status(201).json(refreshed ? shapeAdjustment(refreshed) : shapeAdjustment(adjustment));
  } catch (err) {
    next(err);
  }
});

// GET /adjustments
router.get("/adjustments", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const query = ListAdjustmentsQuerySchema.parse(req.query);

    const where: any = {};
    if (query.productId) where.productId = query.productId;
    if (query.reason) where.reason = query.reason;
    if (query.dateFrom || query.dateTo) {
      where.createdAt = {};
      if (query.dateFrom) where.createdAt.gte = new Date(query.dateFrom);
      if (query.dateTo) where.createdAt.lte = new Date(query.dateTo);
    }

    const [results, total] = await Promise.all([
      prisma.inventoryAdjustment.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: query.skip,
        take: query.take,
      }),
      prisma.inventoryAdjustment.count({ where }),
    ]);

    res.json({ data: results.map(shapeAdjustment), total });
  } catch (err) {
    next(err);
  }
});

// ─── Count Sessions ───────────────────────────────────────────────────────────

function shapeCountSession(s: any) {
  return {
    id: s.id,
    tenantId: s.tenantId,
    name: s.name,
    startedBy: s.startedBy,
    status: s.status,
    items: (s.items ?? []).map((it: any) => ({
      id: it.id,
      productId: it.productId,
      productName: it.productName,
      expectedQty: it.expectedQty,
      actualQty: it.actualQty,
      variance: it.variance,
    })),
    createdAt: s.createdAt instanceof Date ? s.createdAt.toISOString() : s.createdAt,
    completedAt: s.completedAt
      ? (s.completedAt instanceof Date ? s.completedAt.toISOString() : s.completedAt)
      : null,
  };
}

// POST /counts
router.post("/counts", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req);
    const body = CreateCountSessionSchema.parse(req.body);
    const session = await prisma.inventoryCountSession.create({
      data: {
        tenantId,
        name: body.name ?? `Count ${new Date().toLocaleDateString()}`,
        startedBy: body.startedBy ?? "Staff",
        status: "in_progress",
      },
    });
    res.status(201).json(shapeCountSession({ ...session, items: [] }));
  } catch (err) {
    next(err);
  }
});

// POST /counts/:id/items
router.post("/counts/:id/items", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const session = await prisma.inventoryCountSession.findFirst({ where: { id: req.params.id } });
    if (!session) return res.status(404).json({ error: "Count session not found" });
    if (session.status === "completed")
      return res.status(400).json({ error: "Count session already completed" });

    const body = SubmitCountItemSchema.parse(req.body);
    const product = await prisma.product.findFirst({ where: { id: body.productId } });

    const item = await prisma.inventoryCountItem.create({
      data: {
        countSessionId: session.id,
        productId: body.productId,
        productName: product?.name ?? "Unknown",
        expectedQty: body.expectedQty,
        actualQty: body.actualQty,
        variance: body.actualQty - body.expectedQty,
      },
    });
    res.status(201).json({
      id: item.id,
      productId: item.productId,
      productName: item.productName,
      expectedQty: item.expectedQty,
      actualQty: item.actualQty,
      variance: item.variance,
    });
  } catch (err) {
    next(err);
  }
});

// PUT /counts/:id/complete
router.put("/counts/:id/complete", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const session = await prisma.inventoryCountSession.findFirst({
      where: { id: req.params.id },
      include: { items: true },
    });
    if (!session) return res.status(404).json({ error: "Count session not found" });
    if (session.status === "completed")
      return res.status(400).json({ error: "Already completed" });

    const generatedAdjustments: AdjustmentRow[] = [];

    for (const item of session.items) {
      if (item.variance !== 0) {
        const product = await prisma.product.findFirst({ where: { id: item.productId } });
        if (product) {
          const before = product.qoh;
          const updatedProduct = await prisma.product.update({
            where: { id: product.id },
            data: { qoh: item.actualQty },
          });
          const adj = await prisma.inventoryAdjustment.create({
            data: {
              tenantId: session.tenantId,
              productId: product.id,
              productName: product.name,
              quantityChange: item.variance,
              quantityBefore: before,
              quantityAfter: item.actualQty,
              reason: "count",
              notes: `Count session ${session.name} — variance: ${item.variance}`,
              staffName: session.startedBy,
              countSessionId: session.id,
            },
          });
          generatedAdjustments.push(adj);
          // Best-effort QBO journal entry for the count variance
          await tryPushAdjustmentJournal(adj, updatedProduct);
        }
      }
    }

    const completed = await prisma.inventoryCountSession.update({
      where: { id: session.id },
      data: { status: "completed", completedAt: new Date() },
      include: { items: true },
    });

    // Re-fetch adjustments so the qbo* fields are up to date
    const refreshedAdjustments =
      generatedAdjustments.length === 0
        ? []
        : await prisma.inventoryAdjustment.findMany({
            where: { id: { in: generatedAdjustments.map((a) => a.id) } },
          });

    res.json({
      session: shapeCountSession(completed),
      adjustments: refreshedAdjustments.map(shapeAdjustment),
    });
  } catch (err) {
    next(err);
  }
});

// GET /counts
router.get("/counts", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const results = await prisma.inventoryCountSession.findMany({
      include: { items: true },
      orderBy: { createdAt: "desc" },
    });
    res.json({ data: results.map(shapeCountSession), total: results.length });
  } catch (err) {
    next(err);
  }
});

// ─── Purchase Orders ──────────────────────────────────────────────────────────

async function nextPoNumber(tenantId: string): Promise<string> {
  const count = await prisma.purchaseOrder.count({ where: { tenantId } });
  return `PO-${String(count + 1).padStart(4, "0")}`;
}

// POST /purchase-orders
router.post("/purchase-orders", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req);
    const body = CreatePurchaseOrderSchema.parse(req.body);

    // Prefetch product names + validate vendor
    const productMap = new Map<string, string>();
    for (const li of body.lineItems) {
      const product = await prisma.product.findFirst({ where: { id: li.productId } });
      productMap.set(li.productId, product?.name ?? "Unknown");
    }

    let vendorId: string | null = body.vendorId ?? null;
    let vendorName = body.vendor ?? "";
    if (vendorId) {
      const v = await prisma.vendor.findFirst({ where: { id: vendorId } });
      if (!v) return res.status(400).json({ error: "Vendor not found" });
      vendorName = v.name;
    }

    const totalCents = body.lineItems.reduce(
      (sum, li) => sum + li.quantity * li.unitCostCents,
      0,
    );

    const poNumber = await nextPoNumber(tenantId);

    const created = await prisma.purchaseOrder.create({
      data: {
        tenantId,
        poNumber,
        vendorId,
        vendorName,
        locationId: body.locationId ?? null,
        status: "draft",
        expectedDate: body.expectedDate ? new Date(body.expectedDate) : null,
        notes: body.notes ?? null,
        totalCents,
        lineItems: {
          create: body.lineItems.map((li) => ({
            tenantId,
            productId: li.productId,
            productName: productMap.get(li.productId) ?? "Unknown",
            quantity: li.quantity,
            unitCostCents: li.unitCostCents,
            receivedQty: 0,
          })),
        },
      },
      include: { lineItems: true },
    });

    res.status(201).json(shapePo(created as PoWithLines));
  } catch (err) {
    next(err);
  }
});

// GET /purchase-orders
router.get("/purchase-orders", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const status = req.query.status as string | undefined;
    const where: any = {};
    if (status) where.status = status;

    const results = await prisma.purchaseOrder.findMany({
      where,
      include: { lineItems: true },
      orderBy: { createdAt: "desc" },
    });
    res.json({
      data: results.map((po) => shapePo(po as PoWithLines)),
      total: results.length,
    });
  } catch (err) {
    next(err);
  }
});

// GET /purchase-orders/:id
router.get("/purchase-orders/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const po = await prisma.purchaseOrder.findFirst({
      where: { id: req.params.id },
      include: { lineItems: true },
    });
    if (!po) return res.status(404).json({ error: "Purchase order not found" });
    res.json(shapePo(po as PoWithLines));
  } catch (err) {
    next(err);
  }
});

// PUT /purchase-orders/:id/receive
router.put("/purchase-orders/:id/receive", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = ReceivePOSchema.parse(req.body);
    const po = await prisma.purchaseOrder.findFirst({
      where: { id: req.params.id },
      include: { lineItems: true },
    });
    if (!po) return res.status(404).json({ error: "Purchase order not found" });
    if (po.status === "cancelled")
      return res.status(400).json({ error: "Cannot receive cancelled PO" });
    if (po.status === "received")
      return res.status(400).json({ error: "PO already fully received" });

    const receivedAdjustments: AdjustmentRow[] = [];

    for (const receiveLine of body.lineItems) {
      const poLine = po.lineItems.find((li) => li.id === receiveLine.lineItemId);
      if (!poLine) continue;

      const maxReceivable = poLine.quantity - poLine.receivedQty;
      const qty = Math.min(receiveLine.receivedQty, maxReceivable);
      if (qty <= 0) continue;

      await prisma.poLineItem.update({
        where: { id: poLine.id },
        data: { receivedQty: poLine.receivedQty + qty },
      });

      const product = await prisma.product.findFirst({ where: { id: poLine.productId } });
      if (product) {
        const before = product.qoh;
        await prisma.product.update({
          where: { id: product.id },
          data: { qoh: before + qty },
        });
        const adj = await prisma.inventoryAdjustment.create({
          data: {
            tenantId: po.tenantId,
            productId: product.id,
            productName: product.name,
            quantityChange: qty,
            quantityBefore: before,
            quantityAfter: before + qty,
            reason: "received",
            notes: `PO ${po.poNumber ?? po.id} — received ${qty} units`,
            staffName: body.receivedBy ?? null,
          },
        });
        receivedAdjustments.push(adj);
      }
    }

    // Reload line items to determine status
    const refreshedLines = await prisma.poLineItem.findMany({
      where: { purchaseOrderId: po.id },
    });
    const allReceived = refreshedLines.every((li) => li.receivedQty >= li.quantity);
    const anyReceived = refreshedLines.some((li) => li.receivedQty > 0);
    const newStatus = allReceived ? "received" : anyReceived ? "partial" : po.status;

    const updatedPo = await prisma.purchaseOrder.update({
      where: { id: po.id },
      data: { status: newStatus },
      include: { lineItems: true },
    });

    // Best-effort QBO Bill for everything received in this batch
    const billLines = receivedAdjustments
      .map((adj) => {
        const poLine = updatedPo.lineItems.find((li) => li.productId === adj.productId);
        return poLine
          ? {
              productId: adj.productId,
              productName: adj.productName,
              receivedQty: adj.quantityChange,
              unitCostCents: poLine.unitCostCents,
            }
          : null;
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
    await tryPushReceivingBill(updatedPo, billLines);

    const finalPo = await prisma.purchaseOrder.findFirst({
      where: { id: po.id },
      include: { lineItems: true },
    });

    res.json({
      purchaseOrder: shapePo(finalPo as PoWithLines),
      adjustments: receivedAdjustments.map(shapeAdjustment),
    });
  } catch (err) {
    next(err);
  }
});

// PUT /purchase-orders/:id/cancel
router.put("/purchase-orders/:id/cancel", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const po = await prisma.purchaseOrder.findFirst({
      where: { id: req.params.id },
      include: { lineItems: true },
    });
    if (!po) return res.status(404).json({ error: "Purchase order not found" });
    if (po.status === "received")
      return res.status(400).json({ error: "Cannot cancel a fully received PO" });

    const updated = await prisma.purchaseOrder.update({
      where: { id: po.id },
      data: { status: "cancelled" },
      include: { lineItems: true },
    });
    res.json(shapePo(updated as PoWithLines));
  } catch (err) {
    next(err);
  }
});

// ─── Labels ───────────────────────────────────────────────────────────────────

// POST /labels — generate ZPL barcode labels
router.post("/labels", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = GenerateLabelsSchema.parse(req.body);
    const products = await prisma.product.findMany({
      where: { id: { in: body.productIds } },
    });

    const zplLabels: string[] = [];
    for (const product of products) {
      const barcode = product.barcode || product.sku || product.id;
      const price = (product.priceCents / 100).toFixed(2);
      for (let i = 0; i < body.labelQty; i++) {
        zplLabels.push(
          `^XA\n^FO50,50^A0N,30,30^FD${product.name}^FS\n^FO50,90^A0N,20,20^FDSKU: ${product.sku ?? ""}^FS\n^FO50,120^BY2^BCN,80,Y,N,N^FD${barcode}^FS\n^FO50,220^A0N,25,25^FD$${price}^FS\n^XZ`
        );
      }
    }

    res.json({ labels: zplLabels, count: zplLabels.length });
  } catch (err) {
    next(err);
  }
});

// ─── Valuation ────────────────────────────────────────────────────────────────

// GET /valuation — FIFO-based inventory valuation
router.get("/valuation", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const activeProducts = await prisma.product.findMany({
      where: { active: true, trackInventory: true },
    });

    let totalCostValue = 0;
    let totalRetailValue = 0;

    const items = activeProducts.map((p) => {
      const cost = p.costCents ?? 0;
      const costTotal = p.qoh * cost;
      const retailTotal = p.qoh * p.priceCents;
      totalCostValue += costTotal;
      totalRetailValue += retailTotal;
      const margin = p.priceCents > 0 ? ((p.priceCents - cost) / p.priceCents) * 100 : 0;

      return {
        productId: p.id,
        name: p.name,
        sku: p.sku ?? "",
        category: p.category ?? "",
        qoh: p.qoh,
        unitCostCents: cost,
        totalCostCents: costTotal,
        retailPriceCents: p.priceCents,
        totalRetailCents: retailTotal,
        marginPercent: Math.round(margin * 100) / 100,
      };
    });

    const avgMargin =
      totalRetailValue > 0
        ? ((totalRetailValue - totalCostValue) / totalRetailValue) * 100
        : 0;

    res.json({
      totalCostCents: totalCostValue,
      totalRetailCents: totalRetailValue,
      averageMarginPercent: Math.round(avgMargin * 100) / 100,
      items,
    });
  } catch (err) {
    next(err);
  }
});

// ─── Reorder Alerts ───────────────────────────────────────────────────────────

// GET /reorder-alerts
router.get("/reorder-alerts", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const products = await prisma.product.findMany({
      where: { active: true, trackInventory: true },
    });
    const alerts = products.filter((p) => p.qoh <= p.reorderPoint);
    res.json({
      data: alerts.map((p) => ({
        productId: p.id,
        name: p.name,
        sku: p.sku ?? "",
        category: p.category ?? "",
        qoh: p.qoh,
        reorderPoint: p.reorderPoint,
        deficit: p.reorderPoint - p.qoh,
      })),
      total: alerts.length,
    });
  } catch (err) {
    next(err);
  }
});

// ─── Vendors ──────────────────────────────────────────────────────────────────

router.get("/vendors", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const vendors = await prisma.vendor.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
    });
    res.json({ data: vendors, total: vendors.length });
  } catch (err) {
    next(err);
  }
});

router.post("/vendors", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req);
    const body = CreateVendorSchema.parse(req.body);
    const vendor = await prisma.vendor.create({
      data: {
        tenantId,
        name: body.name,
        email: body.email ?? null,
        phone: body.phone ?? null,
        address: body.address ?? null,
      },
    });
    // Best-effort QBO push
    try {
      await syncVendor(
        {
          vendorId: vendor.id,
          name: vendor.name,
          email: vendor.email,
          phone: vendor.phone,
          address: vendor.address,
        },
        tenantId,
      );
    } catch (err) {
      console.warn(`[inventory] QBO vendor sync failed for ${vendor.id}:`, err);
    }
    const refreshed = await prisma.vendor.findUnique({ where: { id: vendor.id } });
    res.status(201).json(refreshed);
  } catch (err) {
    next(err);
  }
});

router.put("/vendors/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req);
    const body = UpdateVendorSchema.parse(req.body);
    const existing = await prisma.vendor.findFirst({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: "Vendor not found" });
    const vendor = await prisma.vendor.update({
      where: { id: existing.id },
      data: {
        name: body.name ?? existing.name,
        email: body.email !== undefined ? body.email : existing.email,
        phone: body.phone !== undefined ? body.phone : existing.phone,
        address: body.address !== undefined ? body.address : existing.address,
      },
    });
    try {
      await syncVendor(
        {
          vendorId: vendor.id,
          name: vendor.name,
          email: vendor.email,
          phone: vendor.phone,
          address: vendor.address,
        },
        tenantId,
      );
    } catch (err) {
      console.warn(`[inventory] QBO vendor sync failed for ${vendor.id}:`, err);
    }
    const refreshed = await prisma.vendor.findUnique({ where: { id: vendor.id } });
    res.json(refreshed);
  } catch (err) {
    next(err);
  }
});

router.delete("/vendors/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const existing = await prisma.vendor.findFirst({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: "Vendor not found" });
    await prisma.vendor.update({ where: { id: existing.id }, data: { active: false } });
    res.json({ message: "Vendor deactivated", id: existing.id });
  } catch (err) {
    next(err);
  }
});

// ─── Bulk QBO retry ───────────────────────────────────────────────────────────

export interface QboInventoryRetryResult {
  attempted: number;
  succeeded: number;
  failed: number;
  skipped: number;
  details: Array<{
    sourceType: string;
    sourceId: string;
    qboType: string;
    status: "succeeded" | "failed" | "skipped";
    error?: string;
  }>;
}

export type QboInventoryRetryProgress = (snapshot: {
  total: number;
  processed: number;
  attempted: number;
  succeeded: number;
  failed: number;
  skipped: number;
  lastDetail: QboInventoryRetryResult["details"][number];
}) => void;

/**
 * Walks every failed QBO inventory sync ref for a tenant and re-attempts the
 * push. Iterates products, inventory adjustments, purchase-order bills, and
 * vendors. Per-record error fields are cleared on success and re-stamped on
 * continued failure (the underlying try* helpers do that bookkeeping). Records
 * whose local source row is no longer present in memory are reported as
 * "skipped" rather than counted as a failure.
 *
 * Optional `onProgress` is invoked after every record (succeeded, failed, or
 * skipped) with cumulative counts and the most recent detail entry. It powers
 * the job-based polling endpoint that drives the Settings UI's live progress
 * counter so long-running retries don't block a single HTTP request.
 *
 * When `opts.dueOnly` is true, refs whose `nextRetryAt` is still in the future
 * are excluded — used by the background sweep so a record under exponential
 * backoff is not retried before its scheduled time.
 */
export async function retryFailedQboInventorySyncs(
  tenantId: string,
  opts: { dueOnly?: boolean; now?: Date } = {},
  onProgress?: QboInventoryRetryProgress,
): Promise<QboInventoryRetryResult> {
  const failedRefs = await findFailedInventorySyncRefs(tenantId, opts);
  const total = failedRefs.length;
  const result: QboInventoryRetryResult = {
    attempted: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    details: [],
  };

  const emit = () => {
    if (!onProgress) return;
    const lastDetail = result.details[result.details.length - 1]!;
    try {
      onProgress({
        total,
        processed: result.details.length,
        attempted: result.attempted,
        succeeded: result.succeeded,
        failed: result.failed,
        skipped: result.skipped,
        lastDetail,
      });
    } catch (err) {
      // Progress reporters must never break the retry loop.
      console.warn(`[inventory] retry progress callback threw: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const recordDetail = (detail: QboInventoryRetryResult["details"][number]) => {
    result.details.push(detail);
    emit();
  };

  for (const ref of failedRefs) {
    if (ref.sourceType === "product") {
      const product = await prisma.product.findFirst({ where: { id: ref.sourceId, tenantId } });
      if (!product) {
        result.skipped++;
        recordDetail({ sourceType: ref.sourceType, sourceId: ref.sourceId, qboType: ref.qboType, status: "skipped", error: "Product no longer exists locally" });
        continue;
      }
      if (!product.trackInventory) {
        result.skipped++;
        recordDetail({ sourceType: ref.sourceType, sourceId: ref.sourceId, qboType: ref.qboType, status: "skipped", error: "Product no longer tracks inventory" });
        continue;
      }
      result.attempted++;
      const updated = await tryPushProductToQbo(product);
      if (updated.qboItemSyncError) {
        result.failed++;
        recordDetail({ sourceType: ref.sourceType, sourceId: ref.sourceId, qboType: ref.qboType, status: "failed", error: updated.qboItemSyncError });
      } else {
        result.succeeded++;
        recordDetail({ sourceType: ref.sourceType, sourceId: ref.sourceId, qboType: ref.qboType, status: "succeeded" });
      }
    } else if (ref.sourceType === "inventory_adjustment") {
      const adjustment = await prisma.inventoryAdjustment.findFirst({
        where: { id: ref.sourceId, tenantId },
      });
      if (!adjustment) {
        result.skipped++;
        recordDetail({ sourceType: ref.sourceType, sourceId: ref.sourceId, qboType: ref.qboType, status: "skipped", error: "Adjustment no longer exists locally" });
        continue;
      }
      const product = await prisma.product.findFirst({
        where: { id: adjustment.productId, tenantId },
      });
      if (!product) {
        result.skipped++;
        recordDetail({ sourceType: ref.sourceType, sourceId: ref.sourceId, qboType: ref.qboType, status: "skipped", error: "Adjustment's product no longer exists locally" });
        continue;
      }
      result.attempted++;
      await tryPushAdjustmentJournal(adjustment, product);
      const refreshed = await prisma.inventoryAdjustment.findFirst({
        where: { id: adjustment.id, tenantId },
      });
      if (refreshed?.qboSyncError) {
        result.failed++;
        recordDetail({ sourceType: ref.sourceType, sourceId: ref.sourceId, qboType: ref.qboType, status: "failed", error: refreshed.qboSyncError });
      } else {
        result.succeeded++;
        recordDetail({ sourceType: ref.sourceType, sourceId: ref.sourceId, qboType: ref.qboType, status: "succeeded" });
      }
    } else if (ref.sourceType === "purchase_order") {
      const po = await prisma.purchaseOrder.findFirst({
        where: { id: ref.sourceId, tenantId },
        include: { lineItems: true },
      });
      if (!po) {
        result.skipped++;
        recordDetail({ sourceType: ref.sourceType, sourceId: ref.sourceId, qboType: ref.qboType, status: "skipped", error: "Purchase order no longer exists locally" });
        continue;
      }
      const billLines = po.lineItems
        .filter((li) => li.receivedQty > 0)
        .map((li) => ({
          productId: li.productId,
          productName: li.productName,
          receivedQty: li.receivedQty,
          unitCostCents: li.unitCostCents,
        }));
      if (!billLines.length) {
        result.skipped++;
        recordDetail({ sourceType: ref.sourceType, sourceId: ref.sourceId, qboType: ref.qboType, status: "skipped", error: "No received lines to bill" });
        continue;
      }
      // Don't force-push on retry: if a Bill was already created we must not
      // double-bill the vendor. The sync ref's qboId tracks that state.
      result.attempted++;
      try {
        const billResult = await syncReceivingBill(
          {
            purchaseOrderId: po.id,
            poNumber: po.poNumber ?? po.id,
            vendorId: po.vendorId,
            expectedDate: po.expectedDate ?? null,
            lines: billLines,
            forcePush: false,
          },
          po.tenantId,
          po.locationId,
        );
        await prisma.purchaseOrder.update({
          where: { id: po.id },
          data: {
            qboBillId: billResult.qboBillId,
            qboBillSyncedAt: new Date(),
            qboBillSyncError: null,
            qboBillSyncErrorAt: null,
          },
        });
        result.succeeded++;
        recordDetail({ sourceType: ref.sourceType, sourceId: ref.sourceId, qboType: ref.qboType, status: "succeeded" });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await prisma.purchaseOrder.update({
          where: { id: po.id },
          data: {
            qboBillSyncError: msg.slice(0, 1000),
            qboBillSyncErrorAt: new Date(),
          },
        });
        result.failed++;
        recordDetail({ sourceType: ref.sourceType, sourceId: ref.sourceId, qboType: ref.qboType, status: "failed", error: msg });
      }
    } else if (ref.sourceType === "vendor") {
      const vendor = await prisma.vendor.findFirst({ where: { id: ref.sourceId, tenantId } });
      if (!vendor) {
        result.skipped++;
        recordDetail({ sourceType: ref.sourceType, sourceId: ref.sourceId, qboType: ref.qboType, status: "skipped", error: "Vendor no longer exists" });
        continue;
      }
      result.attempted++;
      try {
        await syncVendor(
          {
            vendorId: vendor.id,
            name: vendor.name,
            email: vendor.email,
            phone: vendor.phone,
            address: vendor.address,
          },
          tenantId,
        );
        result.succeeded++;
        recordDetail({ sourceType: ref.sourceType, sourceId: ref.sourceId, qboType: ref.qboType, status: "succeeded" });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        result.failed++;
        recordDetail({ sourceType: ref.sourceType, sourceId: ref.sourceId, qboType: ref.qboType, status: "failed", error: msg });
      }
    } else {
      result.skipped++;
      recordDetail({ sourceType: ref.sourceType, sourceId: ref.sourceId, qboType: ref.qboType, status: "skipped", error: `Unsupported sourceType: ${ref.sourceType}` });
    }
  }

  return result;
}

export default router;
