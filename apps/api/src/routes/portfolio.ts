import { Router, type Request, type Response, type NextFunction } from "express";
import { clerkAuth } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";

const router: Router = Router();
router.use(...clerkAuth());

// ---------------------------------------------------------------------------
// GET /api/portfolio/dashboard
// Aggregates real data across all tenants for the multi-marina overview page.
// ---------------------------------------------------------------------------
router.get(
  "/dashboard",
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const thirtyDaysOut = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

      // Build last-6-months date boundaries (oldest first)
      const monthBounds: { start: Date; end: Date; label: string }[] = [];
      for (let i = 5; i >= 0; i--) {
        const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
        const label = start.toLocaleString("en-US", { month: "short" });
        monthBounds.push({ start, end, label });
      }

      const tenants = await prisma.tenant.findMany({
        where: { status: "ACTIVE" },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      });

      const properties = await Promise.all(
        tenants.map(async (tenant) => {
          // Slip counts
          const [totalSlips, occupiedSlips] = await Promise.all([
            prisma.slip.count({ where: { tenantId: tenant.id } }),
            prisma.slip.count({ where: { tenantId: tenant.id, status: "OCCUPIED" } }),
          ]);

          // Current month revenue (paid invoices)
          const revenueAgg = await prisma.invoice.aggregate({
            where: {
              tenantId: tenant.id,
              status: "PAID",
              issuedDate: { gte: monthStart },
            },
            _sum: { totalCents: true },
          });
          const monthlyRevenue = Math.round(((revenueAgg._sum as { totalCents?: number | null }).totalCents ?? 0) / 100);

          // Total AR (outstanding balance)
          const arAgg = await prisma.invoice.aggregate({
            where: {
              tenantId: tenant.id,
              status: { in: ["ISSUED", "PAST_DUE"] },
              balanceCents: { gt: 0 },
            },
            _sum: { balanceCents: true },
          });
          const totalAR = Math.round(((arAgg._sum as { balanceCents?: number | null }).balanceCents ?? 0) / 100);

          // Active leads
          const activeLeads = await prisma.lead.count({
            where: {
              tenantId: tenant.id,
              stage: { notIn: ["LOST", "WON"] },
            },
          });

          // Compliance: boats with valid insurance & registration
          const [totalBoats, compliantBoats] = await Promise.all([
            prisma.boat.count({ where: { tenantId: tenant.id } }),
            prisma.boat.count({
              where: {
                tenantId: tenant.id,
                registrationExpiry: { gte: now },
              },
            }),
          ]);
          const compliancePct =
            totalBoats > 0 ? Math.round((compliantBoats / totalBoats) * 100) : 100;

          // Revenue history: last 6 months
          const revenueHistory = await Promise.all(
            monthBounds.map(async ({ start, end }) => {
              const agg = await prisma.invoice.aggregate({
                where: {
                  tenantId: tenant.id,
                  status: "PAID",
                  issuedDate: { gte: start, lt: end },
                },
                _sum: { totalCents: true },
              });
              return Math.round(((agg._sum as { totalCents?: number | null }).totalCents ?? 0) / 100);
            }),
          );

          return {
            id: tenant.id,
            name: tenant.name,
            totalSlips,
            occupiedSlips,
            occupancyPct:
              totalSlips > 0 ? Math.round((occupiedSlips / totalSlips) * 100) : 0,
            monthlyRevenue,
            totalAR,
            activeLeads,
            compliancePct,
            revenueHistory,
          };
        }),
      );

      // Alerts: contracts expiring in 30 days
      const expiringContracts = (await prisma.slipContract.groupBy({
        by: ["tenantId"] as const,
        where: {
          status: "ACTIVE",
          endDate: { gte: now, lte: thirtyDaysOut },
        },
        _count: { id: true },
      })) as { tenantId: string; _count: { id: number } }[];

      // Alerts: boats with expired insurance
      const expiredInsurance = (await prisma.boat.groupBy({
        by: ["tenantId"] as const,
        where: {
          registrationExpiry: { lt: now },
        },
        _count: { id: true },
      })) as { tenantId: string; _count: { id: number } }[];

      // Alerts: ACH returns pending resolution
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const achReturns = (await (prisma.achReturn as any).groupBy({
        by: ["tenantId"],
        where: { resolvedAt: null },
        _count: { id: true },
      })) as { tenantId: string; _count: { id: number } }[];

      const tenantNameMap = Object.fromEntries(tenants.map((t) => [t.id, t.name]));

      const alerts: {
        id: string;
        property: string;
        type: string;
        message: string;
        severity: string;
      }[] = [];

      for (const row of expiringContracts) {
        const n = row._count.id;
        alerts.push({
          id: `contract-${row.tenantId}`,
          property: tenantNameMap[row.tenantId] ?? row.tenantId,
          type: "contract",
          message: `${n} contract${n !== 1 ? "s" : ""} expiring within 30 days`,
          severity: n >= 10 ? "critical" : "warning",
        });
      }

      for (const row of expiredInsurance) {
        const n = row._count.id;
        alerts.push({
          id: `insurance-${row.tenantId}`,
          property: tenantNameMap[row.tenantId] ?? row.tenantId,
          type: "compliance",
          message: `${n} vessel${n !== 1 ? "s" : ""} with expired registration`,
          severity: n >= 5 ? "critical" : "warning",
        });
      }

      for (const row of achReturns) {
        const n = row._count.id;
        alerts.push({
          id: `ach-${row.tenantId}`,
          property: tenantNameMap[row.tenantId] ?? row.tenantId,
          type: "ach",
          message: `${n} ACH return${n !== 1 ? "s" : ""} pending resolution`,
          severity: "warning",
        });
      }

      res.json({
        properties,
        alerts,
        months: monthBounds.map((m) => m.label),
      });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
