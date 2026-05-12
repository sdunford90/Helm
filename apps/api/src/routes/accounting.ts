import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { clerkAuth, requireRole } from "../middleware/auth.js";
import { logAccountingChange } from "../lib/accounting-audit.js";
import { queues } from "../lib/queue.js";
import { syncInvoice, syncInventoryItem, syncReceivingBill } from "../services/qbo-sync.js";
import { isLocationQboConnected } from "../services/gl-account-resolver.js";

const router: Router = Router();

// ---------------------------------------------------------------------------
// GL audit entity record types that qualify as accounting audit log entries
// ---------------------------------------------------------------------------
const ACCOUNTING_RECORD_TYPES = [
  "PostingAccount",
  "ProductCategoryGlMapping",
  "DockageRateGlMapping",
  "ServiceFeeGlMapping",
  "RentalProductGlMapping",
  "TaxRate",
  "AccountingPeriod",
  "QboConnection",
  "CostingMethod",
];

// ---------------------------------------------------------------------------
// Helper: compute setup-status for a location
// ---------------------------------------------------------------------------
async function computeSetupStatus(tenantId: string, locationId: string) {
  const location = await prisma.location.findFirst({
    where: { id: locationId, tenantId },
    select: {
      qboRealmId: true,
      qboCompanyName: true,
      stripeAccountId: true,
      stripeOnboardingComplete: true,
      arGlAccountId: true,
      undepositedFundsGlAccountId: true,
      deferredRevenueGlAccountId: true,
      defaultRevenueGlAccountId: true,
      salesTaxGlAccountId: true,
      earlyTerminationGlAccountId: true,
      achReturnFeeGlAccountId: true,
      accountingSetupComplete: true,
      accountingGracePeriodEndsAt: true,
      _count: {
        select: { glAccounts: true },
      },
    },
  });

  if (!location) return null;

  // Step 1: QBO connection
  const qboConnected = !!location.qboRealmId;
  const glAccountCount = location._count.glAccounts;

  // Step 2: Posting accounts (8 pins)
  const POSTING_SLOTS = [
    "arGlAccountId",
    "undepositedFundsGlAccountId",
    "deferredRevenueGlAccountId",
    "defaultRevenueGlAccountId",
    "salesTaxGlAccountId",
    "earlyTerminationGlAccountId",
    "achReturnFeeGlAccountId",
  ] as const;
  const totalPostingCount = POSTING_SLOTS.length;
  let mappedPostingCount = 0;
  for (const slot of POSTING_SLOTS) {
    if (location[slot] != null) mappedPostingCount++;
  }

  // Step 3: Category GL mappings
  const [totalCategories, mappedCategories] = await Promise.all([
    prisma.productCategory.count({ where: { tenantId } }),
    prisma.productCategoryGlMapping.count({
      where: {
        tenantId,
        locationId,
        revenueGlAccountId: { not: null },
        cogsGlAccountId: { not: null },
        inventoryAssetGlAccountId: { not: null },
      },
    }),
  ]);

  // Step 4: Tax jurisdictions
  const jurisdictionCount = await prisma.locationTaxJurisdiction.count({
    where: { locationId },
  });

  // Step 5: Dockage and service fee GL mappings
  const [dockageCount, serviceFeeCount] = await Promise.all([
    prisma.dockageRateGlMapping.count({ where: { tenantId, locationId } }),
    prisma.serviceFeeGlMapping.count({ where: { tenantId, locationId } }),
  ]);

  const step1Complete = qboConnected;
  const step2Complete = mappedPostingCount === totalPostingCount;
  const step3Complete = totalCategories === 0 || mappedCategories === totalCategories;
  const step4Complete = jurisdictionCount > 0;
  const step5Complete = dockageCount > 0 || serviceFeeCount > 0;
  const step6Complete = !!location.stripeAccountId && !!location.stripeOnboardingComplete;

  // Self-heal: if every step is satisfied but the persisted flag still says
  // setup isn't complete, flip it now and clear the grace period. This means
  // users never have to click a "Mark setup complete" button — finishing the
  // last step is enough. Skipped silently on update errors so a transient
  // write failure can't block reads of the status itself.
  let overallComplete = location.accountingSetupComplete;
  let gracePeriodEndsAt = location.accountingGracePeriodEndsAt;
  const allStepsComplete =
    step1Complete && step2Complete && step3Complete && step4Complete && step5Complete && step6Complete;
  if (allStepsComplete && !overallComplete) {
    const now = new Date();
    try {
      await prisma.location.update({
        where: { id: locationId },
        data: {
          accountingSetupComplete: true,
          accountingSetupCompletedAt: now,
          accountingGracePeriodEndsAt: null,
        },
      });
      overallComplete = true;
      gracePeriodEndsAt = null;
      // Best-effort audit trail mirroring the explicit /setup-complete path.
      // userId/userName are undefined because this is a system-driven
      // self-heal triggered by the status-check endpoint, not a user action.
      try {
        await logAccountingChange({
          tenantId,
          locationId,
          userId: undefined,
          userName: "system:auto-on-status-check",
          entity: "QboConnection",
          entityId: locationId,
          action: "CONNECT",
          changes: {
            accountingSetupComplete: { from: false, to: true },
            accountingSetupCompletedAt: { from: null, to: now },
            accountingGracePeriodEndsAt: { from: gracePeriodEndsAt ?? null, to: null },
          },
        });
      } catch (_auditErr) { /* intentionally swallowed */ }
    } catch (err) {
      console.warn(
        `[accounting] Auto-complete self-heal failed for location ${locationId}:`,
        (err as Error).message,
      );
    }
  }

  return {
    step1_qbo: {
      complete: step1Complete,
      companyName: location.qboCompanyName ?? null,
      glAccountCount,
      missingMappings: 0,
    },
    step2_posting: {
      complete: step2Complete,
      mappedCount: mappedPostingCount,
      totalCount: totalPostingCount,
    },
    step3_categories: {
      complete: step3Complete,
      mappedCount: mappedCategories,
      totalCount: totalCategories,
    },
    step4_tax: {
      complete: step4Complete,
      jurisdictionCount,
    },
    step5_rates: {
      complete: step5Complete,
      dockageCount,
      serviceFeeCount,
    },
    step6_stripe: {
      complete: step6Complete,
      connected: !!location.stripeAccountId,
      onboardingComplete: !!location.stripeOnboardingComplete,
      accountId: location.stripeAccountId ?? null,
    },
    overallComplete,
    gracePeriodEndsAt: gracePeriodEndsAt?.toISOString() ?? null,
  };
}

