import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { clerkAuth, requireRole } from "../middleware/auth.js";
import {
  getLocationMappings,
  upsertMapping,
  validateLocationMappings,
} from "../services/account-mapping.js";
import {
  getAuthorizationUrl,
  handleCallback,
  disconnect,
  getLocationStatus,
  pullChartOfAccounts,
  syncAll,
} from "../services/qbo-sync.js";

const router = Router();

router.use(clerkAuth());

// ---------------------------------------------------------------------------
// QBO Connection — per location
// ---------------------------------------------------------------------------

router.get("/qbo/status", async (req, res) => {
  try {
    const { locationId } = req.query as Record<string, string>;
    if (!locationId) return res.status(400).json({ error: "locationId required" });

    const status = await getLocationStatus(locationId);
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: "Failed to get QBO status" });
  }
});

router.post(
  "/qbo/connect",
  requireRole("MARINA_OWNER", "MARINA_MANAGER"),
  async (req, res) => {
    try {
      const { locationId } = req.body;
      const tenantId = req.tenantId!;

      if (!locationId) return res.status(400).json({ error: "locationId required" });

      const state = Math.random().toString(36).substring(7);
      const url = await getAuthorizationUrl(locationId, tenantId, state);

      res.json({ url });
    } catch (err) {
      res.status(500).json({ error: "Failed to initiate QBO connection" });
    }
  },
);

router.get("/qbo/callback", async (req, res) => {
  try {
    const { code, realmId, state } = req.query as Record<string, string>;
    const [tenantId, locationId] = (state ?? "").split(":");

    if (!code || !realmId || !locationId || !tenantId) {
      return res.status(400).send("Invalid callback parameters");
    }

    await handleCallback(code, realmId, locationId, tenantId);

    res.redirect("/accounting?qbo=connected");
  } catch (err) {
    console.error("[accounting] QBO callback error", err);
    res.redirect("/accounting?qbo=error");
  }
});

router.post(
  "/qbo/disconnect",
  requireRole("MARINA_OWNER", "MARINA_MANAGER"),
  async (req, res) => {
    try {
      const { locationId } = req.body;
      const tenantId = req.tenantId!;

      if (!locationId) return res.status(400).json({ error: "locationId required" });

      await disconnect(locationId, tenantId);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: "Failed to disconnect QBO" });
    }
  },
);

router.post(
  "/qbo/sync",
  requireRole("MARINA_OWNER", "MARINA_MANAGER", "ACCOUNTING"),
  async (req, res) => {
    try {
      const { locationId } = req.body;
      const tenantId = req.tenantId!;

      if (!locationId) return res.status(400).json({ error: "locationId required" });

      // Kick off sync in background and return immediately
      syncAll(locationId, tenantId).catch((err) => {
        console.error("[accounting] Manual sync failed", { locationId, err });
      });

      res.json({ message: "Sync started" });
    } catch (err) {
      res.status(500).json({ error: "Failed to start sync" });
    }
  },
);

router.post(
  "/qbo/pull-accounts",
  requireRole("MARINA_OWNER", "MARINA_MANAGER", "ACCOUNTING"),
  async (req, res) => {
    try {
      const { locationId } = req.body;
      const tenantId = req.tenantId!;

      if (!locationId) return res.status(400).json({ error: "locationId required" });

      const count = await pullChartOfAccounts(locationId, tenantId);
      res.json({ count });
    } catch (err) {
      res.status(500).json({ error: "Failed to pull chart of accounts" });
    }
  },
);

// ---------------------------------------------------------------------------
// Chart of Accounts — read from local QBO cache
// ---------------------------------------------------------------------------

router.get("/chart-of-accounts", async (req, res) => {
  try {
    const { locationId, type } = req.query as Record<string, string>;
    const tenantId = req.tenantId!;

    if (!locationId) return res.status(400).json({ error: "locationId required" });

    const where: any = { tenantId, locationId };
    if (type) where.type = type;

    const accounts = await prisma.glAccount.findMany({
      where,
      orderBy: [{ type: "asc" }, { accountNumber: "asc" }, { name: "asc" }],
    });

    res.json(accounts);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch chart of accounts" });
  }
});

// ---------------------------------------------------------------------------
// Account Mappings
// ---------------------------------------------------------------------------

router.get("/mappings", async (req, res) => {
  try {
    const { locationId } = req.query as Record<string, string>;

    if (!locationId) return res.status(400).json({ error: "locationId required" });

    const mappings = await getLocationMappings(locationId);
    res.json(mappings);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch account mappings" });
  }
});

