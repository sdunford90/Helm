import { Router } from "express";
import { randomUUID, createHmac } from "node:crypto";
import { requirePlatformAdmin } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";
import { queues, type QueueName } from "../lib/queue.js";

const router = Router();

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
// In-memory mock store for SaaS invoices (until a SaasInvoice model exists)
// --------------------------------------------------------------------------
interface SaasInvoice {
  id: string;
  tenantId: string;
  tenantName: string;
  periodStart: string;
  periodEnd: string;
  amountCents: number;
  status: "draft" | "issued" | "paid" | "past_due";
  issuedAt: string;
  paidAt: string | null;
}

const saasInvoiceStore: SaasInvoice[] = [];

// --------------------------------------------------------------------------
// GET /api/admin/billing/invoices — list SaaS invoices
// --------------------------------------------------------------------------
router.get("/billing/invoices", async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 25));
    const status = req.query.status as string | undefined;
    const tenantId = req.query.tenantId as string | undefined;

    let filtered = [...saasInvoiceStore];
    if (status) filtered = filtered.filter((i) => i.status === status);
    if (tenantId) filtered = filtered.filter((i) => i.tenantId === tenantId);

    // Sort newest first
    filtered.sort((a, b) => new Date(b.issuedAt).getTime() - new Date(a.issuedAt).getTime());

    const total = filtered.length;
    const items = filtered.slice((page - 1) * limit, page * limit);

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
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString();

    const generated: SaasInvoice[] = [];

    for (const tenant of activeTenants) {
      if (!tenant.saasTier) continue;

      // Skip if invoice already exists for this period
      const alreadyExists = saasInvoiceStore.some(
        (i) => i.tenantId === tenant.id && i.periodStart === periodStart,
      );
      if (alreadyExists) continue;

      const invoice: SaasInvoice = {
        id: randomUUID(),
        tenantId: tenant.id,
        tenantName: tenant.name,
        periodStart,
        periodEnd,
        amountCents: tenant.saasTier.monthlyFeeCents,
        status: "issued",
        issuedAt: now.toISOString(),
        paidAt: null,
      };

      saasInvoiceStore.push(invoice);
      generated.push(invoice);
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

// ==========================================================================
//  SUPPORT
// ==========================================================================

// --------------------------------------------------------------------------
// In-memory mock store for support tickets (until a SupportTicket model exists)
// --------------------------------------------------------------------------
interface SupportTicket {
  id: string;
  tenantId: string;
  tenantName: string;
  subject: string;
  description: string;
  status: "open" | "in_progress" | "waiting_on_customer" | "resolved" | "closed";
  priority: "low" | "medium" | "high" | "urgent";
  assignedTo: string | null;
  createdAt: string;
  updatedAt: string;
}

const supportTicketStore: SupportTicket[] = [];

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

    let filtered = [...supportTicketStore];
    if (status) filtered = filtered.filter((t) => t.status === status);
    if (priority) filtered = filtered.filter((t) => t.priority === priority);
    if (tenantId) filtered = filtered.filter((t) => t.tenantId === tenantId);

    // Sort newest first
    filtered.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const total = filtered.length;
    const items = filtered.slice((page - 1) * limit, page * limit);

    res.json({
      items,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------------
// PUT /api/admin/support/tickets/:id — update ticket status
// --------------------------------------------------------------------------
router.put("/support/tickets/:id", async (req, res, next) => {
  try {
    const ticket = supportTicketStore.find((t) => t.id === req.params.id);
    if (!ticket) {
      res.status(404).json({ error: "Ticket not found" });
      return;
    }

    const { status, priority, assignedTo } = req.body;

    const validStatuses = ["open", "in_progress", "waiting_on_customer", "resolved", "closed"];
    const validPriorities = ["low", "medium", "high", "urgent"];

    if (status !== undefined) {
      if (!validStatuses.includes(status)) {
        res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(", ")}` });
        return;
      }
      ticket.status = status;
    }

    if (priority !== undefined) {
      if (!validPriorities.includes(priority)) {
        res.status(400).json({ error: `Invalid priority. Must be one of: ${validPriorities.join(", ")}` });
        return;
      }
      ticket.priority = priority;
    }

    if (assignedTo !== undefined) {
      ticket.assignedTo = assignedTo;
    }

    ticket.updatedAt = new Date().toISOString();

    res.json(ticket);
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

export default router;
