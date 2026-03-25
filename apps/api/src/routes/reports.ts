import { Router, type Request, type Response, type NextFunction } from "express";
import { clerkAuth, requireRole } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";

const router = Router();

router.use(...clerkAuth());
router.use(requireRole("admin", "manager", "accounting"));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function dateFilters(req: Request) {
  const startDate = req.query.startDate
    ? new Date(req.query.startDate as string)
    : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const endDate = req.query.endDate
    ? new Date(req.query.endDate as string)
    : new Date();
  return { startDate, endDate };
}

// ─── GET /reports/occupancy ───────────────────────────────────────────────────

router.get("/occupancy", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = (req as any).tenantId;

    const total = await prisma.slip.count({ where: { tenantId } });
    const occupied = await prisma.slip.count({ where: { tenantId, status: "OCCUPIED" } });
    const vacant = await prisma.slip.count({ where: { tenantId, status: "VACANT" } });
    const maintenance = await prisma.slip.count({ where: { tenantId, status: "MAINTENANCE" } });
    const reserved = await prisma.slip.count({ where: { tenantId, status: "RESERVED" } });

    const byDock = await prisma.slip.groupBy({
      by: ["dock"],
      where: { tenantId },
      _count: { id: true },
    });

    const occupiedByDock = await prisma.slip.groupBy({
      by: ["dock"],
      where: { tenantId, status: "OCCUPIED" },
      _count: { id: true },
    });

    const docks = byDock.map((d) => {
      const occ = occupiedByDock.find((o) => o.dock === d.dock);
      return {
        dock: d.dock,
        total: d._count.id,
        occupied: occ?._count.id ?? 0,
        rate: d._count.id > 0 ? ((occ?._count.id ?? 0) / d._count.id * 100).toFixed(1) : "0.0",
      };
    });

    res.json({
      summary: { total, occupied, vacant, maintenance, reserved, occupancyRate: total > 0 ? (occupied / total * 100).toFixed(1) : "0.0" },
      byDock: docks,
    });
  } catch (err) { next(err); }
});

// ─── GET /reports/revenue ─────────────────────────────────────────────────────

router.get("/revenue", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = (req as any).tenantId;
    const { startDate, endDate } = dateFilters(req);

    const payments = await prisma.payment.aggregate({
      where: { tenantId, postedDate: { gte: startDate, lte: endDate }, status: "COMPLETED" },
      _sum: { amountCents: true },
      _count: { id: true },
    });

    const invoices = await prisma.invoice.aggregate({
      where: { tenantId, issuedDate: { gte: startDate, lte: endDate } },
      _sum: { totalCents: true },
      _count: { id: true },
    });

    const byMethod = await prisma.payment.groupBy({
      by: ["method"],
      where: { tenantId, postedDate: { gte: startDate, lte: endDate }, status: "COMPLETED" },
      _sum: { amountCents: true },
      _count: { id: true },
    });

    res.json({
      period: { startDate, endDate },
      revenue: { totalCents: payments._sum.amountCents ?? 0, paymentCount: payments._count.id },
      invoiced: { totalCents: invoices._sum.totalCents ?? 0, invoiceCount: invoices._count.id },
      byPaymentMethod: byMethod.map((m) => ({ method: m.method, totalCents: m._sum.amountCents ?? 0, count: m._count.id })),
    });
  } catch (err) { next(err); }
});

// ─── GET /reports/ar-aging ────────────────────────────────────────────────────

router.get("/ar-aging", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = (req as any).tenantId;
    const now = new Date();

    const openInvoices = await prisma.invoice.findMany({
      where: { tenantId, status: { in: ["ISSUED", "PAST_DUE"] }, balanceCents: { gt: 0 } },
      include: { customer: { select: { id: true, firstName: true, lastName: true, email: true } } },
      orderBy: { dueDate: "asc" },
    });

    const buckets = { current: 0, days30: 0, days60: 0, days90: 0, days120plus: 0 };
    const details = openInvoices.map((inv) => {
      const daysOverdue = Math.floor((now.getTime() - new Date(inv.dueDate).getTime()) / 86400000);
      const bucket = daysOverdue <= 0 ? "current" : daysOverdue <= 30 ? "days30" : daysOverdue <= 60 ? "days60" : daysOverdue <= 90 ? "days90" : "days120plus";
      buckets[bucket] += inv.balanceCents;
      return { invoiceId: inv.id, invoiceNumber: inv.invoiceNumber, customer: inv.customer, dueDate: inv.dueDate, balanceCents: inv.balanceCents, daysOverdue: Math.max(0, daysOverdue), bucket };
    });

    res.json({ buckets, totalOutstanding: Object.values(buckets).reduce((a, b) => a + b, 0), invoiceCount: details.length, details });
  } catch (err) { next(err); }
});

