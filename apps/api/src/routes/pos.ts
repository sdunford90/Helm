import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import type Stripe from "stripe";
import { clerkAuth, requireLocationAccess, filterByAllowedLocations, requireRole } from "../middleware/auth.js";
import { requireAccountingSetup } from "../middleware/accounting-gate.js";
import { prisma } from "../lib/prisma.js";
import { requireStripe } from "../lib/stripe.js";
import { computeZOut, postShiftZOut, nextZNumber, type ZOutSnapshot, type ZoutTx } from "../services/pos-zout.js";
import { sendEmail, EmailSendError } from "../lib/email.js";
import { Prisma } from "@prisma/client";
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
import { evaluateDiscountsForCart } from "./pos-discounts.js";

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
  // Optional explicit location for sales made without an open shift (and to
  // anchor refunds to the connected Stripe account at sale time, even when
  // the row carries no shiftId). Server uses this as the location signal for
  // both tax calculation and Stripe-account resolution.
  locationId: z.string().optional().nullable(),
  // CHARGE_TO_AR is the new name for the legacy CHARGE_TO_ACCOUNT path —
  // both are accepted for backwards compatibility with older clients, and
  // both create a real A/R Invoice for the attached customer (gated on the
  // location's `posChargeToARAllowed` toggle).
  paymentMethod: z.enum(["CASH", "CARD", "ACH", "CHARGE_TO_ACCOUNT", "CHARGE_TO_AR"]).default("CASH"),
  tipCents: z.number().int().min(0).default(0),
  // When set, the server charges this saved Stripe PaymentMethod off-session
  // immediately (must belong to the attached customer AND have
  // metadata.usableInPos === "true"). The resulting PaymentIntent id is
  // persisted as the sale's stripePaymentIntentId. paymentMethod must be
  // "CARD" when this is provided.
  savedPaymentMethodId: z.string().min(1).optional().nullable(),
  // Card-only metadata so reports can show the Terminal-vs-CNP split per
  // location and surface how often the keyed form was a silent fallback.
  // Server validates that fallback reasons only apply to CNP card sales.
  cardRail: z.enum(["TERMINAL", "CNP"]).optional().nullable(),
  cnpFallbackReason: z
    .enum(["NO_READER", "DISCOVERY_FAILED", "MANUAL_CHOICE"])
    .optional()
    .nullable(),
  // Stripe PaymentIntent id from `confirmCardPayment` (CNP) or Terminal
  // capture. Persisted on the row so end-of-day reconciliation, refunds,
  // and Stripe dispute matching can join the POS sale to the Stripe charge
  // by id instead of amount + timestamp. Server scrubs it for non-card
  // sales the same way it scrubs `cardRail` so the field can't be misused
  // as a free-form note on cash/ACH/charge rows.
  stripePaymentIntentId: z.string().min(1).optional().nullable(),
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
  // Cashier-declared non-cash tender totals + paid-outs (Task #320). All
  // optional / default-zero so old clients that only send closingCashCents
  // continue to work; new POS UI surfaces explicit fields for these.
  declaredCheckCents: z.number().int().min(0).optional().default(0),
  declaredOtherCents: z.number().int().min(0).optional().default(0),
  paidOutsCents: z.number().int().min(0).optional().default(0),
  notes: z.string().optional().nullable(),
});

// Manager Z-out commit. Counted cash is re-confirmed at Z-out time so the
// manager can override the cashier's count if a recount happens between
// CLOSED and the Z-out run. Notes are appended to the shift's audit log
// AND stored on the ZReport row for the printable receipt.
const ZOutSchema = z.object({
  countedCashCents: z.number().int().min(0).optional(),
  notes: z.string().optional().nullable(),
  // When true, the response includes the snapshot inline (used by the
  // POS UI which renders the printable view immediately on commit).
  includeSnapshot: z.boolean().optional().default(true),
});

// `to` is optional. When omitted, the email handler uses the Z-report's
// location's configured `zReportRecipients` distribution list. The
// handler 400s if BOTH the body `to` and the configured list are empty.
const EmailZReportSchema = z.object({
  to: z.union([z.string().email(), z.array(z.string().email()).min(1)]).optional(),
});

