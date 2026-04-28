import { Router, type Request, type Response, type NextFunction } from "express";
import { clerkAuth, requireRole } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";
import { queues } from "../lib/queue.js";
import { isValidScheduleFormat, buildAutopayCardExpirations } from "../services/report-data.js";

const router: Router = Router();

router.use(...clerkAuth());
router.use(requireRole("MARINA_OWNER", "TENANT_ADMIN", "MARINA_MANAGER", "ACCOUNTING"));

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

/**
 * Returns a Prisma locationId filter for a report query.
 *
 * - If user is location-restricted, intersect the requested locationId (if any)
 *   with the user's allowed list. Returns 403-style sentinel if access denied.
 * - For bypass roles, honors the query param if provided, otherwise no filter.
 */
function locationFilter(req: Request): { ok: true; filter: Record<string, unknown> } | { ok: false; status: number; body: { error: string; code: string } } {
  const requested = (req.query.locationId as string | undefined)?.trim() || undefined;
  const allowed = req.allowedLocationIds; // null = bypass

  if (requested) {
    if (allowed !== null && allowed !== undefined && !allowed.includes(requested)) {
      return { ok: false, status: 403, body: { error: "Forbidden for this location", code: "LOCATION_FORBIDDEN" } };
    }
    return { ok: true, filter: { locationId: requested } };
  }

  if (allowed !== null && allowed !== undefined) {
    return { ok: true, filter: { OR: [{ locationId: null }, { locationId: { in: allowed } }] } };
  }

  return { ok: true, filter: {} };
}

// ─── GET /reports/occupancy ───────────────────────────────────────────────────