router.get("/mappings/validate", async (req, res) => {
  try {
    const { locationId } = req.query as Record<string, string>;
    if (!locationId) return res.status(400).json({ error: "locationId required" });

    const result = await validateLocationMappings(locationId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: "Failed to validate mappings" });
  }
});

router.put(
  "/mappings",
  requireRole("MARINA_OWNER", "MARINA_MANAGER", "ACCOUNTING"),
  async (req, res) => {
    try {
      const {
        locationId,
        mappingType,
        sourceKey,
        glAccountId,
        glCogsAccountId,
        availablePOS,
        availableBilling,
        mappingLabel,
        mappingSection,
      } = req.body;
      const tenantId = req.tenantId!;

      if (!locationId || !mappingType || !sourceKey || !glAccountId) {
        return res.status(400).json({ error: "locationId, mappingType, sourceKey, glAccountId required" });
      }

      await upsertMapping({
        locationId,
        tenantId,
        mappingType,
        sourceKey,
        glAccountId,
        glCogsAccountId,
        availablePOS,
        availableBilling,
        userId: req.user?.id ?? "unknown",
        userName: req.user ? `${req.user.firstName} ${req.user.lastName}` : "Unknown",
        mappingLabel: mappingLabel ?? sourceKey,
        mappingSection: mappingSection ?? mappingType,
      });

      res.json({ success: true });
    } catch (err) {
      console.error("[accounting] PUT /mappings error", err);
      res.status(500).json({ error: "Failed to update mapping" });
    }
  },
);

// Bulk update all mappings for a location (full save from UI)
router.put(
  "/mappings/bulk",
  requireRole("MARINA_OWNER", "MARINA_MANAGER", "ACCOUNTING"),
  async (req, res) => {
    try {
      const { locationId, mappings } = req.body;
      const tenantId = req.tenantId!;

      if (!locationId || !Array.isArray(mappings)) {
        return res.status(400).json({ error: "locationId and mappings array required" });
      }

      for (const m of mappings) {
        await upsertMapping({
          ...m,
          locationId,
          tenantId,
          userId: req.user?.id ?? "unknown",
          userName: req.user ? `${req.user.firstName} ${req.user.lastName}` : "Unknown",
        });
      }

      res.json({ success: true, updated: mappings.length });
    } catch (err) {
      console.error("[accounting] PUT /mappings/bulk error", err);
      res.status(500).json({ error: "Failed to bulk update mappings" });
    }
  },
);

// Update dockage rate GL account
router.put(
  "/mappings/dockage-rate/:rateId",
  requireRole("MARINA_OWNER", "MARINA_MANAGER", "ACCOUNTING"),
  async (req, res) => {
    try {
      const { glRevenueAccountId, locationId } = req.body;
      const tenantId = req.tenantId!;

      const rate = await prisma.dockageRate.findFirst({
        where: { id: req.params.rateId, tenantId, locationId },
        include: { glRevenueAccount: { select: { name: true, qboAccountId: true } } },
      });

      if (!rate) return res.status(404).json({ error: "Dockage rate not found" });

      const newAccount = glRevenueAccountId
        ? await prisma.glAccount.findUnique({ where: { id: glRevenueAccountId }, select: { name: true, qboAccountId: true } })
        : null;

      await prisma.dockageRate.update({
        where: { id: req.params.rateId },
        data: { glRevenueAccountId: glRevenueAccountId ?? null },
      });

      // Audit log
      await prisma.accountMappingAuditLog.create({
        data: {
          tenantId,
          locationId,
          userId: req.user?.id ?? "unknown",
          userName: req.user ? `${req.user.firstName} ${req.user.lastName}` : "Unknown",
          mappingSection: "Dockage Rates",
          mappingLabel: rate.slipType,
          fieldChanged: "glRevenueAccountId",
          oldAccountName: rate.glRevenueAccount?.name ?? null,
          oldAccountId: rate.glRevenueAccount?.qboAccountId ?? null,
          newAccountName: newAccount?.name ?? null,
          newAccountId: newAccount?.qboAccountId ?? null,
        },
      });

      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: "Failed to update dockage rate GL" });
    }
  },
);

