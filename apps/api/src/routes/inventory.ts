import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { clerkAuth } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";
import { Prisma, GLAccountType } from "@prisma/client";
import {
  resolveProductGlAccounts,
  resolveProductGlAccountsStrict,
} from "../services/gl-account-resolver.js";
import { recordInventoryReceipt } from "../services/costing-engine.js";
import {
  syncInventoryItem,
  syncReceivingBill,
  syncVendor,
  postInventoryAdjustmentJournal,
  findFailedInventorySyncRefs,
  createQboRefundReceipt,
  parsePaymentRefundSyncSourceId,
  PAYMENT_REFUND_SYNC_SOURCE_TYPE,
  type PoBillLineInput,
} from "../services/qbo-sync.js";

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
  try {
    if (!product.locationId) {
      // QBO items live in a per-location chart; without a location we cannot
      // pick the correct (category, location) mapping. Surface this in the
      // canonical wording so the UI deep-link works.
      throw new Error(
        `MISSING_GL_MAPPING: Product "${product.name}" has no locationId set. ` +
        `Assign the product to a location before syncing to QuickBooks.`,
      );
    }
    // Service-style (non-tracked) products only need a revenue (Income)
    // mapping in QBO — they sync as Type:"Service" and skip the asset/COGS
    // plumbing entirely.
    const requiredSlots = product.trackInventory
      ? (["revenue", "cogs", "inventoryAsset"] as const)
      : (["revenue"] as const);
    const resolved = await resolveProductGlAccountsStrict(
      product.tenantId,
      product.id,
      product.locationId,
      requiredSlots,
    );
    const result = await syncInventoryItem(
      {
        productId: product.id,
        name: product.name,
        sku: product.sku,
        description: null,
        priceCents: product.priceCents,
        costCents: product.costCents ?? 0,
        qoh: product.qoh,
        trackInventory: product.trackInventory,
        incomeGlAccountId: resolved.revenueGlAccountId,
        inventoryAssetGlAccountId: resolved.inventoryAssetGlAccountId,
        cogsGlAccountId: resolved.cogsGlAccountId,
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
    if (!product.locationId) {
      throw new Error(
        `MISSING_GL_MAPPING: Product "${product.name}" has no locationId set. ` +
        `Assign the product to a location before posting inventory ` +
        `adjustment journal entries.`,
      );
    }
    const resolved = await resolveProductGlAccountsStrict(
      product.tenantId,
      product.id,
      product.locationId,
      ["revenue", "cogs", "inventoryAsset"],
    );
    const result = await postInventoryAdjustmentJournal(
      {
        adjustmentId: adjustment.id,
        productId: product.id,
        productName: product.name,
        reason: adjustment.reason,
        quantityChange: adjustment.quantityChange,
        unitCostCents: product.costCents ?? 0,
        inventoryAssetGlAccountId: resolved.inventoryAssetGlAccountId,
        cogsGlAccountId: resolved.cogsGlAccountId,
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
  // When provided, narrow the listing to products tied to this location
  // (or to the tenant-wide pool with locationId=null). The response is
  // also enriched with `effective*GlAccountId` fields resolved via the
  // per-location → category-default → legacy chain.
  locationId: z.string().optional(),
  skip: z.coerce.number().int().min(0).default(0),
  take: z.coerce.number().int().positive().max(100).default(25),
  sortBy: z.enum(["name", "sku", "category", "qoh", "createdAt"]).default("name"),
  sortOrder: z.enum(["asc", "desc"]).default("asc"),
});

const CreateProductSchema = z.object({
  name: z.string().min(1),
  sku: z.string().min(1),
  barcode: z.string().optional().nullable(),
  // Legacy free-text category — kept for backwards-compat (UI tag only).
  category: z.string().optional().nullable(),
  // Required: every product belongs to a ProductCategory; the category's
  // per-location ProductCategoryGlMapping rows drive all GL postings.
  productCategoryId: z.string().uuid(),
  costCents: z.number().int().min(0),
  priceCents: z.number().int().min(0),
  taxClass: z.string().optional().nullable(),
  reorderPoint: z.number().int().min(0).default(0),
  trackInventory: z.boolean().default(true),
  locationId: z.string().optional().nullable(),
});

// Updates require productCategoryId in the request body — every other field
// is optional, but category is the single source of truth for inventory GL
// resolution and the column is NOT NULL after
// 20260429080000_inventory_category_only_gl. Leaving it optional here would
// let callers silently mutate a product without re-affirming its category
// and silently break GL resolution if the existing category is later
// deactivated; we surface that as a 400 instead.
const UpdateProductSchema = CreateProductSchema.partial().extend({
  productCategoryId: z.string().uuid(),
});

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
      // Unit cost at receipt — defaults to the PO line's original cost when omitted
      unitCostCents: z.number().int().min(0).optional(),
    })
  ).min(1),
  locationId: z.string().optional().nullable(),
  receivedBy: z.string().optional(),
});

