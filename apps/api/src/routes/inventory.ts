import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { clerkAuth } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";
import {
  syncInventoryItem,
  syncReceivingBill,
  syncVendor,
  postInventoryAdjustmentJournal,
  getBulkProductSyncStatus,
  getProductSyncStatus,
  type PoBillLineInput,
} from "../services/qbo-sync.js";

const router: Router = Router();

router.use(...clerkAuth());

// ─── QBO sync helpers ─────────────────────────────────────────────────────────
//
// All QBO calls below are best-effort: local mutations always succeed, and any
// sync failure is captured into product/PO/adjustment.qbo*SyncError so the UI
// can show retryable errors and the user can re-trigger a push.

async function tryPushProductToQbo(product: InventoryProduct): Promise<void> {
  if (!product.trackInventory) return;
  try {
    const result = await syncInventoryItem(
      {
        productId: product.id,
        name: product.name,
        sku: product.sku,
        description: null,
        priceCents: product.priceCents,
        costCents: product.costCents,
        qoh: product.qoh,
        incomeGlAccountId: product.revenueGlAccountId,
        inventoryAssetGlAccountId: product.inventoryAssetGlAccountId,
        cogsGlAccountId: product.cogsGlAccountId,
      },
      product.tenantId,
      product.locationId,
    );
    product.qboItemId = result.qboItemId;
    product.qboItemSyncedAt = new Date().toISOString();
    product.qboItemSyncError = null;
    product.qboItemSyncErrorAt = null;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    product.qboItemSyncError = msg.slice(0, 1000);
    product.qboItemSyncErrorAt = new Date().toISOString();
    console.warn(`[inventory] QBO item sync failed for ${product.id}: ${msg}`);
  }
}

async function tryPushAdjustmentJournal(
  adjustment: InventoryAdjustment,
  product: InventoryProduct,
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
        unitCostCents: product.costCents,
        inventoryAssetGlAccountId: product.inventoryAssetGlAccountId,
        cogsGlAccountId: product.cogsGlAccountId,
        notes: adjustment.notes,
      },
      product.tenantId,
      product.locationId,
    );
    if (result.qboJournalEntryId) {
      adjustment.qboJournalEntryId = result.qboJournalEntryId;
      adjustment.qboSyncedAt = new Date().toISOString();
    }
    adjustment.qboSyncError = null;
    adjustment.qboSyncErrorAt = null;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    adjustment.qboSyncError = msg.slice(0, 1000);
    adjustment.qboSyncErrorAt = new Date().toISOString();
    console.warn(`[inventory] QBO adjustment sync failed for ${adjustment.id}: ${msg}`);
  }
}

async function tryPushReceivingBill(
  po: PurchaseOrder,
  receivedLines: Array<{ productId: string; productName: string; receivedQty: number; unitCostCents: number }>,
): Promise<void> {
  if (!po.vendorId) {
    po.qboBillSyncError = "Purchase order has no linked vendor — set a Vendor before receiving to enable QBO Bill sync";
    po.qboBillSyncErrorAt = new Date().toISOString();
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
        poNumber: po.poNumber,
        vendorId: po.vendorId,
        expectedDate: po.expectedDate ? new Date(po.expectedDate) : null,
        lines,
        // Force-push on each receive: each batch creates its own Bill
        forcePush: true,
      },
      po.tenantId,
      po.locationId,
    );
    po.qboBillId = result.qboBillId;
    po.qboBillSyncedAt = new Date().toISOString();
    po.qboBillSyncError = null;
    po.qboBillSyncErrorAt = null;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    po.qboBillSyncError = msg.slice(0, 1000);
    po.qboBillSyncErrorAt = new Date().toISOString();
    console.warn(`[inventory] QBO bill sync failed for ${po.id}: ${msg}`);
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
  category: z.string().min(1),
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

// ─── In-memory inventory store ────────────────────────────────────────────────