// ─── GET /reports/collections ─────────────────────────────────────────────────

router.get("/collections", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = (req as any).tenantId;

    const accounts = await prisma.collectionsAccount.findMany({ where: { tenantId }, include: { customer: { select: { firstName: true, lastName: true } } } });
    const totalHandoff = accounts.reduce((s, a) => s + a.balanceAtHandoffCents, 0);
    const totalRecovered = accounts.reduce((s, a) => s + a.recoveredCents, 0);

    const byStatus = accounts.reduce((acc, a) => { acc[a.status] = (acc[a.status] || 0) + 1; return acc; }, {} as Record<string, number>);

    res.json({ accountCount: accounts.length, totalHandoffCents: totalHandoff, totalRecoveredCents: totalRecovered, recoveryRate: totalHandoff > 0 ? (totalRecovered / totalHandoff * 100).toFixed(1) : "0.0", byStatus, accounts });
  } catch (err) { next(err); }
});

// ─── GET /reports/deferred-revenue ────────────────────────────────────────────

router.get("/deferred-revenue", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = (req as any).tenantId;

    const schedules = await prisma.deferredSchedule.findMany({ where: { tenantId }, orderBy: { startDate: "asc" } });
    const totalDeferred = schedules.reduce((s, d) => s + d.totalCents, 0);
    const totalRecognized = schedules.reduce((s, d) => s + d.recognizedCents, 0);

    res.json({ scheduleCount: schedules.length, totalDeferredCents: totalDeferred, totalRecognizedCents: totalRecognized, remainingCents: totalDeferred - totalRecognized, schedules });
  } catch (err) { next(err); }
});

// ─── GET /reports/gl-summary ──────────────────────────────────────────────────

router.get("/gl-summary", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = (req as any).tenantId;
    const { startDate, endDate } = dateFilters(req);

    const accounts = await prisma.glAccount.findMany({ where: { tenantId }, orderBy: { accountNumber: "asc" } });

    const entries = await prisma.glEntry.groupBy({
      by: ["accountId"],
      where: { tenantId, postedAt: { gte: startDate, lte: endDate } },
      _sum: { debitCents: true, creditCents: true },
    });

    const summary = accounts.map((acct) => {
      const entry = entries.find((e) => e.accountId === acct.id);
      return {
        accountNumber: acct.accountNumber, name: acct.name, type: acct.type,
        debitsCents: entry?._sum.debitCents ?? 0, creditsCents: entry?._sum.creditCents ?? 0,
        netCents: (entry?._sum.debitCents ?? 0) - (entry?._sum.creditCents ?? 0),
      };
    });

    res.json({ period: { startDate, endDate }, accounts: summary });
  } catch (err) { next(err); }
});

// ─── GET /reports/customer-activity ───────────────────────────────────────────

router.get("/customer-activity", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = (req as any).tenantId;
    const { startDate, endDate } = dateFilters(req);

    const total = await prisma.customer.count({ where: { tenantId } });
    const active = await prisma.customer.count({ where: { tenantId, status: "ACTIVE" } });
    const newCustomers = await prisma.customer.count({ where: { tenantId, createdAt: { gte: startDate, lte: endDate } } });

    const byStatus = await prisma.customer.groupBy({ by: ["status"], where: { tenantId }, _count: { id: true } });

    res.json({ total, active, newInPeriod: newCustomers, byStatus: byStatus.map((s) => ({ status: s.status, count: s._count.id })) });
  } catch (err) { next(err); }
});