const GenerateLabelsSchema = z.object({
  productIds: z.array(z.string().min(1)).min(1),
  labelQty: z.number().int().positive().default(1),
});

function getTenantId(req: Request): string {
  return (req as any).tenantId ?? (req as any).userRecord?.tenant_id ?? "default";
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
    receivedAt?: Date | null;
    unitCostAtReceipt?: number | null;
    product?: { id: string; name: string; sku: string | null } | null;
  }>;
};

function shapePo(po: PoWithLines) {
  return {
    id: po.id,
    tenantId: po.tenantId,
    locationId: po.locationId,
    poNumber: po.poNumber ?? "",
    status: po.status,
    vendorId: po.vendorId,
    vendorName: po.vendorName ?? "",
    vendor: po.vendorName ?? "",
    expectedDate: po.expectedDate ? po.expectedDate.toISOString() : null,
    receivedAt: po.receivedAt ? (po.receivedAt as Date).toISOString() : null,
    receivedByUserId: po.receivedByUserId ?? null,
    totalCents: po.totalCents,
    notes: po.notes,
    qboBillId: po.qboBillId,
    qboBillSyncedAt: po.qboBillSyncedAt ? po.qboBillSyncedAt.toISOString() : null,
    qboBillSyncError: po.qboBillSyncError,
    qboBillSyncErrorAt: po.qboBillSyncErrorAt ? po.qboBillSyncErrorAt.toISOString() : null,
    createdAt: po.createdAt.toISOString(),
    updatedAt: po.updatedAt.toISOString(),
    lineItems: po.lineItems.map((li) => ({
      id: li.id,
      productId: li.productId,
      productName: li.productName,
      quantity: li.quantity,
      unitCostCents: li.unitCostCents,
      receivedQty: li.receivedQty,
      receivedAt: li.receivedAt ? li.receivedAt.toISOString() : null,
      unitCostAtReceipt: li.unitCostAtReceipt ?? null,
    })),
  };
}

// ─── Products ─────────────────────────────────────────────────────────────────

// Resolve effective per-location GL accounts for a batch of products in a
// single query against ProductCategoryGlMapping. Mirrors
// `resolveProductGlAccounts`: the per-(category, location) row is the only
// rung — there are no legacy fallbacks (those columns were retired in
// 20260429080000_inventory_category_only_gl).
async function batchResolveEffectiveGl(
  tenantId: string,
  locationId: string,
  products: Array<Pick<ProductRow, "id" | "productCategoryId">>,
): Promise<Map<string, { revenue: string | null; cogs: string | null; inv: string | null }>> {
  const out = new Map<string, { revenue: string | null; cogs: string | null; inv: string | null }>();
  if (products.length === 0) return out;

  const categoryIds = Array.from(
    new Set(products.map((p) => p.productCategoryId).filter((v): v is string => !!v)),
  );

  const cMappings = categoryIds.length > 0
    ? await prisma.productCategoryGlMapping.findMany({
        where: { tenantId, locationId, productCategoryId: { in: categoryIds } },
        select: {
          productCategoryId: true,
          revenueGlAccountId: true,
          cogsGlAccountId: true,
          inventoryAssetGlAccountId: true,
        },
      })
    : [];

  const cMap = new Map<string, { revenue: string | null; cogs: string | null; inv: string | null }>();
  for (const m of cMappings) {
    cMap.set(m.productCategoryId, {
      revenue: m.revenueGlAccountId,
      cogs: m.cogsGlAccountId,
      inv: m.inventoryAssetGlAccountId,
    });
  }

  for (const p of products) {
    const cOver = p.productCategoryId ? cMap.get(p.productCategoryId) : undefined;
    out.set(p.id, {
      revenue: cOver?.revenue ?? null,
      cogs: cOver?.cogs ?? null,
      inv: cOver?.inv ?? null,
    });
  }
  return out;
}

