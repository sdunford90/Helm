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
  // Date-only inputs (YYYY-MM-DD) parse as midnight UTC. For endDate that
  // produces a half-open window that *excludes* same-day activity (e.g. a
  // payment posted at 11:18 on the end date is missed → reports show 0%
  // collection rate even though the invoice was paid). Bump date-only
  // endDates to end-of-day so the upper bound is inclusive of the full day.
  let endDate: Date;
  if (req.query.endDate) {
    const raw = req.query.endDate as string;
    endDate = new Date(raw);
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      endDate = new Date(`${raw}T23:59:59.999Z`);
    }
  } else {
    endDate = new Date();
  }
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

// ─── GET /reports/card-expiry-forecast (W3) ────────────────────────────────
//
// Customers whose saved cards expire within the next N months (default 6),
// grouped by expiry month so an operator can ring through each cohort.
// Reads from CardExpiryReminder rows that are populated by the daily sweep
// — accurate as of the last sweep run.
router.get("/card-expiry-forecast", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = (req as any).tenantId;
    const within = Math.min(24, Math.max(1, parseInt(req.query.within as string) || 6));

    const now = new Date();
    const curYear = now.getFullYear();
    const curMonth = now.getMonth() + 1;
    const endTotal = curYear * 12 + (curMonth - 1) + within;
    const endYear = Math.floor(endTotal / 12);
    const endMonth = (endTotal % 12) + 1;

    const rows = await prisma.cardExpiryReminder.findMany({
      where: {
        tenantId,
        OR: [
          { expYear: { gt: curYear } },
          { expYear: curYear, expMonth: { gte: curMonth } },
        ],
        AND: [{
          OR: [
            { expYear: { lt: endYear } },
            { expYear: endYear, expMonth: { lte: endMonth } },
          ],
        }],
      },
      select: { customerId: true, brand: true, last4: true, expMonth: true, expYear: true },
    });

    const customerIds = Array.from(new Set(rows.map((r) => r.customerId)));
    const customers = customerIds.length > 0
      ? await prisma.customer.findMany({
          where: { id: { in: customerIds }, tenantId },
          select: { id: true, firstName: true, lastName: true, company: true, email: true, phone: true },
        })
      : [];
    const custById = new Map(customers.map((c) => [c.id, c]));

    // Deduplicate by (customerId, brand, last4, expMonth, expYear) — the
    // reminders table can hold multiple SENT rows per card across the
    // 60d/30d/0d windows.
    const seen = new Set<string>();
    const items: Array<{
      customerId: string; customerName: string;
      email: string | null; phone: string | null;
      brand: string | null; last4: string | null;
      expMonth: number; expYear: number; expiryLabel: string;
    }> = [];
    for (const r of rows) {
      const key = `${r.customerId}:${r.brand ?? ''}:${r.last4 ?? ''}:${r.expMonth}:${r.expYear}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const c = custById.get(r.customerId);
      const customerName = c
        ? [c.firstName, c.lastName].filter(Boolean).join(" ") || c.company || c.email || c.id.slice(0, 8)
        : r.customerId.slice(0, 8);
      items.push({
        customerId: r.customerId,
        customerName,
        email: c?.email ?? null,
        phone: c?.phone ?? null,
        brand: r.brand,
        last4: r.last4,
        expMonth: r.expMonth,
        expYear: r.expYear,
        expiryLabel: `${String(r.expMonth).padStart(2, "0")}/${r.expYear}`,
      });
    }
    items.sort((a, b) => (a.expYear - b.expYear) || (a.expMonth - b.expMonth));

    const buckets = new Map<string, number>();
    for (const it of items) buckets.set(it.expiryLabel, (buckets.get(it.expiryLabel) ?? 0) + 1);
    const summary = Array.from(buckets.entries())
      .map(([month, count]) => ({ month, count }))
      .sort((a, b) => a.month.localeCompare(b.month));

    res.json({ within, totalCards: items.length, summary, items });
  } catch (err) { next(err); }
});

// ─── GET /reports/pnl ─────────────────────────────────────────────────────────
//
// Income statement for the window. Sums GL postings on REVENUE and EXPENSE
// accounts; revenue accounts net = credits - debits, expense net =
// debits - credits.
router.get("/pnl", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = (req as any).tenantId;
    const { startDate, endDate } = dateFilters(req);

    const accounts = await prisma.glAccount.findMany({
      where: { tenantId, type: { in: ["REVENUE", "EXPENSE"] }, isActive: true },
      orderBy: { accountNumber: "asc" },
    });
    const sums = accounts.length === 0 ? [] : await prisma.glEntry.groupBy({
      by: ["accountId"],
      where: {
        tenantId,
        entryDate: { gte: startDate, lte: endDate },
        accountId: { in: accounts.map((a) => a.id) },
      },
      _sum: { debitCents: true, creditCents: true },
    });
    const sumMap = new Map(sums.map((s) => [s.accountId, s]));

    const revenue: any[] = [];
    const expense: any[] = [];
    let revenueTotal = 0;
    let expenseTotal = 0;
    for (const a of accounts) {
      const s = sumMap.get(a.id);
      const debits = s?._sum.debitCents ?? 0;
      const credits = s?._sum.creditCents ?? 0;
      const row = {
        accountNumber: a.accountNumber,
        name: a.name,
        type: a.type,
        debitsCents: debits,
        creditsCents: credits,
        netCents: a.type === "REVENUE" ? credits - debits : debits - credits,
      };
      if (a.type === "REVENUE") { revenue.push(row); revenueTotal += row.netCents; }
      else { expense.push(row); expenseTotal += row.netCents; }
    }

    res.json({
      period: { startDate, endDate },
      revenue,
      revenueTotalCents: revenueTotal,
      expense,
      expenseTotalCents: expenseTotal,
      netIncomeCents: revenueTotal - expenseTotal,
    });
  } catch (err) { next(err); }
});

// ─── GET /reports/balance-sheet ───────────────────────────────────────────────
//
// As-of-date balance sheet. Sums all postings up to and including endDate
// on ASSET, LIABILITY, and EQUITY accounts.
router.get("/balance-sheet", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = (req as any).tenantId;
    const { endDate } = dateFilters(req);

    const accounts = await prisma.glAccount.findMany({
      where: { tenantId, type: { in: ["ASSET", "LIABILITY", "EQUITY"] }, isActive: true },
      orderBy: { accountNumber: "asc" },
    });
    const sums = accounts.length === 0 ? [] : await prisma.glEntry.groupBy({
      by: ["accountId"],
      where: { tenantId, entryDate: { lte: endDate }, accountId: { in: accounts.map((a) => a.id) } },
      _sum: { debitCents: true, creditCents: true },
    });
    const sumMap = new Map(sums.map((s) => [s.accountId, s]));

    const assets: any[] = [];
    const liabilities: any[] = [];
    const equity: any[] = [];
    let assetsTotal = 0;
    let liabilitiesTotal = 0;
    let equityTotal = 0;
    for (const a of accounts) {
      const s = sumMap.get(a.id);
      const debits = s?._sum.debitCents ?? 0;
      const credits = s?._sum.creditCents ?? 0;
      const row = {
        accountNumber: a.accountNumber,
        name: a.name,
        type: a.type,
        balanceCents: a.type === "ASSET" ? debits - credits : credits - debits,
      };
      if (a.type === "ASSET") { assets.push(row); assetsTotal += row.balanceCents; }
      else if (a.type === "LIABILITY") { liabilities.push(row); liabilitiesTotal += row.balanceCents; }
      else { equity.push(row); equityTotal += row.balanceCents; }
    }

    res.json({
      asOf: endDate,
      assets, assetsTotalCents: assetsTotal,
      liabilities, liabilitiesTotalCents: liabilitiesTotal,
      equity, equityTotalCents: equityTotal,
      // Books-balance check: total assets should equal liabilities + equity.
      balanceCheckCents: assetsTotal - (liabilitiesTotal + equityTotal),
    });
  } catch (err) { next(err); }
});

// ─── GET /reports/cash-flow ───────────────────────────────────────────────────
//
// Direct-method cash flow. "Cash in" = sum of completed Payments in the
// window; "cash out" = sum of received PurchaseOrder totals + refunds.
// Approximate but useful — the reconciliation report is the auditor's view.
router.get("/cash-flow", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = (req as any).tenantId;
    const { startDate, endDate } = dateFilters(req);

    const [payments, refunds, poReceived] = await Promise.all([
      prisma.payment.groupBy({
        by: ["method"],
        where: { tenantId, postedDate: { gte: startDate, lte: endDate }, status: "COMPLETED" },
        _sum: { amountCents: true },
      }),
      prisma.paymentRefund.aggregate({
        where: { tenantId, createdAt: { gte: startDate, lte: endDate } },
        _sum: { amountCents: true },
      }),
      prisma.purchaseOrder.aggregate({
        where: { tenantId, receivedAt: { gte: startDate, lte: endDate } },
        _sum: { totalCents: true },
        _count: { id: true },
      }),
    ]);

    const cashIn = payments.reduce((s, p) => s + (p._sum.amountCents ?? 0), 0);
    const refundsOut = refunds._sum.amountCents ?? 0;
    const poOut = poReceived._sum.totalCents ?? 0;

    res.json({
      period: { startDate, endDate },
      cashInCents: cashIn,
      cashByMethod: payments.map((p) => ({ method: p.method, amountCents: p._sum.amountCents ?? 0 })),
      refundsOutCents: refundsOut,
      poReceivedCents: poOut,
      poReceivedCount: poReceived._count.id,
      netCashCents: cashIn - refundsOut - poOut,
    });
  } catch (err) { next(err); }
});

// ─── GET /reports/reconciliation ──────────────────────────────────────────────
//
// Three-way reconciliation: GL revenue vs Stripe-completed payments vs
// invoices issued. Highlights the variance an accountant chases at close.
router.get("/reconciliation", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = (req as any).tenantId;
    const { startDate, endDate } = dateFilters(req);

    const [revenueAccounts, stripePayments, invoiced, refunds] = await Promise.all([
      prisma.glAccount.findMany({ where: { tenantId, type: "REVENUE" }, select: { id: true } }),
      prisma.payment.aggregate({
        where: { tenantId, postedDate: { gte: startDate, lte: endDate }, status: "COMPLETED", method: "CARD" },
        _sum: { amountCents: true },
        _count: { id: true },
      }),
      prisma.invoice.aggregate({
        where: { tenantId, issuedDate: { gte: startDate, lte: endDate }, status: { not: "VOID" } },
        _sum: { totalCents: true },
        _count: { id: true },
      }),
      prisma.paymentRefund.aggregate({
        where: { tenantId, createdAt: { gte: startDate, lte: endDate } },
        _sum: { amountCents: true },
      }),
    ]);

    const revenueAggregate = revenueAccounts.length === 0 ? { _sum: { debitCents: 0, creditCents: 0 } } : await prisma.glEntry.aggregate({
      where: {
        tenantId,
        accountId: { in: revenueAccounts.map((a) => a.id) },
        entryDate: { gte: startDate, lte: endDate },
      },
      _sum: { debitCents: true, creditCents: true },
    });
    const glRevenueCents = (revenueAggregate._sum.creditCents ?? 0) - (revenueAggregate._sum.debitCents ?? 0);

    const stripeCents = stripePayments._sum.amountCents ?? 0;
    const invoicedCents = invoiced._sum.totalCents ?? 0;
    const refundsCents = refunds._sum.amountCents ?? 0;

    res.json({
      period: { startDate, endDate },
      glRevenueCents,
      stripeCollectedCents: stripeCents,
      stripePaymentCount: stripePayments._count.id,
      invoicedCents,
      invoiceCount: invoiced._count.id,
      refundsCents,
      // Variance = GL revenue - (Stripe collected - refunds). Positive means
      // we recognized revenue we haven't seen cash for (e.g., manual receipts);
      // negative means cash arrived without a posted journal.
      varianceCents: glRevenueCents - (stripeCents - refundsCents),
    });
  } catch (err) { next(err); }
});

// ─── GET /reports/email-stats ─────────────────────────────────────────────────
//
// Outbound email health from EmailAutomationLog. Provides counts by status
// (SENT, FAILED, etc.) and a short recent-failure list.
router.get("/email-stats", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = (req as any).tenantId;
    const { startDate, endDate } = dateFilters(req);

    const logs = await prisma.emailAutomationLog.findMany({
      where: { tenantId, createdAt: { gte: startDate, lte: endDate } },
      select: { status: true, errorMessage: true, createdAt: true, subject: true, recipientEmail: true, trigger: true },
      orderBy: { createdAt: "desc" },
    });
    const byStatus = logs.reduce<Record<string, number>>((acc, l) => {
      acc[l.status] = (acc[l.status] ?? 0) + 1;
      return acc;
    }, {});
    const sent = byStatus.SENT ?? 0;
    const failed = byStatus.FAILED ?? 0;
    const total = logs.length;
    const recentFailures = logs.filter((l) => l.status === "FAILED").slice(0, 25).map((l) => ({
      recipient: l.recipientEmail,
      subject: l.subject,
      trigger: l.trigger,
      error: l.errorMessage,
      createdAt: l.createdAt,
    }));

    res.json({
      period: { startDate, endDate },
      total,
      sent,
      failed,
      successRate: total > 0 ? Number(((sent / total) * 100).toFixed(1)) : 0,
      byStatus: Object.entries(byStatus).map(([status, count]) => ({ status, count })),
      recentFailures,
    });
  } catch (err) { next(err); }
});

// ─── GET /reports/sms-stats ───────────────────────────────────────────────────
//
// Outbound SMS health. Filters EmailAutomationLog to rows that targeted a
// phone number (recipientPhone). Twilio failures show up here.
router.get("/sms-stats", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = (req as any).tenantId;
    const { startDate, endDate } = dateFilters(req);

    const logs = await prisma.emailAutomationLog.findMany({
      where: {
        tenantId,
        createdAt: { gte: startDate, lte: endDate },
        recipientPhone: { not: null },
      },
      select: { status: true, errorMessage: true, recipientPhone: true, createdAt: true, trigger: true },
      orderBy: { createdAt: "desc" },
    });
    const sent = logs.filter((l) => l.status === "SENT").length;
    const failed = logs.filter((l) => l.status === "FAILED").length;
    const recentFailures = logs.filter((l) => l.status === "FAILED").slice(0, 25).map((l) => ({
      recipient: l.recipientPhone,
      trigger: l.trigger,
      error: l.errorMessage,
      createdAt: l.createdAt,
    }));

    res.json({
      period: { startDate, endDate },
      total: logs.length,
      sent,
      failed,
      successRate: logs.length > 0 ? Number(((sent / logs.length) * 100).toFixed(1)) : 0,
      recentFailures,
    });
  } catch (err) { next(err); }
});

// ─── GET /reports/automation-rules ────────────────────────────────────────────
//
// Per-trigger and per-rule performance — runs vs failures. Surfaces which
// automations are broken before customers notice.
router.get("/automation-rules", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = (req as any).tenantId;
    const { startDate, endDate } = dateFilters(req);

    const grouped = await prisma.emailAutomationLog.groupBy({
      by: ["trigger", "status"],
      where: { tenantId, createdAt: { gte: startDate, lte: endDate } },
      _count: { _all: true },
    });
    const triggerMap = new Map<string, { trigger: string; sent: number; failed: number; queued: number; total: number }>();
    for (const r of grouped) {
      if (!triggerMap.has(r.trigger)) triggerMap.set(r.trigger, { trigger: r.trigger, sent: 0, failed: 0, queued: 0, total: 0 });
      const b = triggerMap.get(r.trigger)!;
      b.total += r._count._all;
      if (r.status === "SENT") b.sent += r._count._all;
      else if (r.status === "FAILED") b.failed += r._count._all;
      else if (r.status === "QUEUED") b.queued += r._count._all;
    }

    res.json({
      period: { startDate, endDate },
      byTrigger: Array.from(triggerMap.values())
        .map((b) => ({
          ...b,
          successRate: b.total > 0 ? Number(((b.sent / b.total) * 100).toFixed(1)) : 0,
        }))
        .sort((a, b) => b.total - a.total),
    });
  } catch (err) { next(err); }
});

// ─── GET /reports/announcement-reach ──────────────────────────────────────────
//
// Per-announcement delivery summary — how many recipients each broadcast
// reached and how many opened it.
router.get("/announcement-reach", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = (req as any).tenantId;
    const { startDate, endDate } = dateFilters(req);

    const announcements = await prisma.announcement.findMany({
      where: { tenantId, sentAt: { gte: startDate, lte: endDate } },
      include: { deliveries: true },
      orderBy: { sentAt: "desc" },
    });

    const rows = announcements.map((a) => {
      const totalDeliveries = a.deliveries.length;
      const opened = a.deliveries.filter((d) => d.openedAt !== null).length;
      const delivered = a.deliveries.filter((d) => d.status === "DELIVERED" || d.status === "SENT" || d.openedAt !== null).length;
      const failed = a.deliveries.filter((d) => d.status === "FAILED").length;
      return {
        id: a.id,
        subject: a.subject,
        channels: a.channels,
        isEmergency: a.isEmergency,
        sentAt: a.sentAt,
        totalDeliveries,
        delivered,
        failed,
        opened,
        openRate: delivered > 0 ? Number(((opened / delivered) * 100).toFixed(1)) : 0,
      };
    });

    res.json({
      period: { startDate, endDate },
      totalAnnouncements: announcements.length,
      totalDeliveries: rows.reduce((s, r) => s + r.totalDeliveries, 0),
      announcements: rows,
    });
  } catch (err) { next(err); }
});

// ─── GET /reports/email-suppression ───────────────────────────────────────────
//
// Suppression list growth, top reasons, and most recent additions.
router.get("/email-suppression", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = (req as any).tenantId;
    const { startDate, endDate } = dateFilters(req);

    const [all, recent, addedInWindow] = await Promise.all([
      prisma.emailSuppression.findMany({
        where: { tenantId },
        select: { reason: true, source: true, createdAt: true, email: true },
      }),
      prisma.emailSuppression.findMany({
        where: { tenantId, createdAt: { gte: startDate, lte: endDate } },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
      prisma.emailSuppression.count({ where: { tenantId, createdAt: { gte: startDate, lte: endDate } } }),
    ]);

    const byReason = new Map<string, number>();
    const bySource = new Map<string, number>();
    for (const r of all) {
      byReason.set(r.reason, (byReason.get(r.reason) ?? 0) + 1);
      bySource.set(r.source, (bySource.get(r.source) ?? 0) + 1);
    }

    res.json({
      period: { startDate, endDate },
      totalSuppressed: all.length,
      addedInWindow,
      byReason: Array.from(byReason.entries()).map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count),
      bySource: Array.from(bySource.entries()).map(([source, count]) => ({ source, count })).sort((a, b) => b.count - a.count),
      recent: recent.map((r) => ({ email: r.email, reason: r.reason, source: r.source, createdAt: r.createdAt })),
    });
  } catch (err) { next(err); }
});

// ─── GET /reports/admin-actions ───────────────────────────────────────────────
//
// Platform-side audit events touching this tenant: impersonations, flag
// toggles, exports, lock/unlock. Window-filtered, with the actor + verb
// summarized.
router.get("/admin-actions", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = (req as any).tenantId;
    const { startDate, endDate } = dateFilters(req);

    const events = await prisma.adminAuditEvent.findMany({
      where: { tenantId, createdAt: { gte: startDate, lte: endDate } },
      orderBy: { createdAt: "desc" },
      take: 500,
    });
    const byAction = events.reduce<Record<string, number>>((acc, e) => {
      acc[e.action] = (acc[e.action] ?? 0) + 1;
      return acc;
    }, {});
    const byActor = new Map<string, { actor: string; count: number }>();
    for (const e of events) {
      const actor = e.adminEmail ?? e.adminUserId ?? "system";
      if (!byActor.has(actor)) byActor.set(actor, { actor, count: 0 });
      byActor.get(actor)!.count += 1;
    }

    res.json({
      period: { startDate, endDate },
      totalEvents: events.length,
      byAction: Object.entries(byAction).map(([action, count]) => ({ action, count })).sort((a, b) => b.count - a.count),
      byActor: Array.from(byActor.values()).sort((a, b) => b.count - a.count),
      recent: events.slice(0, 100).map((e) => ({
        id: e.id,
        action: e.action,
        actor: e.adminEmail ?? "—",
        ipAddress: e.ipAddress,
        createdAt: e.createdAt,
      })),
    });
  } catch (err) { next(err); }
});

// ─── GET /reports/period-close ────────────────────────────────────────────────
//
// All accounting periods across locations + their close state. Lets a CFO see
// at a glance which months are open and how many are still un-attested.
router.get("/period-close", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = (req as any).tenantId;

    const periods = await prisma.accountingPeriod.findMany({
      where: { tenantId },
      include: { location: { select: { id: true, name: true } } },
      orderBy: [{ locationId: "asc" }, { periodStart: "desc" }],
    });
    const total = periods.length;
    const closed = periods.filter((p) => p.closedAt !== null).length;
    const open = total - closed;

    res.json({
      total,
      closed,
      open,
      closeRate: total > 0 ? Number(((closed / total) * 100).toFixed(1)) : 0,
      periods: periods.map((p) => ({
        id: p.id,
        location: p.location.name,
        locationId: p.locationId,
        periodStart: p.periodStart,
        periodEnd: p.periodEnd,
        closedAt: p.closedAt,
        notes: p.notes,
      })),
    });
  } catch (err) { next(err); }
});

// ─── GET /reports/qbo-sync ────────────────────────────────────────────────────
//
// Inbound QBO webhook health (QboWebhookDelivery) + the tenant's connection
// state. Surfaces stuck deliveries and last-pull watermarks.
router.get("/qbo-sync", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = (req as any).tenantId;
    const { startDate, endDate } = dateFilters(req);

    const [tenant, byStatus, recentFailures] = await Promise.all([
      prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { qboConnectedAt: true, qboLastVendorPullAt: true, qboLastBillPullAt: true },
      }),
      prisma.qboWebhookDelivery.groupBy({
        by: ["status"],
        where: { tenantId, receivedAt: { gte: startDate, lte: endDate } },
        _count: { _all: true },
      }),
      prisma.qboWebhookDelivery.findMany({
        where: { tenantId, status: "FAILED", receivedAt: { gte: startDate, lte: endDate } },
        select: { id: true, signature: true, attempts: true, lastError: true, receivedAt: true },
        orderBy: { receivedAt: "desc" },
        take: 50,
      }),
    ]);

    const total = byStatus.reduce((s, r) => s + r._count._all, 0);
    const counts: Record<string, number> = {};
    for (const r of byStatus) counts[r.status] = r._count._all;

    res.json({
      period: { startDate, endDate },
      connected: tenant?.qboConnectedAt !== null,
      connectedAt: tenant?.qboConnectedAt,
      lastVendorPullAt: tenant?.qboLastVendorPullAt,
      lastBillPullAt: tenant?.qboLastBillPullAt,
      total,
      counts,
      successRate: total > 0 ? Number((((counts.PROCESSED ?? 0) / total) * 100).toFixed(1)) : 0,
      recentFailures,
    });
  } catch (err) { next(err); }
});

// ─── GET /reports/webhook-deliveries ──────────────────────────────────────────
//
// Outbound webhook health (the WebhookDelivery table written by
// outbound-webhooks.ts). Per-destination success rate + recent failures.
router.get("/webhook-deliveries", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = (req as any).tenantId;
    const { startDate, endDate } = dateFilters(req);

    const destinations = await prisma.webhookDestination.findMany({
      where: { tenantId },
      select: { id: true, name: true, url: true, enabled: true, consecutiveFailures: true, disabledAt: true },
    });
    const destIds = destinations.map((d) => d.id);

    const deliveries = destIds.length === 0
      ? []
      : await prisma.webhookDelivery.findMany({
        where: {
          destinationId: { in: destIds },
          createdAt: { gte: startDate, lte: endDate },
        },
        select: { destinationId: true, status: true, httpStatus: true, createdAt: true, responseSnippet: true, event: true },
        orderBy: { createdAt: "desc" },
      });

    const byDest = destinations.map((d) => {
      const rows = deliveries.filter((r) => r.destinationId === d.id);
      const success = rows.filter((r) => r.status === "SUCCESS").length;
      const failed = rows.filter((r) => r.status === "FAILED").length;
      return {
        id: d.id,
        name: d.name,
        url: d.url,
        enabled: d.enabled,
        disabledAt: d.disabledAt,
        consecutiveFailures: d.consecutiveFailures,
        deliveryCount: rows.length,
        successCount: success,
        failedCount: failed,
        successRate: rows.length > 0 ? Number(((success / rows.length) * 100).toFixed(1)) : 0,
      };
    });

    const totalSuccess = deliveries.filter((d) => d.status === "SUCCESS").length;
    const totalFailed = deliveries.filter((d) => d.status === "FAILED").length;
    const recentFailures = deliveries
      .filter((d) => d.status === "FAILED")
      .slice(0, 50)
      .map((d) => {
        const dest = destinations.find((dd) => dd.id === d.destinationId);
        return {
          destination: dest?.name ?? d.destinationId,
          event: d.event,
          httpStatus: d.httpStatus,
          responseSnippet: d.responseSnippet,
          createdAt: d.createdAt,
        };
      });

    res.json({
      period: { startDate, endDate },
      destinationCount: destinations.length,
      enabledDestinations: destinations.filter((d) => d.enabled).length,
      disabledDestinations: destinations.filter((d) => !d.enabled && d.disabledAt).length,
      totalDeliveries: deliveries.length,
      totalSuccess,
      totalFailed,
      successRate: deliveries.length > 0 ? Number(((totalSuccess / deliveries.length) * 100).toFixed(1)) : 0,
      byDestination: byDest,
      recentFailures,
    });
  } catch (err) { next(err); }
});

// ─── GET /reports/customer-ltv ────────────────────────────────────────────────
//
// Computes a rough lifetime-value per customer cohort. "Cohort" is the
// year-month of first invoice; LTV is the sum of every completed Payment we
// have on file for that customer, regardless of period. The cohort table
// tells the operator whether 2024 cohorts are growing faster than 2023.
router.get("/customer-ltv", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = (req as any).tenantId;

    const customers = await prisma.customer.findMany({
      where: { tenantId },
      select: { id: true, createdAt: true, firstName: true, lastName: true },
    });
    if (customers.length === 0) {
      res.json({ totalCustomers: 0, avgLtvCents: 0, medianLtvCents: 0, totalLtvCents: 0, cohorts: [], topCustomers: [] });
      return;
    }

    const paymentSums = await prisma.payment.groupBy({
      by: ["customerId"],
      where: { tenantId, status: "COMPLETED" },
      _sum: { amountCents: true, refundedCents: true },
    });
    const ltvByCustomer = new Map<string, number>();
    for (const p of paymentSums) {
      const gross = p._sum.amountCents ?? 0;
      const refunded = p._sum.refundedCents ?? 0;
      ltvByCustomer.set(p.customerId, gross - refunded);
    }

    const cohorts = new Map<string, { cohort: string; customers: number; totalLtvCents: number }>();
    const customerRows = customers.map((c) => {
      const cohort = c.createdAt.toISOString().slice(0, 7); // YYYY-MM
      const ltv = ltvByCustomer.get(c.id) ?? 0;
      if (!cohorts.has(cohort)) cohorts.set(cohort, { cohort, customers: 0, totalLtvCents: 0 });
      const b = cohorts.get(cohort)!;
      b.customers += 1;
      b.totalLtvCents += ltv;
      return { customerId: c.id, name: `${c.firstName} ${c.lastName}`.trim(), ltvCents: ltv };
    });

    const ltvs = customerRows.map((r) => r.ltvCents).sort((a, b) => a - b);
    const median = ltvs.length > 0 ? ltvs[Math.floor(ltvs.length / 2)] : 0;
    const total = ltvs.reduce((s, v) => s + v, 0);
    const avg = ltvs.length > 0 ? Math.round(total / ltvs.length) : 0;

    res.json({
      totalCustomers: customers.length,
      totalLtvCents: total,
      avgLtvCents: avg,
      medianLtvCents: median,
      cohorts: Array.from(cohorts.values())
        .map((c) => ({
          ...c,
          avgLtvCents: c.customers > 0 ? Math.round(c.totalLtvCents / c.customers) : 0,
        }))
        .sort((a, b) => b.cohort.localeCompare(a.cohort))
        .slice(0, 24), // last 2 years of cohorts
      topCustomers: customerRows.sort((a, b) => b.ltvCents - a.ltvCents).slice(0, 20),
    });
  } catch (err) { next(err); }
});

// ─── GET /reports/churn ───────────────────────────────────────────────────────
//
// Churn: how many active contracts ended in the window (terminated or
// expired without renewal), and how many of those customers had no
// contracts left afterwards. The "at-risk" list is contracts whose endDate
// or renewal window is within the next 30 days and autoRenew is false.
router.get("/churn", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = (req as any).tenantId;
    const { startDate, endDate } = dateFilters(req);
    const now = new Date();
    const in30 = new Date(now.getTime() + 30 * 86_400_000);

    const ended = await prisma.slipContract.findMany({
      where: {
        tenantId,
        status: { in: ["TERMINATED", "EXPIRED"] },
        OR: [
          { terminationDate: { gte: startDate, lte: endDate } },
          { endDate: { gte: startDate, lte: endDate } },
        ],
      },
      select: { id: true, customerId: true, status: true, endDate: true, terminationDate: true, rateCents: true },
    });

    // For each ended contract, did the customer still have anything active?
    const endedCustomerIds = Array.from(new Set(ended.map((c) => c.customerId)));
    const activeByCustomer = endedCustomerIds.length === 0
      ? new Map<string, number>()
      : new Map(
        (await prisma.slipContract.groupBy({
          by: ["customerId"],
          where: { tenantId, customerId: { in: endedCustomerIds }, status: "ACTIVE" },
          _count: { _all: true },
        })).map((r) => [r.customerId, r._count._all]),
      );

    const customersGone = endedCustomerIds.filter((cid) => !activeByCustomer.has(cid)).length;
    const lostMrrCents = ended.reduce((s, c) => s + c.rateCents, 0);

    // At-risk for next 30 days: contracts whose endDate falls in the window
    // and autoRenew is false.
    const atRisk = await prisma.slipContract.findMany({
      where: {
        tenantId,
        status: "ACTIVE",
        autoRenew: false,
        endDate: { gte: now, lte: in30 },
      },
      select: { id: true, customerId: true, endDate: true, rateCents: true, customer: { select: { firstName: true, lastName: true, email: true } } },
      orderBy: { endDate: "asc" },
    });

    res.json({
      period: { startDate, endDate },
      endedContractCount: ended.length,
      customersChurned: customersGone,
      lostMrrCents,
      atRisk30Days: atRisk.map((c) => ({
        contractId: c.id,
        customerName: c.customer ? `${c.customer.firstName} ${c.customer.lastName}`.trim() : '—',
        customerEmail: c.customer?.email ?? null,
        endDate: c.endDate,
        rateCents: c.rateCents,
      })),
      atRiskMrrCents: atRisk.reduce((s, c) => s + c.rateCents, 0),
    });
  } catch (err) { next(err); }
});

// ─── GET /reports/nps ─────────────────────────────────────────────────────────
//
// NPS over the window: response rate, promoter/passive/detractor mix,
// score histogram, recent comments. Survey data lives in `NpsSurvey`.
router.get("/nps", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = (req as any).tenantId;
    const { startDate, endDate } = dateFilters(req);

    const surveys = await prisma.npsSurvey.findMany({
      where: { tenantId, sentAt: { gte: startDate, lte: endDate } },
      select: { score: true, comment: true, sentAt: true, respondedAt: true },
      orderBy: { respondedAt: "desc" },
    });

    const responded = surveys.filter((s) => s.respondedAt && s.score !== null);
    const responseRate = surveys.length > 0 ? responded.length / surveys.length : 0;
    const promoters = responded.filter((s) => (s.score ?? 0) >= 9).length;
    const passives = responded.filter((s) => (s.score ?? 0) >= 7 && (s.score ?? 0) <= 8).length;
    const detractors = responded.filter((s) => (s.score ?? 0) <= 6).length;
    const nps = responded.length > 0
      ? Math.round(((promoters - detractors) / responded.length) * 100)
      : 0;

    const histogram = Array.from({ length: 11 }, (_, score) => ({
      score,
      count: responded.filter((s) => s.score === score).length,
    }));

    const recentComments = responded
      .filter((s) => s.comment && s.comment.trim().length > 0)
      .slice(0, 20)
      .map((s) => ({ score: s.score ?? 0, comment: s.comment, respondedAt: s.respondedAt }));

    res.json({
      period: { startDate, endDate },
      sent: surveys.length,
      responded: responded.length,
      responseRate: Number((responseRate * 100).toFixed(1)),
      nps,
      promoters,
      passives,
      detractors,
      histogram,
      recentComments,
    });
  } catch (err) { next(err); }
});

// ─── GET /reports/card-rail-mix ───────────────────────────────────────────────
//
// Splits payment volume across rails (card / ACH / cash / check / other) so
// an operator can see surcharge effectiveness and the average ticket per
// rail. Pulls from Payment + the surchargeCents column.
router.get("/card-rail-mix", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = (req as any).tenantId;
    const { startDate, endDate } = dateFilters(req);

    const payments = await prisma.payment.groupBy({
      by: ["method"],
      where: { tenantId, postedDate: { gte: startDate, lte: endDate }, status: "COMPLETED" },
      _sum: { amountCents: true, refundedCents: true },
      _count: { id: true },
    });

    const total = payments.reduce((s, p) => s + (p._sum.amountCents ?? 0), 0);
    const refundTotal = payments.reduce((s, p) => s + (p._sum.refundedCents ?? 0), 0);

    const byMethod = payments.map((p) => {
      const gross = p._sum.amountCents ?? 0;
      const count = p._count.id;
      return {
        method: p.method,
        count,
        grossCents: gross,
        netCents: gross - (p._sum.refundedCents ?? 0),
        refundedCents: p._sum.refundedCents ?? 0,
        avgTicketCents: count > 0 ? Math.round(gross / count) : 0,
        sharePct: total > 0 ? Number(((gross / total) * 100).toFixed(1)) : 0,
      };
    }).sort((a, b) => b.grossCents - a.grossCents);

    res.json({
      period: { startDate, endDate },
      paymentCount: payments.reduce((s, p) => s + p._count.id, 0),
      totalGrossCents: total,
      totalRefundedCents: refundTotal,
      byMethod,
    });
  } catch (err) { next(err); }
});

// ─── GET /reports/refunds-chargebacks ─────────────────────────────────────────
//
// Refund volume + reason distribution, plus chargeback / dispute counts when
// they exist. Drives the "are we leaking customer trust" question that
// payments leads ask at month-end.
router.get("/refunds-chargebacks", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = (req as any).tenantId;
    const { startDate, endDate } = dateFilters(req);

    const refunds = await prisma.paymentRefund.findMany({
      where: { tenantId, createdAt: { gte: startDate, lte: endDate } },
      select: { amountCents: true, reason: true, createdAt: true, isFullRefund: true, source: true },
    });

    const paymentsAgg = await prisma.payment.aggregate({
      where: { tenantId, postedDate: { gte: startDate, lte: endDate }, status: "COMPLETED" },
      _sum: { amountCents: true },
      _count: { id: true },
    });

    const byReason = new Map<string, { reason: string; count: number; totalCents: number }>();
    for (const r of refunds) {
      const key = r.reason ?? "unspecified";
      if (!byReason.has(key)) byReason.set(key, { reason: key, count: 0, totalCents: 0 });
      const b = byReason.get(key)!;
      b.count += 1;
      b.totalCents += r.amountCents;
    }

    const totalRefundCents = refunds.reduce((s, r) => s + r.amountCents, 0);
    const grossPaymentCents = paymentsAgg._sum.amountCents ?? 0;

    // Disputes — only count tenants that have the model. If it doesn't exist
    // yet on this build, the optional chain handles it.
    let disputeCount = 0;
    let disputeTotalCents = 0;
    try {
      const disputeAgg = await (prisma as any).paymentDispute?.aggregate?.({
        where: { tenantId, createdAt: { gte: startDate, lte: endDate } },
        _sum: { amountCents: true },
        _count: { id: true },
      });
      if (disputeAgg) {
        disputeCount = disputeAgg._count?.id ?? 0;
        disputeTotalCents = disputeAgg._sum?.amountCents ?? 0;
      }
    } catch { /* disputes table absent — fine */ }

    res.json({
      period: { startDate, endDate },
      refunds: {
        count: refunds.length,
        totalCents: totalRefundCents,
        fullRefunds: refunds.filter((r) => r.isFullRefund).length,
        rateOfGross: grossPaymentCents > 0 ? Number(((totalRefundCents / grossPaymentCents) * 100).toFixed(2)) : 0,
      },
      gross: {
        paymentCount: paymentsAgg._count.id,
        totalCents: grossPaymentCents,
      },
      disputes: { count: disputeCount, totalCents: disputeTotalCents },
      byReason: Array.from(byReason.values()).sort((a, b) => b.totalCents - a.totalCents),
    });
  } catch (err) { next(err); }
});

// ─── GET /reports/purchasing ──────────────────────────────────────────────────
//
// Purchase-order activity for the window: aging (days since created for POs
// not yet received), spend by vendor, and a status breakdown so an
// operations lead knows where the supply chain is leaking.
router.get("/purchasing", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = (req as any).tenantId;
    const { startDate, endDate } = dateFilters(req);

    const pos = await prisma.purchaseOrder.findMany({
      where: { tenantId, createdAt: { gte: startDate, lte: endDate } },
      select: {
        id: true,
        poNumber: true,
        status: true,
        vendorName: true,
        vendorId: true,
        totalCents: true,
        createdAt: true,
        expectedDate: true,
        receivedAt: true,
        vendor: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    const now = Date.now();
    const byStatus = pos.reduce<Record<string, number>>((acc, p) => {
      acc[p.status] = (acc[p.status] ?? 0) + 1;
      return acc;
    }, {});

    const vendorMap = new Map<string, { name: string; orderCount: number; totalCents: number; avgLeadDays: number; leadSum: number; leadN: number }>();
    for (const p of pos) {
      const key = p.vendorId ?? p.vendorName ?? "_unknown";
      const name = p.vendor?.name ?? p.vendorName ?? "Unknown vendor";
      if (!vendorMap.has(key)) {
        vendorMap.set(key, { name, orderCount: 0, totalCents: 0, avgLeadDays: 0, leadSum: 0, leadN: 0 });
      }
      const v = vendorMap.get(key)!;
      v.orderCount += 1;
      v.totalCents += p.totalCents;
      if (p.receivedAt) {
        const lead = (new Date(p.receivedAt).getTime() - new Date(p.createdAt).getTime()) / 86_400_000;
        v.leadSum += lead;
        v.leadN += 1;
      }
    }
    const byVendor = Array.from(vendorMap.values()).map((v) => ({
      vendor: v.name,
      orderCount: v.orderCount,
      totalCents: v.totalCents,
      avgLeadDays: v.leadN > 0 ? Number((v.leadSum / v.leadN).toFixed(1)) : null,
    })).sort((a, b) => b.totalCents - a.totalCents);

    // Aging buckets for unreceived orders only.
    const aging = { current: 0, days30: 0, days60: 0, days60plus: 0 };
    let openTotalCents = 0;
    for (const p of pos) {
      if (p.receivedAt) continue;
      openTotalCents += p.totalCents;
      const age = (now - new Date(p.createdAt).getTime()) / 86_400_000;
      if (age <= 30) aging.current += 1;
      else if (age <= 60) aging.days30 += 1;
      else aging.days60 += 1;
      if (age > 60) aging.days60plus += 1;
    }

    res.json({
      period: { startDate, endDate },
      totalOrders: pos.length,
      totalSpendCents: pos.reduce((s, p) => s + p.totalCents, 0),
      openOrders: pos.filter((p) => !p.receivedAt).length,
      openSpendCents: openTotalCents,
      byStatus: Object.entries(byStatus).map(([status, count]) => ({ status, count })),
      byVendor,
      aging,
    });
  } catch (err) { next(err); }
});

// ─── GET /reports/accounting-completeness ─────────────────────────────────────
//
// Plan 7 — Lists every active sellable thing in the tenant whose GL mapping
// is missing for at least one active location. Walks the same kinds the
// Plan 6 resolver supports, plus surfaces unpinned location-level slots
// (default revenue, AR, AP, deferred, sales-tax, etc.) so an operator has
// one screen that says "fix these to balance the books."
router.get("/accounting-completeness", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = (req as any).tenantId;

    const locations = await prisma.location.findMany({
      where: { tenantId },
      select: {
        id: true,
        name: true,
        qboRealmId: true,
        defaultRevenueGlAccountId: true,
        arGlAccountId: true,
        accountsPayableGlAccountId: true,
        deferredRevenueGlAccountId: true,
        salesTaxGlAccountId: true,
        cashGlAccountId: true,
        stripeClearingGlAccountId: true,
        achClearingGlAccountId: true,
        tipsPayableGlAccountId: true,
        cashOverShortGlAccountId: true,
        transientRevenueGlAccountId: true,
        rampRevenueGlAccountId: true,
        conciergeRevenueGlAccountId: true,
        fuelRevenueGlAccountId: true,
        electricityRevenueGlAccountId: true,
      },
    });
    const activeLocations = locations;

    interface Gap {
      kind: string;
      label: string;
      detail: string;
      locationId: string | null;
      locationName: string | null;
      severity: "ERROR" | "WARNING";
      fixHref: string;
    }
    const gaps: Gap[] = [];

    // Layer 1: required Location-level system slots. ERROR for QBO-connected
    // locations (postings will throw); WARNING otherwise (postings work but
    // land on a fallback account).
    const REQUIRED_LOC_SLOTS: Array<{
      field: keyof typeof activeLocations[number];
      kind: string;
      label: string;
      severity: "ERROR" | "WARNING";
    }> = [
      { field: "defaultRevenueGlAccountId",     kind: "DEFAULT_REVENUE",      label: "Default revenue",            severity: "ERROR" },
      { field: "arGlAccountId",                 kind: "AR",                   label: "Accounts receivable",        severity: "ERROR" },
      { field: "salesTaxGlAccountId",           kind: "SALES_TAX",            label: "Sales tax payable",          severity: "ERROR" },
      { field: "deferredRevenueGlAccountId",    kind: "DEFERRED_REVENUE",     label: "Deferred revenue",           severity: "WARNING" },
      { field: "accountsPayableGlAccountId",    kind: "AP",                   label: "Accounts payable (PO recv)", severity: "WARNING" },
      { field: "cashGlAccountId",               kind: "CASH",                 label: "Cash / operating bank",      severity: "WARNING" },
      { field: "stripeClearingGlAccountId",     kind: "STRIPE_CLEARING",      label: "Stripe clearing",            severity: "WARNING" },
      { field: "achClearingGlAccountId",        kind: "ACH_CLEARING",         label: "ACH clearing",               severity: "WARNING" },
      { field: "tipsPayableGlAccountId",        kind: "TIPS_PAYABLE",         label: "Tips payable",               severity: "WARNING" },
      { field: "cashOverShortGlAccountId",      kind: "CASH_OVER_SHORT",      label: "Cash over/short",            severity: "WARNING" },
      { field: "transientRevenueGlAccountId",   kind: "TRANSIENT_REVENUE",    label: "Transient revenue",          severity: "WARNING" },
      { field: "rampRevenueGlAccountId",        kind: "RAMP_REVENUE",         label: "Ramp revenue",               severity: "WARNING" },
      { field: "conciergeRevenueGlAccountId",   kind: "CONCIERGE_REVENUE",    label: "Concierge revenue",          severity: "WARNING" },
      { field: "fuelRevenueGlAccountId",        kind: "FUEL_REVENUE",         label: "Fuel revenue",               severity: "WARNING" },
      { field: "electricityRevenueGlAccountId", kind: "ELECTRICITY_REVENUE",  label: "Electricity revenue",        severity: "WARNING" },
    ];
    for (const loc of activeLocations) {
      for (const slot of REQUIRED_LOC_SLOTS) {
        if (!loc[slot.field]) {
          gaps.push({
            kind: slot.kind,
            label: slot.label,
            detail: `Pin a GL account on ${loc.name}`,
            locationId: loc.id,
            locationName: loc.name,
            severity: loc.qboRealmId ? slot.severity : "WARNING",
            fixHref: `/settings/accounting`,
          });
        }
      }
    }

    // Layer 2: per-instance mappings missing at any active location.
    const [productCategories, dockageRates, rentalProducts, serviceFees] = await Promise.all([
      prisma.productCategory.findMany({ where: { tenantId, active: true }, select: { id: true, name: true } }),
      prisma.dockageRate.findMany({ where: { tenantId, active: true }, select: { id: true, name: true } }),
      prisma.rentalProduct.findMany({ where: { tenantId, active: true }, select: { id: true, name: true } }),
      prisma.serviceFee.findMany({ where: { tenantId, active: true }, select: { id: true, name: true } }),
    ]);

    const [pcMappings, drMappings, rpMappings, sfMappings] = await Promise.all([
      prisma.productCategoryGlMapping.findMany({ where: { tenantId }, select: { productCategoryId: true, locationId: true, revenueGlAccountId: true, cogsGlAccountId: true, inventoryAssetGlAccountId: true } }),
      prisma.dockageRateGlMapping.findMany({ where: { tenantId }, select: { dockageRateId: true, locationId: true, glAccountId: true } }),
      prisma.rentalProductGlMapping.findMany({ where: { tenantId }, select: { rentalProductId: true, locationId: true, revenueGlAccountId: true } }),
      prisma.serviceFeeGlMapping.findMany({ where: { tenantId }, select: { serviceFeeId: true, locationId: true, glAccountId: true } }),
    ]);

    const pcMap = new Map(pcMappings.map((m) => [`${m.productCategoryId}:${m.locationId}`, m]));
    const drMap = new Map(drMappings.map((m) => [`${m.dockageRateId}:${m.locationId}`, m]));
    const rpMap = new Map(rpMappings.map((m) => [`${m.rentalProductId}:${m.locationId}`, m]));
    const sfMap = new Map(sfMappings.map((m) => [`${m.serviceFeeId}:${m.locationId}`, m]));

    for (const loc of activeLocations) {
      for (const cat of productCategories) {
        const m = pcMap.get(`${cat.id}:${loc.id}`);
        if (!m?.revenueGlAccountId) {
          gaps.push({
            kind: "PRODUCT_CATEGORY",
            label: `Product category "${cat.name}"`,
            detail: `No revenue mapping at ${loc.name}`,
            locationId: loc.id,
            locationName: loc.name,
            severity: "ERROR",
            fixHref: `/settings/products`,
          });
        }
      }
      for (const r of dockageRates) {
        const m = drMap.get(`${r.id}:${loc.id}`);
        if (!m?.glAccountId) {
          gaps.push({
            kind: "DOCKAGE_RATE",
            label: `Dockage rate "${r.name}"`,
            detail: `No revenue mapping at ${loc.name}`,
            locationId: loc.id,
            locationName: loc.name,
            severity: "WARNING",
            fixHref: `/settings/products`,
          });
        }
      }
      for (const r of rentalProducts) {
        const m = rpMap.get(`${r.id}:${loc.id}`);
        if (!m?.revenueGlAccountId) {
          gaps.push({
            kind: "RENTAL_PRODUCT",
            label: `Rental "${r.name}"`,
            detail: `No revenue mapping at ${loc.name}`,
            locationId: loc.id,
            locationName: loc.name,
            severity: "WARNING",
            fixHref: `/rentals`,
          });
        }
      }
      for (const f of serviceFees) {
        const m = sfMap.get(`${f.id}:${loc.id}`);
        if (!m?.glAccountId) {
          gaps.push({
            kind: "SERVICE_FEE",
            label: `Service fee "${f.name}"`,
            detail: `No revenue mapping at ${loc.name}`,
            locationId: loc.id,
            locationName: loc.name,
            severity: "WARNING",
            fixHref: `/settings/products`,
          });
        }
      }
    }

    const summary = {
      totalLocations: activeLocations.length,
      totalGaps: gaps.length,
      errors: gaps.filter((g) => g.severity === "ERROR").length,
      warnings: gaps.filter((g) => g.severity === "WARNING").length,
    };

    res.json({ summary, gaps });
  } catch (err) {
    next(err);
  }
});

export default router;

