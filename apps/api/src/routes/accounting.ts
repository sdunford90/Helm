import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { clerkAuth, requireRole } from "../middleware/auth.js";
import { logAccountingChange } from "../lib/accounting-audit.js";

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

  return {
    step1_qbo: {
      complete: qboConnected,
      companyName: null as string | null,
      glAccountCount,
      missingMappings: 0,
    },
    step2_posting: {
      complete: mappedPostingCount === totalPostingCount,
      mappedCount: mappedPostingCount,
      totalCount: totalPostingCount,
    },
    step3_categories: {
      complete: totalCategories === 0 || mappedCategories === totalCategories,
      mappedCount: mappedCategories,
      totalCount: totalCategories,
    },
    step4_tax: {
      complete: jurisdictionCount > 0,
      jurisdictionCount,
    },
    step5_rates: {
      complete: dockageCount > 0 || serviceFeeCount > 0,
      dockageCount,
      serviceFeeCount,
    },
    overallComplete: location.accountingSetupComplete,
    gracePeriodEndsAt: location.accountingGracePeriodEndsAt?.toISOString() ?? null,
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

      res.json({ items, total });
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

      res.json({
        connected,
        lastChartSync,
        failedSyncs,
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

export default router;