router.get("/occupancy", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = (req as any).tenantId;
    const lf = locationFilter(req);
    if (!lf.ok) { res.status(lf.status).json(lf.body); return; }
    const baseWhere = { tenantId, ...lf.filter };

    const total = await prisma.slip.count({ where: baseWhere });
    const occupied = await prisma.slip.count({ where: { ...baseWhere, status: "OCCUPIED" } });
    const vacant = await prisma.slip.count({ where: { ...baseWhere, status: "VACANT" } });
    const maintenance = await prisma.slip.count({ where: { ...baseWhere, status: "MAINTENANCE" } });
    const reserved = await prisma.slip.count({ where: { ...baseWhere, status: "RESERVED" } });

    const byDock = await prisma.slip.groupBy({
      by: ["dockId"],
      where: baseWhere,
      _count: { id: true },
    });

    const occupiedByDock = await prisma.slip.groupBy({
      by: ["dockId"],
      where: { ...baseWhere, status: "OCCUPIED" },
      _count: { id: true },
    });

    const maintenanceByDock = await prisma.slip.groupBy({
      by: ["dockId"],
      where: { ...baseWhere, status: "MAINTENANCE" },
      _count: { id: true },
    });

    const docks = byDock.map((d) => {
      const occ = occupiedByDock.find((o) => o.dockId === d.dockId);
      const maint = maintenanceByDock.find((m) => m.dockId === d.dockId);
      const occupiedCount = occ?._count.id ?? 0;
      const maintCount = maint?._count.id ?? 0;
      return {
        dock: d.dockId,
        total: d._count.id,
        occupied: occupiedCount,
        maintenance: maintCount,
        vacant: Math.max(0, d._count.id - occupiedCount - maintCount),
        rate: d._count.id > 0 ? ((occupiedCount / d._count.id) * 100).toFixed(1) : "0.0",
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
    const lf = locationFilter(req);
    if (!lf.ok) { res.status(lf.status).json(lf.body); return; }
    const locFilter = lf.filter;

    const payments = await prisma.payment.aggregate({
      where: { tenantId, postedDate: { gte: startDate, lte: endDate }, status: "COMPLETED" },
      _sum: { amountCents: true },
      _count: { id: true },
    });

    const invoices = await prisma.invoice.aggregate({
      where: { tenantId, issuedDate: { gte: startDate, lte: endDate }, ...locFilter },
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
    const lf = locationFilter(req);
    if (!lf.ok) { res.status(lf.status).json(lf.body); return; }

    const transactions = await prisma.posTransaction.aggregate({
      where: { tenantId, createdAt: { gte: startDate, lte: endDate }, status: "COMPLETED" },
      _sum: { subtotalCents: true, taxCents: true, tipCents: true, totalCents: true },
      _count: { id: true },
    });

    const shifts = await prisma.shift.findMany({
      where: { tenantId, openedAt: { gte: startDate, lte: endDate }, ...lf.filter },
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
        costCents: p.costCents ?? 0, priceCents: p.priceCents,
        qtyOnHand: inv?.qtyOnHand ?? 0, qtyOnOrder: inv?.qtyOnOrder ?? 0,
        reorderQty: p.reorderQty ?? 0,
        valueCents: (inv?.qtyOnHand ?? 0) * (p.costCents ?? 0),
        needsReorder: (inv?.qtyOnHand ?? 0) <= (p.reorderQty ?? 0),
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
    const avgStay = bookings.length > 0 ? bookings.reduce((s, b) => { const nights = Math.ceil((new Date(b.checkOut ?? b.checkIn).getTime() - new Date(b.checkIn).getTime()) / 86400000); return s + nights; }, 0) / bookings.length : 0;
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
    const avgNps = responded.length > 0 ? responded.reduce((s, r) => s + (r.score ?? 0), 0) / responded.length : 0;
    const promoters = responded.filter((s) => (s.score ?? 0) >= 9).length;
    const detractors = responded.filter((s) => (s.score ?? 0) <= 6).length;
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
    const fuelSales = await prisma.posLineItem.findMany({ where: { transaction: { tenantId, createdAt: { gte: startDate, lte: endDate } }, product: { departmentId: { not: null } } }, include: { product: true } });
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
    const lf = locationFilter(req);
    if (!lf.ok) { res.status(lf.status).json(lf.body); return; }
    const shifts = await prisma.shift.findMany({ where: { tenantId, openedAt: { gte: startDate, lte: endDate }, ...lf.filter }, orderBy: { openedAt: "desc" } });
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
    const byCashier = transactions.reduce((acc, t) => { const key = t.cashierId ?? "unknown"; acc[key] = (acc[key] || 0) + t.tipCents; return acc; }, {} as Record<string, number>);
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
    const cogs = await prisma.glEntry.aggregate({ where: { tenantId, postedAt: { gte: startDate, lte: endDate }, account: { type: "EXPENSE" } }, _sum: { debitCents: true, creditCents: true } });
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
    const slips = await prisma.slip.findMany({ where: { tenantId }, select: { id: true, slipNumber: true, dockId: true, status: true } });
    const vacant = slips.filter((s) => s.status === "VACANT");
    res.json({ totalSlips: slips.length, currentlyVacant: vacant.length, vacancyRate: slips.length > 0 ? (vacant.length / slips.length * 100).toFixed(1) : "0.0", vacantSlips: vacant.map((s) => ({ id: s.id, number: s.slipNumber, dock: s.dockId })) });
  } catch (err) { next(err); }
});

// ─── GET /reports/contract-expiry-calendar ────────────────────────────────────

router.get("/contract-expiry-calendar", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = (req as any).tenantId;
    const contracts = await prisma.slipContract.findMany({ where: { tenantId, status: { in: ["ACTIVE", "EXPIRING"] } }, select: { id: true, endDate: true, status: true, rateCents: true, customerId: true }, orderBy: { endDate: "asc" } });
    const byMonth = contracts.reduce((acc, c) => { const month = c.endDate ? new Date(c.endDate).toISOString().slice(0, 7) : "unknown"; if (!acc[month]) acc[month] = []; acc[month].push(c); return acc; }, {} as Record<string, any[]>);
    res.json({ totalExpiring: contracts.length, byMonth: Object.entries(byMonth).map(([month, contracts]) => ({ month, count: contracts.length, totalRateCents: contracts.reduce((s: number, c: any): number => s + (c.rateCents as number), 0) })) });
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
    const bySlip = violations.reduce((acc, v) => { const key = v.slipId ?? "unknown"; acc[key] = (acc[key] || 0) + 1; return acc; }, {} as Record<string, number>);
    const repeatOffenders = Object.entries(bySlip).filter(([, count]) => count > 1).sort(([, a], [, b]) => b - a);
    res.json({ period: { startDate, endDate }, totalViolations: violations.length, byType, repeatOffenders: repeatOffenders.map(([slipId, count]) => ({ slipId, violationCount: count })) });
  } catch (err) { next(err); }
});

// ─── GET /reports/rent-roll ──────────────────────────────────────────────────

router.get("/rent-roll", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = (req as any).tenantId;
    const asOfDate = req.query.asOfDate ? new Date(req.query.asOfDate as string) : new Date();
    const now = asOfDate;

    // Fetch all slips with active/expiring contracts
    const slips = await prisma.slip.findMany({
      where: { tenantId },
      include: {
        contracts: {
          where: {
            OR: [
              { status: "ACTIVE" },
              { status: "EXPIRING" },
            ],
          },
          include: {
            customer: true,
            boat: true,
          },
          orderBy: { startDate: "desc" },
          take: 1,
        },
      },
      orderBy: [{ dockId: "asc" }, { slipNumber: "asc" }],
    });

    const rows = [];
    let totalMonthlyRentCents = 0;
    let totalAnnualRentCents = 0;
    let totalDepositsCents = 0;
    let totalBalanceCents = 0;
    let vacantCount = 0;
    let expiringNext30 = 0;

    for (const slip of slips) {
      const contract = slip.contracts[0];

      if (!contract) {
        vacantCount++;
        rows.push({
          slipId: slip.id,
          slipNumber: slip.slipNumber,
          dock: slip.dockId,
          tenant: null,
          boatName: null,
          boatLength: null,
          contractStart: null,
          contractEnd: null,
          billingCycle: null,
          monthlyRateCents: 0,
          annualRateCents: 0,
          electricityMode: null,
          electricityChargeCents: 0,
          securityDepositCents: 0,
          contractStatus: "VACANT",
          autoRenew: false,
          daysUntilExpiration: null,
          lastPaymentDate: null,
          lastPaymentAmountCents: 0,
          outstandingBalanceCents: 0,
        });
        continue;
      }

      // Calculate annualized rate from billing cycle
      let monthlyRateCents = contract.rateCents || 0;
      let annualRateCents = 0;
      const cycle = contract.billingCycle || "MONTHLY";

      if (cycle === "MONTHLY") {
        annualRateCents = monthlyRateCents * 12;
      } else if (cycle === "QUARTERLY") {
        annualRateCents = monthlyRateCents * 4;
        monthlyRateCents = Math.round(annualRateCents / 12);
      } else if (cycle === "ANNUAL" || cycle === "SEMI_ANNUAL") {
        annualRateCents = monthlyRateCents;
        monthlyRateCents = Math.round(annualRateCents / 12);
      }

      // Days until expiration
      const endDate = contract.endDate ? new Date(contract.endDate) : null;
      const daysUntilExpiration = endDate ? Math.ceil((endDate.getTime() - now.getTime()) / 86400000) : null;
      if (daysUntilExpiration !== null && daysUntilExpiration <= 30 && daysUntilExpiration >= 0) {
        expiringNext30++;
      }

      // Electricity charges — latest meter reading or flat fee
      let electricityMode: string | null = null;
      let electricityChargeCents = 0;
      try {
        const meterReading = await prisma.meterReading.findFirst({
          where: { tenantId, slipId: slip.id },
          orderBy: { readingDate: "desc" },
        });
        if (meterReading) {
          electricityMode = meterReading.isEstimated ? "flat" : "metered";
          electricityChargeCents = meterReading.amountCents;
        }
      } catch { /* meter readings may not exist */ }

      // Security deposit
      let securityDepositCents = 0;
      try {
        const deposit = await prisma.securityDeposit.findFirst({
          where: { tenantId, contractId: contract.id, status: "HELD" },
        });
        if (deposit) securityDepositCents = deposit.amountCents;
      } catch { /* deposits may not exist */ }

      // Last payment
      let lastPaymentDate: Date | null = null;
      let lastPaymentAmountCents = 0;
      try {
        const lastPayment = await prisma.payment.findFirst({
          where: { tenantId, customerId: contract.customerId, status: "COMPLETED" },
          orderBy: { postedDate: "desc" },
        });
        if (lastPayment) {
          lastPaymentDate = lastPayment.postedDate;
          lastPaymentAmountCents = lastPayment.amountCents;
        }
      } catch { /* payments may not exist */ }

      // Outstanding balance
      let outstandingBalanceCents = 0;
      try {
        const openInvoices = await prisma.invoice.aggregate({
          where: { tenantId, customerId: contract.customerId, status: { in: ["ISSUED", "PAST_DUE"] } },
          _sum: { totalCents: true },
        });
        outstandingBalanceCents = openInvoices._sum.totalCents ?? 0;
      } catch { /* invoices may not exist */ }

      totalMonthlyRentCents += monthlyRateCents;
      totalAnnualRentCents += annualRateCents;
      totalDepositsCents += securityDepositCents;
      totalBalanceCents += outstandingBalanceCents;

      rows.push({
        slipId: slip.id,
        slipNumber: slip.slipNumber,
        dock: slip.dockId,
        tenant: contract.customer ? `${contract.customer.firstName} ${contract.customer.lastName}` : null,
        boatName: contract.boat?.name || null,
        boatLength: contract.boat?.lengthFt || null,
        contractStart: contract.startDate,
        contractEnd: contract.endDate,
        billingCycle: cycle,
        monthlyRateCents,
        annualRateCents,
        electricityMode,
        electricityChargeCents,
        securityDepositCents,
        contractStatus: contract.status,
        autoRenew: contract.autoRenew ?? false,
        daysUntilExpiration,
        lastPaymentDate,
        lastPaymentAmountCents,
        outstandingBalanceCents,
      });
    }

    res.json({
      asOfDate: now,
      summary: {
        totalMonthlyRentCents,
        totalAnnualRentCents,
        totalDepositsCents,
        totalBalanceCents,
        totalSlips: slips.length,
        occupiedSlips: slips.length - vacantCount,
        vacantSlips: vacantCount,
        occupancyRate: slips.length > 0 ? ((slips.length - vacantCount) / slips.length * 100).toFixed(1) : "0.0",
        expiringNext30Days: expiringNext30,
      },
      rows,
    });
  } catch (err) { next(err); }
});

// ─── GET /reports/sales-tax ───────────────────────────────────────────────────
//
// Aggregates InvoiceLineItemTax rows (with jurisdiction info) for the given
// date range.  Results are grouped by jurisdiction and include a grand-total
// row for easy export.
//
// Query params: startDate, endDate (ISO 8601 date strings, inclusive)

router.get("/sales-tax", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = (req as any).tenantId;
    const { startDate, endDate } = dateFilters(req);

    // Pull all InvoiceLineItemTax rows for the period, joined via lineItem →
    // invoice to filter by issuedDate.
    const taxRows = await prisma.invoiceLineItemTax.findMany({
      where: {
        tenantId,
        lineItem: {
          invoice: {
            issuedDate: { gte: startDate, lte: endDate },
            status: { not: "VOID" },
          },
        },
      },
      include: {
        jurisdiction: { select: { id: true, code: true, name: true, kind: true } },
        lineItem: {
          select: {
            invoice: {
              select: { id: true, invoiceNumber: true, issuedDate: true },
            },
          },
        },
      },
    });

    // Group by jurisdiction
    type JurisdictionSummary = {
      jurisdictionId: string;
      code: string;
      name: string;
      kind: string;
      invoiceCount: number;
      taxableCents: number;
      taxCents: number;
    };

    const byJurisdiction = new Map<string, JurisdictionSummary>();
    const invoiceIds = new Set<string>();

    for (const row of taxRows) {
      const key = row.jurisdictionId;
      invoiceIds.add(row.lineItem.invoice.id);

      const existing = byJurisdiction.get(key);
      if (existing) {
        existing.taxableCents += row.taxableCents;
        existing.taxCents += row.taxCents;
        existing.invoiceCount += 1;
      } else {
        byJurisdiction.set(key, {
          jurisdictionId: row.jurisdictionId,
          code: row.jurisdiction.code,
          name: row.jurisdiction.name,
          kind: row.jurisdiction.kind,
          invoiceCount: 1,
          taxableCents: row.taxableCents,
          taxCents: row.taxCents,
        });
      }
    }

    const jurisdictions = Array.from(byJurisdiction.values()).sort(
      (a, b) => a.kind.localeCompare(b.kind) || a.code.localeCompare(b.code),
    );

    const totalTaxableCents = jurisdictions.reduce((s, j) => s + j.taxableCents, 0);
    const totalTaxCents = jurisdictions.reduce((s, j) => s + j.taxCents, 0);

    res.json({
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      totalInvoices: invoiceIds.size,
      totalTaxableCents,
      totalTaxCents,
      jurisdictions,
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /reports/generate — stub endpoint used by the Reports UI ────────────
// Accepts a reportId + options, returns a minimal success envelope so the UI
// can display a toast.  The actual data is fetched separately via the
// GET /reports/<reportId> endpoints (consumed by the in-app viewer).

const REPORT_ID_MAP: Record<string, string> = {
  revenue: "revenue",
  aging: "ar-aging",
  collections: "collections",
  deferred: "deferred-revenue",
  gl: "gl-summary",
  occupancy: "occupancy",
  utilization: "rental-utilization",
  dockwalk: "dock-walk-summary",
  customer_activity: "customer-activity",
  leads: "lead-conversion",
  waitlist: "waitlist",
  rent_roll: "occupancy",
  rental_util: "rental-utilization",
  pos_sales: "pos-sales",
  inventory: "inventory",
  maintenance: "dock-walk-summary",
  autopay_card_expirations: "autopay-card-expirations",
};

router.post(
  "/generate",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { reportId, format = "PDF", dateFrom, dateTo } = req.body as {
        reportId?: string;
        format?: string;
        dateFrom?: string;
        dateTo?: string;
      };

      if (!reportId) {
        res.status(400).json({ error: "reportId is required" });
        return;
      }

      const mappedId = REPORT_ID_MAP[reportId] ?? reportId;

      res.json({
        success: true,
        reportId,
        mappedEndpoint: `/api/reports/${mappedId}`,
        format,
        dateFrom: dateFrom ?? null,
        dateTo: dateTo ?? null,
        generatedAt: new Date().toISOString(),
        message: `${reportId} report queued for generation`,
      });
    } catch (err) {
      next(err);
    }
  },
);

// ─── GET /reports/autopay-card-expirations ───────────────────────────────────
//
// Returns the list of autopay-enabled customers whose default card is
// expiring soon (or already expired / missing). Heavy lifting lives in
// services/report-data.buildAutopayCardExpirations so the same dataset can
// be served live and exported by the scheduled-report worker.

router.get("/autopay-card-expirations", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = (req as any).tenantId;
    const requested = (req.query.locationId as string | undefined)?.trim() || undefined;
    const allowed = req.allowedLocationIds; // null = bypass (unrestricted)

    let allowedLocationIds: string[] | null;
    if (requested) {
      if (allowed !== null && allowed !== undefined && !allowed.includes(requested)) {
        res.status(403).json({ error: "Forbidden for this location", code: "LOCATION_FORBIDDEN" });
        return;
      }
      allowedLocationIds = [requested];
    } else if (allowed !== null && allowed !== undefined) {
      allowedLocationIds = allowed;
    } else {
      allowedLocationIds = null;
    }

    const data = await buildAutopayCardExpirations(tenantId, { allowedLocationIds });
    res.json(data);
  } catch (err) { next(err); }
});