// Update rental GL mode + per-product mappings
router.put(
  "/mappings/rental-mode",
  requireRole("MARINA_OWNER", "MARINA_MANAGER", "ACCOUNTING"),
  async (req, res) => {
    try {
      const { locationId, rentalGlMode } = req.body;
      const tenantId = req.tenantId!;

      if (!["SINGLE", "PER_PRODUCT"].includes(rentalGlMode)) {
        return res.status(400).json({ error: "rentalGlMode must be SINGLE or PER_PRODUCT" });
      }

      await prisma.location.update({ where: { id: locationId }, data: { rentalGlMode } });

      await prisma.accountMappingAuditLog.create({
        data: {
          tenantId,
          locationId,
          userId: req.user?.id ?? "unknown",
          userName: req.user ? `${req.user.firstName} ${req.user.lastName}` : "Unknown",
          mappingSection: "Rentals",
          mappingLabel: "Rental GL Mode",
          fieldChanged: "rentalGlMode",
          oldAccountName: null,
          oldAccountId: null,
          newAccountName: rentalGlMode,
          newAccountId: null,
        },
      });

      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: "Failed to update rental GL mode" });
    }
  },
);

// Update service fee GL account
router.put(
  "/mappings/service-fee/:feeId",
  requireRole("MARINA_OWNER", "MARINA_MANAGER", "ACCOUNTING"),
  async (req, res) => {
    try {
      const { glAccountId, locationId } = req.body;
      const tenantId = req.tenantId!;

      const fee = await prisma.serviceFee.findFirst({
        where: { id: req.params.feeId, tenantId, locationId },
        include: { glAccount: { select: { name: true, qboAccountId: true } } },
      });

      if (!fee) return res.status(404).json({ error: "Service fee not found" });

      const newAccount = glAccountId
        ? await prisma.glAccount.findUnique({ where: { id: glAccountId }, select: { name: true, qboAccountId: true } })
        : null;

      await prisma.serviceFee.update({
        where: { id: req.params.feeId },
        data: { glAccountId: glAccountId ?? null },
      });

      await prisma.accountMappingAuditLog.create({
        data: {
          tenantId,
          locationId,
          userId: req.user?.id ?? "unknown",
          userName: req.user ? `${req.user.firstName} ${req.user.lastName}` : "Unknown",
          mappingSection: "Service Fees",
          mappingLabel: fee.name,
          fieldChanged: "glAccountId",
          oldAccountName: fee.glAccount?.name ?? null,
          oldAccountId: fee.glAccount?.qboAccountId ?? null,
          newAccountName: newAccount?.name ?? null,
          newAccountId: newAccount?.qboAccountId ?? null,
        },
      });

      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: "Failed to update service fee GL" });
    }
  },
);

// ---------------------------------------------------------------------------
// Fiscal Periods
// ---------------------------------------------------------------------------

router.get("/fiscal-periods", async (req, res) => {
  try {
    const periods = await prisma.fiscalPeriod.findMany({
      where: { tenantId: req.tenantId! },
      orderBy: { startDate: "desc" },
    });
    res.json(periods);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch fiscal periods" });
  }
});

router.post(
  "/fiscal-periods",
  requireRole("MARINA_OWNER", "MARINA_MANAGER", "ACCOUNTING"),
  async (req, res) => {
    try {
      const { name, startDate, endDate } = req.body;
      const tenantId = req.tenantId!;

      const period = await prisma.fiscalPeriod.create({
        data: {
          tenantId,
          name,
          startDate: new Date(startDate),
          endDate: new Date(endDate),
          status: "OPEN",
        },
      });

      res.status(201).json(period);
    } catch (err) {
      res.status(500).json({ error: "Failed to create fiscal period" });
    }
  },
);

router.put(
  "/fiscal-periods/:id/close",
  requireRole("MARINA_OWNER", "MARINA_MANAGER", "ACCOUNTING"),
  async (req, res) => {
    try {
      const period = await prisma.fiscalPeriod.findFirst({
        where: { id: req.params.id, tenantId: req.tenantId! },
      });

      if (!period) return res.status(404).json({ error: "Period not found" });
      if (period.status !== "OPEN") return res.status(400).json({ error: "Period is not open" });

      const updated = await prisma.fiscalPeriod.update({
        where: { id: req.params.id },
        data: {
          status: "CLOSED",
          closedBy: req.user ? `${req.user.firstName} ${req.user.lastName}` : "Unknown",
          closedAt: new Date(),
        },
      });

      res.json(updated);
    } catch (err) {
      res.status(500).json({ error: "Failed to close period" });
    }
  },
);