function shapeProductWithEffective(
  p: ProductRow,
  effective?: { revenue: string | null; cogs: string | null; inv: string | null },
) {
  const base = shapeProduct(p);
  if (!effective) return base;
  return {
    ...base,
    effectiveRevenueGlAccountId: effective.revenue,
    effectiveCogsGlAccountId: effective.cogs,
    effectiveInventoryAssetGlAccountId: effective.inv,
  };
}

// POST /products/clear-tax-overrides
// Bulk-clear per-product taxClass overrides so every product inherits its
// category's defaultTaxCategory. This is the recommended workflow: tax
// belongs on the ProductCategory, and per-product values exist only as
// rare exceptions. Optional locationId scopes the reset to one marina;
// without it we touch every product in the tenant.
router.post(
  "/products/clear-tax-overrides",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = getTenantId(req);
      const body = z
        .object({ locationId: z.string().uuid().optional().nullable() })
        .parse(req.body ?? {});
      // Validate locationId ownership when provided so a caller can't
      // affect another tenant's data by passing a foreign id.
      if (body.locationId) {
        const owned = await prisma.location.findFirst({
          where: { id: body.locationId, tenantId },
          select: { id: true },
        });
        if (!owned) {
          return res
            .status(400)
            .json({ error: "Location not found", code: "LOCATION_NOT_FOUND" });
        }
      }
      const result = await prisma.product.updateMany({
        where: {
          tenantId,
          ...(body.locationId ? { locationId: body.locationId } : {}),
          taxClass: { not: null },
        },
        data: { taxClass: null },
      });
      res.json({ cleared: result.count });
    } catch (err) {
      next(err);
    }
  },
);