// ---------------------------------------------------------------------------
// GET /api/accounting/setup-status?locationId=X
// ---------------------------------------------------------------------------
router.get(
  "/setup-status",
  ...clerkAuth(),
  requireRole("MARINA_OWNER", "MARINA_MANAGER", "ACCOUNTING", "TENANT_ADMIN"),
  async (req, res, next) => {
    try {
      const { locationId } = req.query as { locationId?: string };
      if (!locationId) {
        res.status(400).json({ error: "locationId is required", code: "MISSING_PARAM" });
        return;
      }
      const tenantId = req.tenantId!;
      const status = await computeSetupStatus(tenantId, locationId);
      if (!status) {
        res.status(404).json({ error: "Location not found", code: "NOT_FOUND" });
        return;
      }
      res.json(status);
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// GET /api/accounting/audit-log?locationId=X&limit=50&offset=0
// ---------------------------------------------------------------------------
router.get(
  "/audit-log",
  ...clerkAuth(),
  requireRole("MARINA_OWNER", "MARINA_MANAGER", "ACCOUNTING", "TENANT_ADMIN"),
  async (req, res, next) => {
    try {
      const tenantId = req.tenantId!;
      const { locationId } = req.query as { locationId?: string };
      const limit = Math.min(parseInt((req.query.limit as string) ?? "50", 10), 200);
      const offset = parseInt((req.query.offset as string) ?? "0", 10);

      const where: Record<string, unknown> = {
        tenantId,
        recordType: { in: ACCOUNTING_RECORD_TYPES },
      };

      // If a locationId filter is provided, we filter by recordId=locationId
      // for PostingAccount entries, but for GL mapping entities we can't
      // reliably join without an extra query. We include all accounting audit
      // events for the tenant and let the UI further filter if needed.
      // When locationId is provided, restrict PostingAccount entries to that
      // location by allowing recordId=locationId OR any non-PostingAccount row.
      if (locationId) {
        where.OR = [
          { recordType: "PostingAccount", recordId: locationId },
          { recordType: { in: ACCOUNTING_RECORD_TYPES.filter((t) => t !== "PostingAccount") } },
        ];
        delete where.recordType;
      }

      const [items, total] = await Promise.all([
        prisma.auditLog.findMany({
          where,
          orderBy: { createdAt: "desc" },
          take: limit,
          skip: offset,
        }),
        prisma.auditLog.count({ where }),
      ]);

      // Map Prisma AuditLog rows to the shape the AuditTrailPanel expects.
      // The panel surfaces field/from/to per row when there's a single
      // changed field; otherwise it falls back to a JSON description.
      const data = items.map((row) => {
        const changes = (row.changedFieldsJson ?? null) as Record<
          string,
          { from?: unknown; to?: unknown } | unknown
        > | null;
        let field: string | null = null;
        let fromValue: string | null = null;
        let toValue: string | null = null;
        let description: string | null = null;
        if (changes && typeof changes === "object") {
          const keys = Object.keys(changes);
          if (keys.length === 1) {
            field = keys[0]!;
            const v = (changes as Record<string, unknown>)[field];
            if (v && typeof v === "object" && v !== null && ("from" in v || "to" in v)) {
              const ft = v as { from?: unknown; to?: unknown };
              fromValue = ft.from === undefined || ft.from === null ? null : String(ft.from);
              toValue = ft.to === undefined || ft.to === null ? null : String(ft.to);
            } else {
              toValue = v === undefined || v === null ? null : String(v);
            }
          } else if (keys.length > 1) {
            description = JSON.stringify(changes);
          }
        }
        return {
          id: row.id,
          createdAt: row.createdAt.toISOString(),
          userId: row.userId,
          userName: row.userName,
          userRole: null as string | null,
          recordType: row.recordType,
          action: row.action,
          field,
          fromValue,
          toValue,
          description,
        };
      });

      res.json({ data, total });
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// GET /api/accounting/periods?locationId=X
// ---------------------------------------------------------------------------
router.get(
  "/periods",
  ...clerkAuth(),
  requireRole("MARINA_OWNER", "MARINA_MANAGER", "ACCOUNTING", "TENANT_ADMIN"),
  async (req, res, next) => {
    try {
      const { locationId } = req.query as { locationId?: string };
      if (!locationId) {
        res.status(400).json({ error: "locationId is required", code: "MISSING_PARAM" });
        return;
      }
      const tenantId = req.tenantId!;

      try {
        const periods = await prisma.accountingPeriod.findMany({
          where: { tenantId, locationId },
          orderBy: { periodStart: "desc" },
        });
        res.json({ data: periods });
      } catch (dbErr: unknown) {
        // Handle case where AccountingPeriod table doesn't exist yet
        const msg = dbErr instanceof Error ? dbErr.message : String(dbErr);
        if (msg.includes("does not exist") || msg.includes("relation") || msg.includes("P2021")) {
          res.json({ data: [] });
          return;
        }
        throw dbErr;
      }
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /api/accounting/periods
// ---------------------------------------------------------------------------
router.post(
  "/periods",
  ...clerkAuth(),
  requireRole("TENANT_ADMIN", "ACCOUNTING"),
  async (req, res, next) => {
    try {
      const { locationId, periodStart, periodEnd, notes } = req.body as {
        locationId?: string;
        periodStart?: string;
        periodEnd?: string;
        notes?: string;
      };

      if (!locationId || !periodStart || !periodEnd) {
        res.status(400).json({
          error: "locationId, periodStart, and periodEnd are required",
          code: "MISSING_PARAM",
        });
        return;
      }

      const tenantId = req.tenantId!;

      const location = await prisma.location.findFirst({
        where: { id: locationId, tenantId },
        select: { id: true },
      });
      if (!location) {
        res.status(404).json({ error: "Location not found", code: "NOT_FOUND" });
        return;
      }

      const period = await prisma.accountingPeriod.create({
        data: {
          tenantId,
          locationId,
          periodStart: new Date(periodStart),
          periodEnd: new Date(periodEnd),
          notes: notes ?? null,
        },
      });

      // Best-effort audit log
      try {
        await logAccountingChange({
          tenantId,
          locationId,
          userId: req.userId,
          userName: req.userRecord
            ? `${(req.userRecord as any).firstName ?? ""} ${(req.userRecord as any).lastName ?? ""}`.trim() || undefined
            : undefined,
          entity: "AccountingPeriod",
          entityId: period.id,
          action: "CREATE",
          changes: {
            periodStart: { from: null, to: period.periodStart },
            periodEnd: { from: null, to: period.periodEnd },
          },
          ipAddress: req.ip,
        });
      } catch (_auditErr) { /* intentionally swallowed */ }

      res.status(201).json({ data: period });
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// PATCH /api/accounting/periods/:id/close
// ---------------------------------------------------------------------------
router.patch(
  "/periods/:id/close",
  ...clerkAuth(),
  requireRole("TENANT_ADMIN", "ACCOUNTING"),
  async (req, res, next) => {
    try {
      const tenantId = req.tenantId!;
      const { id } = req.params;
      const { notes } = req.body as { notes?: string };

      const period = await prisma.accountingPeriod.findFirst({
        where: { id, tenantId },
      });
      if (!period) {
        res.status(404).json({ error: "Accounting period not found", code: "NOT_FOUND" });
        return;
      }
      if (period.closedAt) {
        res.status(400).json({ error: "Period is already closed", code: "ALREADY_CLOSED" });
        return;
      }

      const closedAt = new Date();
      const updated = await prisma.accountingPeriod.update({
        where: { id },
        data: {
          closedAt,
          closedByUserId: req.userId ?? null,
          ...(notes !== undefined && { notes }),
        },
      });

      // Best-effort audit log
      try {
        await logAccountingChange({
          tenantId,
          locationId: period.locationId,
          userId: req.userId,
          userName: req.userRecord
            ? `${(req.userRecord as any).firstName ?? ""} ${(req.userRecord as any).lastName ?? ""}`.trim() || undefined
            : undefined,
          entity: "AccountingPeriod",
          entityId: id,
          action: "CLOSE",
          changes: {
            closedAt: { from: null, to: closedAt },
            closedByUserId: { from: null, to: req.userId ?? null },
          },
          ipAddress: req.ip,
        });
      } catch (_auditErr) { /* intentionally swallowed */ }

      res.json({ data: updated });
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// PATCH /api/accounting/periods/:id/reopen
// ---------------------------------------------------------------------------
router.patch(
  "/periods/:id/reopen",
  ...clerkAuth(),
  requireRole("TENANT_ADMIN"),
  async (req, res, next) => {
    try {
      const tenantId = req.tenantId!;
      const { id } = req.params;

      const period = await prisma.accountingPeriod.findFirst({
        where: { id, tenantId },
      });
      if (!period) {
        res.status(404).json({ error: "Accounting period not found", code: "NOT_FOUND" });
        return;
      }
      if (!period.closedAt) {
        res.status(400).json({ error: "Period is not closed", code: "NOT_CLOSED" });
        return;
      }

      const prevClosedAt = period.closedAt;
      const updated = await prisma.accountingPeriod.update({
        where: { id },
        data: {
          closedAt: null,
          closedByUserId: null,
        },
      });

      // Audit log — always required for reopen
      try {
        await logAccountingChange({
          tenantId,
          locationId: period.locationId,
          userId: req.userId,
          userName: req.userRecord
            ? `${(req.userRecord as any).firstName ?? ""} ${(req.userRecord as any).lastName ?? ""}`.trim() || undefined
            : undefined,
          entity: "AccountingPeriod",
          entityId: id,
          action: "REOPEN",
          changes: {
            closedAt: { from: prevClosedAt, to: null },
            closedByUserId: { from: period.closedByUserId, to: null },
          },
          ipAddress: req.ip,
        });
      } catch (_auditErr) { /* intentionally swallowed */ }

      res.json({ data: updated });
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// GET /api/accounting/sync-health?locationId=X
// ---------------------------------------------------------------------------
router.get(
  "/sync-health",
  ...clerkAuth(),
  requireRole("MARINA_OWNER", "MARINA_MANAGER", "ACCOUNTING", "TENANT_ADMIN"),
  async (req, res, next) => {
    try {
      const { locationId } = req.query as { locationId?: string };
      if (!locationId) {
        res.status(400).json({ error: "locationId is required", code: "MISSING_PARAM" });
        return;
      }
      const tenantId = req.tenantId!;

      const location = await prisma.location.findFirst({
        where: { id: locationId, tenantId },
        select: {
          qboRealmId: true,
          qboLastChartOfAccountsSyncAt: true,
        },
      });

      if (!location) {
        res.status(404).json({ error: "Location not found", code: "NOT_FOUND" });
        return;
      }

      const connected = !!location.qboRealmId;
      const lastChartSync = location.qboLastChartOfAccountsSyncAt?.toISOString() ?? null;

      type FailedSync = {
        entityType: string;
        entityId: string;
        entityLabel: string;
        error: string;
        failedAt: string | null;
        retryCount: number;
      };

      const failedSyncs: FailedSync[] = [];

      if (connected) {
        // Check Products with sync errors
        const failedProducts = await prisma.product.findMany({
          where: {
            tenantId,
            locationId,
            qboItemSyncError: { not: null },
          },
          select: {
            id: true,
            name: true,
            qboItemSyncError: true,
            qboItemSyncErrorAt: true,
          },
          take: 50,
          orderBy: { qboItemSyncErrorAt: "desc" },
        });
        for (const p of failedProducts) {
          failedSyncs.push({
            entityType: "Product",
            entityId: p.id,
            entityLabel: p.name,
            error: p.qboItemSyncError!,
            failedAt: p.qboItemSyncErrorAt?.toISOString() ?? null,
            retryCount: 0,
          });
        }

        // Check PurchaseOrders with bill sync errors
        const failedPOs = await prisma.purchaseOrder.findMany({
          where: {
            tenantId,
            locationId,
            qboBillSyncError: { not: null },
          },
          select: {
            id: true,
            poNumber: true,
            qboBillSyncError: true,
            qboBillSyncErrorAt: true,
          },
          take: 50,
          orderBy: { qboBillSyncErrorAt: "desc" },
        });
        for (const po of failedPOs) {
          failedSyncs.push({
            entityType: "PurchaseOrder",
            entityId: po.id,
            entityLabel: `PO #${po.poNumber}`,
            error: po.qboBillSyncError!,
            failedAt: po.qboBillSyncErrorAt?.toISOString() ?? null,
            retryCount: 0,
          });
        }

        // Check InventoryAdjustments with sync errors
        const failedAdj = await prisma.inventoryAdjustment.findMany({
          where: {
            tenantId,
            qboSyncError: { not: null },
          },
          select: {
            id: true,
            notes: true,
            qboSyncError: true,
            qboSyncErrorAt: true,
          },
          take: 50,
          orderBy: { qboSyncErrorAt: "desc" },
        });
        for (const adj of failedAdj) {
          failedSyncs.push({
            entityType: "InventoryAdjustment",
            entityId: adj.id,
            entityLabel: adj.notes ?? `Adjustment ${adj.id.slice(0, 8)}`,
            error: adj.qboSyncError!,
            failedAt: adj.qboSyncErrorAt?.toISOString() ?? null,
            retryCount: 0,
          });
        }
      }

      // Invoices issued (SENT/PAID) but not yet synced to QBO — no error
      // column exists on the Invoice model, so we surface unsynced invoices
      // as pending items for operator awareness.
      if (connected) {
        const unsyncedInvoices = await prisma.invoice.findMany({
          where: {
            tenantId,
            locationId,
            qboInvoiceId: null,
            status: { in: ["ISSUED", "PAID"] },
          },
          select: {
            id: true,
            invoiceNumber: true,
            customer: { select: { firstName: true, lastName: true } },
          },
          take: 20,
          orderBy: { createdAt: "desc" },
        });
        for (const inv of unsyncedInvoices) {
          const customerName = [inv.customer?.firstName, inv.customer?.lastName]
            .filter(Boolean)
            .join(" ") || `Invoice ${inv.invoiceNumber}`;
          failedSyncs.push({
            entityType: "Invoice",
            entityId: inv.id,
            entityLabel: `Invoice #${inv.invoiceNumber} — ${customerName}`,
            error: "Invoice has not been synced to QuickBooks (no QBO invoice ID)",
            failedAt: null,
            retryCount: 0,
          });
        }
      }

      // Map to the shape the SyncHealthPanel expects.
      const failedSyncsForPanel = failedSyncs.map((f) => ({
        id: `${f.entityType}:${f.entityId}`,
        entityType: f.entityType,
        entityId: f.entityId,
        entityName: f.entityLabel,
        error: f.error,
        attemptedAt: f.failedAt ?? new Date().toISOString(),
        retryCount: f.retryCount,
      }));

      res.json({
        connected,
        queueDepth: failedSyncs.length,
        failedSyncs: failedSyncsForPanel,
        recentSuccesses: [],
        lastSyncAt: lastChartSync,
        // Backwards-compat fields (older callers)
        lastChartSync,
      });
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /api/accounting/sync-health/retry
// Re-queues (or directly retries) a failed QB sync for the given entity.
// Body: { entityType: "Invoice" | "Product" | "PurchaseOrder", entityId: string, locationId: string }
// ---------------------------------------------------------------------------
router.post(
  "/sync-health/retry",
  ...clerkAuth(),
  requireRole("MARINA_OWNER", "MARINA_MANAGER", "ACCOUNTING", "TENANT_ADMIN"),
  async (req, res, next) => {
    try {
      const tenantId = req.tenantId!;
      const { entityType, entityId, locationId } = req.body as {
        entityType?: string;
        entityId?: string;
        locationId?: string;
      };

      if (!entityType || !entityId) {
        res.status(400).json({
          error: "entityType and entityId are required",
          code: "MISSING_PARAM",
        });
        return;
      }

      switch (entityType) {
        case "Invoice": {
          // Verify ownership before syncing
          const invoice = await prisma.invoice.findFirst({
            where: { id: entityId, tenantId },
            select: { id: true },
          });
          if (!invoice) {
            res.status(404).json({ error: "Invoice not found", code: "NOT_FOUND" });
            return;
          }
          // Run sync in background (fire-and-forget) so the HTTP response is fast
          syncInvoice(entityId, tenantId).catch((err: unknown) => {
            console.error(`[accounting] sync-health/retry invoice ${entityId}:`, err);
          });
          res.json({ queued: true, entityType, entityId });
          break;
        }

        case "Product": {
          const product = await prisma.product.findFirst({
            where: { id: entityId, tenantId },
            select: {
              id: true, name: true, sku: true, priceCents: true,
              costCents: true, qoh: true, trackInventory: true,
              locationId: true,
              productCategory: {
                select: {
                  glMappings: {
                    ...(locationId ? { where: { locationId } } : {}),
                    select: {
                      revenueGlAccountId: true,
                      inventoryAssetGlAccountId: true,
                      cogsGlAccountId: true,
                    },
                    take: 1,
                  },
                },
              },
            },
          });
          if (!product) {
            res.status(404).json({ error: "Product not found", code: "NOT_FOUND" });
            return;
          }
          const mapping = (product as any).productCategory?.glMappings?.[0];
          const incomeGlAccountId = mapping?.revenueGlAccountId ?? null;
          const inventoryAssetGlAccountId = mapping?.inventoryAssetGlAccountId ?? null;
          const cogsGlAccountId = mapping?.cogsGlAccountId ?? null;

          syncInventoryItem(
            {
              productId: product.id,
              name: product.name,
              sku: (product as any).sku ?? null,
              priceCents: product.priceCents,
              costCents: (product as any).costCents ?? 0,
              qoh: (product as any).qoh,
              trackInventory: (product as any).trackInventory ?? false,
              incomeGlAccountId,
              inventoryAssetGlAccountId,
              cogsGlAccountId,
            },
            tenantId,
            locationId ?? (product as any).locationId ?? null,
          ).catch((err: unknown) => {
            console.error(`[accounting] sync-health/retry product ${entityId}:`, err);
          });
          res.json({ queued: true, entityType, entityId });
          break;
        }

        case "PurchaseOrder": {
          const po = await (prisma.purchaseOrder as any).findFirst({
            where: { id: entityId, tenantId },
            select: {
              id: true, poNumber: true, vendorId: true, expectedDate: true,
              locationId: true,
              lineItems: {
                select: {
                  productId: true,
                  productName: true,
                  receivedQty: true,
                  unitCostAtReceipt: true,
                  unitCostCents: true,
                },
              },
            },
          });
          if (!po) {
            res.status(404).json({ error: "PurchaseOrder not found", code: "NOT_FOUND" });
            return;
          }
          const receivedLines = (po.lineItems ?? [])
            .filter((li: any) => (li.receivedQty ?? 0) > 0)
            .map((li: any) => ({
              productId: li.productId,
              productName: li.productName,
              receivedQty: li.receivedQty,
              unitCostCents: li.unitCostAtReceipt ?? li.unitCostCents,
            }));
          if (receivedLines.length === 0) {
            res.status(400).json({
              error: "No received line items on this PO — nothing to bill",
              code: "NO_RECEIVED_LINES",
            });
            return;
          }
          syncReceivingBill(
            {
              purchaseOrderId: po.id,
              poNumber: po.poNumber ?? po.id,
              vendorId: po.vendorId ?? null,
              expectedDate: po.expectedDate ?? null,
              lines: receivedLines,
              forcePush: false,
            },
            tenantId,
            locationId ?? po.locationId ?? null,
          ).catch((err: unknown) => {
            console.error(`[accounting] sync-health/retry PO ${entityId}:`, err);
          });
          res.json({ queued: true, entityType, entityId });
          break;
        }

        default:
          res.status(400).json({
            error: `Unsupported entityType: ${entityType}. Must be Invoice, Product, or PurchaseOrder.`,
            code: "INVALID_ENTITY_TYPE",
          });
      }
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /api/accounting/sync-health/sync-all-unsynced
// Bulk-enqueue every invoice that the Failed Syncs panel surfaces as
// "unsynced" (status IN ('ISSUED','PAID') AND qboInvoiceId IS NULL),
// scoped to the caller's tenant. Skips invoices whose location has no
// QBO connection. Returns {enqueued, skipped} so the UI can give the
// operator meaningful feedback after one click.
// ---------------------------------------------------------------------------
router.post(
  "/sync-health/sync-all-unsynced",
  ...clerkAuth(),
  requireRole("MARINA_OWNER", "MARINA_MANAGER", "ACCOUNTING", "TENANT_ADMIN"),
  async (req, res, next) => {
    try {
      const tenantId = req.tenantId!;

      const unsynced = await prisma.invoice.findMany({
        where: {
          tenantId,
          qboInvoiceId: null,
          status: { in: ["ISSUED", "PAID"] },
        },
        select: { id: true, locationId: true },
      });

      // Cache per-location connection results so a backlog of invoices
      // from the same location only triggers one DB lookup.
      const locConnCache = new Map<string, boolean>();
      let tenantConnected: boolean | null = null;
      const checkTenantConnection = async (): Promise<boolean> => {
        if (tenantConnected !== null) return tenantConnected;
        const tenant = await prisma.tenant.findUnique({
          where: { id: tenantId },
          select: { qboRealmId: true },
        });
        tenantConnected = !!tenant?.qboRealmId;
        return tenantConnected;
      };

      let enqueued = 0;
      let skippedNoConnection = 0;
      let enqueueFailed = 0;

      for (const inv of unsynced) {
        let connected = false;
        if (inv.locationId) {
          if (!locConnCache.has(inv.locationId)) {
            locConnCache.set(
              inv.locationId,
              await isLocationQboConnected(inv.locationId),
            );
          }
          connected = locConnCache.get(inv.locationId) ?? false;
        }
        if (!connected) {
          connected = await checkTenantConnection();
        }

        if (!connected) {
          skippedNoConnection++;
          continue;
        }

        try {
          await queues["qbo-sync"].add("sync-invoice", {
            tenantId,
            invoiceId: inv.id,
          });
          enqueued++;
        } catch (err) {
          console.error(
            `[accounting] sync-all-unsynced failed to enqueue invoice ${inv.id}:`,
            err instanceof Error ? err.message : err,
          );
          enqueueFailed++;
        }
      }

      res.json({
        enqueued,
        skippedNoConnection,
        enqueueFailed,
        // Aggregate "not synced" counter the UI can show without doing
        // its own arithmetic.
        skipped: skippedNoConnection + enqueueFailed,
        total: unsynced.length,
      });
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /api/accounting/setup-complete
// ---------------------------------------------------------------------------
router.post(
  "/setup-complete",
  ...clerkAuth(),
  requireRole("TENANT_ADMIN", "MARINA_OWNER", "ACCOUNTING"),
  async (req, res, next) => {
    try {
      const { locationId } = req.body as { locationId?: string };
      if (!locationId) {
        res.status(400).json({ error: "locationId is required", code: "MISSING_PARAM" });
        return;
      }
      const tenantId = req.tenantId!;

      const status = await computeSetupStatus(tenantId, locationId);
      if (!status) {
        res.status(404).json({ error: "Location not found", code: "NOT_FOUND" });
        return;
      }

      // Validate all steps are complete
      const incomplete: string[] = [];
      if (!status.step1_qbo.complete) incomplete.push("step1_qbo: QBO not connected or no GL accounts synced");
      if (!status.step2_posting.complete) {
        incomplete.push(
          `step2_posting: ${status.step2_posting.mappedCount}/${status.step2_posting.totalCount} posting accounts configured`,
        );
      }
      if (!status.step3_categories.complete) {
        incomplete.push(
          `step3_categories: ${status.step3_categories.mappedCount}/${status.step3_categories.totalCount} categories have complete GL mappings`,
        );
      }
      if (!status.step4_tax.complete) incomplete.push("step4_tax: no tax jurisdictions configured");
      if (!status.step5_rates.complete) {
        incomplete.push("step5_rates: no dockage rate or service fee GL mappings configured");
      }

      if (incomplete.length > 0) {
        res.status(400).json({
          error: "Accounting setup is not complete",
          code: "SETUP_INCOMPLETE",
          incomplete,
          status,
        });
        return;
      }

      const now = new Date();
      await prisma.location.update({
        where: { id: locationId },
        data: {
          accountingSetupComplete: true,
          accountingSetupCompletedAt: now,
          accountingGracePeriodEndsAt: null,  // clear grace period — setup is done
        },
      });

      // Best-effort audit log
      try {
        await logAccountingChange({
          tenantId,
          locationId,
          userId: req.userId,
          userName: req.userRecord
            ? `${(req.userRecord as any).firstName ?? ""} ${(req.userRecord as any).lastName ?? ""}`.trim() || undefined
            : undefined,
          entity: "QboConnection",
          entityId: locationId,
          action: "CONNECT",
          changes: {
            accountingSetupComplete: { from: false, to: true },
            accountingSetupCompletedAt: { from: null, to: now },
            accountingGracePeriodEndsAt: { from: 'cleared', to: null },
          },
          ipAddress: req.ip,
        });
      } catch (_auditErr) { /* intentionally swallowed */ }

      res.json({
        success: true,
        locationId,
        completedAt: now.toISOString(),
      });
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// GET /api/accounting/overview  (accounting personas)
// ---------------------------------------------------------------------------
router.get(
  "/overview",
  ...clerkAuth(),
  requireRole("TENANT_ADMIN", "MARINA_OWNER", "ACCOUNTING"),
  async (req, res, next) => {
    try {
      const tenantId = req.tenantId!;

      const locations = await prisma.location.findMany({
        where: { tenantId },
        select: {
          id: true,
          name: true,
          accountingSetupComplete: true,
          accountingSetupStep: true,
          accountingGracePeriodEndsAt: true,
          qboRealmId: true,
          qboCompanyName: true,
        },
      });

      // System accounts every location's chart should carry; missing rows
      // here are the cause of mid-transaction "GL account NNNN not found"
      // 500s in flows like deposit release, invoice posting, A/R apply.
      // Surfaced on the Accounting Overview as a per-location warning so
      // operators can fix it before the next failed posting.
      // `subType` mirrors the QBO-imported chart fallback in
      // `gl-posting.getAccountByNumber` (account number "QBO-NN" + matching
      // subType counts as present) so we don't false-positive on those tenants.
      const REQUIRED_SYSTEM_ACCOUNTS: Array<{
        number: string;
        label: string;
        subType?: string;
      }> = [
        { number: "1200", label: "Accounts Receivable", subType: "AccountsReceivable" },
        { number: "2300", label: "Security Deposits Held" },
      ];

      // Gather open reconciliation alert counts and failed sync counts per location
      const locationResults = await Promise.all(
        locations.map(async (loc) => {
          // Match the strictness rule used by `isLocationQboConnected` in
          // gl-account-resolver: needs BOTH realmId AND access token.
          // A stale `qboRealmId` without a token is treated as non-QBO at
          // posting time, so report the same way here to avoid mismatched
          // warnings.
          const qboConnected = await isLocationQboConnected(loc.id);
          const [openAlertCount, failedProductCount, failedPOCount, presentSystemAccts] = await Promise.all([
            prisma.reconciliationAlert.count({
              where: { locationId: loc.id, resolvedAt: null },
            }).catch(() => 0),
            prisma.product.count({
              where: { tenantId, locationId: loc.id, qboItemSyncError: { not: null } },
            }).catch(() => 0),
            prisma.purchaseOrder.count({
              where: { tenantId, locationId: loc.id, qboBillSyncError: { not: null } },
            }).catch(() => 0),
            prisma.glAccount.findMany({
              where: {
                tenantId,
                // QBO-connected locations need the account on THEIR chart
                // (the gl-posting helpers refuse a tenant-wide fallback to
                // avoid routing journals to the wrong QBO realm). Non-QBO
                // locations accept either location-scoped or tenant-wide.
                ...(qboConnected
                  ? { locationId: loc.id }
                  : { OR: [{ locationId: loc.id }, { locationId: null }] }),
                OR: [
                  { accountNumber: { in: REQUIRED_SYSTEM_ACCOUNTS.map((a) => a.number) } },
                  // subType fallback only applies when the chart was imported
                  // from QBO; getAccountByNumber's number→subType fallback runs
                  // for both QBO and non-QBO contexts, so include it always.
                  {
                    subType: {
                      in: REQUIRED_SYSTEM_ACCOUNTS.flatMap((a) =>
                        a.subType ? [a.subType] : [],
                      ),
                    },
                  },
                ],
              },
              select: { accountNumber: true, subType: true },
            }).catch(() => [] as Array<{ accountNumber: string; subType: string | null }>),
          ]);

          const presentNumbers = new Set(presentSystemAccts.map((a) => a.accountNumber));
          const presentSubTypes = new Set(
            presentSystemAccts.map((a) => a.subType).filter((s): s is string => !!s),
          );
          const missingSystemAccounts = REQUIRED_SYSTEM_ACCOUNTS.filter(
            (a) =>
              !presentNumbers.has(a.number) &&
              !(a.subType && presentSubTypes.has(a.subType)),
          ).map(({ number, label }) => ({ number, label }));

          return {
            locationId: loc.id,
            locationName: loc.name,
            setupComplete: loc.accountingSetupComplete ?? false,
            setupStep: loc.accountingSetupStep ?? 0,
            gracePeriodEndsAt: loc.accountingGracePeriodEndsAt?.toISOString() ?? null,
            qboConnected,
            qboCompanyName: loc.qboCompanyName ?? null,
            failedSyncCount: failedProductCount + failedPOCount,
            openAlertCount,
            openPeriod: null as { periodStart: string; periodEnd: string } | null,
            mtdRevenueCents: 0,
            missingSystemAccounts,
          };
        }),
      );

      // Attach open (non-closed) accounting periods per location
      try {
        const openPeriods = await prisma.accountingPeriod.findMany({
          where: {
            tenantId,
            closedAt: null,
            locationId: { in: locations.map((l) => l.id) },
          },
          select: { locationId: true, periodStart: true, periodEnd: true },
        });
        for (const period of openPeriods) {
          const loc = locationResults.find((l) => l.locationId === period.locationId);
          if (loc) {
            loc.openPeriod = {
              periodStart: period.periodStart.toISOString(),
              periodEnd: period.periodEnd.toISOString(),
            };
          }
        }
      } catch {
        // AccountingPeriod table may not exist yet — ignore gracefully
      }

      const totalFailedSyncs = locationResults.reduce((s, l) => s + l.failedSyncCount, 0);
      const totalOpenAlerts = locationResults.reduce((s, l) => s + l.openAlertCount, 0);
      const locationsNeedingSetup = locationResults.filter((l) => !l.setupComplete).length;

      res.json({
        locations: locationResults,
        totalMtdRevenueCents: 0, // TODO: aggregate from GlEntry when available
        totalFailedSyncs,
        totalOpenAlerts,
        locationsNeedingSetup,
      });
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// GET /api/accounting/reconciliation-alerts?locationId=X
// Returns open ReconciliationAlert rows for the location, joined to category name.
// ---------------------------------------------------------------------------
router.get(
  "/reconciliation-alerts",
  ...clerkAuth(),
  requireRole("ACCOUNTING", "TENANT_ADMIN", "MARINA_OWNER", "MARINA_MANAGER"),
  async (req, res, next) => {
    try {
      const tenantId = req.tenantId!;
      const locationId = req.query.locationId as string | undefined;

      const alerts = await prisma.reconciliationAlert.findMany({
        where: {
          tenantId,
          ...(locationId ? { locationId } : {}),
          resolvedAt: null,
        },
        select: {
          id: true,
          locationId: true,
          categoryId: true,
          helmValueCents: true,
          qbValueCents: true,
          deltaCents: true,
          detectedAt: true,
          resolvedAt: true,
          resolvedByUserId: true,
          notes: true,
          category: { select: { name: true } },
          location: { select: { name: true } },
        },
        orderBy: { detectedAt: "desc" },
      });

      // Map to the shape the ReconciliationPanel expects.
      const data = alerts.map((a) => {
        const helmCents = a.helmValueCents;
        const qbCents = a.qbValueCents;
        const variance = a.deltaCents;
        const variancePct = helmCents !== 0 ? (variance / helmCents) * 100 : null;
        const absPct = variancePct === null ? null : Math.abs(variancePct);
        let status: "OK" | "WARNING" | "ERROR" = "OK";
        if (variance !== 0) {
          status = absPct !== null && absPct < 1 ? "WARNING" : "ERROR";
        }
        return {
          id: a.id,
          categoryId: a.categoryId,
          categoryName: a.category?.name ?? "Unknown",
          helmValueCents: helmCents,
          qbBalanceCents: qbCents,
          varianceCents: variance,
          variancePct,
          lastCheckedAt: a.detectedAt.toISOString(),
          status,
        };
      });

      res.json({ data });
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// PATCH /api/accounting/reconciliation-alerts/:id/resolve
// Body: { notes? }
// Resolves an open alert. Requires ACCOUNTING or TENANT_ADMIN role.
// ---------------------------------------------------------------------------
router.patch(
  "/reconciliation-alerts/:id/resolve",
  ...clerkAuth(),
  requireRole("ACCOUNTING", "TENANT_ADMIN"),
  async (req, res, next) => {
    try {
      const tenantId = req.tenantId!;
      const { id } = req.params;
      const notes = req.body?.notes as string | undefined;

      const alert = await prisma.reconciliationAlert.findFirst({
        where: { id, tenantId },
      });

      if (!alert) {
        res.status(404).json({ error: "Reconciliation alert not found" });
        return;
      }

      if (alert.resolvedAt) {
        res.status(409).json({ error: "Alert is already resolved" });
        return;
      }

      const updated = await prisma.reconciliationAlert.update({
        where: { id },
        data: {
          resolvedAt: new Date(),
          resolvedByUserId: req.userId ?? null,
          ...(notes !== undefined ? { notes } : {}),
        },
      });

      res.json({ alert: updated });
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /api/accounting/reconciliation/run
// Triggers an immediate inventory reconciliation for the current location's
// tenant. Runs asynchronously — returns immediately after enqueueing.
// ---------------------------------------------------------------------------
router.post(
  "/reconciliation/run",
  ...clerkAuth(),
  requireRole("ACCOUNTING", "TENANT_ADMIN"),
  async (req, res, next) => {
    try {
      const tenantId = req.tenantId!;

      await queues.billing.add(
        "inventory-reconciliation",
        { tenantId },
        { jobId: `manual-reconciliation-${tenantId}-${Date.now()}` },
      );

      res.json({ queued: true, message: "Inventory reconciliation job enqueued" });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
