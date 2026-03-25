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

// ─── GET /reports/electricity ──────────────────────────────────────────────────

router.get("/electricity", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = (req as any).tenantId;
    const { startDate, endDate } = dateFilters(req);
    const readings = await prisma.meterReading.findMany({ where: { tenantId, readingDate: { gte: startDate, lte: endDate } } });
    const totalKwh = readings.reduce((s, r) => s + r.consumedKwh, 0);
    const totalRevenue = readings.reduce((s, r) => s + r.amountCents, 0);
    const metered = readings.filter((r) => !r.isEstimated).length;
    const estimated = readings.filter((r) => r.isEstimated).length;
    res.json({ period: { startDate, endDate }, totalKwh, totalRevenueCents: totalRevenue, readingCount: readings.length, metered, estimated });
  } catch (err) { next(err); }
});

// ─── GET /reports/transient ───────────────────────────────────────────────────

router.get("/transient", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = (req as any).tenantId;
    const { startDate, endDate } = dateFilters(req);
    const bookings = await prisma.transientBooking.findMany({ where: { tenantId, checkIn: { gte: startDate, lte: endDate } } });
    const totalRevenue = bookings.reduce((s, b) => s + b.totalCents, 0);
    const avgStay = bookings.length > 0 ? bookings.reduce((s, b) => { const nights = Math.ceil((new Date(b.checkOut).getTime() - new Date(b.checkIn).getTime()) / 86400000); return s + nights; }, 0) / bookings.length : 0;
    const byStatus = bookings.reduce((acc, b) => { acc[b.status] = (acc[b.status] || 0) + 1; return acc; }, {} as Record<string, number>);
    res.json({ period: { startDate, endDate }, bookingCount: bookings.length, totalRevenueCents: totalRevenue, avgStayNights: avgStay.toFixed(1), byStatus });
  } catch (err) { next(err); }
});

// ─── GET /reports/rental-marketing ────────────────────────────────────────────

router.get("/rental-marketing", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = (req as any).tenantId;
    const { startDate, endDate } = dateFilters(req);
    const surveys = await prisma.npsSurvey.findMany({ where: { tenantId, sentAt: { gte: startDate, lte: endDate } } });
    const responded = surveys.filter((s) => s.respondedAt);
    const avgNps = responded.length > 0 ? responded.reduce((s, r) => s + r.score, 0) / responded.length : 0;
    const promoters = responded.filter((s) => s.score >= 9).length;
    const detractors = responded.filter((s) => s.score <= 6).length;
    const promos = await prisma.promoCode.findMany({ where: { tenantId } });
    const totalRedemptions = promos.reduce((s, p) => s + p.usedCount, 0);
    res.json({ period: { startDate, endDate }, npsSurveysSent: surveys.length, npsResponses: responded.length, avgNpsScore: avgNps.toFixed(1), promoters, detractors, promoCodesActive: promos.filter((p) => p.active).length, totalRedemptions });
  } catch (err) { next(err); }
});

// ─── GET /reports/dynamic-pricing ─────────────────────────────────────────────

router.get("/dynamic-pricing", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = (req as any).tenantId;
    const suggestions = await prisma.algorithmicSuggestion.findMany({ where: { rentalProduct: { tenantId } } });
    const approved = suggestions.filter((s) => s.status === "APPROVED").length;
    const ignored = suggestions.filter((s) => s.status === "IGNORED").length;
    const pending = suggestions.filter((s) => s.status === "PENDING").length;
    const overrides = await prisma.pricingCalendarOverride.count({ where: { rentalProduct: { tenantId } } });
    const surgeTiers = await prisma.demandSurgeTier.count({ where: { rentalProduct: { tenantId } } });
    res.json({ suggestions: { total: suggestions.length, approved, ignored, pending, acceptanceRate: suggestions.length > 0 ? (approved / suggestions.length * 100).toFixed(1) : "0.0" }, calendarOverrides: overrides, surgeTiersConfigured: surgeTiers });
  } catch (err) { next(err); }
});

// ─── GET /reports/fuel ────────────────────────────────────────────────────────

router.get("/fuel", async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Fuel data is in-memory in the fuel route; return summary from POS fuel sales
    const tenantId = (req as any).tenantId;
    const { startDate, endDate } = dateFilters(req);
    const fuelSales = await prisma.posLineItem.findMany({ where: { transaction: { tenantId, createdAt: { gte: startDate, lte: endDate } }, product: { department: "FUEL" } }, include: { product: true } });
    const totalRevenue = fuelSales.reduce((s, li) => s + li.extendedCents, 0);
    res.json({ period: { startDate, endDate }, fuelLineItems: fuelSales.length, totalRevenueCents: totalRevenue });
  } catch (err) { next(err); }
});