// GET /products
router.get("/products", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const query = ListProductsQuerySchema.parse(req.query);
    const tenantId = getTenantId(req);

    // Validate locationId belongs to the caller's tenant before we use it
    // anywhere downstream (filtering, batchResolveEffectiveGl). Without this
    // check a foreign locationId could influence QBO suppression in the
    // effective-GL fallback resolver and leak existence metadata.
    if (query.locationId) {
      const owned = await prisma.location.findFirst({
        where: { id: query.locationId, tenantId },
        select: { id: true },
      });
      if (!owned) {
        return res.status(404).json({ error: "Location not found" });
      }
    }

    const where: any = { active: true };
    if (query.category) where.category = query.category;
    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: "insensitive" } },
        { sku: { contains: query.search, mode: "insensitive" } },
        { barcode: { contains: query.search } },
      ];
    }
    // Single-location mode: only return products that belong to THIS
    // location. We used to also include tenant-wide products
    // (locationId IS NULL) here, but that leaked legacy unassigned
    // products into every marina's inventory list. The
    // 20260512000000_backfill_product_location migration assigns every
    // remaining null-location product to each tenant's primary
    // location so the strict filter is safe (Task #340).
    if (query.locationId) {
      where.locationId = query.locationId;
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
      const effectiveMap = query.locationId
        ? await batchResolveEffectiveGl(tenantId, query.locationId, paged)
        : null;
      return res.json({
        data: paged.map((p) =>
          shapeProductWithEffective(p, effectiveMap?.get(p.id)),
        ),
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

    const effectiveMap = query.locationId
      ? await batchResolveEffectiveGl(tenantId, query.locationId, results)
      : null;

    res.json({
      data: results.map((p) =>
        shapeProductWithEffective(p, effectiveMap?.get(p.id)),
      ),
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
    // Validate the supplied category belongs to this tenant.
    const category = await prisma.productCategory.findFirst({
      where: { id: body.productCategoryId, tenantId },
      select: { defaultTaxCategory: true, taxable: true },
    });
    if (!category) {
      return res.status(400).json({
        error: "Product category not found",
        code: "PRODUCT_CATEGORY_NOT_FOUND",
      });
    }
    // taxClass is a per-product OVERRIDE of the category's default. When the
    // caller doesn't send one we persist NULL — the resolver in
    // product-defaults.ts inherits from the category at read time. Copying
    // category.defaultTaxCategory into the column at write time is a footgun:
    // the value goes stale the moment the category is edited, and stale
    // overrides can shadow the (now-correct) category default at POS / on
    // invoices.  Empty strings and the legacy "Standard" sentinel are treated
    // as "no override" so they don't poison new rows either.
    const trimmed = body.taxClass?.trim() ?? "";
    const isExplicitOverride =
      trimmed.length > 0 && trimmed.toLowerCase() !== "standard";
    const resolvedTaxClass: string | null = isExplicitOverride
      ? body.taxClass!
      : null;
    let product = await prisma.product.create({
      data: {
        tenantId,
        name: body.name,
        sku: body.sku,
        barcode: body.barcode ?? null,
        category: body.category ?? null,
        productCategoryId: body.productCategoryId,
        costCents: body.costCents,
        priceCents: body.priceCents,
        taxClass: resolvedTaxClass,
        reorderPoint: body.reorderPoint,
        trackInventory: body.trackInventory,
        qoh: 0,
        locationId: body.locationId ?? null,
        active: true,
      } satisfies Prisma.ProductUncheckedCreateInput,
    });
    // Best-effort QBO sync — local create always succeeds even if QBO is
    // offline. Both inventory-tracked (Type:"Inventory") and non-tracked
    // (Type:"Service") products are pushed so invoice lines can attach an
    // ItemRef instead of falling back to a bare AccountRef.
    product = await tryPushProductToQbo(product);
    res.status(201).json(shapeProduct(product));
  } catch (err) {
    next(err);
  }
});

// GET /products/:id
router.get("/products/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req);
    const product = await prisma.product.findFirst({
      where: { id: req.params.id, tenantId },
    });
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
    const tenantId = getTenantId(req);
    const body = UpdateProductSchema.parse(req.body);
    // Scope by tenantId — without this any authenticated user could
    // mutate another tenant's product simply by guessing its UUID.
    const existing = await prisma.product.findFirst({
      where: { id: req.params.id, tenantId },
    });
    if (!existing) return res.status(404).json({ error: "Product not found" });
    // If a locationId is being assigned, validate it belongs to this
    // tenant too. Otherwise we'd let an operator point a product at a
    // foreign marina by sliding the id into the body.
    if (body.locationId) {
      const owned = await prisma.location.findFirst({
        where: { id: body.locationId, tenantId },
        select: { id: true },
      });
      if (!owned) {
        return res.status(400).json({ error: "Location not found", code: "LOCATION_NOT_FOUND" });
      }
    }

    // When the caller is moving the product to a new category, validate it
    // belongs to this tenant. We no longer back-fill the new category's
    // defaultTaxCategory into Product.taxClass — that copy goes stale the
    // moment the category is edited and shadows the correct category default
    // at POS / on invoices. The resolver in product-defaults.ts looks up the
    // category at read time instead.
    if (body.productCategoryId !== undefined && body.productCategoryId !== existing.productCategoryId) {
      const cat = await prisma.productCategory.findFirst({
        where: { id: body.productCategoryId, tenantId: existing.tenantId },
        select: { id: true },
      });
      if (!cat) {
        return res.status(400).json({
          error: "Product category not found",
          code: "PRODUCT_CATEGORY_NOT_FOUND",
        });
      }
    }

    const data: Prisma.ProductUncheckedUpdateInput = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.sku !== undefined) data.sku = body.sku;
    if (body.barcode !== undefined) data.barcode = body.barcode;
    if (body.category !== undefined) data.category = body.category;
    if (body.productCategoryId !== undefined) data.productCategoryId = body.productCategoryId;
    if (body.costCents !== undefined) data.costCents = body.costCents;
    if (body.priceCents !== undefined) data.priceCents = body.priceCents;
    if (body.reorderPoint !== undefined) data.reorderPoint = body.reorderPoint;
    if (body.trackInventory !== undefined) data.trackInventory = body.trackInventory;
    if (body.locationId !== undefined) data.locationId = body.locationId;

    // taxClass is a per-product OVERRIDE of the category default. Empty
    // strings and the legacy "Standard" sentinel are normalized to NULL so
    // a save-without-touching the override field doesn't poison the row
    // with a value that shadows the category at POS. The Tax Exempt
    // sentinel and any other explicit category label still win.
    if (body.taxClass !== undefined) {
      const trimmed = body.taxClass?.trim() ?? "";
      const isExplicitOverride =
        trimmed.length > 0 && trimmed.toLowerCase() !== "standard";
      data.taxClass = isExplicitOverride ? body.taxClass : null;
    }

    let product = await prisma.product.update({
      where: { id: existing.id },
      data,
    });
    // Re-sync to QBO so price/cost/account changes propagate. Service items
    // (trackInventory=false) are pushed too — see create handler comment.
    product = await tryPushProductToQbo(product);
    res.json(shapeProduct(product));
  } catch (err) {
    next(err);
  }
});