const ListZReportsQuerySchema = z.object({
  locationId: z.string().optional(),
  cashierId: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  skip: z.coerce.number().int().min(0).default(0),
  take: z.coerce.number().int().positive().max(200).default(50),
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
            // Bug fix: the POS frontend tax-preview needs the category's
            // defaultTaxCategory + taxable flag so it can mirror the
            // server-side precedence (per-product taxClass override →
            // category default → "general"). Without this, the cart was
            // showing $0 tax for any product whose taxClass was a sentinel
            // ("Standard", null, "") even when the category had a real
            // default tax category set. Server-side calculation (the
            // finalize endpoint) was always correct via
            // resolveProductTaxCategory; only the preview was wrong.
            productCategory: {
              select: { defaultTaxCategory: true, taxable: true },
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

      // Authorize the caller for the location this sale will be attributed to.
      // Mirrors the guards on the payment endpoints (ensurePaymentLocationAccess)
      // so a cashier scoped to one location can't post sales (or bind PI ids /
      // Stripe accounts) under a sibling location they don't have access to.
      // Both signals are checked: explicit `locationId` on the request AND the
      // location derived from `shiftId` (so passing only shiftId still gates
      // through the shift's location).
      const guard = await ensurePaymentLocationAccess(req, {
        shiftId: data.shiftId ?? null,
        locationId: data.locationId ?? null,
      });
      if (!guard.ok) {
        res.status(guard.status).json(guard.body);
        return;
      }

      // Best practice: block cash-tender / card / ACH sales when no shift is
      // open. A sale without a shift has no cashier accountability, no entry
      // in any Z-out, and breaks COGS posting (Plan 3 attaches the COGS
      // journal to the shift). Charge-to-A/R is the deliberate carve-out:
      // it doesn't touch the cash drawer — it creates an A/R Invoice, which
      // is a billing event, not a register sale.
      const isChargeToArAtGate =
        data.paymentMethod === "CHARGE_TO_AR" ||
        data.paymentMethod === "CHARGE_TO_ACCOUNT";
      if (!data.shiftId && !isChargeToArAtGate) {
        res.status(400).json({
          error:
            "Cannot complete a sale without an open shift. Open a shift to begin selling, or charge to A/R if this is a member billing event.",
          code: "SHIFT_REQUIRED",
        });
        return;
      }

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

      // Resolve location for tax — taken from the open shift, if any, then
      // falling back to an explicit `locationId` on the request (sales made
      // outside of an open shift, e.g. CNP fallback).
      let locationId: string | null = null;
      let locationTaxProvider: import("@prisma/client").TaxProvider | null = null;
      if (data.shiftId) {
        const shift = await prisma.shift.findFirst({
          where: { id: data.shiftId, tenantId },
          select: { locationId: true, status: true },
        });
        // Shift lock (Task #320): once a shift has been Z-out reconciled
        // it's a permanent ledger record — no new sales / refunds may be
        // attached. Cashier should open a fresh shift for the next sale.
        if (shift?.status === "RECONCILED") {
          throw appError(
            "This shift has been Z-out reconciled and is locked. Open a new shift to record additional sales.",
            409,
            "SHIFT_RECONCILED",
          );
        }
        locationId = shift?.locationId ?? null;
      }
      if (!locationId && data.locationId) {
        locationId = data.locationId;
      }
      if (locationId) {
        const loc = await prisma.location.findUnique({
          where: { id: locationId },
          select: { taxProvider: true },
        });
        locationTaxProvider = loc?.taxProvider ?? null;
      }

      // Auto-discount evaluation. When a customer is attached, server-side
      // discount engine picks the largest matching PosDiscount per line and
      // returns discountCents per line. The same engine the /api/pos/discounts
      // /preview endpoint exposes to the UI — single source of truth so the
      // cart preview and the persisted sale always agree.
      //
      // Client-supplied discountCents (manual cashier override) is honored
      // when it's LARGER than the auto-discount — manual wins ties go to
      // auto so a forgotten override on a stale cart can't cancel a freshly
      // configured discount.
      const autoDiscounts = await evaluateDiscountsForCart({
        tenantId,
        locationId,
        customerId: data.customerId ?? null,
        lineItems: data.lineItems.map((li) => {
          const product = productMap.get(li.productId);
          const unitPrice = li.unitPriceCents ?? product?.priceCents ?? 0;
          return { productId: li.productId, quantity: li.quantity, unitPriceCents: unitPrice };
        }),
      });

      // Build tax engine input. Per-line tax category resolves via:
      //   product.taxClass override → category.defaultTaxCategory → "general"
      // A product (or its category) marked tax-exempt yields a null
      // taxCategory and gets skipped by the engine.
      const lineCalcs = data.lineItems.map((li, idx) => {
        const product = productMap.get(li.productId);
        const unitPrice = li.unitPriceCents ?? product?.priceCents ?? 0;
        const gross = unitPrice * li.quantity;
        const auto = autoDiscounts[idx];
        const autoDiscountCents = auto?.discountCents ?? 0;
        const appliedDiscountCents = Math.max(li.discountCents, autoDiscountCents);
        // Track which side won so the persisted line carries the audit trail.
        const useAuto = autoDiscountCents > li.discountCents;
        const appliedDiscountId = useAuto ? auto?.appliedDiscountId ?? null : null;
        const discountSourceLabel = useAuto ? auto?.discountSourceLabel ?? null : null;
        const lineSubtotal = Math.max(0, gross - appliedDiscountCents);

        // Single-source precedence rule (per-product → category → "general"
        // with exempt short-circuits) lives in product-defaults.ts.
        const { taxCategory, taxable } = product
          ? resolveProductTaxCategory(product)
          : { taxCategory: "general" as string | null, taxable: true };

        return {
          li,
          unitPrice,
          lineSubtotal,
          appliedDiscountCents,
          appliedDiscountId,
          discountSourceLabel,
          taxCategory,
          taxable,
        };
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
        // Plan 3 — stamp the cost basis at sale time for tracked products so
        // Z-out can post COGS journals against it. WAC is the snapshot here;
        // FIFO consumption (which would walk InventoryLot rows) is still
        // ahead. `null` for non-tracked SKUs (services, gift cards, etc.)
        // and for the rare row whose product lacks a recorded average cost.
        const product = productMap.get(c.li.productId);
        const costAtSaleCents = product?.trackInventory && (product.averageCostCents ?? 0) > 0
          ? Math.round((product.averageCostCents ?? 0) * c.li.quantity)
          : null;
        return {
          productId: c.li.productId,
          quantity: c.li.quantity,
          unitPriceCents: c.unitPrice,
          discountCents: c.appliedDiscountCents,
          taxCents: lineTax,
          extendedCents: c.lineSubtotal + lineTax,
          appliedDiscountId: c.appliedDiscountId,
          discountSourceLabel: c.discountSourceLabel,
          costAtSaleCents,
        };
      });

      const totalCents = subtotalCents + taxCents + data.tipCents;

      // ─── Charge to A/R: create a real A/R Invoice for the customer ───────
      // CHARGE_TO_AR (and its legacy alias CHARGE_TO_ACCOUNT) requires an
      // attached customer + a location toggle, and produces an OPEN Invoice
      // that flows through normal A/R aging / reports. The PosTransaction
      // links to the Invoice via posTransaction.invoiceId.
      const isChargeToAr =
        data.paymentMethod === "CHARGE_TO_AR" ||
        data.paymentMethod === "CHARGE_TO_ACCOUNT";
      let chargeToArInvoiceId: string | null = null;
      if (isChargeToAr) {
        if (!data.customerId) {
          throw appError(
            "A customer is required for Charge to A/R sales.",
            400,
            "CUSTOMER_REQUIRED",
          );
        }
        if (!locationId) {
          throw appError(
            "A location is required for Charge to A/R sales.",
            400,
            "LOCATION_REQUIRED",
          );
        }
        const loc = await prisma.location.findFirst({
          where: { id: locationId, tenantId },
          select: { posChargeToARAllowed: true } as any,
        });
        if (!(loc as any)?.posChargeToARAllowed) {
          throw appError(
            "Charge to A/R is not enabled for this location.",
            400,
            "CHARGE_TO_AR_NOT_ALLOWED",
          );
        }
        const invoiceLineItems = lineCalcs.map((c, idx) => {
          const product = productMap.get(c.li.productId);
          const lineTax = taxByIndex[idx];
          const taxRate = c.lineSubtotal > 0 ? lineTax / c.lineSubtotal : 0;
          return {
            description: product?.name ?? "POS sale item",
            quantity: c.li.quantity,
            unitPriceCents: c.unitPrice,
            discountCents: c.appliedDiscountCents,
            taxRate,
            taxCents: lineTax,
            extendedCents: c.lineSubtotal + lineTax,
            sourceType: "POS",
            sourceId: c.li.productId ?? null,
          };
        });
        const issuedDate = new Date();
        const dueDate = new Date(issuedDate.getTime() + 30 * 24 * 60 * 60 * 1000);
        const invoice = await prisma.invoice.create({
          data: {
            tenantId,
            customerId: data.customerId,
            locationId,
            invoiceNumber: `INV-${Date.now().toString(36).toUpperCase()}`,
            issuedDate,
            dueDate,
            status: "ISSUED",
            subtotalCents,
            taxCents,
            totalCents,
            balanceCents: totalCents,
            lineItems: { createMany: { data: invoiceLineItems } },
          },
        });
        chargeToArInvoiceId = invoice.id;
      }

      // ─── Saved-card off-session charge ───────────────────────────────────
      // When the cashier picked a saved Stripe PM that the customer marked
      // "usable in POS", the server creates + confirms the PaymentIntent
      // off-session right here so the cashier sees an immediate result. The
      // resulting PI id flows through the existing CARD persistence path.
      let savedCardPaymentIntentId: string | null = null;
      let savedCardStripeAccountId: string | null = null;
      if (data.savedPaymentMethodId && !isChargeToAr) {
        if (data.paymentMethod !== "CARD") {
          throw appError(
            "savedPaymentMethodId requires paymentMethod=CARD.",
            400,
            "VALIDATION",
          );
        }
        if (!data.customerId) {
          throw appError(
            "A customer is required to charge a saved card.",
            400,
            "CUSTOMER_REQUIRED",
          );
        }
        if (!locationId) {
          throw appError(
            "A location is required to charge a saved card.",
            400,
            "LOCATION_REQUIRED",
          );
        }
        const cust = await prisma.customer.findFirst({
          where: { id: data.customerId, tenantId },
          select: { stripeCustomerId: true },
        });
        if (!cust?.stripeCustomerId) {
          throw appError(
            "Customer has no saved Stripe account.",
            400,
            "NO_STRIPE_CUSTOMER",
          );
        }
        const acctId = await resolveStripeAccount(tenantId, {
          shiftId: data.shiftId ?? null,
          locationId,
        });
        if (!acctId) {
          throw appError(
            "Stripe is not configured for this location.",
            400,
            "STRIPE_NOT_CONFIGURED",
          );
        }
        const stripe = requireStripe();
        const stripeOpts = { stripeAccount: acctId };
        const pm = await stripe.paymentMethods.retrieve(
          data.savedPaymentMethodId,
          {},
          stripeOpts,
        );
        if (pm.customer !== cust.stripeCustomerId) {
          throw appError(
            "Saved payment method does not belong to this customer.",
            403,
            "FORBIDDEN",
          );
        }
        if (pm.metadata?.usableInPos !== "true") {
          throw appError(
            "This saved card is not enabled for POS use.",
            400,
            "PM_NOT_USABLE_IN_POS",
          );
        }
        let pi: Stripe.PaymentIntent;
        try {
          pi = await stripe.paymentIntents.create(
            {
              amount: totalCents,
              currency: "usd",
              customer: cust.stripeCustomerId,
              payment_method: data.savedPaymentMethodId,
              confirm: true,
              off_session: true,
              metadata: {
                tenantId,
                customerId: data.customerId,
                source: "pos_saved_card",
              },
            },
            stripeOpts,
          );
        } catch (e) {
          const err = e as { code?: string; message?: string };
          if (err?.code === "authentication_required") {
            throw appError(
              "This card needs the customer to authenticate. Use the standard Card flow instead.",
              400,
              "AUTHENTICATION_REQUIRED",
            );
          }
          throw appError(
            err?.message ?? "Saved card charge failed.",
            400,
            err?.code ?? "SAVED_CARD_CHARGE_FAILED",
          );
        }
        if (pi.status !== "succeeded") {
          throw appError(
            `Saved card charge ${pi.status}.`,
            400,
            "SAVED_CARD_CHARGE_FAILED",
          );
        }
        savedCardPaymentIntentId = pi.id;
        savedCardStripeAccountId = acctId;
        // Write the proof-of-payment audit row so the existing PI verification
        // gate below accepts this server-created PaymentIntent.
        await prisma.auditLog.create({
          data: {
            tenantId,
            userId: req.userId,
            userName: req.userRecord?.email,
            recordType: "PosPayment",
            recordId: pi.id,
            action: "SAVED_CARD_CHARGED",
            changedFieldsJson: {
              paymentMethodId: data.savedPaymentMethodId,
              amountCents: totalCents,
            },
          },
        });
      }

      // Card-rail metadata is only meaningful for CARD sales. Silently drop
      // any rail/fallback fields for cash/ACH/charge so a buggy client can't
      // pollute the report dataset, and clear fallback reason for Terminal.
      // Saved-card sales are server-confirmed CNP charges by definition.
      const cardRail = data.paymentMethod === "CARD"
        ? (savedCardPaymentIntentId ? "CNP" : data.cardRail ?? null)
        : null;
      const cnpFallbackReason =
        cardRail === "CNP" && !savedCardPaymentIntentId
          ? data.cnpFallbackReason ?? null
          : null;
      // Same rule as `cardRail`: only CARD sales can carry a Stripe PI id.
      // A buggy (or malicious) client sending one on a cash/ACH row should
      // be silently dropped so the reconciliation join key only exists where
      // it's actually meaningful.
      const stripePaymentIntentId = data.paymentMethod === "CARD"
        ? (savedCardPaymentIntentId ?? data.stripePaymentIntentId ?? null)
        : null;

      // Proof-of-payment binding: before we trust a client-supplied PI id as
      // the reconciliation / refund key, the server MUST have already verified
      // that PI itself. Both legitimate paths write a `recordType=PosPayment`
      // audit row scoped to this tenant:
      //   - CNP keyed sales: POST /api/pos/payments/cnp/finalize (action=FINALIZED)
      //     after `paymentIntents.retrieve` returned `succeeded` + amount-match.
      //   - Terminal sales:  POST /api/pos/terminal/payment-intents/:id/capture
      //     (action=CAPTURED) after the connected-account capture succeeded.
      // Anything else is a forged / replayed id — refuse to persist it so the
      // refund handler can never call stripe.refunds.create against an
      // attacker-chosen PaymentIntent.
      if (stripePaymentIntentId) {
        const proof = await prisma.auditLog.findFirst({
          where: {
            tenantId,
            recordType: "PosPayment",
            recordId: stripePaymentIntentId,
          },
          select: { id: true },
        });
        if (!proof) {
          throw appError(
            "PaymentIntent has not been verified server-side",
            400,
            "PAYMENT_INTENT_NOT_VERIFIED",
          );
        }
      }

      // Capture the connected Stripe account at sale time so refunds remain
      // deterministic. Re-resolving via shift→location at refund time is
      // unsafe: the sale may have had no shift, or location ↔ Stripe-account
      // assignments may have changed in between. We only resolve when the
      // sale actually carried a PI id (i.e. it really hit Stripe), and we
      // accept the resolution being null — that just means the refund will
      // skip Stripe, same as a legacy pre-task-#255 row.
      let stripeAccountId: string | null = null;
      if (stripePaymentIntentId) {
        stripeAccountId = savedCardStripeAccountId
          ?? (await resolveStripeAccount(tenantId, {
            shiftId: data.shiftId ?? null,
            locationId: locationId,
          }));
      }

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
          customerId: data.customerId ?? null,
          subtotalCents,
          taxCents,
          tipCents: data.tipCents,
          totalCents,
          // Normalize the legacy CHARGE_TO_ACCOUNT alias to CHARGE_TO_AR so
          // new sales recorded in the reports use the canonical name.
          status: isChargeToAr ? "CHARGE_TO_AR" : data.paymentMethod,
          cardRail,
          cnpFallbackReason,
          stripePaymentIntentId,
          stripeAccountId,
          invoiceId: chargeToArInvoiceId,
          offlineQueued: false,
          lineItems: {
            create: lineItemsData,
          },
        } as any,
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
            ...(data.customerId ? { customerId: data.customerId } : {}),
            ...(lineItemsData.some((li) => li.appliedDiscountId)
              ? {
                  autoDiscountsApplied: lineItemsData
                    .filter((li) => li.appliedDiscountId)
                    .map((li) => ({
                      productId: li.productId,
                      discountCents: li.discountCents,
                      label: li.discountSourceLabel,
                    })),
                  totalDiscountCents: lineItemsData.reduce((s, li) => s + li.discountCents, 0),
                }
              : {}),
            ...(cardRail ? { cardRail } : {}),
            ...(cnpFallbackReason ? { cnpFallbackReason } : {}),
            ...(stripePaymentIntentId ? { stripePaymentIntentId } : {}),
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
        include: { lineItems: true, shift: { select: { status: true } } },
      });

      if (!original) {
        throw appError("Transaction not found", 404, "NOT_FOUND");
      }

      // Prefer refundedAt; legacy status='REFUNDED' is a backstop for
      // rows the migration couldn't safely revert.
      if (original.refundedAt || original.status === "REFUNDED") {
        throw appError("Transaction already refunded", 400, "ALREADY_REFUNDED");
      }

      // Shift lock (Task #320): refunds against a Z-out reconciled shift
      // would land outside the locked snapshot's tender totals and break
      // GL reconciliation. Reject with a clear pointer so the operator
      // issues either an A/R credit or a fresh refund transaction in the
      // current open shift instead.
      if (original.shift?.status === "RECONCILED") {
        throw appError(
          "The original sale's shift has been Z-out reconciled and is locked. " +
            "Issue an A/R credit, or record a refund transaction in the current open shift instead.",
          409,
          "SHIFT_RECONCILED",
        );
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

      // If the original sale was a Stripe-backed card payment, issue the
      // refund on the connected account by PaymentIntent id. We only do
      // this when the original carries a `stripePaymentIntentId` — older
      // pre-task-#255 rows are silently treated as offline refunds (no
      // Stripe call) so refunding legacy sales doesn't 500 the cashier.
      //
      // Account resolution is deterministic: we prefer the `stripeAccountId`
      // captured on the original row at sale time. That's the same account
      // the PaymentIntent was created on, so we don't have to re-resolve via
      // shift→location (which can drift if the location's Stripe account is
      // changed after the sale, or which would fail outright for sales made
      // without an open shift). Only if the original row has no stored
      // account (very early task-#255 rows that captured a PI id before this
      // column existed) do we fall back to live shift→location lookup.
      let stripeRefundId: string | null = null;
      if (original.stripePaymentIntentId) {
        const stripeAccountId =
          original.stripeAccountId ??
          (await resolveStripeAccount(tenantId, {
            shiftId: original.shiftId ?? null,
          }));
        if (!stripeAccountId) {
          throw appError(
            "Stripe is not configured for this location",
            400,
            "STRIPE_NOT_CONFIGURED",
          );
        }
        const stripeMod = await import("../lib/stripe.js");
        const stripeClient = stripeMod.stripe;
        if (!stripeClient) {
          throw appError("Stripe is not configured.", 500, "STRIPE_NOT_CONFIGURED");
        }
        const stripeRefund = await stripeClient.refunds.create(
          {
            payment_intent: original.stripePaymentIntentId,
            amount: refundTotal,
          },
          { stripeAccount: stripeAccountId },
        );
        stripeRefundId = stripeRefund.id;
      }

      // Refund row inherits the original's tender (status + cardRail)
      // so Z-out tender buckets net correctly. PI id, Stripe account,
      // and refundOfId mirror the original for deterministic joins.
      const refund = await prisma.posTransaction.create({
        data: {
          tenantId,
          cashierId: req.userId,
          shiftId: original.shiftId,
          subtotalCents: -refundSubtotal,
          taxCents: -refundTax,
          tipCents: 0,
          totalCents: -refundTotal,
          status: original.status,
          cardRail: original.cardRail ?? null,
          stripePaymentIntentId: original.stripePaymentIntentId ?? null,
          stripeAccountId: original.stripeAccountId ?? null,
          offlineQueued: false,
          refundOfId: original.id,
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

      // Stamp refundedAt on the original; do NOT overwrite status —
      // that would destroy the original tender and break Z-out math.
      await prisma.posTransaction.update({
        where: { id: original.id },
        data: { refundedAt: new Date() },
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
            ...(original.stripePaymentIntentId
              ? { stripePaymentIntentId: original.stripePaymentIntentId }
              : {}),
            ...(stripeRefundId ? { stripeRefundId } : {}),
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
              // Needed by the cash-refund approximation in the variance
              // math below (REFUNDED rows with no Stripe PI / invoice /
              // cardRail are treated as cash refunds).
              stripePaymentIntentId: true,
              invoiceId: true,
              cardRail: true,
            },
          },
        },
      });

      // Enrich shifts with sales totals. Expected-cash math matches the
      // close + Z-out paths (paid-outs and approximated cash refunds
      // subtracted) so the list view, close confirmation, and Z-out all
      // show the same variance for a given drawer count.
      const enriched = shifts.map((shift) => {
        const salesTotal = shift.transactions
          .filter((t) => t.totalCents >= 0)
          .reduce((sum, t) => sum + t.totalCents, 0);
        const cashSales = shift.transactions
          .filter((t) => t.status === "CASH" && t.totalCents > 0)
          .reduce((sum, t) => sum + t.totalCents, 0);
        const cashRefunds = shift.transactions
          .filter((t) => t.status === "CASH" && t.totalCents < 0)
          .reduce((sum, t) => sum + Math.abs(t.totalCents), 0);
        // Declared check/other are 0 until the shift is closed.
        const expectedCash =
          shift.openingFloatCents
          + cashSales
          - cashRefunds
          - shift.paidOutsCents
          - shift.declaredCheckCents
          - shift.declaredOtherCents;
        const variance =
          shift.closingCashCents != null
            ? shift.closingCashCents - expectedCash
            : null;

        return {
          ...shift,
          salesTotal,
          // Surfaced for the POS close-shift modal so it can render the
          // expected drawer figure off the SHIFT's cash net (rather than
          // a today-wide running total that misbehaves across day
          // boundaries / parallel shifts).
          cashSalesCents: cashSales,
          cashRefundsCents: cashRefunds,
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

      // Block reopening at this location until any prior CLOSED shift is
      // Z-out reconciled (Task #320). This is the gate that forces an
      // operator to complete end-of-day before the next shift can begin —
      // without it, two un-reconciled shifts can overlap on the same
      // drawer and the GL postings get tangled. Tenant-scoped + matching
      // the requested location (or null = portable POS not pinned to a
      // location).
      const unreconciledPrior = await prisma.shift.findFirst({
        where: {
          tenantId,
          locationId: data.locationId ?? null,
          status: "CLOSED",
        },
        select: { id: true, cashierId: true, closedAt: true },
        orderBy: { closedAt: "desc" },
      });
      if (unreconciledPrior) {
        const err: Error & { priorShiftId?: string } = appError(
          "A prior shift at this location is closed but not yet Z-out reconciled. " +
            "A manager must run Z-out on the previous shift before a new one can open.",
          409,
          "PRIOR_SHIFT_NOT_RECONCILED",
        );
        err.priorShiftId = unreconciledPrior.id;
        throw err;
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

      // Canonical expected cash — see pos-zout.ts for the formula.
      const cashSales = shift.transactions
        .filter((t) => t.status === "CASH" && t.totalCents > 0)
        .reduce((sum, t) => sum + t.totalCents, 0);
      const cashRefunds = shift.transactions
        .filter((t) => t.status === "CASH" && t.totalCents < 0)
        .reduce((sum, t) => sum + Math.abs(t.totalCents), 0);
      const expectedCash =
        shift.openingFloatCents
        + cashSales
        - cashRefunds
        - data.paidOutsCents
        - data.declaredCheckCents
        - data.declaredOtherCents;
      const variance = data.closingCashCents - expectedCash;

      const updated = await prisma.shift.update({
        where: { id: shift.id },
        data: {
          closedAt: new Date(),
          closingCashCents: data.closingCashCents,
          declaredCheckCents: data.declaredCheckCents,
          declaredOtherCents: data.declaredOtherCents,
          paidOutsCents: data.paidOutsCents,
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
            declaredCheckCents: data.declaredCheckCents,
            declaredOtherCents: data.declaredOtherCents,
            paidOutsCents: data.paidOutsCents,
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
// Z-OUT (Task #320)
// ═══════════════════════════════════════════════════════════════════════════════

// Helper: load a shift, scope-check by tenant + location-access, and
// optionally require a status. Returns the shift or sends a 4xx response
// and returns null (caller short-circuits).
type LoadedShift = {
  id: string;
  tenantId: string;
  locationId: string | null;
  status: import("@prisma/client").ShiftStatus;
  cashierId: string;
};

async function loadShiftForReport(
  req: Request,
  res: Response,
  shiftId: string,
  options: { requireStatuses?: import("@prisma/client").ShiftStatus[] } = {},
): Promise<LoadedShift | null> {
  const tenantId = req.tenantId!;
  const shift = await prisma.shift.findFirst({
    where: { id: shiftId, tenantId },
    select: { id: true, tenantId: true, locationId: true, status: true, cashierId: true },
  });
  if (!shift) {
    res.status(404).json({ error: "Shift not found", code: "NOT_FOUND" });
    return null;
  }
  if (shift.locationId && !requireLocationAccess(req, shift.locationId)) {
    res.status(403).json({ error: "Forbidden for this location", code: "LOCATION_FORBIDDEN" });
    return null;
  }
  if (options.requireStatuses && !options.requireStatuses.includes(shift.status)) {
    res.status(409).json({
      error: `Shift is ${shift.status}; expected one of ${options.requireStatuses.join(", ")}`,
      code: "INVALID_SHIFT_STATUS",
    });
    return null;
  }
  return shift;
}

// ─── GET /shifts/pending-zout — Closed shifts awaiting manager Z-out ───────
// Powers the manager landing list on the Z-Reports page. Returns CLOSED
// shifts (no Z-report yet) within the caller's location scope, ordered
// by closedAt ascending so the oldest unreconciled shift surfaces first.
router.get(
  "/shifts/pending-zout",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const baseScope = filterByAllowedLocations(
        req,
        { tenantId } as Record<string, unknown>,
        { includeNull: true },
      ) as Prisma.ShiftWhereInput;
      const shifts = await prisma.shift.findMany({
        where: { ...baseScope, status: "CLOSED", zReport: { is: null } },
        orderBy: { closedAt: "asc" },
        select: {
          id: true,
          locationId: true,
          cashierId: true,
          openedAt: true,
          closedAt: true,
          openingFloatCents: true,
          closingCashCents: true,
          declaredCheckCents: true,
          declaredOtherCents: true,
          paidOutsCents: true,
        },
      });
      res.json({ data: shifts });
    } catch (err) {
      next(err);
    }
  },
);

// ─── GET /shifts/:id/x-report — Read-only mid-shift preview ─────────────────
// Available against OPEN, CLOSED, or already-RECONCILED shifts (operators
// pull X-reports against historical shifts for spot-checks). Never writes.
router.get(
  "/shifts/:id/x-report",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const shift = await loadShiftForReport(req, res, req.params.id);
      if (!shift) return;
      const snapshot = await computeZOut(shift.id, null);
      res.json({
        shift: { id: shift.id, status: shift.status, locationId: shift.locationId },
        // Top-level convenience field — matches what the X-report /
        // RunZoutModal UIs consume so they don't have to dig through the
        // nested shift object.
        shiftStatus: shift.status,
        snapshot,
        // Helps the UI label the printable view.
        kind: shift.status === "RECONCILED" ? "Z" : "X",
      });
    } catch (err) {
      next(err);
    }
  },
);

// ─── POST /shifts/:id/z-out — Manager Z-out (commit) ────────────────────────
// Requires manager role. Atomic: compute snapshot, post GL, create ZReport,
// flip shift to RECONCILED with zReportId, all in one transaction. The
// (tenantId, locationId, zNumber) unique index surfaces concurrent races
// as a P2002 — we retry once on collision.
router.post(
  "/shifts/:id/z-out",
  requireRole("MARINA_OWNER", "MARINA_MANAGER"),
  requireAccountingSetup,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const data = ZOutSchema.parse(req.body);
      const shift = await loadShiftForReport(req, res, req.params.id, {
        requireStatuses: ["CLOSED"],
      });
      if (!shift) return;

      // Compute outside the transaction first to surface MISSING_GL_MAPPING /
      // tax setup errors with the existing 4xx error codes BEFORE we open a
      // (potentially long-held) write transaction.
      const previewSnapshot = await computeZOut(
        shift.id,
        data.countedCashCents ?? null,
      );

      const attemptZOut = async (): Promise<{
        zReport: import("@prisma/client").ZReport;
        snapshot: ZOutSnapshot;
        glJournalId: string | null;
      }> => {
        return await prisma.$transaction(async (tx: ZoutTx) => {
          // Re-read the shift inside the tx so a concurrent Z-out can't
          // double-commit. The unique FK on z_reports.shiftId is the
          // ultimate guarantee — the second writer will collide on
          // P2002 — but checking status here gives a cleaner 409.
          const fresh = await tx.shift.findUnique({
            where: { id: shift.id },
            select: { status: true },
          });
          if (!fresh || fresh.status !== "CLOSED") {
            throw Object.assign(
              new Error("Shift is no longer eligible for Z-out (already reconciled or reopened)."),
              { statusCode: 409, code: "INVALID_SHIFT_STATUS" },
            );
          }
          // Re-compute inside the tx so the snapshot reflects any state
          // touched by the same transaction.
          const snapshot = await computeZOut(
            shift.id,
            data.countedCashCents ?? null,
            tx,
          );

          const zNumber = await nextZNumber(shift.tenantId, shift.locationId, tx);

          // Post the summarized GL journal. Empty string = nothing to post.
          const glJournalIdRaw = await postShiftZOut(
            shift.tenantId,
            shift.id,
            snapshot,
            tx,
          );
          const glJournalId = glJournalIdRaw || null;

          const zReport = await tx.zReport.create({
            data: {
              tenantId: shift.tenantId,
              locationId: shift.locationId,
              shiftId: shift.id,
              zNumber,
              generatedByUserId: req.userId ?? null,
              glJournalId,
              notes: data.notes ?? null,
              grossSalesCents: snapshot.grossSalesCents,
              discountsCents: snapshot.discountsCents,
              refundsCents: snapshot.refundsCents,
              netSalesCents: snapshot.netSalesCents,
              taxCents: snapshot.taxCents,
              tipsCents: snapshot.tipsCents,
              totalCents: snapshot.totalCents,
              cashExpectedCents: snapshot.cashDrawer.expectedCents,
              cashCountedCents: snapshot.cashDrawer.countedCents,
              cashVarianceCents: snapshot.cashDrawer.varianceCents,
              // Prisma's InputJsonValue is structurally compatible with
              // our snapshot but TS can't narrow nested objects with
              // optional/null fields to that recursive type. JSON
              // round-trip is the cheap, type-honest workaround
              // (snapshot has no Date / Decimal / undefined values that
              // need preserving) and avoids `as unknown as` casts.
              snapshot: JSON.parse(JSON.stringify(snapshot)) as Prisma.InputJsonValue,
            },
          });

          await tx.shift.update({
            where: { id: shift.id },
            data: {
              status: "RECONCILED",
              // Allow the manager's recount to overwrite the cashier's
              // closingCashCents so subsequent reports show the corrected
              // figure as the canonical drawer count.
              ...(data.countedCashCents != null
                ? { closingCashCents: data.countedCashCents }
                : {}),
            },
          });

          return { zReport, snapshot, glJournalId };
        });
      };

      let result: Awaited<ReturnType<typeof attemptZOut>>;
      try {
        result = await attemptZOut();
      } catch (err: unknown) {
        // P2002 on (tenantId, locationId, zNumber) means a sibling Z-out
        // grabbed the same number first. Retry once with a freshly-computed
        // next number — by definition the second attempt picks N+1.
        const code =
          err && typeof err === "object" && "code" in err
            ? (err as { code?: unknown }).code
            : undefined;
        if (code === "P2002") {
          result = await attemptZOut();
        } else {
          throw err;
        }
      }

      await prisma.auditLog.create({
        data: {
          tenantId: shift.tenantId,
          userId: req.userId,
          userName: req.userRecord?.email,
          recordType: "ZReport",
          recordId: result.zReport.id,
          action: "CREATED",
          changedFieldsJson: {
            shiftId: shift.id,
            zNumber: result.zReport.zNumber,
            totalCents: result.snapshot.totalCents,
            cashVarianceCents: result.snapshot.cashDrawer.varianceCents,
            glJournalId: result.glJournalId,
          },
        },
      });

      res.status(201).json({
        ...result.zReport,
        ...(data.includeSnapshot ? { snapshot: result.snapshot } : {}),
      });
    } catch (err) {
      next(err);
    }
  },
);

// ─── GET /z-reports — List Z-reports ────────────────────────────────────────
router.get(
  "/z-reports",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const query = ListZReportsQuerySchema.parse(req.query);

      // Honor the caller's location scope. If the user requested a
      // specific location, gate access; otherwise filter to allowed
      // locations (includeNull=true matches the rest of POS routes).
      const baseScope = filterByAllowedLocations(
        req,
        { tenantId } as Record<string, unknown>,
        { includeNull: true },
      ) as Prisma.ZReportWhereInput;
      const where: Prisma.ZReportWhereInput = { ...baseScope };
      if (query.locationId) {
        if (!requireLocationAccess(req, query.locationId)) {
          res.status(403).json({ error: "Forbidden for this location", code: "LOCATION_FORBIDDEN" });
          return;
        }
        where.locationId = query.locationId;
      }
      if (query.dateFrom || query.dateTo) {
        const generatedAt: Prisma.DateTimeFilter = {};
        if (query.dateFrom) generatedAt.gte = new Date(query.dateFrom);
        if (query.dateTo) generatedAt.lte = new Date(query.dateTo + "T23:59:59.999Z");
        where.generatedAt = generatedAt;
      }

      // Optional cashier filter — Z reports don't carry the cashier
      // directly so we filter via the linked shift.
      if (query.cashierId) {
        where.shift = { is: { cashierId: query.cashierId } };
      }

      const [reports, total] = await Promise.all([
        prisma.zReport.findMany({
          where,
          orderBy: { generatedAt: "desc" },
          skip: query.skip,
          take: query.take,
          select: {
            id: true,
            tenantId: true,
            locationId: true,
            shiftId: true,
            zNumber: true,
            generatedByUserId: true,
            generatedAt: true,
            lockedAt: true,
            glJournalId: true,
            notes: true,
            grossSalesCents: true,
            discountsCents: true,
            refundsCents: true,
            netSalesCents: true,
            taxCents: true,
            tipsCents: true,
            totalCents: true,
            cashExpectedCents: true,
            cashCountedCents: true,
            cashVarianceCents: true,
            shift: {
              select: { cashierId: true, openedAt: true, closedAt: true },
            },
          },
        }),
        prisma.zReport.count({ where }),
      ]);

      res.json({
        data: reports,
        pagination: { skip: query.skip, take: query.take, total },
      });
    } catch (err) {
      next(err);
    }
  },
);

