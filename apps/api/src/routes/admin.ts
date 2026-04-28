import { Router } from "express";
import { randomUUID, createHmac } from "node:crypto";
import { requirePlatformAdmin } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";
import { queues, type QueueName } from "../lib/queue.js";
import { stripe } from "../lib/stripe.js";
import {
  getCohortsReport,
  getFunnelReport,
  getFeatureUsageReport,
  cohortsToCsv,
  funnelToCsv,
  featureUsageToCsv,
  type AnalyticsRange,
} from "../services/cross-tenant-analytics.js";

const router: Router = Router();

// All admin routes require platform_admin role
router.use(...requirePlatformAdmin());

// --------------------------------------------------------------------------
// POST /api/admin/queues/pause — pause every BullMQ queue
// --------------------------------------------------------------------------
router.post("/queues/pause", async (_req, res, next) => {
  try {
    await Promise.all(Object.values(queues).map((q) => q.pause()));
    res.json({ status: "paused", queues: Object.keys(queues) });
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------------
// POST /api/admin/queues/unpause — resume every BullMQ queue
// --------------------------------------------------------------------------
router.post("/queues/unpause", async (_req, res, next) => {
  try {
    await Promise.all(Object.values(queues).map((q) => q.resume()));
    res.json({ status: "resumed", queues: Object.keys(queues) });
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------------
// GET /api/admin/queues/status — per-queue job counts
// --------------------------------------------------------------------------
router.get("/queues/status", async (_req, res, next) => {
  try {
    const statuses: Record<string, unknown> = {};

    for (const [name, queue] of Object.entries(queues) as [QueueName, typeof queues[QueueName]][]) {
      const counts = await queue.getJobCounts(
        "active",
        "completed",
        "delayed",
        "failed",
        "paused",
        "waiting",
      );
      const isPaused = await queue.isPaused();
      statuses[name] = { isPaused, counts };
    }

    res.json({ queues: statuses });
  } catch (err) {
    next(err);
  }
});

// ==========================================================================
//  TENANT MANAGEMENT
// ==========================================================================

// --------------------------------------------------------------------------
// GET /api/admin/tenants — list all tenants with filtering & pagination
// --------------------------------------------------------------------------
router.get("/tenants", async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 25));
    const search = (req.query.search as string)?.trim();
    const status = req.query.status as string | undefined;

    const where: Record<string, unknown> = {};

    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { subdomain: { contains: search, mode: "insensitive" } },
        { customDomain: { contains: search, mode: "insensitive" } },
      ];
    }

    if (status && ["ACTIVE", "GRACE_PERIOD", "LOCKED"].includes(status)) {
      where.status = status;
    }

    const [tenants, total] = await Promise.all([
      prisma.tenant.findMany({
        where,
        include: {
          saasTier: true,
          _count: { select: { users: true } },
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.tenant.count({ where }),
    ]);

    const items = tenants.map((t) => ({
      id: t.id,
      name: t.name,
      subdomain: t.subdomain,
      customDomain: t.customDomain,
      status: t.status,
      saasTier: t.saasTier ? { id: t.saasTier.id, name: t.saasTier.name } : null,
      mrrCents: t.saasTier?.monthlyFeeCents ?? 0,
      userCount: t._count.users,
      createdAt: t.createdAt,
    }));

    res.json({
      items,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------------
// GET /api/admin/tenants/:id — full tenant details
// --------------------------------------------------------------------------
router.get("/tenants/:id", async (req, res, next) => {
  try {
    const tenant = await prisma.tenant.findUnique({
      where: { id: req.params.id },
      include: {
        saasTier: true,
        users: {
          select: { id: true, email: true, role: true, firstName: true, lastName: true, active: true, createdAt: true },
        },
      },
    });

    if (!tenant) {
      res.status(404).json({ error: "Tenant not found" });
      return;
    }

    // Gather usage stats across tenant-scoped tables
    const [slipCount, customerCount, invoiceCount, paymentAgg] = await Promise.all([
      prisma.slip.count({ where: { tenantId: tenant.id } }),
      prisma.customer.count({ where: { tenantId: tenant.id } }),
      prisma.invoice.count({ where: { tenantId: tenant.id } }),
      prisma.payment.aggregate({
        where: { tenantId: tenant.id, status: "COMPLETED" },
        _sum: { amountCents: true },
        _count: true,
      }),
    ]);

    res.json({
      id: tenant.id,
      name: tenant.name,
      subdomain: tenant.subdomain,
      customDomain: tenant.customDomain,
      status: tenant.status,
      timezone: tenant.timezone,
      fiscalYearEnd: tenant.fiscalYearEnd,
      gracePeriodStartedAt: tenant.gracePeriodStartedAt,
      lockedAt: tenant.lockedAt,
      createdAt: tenant.createdAt,
      updatedAt: tenant.updatedAt,
      branding: tenant.brandingJson,
      invoiceTemplate: tenant.invoiceTemplateJson,
      connectedServices: {
        stripe: !!tenant.stripeAccountId,
        quickbooks: !!tenant.qboRealmId,
      },
      subscription: tenant.saasTier
        ? {
            tierId: tenant.saasTier.id,
            tierName: tenant.saasTier.name,
            monthlyFeeCents: tenant.saasTier.monthlyFeeCents,
            perLocationFeeCents: tenant.saasTier.perLocationFeeCents,
            achFeeRate: tenant.saasTier.achFeeRate,
            cardFeeRate: tenant.saasTier.cardFeeRate,
            storageLimitGb: tenant.saasTier.storageLimitGb,
          }
        : null,
      usage: {
        slips: slipCount,
        customers: customerCount,
        invoices: invoiceCount,
        completedPayments: paymentAgg._count,
        totalPaymentVolumeCents: paymentAgg._sum.amountCents ?? 0,
      },
      users: tenant.users,
    });
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------------
// POST /api/admin/tenants — create a new tenant
// --------------------------------------------------------------------------
router.post("/tenants", async (req, res, next) => {
  try {
    const { name, subdomain, adminEmail, saasTierId } = req.body;

    if (!name || !subdomain || !adminEmail) {
      res.status(400).json({ error: "name, subdomain, and adminEmail are required" });
      return;
    }

    // Validate subdomain format
    if (!/^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/.test(subdomain)) {
      res.status(400).json({ error: "Invalid subdomain format. Use lowercase alphanumeric and hyphens." });
      return;
    }

    // Check uniqueness
    const existing = await prisma.tenant.findUnique({ where: { subdomain } });
    if (existing) {
      res.status(409).json({ error: "Subdomain already taken" });
      return;
    }

    // Validate tier if provided
    if (saasTierId) {
      const tier = await prisma.saasTier.findUnique({ where: { id: saasTierId } });
      if (!tier) {
        res.status(400).json({ error: "Invalid SaaS tier ID" });
        return;
      }
    }

    const tenant = await prisma.tenant.create({
      data: {
        name,
        subdomain,
        saasTierId: saasTierId ?? null,
      },
    });

    // Create the initial admin user for this tenant
    await prisma.user.create({
      data: {
        tenantId: tenant.id,
        email: adminEmail,
        role: "MARINA_OWNER",
        firstName: "Admin",
        lastName: "(Pending Setup)",
      },
    });

    res.status(201).json(tenant);
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------------
// PUT /api/admin/tenants/:id — update tenant details
// --------------------------------------------------------------------------
router.put("/tenants/:id", async (req, res, next) => {
  try {
    const { status, saasTierId, customDomain, notes, name } = req.body;

    const tenant = await prisma.tenant.findUnique({ where: { id: req.params.id } });
    if (!tenant) {
      res.status(404).json({ error: "Tenant not found" });
      return;
    }

    const data: Record<string, unknown> = {};
    if (name !== undefined) data.name = name;
    if (status !== undefined) data.status = status;
    if (saasTierId !== undefined) data.saasTierId = saasTierId;
    if (customDomain !== undefined) data.customDomain = customDomain;
    // notes — stored in brandingJson as an admin-side field until a dedicated column exists
    if (notes !== undefined) {
      const existing = (tenant.brandingJson as Record<string, unknown>) ?? {};
      data.brandingJson = { ...existing, _adminNotes: notes };
    }

    const updated = await prisma.tenant.update({
      where: { id: req.params.id },
      data,
      include: { saasTier: true },
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------------
// POST /api/admin/tenants/:id/impersonate — generate impersonation token
// --------------------------------------------------------------------------
router.post("/tenants/:id/impersonate", async (req, res, next) => {
  try {
    const tenant = await prisma.tenant.findUnique({
      where: { id: req.params.id },
      include: { users: { where: { role: "MARINA_OWNER", active: true }, take: 1 } },
    });

    if (!tenant) {
      res.status(404).json({ error: "Tenant not found" });
      return;
    }

    const targetUser = tenant.users[0];
    if (!targetUser) {
      res.status(400).json({ error: "No active owner user found for this tenant" });
      return;
    }

    // Generate a short-lived impersonation token.
    // In production this would create a signed JWT via your auth provider (e.g. Clerk).
    // For now we return a verifiable HMAC-based token that downstream middleware can validate.
    const secret = process.env.IMPERSONATION_SECRET ?? "helm-impersonation-dev-key";
    const payload = {
      sub: targetUser.id,
      tenantId: tenant.id,
      email: targetUser.email,
      role: targetUser.role,
      impersonatedBy: (req as unknown as Record<string, unknown>).userId ?? "platform_admin",
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600, // 1 hour
    };
    const tokenId = randomUUID();
    const signature = createHmac("sha256", secret)
      .update(JSON.stringify({ ...payload, jti: tokenId }))
      .digest("hex");

    res.json({
      token: `imp_${tokenId}.${signature}`,
      expiresIn: 3600,
      tenantId: tenant.id,
      tenantName: tenant.name,
      asUser: { id: targetUser.id, email: targetUser.email, role: targetUser.role },
    });
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------------
// POST /api/admin/tenants/:id/lock — lock tenant (e.g., after grace period)
// --------------------------------------------------------------------------
router.post("/tenants/:id/lock", async (req, res, next) => {
  try {
    const tenant = await prisma.tenant.findUnique({ where: { id: req.params.id } });
    if (!tenant) {
      res.status(404).json({ error: "Tenant not found" });
      return;
    }
    if (tenant.status === "LOCKED") {
      res.status(400).json({ error: "Tenant is already locked" });
      return;
    }

    const updated = await prisma.tenant.update({
      where: { id: req.params.id },
      data: { status: "LOCKED", lockedAt: new Date() },
    });

    res.json({ id: updated.id, status: updated.status, lockedAt: updated.lockedAt });
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------------
// POST /api/admin/tenants/:id/unlock — unlock tenant (e.g., after payment)
// --------------------------------------------------------------------------
router.post("/tenants/:id/unlock", async (req, res, next) => {
  try {
    const tenant = await prisma.tenant.findUnique({ where: { id: req.params.id } });
    if (!tenant) {
      res.status(404).json({ error: "Tenant not found" });
      return;
    }
    if (tenant.status === "ACTIVE") {
      res.status(400).json({ error: "Tenant is already active" });
      return;
    }

    const updated = await prisma.tenant.update({
      where: { id: req.params.id },
      data: { status: "ACTIVE", lockedAt: null, gracePeriodStartedAt: null },
    });

    res.json({ id: updated.id, status: updated.status });
  } catch (err) {
    next(err);
  }
});

// ==========================================================================
//  SAAS BILLING
// ==========================================================================

// --------------------------------------------------------------------------
// GET /api/admin/billing/overview — platform revenue summary
// --------------------------------------------------------------------------
router.get("/billing/overview", async (_req, res, next) => {
  try {
    const [tenants, tiers] = await Promise.all([
      prisma.tenant.findMany({
        select: { id: true, status: true, saasTierId: true, createdAt: true },
      }),
      prisma.saasTier.findMany({ include: { _count: { select: { tenants: true } } } }),
    ]);

    const tierMap = new Map(tiers.map((t) => [t.id, t]));

    const activeTenants = tenants.filter((t) => t.status === "ACTIVE");
    const lockedTenants = tenants.filter((t) => t.status === "LOCKED");
    const gracePeriodTenants = tenants.filter((t) => t.status === "GRACE_PERIOD");

    let totalMrrCents = 0;
    for (const t of activeTenants) {
      if (t.saasTierId) {
        const tier = tierMap.get(t.saasTierId);
        if (tier) totalMrrCents += tier.monthlyFeeCents;
      }
    }

    const totalTenants = tenants.length;
    const churnRate = totalTenants > 0 ? lockedTenants.length / totalTenants : 0;
    const arpuCents = activeTenants.length > 0 ? Math.round(totalMrrCents / activeTenants.length) : 0;

    // New tenants in the last 30 days
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const newTenants = tenants.filter((t) => t.createdAt >= thirtyDaysAgo).length;

    res.json({
      totalMrrCents,
      totalArrCents: totalMrrCents * 12,
      totalTenants,
      activeTenants: activeTenants.length,
      gracePeriodTenants: gracePeriodTenants.length,
      lockedTenants: lockedTenants.length,
      churnRate: Math.round(churnRate * 10000) / 10000, // 4 decimal places
      arpuCents,
      newTenantsLast30Days: newTenants,
      tiers: tiers.map((t) => ({
        id: t.id,
        name: t.name,
        monthlyFeeCents: t.monthlyFeeCents,
        tenantCount: t._count.tenants,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------------
// GET /api/admin/billing/invoices — list SaaS invoices
// --------------------------------------------------------------------------
router.get("/billing/invoices", async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 25));
    const status = req.query.status as string | undefined;
    const tenantId = req.query.tenantId as string | undefined;

    const where: Record<string, unknown> = {};
    if (status) where.status = status;
    if (tenantId) where.tenantId = tenantId;

    const [total, rows] = await Promise.all([
      prisma.saasInvoice.count({ where }),
      prisma.saasInvoice.findMany({
        where,
        include: { tenant: { select: { id: true, name: true } } },
        orderBy: { issuedAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    const items = rows.map((inv) => ({
      id: inv.id,
      tenantId: inv.tenantId,
      tenantName: inv.tenant.name,
      periodStart: inv.periodStart.toISOString(),
      periodEnd: inv.periodEnd.toISOString(),
      amountCents: inv.amountCents,
      status: inv.status,
      issuedAt: inv.issuedAt.toISOString(),
      paidAt: inv.paidAt?.toISOString() ?? null,
    }));

    res.json({
      items,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------------
// POST /api/admin/billing/invoices/generate — generate monthly SaaS invoices
// --------------------------------------------------------------------------
router.post("/billing/invoices/generate", async (_req, res, next) => {
  try {
    const activeTenants = await prisma.tenant.findMany({
      where: { status: "ACTIVE", saasTierId: { not: null } },
      include: { saasTier: true },
    });

    const now = new Date();
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

    const generated = [];

    for (const tenant of activeTenants) {
      if (!tenant.saasTier) continue;

      // Skip if invoice already exists for this period
      const alreadyExists = await prisma.saasInvoice.findFirst({
        where: {
          tenantId: tenant.id,
          periodStart: { gte: periodStart, lte: periodStart },
        },
      });
      if (alreadyExists) continue;

      const invoice = await prisma.saasInvoice.create({
        data: {
          tenantId: tenant.id,
          periodStart,
          periodEnd,
          amountCents: tenant.saasTier.monthlyFeeCents,
          status: "issued",
        },
        include: { tenant: { select: { name: true } } },
      });

      generated.push({
        id: invoice.id,
        tenantId: invoice.tenantId,
        tenantName: invoice.tenant.name,
        periodStart: invoice.periodStart.toISOString(),
        periodEnd: invoice.periodEnd.toISOString(),
        amountCents: invoice.amountCents,
        status: invoice.status,
        issuedAt: invoice.issuedAt.toISOString(),
        paidAt: null,
      });
    }

    res.status(201).json({
      generated: generated.length,
      skipped: activeTenants.length - generated.length,
      invoices: generated,
    });
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------------
// GET /api/admin/billing/tiers — list SaaS pricing tiers
// --------------------------------------------------------------------------
router.get("/billing/tiers", async (_req, res, next) => {
  try {
    const tiers = await prisma.saasTier.findMany({
      include: { _count: { select: { tenants: true } } },
      orderBy: { monthlyFeeCents: "asc" },
    });

    res.json(
      tiers.map((t) => ({
        id: t.id,
        name: t.name,
        monthlyFeeCents: t.monthlyFeeCents,
        perLocationFeeCents: t.perLocationFeeCents,
        achFeeRate: t.achFeeRate,
        cardFeeRate: t.cardFeeRate,
        storageLimitGb: t.storageLimitGb,
        tenantCount: t._count.tenants,
      })),
    );
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------------
// PUT /api/admin/billing/tiers/:id — update tier pricing
// --------------------------------------------------------------------------
router.put("/billing/tiers/:id", async (req, res, next) => {
  try {
    const tier = await prisma.saasTier.findUnique({ where: { id: req.params.id } });
    if (!tier) {
      res.status(404).json({ error: "Tier not found" });
      return;
    }

    const allowedFields = [
      "name",
      "monthlyFeeCents",
      "perLocationFeeCents",
      "achFeeRate",
      "cardFeeRate",
      "storageLimitGb",
    ] as const;

    const data: Record<string, unknown> = {};
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        data[field] = req.body[field];
      }
    }

    if (Object.keys(data).length === 0) {
      res.status(400).json({ error: "No valid fields to update" });
      return;
    }

    const updated = await prisma.saasTier.update({
      where: { id: req.params.id },
      data,
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// ==========================================================================
//  PLATFORM ANALYTICS
// ==========================================================================

// --------------------------------------------------------------------------
// GET /api/admin/analytics/overview — platform-wide KPIs
// --------------------------------------------------------------------------
router.get("/analytics/overview", async (_req, res, next) => {
  try {
    const [
      totalSlips,
      totalCustomers,
      totalInvoices,
      paymentAgg,
      posAgg,
      transientAgg,
      rampAgg,
      tenantCount,
    ] = await Promise.all([
      prisma.slip.count(),
      prisma.customer.count(),
      prisma.invoice.count(),
      prisma.payment.aggregate({
        where: { status: "COMPLETED" },
        _sum: { amountCents: true },
        _count: true,
      }),
      prisma.posTransaction.aggregate({
        where: { status: "completed" },
        _sum: { totalCents: true },
        _count: true,
      }),
      prisma.transientBooking.aggregate({
        _sum: { totalCents: true },
        _count: true,
      }),
      prisma.rampTicket.aggregate({
        _sum: { amountCents: true },
        _count: true,
      }),
      prisma.tenant.count(),
    ]);

    const totalPaymentVolumeCents = paymentAgg._sum.amountCents ?? 0;
    const totalPosVolumeCents = posAgg._sum.totalCents ?? 0;
    const totalTransientVolumeCents = transientAgg._sum.totalCents ?? 0;
    const totalRampVolumeCents = rampAgg._sum.amountCents ?? 0;

    const totalGmvCents =
      totalPaymentVolumeCents + totalPosVolumeCents + totalTransientVolumeCents + totalRampVolumeCents;

    // Platform fee revenue: sum MRR from all active tenants
    const activeTenants = await prisma.tenant.findMany({
      where: { status: "ACTIVE", saasTierId: { not: null } },
      include: { saasTier: true },
    });
    const platformFeeRevenueCents = activeTenants.reduce(
      (sum, t) => sum + (t.saasTier?.monthlyFeeCents ?? 0),
      0,
    );

    res.json({
      totalSlips,
      totalCustomers,
      totalInvoices,
      totalTransactions: paymentAgg._count + posAgg._count + transientAgg._count + rampAgg._count,
      totalGmvCents,
      breakdown: {
        slipPaymentsCents: totalPaymentVolumeCents,
        posTransactionsCents: totalPosVolumeCents,
        transientBookingsCents: totalTransientVolumeCents,
        rampTicketsCents: totalRampVolumeCents,
      },
      platformFeeRevenueMrrCents: platformFeeRevenueCents,
      tenantCount,
    });
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------------
// GET /api/admin/analytics/tenants — tenant health scores & usage metrics
// --------------------------------------------------------------------------
router.get("/analytics/tenants", async (_req, res, next) => {
  try {
    const tenants = await prisma.tenant.findMany({
      include: {
        saasTier: true,
        _count: { select: { users: true } },
      },
    });

    // Gather per-tenant metrics in parallel
    const tenantMetrics = await Promise.all(
      tenants.map(async (tenant) => {
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

        const [slipCount, customerCount, recentPayments, recentInvoices] = await Promise.all([
          prisma.slip.count({ where: { tenantId: tenant.id } }),
          prisma.customer.count({ where: { tenantId: tenant.id } }),
          prisma.payment.count({
            where: { tenantId: tenant.id, createdAt: { gte: thirtyDaysAgo } },
          }),
          prisma.invoice.count({
            where: { tenantId: tenant.id, createdAt: { gte: thirtyDaysAgo } },
          }),
        ]);

        // Simple health score: 0-100
        // Factors: has active users, recent activity (payments/invoices), slip utilization
        let healthScore = 0;
        if (tenant.status === "ACTIVE") healthScore += 30;
        else if (tenant.status === "GRACE_PERIOD") healthScore += 10;
        if (tenant._count.users > 0) healthScore += 15;
        if (recentPayments > 0) healthScore += 25;
        if (recentInvoices > 0) healthScore += 15;
        if (slipCount > 0) healthScore += 15;

        const atRisk =
          tenant.status === "GRACE_PERIOD" ||
          (tenant.status === "ACTIVE" && recentPayments === 0 && recentInvoices === 0);

        return {
          id: tenant.id,
          name: tenant.name,
          subdomain: tenant.subdomain,
          status: tenant.status,
          saasTier: tenant.saasTier?.name ?? null,
          mrrCents: tenant.saasTier?.monthlyFeeCents ?? 0,
          healthScore,
          atRisk,
          usage: {
            users: tenant._count.users,
            slips: slipCount,
            customers: customerCount,
            recentPayments,
            recentInvoices,
          },
        };
      }),
    );

    // Sort by health score ascending so at-risk tenants are first
    tenantMetrics.sort((a, b) => a.healthScore - b.healthScore);

    const atRiskCount = tenantMetrics.filter((t) => t.atRisk).length;

    res.json({
      total: tenantMetrics.length,
      atRiskCount,
      tenants: tenantMetrics,
    });
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------------
// Cross-tenant analytics: cohorts, funnel, per-tier feature usage
// --------------------------------------------------------------------------

class InvalidRangeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidRangeError";
  }
}

function parseRange(req: { query: Record<string, unknown> }): AnalyticsRange {
  const now = new Date();
  // Default window: first day 12 months ago → end of today (UTC).
  const defaultFrom = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1),
  );
  const defaultTo = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999),
  );

  const fromRaw = typeof req.query.from === "string" ? req.query.from : undefined;
  const toRaw = typeof req.query.to === "string" ? req.query.to : undefined;

  const from = fromRaw ? new Date(`${fromRaw}T00:00:00Z`) : defaultFrom;
  const to = toRaw ? new Date(`${toRaw}T23:59:59.999Z`) : defaultTo;

  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    throw new InvalidRangeError(
      "Invalid date range. Use YYYY-MM-DD for `from` and `to`.",
    );
  }
  if (from.getTime() > to.getTime()) {
    throw new InvalidRangeError(
      "Invalid date range: `from` must be on or before `to`.",
    );
  }
  return { from, to };
}

function sendCsv(res: import("express").Response, filename: string, body: string): void {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(body);
}

router.get("/analytics/cohorts", async (req, res, next) => {
  try {
    const range = parseRange(req);
    const report = await getCohortsReport(range);
    if (req.query.format === "csv") {
      sendCsv(res, "cohorts.csv", cohortsToCsv(report));
      return;
    }
    res.json(report);
  } catch (err) {
    if (err instanceof InvalidRangeError) {
      res.status(400).json({ error: err.message });
      return;
    }
    next(err);
  }
});

router.get("/analytics/funnel", async (req, res, next) => {
  try {
    const range = parseRange(req);
    const report = await getFunnelReport(range);
    if (req.query.format === "csv") {
      sendCsv(res, "trial-to-paid-funnel.csv", funnelToCsv(report));
      return;
    }
    res.json(report);
  } catch (err) {
    if (err instanceof InvalidRangeError) {
      res.status(400).json({ error: err.message });
      return;
    }
    next(err);
  }
});

router.get("/analytics/feature-usage", async (req, res, next) => {
  try {
    const range = parseRange(req);
    const report = await getFeatureUsageReport(range);
    if (req.query.format === "csv") {
      sendCsv(res, "feature-usage.csv", featureUsageToCsv(report));
      return;
    }
    res.json(report);
  } catch (err) {
    if (err instanceof InvalidRangeError) {
      res.status(400).json({ error: err.message });
      return;
    }
    next(err);
  }
});

// ==========================================================================
//  SUPPORT
// ==========================================================================

// --------------------------------------------------------------------------
// GET /api/admin/support/tickets — list support tickets across all tenants
// --------------------------------------------------------------------------
router.get("/support/tickets", async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 25));
    const status = req.query.status as string | undefined;
    const priority = req.query.priority as string | undefined;
    const tenantId = req.query.tenantId as string | undefined;

    const where: Record<string, unknown> = {};
    if (status) where.status = status;
    if (priority) where.priority = priority;
    if (tenantId) where.tenantId = tenantId;

    const [total, rows] = await Promise.all([
      prisma.supportTicket.count({ where }),
      prisma.supportTicket.findMany({
        where,
        include: { tenant: { select: { id: true, name: true } } },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    const items = rows.map((t) => ({
      id: t.id,
      tenantId: t.tenantId,
      tenantName: t.tenant.name,
      subject: t.subject,
      description: t.description,
      status: t.status,
      priority: t.priority,
      assignedTo: t.assignedTo,
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
    }));

    res.json({ items, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------------
// POST /api/admin/support/tickets — create a support ticket (from tenant)
// --------------------------------------------------------------------------
router.post("/support/tickets", async (req, res, next) => {
  try {
    const { tenantId, subject, description, priority = "medium" } = req.body;
    if (!tenantId || !subject || !description) {
      res.status(400).json({ error: "tenantId, subject, and description are required" });
      return;
    }
    const ticket = await prisma.supportTicket.create({
      data: { tenantId, subject, description, priority, status: "open" },
      include: { tenant: { select: { name: true } } },
    });
    res.status(201).json({
      id: ticket.id,
      tenantId: ticket.tenantId,
      tenantName: ticket.tenant.name,
      subject: ticket.subject,
      description: ticket.description,
      status: ticket.status,
      priority: ticket.priority,
      assignedTo: ticket.assignedTo,
      createdAt: ticket.createdAt.toISOString(),
      updatedAt: ticket.updatedAt.toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------------
// PUT /api/admin/support/tickets/:id — update ticket status / priority
// --------------------------------------------------------------------------
router.put("/support/tickets/:id", async (req, res, next) => {
  try {
    const existing = await prisma.supportTicket.findUnique({ where: { id: req.params.id } });
    if (!existing) {
      res.status(404).json({ error: "Ticket not found" });
      return;
    }

    const { status, priority, assignedTo } = req.body;
    const validStatuses = ["open", "in_progress", "waiting_on_customer", "resolved", "closed"];
    const validPriorities = ["low", "medium", "high", "urgent"];

    if (status !== undefined && !validStatuses.includes(status)) {
      res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(", ")}` });
      return;
    }
    if (priority !== undefined && !validPriorities.includes(priority)) {
      res.status(400).json({ error: `Invalid priority. Must be one of: ${validPriorities.join(", ")}` });
      return;
    }

    const data: Record<string, unknown> = {};
    if (status !== undefined) data.status = status;
    if (priority !== undefined) data.priority = priority;
    if (assignedTo !== undefined) data.assignedTo = assignedTo;

    const updated = await prisma.supportTicket.update({
      where: { id: req.params.id },
      data,
      include: { tenant: { select: { name: true } } },
    });

    res.json({
      id: updated.id,
      tenantId: updated.tenantId,
      tenantName: updated.tenant.name,
      subject: updated.subject,
      description: updated.description,
      status: updated.status,
      priority: updated.priority,
      assignedTo: updated.assignedTo,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

// ==========================================================================
//  LOCATION MANAGEMENT  (per-tenant)
// ==========================================================================

// GET /api/admin/tenants/:id/locations
router.get("/tenants/:id/locations", async (req, res, next) => {
  try {
    const locations = await prisma.location.findMany({
      where: { tenantId: req.params.id },
      orderBy: { name: "asc" },
    });
    res.json(locations);
  } catch (err) { next(err); }
});

// POST /api/admin/tenants/:id/locations
router.post("/tenants/:id/locations", async (req, res, next) => {
  try {
    const { name, address, city, state, zip, phone, timezone, active } = req.body;
    if (!name) {
      res.status(400).json({ error: "name is required" });
      return;
    }
    const location = await prisma.location.create({
      data: {
        tenantId: req.params.id,
        name,
        address: address ?? null,
        city: city ?? null,
        state: state ?? null,
        zip: zip ?? null,
        phone: phone ?? null,
        timezone: timezone ?? "America/New_York",
        active: active !== false,
      },
    });
    res.status(201).json(location);
  } catch (err) { next(err); }
});

// PUT /api/admin/tenants/:id/locations/:locationId
router.put("/tenants/:id/locations/:locationId", async (req, res, next) => {
  try {
    const { name, address, city, state, zip, phone, timezone, active } = req.body;
    const location = await prisma.location.update({
      where: { id: req.params.locationId },
      data: {
        ...(name !== undefined && { name }),
        ...(address !== undefined && { address }),
        ...(city !== undefined && { city }),
        ...(state !== undefined && { state }),
        ...(zip !== undefined && { zip }),
        ...(phone !== undefined && { phone }),
        ...(timezone !== undefined && { timezone }),
        ...(active !== undefined && { active }),
      },
    });
    res.json(location);
  } catch (err) { next(err); }
});

// DELETE /api/admin/tenants/:id/locations/:locationId
router.delete("/tenants/:id/locations/:locationId", async (req, res, next) => {
  try {
    await prisma.location.delete({ where: { id: req.params.locationId } });
    res.status(204).send();
  } catch (err) { next(err); }
});

// ==========================================================================
//  PLATFORM HEALTH MONITORING
//
//  Cross-tenant infrastructure dashboard. The Health page in the admin
//  console hits these endpoints every 30s to surface stuck queues, failing
//  webhooks, expired QBO tokens, and broken Stripe Connect accounts in one
//  place. Each metric is intentionally summary-only — the failure drilldown
//  endpoints serve the recent-records lists.
// ==========================================================================

const HEALTH_24H_MS = 24 * 60 * 60 * 1000;

// Cap the number of jobs we pull from BullMQ when computing 24h stats.
// `getJobs` walks Redis sorted sets newest-first; once we hit a record
// older than the 24h window we stop early, so this is a hard ceiling
// rather than a typical pull. The response includes a `truncated` flag
// per queue when the cap is hit so the UI can warn that the success
// rate may undercount on extremely high-volume queues.
const HEALTH_JOB_SCAN_LIMIT = 5000;

// --------------------------------------------------------------------------
// GET /api/admin/health/system — queues, jobs, webhooks, API errors (24h)
// --------------------------------------------------------------------------
router.get("/health/system", async (_req, res, next) => {
  try {
    const since = new Date(Date.now() - HEALTH_24H_MS);
    const sinceMs = since.getTime();

    // -- Queues: current depth + 24h completed/failed counters per worker.
    const queueStats = await Promise.all(
      (Object.entries(queues) as [QueueName, typeof queues[QueueName]][]).map(
        async ([name, queue]) => {
          const [counts, isPaused, completed, failed] = await Promise.all([
            queue.getJobCounts("active", "waiting", "delayed", "failed", "paused", "completed"),
            queue.isPaused(),
            queue.getJobs(["completed"], 0, HEALTH_JOB_SCAN_LIMIT - 1, false),
            queue.getJobs(["failed"], 0, HEALTH_JOB_SCAN_LIMIT - 1, false),
          ]);

          // Bucket completed/failed jobs into 24 hourly slots so the UI can
          // render a sparkline. finishedOn is a unix-ms timestamp on Job.
          const completedRecent = completed.filter(
            (j) => typeof j.finishedOn === "number" && j.finishedOn >= sinceMs,
          );
          const failedRecent = failed.filter(
            (j) => typeof j.finishedOn === "number" && j.finishedOn >= sinceMs,
          );

          const sparkline = bucketByHour(
            failedRecent.map((j) => j.finishedOn as number),
            sinceMs,
          );

          const total = completedRecent.length + failedRecent.length;
          const successRate = total === 0 ? 1 : completedRecent.length / total;

          // If the underlying scan returned at the cap AND every job in
          // it falls inside the 24h window, we know we may be truncating
          // older entries from the same hour and should warn the UI.
          const truncated =
            (completed.length === HEALTH_JOB_SCAN_LIMIT &&
              completedRecent.length === completed.length) ||
            (failed.length === HEALTH_JOB_SCAN_LIMIT &&
              failedRecent.length === failed.length);

          return {
            name,
            isPaused,
            counts,
            jobs24h: {
              completed: completedRecent.length,
              failed: failedRecent.length,
              successRate,
              failedSparkline: sparkline,
              truncated,
            },
          };
        },
      ),
    );

    // -- Webhook deliveries (last 24h)
    //
    // ProcessedWebhook stores the Stripe event.type in `status`, so we can
    // partition delivered events into Connect-related (account.*, capability.*,
    // payout.*) and Payments-related (everything else: payment_intent.*,
    // charge.*, invoice.*, checkout.*, customer.subscription.*, etc.).
    //
    // We pair that with audit-log rows containing FAILED to compute a real
    // payments-webhook delivery success rate — those audit entries are how
    // payment_intent.payment_failed and similar events are recorded.
    const [stripeWebhooksAll, paymentFailures, qboWebhooksAll] = await Promise.all([
      prisma.processedWebhook.findMany({
        where: { processedAt: { gte: since } },
        select: { processedAt: true, status: true },
      }),
      prisma.auditLog.findMany({
        where: {
          createdAt: { gte: since },
          recordType: "Payment",
          action: { contains: "FAILED" },
        },
        select: { createdAt: true },
      }),
      prisma.qboWebhookDelivery.findMany({
        where: { receivedAt: { gte: since } },
        select: { receivedAt: true, status: true },
      }),
    ]);

    const isConnectEvent = (status: string): boolean =>
      status.startsWith("account.") ||
      status.startsWith("capability.") ||
      status.startsWith("payout.") ||
      status.startsWith("person.") ||
      status.startsWith("external_account.") ||
      status.startsWith("topup.") ||
      status.startsWith("transfer.");

    const stripeConnectDeliveries = stripeWebhooksAll.filter((r) => isConnectEvent(r.status));
    const stripePaymentDeliveries = stripeWebhooksAll.filter((r) => !isConnectEvent(r.status));

    const paymentDelivered = stripePaymentDeliveries.length;
    const paymentFailedCount = paymentFailures.length;
    const paymentTotal = paymentDelivered + paymentFailedCount;

    const stripePayments = {
      total: paymentTotal,
      delivered: paymentDelivered,
      failed: paymentFailedCount,
      successRate: paymentTotal === 0 ? 1 : paymentDelivered / paymentTotal,
      sparkline: bucketByHour(
        paymentFailures.map((r) => r.createdAt.getTime()),
        sinceMs,
      ),
    };

    const stripeConnectWebhooks = {
      total: stripeConnectDeliveries.length,
      delivered: stripeConnectDeliveries.length,
      failed: 0,
      successRate: 1,
      sparkline: bucketByHour(
        stripeConnectDeliveries.map((r) => r.processedAt.getTime()),
        sinceMs,
      ),
    };

    const qboFailed = qboWebhooksAll.filter((d) => d.status === "FAILED");
    const qboPending = qboWebhooksAll.filter((d) => d.status === "PENDING");
    const qboProcessed = qboWebhooksAll.filter((d) => d.status === "PROCESSED");
    const qboTotal = qboWebhooksAll.length;
    const qboWebhooks = {
      total: qboTotal,
      processed: qboProcessed.length,
      failed: qboFailed.length,
      pending: qboPending.length,
      successRate: qboTotal === 0 ? 1 : qboProcessed.length / qboTotal,
      sparkline: bucketByHour(
        qboFailed.map((d) => d.receivedAt.getTime()),
        sinceMs,
      ),
    };

    // -- API errors grouped by tenant (last 24h)
    // Audit-log actions that contain FAILED are how the rest of the app
    // records payment failures, sync failures, payout failures, etc.
    const errorRows = await prisma.auditLog.findMany({
      where: {
        createdAt: { gte: since },
        action: { contains: "FAILED" },
      },
      select: { tenantId: true, action: true, createdAt: true },
    });

    const errorsByTenant = new Map<string, number>();
    for (const row of errorRows) {
      errorsByTenant.set(row.tenantId, (errorsByTenant.get(row.tenantId) ?? 0) + 1);
    }
    const tenantNames = new Map<string, string>();
    if (errorsByTenant.size > 0) {
      const tenantIds = [...errorsByTenant.keys()];
      const t = await prisma.tenant.findMany({
        where: { id: { in: tenantIds } },
        select: { id: true, name: true },
      });
      for (const row of t) tenantNames.set(row.id, row.name);
    }
    const apiErrors = {
      total: errorRows.length,
      sparkline: bucketByHour(
        errorRows.map((r) => r.createdAt.getTime()),
        sinceMs,
      ),
      byTenant: [...errorsByTenant.entries()]
        .map(([tenantId, count]) => ({
          tenantId,
          tenantName: tenantNames.get(tenantId) ?? tenantId,
          count,
        }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10),
    };

    res.json({
      generatedAt: new Date().toISOString(),
      windowHours: 24,
      queues: queueStats,
      webhooks: {
        stripePayments,
        stripeConnect: stripeConnectWebhooks,
        qbo: qboWebhooks,
      },
      apiErrors,
    });
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------------
// GET /api/admin/health/system/failures — recent failed records
//
// Drilldown for the sparkline links on the System tab. The `type` query
// selects the failure source: a specific queue's failed jobs, recent
// failed QBO webhook deliveries, or recent FAILED-action audit log
// entries (which is how Stripe payment / payout failures are recorded).
// --------------------------------------------------------------------------
router.get("/health/system/failures", async (req, res, next) => {
  try {
    const type = (req.query.type as string | undefined) ?? "audit-errors";
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 25));

    if (type === "queue") {
      const queueName = req.query.queue as QueueName | undefined;
      if (!queueName || !(queueName in queues)) {
        res.status(400).json({ error: "Valid `queue` query param required" });
        return;
      }
      const failed = await queues[queueName].getJobs(["failed"], 0, limit - 1, false);
      res.json({
        type,
        queue: queueName,
        items: failed.map((job) => ({
          id: job.id,
          name: job.name,
          failedAt: job.finishedOn ? new Date(job.finishedOn).toISOString() : null,
          attemptsMade: job.attemptsMade,
          failedReason: job.failedReason ?? null,
          stacktrace: Array.isArray(job.stacktrace) ? job.stacktrace.slice(0, 3) : null,
          dataPreview: safeJsonPreview(job.data),
        })),
      });
      return;
    }

    if (type === "qbo-webhooks") {
      const rows = await prisma.qboWebhookDelivery.findMany({
        where: { status: "FAILED" },
        orderBy: { receivedAt: "desc" },
        take: limit,
        select: {
          id: true,
          realmId: true,
          tenantId: true,
          locationId: true,
          attempts: true,
          lastError: true,
          receivedAt: true,
          processedAt: true,
        },
      });
      const tenantNames = await loadTenantNameMap(rows.map((r) => r.tenantId));
      res.json({
        type,
        items: rows.map((r) => ({
          id: r.id,
          tenantId: r.tenantId,
          tenantName: r.tenantId ? tenantNames.get(r.tenantId) ?? null : null,
          locationId: r.locationId,
          realmId: r.realmId,
          attempts: r.attempts,
          error: r.lastError,
          receivedAt: r.receivedAt.toISOString(),
          processedAt: r.processedAt?.toISOString() ?? null,
        })),
      });
      return;
    }

    if (type === "qbo-syncs") {
      const rows = await prisma.qboInventorySyncRef.findMany({
        where: { lastError: { not: null } },
        orderBy: { lastErrorAt: "desc" },
        take: limit,
        select: {
          id: true,
          tenantId: true,
          locationId: true,
          sourceType: true,
          sourceId: true,
          qboType: true,
          retryCount: true,
          lastError: true,
          lastErrorAt: true,
          nextRetryAt: true,
        },
      });
      const tenantNames = await loadTenantNameMap(rows.map((r) => r.tenantId));
      res.json({
        type,
        items: rows.map((r) => ({
          id: r.id,
          tenantId: r.tenantId,
          tenantName: tenantNames.get(r.tenantId) ?? null,
          locationId: r.locationId,
          sourceType: r.sourceType,
          sourceId: r.sourceId,
          qboType: r.qboType,
          retryCount: r.retryCount,
          error: r.lastError,
          erroredAt: r.lastErrorAt?.toISOString() ?? null,
          nextRetryAt: r.nextRetryAt?.toISOString() ?? null,
        })),
      });
      return;
    }

    // Default — recent FAILED audit-log entries (payments, payouts, etc.)
    const tenantId = req.query.tenantId as string | undefined;
    const since = new Date(Date.now() - HEALTH_24H_MS);
    const rows = await prisma.auditLog.findMany({
      where: {
        createdAt: { gte: since },
        action: { contains: "FAILED" },
        ...(tenantId ? { tenantId } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true,
        tenantId: true,
        recordType: true,
        recordId: true,
        action: true,
        changedFieldsJson: true,
        createdAt: true,
      },
    });
    const tenantNames = await loadTenantNameMap(rows.map((r) => r.tenantId));
    res.json({
      type: "audit-errors",
      items: rows.map((r) => ({
        id: r.id,
        tenantId: r.tenantId,
        tenantName: tenantNames.get(r.tenantId) ?? null,
        recordType: r.recordType,
        recordId: r.recordId,
        action: r.action,
        details: r.changedFieldsJson,
        occurredAt: r.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------------
// GET /api/admin/health/stripe-connect — cross-tenant Stripe Connect status
//
// Lists every connected Stripe account (per location, with tenant-level
// fallback for legacy single-account marinas). Pulls cached capability
// data from the most recent STRIPE_ACCOUNT_UPDATED audit log entry for
// each account, plus the most recent successful Payment as a "last
// activity" signal (we don't currently persist payout.paid events, so
// the latest captured payment is the closest readily-available proxy).
// --------------------------------------------------------------------------
router.get("/health/stripe-connect", async (_req, res, next) => {
  try {
    const [locationRows, tenantRows] = await Promise.all([
      prisma.location.findMany({
        where: { stripeAccountId: { not: null } },
        select: {
          id: true,
          name: true,
          tenantId: true,
          stripeAccountId: true,
          stripeOnboardingComplete: true,
          tenant: { select: { id: true, name: true } },
        },
      }),
      prisma.tenant.findMany({
        where: { stripeAccountId: { not: null } },
        select: { id: true, name: true, stripeAccountId: true },
      }),
    ]);

    type Account = {
      scope: "location" | "tenant";
      id: string;
      tenantId: string;
      tenantName: string;
      locationId: string | null;
      locationName: string | null;
      stripeAccountId: string;
      onboardingComplete: boolean;
    };

    // Tenants whose stripeAccountId is also referenced by a location are
    // legacy duplicates — surface only the per-location row to avoid double
    // counting.
    const locationAccountIds = new Set(
      locationRows.map((l) => l.stripeAccountId).filter(Boolean),
    );

    const accounts: Account[] = [
      ...locationRows.map(
        (l): Account => ({
          scope: "location" as const,
          id: l.id,
          tenantId: l.tenantId,
          tenantName: l.tenant.name,
          locationId: l.id,
          locationName: l.name,
          stripeAccountId: l.stripeAccountId!,
          onboardingComplete: l.stripeOnboardingComplete,
        }),
      ),
      ...tenantRows
        .filter((t) => !locationAccountIds.has(t.stripeAccountId!))
        .map(
          (t): Account => ({
            scope: "tenant" as const,
            id: t.id,
            tenantId: t.id,
            tenantName: t.name,
            locationId: null,
            locationName: null,
            stripeAccountId: t.stripeAccountId!,
            onboardingComplete: false,
          }),
        ),
    ];

    // Capability cache — pull the most recent STRIPE_ACCOUNT_UPDATED audit
    // log per (tenant + scope) so we can show charges_enabled / details_submitted
    // without hitting Stripe on every render.
    const capabilityRows = await prisma.auditLog.findMany({
      where: {
        action: "STRIPE_ACCOUNT_UPDATED",
        tenantId: { in: accounts.map((a) => a.tenantId) },
      },
      orderBy: { createdAt: "desc" },
      select: {
        tenantId: true,
        recordType: true,
        recordId: true,
        changedFieldsJson: true,
        createdAt: true,
      },
    });

    const capabilityByKey = new Map<
      string,
      {
        chargesEnabled: boolean;
        payoutsEnabled: boolean;
        detailsSubmitted: boolean;
        refreshedAt: Date;
      }
    >();
    for (const row of capabilityRows) {
      const key = capabilityKey(row.recordType, row.recordId);
      if (capabilityByKey.has(key)) continue;
      const j = (row.changedFieldsJson ?? {}) as Record<string, unknown>;
      capabilityByKey.set(key, {
        chargesEnabled: j.chargesEnabled === true,
        // Older audit-log rows (pre-Health) didn't capture payoutsEnabled.
        // Treat them as "unknown" by falling back to chargesEnabled — payouts
        // generally trail charges, so this only over-reports on a small
        // number of legacy rows until the next webhook fires.
        payoutsEnabled:
          typeof j.payoutsEnabled === "boolean"
            ? j.payoutsEnabled
            : j.chargesEnabled === true,
        detailsSubmitted: j.detailsSubmitted === true,
        refreshedAt: row.createdAt,
      });
    }

    // Last successful payment per account-scope, as the "last activity"
    // signal. Group via JS so we run a single query.
    const completedPayments = await prisma.payment.findMany({
      where: {
        tenantId: { in: accounts.map((a) => a.tenantId) },
        status: "COMPLETED",
      },
      orderBy: { createdAt: "desc" },
      take: 500,
      select: {
        id: true,
        tenantId: true,
        amountCents: true,
        createdAt: true,
        invoice: { select: { locationId: true } },
      },
    });

    const lastPaymentByKey = new Map<
      string,
      { id: string; amountCents: number; createdAt: Date }
    >();
    for (const p of completedPayments) {
      const locId = p.invoice?.locationId ?? null;
      const key = `${p.tenantId}:${locId ?? "tenant"}`;
      if (lastPaymentByKey.has(key)) continue;
      lastPaymentByKey.set(key, {
        id: p.id,
        amountCents: p.amountCents,
        createdAt: p.createdAt,
      });
    }

    const items = accounts.map((a) => {
      const capKey = capabilityKey(
        a.scope === "location" ? "Location" : "Tenant",
        a.locationId ?? a.tenantId,
      );
      const cap = capabilityByKey.get(capKey);
      const lastPayKey = `${a.tenantId}:${a.locationId ?? "tenant"}`;
      const lastPayment = lastPaymentByKey.get(lastPayKey);

      // Missing requirements are anything we can flag from cached data.
      const missingRequirements: string[] = [];
      // Tenant-scope accounts don't have a per-record onboarding flag in
      // our schema (only Location.stripeOnboardingComplete exists), so
      // suppress this marker for tenant rows to avoid a permanently
      // misleading "onboarding_incomplete" tag once charges are live.
      if (a.scope === "location" && !a.onboardingComplete) {
        missingRequirements.push("onboarding_incomplete");
      }
      if (cap && !cap.chargesEnabled) missingRequirements.push("charges_disabled");
      if (cap && !cap.payoutsEnabled) missingRequirements.push("payouts_disabled");
      if (cap && !cap.detailsSubmitted) missingRequirements.push("details_pending");

      // Status: green only when both charges AND payouts are live (the
      // account can actually accept money and disburse it). Amber when the
      // account is technically onboarded but we have no fresh capability
      // data, or charges work but payouts don't. Red otherwise.
      const fullyLive = cap?.chargesEnabled && cap.payoutsEnabled;
      const partiallyLive = cap?.chargesEnabled && !cap.payoutsEnabled;
      const onboardedNoCap =
        !cap && (a.scope === "tenant" || a.onboardingComplete);
      const status: "ok" | "warning" | "broken" = fullyLive
        ? "ok"
        : partiallyLive || onboardedNoCap
          ? "warning"
          : "broken";

      return {
        scope: a.scope,
        id: a.id,
        tenantId: a.tenantId,
        tenantName: a.tenantName,
        locationId: a.locationId,
        locationName: a.locationName,
        stripeAccountId: a.stripeAccountId,
        onboardingComplete: a.onboardingComplete,
        chargesEnabled: cap?.chargesEnabled ?? null,
        payoutsEnabled: cap?.payoutsEnabled ?? null,
        detailsSubmitted: cap?.detailsSubmitted ?? null,
        capabilityRefreshedAt: cap?.refreshedAt.toISOString() ?? null,
        missingRequirements,
        status,
        lastSuccessfulActivity: lastPayment
          ? {
              type: "payment",
              paymentId: lastPayment.id,
              amountCents: lastPayment.amountCents,
              at: lastPayment.createdAt.toISOString(),
            }
          : null,
      };
    });

    items.sort((a, b) => {
      const order = { broken: 0, warning: 1, ok: 2 } as const;
      if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status];
      return a.tenantName.localeCompare(b.tenantName);
    });

    res.json({
      generatedAt: new Date().toISOString(),
      total: items.length,
      brokenCount: items.filter((i) => i.status === "broken").length,
      warningCount: items.filter((i) => i.status === "warning").length,
      items,
    });
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------------
// POST /api/admin/health/stripe-connect/refresh
//
// Pull the latest capability state from Stripe for one connected account
// and persist it as a STRIPE_ACCOUNT_UPDATED audit log entry (the same
// shape the webhook handler writes), so subsequent GETs see fresh data.
// --------------------------------------------------------------------------
router.post("/health/stripe-connect/refresh", async (req, res, next) => {
  try {
    const { stripeAccountId, scope, recordId, tenantId } = req.body ?? {};
    if (!stripeAccountId || !scope || !recordId || !tenantId) {
      res.status(400).json({
        error: "stripeAccountId, scope ('location'|'tenant'), recordId and tenantId are required",
      });
      return;
    }
    if (!stripe) {
      res.status(503).json({ error: "Stripe is not configured on this environment" });
      return;
    }

    let chargesEnabled = false;
    let payoutsEnabled = false;
    let detailsSubmitted = false;
    try {
      // v1 accounts.retrieve returns the standard Account shape with
      // capabilities; v2-only accounts may need v2.core.accounts.retrieve.
      // Try v1 first and fall through on type mismatch.
      const account = (await stripe.accounts.retrieve(stripeAccountId)) as {
        charges_enabled?: boolean;
        payouts_enabled?: boolean;
        details_submitted?: boolean;
      };
      chargesEnabled = account.charges_enabled === true;
      payoutsEnabled = account.payouts_enabled === true;
      detailsSubmitted = account.details_submitted === true;
    } catch (err) {
      // Fall back to v2 endpoint — Stripe SDK casts this off the typed surface.
      try {
        const v2Accounts = (stripe as unknown as {
          v2?: {
            core?: {
              accounts?: {
                retrieve: (id: string) => Promise<{
                  configuration?: {
                    merchant?: { capabilities?: Record<string, { status?: string }> };
                  };
                  identity?: { business_details?: { registered_name?: string } };
                  requirements?: { currently_due?: string[]; eventually_due?: string[] };
                }>;
              };
            };
          };
        }).v2?.core?.accounts;
        if (!v2Accounts) throw err;
        const v2Account = await v2Accounts.retrieve(stripeAccountId);
        const caps = v2Account.configuration?.merchant?.capabilities ?? {};
        chargesEnabled = caps.card_payments?.status === "active";
        payoutsEnabled = caps.transfers?.status === "active";
        detailsSubmitted =
          (v2Account.requirements?.currently_due ?? []).length === 0;
      } catch (innerErr) {
        const message = innerErr instanceof Error ? innerErr.message : String(innerErr);
        res.status(502).json({ error: `Stripe lookup failed: ${message}` });
        return;
      }
    }

    if (scope === "location") {
      // Mirror the webhook handler: flip onboarding flag when charges enabled.
      if (chargesEnabled) {
        await prisma.location.updateMany({
          where: { id: recordId, tenantId },
          data: { stripeOnboardingComplete: true },
        });
      }
    }

    await prisma.auditLog.create({
      data: {
        tenantId,
        recordType: scope === "location" ? "Location" : "Tenant",
        recordId,
        action: "STRIPE_ACCOUNT_UPDATED",
        changedFieldsJson: {
          eventType: "manual.refresh",
          chargesEnabled,
          payoutsEnabled,
          detailsSubmitted,
          source: "platform-admin-health",
        },
      },
    });

    res.json({ stripeAccountId, chargesEnabled, payoutsEnabled, detailsSubmitted });
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------------
// GET /api/admin/health/quickbooks — cross-tenant QBO connection health
//
// Per-location and per-tenant QBO connections, with token expiry, last
// successful sync (the most recent of qboLastSyncAt / qboLastVendorPullAt
// / qboLastBillPullAt), the most recent sync error, and the count of
// failed sync refs awaiting retry.
// --------------------------------------------------------------------------
router.get("/health/quickbooks", async (req, res, next) => {
  try {
    const reconnectOnly = req.query.reconnect === "true";

    const [locationRows, tenantRows] = await Promise.all([
      prisma.location.findMany({
        where: { qboRealmId: { not: null } },
        select: {
          id: true,
          name: true,
          tenantId: true,
          qboRealmId: true,
          qboCompanyName: true,
          qboTokenExpiresAt: true,
          qboConnectedAt: true,
          qboLastVendorPullAt: true,
          qboLastBillPullAt: true,
          tenant: { select: { id: true, name: true } },
        },
      }),
      prisma.tenant.findMany({
        where: { qboRealmId: { not: null } },
        select: {
          id: true,
          name: true,
          qboRealmId: true,
          qboTokenExpiresAt: true,
          qboConnectedAt: true,
          qboLastVendorPullAt: true,
          qboLastBillPullAt: true,
        },
      }),
    ]);

    const locationRealmIds = new Set(
      locationRows.map((l) => l.qboRealmId).filter(Boolean),
    );

    type Connection = {
      scope: "location" | "tenant";
      id: string;
      tenantId: string;
      tenantName: string;
      locationId: string | null;
      locationName: string | null;
      realmId: string;
      companyName: string | null;
      tokenExpiresAt: Date | null;
      connectedAt: Date | null;
      lastVendorPullAt: Date | null;
      lastBillPullAt: Date | null;
    };

    const connections: Connection[] = [
      ...locationRows.map(
        (l): Connection => ({
          scope: "location" as const,
          id: l.id,
          tenantId: l.tenantId,
          tenantName: l.tenant.name,
          locationId: l.id,
          locationName: l.name,
          realmId: l.qboRealmId!,
          companyName: l.qboCompanyName ?? null,
          tokenExpiresAt: l.qboTokenExpiresAt,
          connectedAt: l.qboConnectedAt,
          lastVendorPullAt: l.qboLastVendorPullAt,
          lastBillPullAt: l.qboLastBillPullAt,
        }),
      ),
      ...tenantRows
        .filter((t) => !locationRealmIds.has(t.qboRealmId!))
        .map(
          (t): Connection => ({
            scope: "tenant" as const,
            id: t.id,
            tenantId: t.id,
            tenantName: t.name,
            locationId: null,
            locationName: null,
            realmId: t.qboRealmId!,
            companyName: null,
            tokenExpiresAt: t.qboTokenExpiresAt,
            connectedAt: t.qboConnectedAt,
            lastVendorPullAt: t.qboLastVendorPullAt,
            lastBillPullAt: t.qboLastBillPullAt,
          }),
        ),
    ];

    // Recent sync errors and pending retries per (tenant, location).
    const syncErrorRows = await prisma.qboInventorySyncRef.findMany({
      where: {
        tenantId: { in: connections.map((c) => c.tenantId) },
        lastError: { not: null },
      },
      orderBy: { lastErrorAt: "desc" },
      select: {
        tenantId: true,
        locationId: true,
        lastError: true,
        lastErrorAt: true,
      },
    });

    const errorsByKey = new Map<
      string,
      { count: number; lastError: string | null; lastErrorAt: Date | null }
    >();
    for (const row of syncErrorRows) {
      const key = `${row.tenantId}:${row.locationId ?? "tenant"}`;
      const cur = errorsByKey.get(key);
      if (cur) {
        cur.count += 1;
      } else {
        errorsByKey.set(key, {
          count: 1,
          lastError: row.lastError,
          lastErrorAt: row.lastErrorAt,
        });
      }
    }

    // Pending webhook deliveries — failed deliveries are functionally
    // "awaiting retry" until an operator replays them.
    const pendingWebhooks = await prisma.qboWebhookDelivery.groupBy({
      by: ["tenantId", "locationId"],
      where: {
        tenantId: { in: connections.map((c) => c.tenantId) },
        status: { in: ["FAILED", "PENDING"] },
      },
      _count: { _all: true },
    });
    const pendingWebhooksByKey = new Map<string, number>();
    for (const row of pendingWebhooks) {
      if (!row.tenantId) continue;
      const key = `${row.tenantId}:${row.locationId ?? "tenant"}`;
      pendingWebhooksByKey.set(key, (pendingWebhooksByKey.get(key) ?? 0) + row._count._all);
    }

    const now = Date.now();
    const items = connections
      .map((c) => {
        // qboLastSyncAt isn't a real Prisma field on Tenant — the existing
        // qbo-sync code only writes vendor/bill pull timestamps. Use those
        // as the canonical "last successful sync" signal.
        const lastSync = mostRecent(c.lastVendorPullAt, c.lastBillPullAt);
        const errKey = `${c.tenantId}:${c.locationId ?? "tenant"}`;
        const err = errorsByKey.get(errKey);
        const pendingRetries =
          (errorsByKey.get(errKey)?.count ?? 0) +
          (pendingWebhooksByKey.get(errKey) ?? 0);

        const tokenExpiresInMs = c.tokenExpiresAt
          ? c.tokenExpiresAt.getTime() - now
          : null;
        const reconnectRequired =
          !c.tokenExpiresAt || (tokenExpiresInMs !== null && tokenExpiresInMs <= 0);
        const expiringSoon =
          !reconnectRequired &&
          tokenExpiresInMs !== null &&
          tokenExpiresInMs < 7 * 24 * 60 * 60 * 1000;

        const status: "ok" | "warning" | "broken" = reconnectRequired
          ? "broken"
          : err || expiringSoon
            ? "warning"
            : "ok";

        return {
          scope: c.scope,
          id: c.id,
          tenantId: c.tenantId,
          tenantName: c.tenantName,
          locationId: c.locationId,
          locationName: c.locationName,
          realmId: c.realmId,
          companyName: c.companyName,
          tokenExpiresAt: c.tokenExpiresAt?.toISOString() ?? null,
          tokenExpiresInDays:
            tokenExpiresInMs !== null
              ? Math.round(tokenExpiresInMs / (24 * 60 * 60 * 1000))
              : null,
          connectedAt: c.connectedAt?.toISOString() ?? null,
          lastSuccessfulSyncAt: lastSync?.toISOString() ?? null,
          lastSyncError: err?.lastError ?? null,
          lastSyncErrorAt: err?.lastErrorAt?.toISOString() ?? null,
          pendingRetryCount: pendingRetries,
          reconnectRequired,
          status,
        };
      })
      .filter((row) => (reconnectOnly ? row.reconnectRequired : true))
      .sort((a, b) => {
        const order = { broken: 0, warning: 1, ok: 2 } as const;
        if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status];
        return a.tenantName.localeCompare(b.tenantName);
      });

    res.json({
      generatedAt: new Date().toISOString(),
      total: items.length,
      brokenCount: items.filter((i) => i.status === "broken").length,
      warningCount: items.filter((i) => i.status === "warning").length,
      items,
    });
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------------
// Health helpers
// --------------------------------------------------------------------------

function bucketByHour(timestamps: number[], sinceMs: number): number[] {
  // Always 24 buckets — index 0 = oldest hour, index 23 = current hour.
  const buckets = new Array(24).fill(0);
  for (const t of timestamps) {
    const idx = Math.min(23, Math.max(0, Math.floor((t - sinceMs) / (60 * 60 * 1000))));
    buckets[idx] += 1;
  }
  return buckets;
}

function capabilityKey(recordType: string, recordId: string): string {
  return `${recordType}:${recordId}`;
}

async function loadTenantNameMap(
  ids: Array<string | null>,
): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => !!id))];
  if (unique.length === 0) return new Map();
  const rows = await prisma.tenant.findMany({
    where: { id: { in: unique } },
    select: { id: true, name: true },
  });
  return new Map(rows.map((r) => [r.id, r.name]));
}

function mostRecent(...dates: Array<Date | null | undefined>): Date | null {
  let max: Date | null = null;
  for (const d of dates) {
    if (!d) continue;
    if (!max || d > max) max = d;
  }
  return max;
}

function safeJsonPreview(value: unknown): unknown {
  try {
    const json = JSON.stringify(value);
    if (json.length <= 500) return value;
    return `${json.slice(0, 500)}…`;
  } catch {
    return null;
  }
}

export default router;