// POST /products/:id/qbo-sync — manually trigger a push to QBO
router.post("/products/:id/qbo-sync", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req);
    const product = await prisma.product.findFirst({
      where: { id: req.params.id, tenantId },
    });
    if (!product) return res.status(404).json({ error: "Product not found" });
    try {
      if (!product.locationId) {
        throw new Error(
          `MISSING_GL_MAPPING: Product "${product.name}" has no locationId set. ` +
          `Assign the product to a location before syncing to QuickBooks.`,
        );
      }
      const requiredSlots = product.trackInventory
        ? (["revenue", "cogs", "inventoryAsset"] as const)
        : (["revenue"] as const);
      const resolved = await resolveProductGlAccountsStrict(
        product.tenantId,
        product.id,
        product.locationId,
        requiredSlots,
      );
      const result = await syncInventoryItem(
        {
          productId: product.id,
          name: product.name,
          sku: product.sku,
          description: null,
          priceCents: product.priceCents,
          costCents: product.costCents ?? 0,
          qoh: product.qoh,
          trackInventory: product.trackInventory,
          incomeGlAccountId: resolved.revenueGlAccountId,
          inventoryAssetGlAccountId: resolved.inventoryAssetGlAccountId,
          cogsGlAccountId: resolved.cogsGlAccountId,
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
    const tenantId = getTenantId(req);
    const existing = await prisma.product.findFirst({
      where: { id: req.params.id, tenantId },
    });
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
// Categories own a default tax category + taxable flag, plus per-location
// GL mappings via ProductCategoryGlMapping (managed under Settings →
// Categories). The legacy tenant-wide default*GlAccountId columns were
// dropped in 20260429080000_inventory_category_only_gl.

const CategorySchema = z.object({
  name: z.string().min(1).max(120),
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
    // Reactivate a soft-deleted same-name row instead of 409'ing on the
    // (tenantId, name) unique index.
    const existing = await prisma.productCategory.findFirst({
      where: { tenantId, name: body.name },
    });
    if (existing && !existing.active) {
      const reactivated = await prisma.productCategory.update({
        where: { id: existing.id },
        data: {
          active: true,
          defaultTaxCategory: body.defaultTaxCategory ?? null,
          taxable: body.taxable,
          updatedAt: new Date(),
        },
      });
      return res.status(200).json(reactivated);
    }
    const created = await prisma.productCategory.create({
      data: {
        tenantId,
        name: body.name,
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

    const data: Prisma.ProductCategoryUncheckedUpdateInput = {};
    if (body.name !== undefined) data.name = body.name;
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
      const product = await prisma.product.findFirst({ where: { id: li.productId, tenantId } });
      productMap.set(li.productId, product?.name ?? "Unknown");
    }

    let vendorId: string | null = body.vendorId ?? null;
    let vendorName = body.vendor ?? "";
    if (vendorId) {
      const v = await prisma.vendor.findFirst({ where: { id: vendorId, tenantId } });
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
    const tenantId = getTenantId(req);
    const locationId = req.query.locationId as string | undefined;
    const status = req.query.status as string | undefined;
    const vendorId = req.query.vendorId as string | undefined;
    const take = Math.min(parseInt(req.query.take as string || "50", 10), 200);
    const skip = parseInt(req.query.skip as string || "0", 10);

    const where: any = { tenantId };
    if (locationId) where.locationId = locationId;
    if (status) where.status = status;
    if (vendorId) where.vendorId = vendorId;

    const [results, total] = await Promise.all([
      prisma.purchaseOrder.findMany({
        where,
        include: { lineItems: true },
        orderBy: { createdAt: "desc" },
        take,
        skip,
      }),
      prisma.purchaseOrder.count({ where }),
    ]);
    res.json({ data: results.map((po) => shapePo(po as PoWithLines)), total, take, skip });
  } catch (err) {
    next(err);
  }
});

// GET /purchase-orders/:id
router.get("/purchase-orders/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req);
    const po = await prisma.purchaseOrder.findFirst({
      where: { id: req.params.id, tenantId },
      include: { lineItems: { include: { product: { select: { id: true, name: true, sku: true } } } } },
    });
    if (!po) return res.status(404).json({ error: "Purchase order not found" });
    res.json(shapePo(po as PoWithLines));
  } catch (err) {
    next(err);
  }
});

// PATCH /purchase-orders/:id — edit a DRAFT PO
router.patch("/purchase-orders/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req);
    const po = await prisma.purchaseOrder.findFirst({
      where: { id: req.params.id, tenantId },
      include: { lineItems: true },
    });
    if (!po) return res.status(404).json({ error: "Purchase order not found" });
    if (po.status !== "draft")
      return res.status(400).json({ error: "Only draft POs can be edited", code: "NOT_DRAFT" });

    const { vendorName, vendorId, expectedDate, notes, lineItems } = req.body as {
      vendorName?: string;
      vendorId?: string;
      expectedDate?: string;
      notes?: string;
      lineItems?: Array<{ productId: string; quantity: number; unitCostCents: number }>;
    };

    const updateData: Record<string, unknown> = {};
    if (vendorName !== undefined) updateData.vendorName = vendorName;
    if (vendorId !== undefined) updateData.vendorId = vendorId;
    if (expectedDate !== undefined) updateData.expectedDate = expectedDate ? new Date(expectedDate) : null;
    if (notes !== undefined) updateData.notes = notes;

    // If lineItems are provided, replace them all
    if (lineItems) {
      // Fetch product names
      const productMap = new Map<string, string>();
      for (const li of lineItems) {
        const p = await prisma.product.findFirst({ where: { id: li.productId, tenantId } });
        if (!p) return res.status(400).json({ error: `Product ${li.productId} not found` });
        productMap.set(li.productId, p.name);
      }
      const totalCents = lineItems.reduce((sum, li) => sum + li.quantity * li.unitCostCents, 0);
      updateData.totalCents = totalCents;

      await prisma.poLineItem.deleteMany({ where: { purchaseOrderId: po.id } });
      await prisma.poLineItem.createMany({
        data: lineItems.map((li) => ({
          tenantId,
          purchaseOrderId: po.id,
          productId: li.productId,
          productName: productMap.get(li.productId) ?? "Unknown",
          quantity: li.quantity,
          unitCostCents: li.unitCostCents,
          receivedQty: 0,
        })),
      });
    }

    const updated = await prisma.purchaseOrder.update({
      where: { id: po.id },
      data: updateData,
      include: { lineItems: true },
    });
    res.json(shapePo(updated as PoWithLines));
  } catch (err) {
    next(err);
  }
});

// POST /purchase-orders/:id/submit — DRAFT → SUBMITTED
router.post("/purchase-orders/:id/submit", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req);
    const po = await prisma.purchaseOrder.findFirst({
      where: { id: req.params.id, tenantId },
    });
    if (!po) return res.status(404).json({ error: "Purchase order not found" });
    if (po.status !== "draft")
      return res.status(400).json({ error: `Cannot submit a PO with status: ${po.status}`, code: "INVALID_STATUS" });

    const updated = await prisma.purchaseOrder.update({
      where: { id: po.id },
      data: { status: "submitted" },
      include: { lineItems: true },
    });
    res.json(shapePo(updated as PoWithLines));
  } catch (err) {
    next(err);
  }
});