interface InventoryProduct {
  id: string;
  tenantId: string;
  name: string;
  sku: string;
  barcode: string | null;
  category: string;
  costCents: number;
  priceCents: number;
  taxClass: string | null;
  reorderPoint: number;
  trackInventory: boolean;
  qoh: number;
  cogsGlAccountId: string | null;
  revenueGlAccountId: string | null;
  inventoryAssetGlAccountId: string | null;
  locationId: string | null;
  qboItemId: string | null;
  qboItemSyncedAt: string | null;
  qboItemSyncError: string | null;
  qboItemSyncErrorAt: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

interface InventoryAdjustment {
  id: string;
  tenantId: string;
  productId: string;
  productName: string;
  quantityChange: number;
  quantityBefore: number;
  quantityAfter: number;
  reason: string;
  notes: string | null;
  staffName: string | null;
  createdAt: string;
  qboJournalEntryId: string | null;
  qboSyncedAt: string | null;
  qboSyncError: string | null;
  qboSyncErrorAt: string | null;
}

interface CountSession {
  id: string;
  tenantId: string;
  name: string;
  startedBy: string;
  status: "in_progress" | "completed";
  items: CountItem[];
  createdAt: string;
  completedAt: string | null;
}

interface CountItem {
  id: string;
  productId: string;
  productName: string;
  expectedQty: number;
  actualQty: number;
  variance: number;
}

interface POLineItem {
  id: string;
  productId: string;
  productName: string;
  quantity: number;
  unitCostCents: number;
  receivedQty: number;
}

interface PurchaseOrder {
  id: string;
  tenantId: string;
  poNumber: string;
  vendor: string;
  vendorId: string | null;
  locationId: string | null;
  status: "draft" | "submitted" | "partial" | "received" | "cancelled";
  expectedDate: string | null;
  notes: string | null;
  lineItems: POLineItem[];
  totalCostCents: number;
  createdAt: string;
  updatedAt: string;
  qboBillId: string | null;
  qboBillSyncedAt: string | null;
  qboBillSyncError: string | null;
  qboBillSyncErrorAt: string | null;
}

let nextProductId = 100;
let nextAdjId = 100;
let nextCountId = 100;
let nextPOId = 100;
let nextPOLineId = 100;
let nextCountItemId = 100;

const products: InventoryProduct[] = [];
const adjustments: InventoryAdjustment[] = [];
const countSessions: CountSession[] = [];
const purchaseOrders: PurchaseOrder[] = [];

function getTenantId(req: Request): string {
  return (req as any).tenantId ?? "default";
}

// ─── Products ─────────────────────────────────────────────────────────────────

// GET /products
router.get("/products", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req);
    const query = ListProductsQuerySchema.parse(req.query);
    let results = products.filter((p) => p.tenantId === tenantId && p.active);

    if (query.category) {
      results = results.filter((p) => p.category === query.category);
    }
    if (query.search) {
      const s = query.search.toLowerCase();
      results = results.filter(
        (p) =>
          p.name.toLowerCase().includes(s) ||
          p.sku.toLowerCase().includes(s) ||
          (p.barcode && p.barcode.includes(s))
      );
    }
    if (query.lowStockOnly) {
      results = results.filter((p) => p.trackInventory && p.qoh <= p.reorderPoint);
    }

    const total = results.length;
    results.sort((a: any, b: any) => {
      const av = a[query.sortBy] ?? "";
      const bv = b[query.sortBy] ?? "";
      if (av < bv) return query.sortOrder === "asc" ? -1 : 1;
      if (av > bv) return query.sortOrder === "asc" ? 1 : -1;
      return 0;
    });
    results = results.slice(query.skip, query.skip + query.take);

    res.json({ data: results, total, skip: query.skip, take: query.take });
  } catch (err) {
    next(err);
  }
});

// POST /products
router.post("/products", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req);
    const body = CreateProductSchema.parse(req.body);
    const now = new Date().toISOString();
    const product: InventoryProduct = {
      id: `inv-prod-${nextProductId++}`,
      tenantId,
      name: body.name,
      sku: body.sku,
      barcode: body.barcode ?? null,
      category: body.category,
      costCents: body.costCents,
      priceCents: body.priceCents,
      taxClass: body.taxClass ?? null,
      reorderPoint: body.reorderPoint,
      trackInventory: body.trackInventory,
      qoh: 0,
      cogsGlAccountId: body.cogsGlAccountId ?? null,
      revenueGlAccountId: body.revenueGlAccountId ?? null,
      inventoryAssetGlAccountId: body.inventoryAssetGlAccountId ?? null,
      locationId: body.locationId ?? null,
      qboItemId: null,
      qboItemSyncedAt: null,
      qboItemSyncError: null,
      qboItemSyncErrorAt: null,
      active: true,
      createdAt: now,
      updatedAt: now,
    };
    products.push(product);
    // Best-effort QBO sync — local create always succeeds even if QBO is offline
    if (product.trackInventory) {
      await tryPushProductToQbo(product);
    }
    res.status(201).json(product);
  } catch (err) {
    next(err);
  }
});