// ─── GET /reports/lead-conversion ─────────────────────────────────────────────

router.get("/lead-conversion", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = (req as any).tenantId;
    const { startDate, endDate } = dateFilters(req);

    const total = await prisma.lead.count({ where: { tenantId, createdAt: { gte: startDate, lte: endDate } } });
    const won = await prisma.lead.count({ where: { tenantId, stage: "WON", convertedAt: { gte: startDate, lte: endDate } } });
    const lost = await prisma.lead.count({ where: { tenantId, stage: "LOST", updatedAt: { gte: startDate, lte: endDate } } });

    const byStage = await prisma.lead.groupBy({ by: ["stage"], where: { tenantId }, _count: { id: true } });
    const bySource = await prisma.lead.groupBy({ by: ["utmSource"], where: { tenantId, createdAt: { gte: startDate, lte: endDate } }, _count: { id: true } });

    res.json({
      period: { startDate, endDate },
      totalLeads: total, won, lost,
      conversionRate: total > 0 ? (won / total * 100).toFixed(1) : "0.0",
      byStage: byStage.map((s) => ({ stage: s.stage, count: s._count.id })),
      bySource: bySource.map((s) => ({ source: s.utmSource || "direct", count: s._count.id })),
    });
  } catch (err) { next(err); }
});

// ─── GET /reports/rental-utilization ──────────────────────────────────────────

router.get("/rental-utilization", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = (req as any).tenantId;
    const { startDate, endDate } = dateFilters(req);

    const products = await prisma.rentalProduct.findMany({ where: { tenantId } });
    const reservations = await prisma.reservation.groupBy({
      by: ["rentalProductId"],
      where: { tenantId, startDt: { gte: startDate, lte: endDate }, status: { not: "CANCELLED" } },
      _count: { id: true },
      _sum: { totalCents: true },
    });

    const result = products.map((p) => {
      const res = reservations.find((r) => r.rentalProductId === p.id);
      return { productId: p.id, name: p.name, bookings: res?._count.id ?? 0, revenueCents: res?._sum.totalCents ?? 0 };
    });

    const totalRevenue = result.reduce((s, r) => s + r.revenueCents, 0);
    const totalBookings = result.reduce((s, r) => s + r.bookings, 0);

    res.json({ period: { startDate, endDate }, totalBookings, totalRevenueCents: totalRevenue, byProduct: result });
  } catch (err) { next(err); }
});

// ─── GET /reports/pos-sales ───────────────────────────────────────────────────

router.get("/pos-sales", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = (req as any).tenantId;
    const { startDate, endDate } = dateFilters(req);

    const transactions = await prisma.posTransaction.aggregate({
      where: { tenantId, createdAt: { gte: startDate, lte: endDate }, status: "COMPLETED" },
      _sum: { subtotalCents: true, taxCents: true, tipCents: true, totalCents: true },
      _count: { id: true },
    });

    const shifts = await prisma.shift.findMany({
      where: { tenantId, openedAt: { gte: startDate, lte: endDate } },
      select: { id: true, cashierId: true, openedAt: true, closedAt: true, tipTotalCents: true },
    });

    res.json({
      period: { startDate, endDate },
      transactionCount: transactions._count.id,
      subtotalCents: transactions._sum.subtotalCents ?? 0,
      taxCents: transactions._sum.taxCents ?? 0,
      tipCents: transactions._sum.tipCents ?? 0,
      totalCents: transactions._sum.totalCents ?? 0,
      shiftCount: shifts.length,
    });
  } catch (err) { next(err); }
});

// ─── GET /reports/dock-walk-summary ───────────────────────────────────────────