// ─── GET /reports/revenue-trend ──────────────────────────────────────────────

router.get("/revenue-trend", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = (req as any).tenantId;
    const months = Math.min(parseInt((req.query.months as string) || "6", 10) || 6, 24);
    const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

    const now = new Date();
    const results: { month: string; year: number; totalCents: number }[] = [];

    for (let i = months - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const start = new Date(d.getFullYear(), d.getMonth(), 1);
      const end = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);

      const agg = await prisma.payment.aggregate({
        where: { tenantId, status: "COMPLETED", postedDate: { gte: start, lte: end } },
        _sum: { amountCents: true },
      });

      results.push({
        month: MONTH_LABELS[d.getMonth()],
        year: d.getFullYear(),
        totalCents: agg._sum.amountCents ?? 0,
      });
    }

    res.json({ months: results });
  } catch (err) { next(err); }
});

// ─── Helpers for schedule next run / cron ────────────────────────────────────

function cronForFrequency(frequency: string): string {
  if (frequency === "Daily") return "0 7 * * *";
  if (frequency === "Weekly") return "0 7 * * 1";  // Mondays 07:00 UTC
  if (frequency === "Monthly") return "0 7 1 * *";  // 1st of month 07:00 UTC
  throw new Error(`Unknown frequency: ${frequency}`);
}