// ─── GET /reports/ramp ────────────────────────────────────────────────────────

router.get("/ramp", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = (req as any).tenantId;
    const { startDate, endDate } = dateFilters(req);
    const tickets = await prisma.rampTicket.findMany({ where: { tenantId, createdAt: { gte: startDate, lte: endDate } } });
    const totalRevenue = tickets.reduce((s, t) => s + t.amountCents, 0);
    const byType = tickets.reduce((acc, t) => { acc[t.ticketType] = (acc[t.ticketType] || 0) + 1; return acc; }, {} as Record<string, number>);
    res.json({ period: { startDate, endDate }, ticketCount: tickets.length, totalRevenueCents: totalRevenue, byType });
  } catch (err) { next(err); }
});

// ─── GET /reports/concierge ───────────────────────────────────────────────────

router.get("/concierge", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = (req as any).tenantId;
    const { startDate, endDate } = dateFilters(req);
    const requests = await prisma.conciergeRequest.findMany({ where: { tenantId, createdAt: { gte: startDate, lte: endDate } } });
    const byType = requests.reduce((acc, r) => { acc[r.serviceType] = (acc[r.serviceType] || 0) + 1; return acc; }, {} as Record<string, number>);
    const byStatus = requests.reduce((acc, r) => { acc[r.status] = (acc[r.status] || 0) + 1; return acc; }, {} as Record<string, number>);
    const completed = requests.filter((r) => r.status === "COMPLETED" || r.status === "INVOICED");
    const totalRevenue = completed.reduce((s, r) => s + (r.quoteCents || 0), 0);
    res.json({ period: { startDate, endDate }, requestCount: requests.length, byType, byStatus, completedCount: completed.length, totalRevenueCents: totalRevenue });
  } catch (err) { next(err); }
});

// ─── GET /reports/shift-reconciliation ────────────────────────────────────────

router.get("/shift-reconciliation", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = (req as any).tenantId;
    const { startDate, endDate } = dateFilters(req);
    const shifts = await prisma.shift.findMany({ where: { tenantId, openedAt: { gte: startDate, lte: endDate } }, orderBy: { openedAt: "desc" } });
    const summary = shifts.map((s) => ({ id: s.id, cashierId: s.cashierId, openedAt: s.openedAt, closedAt: s.closedAt, openingFloatCents: s.openingFloatCents, closingCashCents: s.closingCashCents, tipTotalCents: s.tipTotalCents, status: s.status }));
    res.json({ period: { startDate, endDate }, shiftCount: shifts.length, shifts: summary });
  } catch (err) { next(err); }
});

// ─── GET /reports/tips ────────────────────────────────────────────────────────

router.get("/tips", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = (req as any).tenantId;
    const { startDate, endDate } = dateFilters(req);
    const transactions = await prisma.posTransaction.findMany({ where: { tenantId, createdAt: { gte: startDate, lte: endDate }, tipCents: { gt: 0 } }, include: { shift: true } });
    const totalTips = transactions.reduce((s, t) => s + t.tipCents, 0);
    const byCashier = transactions.reduce((acc, t) => { const key = t.cashierId; acc[key] = (acc[key] || 0) + t.tipCents; return acc; }, {} as Record<string, number>);
    res.json({ period: { startDate, endDate }, totalTipsCents: totalTips, transactionsWithTips: transactions.length, byCashier });
  } catch (err) { next(err); }
});

// ─── GET /reports/security-deposits ───────────────────────────────────────────

router.get("/security-deposits", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = (req as any).tenantId;
    const deposits = await prisma.securityDeposit.findMany({ where: { tenantId } });
    const held = deposits.filter((d) => d.status === "HELD");
    const released = deposits.filter((d) => d.status === "RELEASED");
    const applied = deposits.filter((d) => d.status === "APPLIED");
    res.json({ totalDeposits: deposits.length, heldCount: held.length, heldTotalCents: held.reduce((s, d) => s + d.amountCents, 0), releasedCount: released.length, releasedTotalCents: released.reduce((s, d) => s + d.amountCents, 0), appliedCount: applied.length, appliedTotalCents: applied.reduce((s, d) => s + d.amountCents, 0) });
  } catch (err) { next(err); }
});

// ─── GET /reports/chargebacks ─────────────────────────────────────────────────