// GET /products/:id
router.get("/products/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req);
    const product = products.find((p) => p.id === req.params.id && p.tenantId === tenantId);
    if (!product) return res.status(404).json({ error: "Product not found" });

    const productAdjustments = adjustments.filter(
      (a) => a.productId === product.id && a.tenantId === tenantId
    );
    const productPOs = purchaseOrders.filter(
      (po) =>
        po.tenantId === tenantId &&
        po.lineItems.some((li) => li.productId === product.id)
    );

    res.json({ ...product, adjustments: productAdjustments, purchaseOrders: productPOs });
  } catch (err) {
    next(err);
  }
});

// PUT /products/:id
router.put("/products/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req);
    const body = UpdateProductSchema.parse(req.body);
    const product = products.find((p) => p.id === req.params.id && p.tenantId === tenantId);
    if (!product) return res.status(404).json({ error: "Product not found" });

    Object.assign(product, body, { updatedAt: new Date().toISOString() });
    // Re-sync to QBO so price/cost/account changes propagate
    if (product.trackInventory) {
      await tryPushProductToQbo(product);
    }
    res.json(product);
  } catch (err) {
    next(err);
  }
});

// POST /products/:id/qbo-sync — manually trigger a push to QBO
router.post("/products/:id/qbo-sync", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req);
    const product = products.find((p) => p.id === req.params.id && p.tenantId === tenantId);
    if (!product) return res.status(404).json({ error: "Product not found" });
    if (!product.trackInventory) {
      return res.status(400).json({ error: "Product does not track inventory — only inventory items sync to QBO" });
    }
    try {
      const result = await syncInventoryItem(
        {
          productId: product.id,
          name: product.name,
          sku: product.sku,
          description: null,
          priceCents: product.priceCents,
          costCents: product.costCents,
          qoh: product.qoh,
          incomeGlAccountId: product.revenueGlAccountId,
          inventoryAssetGlAccountId: product.inventoryAssetGlAccountId,
          cogsGlAccountId: product.cogsGlAccountId,
        },
        product.tenantId,
        product.locationId,
      );
      product.qboItemId = result.qboItemId;
      product.qboItemSyncedAt = new Date().toISOString();
      product.qboItemSyncError = null;
      product.qboItemSyncErrorAt = null;
      res.json({ success: true, qboItemId: result.qboItemId, product });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      product.qboItemSyncError = msg.slice(0, 1000);
      product.qboItemSyncErrorAt = new Date().toISOString();
      res.status(502).json({ success: false, error: msg, product });
    }
  } catch (err) {
    next(err);
  }
});

// DELETE /products/:id (soft delete)
router.delete("/products/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req);
    const product = products.find((p) => p.id === req.params.id && p.tenantId === tenantId);
    if (!product) return res.status(404).json({ error: "Product not found" });

    product.active = false;
    product.updatedAt = new Date().toISOString();
    res.json({ message: "Product deactivated", id: product.id });
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
    const product = products.find((p) => p.id === body.productId && p.tenantId === tenantId);
    if (!product) return res.status(404).json({ error: "Product not found" });

    const before = product.qoh;
    product.qoh += body.quantityChange;
    const after = product.qoh;
    product.updatedAt = new Date().toISOString();

    const adjustment: InventoryAdjustment = {
      id: `inv-adj-${nextAdjId++}`,
      tenantId,
      productId: product.id,
      productName: product.name,
      quantityChange: body.quantityChange,
      quantityBefore: before,
      quantityAfter: after,
      reason: body.reason,
      notes: body.notes ?? null,
      staffName: body.staffName ?? null,
      createdAt: new Date().toISOString(),
      qboJournalEntryId: null,
      qboSyncedAt: null,
      qboSyncError: null,
      qboSyncErrorAt: null,
    };
    adjustments.push(adjustment);

    // QBO journal entry for damaged/shrinkage/count/return-to-vendor adjustments.
    // 'received' is handled via the Bill flow and 'sold' via QBO's auto-COGS on
    // Item-referenced invoices, so postInventoryAdjustmentJournal short-circuits
    // on those reasons.
    await tryPushAdjustmentJournal(adjustment, product);

    res.status(201).json(adjustment);
  } catch (err) {
    next(err);
  }
});