// ─── GET /z-reports/:id — Single Z-report (full snapshot) ───────────────────
router.get(
  "/z-reports/:id",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const report = await prisma.zReport.findFirst({
        where: { id: req.params.id, tenantId },
        include: { shift: true },
      });
      if (!report) {
        res.status(404).json({ error: "Z-report not found", code: "NOT_FOUND" });
        return;
      }
      if (report.locationId && !requireLocationAccess(req, report.locationId)) {
        res.status(403).json({ error: "Forbidden for this location", code: "LOCATION_FORBIDDEN" });
        return;
      }
      res.json(report);
    } catch (err) {
      next(err);
    }
  },
);

// ─── POST /z-reports/:id/email — Email the printable report ─────────────────
router.post(
  "/z-reports/:id/email",
  requireRole("MARINA_OWNER", "MARINA_MANAGER"),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const data = EmailZReportSchema.parse(req.body);

      const report = await prisma.zReport.findFirst({
        where: { id: req.params.id, tenantId },
      });
      if (!report) {
        res.status(404).json({ error: "Z-report not found", code: "NOT_FOUND" });
        return;
      }
      if (report.locationId && !requireLocationAccess(req, report.locationId)) {
        res.status(403).json({ error: "Forbidden for this location", code: "LOCATION_FORBIDDEN" });
        return;
      }

      // Recipients: body.to overrides; otherwise fall back to the
      // location's configured distribution list. 400 if neither set.
      let recipients: string | string[] | null = data.to ?? null;
      let usedConfiguredList = false;
      if (!recipients && report.locationId) {
        const loc = await prisma.location.findFirst({
          where: { id: report.locationId, tenantId },
          select: { zReportRecipients: true },
        });
        if (loc && loc.zReportRecipients.length > 0) {
          recipients = loc.zReportRecipients;
          usedConfiguredList = true;
        }
      }
      if (!recipients || (Array.isArray(recipients) && recipients.length === 0)) {
        res.status(400).json({
          error:
            "No recipients. Provide `to` in the request, or configure this location's Z-report distribution list.",
          code: "NO_RECIPIENTS",
        });
        return;
      }

      const snapshot = JSON.parse(JSON.stringify(report.snapshot)) as ZOutSnapshot;
      const html = renderZReportHtml(report, snapshot);

      try {
        await sendEmail({
          tenantId,
          locationId: report.locationId ?? undefined,
          to: recipients,
          subject: `Z-Report #${report.zNumber} — ${new Date(report.generatedAt).toLocaleDateString()}`,
          html,
        });
      } catch (err) {
        if (err instanceof EmailSendError) {
          res.status(502).json({ error: err.message, code: "EMAIL_SEND_FAILED" });
          return;
        }
        throw err;
      }

      await prisma.auditLog.create({
        data: {
          tenantId,
          userId: req.userId,
          userName: req.userRecord?.email,
          recordType: "ZReport",
          recordId: report.id,
          action: "EMAILED",
          changedFieldsJson: { to: recipients, usedConfiguredList },
        },
      });

      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);

