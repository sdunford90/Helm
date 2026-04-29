import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { clerkAuth } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";
import { calculateTax } from "../services/tax-engine.js";
import { postInvoice, postVoid } from "../services/gl-posting.js";
import { voidQboInvoice } from "../services/qbo-sync.js";
import { createDeferredSchedule } from "../services/deferred-revenue.js";
import { resolveProductTaxCategory } from "../services/product-defaults.js";
import { resolveProductGlAccounts, isLocationQboConnected } from "../services/gl-account-resolver.js";
import { queues } from "../lib/queue.js";
import { v4 as uuid } from "uuid";
import puppeteer from "puppeteer";

const router: Router = Router();

// ─── Zod Schemas ─────────────────────────────────────────────────────────────

const InvoiceStatusEnum = z.enum([
  "DRAFT",
  "ISSUED",
  "PAID",
  "PAST_DUE",
  "VOID",
  "COLLECTIONS",
]);

const ListInvoicesQuerySchema = z.object({
  status: InvoiceStatusEnum.optional(),
  customerId: z.string().uuid().optional(),
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
  overdue: z.coerce.boolean().optional(),
  skip: z.coerce.number().int().min(0).default(0),
  take: z.coerce.number().int().positive().max(100).default(25),
  sortBy: z
    .enum(["createdAt", "issuedDate", "dueDate", "totalCents", "invoiceNumber"])
    .default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

const LineItemSchema = z.object({
  description: z.string().min(1),
  quantity: z.number().positive().default(1),
  unitPriceCents: z.number().int(),
  discountCents: z.number().int().min(0).default(0),
  glAccountId: z.string().uuid().optional().nullable(),
  isDeferred: z.boolean().default(false),
  taxCategory: z.string().optional(),
  productId: z.string().uuid().optional().nullable(),
  sourceType: z.string().optional().nullable(),
  sourceId: z.string().optional().nullable(),
  deferredStartDate: z.coerce.date().optional(),
  deferredEndDate: z.coerce.date().optional(),
});

/**
 * Batch-resolve per-line revenue GL accounts using per-location overrides.
 * Returns `null` for lines without a product hint or whose product has no
 * mapping for this location (when QBO-connected) — the caller decides
 * whether to keep the client-provided glAccountId or leave it null so the
 * missing-mapping warning surfaces it.
 */
async function resolveLineItemRevenueGl(
  tenantId: string,
  locationId: string | null,
  lineItems: Array<{
    productId?: string | null;
    sourceType?: string | null;
    sourceId?: string | null;
  }>,
): Promise<(string | null)[]> {
  const productIds = lineItems.map((li) => {
    return (
      li.productId ??
      (li.sourceType?.toUpperCase() === "PRODUCT" ? li.sourceId ?? null : null)
    );
  });
  const out: (string | null)[] = new Array(lineItems.length).fill(null);
  const uniqueIds = Array.from(
    new Set(productIds.filter((p): p is string => !!p)),
  );
  if (uniqueIds.length === 0) return out;
  const resolved = new Map<string, string | null>();
  await Promise.all(
    uniqueIds.map(async (pid) => {
      const r = await resolveProductGlAccounts(tenantId, pid, locationId);
      resolved.set(pid, r.revenueGlAccountId);
    }),
  );
  for (let i = 0; i < lineItems.length; i++) {
    const pid = productIds[i];
    if (pid) out[i] = resolved.get(pid) ?? null;
  }
  return out;
}

/**
 * Batch-resolve per-line tax info. When the caller already set `taxCategory`
 * we trust it (and assume taxable=true); otherwise, if a productId is
 * attached (or sourceType/sourceId points at a product), we look up the
 * product and apply the per-product → category → "general" precedence used
 * by POS. Returns an array aligned 1:1 with the input.
 *
 * The tax engine exempts at the customer level only, so per-product /
 * per-category exempt status is honored here by reporting taxable=false —
 * callers zero the line's amountCents into calculateTax so the engine
 * returns 0 tax for that line without affecting the invoice line totals.
 */
async function resolveLineItemTaxInfo(
  tenantId: string,
  lineItems: Array<{
    taxCategory?: string;
    productId?: string | null;
    sourceType?: string | null;
    sourceId?: string | null;
  }>,
): Promise<Array<{ taxCategory: string | undefined; taxable: boolean }>> {
  const productIds = new Set<string>();
  for (const li of lineItems) {
    if (li.taxCategory) continue;
    const pid =
      li.productId ??
      (li.sourceType?.toUpperCase() === "PRODUCT" ? li.sourceId : null);
    if (pid) productIds.add(pid);
  }
  const productMap = new Map<
    string,
    {
      taxClass: string | null;
      productCategory: { defaultTaxCategory: string | null; taxable: boolean } | null;
    }
  >();
  if (productIds.size > 0) {
    const products = await prisma.product.findMany({
      where: { id: { in: Array.from(productIds) }, tenantId },
      select: {
        id: true,
        taxClass: true,
        productCategory: {
          select: { defaultTaxCategory: true, taxable: true },
        },
      },
    });
    for (const p of products) productMap.set(p.id, p);
  }
  return lineItems.map((li) => {
    if (li.taxCategory) return { taxCategory: li.taxCategory, taxable: true };
    const pid =
      li.productId ??
      (li.sourceType?.toUpperCase() === "PRODUCT" ? li.sourceId : null);
    const product = pid ? productMap.get(pid) : undefined;
    if (!product) return { taxCategory: undefined, taxable: true };
    const resolved = resolveProductTaxCategory(product);
    return {
      taxCategory: resolved.taxCategory ?? undefined,
      taxable: resolved.taxable,
    };
  });
}

const CreateInvoiceSchema = z.object({
  customerId: z.string().uuid(),
  issuedDate: z.coerce.date(),
  dueDate: z.coerce.date(),
  // Optional explicit location for the invoice. When supplied, it
  // overrides the implicit derivation from CONTRACT line items, which
  // means non-contract invoices (ad-hoc service charges, retail, etc.)
  // can finally collect the right jurisdictional tax instead of falling
  // through to a null locationId / zero tax.
  locationId: z.string().uuid().optional().nullable(),
  lineItems: z.array(LineItemSchema).min(1),
});

const UpdateInvoiceSchema = z.object({
  issuedDate: z.coerce.date().optional(),
  dueDate: z.coerce.date().optional(),
  lineItems: z.array(LineItemSchema).min(1).optional(),
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

// ─── GET / — List invoices ──────────────────────────────────────────────────

router.get(
  "/",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const query = ListInvoicesQuerySchema.parse(req.query);

      const where: Record<string, unknown> = { tenantId };

      if (query.status) where.status = query.status;
      if (query.customerId) where.customerId = query.customerId;

      if (query.dateFrom || query.dateTo) {
        const dateFilter: Record<string, Date> = {};
        if (query.dateFrom) dateFilter.gte = query.dateFrom;
        if (query.dateTo) dateFilter.lte = query.dateTo;
        where.issuedDate = dateFilter;
      }

      if (query.overdue) {
        where.dueDate = { lt: new Date() };
        where.status = { in: ["ISSUED", "PAST_DUE"] };
      }

      const [invoices, total] = await Promise.all([
        prisma.invoice.findMany({
          where,
          orderBy: { [query.sortBy]: query.sortOrder },
          skip: query.skip,
          take: query.take,
          include: {
            customer: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
                company: true,
              },
            },
            _count: { select: { lineItems: true, payments: true } },
          },
        }),
        prisma.invoice.count({ where }),
      ]);

      res.json({
        data: invoices,
        pagination: { skip: query.skip, take: query.take, total },
      });
    } catch (err) {
      next(err);
    }
  },
);