// GET /adjustments
router.get("/adjustments", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req);
    const query = ListAdjustmentsQuerySchema.parse(req.query);
    let results = adjustments.filter((a) => a.tenantId === tenantId);

    if (query.productId) {
      results = results.filter((a) => a.productId === query.productId);
    }
    if (query.reason) {
      results = results.filter((a) => a.reason === query.reason);
    }
    if (query.dateFrom) {
      results = results.filter((a) => a.createdAt >= query.dateFrom!);
    }
    if (query.dateTo) {
      results = results.filter((a) => a.createdAt <= query.dateTo!);
    }

    const total = results.length;
    results = results.slice(query.skip, query.skip + query.take);

    res.json({ data: results, total });
  } catch (err) {
    next(err);
  }
});

// ─── Count Sessions ───────────────────────────────────────────────────────────

// POST /counts
router.post("/counts", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req);
    const body = CreateCountSessionSchema.parse(req.body);
    const session: CountSession = {
      id: `inv-count-${nextCountId++}`,
      tenantId,
      name: body.name ?? `Count ${new Date().toLocaleDateString()}`,
      startedBy: body.startedBy ?? "Staff",
      status: "in_progress",
      items: [],
      createdAt: new Date().toISOString(),
      completedAt: null,
    };
    countSessions.push(session);
    res.status(201).json(session);
  } catch (err) {
    next(err);
  }
});

// POST /counts/:id/items
router.post("/counts/:id/items", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req);
    const session = countSessions.find(
      (s) => s.id === req.params.id && s.tenantId === tenantId
    );
    if (!session) return res.status(404).json({ error: "Count session not found" });
    if (session.status === "completed")
      return res.status(400).json({ error: "Count session already completed" });

    const body = SubmitCountItemSchema.parse(req.body);
    const product = products.find((p) => p.id === body.productId && p.tenantId === tenantId);

    const item: CountItem = {
      id: `inv-ci-${nextCountItemId++}`,
      productId: body.productId,
      productName: product?.name ?? "Unknown",
      expectedQty: body.expectedQty,
      actualQty: body.actualQty,
      variance: body.actualQty - body.expectedQty,
    };
    session.items.push(item);
    res.status(201).json(item);
  } catch (err) {
    next(err);
  }
});

// PUT /counts/:id/complete
router.put("/counts/:id/complete", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req);
    const session = countSessions.find(
      (s) => s.id === req.params.id && s.tenantId === tenantId
    );
    if (!session) return res.status(404).json({ error: "Count session not found" });
    if (session.status === "completed")
      return res.status(400).json({ error: "Already completed" });

    const generatedAdjustments: InventoryAdjustment[] = [];

    for (const item of session.items) {
      if (item.variance !== 0) {
        const product = products.find((p) => p.id === item.productId && p.tenantId === tenantId);
        if (product) {
          const before = product.qoh;
          product.qoh = item.actualQty;
          const adj: InventoryAdjustment = {
            id: `inv-adj-${nextAdjId++}`,
            tenantId,
            productId: product.id,
            productName: product.name,
            quantityChange: item.variance,
            quantityBefore: before,
            quantityAfter: item.actualQty,
            reason: "count",
            notes: `Count session ${session.name} — variance: ${item.variance}`,
            staffName: session.startedBy,
            createdAt: new Date().toISOString(),
            qboJournalEntryId: null,
            qboSyncedAt: null,
            qboSyncError: null,
            qboSyncErrorAt: null,
          };
          adjustments.push(adj);
          generatedAdjustments.push(adj);
          // Best-effort QBO journal entry for the count variance
          await tryPushAdjustmentJournal(adj, product);
        }
      }
    }

    session.status = "completed";
    session.completedAt = new Date().toISOString();

    res.json({ session, adjustments: generatedAdjustments });
  } catch (err) {
    next(err);
  }
});