router.put(
  "/fiscal-periods/:id/lock",
  requireRole("MARINA_OWNER"),
  async (req, res) => {
    try {
      const period = await prisma.fiscalPeriod.findFirst({
        where: { id: req.params.id, tenantId: req.tenantId! },
      });

      if (!period) return res.status(404).json({ error: "Period not found" });
      if (period.status === "LOCKED") return res.status(400).json({ error: "Period already locked" });

      const updated = await prisma.fiscalPeriod.update({
        where: { id: req.params.id },
        data: {
          status: "LOCKED",
          lockedBy: req.user ? `${req.user.firstName} ${req.user.lastName}` : "Unknown",
          lockedAt: new Date(),
        },
      });

      res.json(updated);
    } catch (err) {
      res.status(500).json({ error: "Failed to lock period" });
    }
  },
);

router.put(
  "/fiscal-periods/:id/reopen",
  requireRole("MARINA_OWNER"),
  async (req, res) => {
    try {
      const period = await prisma.fiscalPeriod.findFirst({
        where: { id: req.params.id, tenantId: req.tenantId! },
      });

      if (!period) return res.status(404).json({ error: "Period not found" });
      if (period.status === "LOCKED") return res.status(403).json({ error: "Locked periods cannot be reopened without Owner override" });

      const updated = await prisma.fiscalPeriod.update({
        where: { id: req.params.id },
        data: { status: "OPEN", closedBy: null, closedAt: null },
      });

      res.json(updated);
    } catch (err) {
      res.status(500).json({ error: "Failed to reopen period" });
    }
  },
);

// ---------------------------------------------------------------------------
// Audit Log for mapping changes
// ---------------------------------------------------------------------------

router.get("/audit-log", requireRole("MARINA_OWNER", "MARINA_MANAGER", "ACCOUNTING"), async (req, res) => {
  try {
    const { locationId, startDate, endDate, limit = "50", offset = "0" } = req.query as Record<string, string>;
    const tenantId = req.tenantId!;

    const where: any = { tenantId };
    if (locationId) where.locationId = locationId;
    if (startDate) where.changedAt = { ...where.changedAt, gte: new Date(startDate) };
    if (endDate) where.changedAt = { ...where.changedAt, lte: new Date(endDate) };

    const [entries, total] = await Promise.all([
      prisma.accountMappingAuditLog.findMany({
        where,
        orderBy: { changedAt: "desc" },
        take: parseInt(limit),
        skip: parseInt(offset),
      }),
      prisma.accountMappingAuditLog.count({ where }),
    ]);

    res.json({ entries, total });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch audit log" });
  }
});

// ---------------------------------------------------------------------------
// Journal Entries (GL ledger view)
// ---------------------------------------------------------------------------

router.get("/journal-entries", requireRole("MARINA_OWNER", "MARINA_MANAGER", "ACCOUNTING"), async (req, res) => {
  try {
    const { locationId, startDate, endDate, sourceType, limit = "100", offset = "0" } = req.query as Record<string, string>;
    const tenantId = req.tenantId!;

    const where: any = { tenantId };
    if (locationId) where.locationId = locationId;
    if (sourceType) where.sourceType = sourceType;
    if (startDate || endDate) {
      where.postedAt = {};
      if (startDate) where.postedAt.gte = new Date(startDate);
      if (endDate) where.postedAt.lte = new Date(endDate);
    }

    const [entries, total] = await Promise.all([
      prisma.glEntry.findMany({
        where,
        include: {
          account: { select: { accountNumber: true, name: true, type: true } },
        },
        orderBy: { postedAt: "desc" },
        take: parseInt(limit),
        skip: parseInt(offset),
      }),
      prisma.glEntry.count({ where }),
    ]);

    res.json({ entries, total });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch journal entries" });
  }
});

// Post manual journal entry
router.post(
  "/journal-entries",
  requireRole("MARINA_OWNER", "MARINA_MANAGER", "ACCOUNTING"),
  async (req, res) => {
    try {
      const { locationId, lines, description } = req.body;
      const tenantId = req.tenantId!;

      if (!locationId) return res.status(400).json({ error: "locationId required" });
      if (!Array.isArray(lines) || lines.length < 2) {
        return res.status(400).json({ error: "At least 2 lines required for a journal entry" });
      }

      const { postManualJournalEntry } = await import("../services/gl-posting.js");
      const journalId = await postManualJournalEntry(tenantId, locationId, lines, description);

      res.status(201).json({ journalId });
    } catch (err: any) {
      res.status(400).json({ error: err.message ?? "Failed to post journal entry" });
    }
  },
);

export { router as accountingRouter };