router.get("/dock-walk-summary", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = (req as any).tenantId;
    const { startDate, endDate } = dateFilters(req);

    const walks = await prisma.dockWalk.count({ where: { tenantId, startedAt: { gte: startDate, lte: endDate } } });
    const completed = await prisma.dockWalk.count({ where: { tenantId, status: "COMPLETED", startedAt: { gte: startDate, lte: endDate } } });

    const violations = await prisma.dockWalkItem.groupBy({
      by: ["violationType"],
      where: { dockWalk: { tenantId, startedAt: { gte: startDate, lte: endDate } }, violationType: { not: null } },
      _count: { id: true },
    });

    const pumpOuts = await prisma.pumpOut.count({ where: { tenantId, eventDate: { gte: startDate, lte: endDate } } });

    res.json({
      period: { startDate, endDate },
      totalWalks: walks, completed, completionRate: walks > 0 ? (completed / walks * 100).toFixed(1) : "0.0",
      violationsByType: violations.map((v) => ({ type: v.violationType, count: v._count.id })),
      totalViolations: violations.reduce((s, v) => s + v._count.id, 0),
      pumpOuts,
    });
  } catch (err) { next(err); }
});

// ─── GET /reports/waitlist ────────────────────────────────────────────────────

router.get("/waitlist", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = (req as any).tenantId;

    const total = await prisma.waitlistEntry.count({ where: { tenantId } });
    const bySlipType = await prisma.waitlistEntry.groupBy({ by: ["slipType"], where: { tenantId }, _count: { id: true } });
    const byStatus = await prisma.waitlistEntry.groupBy({ by: ["status"], where: { tenantId }, _count: { id: true } });

    res.json({ totalEntries: total, bySlipType: bySlipType.map((s) => ({ slipType: s.slipType, count: s._count.id })), byStatus: byStatus.map((s) => ({ status: s.status, count: s._count.id })) });
  } catch (err) { next(err); }
});

// ─── GET /reports/compliance ──────────────────────────────────────────────────

router.get("/compliance", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = (req as any).tenantId;
    const now = new Date();
    const thirtyDays = new Date(now.getTime() + 30 * 86400000);

    const totalInsurance = await prisma.insuranceRecord.count({ where: { tenantId } });
    const expired = await prisma.insuranceRecord.count({ where: { tenantId, expiryDate: { lt: now } } });
    const expiringSoon = await prisma.insuranceRecord.count({ where: { tenantId, expiryDate: { gte: now, lte: thirtyDays } } });
    const compliant = totalInsurance - expired - expiringSoon;

    const boatsTotal = await prisma.boat.count({ where: { tenantId } });
    const regExpired = await prisma.boat.count({ where: { tenantId, registrationExpiry: { lt: now } } });

    res.json({
      insurance: { total: totalInsurance, compliant, expiringSoon, expired },
      registration: { total: boatsTotal, expired: regExpired, current: boatsTotal - regExpired },
    });
  } catch (err) { next(err); }
});

// ─── GET /reports/tax-liability ───────────────────────────────────────────────

router.get("/tax-liability", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = (req as any).tenantId;
    const { startDate, endDate } = dateFilters(req);

    const taxCollected = await prisma.invoiceLineItem.aggregate({
      where: { invoice: { tenantId, issuedDate: { gte: startDate, lte: endDate }, status: { not: "VOID" } } },
      _sum: { taxCents: true },
    });

    res.json({ period: { startDate, endDate }, totalTaxCollectedCents: taxCollected._sum.taxCents ?? 0 });
  } catch (err) { next(err); }
});

// ─── GET /reports/inventory ───────────────────────────────────────────────────

router.get("/inventory", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = (req as any).tenantId;

    const products = await prisma.product.findMany({ where: { tenantId, trackInventory: true }, include: { inventory: true } });

    const items = products.map((p) => {
      const inv = p.inventory[0];
      return {
        productId: p.id, name: p.name, sku: p.sku,
        costCents: p.costCents, priceCents: p.priceCents,
        qtyOnHand: inv?.qtyOnHand ?? 0, qtyOnOrder: inv?.qtyOnOrder ?? 0,
        reorderQty: p.reorderQty,
        valueCents: (inv?.qtyOnHand ?? 0) * p.costCents,
        needsReorder: (inv?.qtyOnHand ?? 0) <= p.reorderQty,
      };
    });

    const totalValue = items.reduce((s, i) => s + i.valueCents, 0);
    const reorderAlerts = items.filter((i) => i.needsReorder).length;

    res.json({ productCount: items.length, totalValueCents: totalValue, reorderAlerts, items });
  } catch (err) { next(err); }
});

export default router;