router.get("/chargebacks", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = (req as any).tenantId;
    const chargebacks = await prisma.chargeback.findMany({ where: { tenantId } });
    const totalAmount = chargebacks.reduce((s, c) => s + c.amountCents, 0);
    const won = chargebacks.filter((c) => c.outcome === "WON").length;
    const lost = chargebacks.filter((c) => c.outcome === "LOST").length;
    const pending = chargebacks.filter((c) => !c.outcome).length;
    res.json({ totalChargebacks: chargebacks.length, totalAmountCents: totalAmount, won, lost, pending, winRate: (won + lost) > 0 ? (won / (won + lost) * 100).toFixed(1) : "0.0" });
  } catch (err) { next(err); }
});

// ─── GET /reports/announcements ───────────────────────────────────────────────

router.get("/announcements", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = (req as any).tenantId;
    const { startDate, endDate } = dateFilters(req);
    const announcements = await prisma.announcement.findMany({ where: { tenantId, sentAt: { gte: startDate, lte: endDate } } });
    const deliveries = await prisma.announcementDelivery.findMany({ where: { announcement: { tenantId, sentAt: { gte: startDate, lte: endDate } } } });
    const delivered = deliveries.filter((d) => d.status === "DELIVERED").length;
    const opened = deliveries.filter((d) => d.openedAt).length;
    res.json({ period: { startDate, endDate }, announcementsSent: announcements.length, totalDeliveries: deliveries.length, delivered, opened, openRate: deliveries.length > 0 ? (opened / deliveries.length * 100).toFixed(1) : "0.0" });
  } catch (err) { next(err); }
});

// ─── GET /reports/audit-summary ───────────────────────────────────────────────

router.get("/audit-summary", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = (req as any).tenantId;
    const { startDate, endDate } = dateFilters(req);
    const byAction = await prisma.auditLog.groupBy({ by: ["action"], where: { tenantId, createdAt: { gte: startDate, lte: endDate } }, _count: { id: true } });
    const byRecordType = await prisma.auditLog.groupBy({ by: ["recordType"], where: { tenantId, createdAt: { gte: startDate, lte: endDate } }, _count: { id: true } });
    const byUser = await prisma.auditLog.groupBy({ by: ["userId"], where: { tenantId, createdAt: { gte: startDate, lte: endDate } }, _count: { id: true } });
    const total = byAction.reduce((s, a) => s + a._count.id, 0);
    res.json({ period: { startDate, endDate }, totalActions: total, byAction: byAction.map((a) => ({ action: a.action, count: a._count.id })), byRecordType: byRecordType.map((r) => ({ recordType: r.recordType, count: r._count.id })), byUser: byUser.map((u) => ({ userId: u.userId, count: u._count.id })) });
  } catch (err) { next(err); }
});

// ─── GET /reports/referral-attribution ────────────────────────────────────────

router.get("/referral-attribution", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = (req as any).tenantId;
    const partners = await prisma.referralPartner.findMany({ where: { tenantId } });
    const byUtm = await prisma.lead.groupBy({ by: ["utmSource"], where: { tenantId, utmSource: { not: null } }, _count: { id: true } });
    const convertedByUtm = await prisma.lead.groupBy({ by: ["utmSource"], where: { tenantId, utmSource: { not: null }, stage: "WON" }, _count: { id: true } });
    res.json({ partners: partners.map((p) => ({ id: p.id, name: p.name, code: p.code, leadsCount: p.leadsCount, conversionsCount: p.conversionsCount })), byUtmSource: byUtm.map((u) => { const conv = convertedByUtm.find((c) => c.utmSource === u.utmSource); return { source: u.utmSource, leads: u._count.id, conversions: conv?._count.id ?? 0 }; }) });
  } catch (err) { next(err); }
});

// ─── GET /reports/insurance-compliance ────────────────────────────────────────

router.get("/insurance-compliance", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = (req as any).tenantId;
    const now = new Date();
    const records = await prisma.insuranceRecord.findMany({ where: { tenantId } });
    const byStatus = records.reduce((acc, r) => { acc[r.status] = (acc[r.status] || 0) + 1; return acc; }, {} as Record<string, number>);
    const expiringNext30 = records.filter((r) => r.expiryDate && new Date(r.expiryDate) > now && new Date(r.expiryDate) <= new Date(now.getTime() + 30 * 86400000)).length;
    const expired = records.filter((r) => r.expiryDate && new Date(r.expiryDate) < now).length;
    res.json({ totalRecords: records.length, byStatus, expiringNext30Days: expiringNext30, expired });
  } catch (err) { next(err); }
});

// ─── GET /reports/pnl ─────────────────────────────────────────────────────────