// ─── HTML rendering for the printable / emailable Z-report ──────────────────
// Plain inline-styled HTML so it survives email-client CSS stripping. Same
// markup is fetched by the POS UI for the print preview (?format=html).
function fmtCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}$${(abs / 100).toFixed(2)}`;
}
function renderZReportHtml(
  report: { zNumber: number; generatedAt: Date; locationId: string | null; notes: string | null },
  s: ZOutSnapshot,
): string {
  const row = (label: string, value: string, bold = false) =>
    `<tr><td style="padding:4px 8px;${bold ? "font-weight:700" : ""}">${label}</td>` +
    `<td style="padding:4px 8px;text-align:right;font-variant-numeric:tabular-nums;${bold ? "font-weight:700" : ""}">${value}</td></tr>`;
  const sectionHeader = (label: string) =>
    `<tr><td colspan="2" style="padding:12px 8px 4px;font-size:11px;letter-spacing:.05em;text-transform:uppercase;color:#64748B;border-bottom:1px solid #E2E8F0">${label}</td></tr>`;

  return `<!doctype html><html><body style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;color:#0A2342;background:#FFF;padding:24px;max-width:560px;margin:0 auto">
  <div style="text-align:center;margin-bottom:16px">
    <div style="font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:#64748B">Z-Report</div>
    <div style="font-size:28px;font-weight:700;margin:4px 0">#${report.zNumber}</div>
    <div style="font-size:13px;color:#475569">${new Date(report.generatedAt).toLocaleString()}</div>
    ${s.cashierName ? `<div style="font-size:13px;color:#475569">Cashier: ${s.cashierName}</div>` : ""}
  </div>
  <table style="width:100%;border-collapse:collapse;font-size:13px">
    ${sectionHeader("Sales")}
    ${row("Gross sales", fmtCents(s.grossSalesCents))}
    ${row("Discounts", `-${fmtCents(s.discountsCents)}`)}
    ${row("Refunds", `-${fmtCents(s.refundsCents)}`)}
    ${row("Net sales", fmtCents(s.netSalesCents), true)}
    ${row("Tax", fmtCents(s.taxCents))}
    ${row("Tips", fmtCents(s.tipsCents))}
    ${row("Grand total", fmtCents(s.totalCents), true)}
    ${sectionHeader("Tenders")}
    ${row("Cash (net)", fmtCents(s.tenders.cash.netCents))}
    ${row(`Card — Terminal (${s.tenders.cardTerminal.count})`, fmtCents(s.tenders.cardTerminal.netCents))}
    ${row(`Card — CNP (${s.tenders.cardCnp.count})`, fmtCents(s.tenders.cardCnp.netCents))}
    ${row("ACH", fmtCents(s.tenders.ach.netCents))}
    ${row("Check (declared)", fmtCents(s.tenders.check.declaredCents))}
    ${row(`Charge to A/R (${s.tenders.chargeToAr.count})`, fmtCents(s.tenders.chargeToAr.netCents))}
    ${row("Other (declared)", fmtCents(s.tenders.other.declaredCents))}
    ${sectionHeader("Cash drawer")}
    ${row("Opening float", fmtCents(s.cashDrawer.openingFloatCents))}
    ${row("Cash sales", `+${fmtCents(s.cashDrawer.cashSalesCents)}`)}
    ${row("Cash refunds", `-${fmtCents(s.cashDrawer.cashRefundsCents)}`)}
    ${row("Paid-outs", `-${fmtCents(s.cashDrawer.paidOutsCents)}`)}
    ${row("Expected", fmtCents(s.cashDrawer.expectedCents), true)}
    ${row("Counted", fmtCents(s.cashDrawer.countedCents))}
    ${row(
      "Variance",
      `<span style="color:${s.cashDrawer.varianceCents === 0 ? "#059669" : s.cashDrawer.varianceCents > 0 ? "#059669" : "#DC2626"}">${s.cashDrawer.varianceCents >= 0 ? "+" : ""}${fmtCents(s.cashDrawer.varianceCents)}</span>`,
      true,
    )}
    ${s.salesByCategory.length ? sectionHeader("By category") : ""}
    ${s.salesByCategory.map((c) => row(c.categoryName, fmtCents(c.netCents))).join("")}
    ${s.discountsApplied.length ? sectionHeader("Discounts applied") : ""}
    ${s.discountsApplied.map((d) => row(`${d.label} (${d.count})`, `-${fmtCents(d.totalCents)}`)).join("")}
    ${s.stripeMatching.unmatchedRowIds.length
      ? `<tr><td colspan="2" style="padding:10px 8px;background:#FEF3C7;color:#92400E;border-radius:6px;margin-top:12px">⚠ ${s.stripeMatching.unmatchedRowIds.length} card sale(s) missing a Stripe PaymentIntent id — review before banking.</td></tr>`
      : ""}
  </table>
  ${report.notes ? `<div style="margin-top:16px;padding:12px;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:6px;font-size:13px">${report.notes}</div>` : ""}
  <div style="margin-top:16px;padding-top:12px;border-top:1px solid #E2E8F0;font-size:11px;color:#94A3B8;text-align:center">
    Locked snapshot. Read-only. Z #${report.zNumber}.
  </div>
  </body></html>`;
}

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

      const sales = transactions.filter((t) => t.totalCents >= 0);
      const refunds = transactions.filter((t) => t.totalCents < 0);

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
// `clientNonce` is required because it's the entropy that makes the
// idempotency key unique per cashier "Charge Card" attempt. Without it,
// two legitimate consecutive sales of the same amount in the same shift
// would collide and the second cashier would silently receive the first
// sale's PaymentIntent. The browser generates one nonce per CnpForm
// instance (i.e. per checkout session) so a double-clicked / network-
// retried request reuses it and Stripe collapses the duplicates, but a
// fresh checkout always gets a fresh key.
const CnpPaymentSchema = z.object({
  amountCents: z.number().int().min(50),
  description: z.string().optional(),
  shiftId: z.string().optional(),
  locationId: z.string().optional(),
  clientNonce: z.string().min(1).max(128),
}).strict();

router.post(
  "/payments/cnp",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { amountCents, description, shiftId, locationId, clientNonce } = CnpPaymentSchema.parse(req.body);
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
      // Stable per-attempt idempotency key. Stripe collapses repeated
      // create calls with the same key to the same PaymentIntent, so a
      // double-click on "Charge Card" or a network-layer retry stops
      // producing a second abandoned PI on the connected account (which
      // would otherwise consume the marina's Radar review minutes and
      // pollute reconciliation). Components:
      //   - `cnp:` namespace so the key can never collide with another
      //     route's idempotency space on the same connected account.
      //   - `shiftId ?? "no-shift"` scopes per cashier session.
      //   - `amountCents` so a corrected total (e.g. cashier added a
      //     line item and re-clicked) gets a fresh PI rather than
      //     replaying the stale one.
      //   - `clientNonce` is the per-CnpForm random id from the browser
      //     — without it, two legitimate same-amount sales in the same
      //     shift would collide.
      const idempotencyKey = `cnp:${shiftId ?? "no-shift"}:${amountCents}:${clientNonce}`;
      const intent = await stripeClient.paymentIntents.create(
        {
          amount: amountCents,
          currency: "usd",
          payment_method_types: ["card"],
          application_fee_amount: applicationFee,
          description: description ?? "POS card-not-present payment",
        },
        { stripeAccount: stripeAccountId, idempotencyKey },
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

// ─── GET /payments/cnp/account — Resolve the connected Stripe account ──────
//
// The browser needs the connected Stripe account id BEFORE it mounts the
// Elements provider for the keyed-card form, because Stripe.js must be
// initialized with `{ stripeAccount }` so that `confirmCardPayment` runs
// against the same account the PaymentIntent is minted on. Without this,
// confirmCardPayment queries the platform account and fails with
// "No such payment_intent".
router.get(
  "/payments/cnp/account",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const locationId = (req.query.locationId as string | undefined) ?? null;
      const shiftId = (req.query.shiftId as string | undefined) ?? null;
      const guard = await ensurePaymentLocationAccess(req, { shiftId, locationId });
      if (!guard.ok) { res.status(guard.status).json(guard.body); return; }
      const stripeAccountId = await resolveStripeAccount(req.tenantId!, { shiftId, locationId });
      if (!stripeAccountId) {
        res.status(400).json({ error: "STRIPE_NOT_CONFIGURED" });
        return;
      }
      res.json({ stripeAccountId });
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

      // Mirror the CNP-finalize audit row so Terminal-captured PIs also have
      // a server-verified proof-of-payment record. POST /transactions checks
      // for the presence of this row before persisting `stripePaymentIntentId`
      // — without it, a malicious client could attach an arbitrary PI id to a
      // POS sale and trigger a real Stripe refund against it later.
      await prisma.auditLog.create({
        data: {
          tenantId: req.tenantId!,
          userId: req.userId,
          userName: req.userRecord?.email,
          recordType: "PosPayment",
          recordId: req.params.id,
          action: "CAPTURED",
          changedFieldsJson: {
            paymentIntentId: req.params.id,
            stripeAccountId,
            cardRail: "TERMINAL",
            tipAmountCents: tipAmountCents ?? 0,
            shiftId: shiftId ?? null,
            locationId: locationId ?? null,
          },
        },
      });

      res.json({ captured: true });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
