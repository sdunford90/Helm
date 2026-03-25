import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { clerkAuth, requireRole } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";

const router = Router();

router.use(...clerkAuth());
router.use(requireRole("admin", "manager", "accounting"));

// ─── Helpers ────────────────────────────────────────────────────────────────

function appError(message: string, statusCode: number, code: string): Error {
  const err = new Error(message) as Error & { statusCode: number; code: string };
  err.statusCode = statusCode;
  err.code = code;
  return err;
}

const DateRangeSchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
});

// ═══════════════════════════════════════════════════════════════════════════════
// OCCUPANCY REPORT
// ═══════════════════════════════════════════════════════════════════════════════

router.get(
  "/occupancy",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = (req as any).tenantId;

      const totalSlips = await prisma.slip.count({ where: { tenantId } });

      const slipsByStatus = await prisma.slip.groupBy({
        by: ["status"],
        where: { tenantId },
        _count: true,
      });

      const statusMap: Record<string, number> = {};
      for (const s of slipsByStatus) {
        statusMap[s.status] = s._count;
      }

      const occupied = statusMap["OCCUPIED"] ?? 0;
      const vacant = statusMap["VACANT"] ?? 0;
      const maintenance = statusMap["MAINTENANCE"] ?? 0;
      const reserved = statusMap["RESERVED"] ?? 0;

      const occupancyRate = totalSlips > 0 ? Math.round((occupied / totalSlips) * 10000) / 100 : 0;

      // Transient occupancy (currently checked-in transient bookings)
      const activeTransient = await prisma.transientBooking.count({
        where: { tenantId, status: "CHECKED_IN" },
      });

      // Contracts by status
      const contractsByStatus = await prisma.slipContract.groupBy({
        by: ["status"],
        where: { tenantId },
        _count: true,
      });

      const contractMap: Record<string, number> = {};
      for (const c of contractsByStatus) {
        contractMap[c.status] = c._count;
      }

      res.json({
        data: {
          totalSlips,
          occupied,
          vacant,
          maintenance,
          reserved,
          occupancyRate,
          activeTransient,
          contracts: contractMap,
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

// ═══════════════════════════════════════════════════════════════════════════════
// REVENUE REPORT
// ═══════════════════════════════════════════════════════════════════════════════

router.get(
  "/revenue",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = (req as any).tenantId;
      const { from, to } = DateRangeSchema.parse(req.query);

      const dateFrom = from ? new Date(from) : new Date(new Date().getFullYear(), 0, 1);
      const dateTo = to ? new Date(to) : new Date();

      // Payments in date range
      const payments = await prisma.payment.findMany({
        where: {
          tenantId,
          status: "COMPLETED",
          paidAt: { gte: dateFrom, lte: dateTo },
        },
        select: { amountCents: true, method: true, paidAt: true },
      });

      const totalRevenueCents = payments.reduce((sum, p) => sum + p.amountCents, 0);

      // Revenue by payment method
      const byMethod: Record<string, number> = {};
      for (const p of payments) {
        byMethod[p.method] = (byMethod[p.method] ?? 0) + p.amountCents;
      }

      // Revenue by month
      const byMonth: Record<string, number> = {};
      for (const p of payments) {
        if (p.paidAt) {
          const key = `${p.paidAt.getFullYear()}-${String(p.paidAt.getMonth() + 1).padStart(2, "0")}`;
          byMonth[key] = (byMonth[key] ?? 0) + p.amountCents;
        }
      }

      // Invoice totals
      const invoiceTotals = await prisma.invoice.aggregate({
        where: {
          tenantId,
          issuedAt: { gte: dateFrom, lte: dateTo },
          status: { not: "VOID" },
        },
        _sum: { totalCents: true, taxCents: true },
        _count: true,
      });

      // POS revenue
      const posRevenue = await prisma.posTransaction.aggregate({
        where: {
          tenantId,
          createdAt: { gte: dateFrom, lte: dateTo },
          status: "COMPLETED",
        },
        _sum: { totalCents: true },
        _count: true,
      });

      // Rental revenue
      const rentalRevenue = await prisma.reservation.aggregate({
        where: {
          tenantId,
          status: "CHECKED_OUT",
          checkedOutAt: { gte: dateFrom, lte: dateTo },
        },
        _sum: { totalCents: true },
        _count: true,
      });

      res.json({
        data: {
          dateRange: { from: dateFrom, to: dateTo },
          totalRevenueCents,
          byMethod,
          byMonth: Object.entries(byMonth)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([month, cents]) => ({ month, cents })),
          invoices: {
            count: invoiceTotals._count,
            totalCents: invoiceTotals._sum.totalCents ?? 0,
            taxCents: invoiceTotals._sum.taxCents ?? 0,
          },
          pos: {
            count: posRevenue._count,
            totalCents: posRevenue._sum.totalCents ?? 0,
          },
          rentals: {
            count: rentalRevenue._count,
            totalCents: rentalRevenue._sum.totalCents ?? 0,
          },
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

// ═══════════════════════════════════════════════════════════════════════════════
// DEFERRED REVENUE REPORT
// ═══════════════════════════════════════════════════════════════════════════════

router.get(
  "/deferred-revenue",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = (req as any).tenantId;

      // Active deferred schedules
      const schedules = await prisma.deferredSchedule.findMany({
        where: { tenantId, status: "ACTIVE" },
        include: {
          entries: {
            orderBy: { recognitionDate: "asc" },
          },
          invoice: {
            select: { invoiceNumber: true, customerId: true },
            include: {
              customer: { select: { firstName: true, lastName: true } },
            },
          },
        },
      });

      let totalDeferredCents = 0;
      let totalRecognizedCents = 0;
      let totalRemainingCents = 0;

      const scheduleData = schedules.map((s) => {
        const recognized = s.entries
          .filter((e) => e.recognized)
          .reduce((sum, e) => sum + e.amountCents, 0);
        const remaining = s.entries
          .filter((e) => !e.recognized)
          .reduce((sum, e) => sum + e.amountCents, 0);
        const total = recognized + remaining;

        totalDeferredCents += total;
        totalRecognizedCents += recognized;
        totalRemainingCents += remaining;

        return {
          scheduleId: s.id,
          invoiceNumber: s.invoice?.invoiceNumber,
          customerName: s.invoice?.customer
            ? `${s.invoice.customer.firstName} ${s.invoice.customer.lastName}`
            : null,
          totalCents: total,
          recognizedCents: recognized,
          remainingCents: remaining,
          entryCount: s.entries.length,
          nextRecognition: s.entries.find((e) => !e.recognized)?.recognitionDate ?? null,
        };
      });

      // Upcoming recognition by month
      const upcomingEntries = await prisma.deferredEntry.findMany({
        where: {
          schedule: { tenantId, status: "ACTIVE" },
          recognized: false,
        },
        select: { amountCents: true, recognitionDate: true },
        orderBy: { recognitionDate: "asc" },
      });

      const byMonth: Record<string, number> = {};
      for (const e of upcomingEntries) {
        const key = `${e.recognitionDate.getFullYear()}-${String(e.recognitionDate.getMonth() + 1).padStart(2, "0")}`;
        byMonth[key] = (byMonth[key] ?? 0) + e.amountCents;
      }

      res.json({
        data: {
          totalDeferredCents,
          totalRecognizedCents,
          totalRemainingCents,
          scheduleCount: schedules.length,
          schedules: scheduleData,
          upcomingByMonth: Object.entries(byMonth)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([month, cents]) => ({ month, cents })),
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

// ═══════════════════════════════════════════════════════════════════════════════
// ACCOUNTS RECEIVABLE AGING REPORT
// ═══════════════════════════════════════════════════════════════════════════════

router.get(
  "/ar-aging",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = (req as any).tenantId;
      const now = new Date();

      const openInvoices = await prisma.invoice.findMany({
        where: {
          tenantId,
          status: { in: ["ISSUED", "PAST_DUE"] },
        },
        include: {
          customer: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
        },
      });

      const buckets = {
        current: [] as typeof openInvoices,
        days1to30: [] as typeof openInvoices,
        days31to60: [] as typeof openInvoices,
        days61to90: [] as typeof openInvoices,
        days90plus: [] as typeof openInvoices,
      };

      for (const inv of openInvoices) {
        if (!inv.dueDate) {
          buckets.current.push(inv);
          continue;
        }
        const daysOverdue = Math.floor(
          (now.getTime() - new Date(inv.dueDate).getTime()) / (1000 * 60 * 60 * 24),
        );

        if (daysOverdue <= 0) buckets.current.push(inv);
        else if (daysOverdue <= 30) buckets.days1to30.push(inv);
        else if (daysOverdue <= 60) buckets.days31to60.push(inv);
        else if (daysOverdue <= 90) buckets.days61to90.push(inv);
        else buckets.days90plus.push(inv);
      }

      const sumBucket = (list: typeof openInvoices) =>
        list.reduce((s, i) => s + i.totalCents, 0);

      // Per-customer breakdown
      const customerMap: Record<string, {
        customerId: string;
        customerName: string;
        currentCents: number;
        days1to30Cents: number;
        days31to60Cents: number;
        days61to90Cents: number;
        days90plusCents: number;
        totalCents: number;
      }> = {};

      function addToCustomer(inv: typeof openInvoices[0], bucket: string) {
        const id = inv.customerId ?? "unknown";
        if (!customerMap[id]) {
          customerMap[id] = {
            customerId: id,
            customerName: inv.customer
              ? `${inv.customer.firstName} ${inv.customer.lastName}`
              : "Unknown",
            currentCents: 0,
            days1to30Cents: 0,
            days31to60Cents: 0,
            days61to90Cents: 0,
            days90plusCents: 0,
            totalCents: 0,
          };
        }
        customerMap[id][bucket as keyof typeof customerMap[string]] += inv.totalCents;
        customerMap[id].totalCents += inv.totalCents;
      }

      buckets.current.forEach((i) => addToCustomer(i, "currentCents"));
      buckets.days1to30.forEach((i) => addToCustomer(i, "days1to30Cents"));
      buckets.days31to60.forEach((i) => addToCustomer(i, "days31to60Cents"));
      buckets.days61to90.forEach((i) => addToCustomer(i, "days61to90Cents"));
      buckets.days90plus.forEach((i) => addToCustomer(i, "days90plusCents"));

      res.json({
        data: {
          summary: {
            currentCents: sumBucket(buckets.current),
            days1to30Cents: sumBucket(buckets.days1to30),
            days31to60Cents: sumBucket(buckets.days31to60),
            days61to90Cents: sumBucket(buckets.days61to90),
            days90plusCents: sumBucket(buckets.days90plus),
            totalCents: sumBucket(openInvoices),
            invoiceCount: openInvoices.length,
          },
          customers: Object.values(customerMap).sort((a, b) => b.totalCents - a.totalCents),
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

// ═══════════════════════════════════════════════════════════════════════════════
// COLLECTIONS REPORT
// ═══════════════════════════════════════════════════════════════════════════════

router.get(
  "/collections",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = (req as any).tenantId;

      const accounts = await prisma.collectionsAccount.findMany({
        where: { tenantId },
        include: {
          customer: {
            select: { id: true, firstName: true, lastName: true },
          },
        },
        orderBy: { createdAt: "desc" },
      });

      const summary = {
        totalAccounts: accounts.length,
        activeAccounts: accounts.filter((a) => a.status === "ACTIVE").length,
        totalOwedCents: accounts.reduce((s, a) => s + a.owedCents, 0),
        totalRecoveredCents: accounts.reduce((s, a) => s + a.recoveredCents, 0),
      };

      res.json({
        data: {
          summary,
          accounts: accounts.map((a) => ({
            id: a.id,
            customerId: a.customerId,
            customerName: a.customer
              ? `${a.customer.firstName} ${a.customer.lastName}`
              : "Unknown",
            status: a.status,
            owedCents: a.owedCents,
            recoveredCents: a.recoveredCents,
            agency: a.agency,
            handoffDate: a.handoffDate,
            resolutionType: a.resolutionType,
            resolvedAt: a.resolvedAt,
            createdAt: a.createdAt,
          })),
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

// ═══════════════════════════════════════════════════════════════════════════════
// RENTAL PERFORMANCE REPORT
// ═══════════════════════════════════════════════════════════════════════════════

router.get(
  "/rentals",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = (req as any).tenantId;
      const { from, to } = DateRangeSchema.parse(req.query);

      const dateFrom = from ? new Date(from) : new Date(new Date().getFullYear(), 0, 1);
      const dateTo = to ? new Date(to) : new Date();

      // Reservations in date range
      const reservations = await prisma.reservation.findMany({
        where: {
          tenantId,
          startDate: { gte: dateFrom, lte: dateTo },
        },
        include: {
          rentalProduct: { select: { id: true, name: true, category: true } },
        },
      });

      const totalBookings = reservations.length;
      const completedBookings = reservations.filter((r) => r.status === "CHECKED_OUT").length;
      const cancelledBookings = reservations.filter((r) => r.status === "CANCELLED").length;
      const noShows = reservations.filter((r) => r.status === "NO_SHOW").length;
      const revenueCents = reservations
        .filter((r) => r.status === "CHECKED_OUT")
        .reduce((s, r) => s + r.totalCents, 0);

      // Revenue by product
      const byProduct: Record<string, { name: string; bookings: number; revenueCents: number }> = {};
      for (const r of reservations.filter((r) => r.status === "CHECKED_OUT")) {
        const pid = r.rentalProductId ?? "unknown";
        if (!byProduct[pid]) {
          byProduct[pid] = {
            name: r.rentalProduct?.name ?? "Unknown",
            bookings: 0,
            revenueCents: 0,
          };
        }
        byProduct[pid].bookings++;
        byProduct[pid].revenueCents += r.totalCents;
      }

      // NPS scores
      const npsScores = await prisma.npsSurvey.findMany({
        where: {
          tenantId,
          respondedAt: { not: null },
          score: { not: null },
        },
        select: { score: true },
      });

      let npsScore: number | null = null;
      if (npsScores.length > 0) {
        const promoters = npsScores.filter((s) => (s.score ?? 0) >= 9).length;
        const detractors = npsScores.filter((s) => (s.score ?? 0) <= 6).length;
        npsScore = Math.round(((promoters - detractors) / npsScores.length) * 100);
      }

      res.json({
        data: {
          dateRange: { from: dateFrom, to: dateTo },
          totalBookings,
          completedBookings,
          cancelledBookings,
          noShows,
          cancellationRate: totalBookings > 0 ? Math.round((cancelledBookings / totalBookings) * 10000) / 100 : 0,
          revenueCents,
          averageBookingCents: completedBookings > 0 ? Math.round(revenueCents / completedBookings) : 0,
          byProduct: Object.values(byProduct).sort((a, b) => b.revenueCents - a.revenueCents),
          npsScore,
          npsResponses: npsScores.length,
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