router.get("/pnl", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = (req as any).tenantId;
    const { startDate, endDate } = dateFilters(req);
    const revenue = await prisma.glEntry.aggregate({ where: { tenantId, postedAt: { gte: startDate, lte: endDate }, account: { type: "REVENUE" } }, _sum: { creditCents: true, debitCents: true } });
    const expenses = await prisma.glEntry.aggregate({ where: { tenantId, postedAt: { gte: startDate, lte: endDate }, account: { type: "EXPENSE" } }, _sum: { debitCents: true, creditCents: true } });
    const cogs = await prisma.glEntry.aggregate({ where: { tenantId, postedAt: { gte: startDate, lte: endDate }, account: { type: "COGS" } }, _sum: { debitCents: true, creditCents: true } });
    const totalRevenue = (revenue._sum.creditCents ?? 0) - (revenue._sum.debitCents ?? 0);
    const totalExpenses = (expenses._sum.debitCents ?? 0) - (expenses._sum.creditCents ?? 0);
    const totalCogs = (cogs._sum.debitCents ?? 0) - (cogs._sum.creditCents ?? 0);
    res.json({ period: { startDate, endDate }, revenueCents: totalRevenue, cogsCents: totalCogs, grossProfitCents: totalRevenue - totalCogs, expensesCents: totalExpenses, netIncomeCents: totalRevenue - totalCogs - totalExpenses });
  } catch (err) { next(err); }
});

// ─── GET /reports/balance-sheet ───────────────────────────────────────────────

router.get("/balance-sheet", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = (req as any).tenantId;
    const assets = await prisma.glEntry.aggregate({ where: { tenantId, account: { type: "ASSET" } }, _sum: { debitCents: true, creditCents: true } });
    const liabilities = await prisma.glEntry.aggregate({ where: { tenantId, account: { type: "LIABILITY" } }, _sum: { creditCents: true, debitCents: true } });
    const equity = await prisma.glEntry.aggregate({ where: { tenantId, account: { type: "EQUITY" } }, _sum: { creditCents: true, debitCents: true } });
    res.json({ totalAssetsCents: (assets._sum.debitCents ?? 0) - (assets._sum.creditCents ?? 0), totalLiabilitiesCents: (liabilities._sum.creditCents ?? 0) - (liabilities._sum.debitCents ?? 0), totalEquityCents: (equity._sum.creditCents ?? 0) - (equity._sum.debitCents ?? 0) });
  } catch (err) { next(err); }
});

// ─── GET /reports/trial-balance ───────────────────────────────────────────────

router.get("/trial-balance", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = (req as any).tenantId;
    const accounts = await prisma.glAccount.findMany({ where: { tenantId }, orderBy: { accountNumber: "asc" } });
    const entries = await prisma.glEntry.groupBy({ by: ["accountId"], where: { tenantId }, _sum: { debitCents: true, creditCents: true } });
    const result = accounts.map((a) => { const e = entries.find((en) => en.accountId === a.id); return { accountNumber: a.accountNumber, name: a.name, type: a.type, debitsCents: e?._sum.debitCents ?? 0, creditsCents: e?._sum.creditCents ?? 0 }; });
    const totalDebits = result.reduce((s, r) => s + r.debitsCents, 0);
    const totalCredits = result.reduce((s, r) => s + r.creditsCents, 0);
    res.json({ accounts: result, totalDebitsCents: totalDebits, totalCreditsCents: totalCredits, balanced: totalDebits === totalCredits });
  } catch (err) { next(err); }
});

// ─── GET /reports/cash-flow ───────────────────────────────────────────────────

router.get("/cash-flow", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = (req as any).tenantId;
    const { startDate, endDate } = dateFilters(req);
    const receipts = await prisma.payment.aggregate({ where: { tenantId, postedDate: { gte: startDate, lte: endDate }, status: "COMPLETED" }, _sum: { amountCents: true } });
    const refunds = await prisma.payment.aggregate({ where: { tenantId, postedDate: { gte: startDate, lte: endDate }, status: "REFUNDED" }, _sum: { amountCents: true } });
    res.json({ period: { startDate, endDate }, cashReceiptsCents: receipts._sum.amountCents ?? 0, refundsCents: refunds._sum.amountCents ?? 0, netCashFlowCents: (receipts._sum.amountCents ?? 0) - (refunds._sum.amountCents ?? 0) });
  } catch (err) { next(err); }
});

// ─── GET /reports/vacancy-history ─────────────────────────────────────────────