function calcNextRun(frequency: string): Date {
  const now = new Date();
  if (frequency === "Daily") {
    const next = new Date(now);
    next.setUTCDate(next.getUTCDate() + 1);
    next.setUTCHours(7, 0, 0, 0);
    return next;
  }
  if (frequency === "Weekly") {
    const next = new Date(now);
    const daysUntilMonday = (8 - next.getUTCDay()) % 7 || 7;
    next.setUTCDate(next.getUTCDate() + daysUntilMonday);
    next.setUTCHours(7, 0, 0, 0);
    return next;
  }
  // Monthly — first of next month at 07:00 UTC
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 7, 0, 0, 0));
  return next;
}

// ─── GET /reports/schedules ──────────────────────────────────────────────────

router.get("/schedules", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = (req as any).tenantId;
    const schedules = await prisma.scheduledReport.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
    });
    res.json(schedules.map((s) => ({
      ...s,
      recipients: s.recipients.split(",").map((r: string) => r.trim()).filter(Boolean),
    })));
  } catch (err) { next(err); }
});

// ─── POST /reports/schedule ──────────────────────────────────────────────────

router.post("/schedule", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = (req as any).tenantId;
    const { reportId, reportName, frequency, recipients, format } = req.body as {
      reportId?: string;
      reportName?: string;
      frequency?: string;
      recipients?: string[];
      format?: string;
    };

    if (!reportId || !reportName || !frequency || !recipients || recipients.length === 0) {
      res.status(400).json({ error: "reportId, reportName, frequency, and recipients are required" });
      return;
    }
    const validFreqs = ["Daily", "Weekly", "Monthly"];
    if (!validFreqs.includes(frequency)) {
      res.status(400).json({ error: "frequency must be Daily, Weekly, or Monthly" });
      return;
    }
    const resolvedFormat = format ?? "CSV";
    if (!isValidScheduleFormat(resolvedFormat)) {
      res.status(400).json({ error: "format must be CSV or JSON for scheduled delivery" });
      return;
    }
    // Validate email addresses
    const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const invalidEmails = recipients.filter((r) => !EMAIL_RE.test(r));
    if (invalidEmails.length > 0) {
      res.status(400).json({ error: `Invalid email address(es): ${invalidEmails.join(", ")}` });
      return;
    }

    const nextRun = calcNextRun(frequency);
    const schedule = await prisma.scheduledReport.create({
      data: {
        tenantId,
        reportId,
        reportName,
        frequency,
        format: resolvedFormat,
        recipients: recipients.join(", "),
        status: "Active",
        nextRun,
      },
    });

    // Register a BullMQ repeatable job scheduler keyed by schedule.id.
    // Compensate by deleting the DB row if queue registration fails.
    try {
      await queues["report-scheduler"].upsertJobScheduler(
        schedule.id,
        { pattern: cronForFrequency(frequency) },
        { name: "send-scheduled-report", data: { scheduleId: schedule.id, tenantId } },
      );
    } catch (queueErr) {
      await prisma.scheduledReport.delete({ where: { id: schedule.id } }).catch(() => {});
      throw queueErr;
    }

    res.status(201).json({
      ...schedule,
      recipients: schedule.recipients.split(",").map((r: string) => r.trim()).filter(Boolean),
    });
  } catch (err) { next(err); }
});