// GET /counts
router.get("/counts", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req);
    const results = countSessions.filter((s) => s.tenantId === tenantId);
    res.json({ data: results, total: results.length });
  } catch (err) {
    next(err);
  }
});

// ─── Purchase Orders ──────────────────────────────────────────────────────────

// POST /purchase-orders
router.post("/purchase-orders", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req);
    const body = CreatePurchaseOrderSchema.parse(req.body);
    const now = new Date().toISOString();

    const lineItems: POLineItem[] = body.lineItems.map((li) => {
      const product = products.find((p) => p.id === li.productId && p.tenantId === tenantId);
      return {
        id: `inv-poli-${nextPOLineId++}`,
        productId: li.productId,
        productName: product?.name ?? "Unknown",
        quantity: li.quantity,
        unitCostCents: li.unitCostCents,
        receivedQty: 0,
      };
    });

    const totalCostCents = lineItems.reduce(
      (sum, li) => sum + li.quantity * li.unitCostCents,
      0
    );

    let vendorId: string | null = body.vendorId ?? null;
    let vendorName = body.vendor ?? "";
    if (vendorId) {
      const v = await prisma.vendor.findFirst({ where: { id: vendorId, tenantId } });
      if (!v) return res.status(400).json({ error: "Vendor not found" });
      vendorName = v.name;
    }

    const po: PurchaseOrder = {
      id: `inv-po-${nextPOId++}`,
      tenantId,
      poNumber: `PO-${String(nextPOId).padStart(4, "0")}`,
      vendor: vendorName,
      vendorId,
      locationId: body.locationId ?? null,
      status: "draft",
      expectedDate: body.expectedDate ?? null,
      notes: body.notes ?? null,
      lineItems,
      totalCostCents,
      createdAt: now,
      updatedAt: now,
      qboBillId: null,
      qboBillSyncedAt: null,
      qboBillSyncError: null,
      qboBillSyncErrorAt: null,
    };
    purchaseOrders.push(po);
    res.status(201).json(po);
  } catch (err) {
    next(err);
  }
});

// GET /purchase-orders
router.get("/purchase-orders", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req);
    const status = req.query.status as string | undefined;
    let results = purchaseOrders.filter((po) => po.tenantId === tenantId);
    if (status) {
      results = results.filter((po) => po.status === status);
    }
    res.json({ data: results, total: results.length });
  } catch (err) {
    next(err);
  }
});

// GET /purchase-orders/:id
router.get("/purchase-orders/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req);
    const po = purchaseOrders.find(
      (p) => p.id === req.params.id && p.tenantId === tenantId
    );
    if (!po) return res.status(404).json({ error: "Purchase order not found" });
    res.json(po);
  } catch (err) {
    next(err);
  }
});

// PUT /purchase-orders/:id/receive
router.put("/purchase-orders/:id/receive", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req);
    const body = ReceivePOSchema.parse(req.body);
    const po = purchaseOrders.find(
      (p) => p.id === req.params.id && p.tenantId === tenantId
    );
    if (!po) return res.status(404).json({ error: "Purchase order not found" });
    if (po.status === "cancelled")
      return res.status(400).json({ error: "Cannot receive cancelled PO" });
    if (po.status === "received")
      return res.status(400).json({ error: "PO already fully received" });

    const receivedAdjustments: InventoryAdjustment[] = [];

    for (const receiveLine of body.lineItems) {
      const poLine = po.lineItems.find((li) => li.id === receiveLine.lineItemId);
      if (!poLine) continue;

      const maxReceivable = poLine.quantity - poLine.receivedQty;
      const qty = Math.min(receiveLine.receivedQty, maxReceivable);
      if (qty <= 0) continue;

      poLine.receivedQty += qty;

      const product = products.find((p) => p.id === poLine.productId && p.tenantId === tenantId);
      if (product) {
        const before = product.qoh;
        product.qoh += qty;
        const adj: InventoryAdjustment = {
          id: `inv-adj-${nextAdjId++}`,
          tenantId,
          productId: product.id,
          productName: product.name,
          quantityChange: qty,
          quantityBefore: before,
          quantityAfter: product.qoh,
          reason: "received",
          notes: `PO ${po.poNumber} — received ${qty} units`,
          staffName: body.receivedBy ?? null,
          createdAt: new Date().toISOString(),
          qboJournalEntryId: null,
          qboSyncedAt: null,
          qboSyncError: null,
          qboSyncErrorAt: null,
        };
        adjustments.push(adj);
        receivedAdjustments.push(adj);
      }
    }

    // Determine PO status
    const allReceived = po.lineItems.every((li) => li.receivedQty >= li.quantity);
    const anyReceived = po.lineItems.some((li) => li.receivedQty > 0);
    po.status = allReceived ? "received" : anyReceived ? "partial" : po.status;
    po.updatedAt = new Date().toISOString();

    // Best-effort QBO Bill for everything received in this batch
    const billLines = receivedAdjustments
      .map((adj) => {
        const poLine = po.lineItems.find((li) => li.productId === adj.productId);
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
    await tryPushReceivingBill(po, billLines);

    res.json({ purchaseOrder: po, adjustments: receivedAdjustments });
  } catch (err) {
    next(err);
  }
});