router.get("/vacancy-history", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = (req as any).tenantId;
    const slips = await prisma.slip.findMany({ where: { tenantId }, select: { id: true, slipNumber: true, dock: true, status: true } });
    const vacant = slips.filter((s) => s.status === "VACANT");
    res.json({ totalSlips: slips.length, currentlyVacant: vacant.length, vacancyRate: slips.length > 0 ? (vacant.length / slips.length * 100).toFixed(1) : "0.0", vacantSlips: vacant.map((s) => ({ id: s.id, number: s.slipNumber, dock: s.dock })) });
  } catch (err) { next(err); }
});

// ─── GET /reports/contract-expiry-calendar ────────────────────────────────────

router.get("/contract-expiry-calendar", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = (req as any).tenantId;
    const contracts = await prisma.slipContract.findMany({ where: { tenantId, status: { in: ["ACTIVE", "EXPIRING"] } }, select: { id: true, endDate: true, status: true, rateCents: true, customerId: true }, orderBy: { endDate: "asc" } });
    const byMonth = contracts.reduce((acc, c) => { const month = new Date(c.endDate).toISOString().slice(0, 7); if (!acc[month]) acc[month] = []; acc[month].push(c); return acc; }, {} as Record<string, typeof contracts>);
    res.json({ totalExpiring: contracts.length, byMonth: Object.entries(byMonth).map(([month, contracts]) => ({ month, count: contracts.length, totalRateCents: contracts.reduce((s, c) => s + c.rateCents, 0) })) });
  } catch (err) { next(err); }
});

// ─── GET /reports/rate-increase-impact ────────────────────────────────────────

router.get("/rate-increase-impact", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = (req as any).tenantId;
    const batches = await prisma.renewalBatch.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" } });
    res.json({ batches: batches.map((b) => ({ id: b.id, status: b.status, rateIncreaseType: b.rateIncreaseType, rateIncreaseValue: b.rateIncreaseValue, contractCount: b.contractCount, revenueDeltaCents: b.revenueDeltaCents, approvedBy: b.approvedBy, approvedAt: b.approvedAt })) });
  } catch (err) { next(err); }
});

// ─── GET /reports/customer-lifetime-value ─────────────────────────────────────

router.get("/customer-lifetime-value", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = (req as any).tenantId;
    const customers = await prisma.customer.findMany({ where: { tenantId, status: "ACTIVE" }, select: { id: true, firstName: true, lastName: true, createdAt: true } });
    const payments = await prisma.payment.groupBy({ by: ["customerId"], where: { tenantId, status: "COMPLETED" }, _sum: { amountCents: true }, _count: { id: true } });
    const result = customers.map((c) => { const p = payments.find((pay) => pay.customerId === c.id); const tenure = Math.ceil((Date.now() - new Date(c.createdAt).getTime()) / (30 * 86400000)); return { customerId: c.id, name: `${c.firstName} ${c.lastName}`, tenureMonths: tenure, totalPaidCents: p?._sum.amountCents ?? 0, paymentCount: p?._count.id ?? 0 }; });
    const avgLtv = result.length > 0 ? result.reduce((s, r) => s + r.totalPaidCents, 0) / result.length : 0;
    res.json({ customerCount: result.length, avgLifetimeValueCents: Math.round(avgLtv), topCustomers: result.sort((a, b) => b.totalPaidCents - a.totalPaidCents).slice(0, 20) });
  } catch (err) { next(err); }
});

// ─── GET /reports/dock-walk-violations ────────────────────────────────────────

router.get("/dock-walk-violations", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = (req as any).tenantId;
    const { startDate, endDate } = dateFilters(req);
    const violations = await prisma.dockWalkItem.findMany({ where: { dockWalk: { tenantId, startedAt: { gte: startDate, lte: endDate } }, violationType: { not: null } }, include: { dockWalk: { select: { startedAt: true } } } });
    const byType = violations.reduce((acc, v) => { const t = v.violationType || "Unknown"; acc[t] = (acc[t] || 0) + 1; return acc; }, {} as Record<string, number>);
    const bySlip = violations.reduce((acc, v) => { acc[v.slipId] = (acc[v.slipId] || 0) + 1; return acc; }, {} as Record<string, number>);
    const repeatOffenders = Object.entries(bySlip).filter(([, count]) => count > 1).sort(([, a], [, b]) => b - a);
    res.json({ period: { startDate, endDate }, totalViolations: violations.length, byType, repeatOffenders: repeatOffenders.map(([slipId, count]) => ({ slipId, violationCount: count })) });
  } catch (err) { next(err); }
});

export default router;