// ─── PUT /reports/schedules/:id ──────────────────────────────────────────────

router.put("/schedules/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = (req as any).tenantId;
    const { id } = req.params;
    const { status, frequency, format, recipients } = req.body as {
      status?: string;
      frequency?: string;
      format?: string;
      recipients?: string[];
    };

    const existing = await prisma.scheduledReport.findFirst({ where: { id, tenantId } });
    if (!existing) {
      res.status(404).json({ error: "Schedule not found" });
      return;
    }

    if (status !== undefined && !["Active", "Paused"].includes(status)) {
      res.status(400).json({ error: "status must be Active or Paused" });
      return;
    }

    if (frequency !== undefined && !["Daily", "Weekly", "Monthly"].includes(frequency)) {
      res.status(400).json({ error: "frequency must be Daily, Weekly, or Monthly" });
      return;
    }

    if (format !== undefined && !isValidScheduleFormat(format)) {
      res.status(400).json({ error: "format must be CSV or JSON for scheduled delivery" });
      return;
    }

    if (recipients !== undefined) {
      const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      const emails = Array.isArray(recipients) ? recipients : [];
      const invalidEmails = emails.filter((r) => !EMAIL_RE.test(r));
      if (invalidEmails.length > 0) {
        res.status(400).json({ error: `Invalid email address(es): ${invalidEmails.join(", ")}` });
        return;
      }
      if (emails.length === 0) {
        res.status(400).json({ error: "At least one recipient email is required" });
        return;
      }
    }

    const newStatus = status ?? existing.status;
    const newFrequency = (frequency ?? existing.frequency) as "Daily" | "Weekly" | "Monthly";
    const frequencyChanged = frequency !== undefined && frequency !== existing.frequency;
    const wasResumed = existing.status === "Paused" && newStatus === "Active";

    // Recalculate nextRun when frequency changes or schedule is resumed
    const nextRun =
      frequencyChanged || wasResumed ? calcNextRun(newFrequency) : existing.nextRun;

    const updateData: Record<string, unknown> = {
      status: newStatus,
      frequency: newFrequency,
      nextRun,
    };

    if (format !== undefined) updateData.format = format;
    if (recipients !== undefined) {
      updateData.recipients = Array.isArray(recipients)
        ? recipients.join(",")
        : String(recipients);
    }

    const updated = await prisma.scheduledReport.update({
      where: { id },
      data: updateData,
    });

    // Pause: remove the BullMQ scheduler entirely (no jobs will fire while paused).
    // Resume or frequency change on active schedule: upsert a fresh scheduler.
    // Compensate by reverting the DB update if the queue operation fails.
    try {
      if (newStatus === "Paused") {
        await queues["report-scheduler"].removeJobScheduler(id);
      } else if (wasResumed || (frequencyChanged && newStatus === "Active")) {
        await queues["report-scheduler"].upsertJobScheduler(
          id,
          { pattern: cronForFrequency(newFrequency) },
          { name: "send-scheduled-report", data: { scheduleId: id, tenantId } },
        );
      }
    } catch (queueErr) {
      await prisma.scheduledReport.update({
        where: { id },
        data: {
          status: existing.status,
          frequency: existing.frequency,
          format: existing.format,
          recipients: existing.recipients,
          nextRun: existing.nextRun,
        },
      }).catch(() => {});
      throw queueErr;
    }

    res.json({
      ...updated,
      recipients: updated.recipients.split(",").map((r: string) => r.trim()).filter(Boolean),
    });
  } catch (err) { next(err); }
});

// ─── DELETE /reports/schedules/:id ───────────────────────────────────────────

router.delete("/schedules/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = (req as any).tenantId;
    const { id } = req.params;

    const existing = await prisma.scheduledReport.findFirst({ where: { id, tenantId } });
    if (!existing) {
      res.status(404).json({ error: "Schedule not found" });
      return;
    }

    // Cancel the BullMQ scheduler before deleting the DB record.
    await queues["report-scheduler"].removeJobScheduler(id);
    await prisma.scheduledReport.delete({ where: { id } });
    res.status(204).send();
  } catch (err) { next(err); }
});

export default router;