// POST /purchase-orders/:id/cancel — DRAFT/SUBMITTED → CANCELLED
router.post("/purchase-orders/:id/cancel", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req);
    const po = await prisma.purchaseOrder.findFirst({
      where: { id: req.params.id, tenantId },
    });
    if (!po) return res.status(404).json({ error: "Purchase order not found" });
    if (!["draft", "submitted"].includes(po.status))
      return res.status(400).json({ error: `Cannot cancel a PO with status: ${po.status}`, code: "INVALID_STATUS" });

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

// PUT /purchase-orders/:id/receive
router.put("/purchase-orders/:id/receive", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req);
    const body = ReceivePOSchema.parse(req.body);
    const po = await prisma.purchaseOrder.findFirst({
      where: { id: req.params.id, tenantId },
      include: { lineItems: true },
    });
    if (!po) return res.status(404).json({ error: "Purchase order not found" });
    if (po.status === "cancelled")
      return res.status(400).json({ error: "Cannot receive cancelled PO" });
    if (po.status === "received")
      return res.status(400).json({ error: "PO already fully received" });

    // Resolve effective locationId: body override → PO's location
    const effectiveLocationId: string | null = body.locationId ?? po.locationId ?? null;

    const receivedAdjustments: AdjustmentRow[] = [];
    const billLines: Array<{ productId: string; productName: string; receivedQty: number; unitCostCents: number }> = [];

    const now = new Date();

    for (const receiveLine of body.lineItems) {
      const poLine = po.lineItems.find((li) => li.id === receiveLine.lineItemId);
      if (!poLine) continue;

      const maxReceivable = poLine.quantity - poLine.receivedQty;
      const qty = Math.min(receiveLine.receivedQty, maxReceivable);
      if (qty <= 0) continue;

      // Unit cost at receipt: use caller-supplied value if provided, otherwise the PO line's original cost
      const unitCostAtReceipt = receiveLine.unitCostCents ?? poLine.unitCostCents;

      await prisma.poLineItem.update({
        where: { id: poLine.id },
        data: {
          receivedQty: poLine.receivedQty + qty,
          receivedAt: now,
          unitCostAtReceipt,
        },
      });

      const product = await prisma.product.findFirst({ where: { id: poLine.productId } });
      if (product) {
        const before = product.qoh;
        await prisma.product.update({
          where: { id: product.id },
          data: { qoh: before + qty },
        });

        // Call costing engine (WAC/FIFO) if we have a location
        if (effectiveLocationId) {
          try {
            await recordInventoryReceipt({
              tenantId,
              productId: product.id,
              locationId: effectiveLocationId,
              qtyReceived: qty,
              unitCostCents: unitCostAtReceipt,
              purchaseOrderId: po.id,
            });
          } catch (costErr) {
            console.warn(`[inventory] costing-engine receipt failed for ${product.id}: ${costErr instanceof Error ? costErr.message : String(costErr)}`);
          }
        }

        const adj = await prisma.inventoryAdjustment.create({
          data: {
            tenantId,
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

        billLines.push({
          productId: product.id,
          productName: product.name,
          receivedQty: qty,
          unitCostCents: unitCostAtReceipt,
        });
      }
    }

    // Reload line items to determine status
    const refreshedLines = await prisma.poLineItem.findMany({
      where: { purchaseOrderId: po.id },
    });
    const allReceived = refreshedLines.every((li) => li.receivedQty >= li.quantity);
    const anyReceived = refreshedLines.some((li) => li.receivedQty > 0);
    const newStatus = allReceived ? "received" : anyReceived ? "partial" : po.status;

    const receivedByUserId: string | null = (req as any).userId ?? null;
    const updatedPo = await prisma.purchaseOrder.update({
      where: { id: po.id },
      data: {
        status: newStatus,
        receivedAt: allReceived ? now : po.receivedAt,
        receivedByUserId: allReceived ? receivedByUserId : po.receivedByUserId,
      },
      include: { lineItems: true },
    });

    // Best-effort QBO Bill for everything received in this batch
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
    const tenantId = getTenantId(req);
    const po = await prisma.purchaseOrder.findFirst({
      where: { id: req.params.id, tenantId },
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
    } else if (ref.sourceType === PAYMENT_REFUND_SYNC_SOURCE_TYPE) {
      // Partial refunds pushed to QBO as RefundReceipts. The original refund
      // arguments are encoded in the sync ref's sourceId so the retry can
      // re-issue the exact same call (and idempotency in
      // createQboRefundReceipt prevents duplicate receipts in QBO).
      const parsed = parsePaymentRefundSyncSourceId(ref.sourceId);
      if (!parsed) {
        result.skipped++;
        recordDetail({
          sourceType: ref.sourceType,
          sourceId: ref.sourceId,
          qboType: ref.qboType,
          status: "skipped",
          error: "Invalid payment_refund sourceId — cannot decode refund arguments",
        });
        continue;
      }
      const payment = await prisma.payment.findFirst({
        where: { id: parsed.paymentId, tenantId },
      });
      if (!payment) {
        result.skipped++;
        recordDetail({
          sourceType: ref.sourceType,
          sourceId: ref.sourceId,
          qboType: ref.qboType,
          status: "skipped",
          error: "Payment no longer exists locally",
        });
        continue;
      }
      result.attempted++;
      try {
        await createQboRefundReceipt(
          parsed.paymentId,
          parsed.refundAmountCents,
          parsed.priorRefundedCents,
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