// ─── GET /:id — Invoice detail ──────────────────────────────────────────────

// ─── GET /:id/pdf — Generate and stream invoice PDF ─────────────────────────

router.get(
  "/:id/pdf",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;

      const invoice = await prisma.invoice.findFirst({
        where: { id: req.params.id, tenantId },
        include: {
          customer: { select: { firstName: true, lastName: true, email: true, addressJson: true } },
          lineItems: true,
          payments: { select: { amountCents: true, method: true, postedDate: true } },
        },
      });

      if (!invoice) {
        res.status(404).json({ error: "Invoice not found" });
        return;
      }

      const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true } });
      const tenantName = tenant?.name ?? "Marina";

      const fmt = (cents: number) => `$${(cents / 100).toFixed(2)}`;
      const formatDate = (d: Date | null) => d ? new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";

      const lineItemRows = invoice.lineItems.map((li) => `
        <tr>
          <td style="padding:8px 12px;border-bottom:1px solid #E2E8F0">${li.description}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #E2E8F0;text-align:center">${li.quantity}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #E2E8F0;text-align:right">${fmt(li.unitPriceCents)}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #E2E8F0;text-align:right">${fmt(li.extendedCents)}</td>
        </tr>
      `).join("");

      const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
        <style>
          body { font-family: "Helvetica Neue", sans-serif; color: #0A2342; margin: 0; padding: 40px; }
          h1 { font-size: 28px; margin: 0 0 4px; }
          table { width: 100%; border-collapse: collapse; margin-top: 24px; }
          th { background: #0A2342; color: #fff; padding: 10px 12px; text-align: left; font-size: 12px; letter-spacing: 0.05em; }
          th:last-child, td:last-child { text-align: right; }
          .label { font-size: 11px; color: #64748B; text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 2px; }
          .total-row td { font-weight: 700; background: #F7F9FB; }
        </style>
      </head><body>
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:32px">
          <div>
            <h1>${tenantName}</h1>
            <div style="font-size:22px;font-weight:700;color:#00D4FF">INVOICE</div>
          </div>
          <div style="text-align:right">
            <div class="label">Invoice #</div><div style="font-size:16px;font-weight:600">${invoice.invoiceNumber}</div>
            <div class="label" style="margin-top:12px">Issue Date</div><div>${formatDate(invoice.issuedDate)}</div>
            <div class="label" style="margin-top:8px">Due Date</div><div>${formatDate(invoice.dueDate)}</div>
          </div>
        </div>
        <div style="display:flex;gap:48px;margin-bottom:32px">
          <div>
            <div class="label">Bill To</div>
            <div style="font-size:15px;font-weight:600">${invoice.customer.firstName} ${invoice.customer.lastName}</div>
            ${invoice.customer.email ? `<div style="color:#64748B;font-size:13px">${invoice.customer.email}</div>` : ''}
            ${(() => { const a = invoice.customer.addressJson as Record<string,string> | null; return a?.address ? `<div style="font-size:13px">${a.address}</div>` : ''; })()}
            ${(() => { const a = invoice.customer.addressJson as Record<string,string> | null; return a?.city ? `<div style="font-size:13px">${a.city}, ${a.state ?? ''} ${a.zip ?? ''}</div>` : ''; })()}
          </div>
          <div>
            <div class="label">Status</div>
            <div style="font-size:14px;font-weight:600;color:${invoice.status === 'PAID' ? '#10B981' : invoice.status === 'PAST_DUE' ? '#EF4444' : '#0A2342'}">${invoice.status}</div>
          </div>
        </div>
        <table>
          <thead><tr>
            <th>Description</th><th style="text-align:center">Qty</th><th style="text-align:right">Unit Price</th><th style="text-align:right">Amount</th>
          </tr></thead>
          <tbody>${lineItemRows}</tbody>
          <tfoot>
            <tr><td colspan="3" style="padding:8px 12px;text-align:right;font-size:13px;color:#64748B">Subtotal</td><td style="padding:8px 12px;text-align:right">${fmt(invoice.subtotalCents)}</td></tr>
            <tr><td colspan="3" style="padding:8px 12px;text-align:right;font-size:13px;color:#64748B">Tax</td><td style="padding:8px 12px;text-align:right">${fmt(invoice.taxCents)}</td></tr>
            <tr class="total-row"><td colspan="3" style="padding:10px 12px;text-align:right">Total</td><td style="padding:10px 12px;text-align:right;font-size:16px">${fmt(invoice.totalCents)}</td></tr>
          </tfoot>
        </table>
        
      </body></html>`;

      const browser = await puppeteer.launch({ args: ["--no-sandbox", "--disable-setuid-sandbox"] });
      try {
        const page = await browser.newPage();
        await page.setContent(html, { waitUntil: "load" });
        const pdfBuffer = await page.pdf({ format: "Letter", printBackground: true, margin: { top: "20px", bottom: "20px" } });
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `inline; filename="invoice-${invoice.invoiceNumber}.pdf"`);
        res.send(Buffer.from(pdfBuffer));
      } finally {
        await browser.close();
      }
    } catch (err) {
      next(err);
    }
  },
);

// ─── GET /:id — Get single invoice ──────────────────────────────────────────

router.get(
  "/:id",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;

      const invoice = await prisma.invoice.findFirst({
        where: { id: req.params.id, tenantId },
        include: {
          customer: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              company: true,
            },
          },
          lineItems: {
            include: {
              glAccount: {
                select: { id: true, accountNumber: true, name: true },
              },
            },
          },
          payments: {
            select: {
              id: true,
              amountCents: true,
              method: true,
              status: true,
              postedDate: true,
              stripePaymentId: true,
            },
          },
        },
      });

      if (!invoice) {
        throw appError("Invoice not found", 404, "NOT_FOUND");
      }

      // Fetch GL entries for this invoice
      const glEntries = await prisma.glEntry.findMany({
        where: {
          tenantId,
          sourceId: invoice.id,
          sourceType: { in: ["INVOICE", "VOID"] },
        },
        include: {
          account: {
            select: { id: true, accountNumber: true, name: true, type: true },
          },
        },
        orderBy: { postedAt: "asc" },
      });

      res.json({ ...invoice, glEntries });
    } catch (err) {
      next(err);
    }
  },
);

// ─── POST / — Create invoice ────────────────────────────────────────────────

router.post(
  "/",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const data = CreateInvoiceSchema.parse(req.body);

      // Verify customer exists
      const customer = await prisma.customer.findFirst({
        where: { id: data.customerId, tenantId },
        select: { id: true },
      });
      if (!customer) {
        throw appError("Customer not found", 404, "CUSTOMER_NOT_FOUND");
      }

      // Resolve effective taxCategory for each line — caller-provided wins,
      // else inherit from the linked product (per-product → category →
      // "general"). Lines flagged non-taxable get amountCents=0 fed into the
      // engine so they yield zero tax without affecting the line totals
      // computed below from unitPrice × qty.
      const lineTaxInfo = await resolveLineItemTaxInfo(tenantId, data.lineItems);

      // Resolve location for tax: caller-supplied → first CONTRACT line's
      // slip location → null (engine returns zero tax).
      let locationId: string | null = data.locationId ?? null;
      if (!locationId) {
        const contractLineItem = data.lineItems.find(
          (li) => li.sourceType === "CONTRACT" && li.sourceId,
        );
        if (contractLineItem?.sourceId) {
          const contract = await prisma.slipContract.findUnique({
            where: { id: contractLineItem.sourceId },
            select: { slip: { select: { locationId: true } } },
          });
          locationId = contract?.slip?.locationId ?? null;
        }
      }

      const taxResult = await calculateTax({
        tenantId,
        locationId,
        customerId: data.customerId,
        lineItems: data.lineItems.map((li, idx) => ({
          description: li.description,
          amountCents: lineTaxInfo[idx].taxable
            ? li.unitPriceCents * li.quantity - li.discountCents
            : 0,
          taxCategory: lineTaxInfo[idx].taxCategory,
        })),
      });

      // Build line items with tax
      let subtotalCents = 0;
      let totalTaxCents = 0;

      // Resolve revenue GL per-location for any product-backed lines so a
      // QBO-connected location's invoice posts against its own chart of
      // accounts, not a stale tenant-level FK pointing at a different realm.
      const resolvedRevenueIds = await resolveLineItemRevenueGl(
        tenantId,
        locationId,
        data.lineItems,
      );

      const lineItemData = data.lineItems.map((li, idx) => {
        const extendedCents =
          li.unitPriceCents * li.quantity - li.discountCents;
        const taxCents = taxResult.items[idx]?.taxCents ?? 0;
        const taxRate = taxResult.items[idx]?.taxRate ?? 0;
        subtotalCents += extendedCents;
        totalTaxCents += taxCents;

        return {
          id: uuid(),
          description: li.description,
          quantity: li.quantity,
          unitPriceCents: li.unitPriceCents,
          discountCents: li.discountCents,
          taxRate,
          taxCents,
          extendedCents,
          glAccountId: li.glAccountId ?? resolvedRevenueIds[idx] ?? null,
          isDeferred: li.isDeferred,
          sourceType: li.sourceType ?? null,
          sourceId: li.sourceId ?? null,
        };
      });

      const totalCents = subtotalCents + totalTaxCents;
      const invoiceNumber = `INV-${Date.now().toString(36).toUpperCase()}`;

      const invoice = await prisma.invoice.create({
        data: {
          tenantId,
          customerId: data.customerId,
          locationId,
          invoiceNumber,
          issuedDate: data.issuedDate,
          dueDate: data.dueDate,
          status: "DRAFT",
          subtotalCents,
          taxCents: totalTaxCents,
          totalCents,
          balanceCents: totalCents,
          lineItems: {
            createMany: { data: lineItemData },
          },
        },
        include: {
          lineItems: true,
          customer: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
        },
      });

      // Audit log
      await prisma.auditLog.create({
        data: {
          tenantId,
          userId: req.userId,
          userName: req.userRecord?.email,
          recordType: "Invoice",
          recordId: invoice.id,
          action: "CREATED",
          changedFieldsJson: { invoiceNumber, totalCents, status: "DRAFT" },
        },
      });

      res.status(201).json(invoice);
    } catch (err) {
      next(err);
    }
  },
);

// ─── PUT /:id — Update draft invoice ────────────────────────────────────────

router.put(
  "/:id",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const data = UpdateInvoiceSchema.parse(req.body);

      const existing = await prisma.invoice.findFirst({
        where: { id: req.params.id, tenantId },
        include: { lineItems: true },
      });

      if (!existing) {
        throw appError("Invoice not found", 404, "NOT_FOUND");
      }

      if (existing.status !== "DRAFT") {
        throw appError(
          "Only DRAFT invoices can be updated",
          400,
          "INVALID_STATUS",
        );
      }

      const updateData: Record<string, unknown> = {};
      if (data.issuedDate) updateData.issuedDate = data.issuedDate;
      if (data.dueDate) updateData.dueDate = data.dueDate;

      if (data.lineItems) {
        // Recalculate tax using product-derived categories (see POST handler).
        const lineTaxInfo = await resolveLineItemTaxInfo(
          tenantId,
          data.lineItems,
        );
        // PUT only edits draft invoices; reuse the locationId established at
        // create time so jurisdiction-stack tax stays consistent across edits.
        const taxResult = await calculateTax({
          tenantId,
          locationId: existing.locationId,
          customerId: existing.customerId,
          lineItems: data.lineItems.map((li, idx) => ({
            description: li.description,
            amountCents: lineTaxInfo[idx].taxable
              ? li.unitPriceCents * li.quantity - li.discountCents
              : 0,
            taxCategory: lineTaxInfo[idx].taxCategory,
          })),
        });

        let subtotalCents = 0;
        let totalTaxCents = 0;

        // Mirror the create path: prefer the per-location resolved revenue
        // account when the client didn't pin a glAccountId itself.
        const resolvedRevenueIds = await resolveLineItemRevenueGl(
          tenantId,
          existing.locationId,
          data.lineItems,
        );

        const newLineItems = data.lineItems.map((li, idx) => {
          const extendedCents =
            li.unitPriceCents * li.quantity - li.discountCents;
          const taxCents = taxResult.items[idx]?.taxCents ?? 0;
          const taxRate = taxResult.items[idx]?.taxRate ?? 0;
          subtotalCents += extendedCents;
          totalTaxCents += taxCents;

          return {
            id: uuid(),
            description: li.description,
            quantity: li.quantity,
            unitPriceCents: li.unitPriceCents,
            discountCents: li.discountCents,
            taxRate,
            taxCents,
            extendedCents,
            glAccountId: li.glAccountId ?? resolvedRevenueIds[idx] ?? null,
            isDeferred: li.isDeferred,
            sourceType: li.sourceType ?? null,
            sourceId: li.sourceId ?? null,
          };
        });

        const totalCents = subtotalCents + totalTaxCents;

        // Replace line items in a transaction
        const updated = await prisma.$transaction(async (tx) => {
          await tx.invoiceLineItem.deleteMany({
            where: { invoiceId: existing.id },
          });

          return tx.invoice.update({
            where: { id: existing.id },
            data: {
              ...updateData,
              subtotalCents,
              taxCents: totalTaxCents,
              totalCents,
              balanceCents: totalCents,
              lineItems: {
                createMany: { data: newLineItems },
              },
            },
            include: { lineItems: true },
          });
        });

        res.json(updated);
      } else {
        const updated = await prisma.invoice.update({
          where: { id: existing.id },
          data: updateData,
          include: { lineItems: true },
        });
        res.json(updated);
      }
    } catch (err) {
      next(err);
    }
  },
);

// ─── POST /:id/finalize — Finalize invoice ─────────────────────────────────

router.post(
  "/:id/finalize",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;

      const invoice = await prisma.invoice.findFirst({
        where: { id: req.params.id, tenantId },
        include: { lineItems: true },
      });

      if (!invoice) {
        throw appError("Invoice not found", 404, "NOT_FOUND");
      }

      if (invoice.status !== "DRAFT") {
        throw appError(
          "Only DRAFT invoices can be finalized",
          400,
          "INVALID_STATUS",
        );
      }

      const updated = await prisma.$transaction(async (tx) => {
        // Set status to ISSUED
        const inv = await tx.invoice.update({
          where: { id: invoice.id },
          data: {
            status: "ISSUED",
            pdfUrl: `/api/invoices/${invoice.id}/pdf`, // PDF generation placeholder
          },
          include: { lineItems: true },
        });

        // Post GL entries: debit A/R, credit revenue accounts
        await postInvoice(
          {
            id: inv.id,
            tenantId,
            locationId: inv.locationId,
            totalCents: inv.totalCents,
            lineItems: inv.lineItems,
          },
          tx,
        );

        // Create deferred schedules for deferred line items
        for (const li of inv.lineItems) {
          if (li.isDeferred) {
            // Default: recognize over the next 12 months
            const start = new Date(inv.issuedDate);
            const end = new Date(start);
            end.setFullYear(end.getFullYear() + 1);
            end.setDate(end.getDate() - 1);

            await createDeferredSchedule(
              tenantId,
              { id: li.id, extendedCents: li.extendedCents, taxCents: li.taxCents },
              start,
              end,
            );
          }
        }

        return inv;
      });

      // Queue QBO sync if either the originating location OR the tenant has
      // connected QuickBooks. With per-location QBO, a location can be
      // connected even when the tenant-level realm is null.
      const locationConnected = updated.locationId
        ? await isLocationQboConnected(updated.locationId)
        : false;
      let shouldEnqueue = locationConnected;
      if (!shouldEnqueue) {
        const tenantForQbo = await prisma.tenant.findUnique({
          where: { id: tenantId },
          select: { qboRealmId: true },
        });
        shouldEnqueue = !!tenantForQbo?.qboRealmId;
      }
      if (shouldEnqueue) {
        await queues["qbo-sync"].add("sync-invoice", { tenantId, invoiceId: updated.id });
      }

      // Audit log
      await prisma.auditLog.create({
        data: {
          tenantId,
          userId: req.userId,
          userName: req.userRecord?.email,
          recordType: "Invoice",
          recordId: updated.id,
          action: "FINALIZED",
          changedFieldsJson: { previousStatus: "DRAFT", newStatus: "ISSUED" },
        },
      });

      res.json(updated);
    } catch (err) {
      next(err);
    }
  },
);

// ─── POST /:id/void — Void invoice ─────────────────────────────────────────

router.post(
  "/:id/void",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;

      const invoice = await prisma.invoice.findFirst({
        where: { id: req.params.id, tenantId },
        include: {
          payments: { where: { status: "COMPLETED" } },
        },
      });

      if (!invoice) {
        throw appError("Invoice not found", 404, "NOT_FOUND");
      }

      if (invoice.status === "VOID") {
        throw appError("Invoice is already void", 400, "ALREADY_VOID");
      }

      if (invoice.payments.length > 0) {
        throw appError(
          "Cannot void an invoice with completed payments. Refund payments first.",
          400,
          "HAS_PAYMENTS",
        );
      }

      const updated = await prisma.$transaction(async (tx) => {
        // Reverse GL entries
        await postVoid({ id: invoice.id, tenantId }, tx);

        // Set status to VOID
        return tx.invoice.update({
          where: { id: invoice.id },
          data: {
            status: "VOID",
            balanceCents: 0,
          },
        });
      });

      // Audit log
      await prisma.auditLog.create({
        data: {
          tenantId,
          userId: req.userId,
          userName: req.userRecord?.email,
          recordType: "Invoice",
          recordId: updated.id,
          action: "VOIDED",
          changedFieldsJson: {
            previousStatus: invoice.status,
            newStatus: "VOID",
          },
        },
      });

      // Best-effort QBO void — mirrors the void in QuickBooks so any
      // auto-posted COGS for inventory item lines is reversed there too.
      try {
        await voidQboInvoice(invoice.id, tenantId);
      } catch (err) {
        console.warn(`[invoices] QBO void propagation failed for ${invoice.id}:`, err);
      }

      res.json(updated);
    } catch (err) {
      next(err);
    }
  },
);

// ─── POST /:id/send — Send invoice email ───────────────────────────────────

router.post(
  "/:id/send",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;

      const invoice = await prisma.invoice.findFirst({
        where: { id: req.params.id, tenantId },
        include: {
          customer: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
        },
      });

      if (!invoice) {
        throw appError("Invoice not found", 404, "NOT_FOUND");
      }

      if (invoice.status === "DRAFT") {
        throw appError(
          "Finalize the invoice before sending",
          400,
          "INVALID_STATUS",
        );
      }

      if (!invoice.customer.email) {
        throw appError(
          "Customer does not have an email address",
          400,
          "NO_EMAIL",
        );
      }

      // Queue email — format must match what the email worker expects
      const customerName = `${invoice.customer.firstName} ${invoice.customer.lastName}`.trim();
      const amountFormatted = `$${(invoice.totalCents / 100).toFixed(2)}`;
      const dueDateFormatted = new Date(invoice.dueDate).toLocaleDateString("en-US", {
        month: "long", day: "numeric", year: "numeric",
      });
      const portalUrl = `${process.env.APP_URL || "https://app.gethelm.com"}/portal/invoices/${invoice.id}`;
      await queues.email.add("send-invoice", {
        type: "invoice",
        to: invoice.customer.email,
        tenantId,
        data: {
          customerName,
          invoiceNumber: invoice.invoiceNumber,
          amount: amountFormatted,
          dueDate: dueDateFormatted,
          portalUrl,
        },
      });

      // Audit log
      await prisma.auditLog.create({
        data: {
          tenantId,
          userId: req.userId,
          userName: req.userRecord?.email,
          recordType: "Invoice",
          recordId: invoice.id,
          action: "SENT",
          changedFieldsJson: {
            sentTo: invoice.customer.email,
          },
        },
      });

      res.json({ message: "Invoice queued for delivery", invoiceId: invoice.id });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