// PUT /purchase-orders/:id/cancel
router.put("/purchase-orders/:id/cancel", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req);
    const po = purchaseOrders.find(
      (p) => p.id === req.params.id && p.tenantId === tenantId
    );
    if (!po) return res.status(404).json({ error: "Purchase order not found" });
    if (po.status === "received")
      return res.status(400).json({ error: "Cannot cancel a fully received PO" });

    po.status = "cancelled";
    po.updatedAt = new Date().toISOString();
    res.json(po);
  } catch (err) {
    next(err);
  }
});

// ─── Labels ───────────────────────────────────────────────────────────────────

// POST /labels — generate ZPL barcode labels
router.post("/labels", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req);
    const body = GenerateLabelsSchema.parse(req.body);
    const zplLabels: string[] = [];

    for (const pid of body.productIds) {
      const product = products.find((p) => p.id === pid && p.tenantId === tenantId);
      if (!product) continue;

      const barcode = product.barcode || product.sku;
      const price = (product.priceCents / 100).toFixed(2);
      for (let i = 0; i < body.labelQty; i++) {
        zplLabels.push(
          `^XA\n^FO50,50^A0N,30,30^FD${product.name}^FS\n^FO50,90^A0N,20,20^FDSKU: ${product.sku}^FS\n^FO50,120^BY2^BCN,80,Y,N,N^FD${barcode}^FS\n^FO50,220^A0N,25,25^FD$${price}^FS\n^XZ`
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
    const tenantId = getTenantId(req);
    const activeProducts = products.filter((p) => p.tenantId === tenantId && p.active && p.trackInventory);

    let totalCostValue = 0;
    let totalRetailValue = 0;

    const items = activeProducts.map((p) => {
      const costTotal = p.qoh * p.costCents;
      const retailTotal = p.qoh * p.priceCents;
      totalCostValue += costTotal;
      totalRetailValue += retailTotal;
      const margin = p.priceCents > 0 ? ((p.priceCents - p.costCents) / p.priceCents) * 100 : 0;

      return {
        productId: p.id,
        name: p.name,
        sku: p.sku,
        category: p.category,
        qoh: p.qoh,
        unitCostCents: p.costCents,
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
    const tenantId = getTenantId(req);
    const alerts = products.filter(
      (p) => p.tenantId === tenantId && p.active && p.trackInventory && p.qoh <= p.reorderPoint
    );
    res.json({
      data: alerts.map((p) => ({
        productId: p.id,
        name: p.name,
        sku: p.sku,
        category: p.category,
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
    const tenantId = getTenantId(req);
    const vendors = await prisma.vendor.findMany({
      where: { tenantId, active: true },
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
    const existing = await prisma.vendor.findFirst({ where: { id: req.params.id, tenantId } });
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
    const tenantId = getTenantId(req);
    const existing = await prisma.vendor.findFirst({ where: { id: req.params.id, tenantId } });
    if (!existing) return res.status(404).json({ error: "Vendor not found" });
    await prisma.vendor.update({ where: { id: existing.id }, data: { active: false } });
    res.json({ message: "Vendor deactivated", id: existing.id });
  } catch (err) {
    next(err);
  }
});

export default router;
