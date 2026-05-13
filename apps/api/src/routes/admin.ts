import { Router, type Request, type Response, type NextFunction } from "express";
import { randomUUID } from "node:crypto";
import { requireAuth, getAuth } from "@clerk/express";
import {
  requirePlatformAdmin,
  requireAdminRole,
  ADMIN_ROLES,
  isAdminRole,
} from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";
import { queues, type QueueName } from "../lib/queue.js";
import { stripe } from "../lib/stripe.js";
import { logAdminAction, logAdminActionDetached } from "../lib/admin-audit.js";
import {
  runTenantExport,
  publicExportView,
} from "../services/tenant-export.js";
import { GRACE_PERIOD_MS } from "../services/tenant-deletion.js";
import { processDelivery as processQboDelivery } from "../services/qbo-webhook-deliveries.js";
import {
  getCohortsReport,
  getFunnelReport,
  getFeatureUsageReport,
  cohortsToCsv,
  funnelToCsv,
  featureUsageToCsv,
  type AnalyticsRange,
} from "../services/cross-tenant-analytics.js";
import {
  getPlatformHealth,
  getTenantBenchmarks,
  getSupportSlaReport,
  getReliabilityReport,
  getAdoptionReport,
} from "../services/admin-insights.js";
import {
  BillingError,
  BillingLocationSelect,
  openPortalForLocation,
  startCheckoutForLocation,
} from "../services/saas-billing-service.js";
import { recordAdminEvent } from "../lib/admin-audit.js";
import { mintImpersonationToken } from "../lib/impersonation-token.js";

import {
  REFUND_REASONS,
  type RefundReason,
  applyPlanChange,
  applyTrialExtensionToGrace,
  computeCouponDiscount,
  consumeCouponRedemption,
  previewPlanChange,
  saasInvoiceOutstandingCents,
} from "../services/saas-billing-depth.js";
import { sendEmail } from "../lib/email.js";
const router: Router = Router();

// --------------------------------------------------------------------------
// GET /api/admin/me — returns whether the current Clerk user is a Platform
// Admin. Mounted BEFORE requirePlatformAdmin so unauthorized users can call
// it without getting a 403 — the admin SPA uses it to decide whether to
// render the dashboard chrome or a "no access" screen.
//
// Honours ENABLE_AUTH_DEV_BYPASS the same way the rest of the auth stack
// does so the admin SPA's own dev-bypass shortcut keeps working end-to-end.
// --------------------------------------------------------------------------
function isDevBypassEnabled(): boolean {
  return (
    process.env.ENABLE_AUTH_DEV_BYPASS === "true" &&
    process.env.NODE_ENV !== "production"
  );
}

if (isDevBypassEnabled()) {
  router.get("/me", async (_req, res, next) => {
    try {
      const user = await prisma.user.findFirst({
        where: { role: "PLATFORM_ADMIN" },
        select: {
          id: true,
          email: true,
          role: true,
          adminRole: true,
          firstName: true,
          lastName: true,
        },
      });
      // Surface adminRole at the top level so useAdminMe in the admin SPA
      // can read it without unwrapping the user object.
      res.json({
        isPlatformAdmin: true,
        user: user ?? null,
        id: user?.id ?? null,
        email: user?.email ?? null,
        firstName: user?.firstName ?? null,
        lastName: user?.lastName ?? null,
        role: user?.role ?? null,
        adminRole: user?.adminRole ?? "SUPERUSER",
      });
    } catch (err) {
      next(err);
    }
  });
} else {
  router.get(
    "/me",
    requireAuth(),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const auth = getAuth(req);
        const clerkUserId = auth.userId;
        if (!clerkUserId) {
          res
            .status(401)
            .json({ error: "Unauthorized", code: "UNAUTHORIZED" });
          return;
        }

        // A Clerk user can theoretically map to multiple internal User rows
        // (one per tenant). They count as a Platform Admin if any of those
        // rows has the PLATFORM_ADMIN role — same predicate used by
        // requirePlatformAdmin.
        const adminUser = await prisma.user.findFirst({
          where: { clerkUserId, role: "PLATFORM_ADMIN" },
          select: {
            id: true,
            email: true,
            role: true,
            adminRole: true,
            firstName: true,
            lastName: true,
          },
        });

        if (adminUser) {
          res.json({
            isPlatformAdmin: true,
            user: adminUser,
            id: adminUser.id,
            email: adminUser.email,
            firstName: adminUser.firstName,
            lastName: adminUser.lastName,
            role: adminUser.role,
            adminRole: adminUser.adminRole ?? "READ_ONLY_SUPPORT",
          });
          return;
        }

        // Not a Platform Admin — still surface basic identity so the
        // "no access" screen can show who they're signed in as.
        const anyUser = await prisma.user.findFirst({
          where: { clerkUserId },
          select: {
            id: true,
            email: true,
            role: true,
            firstName: true,
            lastName: true,
          },
        });

        res.json({
          isPlatformAdmin: false,
          user: anyUser ?? null,
          id: anyUser?.id ?? null,
          email: anyUser?.email ?? null,
          firstName: anyUser?.firstName ?? null,
          lastName: anyUser?.lastName ?? null,
          role: anyUser?.role ?? null,
          adminRole: null,
        });
      } catch (err) {
        next(err);
      }
    },
  );
}

// All other admin routes require platform_admin role
router.use(...requirePlatformAdmin());

// READ_ONLY_SUPPORT can read everything but mutate nothing. The two helpers
// below are passed as middleware on every mutation handler that the
// governance task introduces.
const allowAnyAdmin = requireAdminRole(...ADMIN_ROLES);
const allowMutations = requireAdminRole("SUPERUSER", "BILLING_ADMIN");
const allowSuperuserOnly = requireAdminRole("SUPERUSER");

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

//  TENANT MANAGEMENT

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

    if (status && ["TRIAL", "ACTIVE", "GRACE_PERIOD", "LOCKED"].includes(status)) {
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
      trialStartedAt: t.trialStartedAt,
      trialEndsAt: t.trialEndsAt,
      assignedAdminUserId: t.assignedAdminUserId,
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
// GET /api/admin/tenants/trials — trial onboarding tracker
//
// Returns every tenant currently on a trial (status=TRIAL) with a derived
// onboarding checklist + stalled-trial flag. The checklist items are
// computed from existing tenant data so we don't need separate
// progress-tracking columns:
//
//   account_created       → tenant row exists (always true)
//   first_user_invited    → at least one User in addition to the seeded owner
//   first_location_setup  → at least one Location row
//   first_customer_added  → at least one Customer row
//   first_invoice_sent    → at least one Invoice not in DRAFT
//   first_payment_received→ at least one Payment with status=COMPLETED
//   integrations_connected→ Stripe OR QBO connected on tenant or any Location
//
// Stalled = no checklist progress timestamp newer than `stalledAfterDays`
// (default 5). The "progress timestamp" is the most recent createdAt
// across the items above plus qboConnectedAt for integration connect time.
// --------------------------------------------------------------------------
router.get("/tenants/trials", async (req, res, next) => {
  try {
    const stalledAfterDays = Math.max(
      1,
      Math.min(60, parseInt(req.query.stalledAfterDays as string) || 5),
    );
    const onlyStalled = req.query.onlyStalled === "true";

    const tenants = await prisma.tenant.findMany({
      where: { status: "TRIAL" },
      include: {
        saasTier: { select: { id: true, name: true, monthlyFeeCents: true } },
        users: { select: { id: true, createdAt: true, role: true, active: true } },
        locations: {
          select: {
            id: true,
            createdAt: true,
            stripeAccountId: true,
            qboRealmId: true,
            qboConnectedAt: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    const tenantIds = tenants.map((t) => t.id);

    // Aggregate the data-driven checklist signals in bulk so we don't
    // round-trip per tenant.
    const [customerStats, invoiceStats, paymentStats] = await Promise.all([
      prisma.customer.groupBy({
        by: ["tenantId"],
        where: { tenantId: { in: tenantIds } },
        _count: { _all: true },
        _max: { createdAt: true },
      }),
      prisma.invoice.groupBy({
        by: ["tenantId"],
        where: { tenantId: { in: tenantIds }, status: { not: "DRAFT" } },
        _count: { _all: true },
        _max: { createdAt: true },
      }),
      prisma.payment.groupBy({
        by: ["tenantId"],
        where: { tenantId: { in: tenantIds }, status: "COMPLETED" },
        _count: { _all: true },
        _max: { createdAt: true },
      }),
    ]);

    const byTenant = <T extends { tenantId: string }>(rows: T[]) =>
      new Map(rows.map((r) => [r.tenantId, r]));
    const customerMap = byTenant(customerStats);
    const invoiceMap = byTenant(invoiceStats);
    const paymentMap = byTenant(paymentStats);

    const now = Date.now();
    const stalledCutoff = new Date(now - stalledAfterDays * 24 * 60 * 60 * 1000);

    const items = tenants.map((t) => {
      const c = customerMap.get(t.id);
      const i = invoiceMap.get(t.id);
      const p = paymentMap.get(t.id);

      const ownerOnly = t.users.length <= 1;
      const stripeConnected =
        !!t.stripeAccountId || t.locations.some((l) => !!l.stripeAccountId);
      const qboConnected =
        !!t.qboRealmId || t.locations.some((l) => !!l.qboRealmId);
      const integrationsConnected = stripeConnected || qboConnected;

      // Best-effort "when did integrations last get connected?" — combine
      // every timestamp we have evidence of:
      //   - qboConnectedAt on tenant + each location
      //   - createdAt of any location whose stripeAccountId is set (we
      //     don't store a stripeConnectedAt, so the location's createdAt
      //     is the closest proxy)
      //   - tenant.updatedAt as a fallback when the tenant itself has a
      //     stripeAccountId but no per-row connection timestamp
      // Without this, Stripe-only tenants appear "stalled" because their
      // integration completion never lands in lastProgressAt.
      const integrationTimes: Date[] = [
        t.qboConnectedAt,
        ...t.locations.map((l) => l.qboConnectedAt),
        ...t.locations
          .filter((l) => !!l.stripeAccountId)
          .map((l) => l.createdAt),
      ].filter((d): d is Date => !!d);
      if (t.stripeAccountId) integrationTimes.push(t.updatedAt);
      const lastIntegrationConnected =
        integrationTimes.length > 0
          ? new Date(Math.max(...integrationTimes.map((d) => d.getTime())))
          : null;

      const userTimes = t.users.map((u) => u.createdAt.getTime());
      const lastUserCreated =
        userTimes.length > 0 ? new Date(Math.max(...userTimes)) : null;

      const locationTimes = t.locations.map((l) => l.createdAt.getTime());
      const lastLocationCreated =
        locationTimes.length > 0
          ? new Date(Math.max(...locationTimes))
          : null;

      const checklist = [
        { key: "account_created", label: "Account created", complete: true,
          completedAt: t.createdAt },
        { key: "first_user_invited", label: "First user invited",
          complete: !ownerOnly,
          completedAt: !ownerOnly ? lastUserCreated : null },
        { key: "first_location_setup", label: "First location set up",
          complete: t.locations.length > 0,
          completedAt: lastLocationCreated },
        { key: "first_customer_added", label: "First customer added",
          complete: (c?._count?._all ?? 0) > 0,
          completedAt: c?._max?.createdAt ?? null },
        { key: "first_invoice_sent", label: "First invoice sent",
          complete: (i?._count?._all ?? 0) > 0,
          completedAt: i?._max?.createdAt ?? null },
        { key: "first_payment_received", label: "First payment received",
          complete: (p?._count?._all ?? 0) > 0,
          completedAt: p?._max?.createdAt ?? null },
        { key: "integrations_connected", label: "Integrations connected",
          complete: integrationsConnected,
          completedAt: integrationsConnected ? lastIntegrationConnected : null },
      ];

      const completed = checklist.filter((c) => c.complete).length;
      const total = checklist.length;
      const pctComplete = Math.round((completed / total) * 100);

      // "Last progress" — newest completion timestamp across the checklist.
      const allTimes = checklist
        .map((c) => c.completedAt?.getTime())
        .filter((t): t is number => typeof t === "number");
      const lastProgressAt = allTimes.length
        ? new Date(Math.max(...allTimes))
        : t.createdAt;

      const stalled =
        completed < total && lastProgressAt < stalledCutoff;

      const trialDaysRemaining = t.trialEndsAt
        ? Math.ceil((t.trialEndsAt.getTime() - now) / (24 * 60 * 60 * 1000))
        : null;

      return {
        id: t.id,
        name: t.name,
        subdomain: t.subdomain,
        status: t.status,
        saasTier: t.saasTier
          ? {
              id: t.saasTier.id,
              name: t.saasTier.name,
              monthlyFeeCents: t.saasTier.monthlyFeeCents,
            }
          : null,
        createdAt: t.createdAt,
        trialStartedAt: t.trialStartedAt ?? t.createdAt,
        trialEndsAt: t.trialEndsAt,
        trialDaysRemaining,
        assignedAdminUserId: t.assignedAdminUserId,
        checklist,
        completed,
        total,
        pctComplete,
        lastProgressAt,
        stalled,
      };
    });

    const filtered = onlyStalled ? items.filter((i) => i.stalled) : items;

    res.json({
      total: items.length,
      stalledCount: items.filter((i) => i.stalled).length,
      stalledAfterDays,
      items: filtered,
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

    // Resolve assigned admin (best-effort) so the UI can show a name.
    let assignedAdmin: { id: string; firstName: string; lastName: string; email: string } | null = null;
    if (tenant.assignedAdminUserId) {
      const u = await prisma.user.findUnique({
        where: { id: tenant.assignedAdminUserId },
        select: { id: true, firstName: true, lastName: true, email: true },
      });
      if (u) assignedAdmin = u;
    }

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
      trialStartedAt: tenant.trialStartedAt,
      trialEndsAt: tenant.trialEndsAt,
      assignedAdminUserId: tenant.assignedAdminUserId,
      assignedAdmin,
      createdAt: tenant.createdAt,
      updatedAt: tenant.updatedAt,
      branding: tenant.brandingJson,
      invoiceTemplate: tenant.invoiceTemplateJson,
      connectedServices: {
        stripe: !!tenant.stripeAccountId,
        quickbooks: !!tenant.qboRealmId,
      },
      // Subscriptions now live on Location, but for back-compat we still
      // surface the tenant's legacy default tier here so the existing UI
      // doesn't break in one shot. The Locations tab is the source of truth.
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
    const {
      name,
      subdomain,
      adminEmail,
      saasTierId,
      initialLocation,
    } = req.body as {
      name?: string;
      subdomain?: string;
      adminEmail?: string;
      saasTierId?: string | null;
      initialLocation?: {
        name?: string;
        timezone?: string;
        address?: string;
        city?: string;
        state?: string;
        zip?: string;
        phone?: string;
      };
    };

    // ── Validation ─────────────────────────────────────────────
    if (!name || !subdomain || !adminEmail) {
      res.status(400).json({
        error: "name, subdomain, and adminEmail are required",
      });
      return;
    }

    if (!/^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/.test(subdomain)) {
      res.status(400).json({
        error:
          "Invalid subdomain. Use lowercase letters, numbers, and hyphens (3+ chars).",
      });
      return;
    }

    // Basic email shape check — full RFC validation is overkill here.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) {
      res.status(400).json({ error: "Invalid admin email address" });
      return;
    }

    if (!initialLocation?.name || !initialLocation.name.trim()) {
      res.status(400).json({
        error:
          "An initial location is required. A tenant with no locations cannot be billed or operated.",
      });
      return;
    }

    const existing = await prisma.tenant.findUnique({ where: { subdomain } });
    if (existing) {
      res.status(409).json({ error: "Subdomain already taken" });
      return;
    }

    if (saasTierId) {
      const tier = await prisma.saasTier.findUnique({ where: { id: saasTierId } });
      if (!tier) {
        res.status(400).json({ error: "Invalid SaaS tier ID" });
        return;
      }
    }

    // ── Atomic create: tenant + initial location + initial owner user ──
    const result = await prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: { name, subdomain },
      });

      const location = await tx.location.create({
        data: {
          tenantId: tenant.id,
          name: initialLocation.name!.trim(),
          timezone: initialLocation.timezone?.trim() || "America/New_York",
          address: initialLocation.address?.trim() || null,
          city: initialLocation.city?.trim() || null,
          state: initialLocation.state?.trim() || null,
          zip: initialLocation.zip?.trim() || null,
          phone: initialLocation.phone?.trim() || null,
          // Per the new model, the SaaS tier is attached to the location
          // (= the marina that gets billed) rather than the tenant.
          saasTierId: saasTierId ?? null,
          accountingGracePeriodEndsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
      });

      await tx.user.create({
        data: {
          tenantId: tenant.id,
          email: adminEmail,
          role: "MARINA_OWNER",
          firstName: "Admin",
          lastName: "(Pending Setup)",
        },
      });

      return { tenant, location };
    });

    await logAdminAction(req, {
      action: "TENANT_CREATE",
      targetTenantId: result.tenant.id,
      targetType: "TENANT",
      targetId: result.tenant.id,
      details: {
        name: result.tenant.name,
        subdomain: result.tenant.subdomain,
        initialLocationId: result.location.id,
      },
    });

    res.status(201).json({
      ...result.tenant,
      initialLocation: { id: result.location.id, name: result.location.name },
    });
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
    // A11: require a reason at mint time. Stored in the audit metadata so
    // the impersonation log explains *why* the session happened. Trimmed
    // and length-capped to keep the audit feed sane.
    const reasonRaw = (req.body && typeof req.body.reason === "string") ? req.body.reason : "";
    const reason = reasonRaw.trim();
    if (!reason) {
      res.status(400).json({
        error: "Reason is required to start an impersonation session.",
        code: "IMPERSONATION_REASON_REQUIRED",
      });
      return;
    }
    if (reason.length > 500) {
      res.status(400).json({ error: "Reason must be 500 characters or fewer." });
      return;
    }

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

    // Mint a short-lived (1h) signed impersonation token. The payload travels
    // inside the token (b64url) and is verified by the public
    // /api/impersonation/{verify,end} endpoints — no shared server-side state
    // is required. The IMPERSONATION_SECRET env var is mandatory.
    const ttlSeconds = 3600;
    const adminUserId = req.userId ?? "platform_admin";
    const adminEmail = (req as { userRecord?: { email?: string } }).userRecord?.email
      ?? "platform_admin";

    let minted;
    try {
      minted = mintImpersonationToken({
        sub: targetUser.id,
        email: targetUser.email,
        role: targetUser.role,
        tenantId: tenant.id,
        tenantSubdomain: tenant.subdomain,
        tenantName: tenant.name,
        impersonatedBy: adminUserId,
        adminEmail,
        ttlSeconds,
      });
    } catch (e) {
      res.status(503).json({
        error: "Impersonation is not configured on this server (IMPERSONATION_SECRET is missing).",
      });
      return;
    }

    await recordAdminEvent(req, "IMPERSONATION_STARTED", {
      tenantId: tenant.id,
      metadata: {
        tokenId: minted.tokenId,
        targetUserId: targetUser.id,
        targetEmail: targetUser.email,
        expiresInSec: ttlSeconds,
        reason,
      },
    });

    res.json({
      token: minted.token,
      tokenId: minted.tokenId,
      expiresIn: ttlSeconds,
      expiresAt: minted.expiresAt.toISOString(),
      tenantId: tenant.id,
      tenantName: tenant.name,
      tenantSubdomain: tenant.subdomain,
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

    await recordAdminEvent(req, "TENANT_LOCKED", { tenantId: updated.id });

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

    await recordAdminEvent(req, "TENANT_UNLOCKED", { tenantId: updated.id });

    res.json({ id: updated.id, status: updated.status });
  } catch (err) {
    next(err);
  }
});

//  SAAS BILLING

// --------------------------------------------------------------------------
// POST /api/admin/locations/:locationId/billing/checkout
// Platform admin starts a Stripe Checkout session for a location that does
// not yet have a subscription. Returns the hosted Checkout URL which the
// admin can copy and send to the marina owner (or open directly).
// --------------------------------------------------------------------------
router.post("/locations/:locationId/billing/checkout", async (req, res, next) => {
  try {
    const location = await prisma.location.findUnique({
      where: { id: req.params.locationId },
      select: BillingLocationSelect,
    });
    if (!location) {
      res.status(404).json({ error: "Location not found", code: "NOT_FOUND" });
      return;
    }
    const result = await startCheckoutForLocation(location, req.body ?? {});
    res.json(result);
  } catch (err) {
    if (err instanceof BillingError) {
      res.status(err.status).json({ error: err.message, code: err.code });
      return;
    }
    next(err);
  }
});

// --------------------------------------------------------------------------
// POST /api/admin/locations/:locationId/billing/portal
// Platform admin generates a Stripe Customer Portal link for an existing
// per-location subscription. Useful for support: admins can hand the link
// to a marina owner who needs to update payment method or cancel.
// --------------------------------------------------------------------------
router.post("/locations/:locationId/billing/portal", async (req, res, next) => {
  try {
    const location = await prisma.location.findUnique({
      where: { id: req.params.locationId },
      select: BillingLocationSelect,
    });
    if (!location) {
      res.status(404).json({ error: "Location not found", code: "NOT_FOUND" });
      return;
    }
    const result = await openPortalForLocation(location);
    res.json(result);
  } catch (err) {
    if (err instanceof BillingError) {
      res.status(err.status).json({ error: err.message, code: err.code });
      return;
    }
    next(err);
  }
});

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
      discountCents: inv.discountCents,
      refundedCents: inv.refundedCents,
      prorationCents: inv.prorationCents,
      outstandingCents: saasInvoiceOutstandingCents(inv),
      status: inv.status,
      issuedAt: inv.issuedAt.toISOString(),
      dueDate: inv.dueDate?.toISOString() ?? null,
      paidAt: inv.paidAt?.toISOString() ?? null,
      failedAttempts: inv.failedAttempts,
      lastAttemptAt: inv.lastAttemptAt?.toISOString() ?? null,
      dunningPaused: inv.dunningPaused,
      pausedUntil: inv.pausedUntil?.toISOString() ?? null,
      writeOffAt: inv.writeOffAt?.toISOString() ?? null,
      writeOffReason: inv.writeOffReason,
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
    const dueDate = new Date(now.getFullYear(), now.getMonth(), 15);

    const generated = [];
    let skipped = 0;
    let prorationLineCount = 0;

    for (const tenant of activeTenants) {
      if (!tenant.saasTier) continue;

      const alreadyExists = await prisma.saasInvoice.findFirst({
        where: {
          tenantId: tenant.id,
          periodStart: { gte: periodStart, lte: periodStart },
        },
      });
      if (alreadyExists) {
        skipped++;
        continue;
      }

      const baseAmount = tenant.saasTier.monthlyFeeCents;
      const discount = await computeCouponDiscount(tenant.id, baseAmount);

      // Aggregate any unbilled plan-change proration into THIS invoice
      // as one line (sum of all pending change deltas). This is the
      // "appears on the next SaaS invoice" semantic.
      const pendingChanges = await prisma.saasPlanChange.findMany({
        where: { tenantId: tenant.id, appliedToInvoiceId: null },
      });
      const prorationTotal = pendingChanges.reduce(
        (sum, c) => sum + c.prorationCents,
        0,
      );

      const invoice = await prisma.saasInvoice.create({
        data: {
          tenantId: tenant.id,
          periodStart,
          periodEnd,
          dueDate,
          amountCents: baseAmount,
          prorationCents: prorationTotal,
          discountCents: discount.discountCents,
          couponRedemptionId: discount.redemptionId,
          status: "issued",
        },
        include: { tenant: { select: { name: true } } },
      });

      if (discount.redemptionId) {
        await consumeCouponRedemption(discount.redemptionId, invoice.id);
      }

      if (pendingChanges.length > 0) {
        await prisma.saasPlanChange.updateMany({
          where: { id: { in: pendingChanges.map((c) => c.id) } },
          data: { appliedToInvoiceId: invoice.id },
        });
        prorationLineCount += pendingChanges.length;
      }

      generated.push({
        id: invoice.id,
        tenantId: invoice.tenantId,
        tenantName: invoice.tenant.name,
        periodStart: invoice.periodStart.toISOString(),
        periodEnd: invoice.periodEnd.toISOString(),
        amountCents: invoice.amountCents,
        discountCents: invoice.discountCents,
        prorationCents: invoice.prorationCents,
        status: invoice.status,
        issuedAt: invoice.issuedAt.toISOString(),
        paidAt: null,
      });
    }

    res.status(201).json({
      generated: generated.length,
      prorationLines: prorationLineCount,
      skipped,
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

    res.json({
      tiers: tiers.map((t) => ({
        id: t.id,
        name: t.name,
        monthlyFeeCents: t.monthlyFeeCents,
        perLocationFeeCents: t.perLocationFeeCents,
        achFeeRate: t.achFeeRate,
        cardFeeRate: t.cardFeeRate,
        storageLimitGb: t.storageLimitGb,
        tenantCount: t._count.tenants,
      })),
    });
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

//  PLATFORM ANALYTICS / INSIGHTS

// --------------------------------------------------------------------------
// A7 — Cross-Tenant Insights sub-pages. Each call is a self-contained
// aggregation in `services/admin-insights.ts`; the routes are thin.
// --------------------------------------------------------------------------
router.get("/insights/platform-health", async (_req, res, next) => {
  try {
    res.json(await getPlatformHealth());
  } catch (err) {
    next(err);
  }
});

router.get("/insights/tenant-benchmarks", async (_req, res, next) => {
  try {
    res.json(await getTenantBenchmarks());
  } catch (err) {
    next(err);
  }
});

router.get("/insights/support-sla", async (_req, res, next) => {
  try {
    res.json(await getSupportSlaReport());
  } catch (err) {
    next(err);
  }
});

router.get("/insights/reliability", async (_req, res, next) => {
  try {
    res.json(await getReliabilityReport());
  } catch (err) {
    next(err);
  }
});

router.get("/insights/adoption", async (_req, res, next) => {
  try {
    res.json(await getAdoptionReport());
  } catch (err) {
    next(err);
  }
});

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
//  DASHBOARD SUMMARY
//
// Aggregate KPIs the admin Dashboard renders at the top of the page. The
// admin SPA used to render hard-coded numbers here; this endpoint is the
// single source of truth so the dashboard reflects real platform state.
// All values are computed from the live DB so a fresh prod install starts
// with all-zeros instead of inventing fake activity.
// ==========================================================================

router.get("/dashboard/summary", async (_req, res, next) => {
  try {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [
      tenants,
      tiers,
      slipCount,
      openTickets,
      monthPayments,
      monthPos,
      monthTransient,
      monthRamp,
    ] = await Promise.all([
      prisma.tenant.findMany({
        select: { id: true, status: true, saasTierId: true },
      }),
      prisma.saasTier.findMany({ select: { id: true, monthlyFeeCents: true } }),
      prisma.slip.count(),
      prisma.supportTicket.count({
        where: { status: { in: ["open", "in_progress", "waiting_on_customer"] } },
      }),
      prisma.payment.aggregate({
        where: { status: "COMPLETED", createdAt: { gte: monthStart } },
        _sum: { amountCents: true },
      }),
      prisma.posTransaction.aggregate({
        where: { status: "completed", createdAt: { gte: monthStart } },
        _sum: { totalCents: true },
      }),
      prisma.transientBooking.aggregate({
        where: { createdAt: { gte: monthStart } },
        _sum: { totalCents: true },
      }),
      prisma.rampTicket.aggregate({
        where: { createdAt: { gte: monthStart } },
        _sum: { amountCents: true },
      }),
    ]);

    const tierMap = new Map(tiers.map((t) => [t.id, t.monthlyFeeCents]));

    const byStatus: Record<string, number> = {
      TRIAL: 0, ACTIVE: 0, GRACE_PERIOD: 0, LOCKED: 0,
    };
    let mrrCents = 0;
    for (const t of tenants) {
      byStatus[t.status] = (byStatus[t.status] ?? 0) + 1;
      if (t.status === "ACTIVE" && t.saasTierId) {
        mrrCents += tierMap.get(t.saasTierId) ?? 0;
      }
    }

    const platformGmvMonthCents =
      (monthPayments._sum.amountCents ?? 0) +
      (monthPos._sum.totalCents ?? 0) +
      (monthTransient._sum.totalCents ?? 0) +
      (monthRamp._sum.amountCents ?? 0);

    res.json({
      tenants: {
        total: tenants.length,
        byStatus,
      },
      mrrCents,
      platformGmvMonthCents,
      // Platform fee revenue = the SaaS revenue we collect from active
      // tenants this month (= MRR for the active tier mix). Until per-
      // transaction Stripe Connect fees land on a ledger, this is the
      // best signal we have for "platform fee revenue".
      platformFeeRevenueMonthCents: mrrCents,
      slipsManaged: slipCount,
      openSupportTickets: openTickets,
    });
  } catch (err) {
    next(err);
  }
});

// ==========================================================================
//  PLATFORM SETTINGS
//
// Single-row config table powering the admin Platform Settings page. GET
// returns the current values (and a fresh row if none has been seeded
// yet); PUT updates them with a partial payload. Both require an admin
// session; PUT additionally requires SUPERUSER or BILLING_ADMIN so
// READ_ONLY_SUPPORT can browse without changing anything.
// ==========================================================================

const PLATFORM_SETTINGS_ID = "singleton";

async function getOrCreatePlatformSettings() {
  const existing = await prisma.platformSetting.findUnique({
    where: { id: PLATFORM_SETTINGS_ID },
  });
  if (existing) return existing;
  return prisma.platformSetting.create({
    data: { id: PLATFORM_SETTINGS_ID },
  });
}

router.get("/platform-settings", async (_req, res, next) => {
  try {
    const settings = await getOrCreatePlatformSettings();
    res.json(settings);
  } catch (err) {
    next(err);
  }
});

router.put("/platform-settings", allowMutations, async (req, res, next) => {
  try {
    // Whitelist + coerce so a stray field can't sneak into the table and
    // a string from the form can't blow up Prisma's number column.
    const b = req.body ?? {};
    const data: Record<string, unknown> = {};

    const setStr = (k: string) => {
      if (typeof b[k] === "string") data[k] = b[k];
      else if (b[k] === null) data[k] = null;
    };
    const setNum = (k: string) => {
      if (b[k] === undefined || b[k] === null) return;
      const n = typeof b[k] === "number" ? b[k] : Number(b[k]);
      if (Number.isFinite(n)) data[k] = n;
    };
    const setBool = (k: string) => {
      if (typeof b[k] === "boolean") data[k] = b[k];
    };

    setStr("defaultTier");
    setNum("trialDurationDays");
    setNum("gracePeriodDays");
    setBool("autoLockAfterGrace");
    setNum("achFeeRatePct");
    setNum("cardFeeRatePct");
    setNum("stripeConnectFeePct");
    setNum("feeCapCents");
    setBool("maintenanceMode");
    setStr("maintenanceMessage");
    if (b.featureFlagsJson && typeof b.featureFlagsJson === "object") {
      data.featureFlagsJson = b.featureFlagsJson;
    }

    if (req.userId) data.updatedBy = req.userId;

    // Make sure the singleton row exists so update() can target it; this
    // avoids a noisy 404 on a fresh DB where the seed migration row was
    // somehow missed.
    await getOrCreatePlatformSettings();

    const updated = await prisma.platformSetting.update({
      where: { id: PLATFORM_SETTINGS_ID },
      data,
    });

    logAdminActionDetached(req, {
      action: "PLATFORM_SETTINGS_UPDATE",
      targetType: "platform_settings",
      targetId: PLATFORM_SETTINGS_ID,
      details: { fields: Object.keys(data) },
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// ==========================================================================
//  SUPPORT

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
router.post("/support/tickets", allowMutations, async (req, res, next) => {
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
router.put("/support/tickets/:id", allowMutations, async (req, res, next) => {
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

    // A10 — write a timeline event for each kind of change so the right-pane
    // detail view has a chronological audit trail. We intentionally skip
    // priority changes (low signal) but record status + assignment.
    const actorEmail = req.userRecord?.email ?? null;
    const events: Array<{ kind: string; status?: string; assignedTo?: string; body?: string }> = [];
    if (status !== undefined && status !== existing.status) {
      events.push({ kind: "STATUS", status, body: `Status changed: ${existing.status} → ${status}` });
    }
    if (assignedTo !== undefined && assignedTo !== existing.assignedTo) {
      events.push({
        kind: "ASSIGNMENT",
        assignedTo: assignedTo ?? "",
        body: assignedTo ? `Assigned to ${assignedTo}` : "Unassigned",
      });
    }
    if (events.length > 0) {
      await prisma.supportTicketEvent.createMany({
        data: events.map((e) => ({
          ticketId: updated.id,
          actorUserId: req.userId ?? null,
          actorEmail,
          kind: e.kind,
          body: e.body ?? null,
          status: e.status ?? null,
          assignedTo: e.assignedTo ?? null,
          internal: false,
        })),
      });
    }

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

// A10 — Support ticket timeline read + internal note write.

router.get("/support/tickets/:id/events", async (req, res, next) => {
  try {
    const events = await prisma.supportTicketEvent.findMany({
      where: { ticketId: req.params.id },
      orderBy: { createdAt: "asc" },
      take: 500,
    });
    res.json({ events });
  } catch (err) {
    next(err);
  }
});

router.post("/support/tickets/:id/notes", allowMutations, async (req, res, next) => {
  try {
    const body = (req.body && typeof req.body.body === "string") ? req.body.body.trim() : "";
    if (!body) {
      res.status(400).json({ error: "body is required" });
      return;
    }
    const internal = req.body.internal !== false;
    const ticket = await prisma.supportTicket.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!ticket) {
      res.status(404).json({ error: "Ticket not found" });
      return;
    }
    const event = await prisma.supportTicketEvent.create({
      data: {
        ticketId: ticket.id,
        actorUserId: req.userId ?? null,
        actorEmail: req.userRecord?.email ?? null,
        kind: "NOTE",
        body,
        internal,
      },
    });
    res.status(201).json(event);
  } catch (err) {
    next(err);
  }
});

//  TENANT TIMELINE (admin-side activity feed)

// Helper: write an entry to the tenant's admin timeline. Best-effort —
// failures here are logged but never block the action that triggered the
// write, so a transient DB hiccup doesn't undo a save-play.
async function recordTimelineEvent(opts: {
  tenantId: string;
  adminUserId?: string | null;
  type: string;
  summary: string;
  metadata?: Record<string, unknown> | null;
}): Promise<void> {
  try {
    await prisma.tenantTimelineEvent.create({
      data: {
        tenantId: opts.tenantId,
        adminUserId: opts.adminUserId ?? null,
        type: opts.type,
        summary: opts.summary,
        metadataJson: opts.metadata ?? undefined,
      },
    });
  } catch (err) {
    console.error(`[admin/timeline] Failed to record ${opts.type} for ${opts.tenantId}:`, err);
  }
}

// --------------------------------------------------------------------------
// GET /api/admin/tenants/:id/timeline — admin activity feed for a tenant
// --------------------------------------------------------------------------
router.get("/tenants/:id/timeline", async (req, res, next) => {
  try {
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit as string) || 50));
    const events = await prisma.tenantTimelineEvent.findMany({
      where: { tenantId: req.params.id },
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    // Resolve admin user names in one query so the UI can show "by Sarah".
    const adminIds = Array.from(
      new Set(events.map((e) => e.adminUserId).filter((id): id is string => !!id)),
    );
    const admins = adminIds.length
      ? await prisma.user.findMany({
          where: { id: { in: adminIds } },
          select: { id: true, firstName: true, lastName: true, email: true },
        })
      : [];
    const adminMap = new Map(admins.map((a) => [a.id, a]));

    res.json({
      items: events.map((e) => ({
        id: e.id,
        tenantId: e.tenantId,
        type: e.type,
        summary: e.summary,
        metadata: e.metadataJson,
        createdAt: e.createdAt.toISOString(),
        admin: e.adminUserId ? adminMap.get(e.adminUserId) ?? null : null,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------------
// POST /api/admin/tenants/:id/assign — assign trial / at-risk follow-up
//
// Body: { adminUserId?: string | null }  (omit/null to unassign).
// In production we use req.userId (the authenticated platform admin). In
// the dev bypass we accept the body.adminUserId so manual testing works.
// --------------------------------------------------------------------------
router.post("/tenants/:id/assign", async (req, res, next) => {
  try {
    const tenant = await prisma.tenant.findUnique({ where: { id: req.params.id } });
    if (!tenant) {
      res.status(404).json({ error: "Tenant not found" });
      return;
    }

    // "Assign to me" — prefer the authenticated user. Fallback to body
    // (unassign or manual id in dev).
    const explicit = req.body?.adminUserId;
    const target: string | null =
      explicit === null
        ? null
        : typeof explicit === "string" && explicit.length > 0
          ? explicit
          : (req.userId ?? null);

    if (target) {
      // Only platform admins can be the assignee — otherwise an admin
      // could (intentionally or not) hand a trial off to a marina-side
      // user, which would never appear in the admin queue.
      const user = await prisma.user.findUnique({
        where: { id: target },
        select: { id: true, firstName: true, lastName: true, email: true, role: true },
      });
      if (!user) {
        res.status(400).json({ error: "Target user not found" });
        return;
      }
      if (user.role !== "PLATFORM_ADMIN") {
        res.status(400).json({
          error: "Only platform admins can be assigned to a tenant follow-up",
        });
        return;
      }
    }

    const updated = await prisma.tenant.update({
      where: { id: req.params.id },
      data: { assignedAdminUserId: target },
    });

    let assignedName = "unassigned";
    if (target) {
      const u = await prisma.user.findUnique({
        where: { id: target },
        select: { firstName: true, lastName: true, email: true },
      });
      assignedName = u
        ? `${u.firstName} ${u.lastName}`.trim() || u.email
        : "an admin";
    }

    await recordTimelineEvent({
      tenantId: req.params.id,
      adminUserId: req.userId ?? null,
      type: target ? "assigned" : "unassigned",
      summary: target
        ? `Assigned follow-up to ${assignedName}`
        : "Cleared follow-up assignment",
      metadata: target ? { adminUserId: target } : null,
    });

    res.json({
      tenantId: updated.id,
      assignedAdminUserId: updated.assignedAdminUserId,
    });
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------------
// POST /api/admin/tenants/:id/nudge — queue a templated nudge email
//
// Body: { templateKey?: string, customSubject?: string, customBody?: string }
// templateKey selects one of three canned messages (welcome, mid-trial,
// final-day). The actual send happens via the email worker; if Redis
// isn't configured the queue is a no-op but we still record the timeline
// entry so the admin sees their attempt.
// --------------------------------------------------------------------------
const NUDGE_TEMPLATES: Record<string, { subject: string; message: string }> = {
  welcome: {
    subject: "Welcome to Helm — let's get your marina set up",
    message:
      "Hi there! We noticed you've started your Helm trial but haven't completed setup yet. Reply to this email and we'll personally walk you through getting your first slip and customer added.",
  },
  midtrial: {
    subject: "Halfway through your Helm trial — need a hand?",
    message:
      "You're halfway through your Helm trial. We'd love to help you finish setting up your marina before the trial ends. Want to schedule a quick 15-minute walkthrough?",
  },
  final: {
    subject: "Your Helm trial ends soon — let's talk",
    message:
      "Your Helm trial ends in a few days. If anything is blocking you from going live, please reply to this email and we'll get it sorted today.",
  },
};

router.post("/tenants/:id/nudge", async (req, res, next) => {
  try {
    const tenant = await prisma.tenant.findUnique({
      where: { id: req.params.id },
      include: {
        users: {
          where: { role: "MARINA_OWNER", active: true },
          select: { email: true, firstName: true },
          take: 1,
        },
      },
    });
    if (!tenant) {
      res.status(404).json({ error: "Tenant not found" });
      return;
    }
    const owner = tenant.users[0];
    if (!owner?.email) {
      res.status(400).json({ error: "No active owner email on file for this tenant" });
      return;
    }

    const templateKey =
      typeof req.body?.templateKey === "string" ? req.body.templateKey : "midtrial";
    const template = NUDGE_TEMPLATES[templateKey] ?? NUDGE_TEMPLATES.midtrial;
    const subject =
      typeof req.body?.customSubject === "string" && req.body.customSubject
        ? req.body.customSubject
        : template.subject;
    const message =
      typeof req.body?.customBody === "string" && req.body.customBody
        ? req.body.customBody
        : template.message;

    // Best-effort enqueue. Email worker is responsible for actual delivery
    // and may not be running locally. We don't fail the request if Redis
    // is down — the timeline entry still records the admin's intent.
    let queued = false;
    try {
      await queues.email.add("trial-nudge-email", {
        type: "trial_nudge",
        to: owner.email,
        tenantId: tenant.id,
        data: {
          tenantName: tenant.name,
          recipientName: owner.firstName,
          subject,
          message,
          templateKey,
        },
      });
      queued = true;
    } catch (err) {
      console.error(`[admin/nudge] Queue add failed for tenant ${tenant.id}:`, err);
    }

    await recordTimelineEvent({
      tenantId: tenant.id,
      adminUserId: req.userId ?? null,
      type: "nudge_sent",
      summary: `Nudge email queued to ${owner.email}: "${subject}"`,
      metadata: { templateKey, queued, recipient: owner.email },
    });

    res.json({ queued, recipient: owner.email, subject });
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------------
// GET /api/admin/tenants/:id/deep-dive — at-risk tenant deep-dive payload
//
// Returns the things the deep-dive page renders:
//   - Tenant header (name, status, tier, MRR, assigned admin, trial info)
//   - 8-week sparklines: invoices sent, payment volume, new customers,
//     new active users
//   - "Login recency" proxy: most recent createdAt across users / payments
//     / invoices (we don't track Clerk session activity)
//   - WoW change calculations for the headline signals
//   - Recent open / urgent support tickets (last 5)
// --------------------------------------------------------------------------
router.get("/tenants/:id/deep-dive", async (req, res, next) => {
  try {
    const tenant = await prisma.tenant.findUnique({
      where: { id: req.params.id },
      include: {
        saasTier: { select: { id: true, name: true, monthlyFeeCents: true } },
        _count: { select: { users: true, locations: true } },
      },
    });
    if (!tenant) {
      res.status(404).json({ error: "Tenant not found" });
      return;
    }

    let assignedAdmin: { id: string; firstName: string; lastName: string; email: string } | null = null;
    if (tenant.assignedAdminUserId) {
      assignedAdmin = await prisma.user.findUnique({
        where: { id: tenant.assignedAdminUserId },
        select: { id: true, firstName: true, lastName: true, email: true },
      });
    }

    // Build 8-week buckets ending at "now" (sunday-aligned for clarity).
    const WEEKS = 8;
    const now = new Date();
    const buckets: { start: Date; end: Date }[] = [];
    for (let i = WEEKS - 1; i >= 0; i--) {
      const end = new Date(now.getTime() - i * 7 * 24 * 60 * 60 * 1000);
      const start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
      buckets.push({ start, end });
    }
    const earliest = buckets[0].start;

    // Fetch raw rows since `earliest` and bucket in JS — much cheaper than
    // 8 separate aggregate queries per series.
    //
    // For "active users" and "user activity volume" we use AuditLog as a
    // proxy: every meaningful state change (record created/updated/etc.)
    // is logged with the acting userId, so distinct(userId) per week is a
    // reasonable WAU and total entries per week is an "activity recency"
    // sparkline. We deliberately avoid using User.createdAt here because
    // signups don't represent ongoing engagement.
    const [invoices, payments, customers, auditEntries] = await Promise.all([
      prisma.invoice.findMany({
        where: { tenantId: tenant.id, createdAt: { gte: earliest } },
        select: { createdAt: true },
      }),
      prisma.payment.findMany({
        where: {
          tenantId: tenant.id,
          status: "COMPLETED",
          createdAt: { gte: earliest },
        },
        select: { createdAt: true, amountCents: true },
      }),
      prisma.customer.findMany({
        where: { tenantId: tenant.id, createdAt: { gte: earliest } },
        select: { createdAt: true },
      }),
      prisma.auditLog.findMany({
        where: {
          tenantId: tenant.id,
          createdAt: { gte: earliest },
          userId: { not: null },
        },
        select: { createdAt: true, userId: true },
      }),
    ]);

    const bucketize = <T extends { createdAt: Date }>(
      rows: T[],
      reducer: (row: T) => number = () => 1,
    ): number[] =>
      buckets.map((b) =>
        rows
          .filter((r) => r.createdAt >= b.start && r.createdAt < b.end)
          .reduce((sum, r) => sum + reducer(r), 0),
      );

    const invoicesPerWeek = bucketize(invoices);
    const paymentVolumePerWeek = bucketize(payments, (p) => p.amountCents);
    const customersPerWeek = bucketize(customers);

    // "Active users" = distinct userIds in AuditLog per week (WAU proxy).
    const activeUsersPerWeek = buckets.map((b) => {
      const ids = new Set<string>();
      for (const a of auditEntries) {
        if (a.userId && a.createdAt >= b.start && a.createdAt < b.end) {
          ids.add(a.userId);
        }
      }
      return ids.size;
    });

    // "Login recency" sparkline = total user-attributed events per week.
    // Higher = more activity; trend down = waning engagement.
    const userActivityPerWeek = bucketize(auditEntries);

    const wowChange = (series: number[]): number | null => {
      if (series.length < 2) return null;
      const last = series[series.length - 1];
      const prev = series[series.length - 2];
      if (prev === 0) return last > 0 ? 100 : 0;
      return Math.round(((last - prev) / prev) * 100);
    };

    // "Last activity" — most recent user-attributed audit event wins
    // (it's the closest thing we have to a real session log). Fall back
    // to invoice/payment timestamps for tenants whose audit log is empty.
    const lastAudit = auditEntries.length
      ? auditEntries.reduce(
          (max, a) => (a.createdAt > max ? a.createdAt : max),
          auditEntries[0].createdAt,
        )
      : null;
    const lastPayment = payments.length
      ? payments.reduce((max, p) => (p.createdAt > max ? p.createdAt : max), payments[0].createdAt)
      : null;
    const lastInvoice = invoices.length
      ? invoices.reduce((max, i) => (i.createdAt > max ? i.createdAt : max), invoices[0].createdAt)
      : null;
    const candidates = [lastAudit, lastPayment, lastInvoice].filter(
      (d): d is Date => !!d,
    );
    const lastActivityAt = candidates.length
      ? new Date(Math.max(...candidates.map((d) => d.getTime())))
      : null;

    // Recent support tickets (last 5, newest first).
    const recentTickets = await prisma.supportTicket.findMany({
      where: { tenantId: tenant.id },
      orderBy: { createdAt: "desc" },
      take: 5,
    });

    res.json({
      tenant: {
        id: tenant.id,
        name: tenant.name,
        subdomain: tenant.subdomain,
        status: tenant.status,
        createdAt: tenant.createdAt,
        trialStartedAt: tenant.trialStartedAt,
        trialEndsAt: tenant.trialEndsAt,
        assignedAdmin,
        saasTier: tenant.saasTier,
        userCount: tenant._count.users,
        locationCount: tenant._count.locations,
      },
      weekLabels: buckets.map((b) => b.end.toISOString().slice(0, 10)),
      signals: {
        invoicesPerWeek: {
          label: "Invoices sent",
          series: invoicesPerWeek,
          last: invoicesPerWeek[invoicesPerWeek.length - 1] ?? 0,
          wowChangePct: wowChange(invoicesPerWeek),
        },
        paymentVolumePerWeek: {
          label: "Payment volume",
          unit: "cents",
          series: paymentVolumePerWeek,
          last: paymentVolumePerWeek[paymentVolumePerWeek.length - 1] ?? 0,
          wowChangePct: wowChange(paymentVolumePerWeek),
        },
        newCustomersPerWeek: {
          label: "New customers",
          series: customersPerWeek,
          last: customersPerWeek[customersPerWeek.length - 1] ?? 0,
          wowChangePct: wowChange(customersPerWeek),
        },
        activeUsersPerWeek: {
          label: "Active users (WAU)",
          series: activeUsersPerWeek,
          last: activeUsersPerWeek[activeUsersPerWeek.length - 1] ?? 0,
          wowChangePct: wowChange(activeUsersPerWeek),
        },
        userActivityPerWeek: {
          label: "User activity volume",
          series: userActivityPerWeek,
          last: userActivityPerWeek[userActivityPerWeek.length - 1] ?? 0,
          wowChangePct: wowChange(userActivityPerWeek),
        },
      },
      lastActivityAt,
      recentTickets: recentTickets.map((t) => ({
        id: t.id,
        subject: t.subject,
        status: t.status,
        priority: t.priority,
        createdAt: t.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------------
// POST /api/admin/tenants/:id/save-play — execute a retention "save play"
//
// Body: { action: 'extend_trial' | 'apply_coupon' | 'change_tier'
//                 | 'schedule_check_in' | 'open_ticket', ... }
//
// Each action makes the relevant DB write (where applicable) and writes
// a TenantTimelineEvent. For actions that aren't fully wired into other
// systems (e.g. coupon application), we record the intent on the timeline
// so the admin has a paper trail.
// --------------------------------------------------------------------------
router.post("/tenants/:id/save-play", async (req, res, next) => {
  try {
    const tenant = await prisma.tenant.findUnique({ where: { id: req.params.id } });
    if (!tenant) {
      res.status(404).json({ error: "Tenant not found" });
      return;
    }
    const action = String(req.body?.action ?? "");

    const note: string | undefined =
      typeof req.body?.note === "string" ? req.body.note : undefined;

    switch (action) {
      case "extend_trial": {
        const days = Math.max(1, Math.min(60, parseInt(req.body?.days) || 14));
        const base = tenant.trialEndsAt ?? new Date();
        const newEnd = new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
        // If the tenant isn't currently TRIAL, flipping it back lets the
        // owner resume onboarding without paying yet.
        const updated = await prisma.tenant.update({
          where: { id: tenant.id },
          data: {
            trialEndsAt: newEnd,
            trialStartedAt: tenant.trialStartedAt ?? new Date(),
            status: tenant.status === "LOCKED" ? tenant.status : "TRIAL",
          },
        });
        await recordTimelineEvent({
          tenantId: tenant.id,
          adminUserId: req.userId ?? null,
          type: "trial_extended",
          summary: `Trial extended by ${days} days (now ends ${newEnd.toISOString().slice(0, 10)})`,
          metadata: { days, newTrialEndsAt: newEnd.toISOString(), note },
        });
        res.json({ ok: true, trialEndsAt: updated.trialEndsAt, status: updated.status });
        return;
      }

      case "apply_coupon": {
        const code = String(req.body?.code ?? "").trim();
        const percentOff = Number(req.body?.percentOff) || null;
        if (!code) {
          res.status(400).json({ error: "code is required" });
          return;
        }
        // We don't have a Coupon table yet — record the intent on
        // brandingJson._adminCoupons and on the timeline so it shows up
        // in billing later.
        const branding = (tenant.brandingJson as Record<string, unknown> | null) ?? {};
        const coupons = Array.isArray(branding._adminCoupons)
          ? (branding._adminCoupons as Record<string, unknown>[])
          : [];
        coupons.push({
          code,
          percentOff,
          appliedAt: new Date().toISOString(),
          appliedBy: req.userId ?? null,
        });
        await prisma.tenant.update({
          where: { id: tenant.id },
          data: { brandingJson: { ...branding, _adminCoupons: coupons } },
        });
        await recordTimelineEvent({
          tenantId: tenant.id,
          adminUserId: req.userId ?? null,
          type: "coupon_applied",
          summary: percentOff
            ? `Applied coupon ${code} (${percentOff}% off)`
            : `Applied coupon ${code}`,
          metadata: { code, percentOff, note },
        });
        res.json({ ok: true, code, percentOff });
        return;
      }

      case "change_tier": {
        const tierId = String(req.body?.tierId ?? "");
        const tier = tierId
          ? await prisma.saasTier.findUnique({ where: { id: tierId } })
          : null;
        if (!tier) {
          res.status(400).json({ error: "Invalid tierId" });
          return;
        }
        await prisma.tenant.update({
          where: { id: tenant.id },
          data: { saasTierId: tier.id },
        });
        await recordTimelineEvent({
          tenantId: tenant.id,
          adminUserId: req.userId ?? null,
          type: "tier_changed",
          summary: `Changed plan to ${tier.name}`,
          metadata: { tierId: tier.id, tierName: tier.name, note },
        });
        res.json({ ok: true, tierId: tier.id, tierName: tier.name });
        return;
      }

      case "schedule_check_in": {
        const scheduledAt = req.body?.scheduledAt
          ? new Date(req.body.scheduledAt)
          : null;
        if (!scheduledAt || isNaN(scheduledAt.getTime())) {
          res.status(400).json({ error: "scheduledAt is required (ISO timestamp)" });
          return;
        }
        await recordTimelineEvent({
          tenantId: tenant.id,
          adminUserId: req.userId ?? null,
          type: "check_in_scheduled",
          summary: `Check-in scheduled for ${scheduledAt.toISOString().slice(0, 16).replace("T", " ")} UTC`,
          metadata: { scheduledAt: scheduledAt.toISOString(), note },
        });
        res.json({ ok: true, scheduledAt: scheduledAt.toISOString() });
        return;
      }

      case "open_ticket": {
        const subject = String(req.body?.subject ?? "").trim();
        const description = String(req.body?.description ?? note ?? "").trim();
        const priority = ["low", "medium", "high", "urgent"].includes(
          String(req.body?.priority),
        )
          ? String(req.body.priority)
          : "medium";
        if (!subject || !description) {
          res.status(400).json({ error: "subject and description are required" });
          return;
        }
        const ticket = await prisma.supportTicket.create({
          data: {
            tenantId: tenant.id,
            subject,
            description,
            priority,
            status: "open",
            assignedTo: req.userId ?? null,
          },
        });
        await recordTimelineEvent({
          tenantId: tenant.id,
          adminUserId: req.userId ?? null,
          type: "ticket_opened",
          summary: `Opened support ticket "${subject}" (${priority})`,
          metadata: { ticketId: ticket.id, priority },
        });
        res.json({ ok: true, ticketId: ticket.id });
        return;
      }

      case "note": {
        if (!note) {
          res.status(400).json({ error: "note is required" });
          return;
        }
        await recordTimelineEvent({
          tenantId: tenant.id,
          adminUserId: req.userId ?? null,
          type: "note",
          summary: note.slice(0, 240),
          metadata: null,
        });
        res.json({ ok: true });
        return;
      }

      default:
        res.status(400).json({
          error:
            "Unknown save-play action. Expected one of: extend_trial, apply_coupon, change_tier, schedule_check_in, open_ticket, note",
        });
        return;
    }
  } catch (err) {
    next(err);
  }
});

//  LOCATION MANAGEMENT  (per-tenant)

// GET /api/admin/tenants/:id/accounting-completeness
//
// Plan 11 — Admin-side mirror of the tenant Insights report. Returns the
// same gap shape so the onboarding wizard / tenant detail page can show
// a "must-fix before go-live" panel without granting cross-tenant access
// to the tenant-scoped /api/reports endpoint.
router.get("/tenants/:id/accounting-completeness", async (req, res, next) => {
  try {
    const tenantId = req.params.id;

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
        transientRevenueGlAccountId: true,
        rampRevenueGlAccountId: true,
        conciergeRevenueGlAccountId: true,
        fuelRevenueGlAccountId: true,
        electricityRevenueGlAccountId: true,
      },
    });

    interface Gap {
      kind: string;
      label: string;
      detail: string;
      locationId: string;
      locationName: string;
      severity: "ERROR" | "WARNING";
    }
    const gaps: Gap[] = [];

    const REQUIRED: Array<{ field: keyof typeof locations[number]; label: string; sev: "ERROR" | "WARNING" }> = [
      { field: "defaultRevenueGlAccountId",     label: "Default revenue",     sev: "ERROR" },
      { field: "arGlAccountId",                 label: "Accounts receivable", sev: "ERROR" },
      { field: "salesTaxGlAccountId",           label: "Sales tax payable",   sev: "ERROR" },
      { field: "deferredRevenueGlAccountId",    label: "Deferred revenue",    sev: "WARNING" },
      { field: "accountsPayableGlAccountId",    label: "Accounts payable",    sev: "WARNING" },
      { field: "transientRevenueGlAccountId",   label: "Transient revenue",   sev: "WARNING" },
      { field: "rampRevenueGlAccountId",        label: "Ramp revenue",        sev: "WARNING" },
      { field: "conciergeRevenueGlAccountId",   label: "Concierge revenue",   sev: "WARNING" },
      { field: "fuelRevenueGlAccountId",        label: "Fuel revenue",        sev: "WARNING" },
      { field: "electricityRevenueGlAccountId", label: "Electricity revenue", sev: "WARNING" },
    ];

    for (const loc of locations) {
      for (const slot of REQUIRED) {
        if (!loc[slot.field]) {
          gaps.push({
            kind: slot.label.toUpperCase().replace(/\s/g, "_"),
            label: slot.label,
            detail: `Pin a GL account on ${loc.name}`,
            locationId: loc.id,
            locationName: loc.name,
            severity: loc.qboRealmId ? slot.sev : "WARNING",
          });
        }
      }
    }

    const errors = gaps.filter((g) => g.severity === "ERROR").length;
    const warnings = gaps.filter((g) => g.severity === "WARNING").length;

    res.json({
      summary: { totalLocations: locations.length, totalGaps: gaps.length, errors, warnings },
      gaps,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/tenants/:id/locations
//
// Returns each location with its per-location SaaS subscription state (tier,
// Stripe status, current period end). The platform admin's tenant detail
// page renders this on the Locations tab — subscriptions live here, not
// on the Tenant.
router.get("/tenants/:id/locations", async (req, res, next) => {
  try {
    const locations = await prisma.location.findMany({
      where: { tenantId: req.params.id },
      orderBy: { name: "asc" },
      include: { saasTier: true },
    });
    res.json(
      locations.map((l) => ({
        id: l.id,
        tenantId: l.tenantId,
        name: l.name,
        address: l.address,
        city: l.city,
        state: l.state,
        zip: l.zip,
        phone: l.phone,
        timezone: l.timezone,
        active: l.active,
        subscription: {
          tier: l.saasTier
            ? {
                id: l.saasTier.id,
                name: l.saasTier.name,
                monthlyFeeCents: l.saasTier.monthlyFeeCents,
              }
            : null,
          status: l.subscriptionStatus,
          stripeCustomerId: l.stripeCustomerId,
          stripeSubscriptionId: l.stripeSubscriptionId,
          gracePeriodStartedAt: l.gracePeriodStartedAt,
        },
      })),
    );
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
        accountingGracePeriodEndsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
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

//  PLATFORM HEALTH MONITORING
//
//  Cross-tenant infrastructure dashboard. The Health page in the admin
//  console hits these endpoints every 30s to surface stuck queues, failing
//  webhooks, expired QBO tokens, and broken Stripe Connect accounts in one
//  place. Each metric is intentionally summary-only — the failure drilldown
//  endpoints serve the recent-records lists.

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
// GET /api/admin/webhooks/qbo — A2: all-deliveries view (not just failures)
// --------------------------------------------------------------------------
router.get("/webhooks/qbo", async (req, res, next) => {
  try {
    const status = typeof req.query.status === "string" ? req.query.status : null;
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit as string) || 100));
    const rows = await prisma.qboWebhookDelivery.findMany({
      where: status ? { status } : {},
      orderBy: { receivedAt: "desc" },
      take: limit,
      select: {
        id: true,
        realmId: true,
        tenantId: true,
        locationId: true,
        attempts: true,
        status: true,
        lastError: true,
        receivedAt: true,
        processedAt: true,
      },
    });
    const tenantNames = await loadTenantNameMap(rows.map((r) => r.tenantId));
    res.json({
      items: rows.map((r) => ({
        id: r.id,
        tenantId: r.tenantId,
        tenantName: r.tenantId ? tenantNames.get(r.tenantId) ?? null : null,
        locationId: r.locationId,
        realmId: r.realmId,
        attempts: r.attempts,
        status: r.status,
        error: r.lastError,
        receivedAt: r.receivedAt.toISOString(),
        processedAt: r.processedAt?.toISOString() ?? null,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------------
// POST /api/admin/webhooks/qbo/:id/retry — A1: replay a failed QBO delivery
//
// Calls processDelivery() directly without re-checking tenant scope (admin
// console is platform-level). Returns the engine's PROCESSED / FAILED result
// so the UI can show the outcome inline.
// --------------------------------------------------------------------------
router.post("/webhooks/qbo/:id/retry", async (req, res, next) => {
  try {
    const row = await prisma.qboWebhookDelivery.findUnique({
      where: { id: req.params.id },
      select: { id: true },
    });
    if (!row) {
      res.status(404).json({ error: "Webhook delivery not found" });
      return;
    }
    const result = await processQboDelivery(req.params.id);
    res.json(result);
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

//  GLOBAL SEARCH

// --------------------------------------------------------------------------
// GET /api/admin/search?q=... — fan-out search across tenants, users,
// boats, and SaaS invoices. Each entity type capped to keep results
// snappy from the top-nav search bar.
// --------------------------------------------------------------------------
router.get("/search", async (req, res, next) => {
  try {
    const q = ((req.query.q as string) ?? "").trim();
    const perTypeLimit = Math.min(20, Math.max(1, parseInt(req.query.limit as string) || 8));

    if (q.length < 2) {
      res.json({
        query: q,
        groups: { tenants: [], users: [], boats: [], saasInvoices: [] },
      });
      return;
    }

    const insensitive = { contains: q, mode: "insensitive" as const };

    const [tenants, users, boats, saasInvoices] = await Promise.all([
      prisma.tenant.findMany({
        where: {
          OR: [
            { name: insensitive },
            { subdomain: insensitive },
            { customDomain: insensitive },
          ],
        },
        select: { id: true, name: true, subdomain: true, status: true },
        take: perTypeLimit,
        orderBy: { name: "asc" },
      }),
      prisma.user.findMany({
        where: {
          OR: [
            { email: insensitive },
            { firstName: insensitive },
            { lastName: insensitive },
          ],
        },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          role: true,
          tenantId: true,
          tenant: { select: { name: true, subdomain: true } },
        },
        take: perTypeLimit,
        orderBy: { email: "asc" },
      }),
      prisma.boat.findMany({
        where: {
          OR: [
            { name: insensitive },
            { registrationNumber: insensitive },
            { hin: insensitive },
            { make: insensitive },
            { model: insensitive },
          ],
        },
        select: {
          id: true,
          name: true,
          registrationNumber: true,
          make: true,
          model: true,
          year: true,
          tenantId: true,
          customerId: true,
        },
        take: perTypeLimit,
        orderBy: { name: "asc" },
      }),
      // Search SaaS invoices by short id prefix or by tenant name match
      prisma.saasInvoice.findMany({
        where: {
          OR: [
            { id: { startsWith: q } },
            { tenant: { name: insensitive } },
            { tenant: { subdomain: insensitive } },
          ],
        },
        select: {
          id: true,
          tenantId: true,
          amountCents: true,
          status: true,
          issuedAt: true,
          tenant: { select: { name: true } },
        },
        take: perTypeLimit,
        orderBy: { issuedAt: "desc" },
      }),
    ]);

    res.json({
      query: q,
      groups: {
        tenants: tenants.map((t) => ({
          id: t.id,
          name: t.name,
          subdomain: t.subdomain,
          status: t.status,
        })),
        users: users.map((u) => ({
          id: u.id,
          email: u.email,
          firstName: u.firstName,
          lastName: u.lastName,
          role: u.role,
          tenantId: u.tenantId,
          tenantName: u.tenant?.name ?? null,
          tenantSubdomain: u.tenant?.subdomain ?? null,
        })),
        boats: boats.map((b) => ({
          id: b.id,
          name: b.name,
          registrationNumber: b.registrationNumber,
          make: b.make,
          model: b.model,
          year: b.year,
          tenantId: b.tenantId,
          customerId: b.customerId,
        })),
        saasInvoices: saasInvoices.map((i) => ({
          id: i.id,
          tenantId: i.tenantId,
          tenantName: i.tenant.name,
          amountCents: i.amountCents,
          status: i.status,
          issuedAt: i.issuedAt.toISOString(),
        })),
      },
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

//  TENANT NOTES & ACTIVITY TIMELINE

// --------------------------------------------------------------------------
// GET /api/admin/tenants/:id/notes — list tenant notes (admin-only)
// --------------------------------------------------------------------------
router.get("/tenants/:id/notes", async (req, res, next) => {
  try {
    const notes = await prisma.tenantNote.findMany({
      where: { tenantId: req.params.id },
      orderBy: { createdAt: "desc" },
    });
    res.json({ notes });
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------------
// POST /api/admin/tenants/:id/notes — add a note
// --------------------------------------------------------------------------
router.post("/tenants/:id/notes", async (req, res, next) => {
  try {
    const body = (req.body?.body ?? "").toString().trim();
    if (!body) {
      res.status(400).json({ error: "Note body is required" });
      return;
    }
    if (body.length > 5000) {
      res.status(400).json({ error: "Note body must be 5000 characters or fewer" });
      return;
    }

    const tenant = await prisma.tenant.findUnique({
      where: { id: req.params.id },
      select: { id: true },
    });
    if (!tenant) {
      res.status(404).json({ error: "Tenant not found" });
      return;
    }

    const note = await prisma.tenantNote.create({
      data: {
        tenantId: req.params.id,
        authorId: req.userId ?? "platform_admin",
        authorEmail: req.userRecord?.email ?? null,
        body,
      },
    });

    await recordAdminEvent(req, "NOTE_CREATED", {
      tenantId: req.params.id,
      metadata: { noteId: note.id },
    });

    res.status(201).json(note);
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
// PUT /api/admin/tenants/:id/notes/:noteId — edit own note only
// --------------------------------------------------------------------------
router.put("/tenants/:id/notes/:noteId", async (req, res, next) => {
  try {
    const body = (req.body?.body ?? "").toString().trim();
    if (!body) {
      res.status(400).json({ error: "Note body is required" });
      return;
    }
    const note = await prisma.tenantNote.findUnique({
      where: { id: req.params.noteId },
    });
    if (!note || note.tenantId !== req.params.id) {
      res.status(404).json({ error: "Note not found" });
      return;
    }
    if (req.userId && note.authorId !== req.userId) {
      res.status(403).json({ error: "You can only edit your own notes" });
      return;
    }

    const updated = await prisma.tenantNote.update({
      where: { id: note.id },
      data: { body },
    });

    await recordAdminEvent(req, "NOTE_UPDATED", {
      tenantId: note.tenantId,
      metadata: { noteId: note.id },
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------------
// DELETE /api/admin/tenants/:id/notes/:noteId — delete own note only
// --------------------------------------------------------------------------
router.delete("/tenants/:id/notes/:noteId", async (req, res, next) => {
  try {
    const note = await prisma.tenantNote.findUnique({
      where: { id: req.params.noteId },
    });
    if (!note || note.tenantId !== req.params.id) {
      res.status(404).json({ error: "Note not found" });
      return;
    }
    if (req.userId && note.authorId !== req.userId) {
      res.status(403).json({ error: "You can only delete your own notes" });
      return;
    }

    await prisma.tenantNote.delete({ where: { id: note.id } });
    await recordAdminEvent(req, "NOTE_DELETED", {
      tenantId: note.tenantId,
      metadata: { noteId: note.id },
    });

    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------------
// GET /api/admin/tenants/:id/activity — interleaved timeline of admin
// notes and admin audit events (impersonation, locks, tier changes, etc.).
// --------------------------------------------------------------------------
router.get("/tenants/:id/activity", async (req, res, next) => {
  try {
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit as string) || 100));

    const [notes, events] = await Promise.all([
      prisma.tenantNote.findMany({
        where: { tenantId: req.params.id },
        orderBy: { createdAt: "desc" },
        take: limit,
      }),
      prisma.adminAuditEvent.findMany({
        where: { tenantId: req.params.id },
        orderBy: { createdAt: "desc" },
        take: limit,
      }),
    ]);

    type TimelineItem = {
      kind: "note" | "event";
      id: string;
      createdAt: string;
      actorEmail: string | null;
      // For notes
      body?: string;
      authorId?: string;
      // For events
      action?: string;
      metadata?: unknown;
    };

    const items: TimelineItem[] = [
      ...notes.map((n) => ({
        kind: "note" as const,
        id: n.id,
        createdAt: n.createdAt.toISOString(),
        actorEmail: n.authorEmail,
        body: n.body,
        authorId: n.authorId,
      })),
      ...events.map((e) => ({
        kind: "event" as const,
        id: e.id,
        createdAt: e.createdAt.toISOString(),
        actorEmail: e.adminEmail,
        action: e.action,
        metadata: e.metadataJson ?? null,
      })),
    ];

    items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    res.json({ items: items.slice(0, limit) });
  } catch (err) {
    next(err);
  }
});

//  BULK TENANT ACTIONS

function parseBulkTargets(req: { body?: unknown }): string[] {
  const body = req.body as Record<string, unknown> | undefined;
  const ids = Array.isArray(body?.tenantIds) ? (body!.tenantIds as unknown[]) : [];
  return ids.filter((id): id is string => typeof id === "string" && id.length > 0);
}

// NOTE: bulk endpoints live at /bulk/tenants/* rather than /tenants/bulk/*
// because the dynamic /tenants/:id/lock route would otherwise swallow
// /tenants/bulk/lock with `:id == "bulk"`.

// --------------------------------------------------------------------------
// POST /api/admin/bulk/tenants/lock
// --------------------------------------------------------------------------
router.post("/bulk/tenants/lock", async (req, res, next) => {
  try {
    const ids = parseBulkTargets(req);
    if (ids.length === 0) {
      res.status(400).json({ error: "tenantIds is required (non-empty array)" });
      return;
    }

    const targets = await prisma.tenant.findMany({
      where: { id: { in: ids }, status: { not: "LOCKED" } },
      select: { id: true },
    });

    const now = new Date();
    await prisma.tenant.updateMany({
      where: { id: { in: targets.map((t) => t.id) } },
      data: { status: "LOCKED", lockedAt: now },
    });

    await Promise.all(
      targets.map((t) =>
        recordAdminEvent(req, "TENANT_LOCKED", {
          tenantId: t.id,
          metadata: { bulk: true },
        }),
      ),
    );

    res.json({ updated: targets.length, skipped: ids.length - targets.length });
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

//  COUPONS & PROMO CODES (SaaS subscriptions)

const COUPON_TYPES = ["PERCENT", "FIXED", "TRIAL_EXTENSION"] as const;
const COUPON_DURATIONS = ["ONCE", "REPEATING"] as const;

// GET /api/admin/billing/coupons — list with redemption counts
router.get("/billing/coupons", async (_req, res, next) => {
  try {
    const coupons = await prisma.saasCoupon.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        redemptions: {
          select: { id: true, tenantId: true, active: true, redeemedAt: true },
        },
      },
    });

    res.json(
      coupons.map((c) => ({
        id: c.id,
        code: c.code,
        name: c.name,
        discountType: c.discountType,
        discountValue: c.discountValue,
        duration: c.duration,
        durationCycles: c.durationCycles,
        maxRedemptions: c.maxRedemptions,
        active: c.active,
        notes: c.notes,
        redemptionCount: c.redemptions.length,
        activeRedemptions: c.redemptions.filter((r) => r.active).length,
        createdAt: c.createdAt.toISOString(),
      })),
    );
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/billing/coupons — create
router.post("/billing/coupons", async (req, res, next) => {
  try {
    const {
      code,
      name,
      discountType,
      discountValue,
      duration = "ONCE",
      durationCycles,
      maxRedemptions,
      notes,
    } = req.body ?? {};

    if (!code || !name) {
      res.status(400).json({ error: "code and name are required" });
      return;
    }
    if (!COUPON_TYPES.includes(discountType)) {
      res.status(400).json({
        error: `discountType must be one of: ${COUPON_TYPES.join(", ")}`,
      });
      return;
    }
    if (!COUPON_DURATIONS.includes(duration)) {
      res.status(400).json({
        error: `duration must be one of: ${COUPON_DURATIONS.join(", ")}`,
      });
      return;
    }
    if (typeof discountValue !== "number" || discountValue <= 0) {
      res.status(400).json({ error: "discountValue must be a positive number" });
      return;
    }
    if (duration === "REPEATING" && (typeof durationCycles !== "number" || durationCycles < 1)) {
      res.status(400).json({
        error: "durationCycles is required and must be ≥ 1 for REPEATING",
      });
      return;
    }
    if (discountType === "PERCENT" && discountValue > 10000) {
      res.status(400).json({ error: "PERCENT discountValue is bps; max 10000 (100%)" });
      return;
    }

    const normalizedCode = String(code).trim().toUpperCase();

    const existing = await prisma.saasCoupon.findUnique({
      where: { code: normalizedCode },
    });
    if (existing) {
      res.status(409).json({ error: "Coupon code already exists" });
      return;
    }

    const coupon = await prisma.saasCoupon.create({
      data: {
        code: normalizedCode,
        name,
        discountType,
        discountValue,
        duration,
        durationCycles: duration === "REPEATING" ? durationCycles : null,
        maxRedemptions: maxRedemptions ?? null,
        notes: notes ?? null,
      },
    });

    res.status(201).json(coupon);
  } catch (err) {
    next(err);
  }
});

// PUT /api/admin/billing/coupons/:id — edit
router.put("/billing/coupons/:id", async (req, res, next) => {
  try {
    const existing = await prisma.saasCoupon.findUnique({
      where: { id: req.params.id },
    });
    if (!existing) {
      res.status(404).json({ error: "Coupon not found" });
      return;
    }

    const data: Record<string, unknown> = {};
    const { name, active, notes, maxRedemptions } = req.body ?? {};
    if (name !== undefined) data.name = name;
    if (active !== undefined) data.active = !!active;
    if (notes !== undefined) data.notes = notes;
    if (maxRedemptions !== undefined) data.maxRedemptions = maxRedemptions;

    const updated = await prisma.saasCoupon.update({
      where: { id: req.params.id },
      data,
    });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/billing/coupons/:id/deactivate
router.post("/billing/coupons/:id/deactivate", async (req, res, next) => {
  try {
    const updated = await prisma.saasCoupon.update({
      where: { id: req.params.id },
      data: { active: false },
    });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/billing/coupons/:id/apply — apply coupon to a tenant
router.post("/billing/coupons/:id/apply", async (req, res, next) => {
  try {
    const { tenantId } = req.body ?? {};
    if (!tenantId) {
      res.status(400).json({ error: "tenantId is required" });
      return;
    }

    const coupon = await prisma.saasCoupon.findUnique({
      where: { id: req.params.id },
      include: { _count: { select: { redemptions: true } } },
    });
    if (!coupon || !coupon.active) {
      res.status(400).json({ error: "Coupon is inactive or not found" });
      return;
    }

    if (
      coupon.maxRedemptions !== null &&
      coupon.maxRedemptions !== undefined &&
      coupon._count.redemptions >= coupon.maxRedemptions
    ) {
      res.status(400).json({ error: "Coupon has reached max redemptions" });
      return;
    }

    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, gracePeriodStartedAt: true },
    });
    if (!tenant) {
      res.status(404).json({ error: "Tenant not found" });
      return;
    }

    // TRIAL_EXTENSION coupons mutate the tenant's grace period at apply
    // time. They never appear as a discount on an invoice. We refuse to
    // create the redemption when the tenant is not in a grace period —
    // otherwise the operator would "use" the code with zero effect.
    if (coupon.discountType === "TRIAL_EXTENSION") {
      const newStart = await applyTrialExtensionToGrace(
        tenantId,
        coupon.discountValue,
      );
      if (!newStart) {
        res.status(400).json({
          error:
            "Tenant is not currently in a grace period; trial extension cannot be applied.",
        });
        return;
      }

      const redemption = await prisma.saasCouponRedemption.upsert({
        where: { couponId_tenantId: { couponId: coupon.id, tenantId } },
        create: {
          couponId: coupon.id,
          tenantId,
          cyclesRemaining: null,
          active: false,
          lastAppliedAt: new Date(),
        },
        update: {
          active: false,
          cyclesRemaining: null,
          redeemedAt: new Date(),
          lastAppliedAt: new Date(),
        },
      });

      await prisma.auditLog.create({
        data: {
          tenantId,
          recordType: "Tenant",
          recordId: tenantId,
          action: "TRIAL_EXTENDED",
          changedFieldsJson: {
            couponCode: coupon.code,
            days: coupon.discountValue,
            newGracePeriodStartedAt: newStart.toISOString(),
          },
        },
      });

      res.status(201).json({ ...redemption, newGracePeriodStartedAt: newStart });
      return;
    }

    const cyclesRemaining =
      coupon.duration === "REPEATING" ? coupon.durationCycles : null;

    const redemption = await prisma.saasCouponRedemption.upsert({
      where: { couponId_tenantId: { couponId: coupon.id, tenantId } },
      create: {
        couponId: coupon.id,
        tenantId,
        cyclesRemaining,
        active: true,
      },
      update: {
        active: true,
        cyclesRemaining,
        redeemedAt: new Date(),
      },
    });

    res.status(201).json(redemption);
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/billing/coupons/:id/redemptions — see who used a code
router.get("/billing/coupons/:id/redemptions", async (req, res, next) => {
  try {
    const redemptions = await prisma.saasCouponRedemption.findMany({
      where: { couponId: req.params.id },
      orderBy: { redeemedAt: "desc" },
    });

    const tenantIds = [...new Set(redemptions.map((r) => r.tenantId))];
    const tenants = await prisma.tenant.findMany({
      where: { id: { in: tenantIds } },
      select: { id: true, name: true },
    });
    const tenantMap = new Map(tenants.map((t) => [t.id, t.name]));

    res.json(
      redemptions.map((r) => ({
        id: r.id,
        tenantId: r.tenantId,
        tenantName: tenantMap.get(r.tenantId) ?? "—",
        active: r.active,
        cyclesRemaining: r.cyclesRemaining,
        redeemedAt: r.redeemedAt.toISOString(),
        lastAppliedAt: r.lastAppliedAt?.toISOString() ?? null,
      })),
    );
  } catch (err) {
    next(err);
  }
});

//  REFUNDS & CREDIT NOTES (SaaS invoices)

// POST /api/admin/billing/invoices/:id/refund
router.post("/billing/invoices/:id/refund", async (req, res, next) => {
  try {
    const { amountCents, reason, notes } = req.body ?? {};

    if (typeof amountCents !== "number" || amountCents <= 0) {
      res.status(400).json({ error: "amountCents must be a positive number" });
      return;
    }
    if (!REFUND_REASONS.includes(reason as RefundReason)) {
      res.status(400).json({
        error: `reason must be one of: ${REFUND_REASONS.join(", ")}`,
      });
      return;
    }

    const invoice = await prisma.saasInvoice.findUnique({
      where: { id: req.params.id },
    });
    if (!invoice) {
      res.status(404).json({ error: "Invoice not found" });
      return;
    }

    // Refunds may only be issued against an invoice that has been paid.
    if (invoice.status !== "paid" || !invoice.paidAt) {
      res.status(400).json({
        error: "Only paid invoices can be refunded",
      });
      return;
    }

    const alreadyRefunded = invoice.refundedCents;
    const refundable =
      invoice.amountCents +
      invoice.prorationCents -
      invoice.discountCents -
      alreadyRefunded;
    if (amountCents > refundable) {
      res.status(400).json({
        error: `Refund exceeds refundable amount of ${refundable} cents`,
      });
      return;
    }

    const userId =
      ((req as unknown as Record<string, unknown>).userId as string | undefined) ??
      null;

    const result = await prisma.$transaction(async (tx) => {
      const refund = await tx.saasInvoiceRefund.create({
        data: {
          saasInvoiceId: invoice.id,
          amountCents,
          reason,
          notes: notes ?? null,
          createdBy: userId,
        },
      });
      const updated = await tx.saasInvoice.update({
        where: { id: invoice.id },
        data: {
          refundedCents: { increment: amountCents },
        },
      });
      await tx.auditLog.create({
        data: {
          tenantId: invoice.tenantId,
          userId,
          recordType: "SaasInvoice",
          recordId: invoice.id,
          action: "REFUND_ISSUED",
          changedFieldsJson: { amountCents, reason, refundId: refund.id },
        },
      });
      return { refund, updated };
    });

    res.status(201).json({
      refund: result.refund,
      invoice: {
        id: result.updated.id,
        amountCents: result.updated.amountCents,
        discountCents: result.updated.discountCents,
        refundedCents: result.updated.refundedCents,
        outstandingCents: saasInvoiceOutstandingCents(result.updated),
      },
    });
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------------
// POST /api/admin/tenants/bulk/unlock
// --------------------------------------------------------------------------
router.post("/bulk/tenants/unlock", async (req, res, next) => {
  try {
    const ids = parseBulkTargets(req);
    if (ids.length === 0) {
      res.status(400).json({ error: "tenantIds is required (non-empty array)" });
      return;
    }

    const targets = await prisma.tenant.findMany({
      where: { id: { in: ids }, status: { not: "ACTIVE" } },
      select: { id: true },
    });

    await prisma.tenant.updateMany({
      where: { id: { in: targets.map((t) => t.id) } },
      data: { status: "ACTIVE", lockedAt: null, gracePeriodStartedAt: null },
    });

    await Promise.all(
      targets.map((t) =>
        recordAdminEvent(req, "TENANT_UNLOCKED", {
          tenantId: t.id,
          metadata: { bulk: true },
        }),
      ),
    );

    res.json({ updated: targets.length, skipped: ids.length - targets.length });
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/billing/invoices/:id/refunds
router.get("/billing/invoices/:id/refunds", async (req, res, next) => {
  try {
    const refunds = await prisma.saasInvoiceRefund.findMany({
      where: { saasInvoiceId: req.params.id },
      orderBy: { createdAt: "desc" },
    });
    res.json(refunds);
  } catch (err) {
    next(err);
  }
});

//  DUNNING CONSOLE

// GET /api/admin/billing/dunning — list invoices with failed payments / overdue
router.get("/billing/dunning", async (_req, res, next) => {
  try {
    const now = new Date();
    const rows = await prisma.saasInvoice.findMany({
      where: {
        status: { in: ["past_due", "issued"] },
        OR: [
          { failedAttempts: { gt: 0 } },
          { dueDate: { lt: now } },
        ],
        writeOffAt: null,
      },
      include: { tenant: { select: { id: true, name: true, gracePeriodStartedAt: true } } },
      orderBy: [{ failedAttempts: "desc" }, { dueDate: "asc" }],
    });

    const items = rows
      .filter((inv) => saasInvoiceOutstandingCents(inv) > 0)
      .map((inv) => {
        const due = inv.dueDate ?? inv.issuedAt;
        const daysOverdue = Math.max(
          0,
          Math.floor((now.getTime() - due.getTime()) / (24 * 60 * 60 * 1000)),
        );
        // Auto-lock 30 days into grace period; show countdown.
        const graceStart = inv.tenant.gracePeriodStartedAt;
        const autoLockAt = graceStart
          ? new Date(graceStart.getTime() + 30 * 24 * 60 * 60 * 1000)
          : null;
        const hoursUntilLock = autoLockAt
          ? Math.max(
              0,
              Math.floor((autoLockAt.getTime() - now.getTime()) / (60 * 60 * 1000)),
            )
          : null;

        return {
          id: inv.id,
          tenantId: inv.tenantId,
          tenantName: inv.tenant.name,
          amountCents: inv.amountCents,
          discountCents: inv.discountCents,
          refundedCents: inv.refundedCents,
          outstandingCents: saasInvoiceOutstandingCents(inv),
          status: inv.status,
          dueDate: inv.dueDate?.toISOString() ?? null,
          daysOverdue,
          failedAttempts: inv.failedAttempts,
          lastAttemptAt: inv.lastAttemptAt?.toISOString() ?? null,
          nextRetryAt: inv.nextRetryAt?.toISOString() ?? null,
          dunningPaused: inv.dunningPaused,
          pausedUntil: inv.pausedUntil?.toISOString() ?? null,
          autoLockAt: autoLockAt?.toISOString() ?? null,
          hoursUntilLock,
        };
      });

    res.json({ items, count: items.length });
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/billing/dunning/:invoiceId/retry — record a retry attempt
router.post("/billing/dunning/:invoiceId/retry", async (req, res, next) => {
  try {
    const invoice = await prisma.saasInvoice.findUnique({
      where: { id: req.params.invoiceId },
    });
    if (!invoice) {
      res.status(404).json({ error: "Invoice not found" });
      return;
    }

    // We don't attempt the actual Stripe charge here — Stripe Smart Retries
    // owns the subscription invoice retry cadence. This endpoint records
    // an operator-initiated retry intent so it shows up in the audit trail.
    const updated = await prisma.saasInvoice.update({
      where: { id: invoice.id },
      data: {
        failedAttempts: { increment: 1 },
        lastAttemptAt: new Date(),
        nextRetryAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });

    await prisma.auditLog.create({
      data: {
        tenantId: invoice.tenantId,
        recordType: "SaasInvoice",
        recordId: invoice.id,
        action: "DUNNING_RETRY",
        changedFieldsJson: { triggeredBy: "platform_admin" },
      },
    });

    res.json({
      id: updated.id,
      failedAttempts: updated.failedAttempts,
      lastAttemptAt: updated.lastAttemptAt,
      nextRetryAt: updated.nextRetryAt,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/billing/dunning/:invoiceId/remind — send reminder email
router.post("/billing/dunning/:invoiceId/remind", async (req, res, next) => {
  try {
    const invoice = await prisma.saasInvoice.findUnique({
      where: { id: req.params.invoiceId },
      include: { tenant: { select: { id: true, name: true } } },
    });
    if (!invoice) {
      res.status(404).json({ error: "Invoice not found" });
      return;
    }

    const owners = await prisma.user.findMany({
      where: { tenantId: invoice.tenantId, role: "MARINA_OWNER", active: true },
      select: { email: true },
    });
    const recipients = owners.map((u) => u.email).filter((e): e is string => !!e);

    if (recipients.length === 0) {
      res.status(400).json({ error: "No active owner email on file" });
      return;
    }

    const outstanding = saasInvoiceOutstandingCents(invoice);
    const amountStr = `$${(outstanding / 100).toFixed(2)}`;

    let sent = false;
    try {
      await sendEmail({
        to: recipients,
        subject: `Reminder: payment due on your Helm subscription (${amountStr})`,
        html: `<p>Hi ${invoice.tenant.name},</p>
<p>Your Helm subscription payment of <strong>${amountStr}</strong> is past due. Please update your payment method to keep your account active.</p>
<p><a href="${process.env.APP_URL ?? "https://gethelm.com"}/settings/billing">Update payment method</a></p>`,
        tags: [{ name: "event", value: "saas_dunning_reminder" }],
      });
      sent = true;
    } catch (err) {
      console.warn("[dunning] reminder send failed:", err);
    }

    await prisma.auditLog.create({
      data: {
        tenantId: invoice.tenantId,
        recordType: "SaasInvoice",
        recordId: invoice.id,
        action: "DUNNING_REMINDER_SENT",
        changedFieldsJson: { recipients, sent },
      },
    });

    res.json({ sent, recipients });
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/billing/dunning/:invoiceId/pause — pause auto-lock
router.post("/billing/dunning/:invoiceId/pause", async (req, res, next) => {
  try {
    const { days = 7 } = req.body ?? {};
    const invoice = await prisma.saasInvoice.findUnique({
      where: { id: req.params.invoiceId },
    });
    if (!invoice) {
      res.status(404).json({ error: "Invoice not found" });
      return;
    }

    const pausedUntil = new Date(Date.now() + Number(days) * 24 * 60 * 60 * 1000);

    const updated = await prisma.saasInvoice.update({
      where: { id: invoice.id },
      data: { dunningPaused: true, pausedUntil },
    });

    await prisma.auditLog.create({
      data: {
        tenantId: invoice.tenantId,
        recordType: "SaasInvoice",
        recordId: invoice.id,
        action: "DUNNING_PAUSED",
        changedFieldsJson: { days, pausedUntil: pausedUntil.toISOString() },
      },
    });

    res.json({
      id: updated.id,
      dunningPaused: updated.dunningPaused,
      pausedUntil: updated.pausedUntil,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/billing/dunning/:invoiceId/resume — resume auto-lock
router.post("/billing/dunning/:invoiceId/resume", async (req, res, next) => {
  try {
    const updated = await prisma.saasInvoice.update({
      where: { id: req.params.invoiceId },
      data: { dunningPaused: false, pausedUntil: null },
    });
    await prisma.auditLog.create({
      data: {
        tenantId: updated.tenantId,
        recordType: "SaasInvoice",
        recordId: updated.id,
        action: "DUNNING_RESUMED",
        changedFieldsJson: {},
      },
    });
    res.json({ id: updated.id, dunningPaused: updated.dunningPaused });
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/billing/dunning/:invoiceId/write-off — write off invoice
router.post("/billing/dunning/:invoiceId/write-off", async (req, res, next) => {
  try {
    const { reason } = req.body ?? {};
    if (!reason || typeof reason !== "string") {
      res.status(400).json({ error: "reason is required" });
      return;
    }

    const invoice = await prisma.saasInvoice.findUnique({
      where: { id: req.params.invoiceId },
    });
    if (!invoice) {
      res.status(404).json({ error: "Invoice not found" });
      return;
    }
    if (invoice.writeOffAt) {
      res.status(400).json({ error: "Invoice already written off" });
      return;
    }

    const updated = await prisma.saasInvoice.update({
      where: { id: invoice.id },
      data: {
        status: "written_off",
        writeOffAt: new Date(),
        writeOffReason: reason,
      },
    });

    await prisma.auditLog.create({
      data: {
        tenantId: invoice.tenantId,
        recordType: "SaasInvoice",
        recordId: invoice.id,
        action: "WRITE_OFF",
        changedFieldsJson: { reason },
      },
    });

    res.json({
      id: updated.id,
      status: updated.status,
      writeOffAt: updated.writeOffAt,
      writeOffReason: updated.writeOffReason,
    });
  } catch (err) {
    next(err);
  }
});

//  PLAN CHANGES

// POST /api/admin/tenants/:id/plan/preview — preview proration
router.post("/tenants/:id/plan/preview", async (req, res, next) => {
  try {
    const { toTierId } = req.body ?? {};
    if (!toTierId) {
      res.status(400).json({ error: "toTierId is required" });
      return;
    }

    const preview = await previewPlanChange(req.params.id, toTierId);
    res.json(preview);
  } catch (err) {
    if (err instanceof Error && /not found/i.test(err.message)) {
      res.status(404).json({ error: err.message });
      return;
    }
    next(err);
  }
});

// --------------------------------------------------------------------------
// POST /api/admin/tenants/bulk/tier — switch tenants to a new SaaS tier
// --------------------------------------------------------------------------
router.post("/bulk/tenants/tier", async (req, res, next) => {
  try {
    const ids = parseBulkTargets(req);
    const saasTierId = (req.body as Record<string, unknown> | undefined)?.saasTierId as string | undefined;
    if (ids.length === 0) {
      res.status(400).json({ error: "tenantIds is required (non-empty array)" });
      return;
    }
    if (!saasTierId) {
      res.status(400).json({ error: "saasTierId is required" });
      return;
    }

    const tier = await prisma.saasTier.findUnique({ where: { id: saasTierId } });
    if (!tier) {
      res.status(400).json({ error: "Invalid saasTierId" });
      return;
    }

    const before = await prisma.tenant.findMany({
      where: { id: { in: ids } },
      select: { id: true, saasTierId: true },
    });

    const result = await prisma.tenant.updateMany({
      where: { id: { in: ids } },
      data: { saasTierId },
    });

    await Promise.all(
      before.map((t) =>
        recordAdminEvent(req, "TENANT_TIER_CHANGED", {
          tenantId: t.id,
          metadata: {
            from: t.saasTierId,
            to: saasTierId,
            tierName: tier.name,
            bulk: true,
          },
        }),
      ),
    );

    res.json({ updated: result.count, tierName: tier.name });
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/tenants/:id/plan/change — apply plan change with proration
router.post("/tenants/:id/plan/change", async (req, res, next) => {
  try {
    const { toTierId } = req.body ?? {};
    if (!toTierId) {
      res.status(400).json({ error: "toTierId is required" });
      return;
    }

    const userId =
      ((req as unknown as Record<string, unknown>).userId as string | undefined) ??
      null;

    const tenant = await prisma.tenant.findUnique({
      where: { id: req.params.id },
      select: { saasTierId: true },
    });
    if (!tenant) {
      res.status(404).json({ error: "Tenant not found" });
      return;
    }
    if (tenant.saasTierId === toTierId) {
      res.status(400).json({ error: "Tenant is already on this tier" });
      return;
    }

    const preview = await previewPlanChange(req.params.id, toTierId);
    const result = await applyPlanChange({
      tenantId: req.params.id,
      toTierId,
      createdBy: userId,
    });

    await prisma.auditLog.create({
      data: {
        tenantId: req.params.id,
        userId,
        recordType: "Tenant",
        recordId: req.params.id,
        action: "PLAN_CHANGED",
        changedFieldsJson: {
          fromTierName: preview.fromTierName,
          toTierName: preview.toTierName,
          prorationCents: result.prorationCents,
        },
      },
    });

    res.json({ ...preview, planChangeId: result.planChangeId });
  } catch (err) {
    if (err instanceof Error && /not found/i.test(err.message)) {
      res.status(404).json({ error: err.message });
      return;
    }
    next(err);
  }
});

// GET /api/admin/tenants/:id/plan/changes — history
router.get("/tenants/:id/plan/changes", async (req, res, next) => {
  try {
    const changes = await prisma.saasPlanChange.findMany({
      where: { tenantId: req.params.id },
      orderBy: { createdAt: "desc" },
    });

    const tierIds = [...new Set(changes.flatMap((c) => [c.fromTierId, c.toTierId].filter(Boolean) as string[]))];
    const tiers = await prisma.saasTier.findMany({
      where: { id: { in: tierIds } },
      select: { id: true, name: true },
    });
    const tierMap = new Map(tiers.map((t) => [t.id, t.name]));

    res.json(
      changes.map((c) => ({
        id: c.id,
        fromTier: c.fromTierId ? tierMap.get(c.fromTierId) ?? null : null,
        toTier: tierMap.get(c.toTierId) ?? null,
        prorationCents: c.prorationCents,
        effectiveAt: c.effectiveAt.toISOString(),
        createdAt: c.createdAt.toISOString(),
      })),
    );
  } catch (err) {
    next(err);
  }
});

//  ADMIN ACTIVITY LOG (read-only across all admin sub-roles)

// GET /api/admin/activity?actor=&action=&tenantId=&startDate=&endDate=&page=&limit=
router.get("/activity", allowAnyAdmin, async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit as string) || 50));
    const actor = (req.query.actor as string | undefined)?.trim();
    const action = (req.query.action as string | undefined)?.trim();
    const tenantId = (req.query.tenantId as string | undefined)?.trim();
    const startDate = req.query.startDate ? new Date(req.query.startDate as string) : null;
    const endDate = req.query.endDate ? new Date(req.query.endDate as string) : null;

    const where: Record<string, unknown> = {};
    if (actor) {
      where.OR = [
        { actorEmail: { contains: actor, mode: "insensitive" } },
        { actorName: { contains: actor, mode: "insensitive" } },
        { actorUserId: actor },
      ];
    }
    if (action) where.action = action;
    if (tenantId) where.targetTenantId = tenantId;
    if (startDate || endDate) {
      const createdAt: Record<string, Date> = {};
      if (startDate && !Number.isNaN(startDate.getTime())) createdAt.gte = startDate;
      if (endDate && !Number.isNaN(endDate.getTime())) createdAt.lte = endDate;
      where.createdAt = createdAt;
    }

    const [items, total] = await Promise.all([
      prisma.adminAuditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.adminAuditLog.count({ where }),
    ]);

    // Hydrate target tenant names so the UI doesn't need a second call.
    const tenantIds = [...new Set(items.map((i) => i.targetTenantId).filter(Boolean) as string[])];
    const tenants = tenantIds.length
      ? await prisma.tenant.findMany({
          where: { id: { in: tenantIds } },
          select: { id: true, name: true, subdomain: true },
        })
      : [];
    const tenantMap = new Map(tenants.map((t) => [t.id, t]));

    res.json({
      items: items.map((i) => ({
        ...i,
        targetTenant: i.targetTenantId ? tenantMap.get(i.targetTenantId) ?? null : null,
      })),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------------
// POST /api/admin/tenants/bulk/announce — send an in-app announcement to
// each selected tenant. Reuses the per-tenant Announcement table so the
// message lands in the tenant operator inbox just like a tenant-authored
// announcement.
// --------------------------------------------------------------------------
router.post("/bulk/tenants/announce", async (req, res, next) => {
  try {
    const ids = parseBulkTargets(req);
    const subject = ((req.body as Record<string, unknown> | undefined)?.subject as string ?? "").trim();
    const body = ((req.body as Record<string, unknown> | undefined)?.body as string ?? "").trim();
    const isEmergency = Boolean((req.body as Record<string, unknown> | undefined)?.isEmergency);

    if (ids.length === 0) {
      res.status(400).json({ error: "tenantIds is required (non-empty array)" });
      return;
    }
    if (!subject || !body) {
      res.status(400).json({ error: "subject and body are required" });
      return;
    }

    const batchId = randomUUID();
    let created = 0;

    for (const tenantId of ids) {
      try {
        const announcement = await prisma.announcement.create({
          data: {
            tenantId,
            subject,
            body,
            channels: "EMAIL",
            isEmergency,
            sentAt: new Date(),
            staffId: req.userId ?? "platform_admin",
          },
        });
        created++;
        await recordAdminEvent(req, "ANNOUNCEMENT_SENT", {
          tenantId,
          metadata: {
            batchId,
            announcementId: announcement.id,
            subject,
            isEmergency,
          },
        });
      } catch (err) {
        console.error("[admin.bulk.announce] failed for tenant", tenantId, err);
      }
    }

    res.json({ created, batchId, skipped: ids.length - created });
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/billing/invoices/:id/refunds
router.get("/billing/invoices/:id/refunds", async (req, res, next) => {
  try {
    const refunds = await prisma.saasInvoiceRefund.findMany({
      where: { saasInvoiceId: req.params.id },
      orderBy: { createdAt: "desc" },
    });
    res.json(refunds);
  } catch (err) {
    next(err);
  }
});

//  DUNNING CONSOLE

// GET /api/admin/billing/dunning — list invoices with failed payments / overdue
router.get("/billing/dunning", async (_req, res, next) => {
  try {
    const now = new Date();
    const rows = await prisma.saasInvoice.findMany({
      where: {
        status: { in: ["past_due", "issued"] },
        OR: [
          { failedAttempts: { gt: 0 } },
          { dueDate: { lt: now } },
        ],
        writeOffAt: null,
      },
      include: { tenant: { select: { id: true, name: true, gracePeriodStartedAt: true } } },
      orderBy: [{ failedAttempts: "desc" }, { dueDate: "asc" }],
    });

    const items = rows
      .filter((inv) => saasInvoiceOutstandingCents(inv) > 0)
      .map((inv) => {
        const due = inv.dueDate ?? inv.issuedAt;
        const daysOverdue = Math.max(
          0,
          Math.floor((now.getTime() - due.getTime()) / (24 * 60 * 60 * 1000)),
        );
        // Auto-lock 30 days into grace period; show countdown.
        const graceStart = inv.tenant.gracePeriodStartedAt;
        const autoLockAt = graceStart
          ? new Date(graceStart.getTime() + 30 * 24 * 60 * 60 * 1000)
          : null;
        const hoursUntilLock = autoLockAt
          ? Math.max(
              0,
              Math.floor((autoLockAt.getTime() - now.getTime()) / (60 * 60 * 1000)),
            )
          : null;

        return {
          id: inv.id,
          tenantId: inv.tenantId,
          tenantName: inv.tenant.name,
          amountCents: inv.amountCents,
          discountCents: inv.discountCents,
          refundedCents: inv.refundedCents,
          outstandingCents: saasInvoiceOutstandingCents(inv),
          status: inv.status,
          dueDate: inv.dueDate?.toISOString() ?? null,
          daysOverdue,
          failedAttempts: inv.failedAttempts,
          lastAttemptAt: inv.lastAttemptAt?.toISOString() ?? null,
          nextRetryAt: inv.nextRetryAt?.toISOString() ?? null,
          dunningPaused: inv.dunningPaused,
          pausedUntil: inv.pausedUntil?.toISOString() ?? null,
          autoLockAt: autoLockAt?.toISOString() ?? null,
          hoursUntilLock,
        };
      });

    res.json({ items, count: items.length });
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/billing/dunning/:invoiceId/retry — record a retry attempt
router.post("/billing/dunning/:invoiceId/retry", async (req, res, next) => {
  try {
    const invoice = await prisma.saasInvoice.findUnique({
      where: { id: req.params.invoiceId },
    });
    if (!invoice) {
      res.status(404).json({ error: "Invoice not found" });
      return;
    }

    // We don't attempt the actual Stripe charge here — Stripe Smart Retries
    // owns the subscription invoice retry cadence. This endpoint records
    // an operator-initiated retry intent so it shows up in the audit trail.
    const updated = await prisma.saasInvoice.update({
      where: { id: invoice.id },
      data: {
        failedAttempts: { increment: 1 },
        lastAttemptAt: new Date(),
        nextRetryAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });

    await prisma.auditLog.create({
      data: {
        tenantId: invoice.tenantId,
        recordType: "SaasInvoice",
        recordId: invoice.id,
        action: "DUNNING_RETRY",
        changedFieldsJson: { triggeredBy: "platform_admin" },
      },
    });

    res.json({
      id: updated.id,
      failedAttempts: updated.failedAttempts,
      lastAttemptAt: updated.lastAttemptAt,
      nextRetryAt: updated.nextRetryAt,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/activity/actions — distinct action codes for filter dropdown
router.get("/activity/actions", allowAnyAdmin, async (_req, res, next) => {
  try {
    const rows = await prisma.adminAuditLog.findMany({
      distinct: ["action"],
      select: { action: true },
      orderBy: { action: "asc" },
    });
    res.json({ actions: rows.map((r) => r.action) });
  } catch (err) {
    next(err);
  }
});

//  ADMIN USER MANAGEMENT (Superuser only)

// GET /api/admin/users — list every PLATFORM_ADMIN user with their sub-role
router.get("/users", allowAnyAdmin, async (_req, res, next) => {
  try {
    const admins = await prisma.user.findMany({
      where: { role: "PLATFORM_ADMIN" },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        active: true,
        adminRole: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { email: "asc" },
    });
    res.json({ items: admins });
  } catch (err) {
    next(err);
  }
});

// PUT /api/admin/users/:id/role — change an admin's sub-role
router.put("/users/:id/role", allowSuperuserOnly, async (req, res, next) => {
  try {
    const { adminRole } = req.body as { adminRole?: unknown };
    if (!isAdminRole(adminRole)) {
      res.status(400).json({
        error: `adminRole must be one of: ${ADMIN_ROLES.join(", ")}`,
      });
      return;
    }

    const target = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!target || target.role !== "PLATFORM_ADMIN") {
      res.status(404).json({ error: "Admin user not found" });
      return;
    }

    // Don't let the last Superuser demote themselves — would lock everyone
    // out of role management permanently.
    if (target.adminRole === "SUPERUSER" && adminRole !== "SUPERUSER") {
      const remainingSuperusers = await prisma.user.count({
        where: {
          role: "PLATFORM_ADMIN",
          adminRole: "SUPERUSER",
          active: true,
          NOT: { id: target.id },
        },
      });
      if (remainingSuperusers === 0) {
        res.status(409).json({
          error: "Cannot demote the last Superuser — promote another admin first.",
          code: "LAST_SUPERUSER",
        });
        return;
      }
    }

    const updated = await prisma.user.update({
      where: { id: target.id },
      data: { adminRole },
      select: {
        id: true, email: true, firstName: true, lastName: true,
        active: true, adminRole: true, createdAt: true, updatedAt: true,
      },
    });

    await logAdminAction(req, {
      action: "ADMIN_ROLE_CHANGE",
      targetType: "USER",
      targetId: target.id,
      details: { from: target.adminRole, to: adminRole, email: target.email },
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// PUT /api/admin/users/:id/active — activate / deactivate a platform admin
router.put("/users/:id/active", allowSuperuserOnly, async (req, res, next) => {
  try {
    const active = Boolean(req.body?.active);
    const target = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!target || target.role !== "PLATFORM_ADMIN") {
      res.status(404).json({ error: "Admin user not found" });
      return;
    }

    if (!active && target.adminRole === "SUPERUSER") {
      const remainingSuperusers = await prisma.user.count({
        where: {
          role: "PLATFORM_ADMIN",
          adminRole: "SUPERUSER",
          active: true,
          NOT: { id: target.id },
        },
      });
      if (remainingSuperusers === 0) {
        res.status(409).json({
          error: "Cannot deactivate the last active Superuser.",
          code: "LAST_SUPERUSER",
        });
        return;
      }
    }

    const updated = await prisma.user.update({
      where: { id: target.id },
      data: { active },
      select: {
        id: true, email: true, firstName: true, lastName: true,
        active: true, adminRole: true, createdAt: true, updatedAt: true,
      },
    });

    await logAdminAction(req, {
      action: active ? "ADMIN_INVITE" : "ADMIN_DEACTIVATE",
      targetType: "USER",
      targetId: target.id,
      details: { email: target.email, active },
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/billing/dunning/:invoiceId/remind — send reminder email
router.post("/billing/dunning/:invoiceId/remind", async (req, res, next) => {
  try {
    const invoice = await prisma.saasInvoice.findUnique({
      where: { id: req.params.invoiceId },
      include: { tenant: { select: { id: true, name: true } } },
    });
    if (!invoice) {
      res.status(404).json({ error: "Invoice not found" });
      return;
    }

    const owners = await prisma.user.findMany({
      where: { tenantId: invoice.tenantId, role: "MARINA_OWNER", active: true },
      select: { email: true },
    });
    const recipients = owners.map((u) => u.email).filter((e): e is string => !!e);

    if (recipients.length === 0) {
      res.status(400).json({ error: "No active owner email on file" });
      return;
    }

    const outstanding = saasInvoiceOutstandingCents(invoice);
    const amountStr = `$${(outstanding / 100).toFixed(2)}`;

    let sent = false;
    try {
      await sendEmail({
        to: recipients,
        subject: `Reminder: payment due on your Helm subscription (${amountStr})`,
        html: `<p>Hi ${invoice.tenant.name},</p>
<p>Your Helm subscription payment of <strong>${amountStr}</strong> is past due. Please update your payment method to keep your account active.</p>
<p><a href="${process.env.APP_URL ?? "https://gethelm.com"}/settings/billing">Update payment method</a></p>`,
        tags: [{ name: "event", value: "saas_dunning_reminder" }],
      });
      sent = true;
    } catch (err) {
      console.warn("[dunning] reminder send failed:", err);
    }

    await prisma.auditLog.create({
      data: {
        tenantId: invoice.tenantId,
        recordType: "SaasInvoice",
        recordId: invoice.id,
        action: "DUNNING_REMINDER_SENT",
        changedFieldsJson: { recipients, sent },
      },
    });

    res.json({ sent, recipients });
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/billing/dunning/:invoiceId/pause — pause auto-lock
router.post("/billing/dunning/:invoiceId/pause", async (req, res, next) => {
  try {
    const { days = 7 } = req.body ?? {};
    const invoice = await prisma.saasInvoice.findUnique({
      where: { id: req.params.invoiceId },
    });
    if (!invoice) {
      res.status(404).json({ error: "Invoice not found" });
      return;
    }

    const pausedUntil = new Date(Date.now() + Number(days) * 24 * 60 * 60 * 1000);

    const updated = await prisma.saasInvoice.update({
      where: { id: invoice.id },
      data: { dunningPaused: true, pausedUntil },
    });

    await prisma.auditLog.create({
      data: {
        tenantId: invoice.tenantId,
        recordType: "SaasInvoice",
        recordId: invoice.id,
        action: "DUNNING_PAUSED",
        changedFieldsJson: { days, pausedUntil: pausedUntil.toISOString() },
      },
    });

    res.json({
      id: updated.id,
      dunningPaused: updated.dunningPaused,
      pausedUntil: updated.pausedUntil,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/billing/dunning/:invoiceId/resume — resume auto-lock
router.post("/billing/dunning/:invoiceId/resume", async (req, res, next) => {
  try {
    const updated = await prisma.saasInvoice.update({
      where: { id: req.params.invoiceId },
      data: { dunningPaused: false, pausedUntil: null },
    });
    await prisma.auditLog.create({
      data: {
        tenantId: updated.tenantId,
        recordType: "SaasInvoice",
        recordId: updated.id,
        action: "DUNNING_RESUMED",
        changedFieldsJson: {},
      },
    });
    res.json({ id: updated.id, dunningPaused: updated.dunningPaused });
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/billing/dunning/:invoiceId/write-off — write off invoice
router.post("/billing/dunning/:invoiceId/write-off", async (req, res, next) => {
  try {
    const { reason } = req.body ?? {};
    if (!reason || typeof reason !== "string") {
      res.status(400).json({ error: "reason is required" });
      return;
    }

    const invoice = await prisma.saasInvoice.findUnique({
      where: { id: req.params.invoiceId },
    });
    if (!invoice) {
      res.status(404).json({ error: "Invoice not found" });
      return;
    }
    if (invoice.writeOffAt) {
      res.status(400).json({ error: "Invoice already written off" });
      return;
    }

    const updated = await prisma.saasInvoice.update({
      where: { id: invoice.id },
      data: {
        status: "written_off",
        writeOffAt: new Date(),
        writeOffReason: reason,
      },
    });

    await prisma.auditLog.create({
      data: {
        tenantId: invoice.tenantId,
        recordType: "SaasInvoice",
        recordId: invoice.id,
        action: "WRITE_OFF",
        changedFieldsJson: { reason },
      },
    });

    res.json({
      id: updated.id,
      status: updated.status,
      writeOffAt: updated.writeOffAt,
      writeOffReason: updated.writeOffReason,
    });
  } catch (err) {
    next(err);
  }
});

//  PLAN CHANGES

// POST /api/admin/tenants/:id/plan/preview — preview proration
router.post("/tenants/:id/plan/preview", async (req, res, next) => {
  try {
    const { toTierId } = req.body ?? {};
    if (!toTierId) {
      res.status(400).json({ error: "toTierId is required" });
      return;
    }

    const preview = await previewPlanChange(req.params.id, toTierId);
    res.json(preview);
  } catch (err) {
    if (err instanceof Error && /not found/i.test(err.message)) {
      res.status(404).json({ error: err.message });
      return;
    }
    next(err);
  }
});

// --------------------------------------------------------------------------
// POST /api/admin/tenants/bulk/tier — switch tenants to a new SaaS tier
// --------------------------------------------------------------------------
router.post("/bulk/tenants/tier", async (req, res, next) => {
  try {
    const ids = parseBulkTargets(req);
    const saasTierId = (req.body as Record<string, unknown> | undefined)?.saasTierId as string | undefined;
    if (ids.length === 0) {
      res.status(400).json({ error: "tenantIds is required (non-empty array)" });
      return;
    }
    if (!saasTierId) {
      res.status(400).json({ error: "saasTierId is required" });
      return;
    }

    const tier = await prisma.saasTier.findUnique({ where: { id: saasTierId } });
    if (!tier) {
      res.status(400).json({ error: "Invalid saasTierId" });
      return;
    }

    const before = await prisma.tenant.findMany({
      where: { id: { in: ids } },
      select: { id: true, saasTierId: true },
    });

    const result = await prisma.tenant.updateMany({
      where: { id: { in: ids } },
      data: { saasTierId },
    });

    await Promise.all(
      before.map((t) =>
        recordAdminEvent(req, "TENANT_TIER_CHANGED", {
          tenantId: t.id,
          metadata: {
            from: t.saasTierId,
            to: saasTierId,
            tierName: tier.name,
            bulk: true,
          },
        }),
      ),
    );

    res.json({ updated: result.count, tierName: tier.name });
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/tenants/:id/plan/change — apply plan change with proration
router.post("/tenants/:id/plan/change", async (req, res, next) => {
  try {
    const { toTierId } = req.body ?? {};
    if (!toTierId) {
      res.status(400).json({ error: "toTierId is required" });
      return;
    }

    const userId =
      ((req as unknown as Record<string, unknown>).userId as string | undefined) ??
      null;

    const tenant = await prisma.tenant.findUnique({
      where: { id: req.params.id },
      select: { saasTierId: true },
    });
    if (!tenant) {
      res.status(404).json({ error: "Tenant not found" });
      return;
    }
    if (tenant.saasTierId === toTierId) {
      res.status(400).json({ error: "Tenant is already on this tier" });
      return;
    }

    const preview = await previewPlanChange(req.params.id, toTierId);
    const result = await applyPlanChange({
      tenantId: req.params.id,
      toTierId,
      createdBy: userId,
    });

    await prisma.auditLog.create({
      data: {
        tenantId: req.params.id,
        userId,
        recordType: "Tenant",
        recordId: req.params.id,
        action: "PLAN_CHANGED",
        changedFieldsJson: {
          fromTierName: preview.fromTierName,
          toTierName: preview.toTierName,
          prorationCents: result.prorationCents,
        },
      },
    });

    res.json({ ...preview, planChangeId: result.planChangeId });
  } catch (err) {
    if (err instanceof Error && /not found/i.test(err.message)) {
      res.status(404).json({ error: err.message });
      return;
    }
    next(err);
  }
});
router.get("/tenants/:id/exports", allowAnyAdmin, async (req, res, next) => {
  try {
    const rows = await prisma.tenantExport.findMany({
      where: { tenantId: req.params.id },
      orderBy: { createdAt: "desc" },
      take: 25,
    });
    res.json({ items: rows.map((r) => publicExportView(r)) });
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/tenants/:id/exports — create a tenant data export
router.post("/tenants/:id/exports", allowSuperuserOnly, async (req, res, next) => {
  try {
    const tenant = await prisma.tenant.findUnique({ where: { id: req.params.id } });
    if (!tenant) {
      res.status(404).json({ error: "Tenant not found" });
      return;
    }

    const record = req.userRecord as Record<string, unknown> | undefined;
    const result = await runTenantExport({
      tenantId: tenant.id,
      requestedById: (req.userId as string) ?? "unknown",
      requestedByEmail: (record?.email as string | undefined) ?? "unknown",
    });

    await logAdminAction(req, {
      action: "TENANT_EXPORT_REQUEST",
      targetTenantId: tenant.id,
      targetType: "TENANT_EXPORT",
      targetId: result.id,
      details: {
        status: result.status,
        fileSizeBytes: result.fileSizeBytes,
        rowCounts: result.rowCounts,
      },
    });

    res.status(201).json(publicExportView(result));
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/tenants/:id/exports/:exportId/download?token=
//   Streams the zip back. The token check is in addition to admin auth so
//   the link is still single-tenant-scoped and harder to misuse.
router.get("/tenants/:id/exports/:exportId/download", allowSuperuserOnly, async (req, res, next) => {
  try {
    const exportRow = await prisma.tenantExport.findUnique({
      where: { id: req.params.exportId },
    });
    if (!exportRow || exportRow.tenantId !== req.params.id) {
      res.status(404).json({ error: "Export not found" });
      return;
    }
    if (exportRow.status !== "COMPLETED") {
      res.status(409).json({ error: `Export not ready (status=${exportRow.status})` });
      return;
    }
    if (exportRow.expiresAt && exportRow.expiresAt < new Date()) {
      res.status(410).json({ error: "Export download link expired" });
      return;
    }
    const token = (req.query.token as string | undefined)?.trim();
    if (!token || token !== exportRow.downloadToken) {
      res.status(403).json({ error: "Invalid download token" });
      return;
    }
    if (!exportRow.localBlob) {
      res.status(500).json({ error: "Export bytes missing" });
      return;
    }

    logAdminActionDetached(req, {
      action: "TENANT_EXPORT_DOWNLOAD",
      targetTenantId: exportRow.tenantId,
      targetType: "TENANT_EXPORT",
      targetId: exportRow.id,
    });

    res.setHeader("Content-Type", "application/zip");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="tenant-${exportRow.tenantId}-${exportRow.id}.zip"`,
    );
    res.send(Buffer.from(exportRow.localBlob));
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/tenants/:id/plan/changes — history
router.get("/tenants/:id/plan/changes", async (req, res, next) => {
  try {
    const changes = await prisma.saasPlanChange.findMany({
      where: { tenantId: req.params.id },
      orderBy: { createdAt: "desc" },
    });

    const tierIds = [...new Set(changes.flatMap((c) => [c.fromTierId, c.toTierId].filter(Boolean) as string[]))];
    const tiers = await prisma.saasTier.findMany({
      where: { id: { in: tierIds } },
      select: { id: true, name: true },
    });
    const tierMap = new Map(tiers.map((t) => [t.id, t.name]));

    res.json(
      changes.map((c) => ({
        id: c.id,
        fromTier: c.fromTierId ? tierMap.get(c.fromTierId) ?? null : null,
        toTier: tierMap.get(c.toTierId) ?? null,
        prorationCents: c.prorationCents,
        effectiveAt: c.effectiveAt.toISOString(),
        createdAt: c.createdAt.toISOString(),
      })),
    );
  } catch (err) {
    next(err);
  }
});
router.get("/tenants/:id/deletion", allowAnyAdmin, async (req, res, next) => {
  try {
    const row = await prisma.tenantDeletion.findUnique({
      where: { tenantId: req.params.id },
    });
    res.json(row);
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/tenants/:id/deletion — schedule a hard-delete
//   Body: { confirmation: <subdomain> } — must echo the subdomain so an
//   accidental click cannot wipe a tenant.
router.post("/tenants/:id/deletion", allowSuperuserOnly, async (req, res, next) => {
  try {
    const tenant = await prisma.tenant.findUnique({ where: { id: req.params.id } });
    if (!tenant) {
      res.status(404).json({ error: "Tenant not found" });
      return;
    }
    if (req.body?.confirmation !== tenant.subdomain) {
      res.status(400).json({
        error: `Confirmation must equal the tenant subdomain ('${tenant.subdomain}')`,
        code: "BAD_CONFIRMATION",
      });
      return;
    }

    const existing = await prisma.tenantDeletion.findUnique({
      where: { tenantId: tenant.id },
    });
    if (existing && existing.status === "PENDING") {
      res.status(409).json({
        error: "A deletion is already pending for this tenant.",
        code: "ALREADY_PENDING",
        deletion: existing,
      });
      return;
    }
    if (existing && existing.status === "COMPLETED") {
      res.status(409).json({
        error: "This tenant has already been deleted.",
        code: "ALREADY_DELETED",
      });
      return;
    }

    const record = req.userRecord as Record<string, unknown> | undefined;
    const scheduledFor = new Date(Date.now() + GRACE_PERIOD_MS);
    const data = {
      tenantId: tenant.id,
      requestedById: (req.userId as string) ?? "unknown",
      requestedByEmail: (record?.email as string | undefined) ?? "unknown",
      scheduledFor,
      status: "PENDING" as const,
      cancelledAt: null,
      cancelledById: null,
      completedAt: null,
      errorMsg: null,
    };
    // Re-use the row if a previously-cancelled / failed deletion exists,
    // since `tenantId` is unique.
    const created = existing
      ? await prisma.tenantDeletion.update({
          where: { id: existing.id },
          data,
        })
      : await prisma.tenantDeletion.create({ data });

    await logAdminAction(req, {
      action: "TENANT_DELETE_REQUEST",
      targetTenantId: tenant.id,
      targetType: "TENANT",
      targetId: tenant.id,
      details: { scheduledFor, deletionId: created.id },
    });

    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/admin/tenants/:id/deletion — cancel a pending deletion
router.delete("/tenants/:id/deletion", allowSuperuserOnly, async (req, res, next) => {
  try {
    const existing = await prisma.tenantDeletion.findUnique({
      where: { tenantId: req.params.id },
    });
    if (!existing || existing.status !== "PENDING") {
      res.status(404).json({ error: "No pending deletion to cancel" });
      return;
    }

    const cancelled = await prisma.tenantDeletion.update({
      where: { id: existing.id },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
        cancelledById: (req.userId as string) ?? null,
      },
    });

    await logAdminAction(req, {
      action: "TENANT_DELETE_CANCEL",
      targetTenantId: req.params.id,
      targetType: "TENANT",
      targetId: req.params.id,
      details: { deletionId: existing.id },
    });

    res.json(cancelled);
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------------
// POST /api/admin/tenants/bulk/announce — send an in-app announcement to
// each selected tenant. Reuses the per-tenant Announcement table so the
// message lands in the tenant operator inbox just like a tenant-authored
// announcement.
router.post("/bulk/tenants/announce", async (req, res, next) => {
  try {
    const ids = parseBulkTargets(req);
    const subject = ((req.body as Record<string, unknown> | undefined)?.subject as string ?? "").trim();
    const body = ((req.body as Record<string, unknown> | undefined)?.body as string ?? "").trim();
    const isEmergency = Boolean((req.body as Record<string, unknown> | undefined)?.isEmergency);

    if (ids.length === 0) {
      res.status(400).json({ error: "tenantIds is required (non-empty array)" });
      return;
    }
    if (!subject || !body) {
      res.status(400).json({ error: "subject and body are required" });
      return;
    }

    const batchId = randomUUID();
    let created = 0;

    for (const tenantId of ids) {
      try {
        const announcement = await prisma.announcement.create({
          data: {
            tenantId,
            subject,
            body,
            channels: "EMAIL",
            isEmergency,
            sentAt: new Date(),
            staffId: req.userId ?? "platform_admin",
          },
        });
        created++;
        await recordAdminEvent(req, "ANNOUNCEMENT_SENT", {
          tenantId,
          metadata: {
            batchId,
            announcementId: announcement.id,
            subject,
            isEmergency,
          },
        });
      } catch (err) {
        console.error("[admin.bulk.announce] failed for tenant", tenantId, err);
      }
    }

    res.json({ created, batchId, skipped: ids.length - created });
  } catch (err) {
    next(err);
  }
});

// A12 — Platform announcements admin CRUD sub-router.
import { buildAdminAnnouncementsRouter } from "./announcements-platform.js";
router.use("/announcements", buildAdminAnnouncementsRouter());

// A6 — Tenant feature-flag editor.
import {
  FEATURE_FLAGS,
  resolveTenantFlags,
  setTenantFlag,
  clearTenantFlag,
} from "../services/feature-flags.js";

// A8 — Tenant outbound webhook destinations.
import { STANDARD_EVENTS, generateSigningSecret } from "../services/outbound-webhooks.js";

// GET /api/admin/feature-flags/registry — the static flag catalog (no per-tenant data).
router.get("/feature-flags/registry", (_req, res) => {
  res.json({ flags: FEATURE_FLAGS });
});

// GET /api/admin/tenants/:id/feature-flags — resolved flags for one tenant.
router.get("/tenants/:id/feature-flags", async (req, res, next) => {
  try {
    const exists = await prisma.tenant.findUnique({
      where: { id: req.params.id },
      select: { id: true },
    });
    if (!exists) {
      res.status(404).json({ error: "Tenant not found" });
      return;
    }
    const flags = await resolveTenantFlags(req.params.id);
    res.json({ flags });
  } catch (err) { next(err); }
});

// PUT /api/admin/tenants/:id/feature-flags/:flag — upsert override.
router.put("/tenants/:id/feature-flags/:flag", allowMutations, async (req, res, next) => {
  try {
    const { enabled, reason } = req.body as { enabled?: unknown; reason?: unknown };
    if (typeof enabled !== "boolean") {
      res.status(400).json({ error: "`enabled` must be a boolean" });
      return;
    }
    const trimmedReason = typeof reason === "string" ? reason.trim().slice(0, 500) : null;

    const tenant = await prisma.tenant.findUnique({
      where: { id: req.params.id },
      select: { id: true, name: true },
    });
    if (!tenant) {
      res.status(404).json({ error: "Tenant not found" });
      return;
    }

    let resolved;
    try {
      resolved = await setTenantFlag({
        tenantId: req.params.id,
        flag: req.params.flag,
        enabled,
        reason: trimmedReason,
        updatedBy: req.userId ?? null,
      });
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : "Invalid flag" });
      return;
    }

    await recordAdminEvent(req, "FEATURE_FLAG_SET", {
      tenantId: tenant.id,
      metadata: {
        flag: req.params.flag,
        enabled,
        reason: trimmedReason,
      },
    });
    res.json(resolved);
  } catch (err) { next(err); }
});

// DELETE /api/admin/tenants/:id/feature-flags/:flag — remove override (revert to default).
router.delete("/tenants/:id/feature-flags/:flag", allowMutations, async (req, res, next) => {
  try {
    await clearTenantFlag(req.params.id, req.params.flag);
    await recordAdminEvent(req, "FEATURE_FLAG_CLEARED", {
      tenantId: req.params.id,
      metadata: { flag: req.params.flag },
    });
    res.status(204).end();
  } catch (err) { next(err); }
});

// ─── A8: Tenant outbound webhook destinations + delivery log ───────────────

// GET /api/admin/webhooks/events — catalog of standard event names.
router.get("/webhooks/events", (_req, res) => {
  res.json({ events: STANDARD_EVENTS });
});

// GET /api/admin/tenants/:id/webhooks — destinations for this tenant.
router.get("/tenants/:id/webhooks", async (req, res, next) => {
  try {
    const destinations = await prisma.webhookDestination.findMany({
      where: { tenantId: req.params.id },
      orderBy: { createdAt: "desc" },
    });
    res.json({ destinations });
  } catch (err) { next(err); }
});

// POST /api/admin/tenants/:id/webhooks — create destination.
router.post("/tenants/:id/webhooks", allowMutations, async (req, res, next) => {
  try {
    const { name, url, events } = req.body as {
      name?: string; url?: string; events?: unknown;
    };
    if (typeof name !== "string" || !name.trim()) {
      res.status(400).json({ error: "name is required" }); return;
    }
    if (typeof url !== "string" || !/^https?:\/\//.test(url.trim())) {
      res.status(400).json({ error: "url must start with http(s)://" }); return;
    }
    const eventList = Array.isArray(events)
      ? events.filter((e): e is string => typeof e === "string" && STANDARD_EVENTS.includes(e as never))
      : [];
    if (eventList.length === 0) {
      res.status(400).json({ error: "Pick at least one event to subscribe to" }); return;
    }
    const tenant = await prisma.tenant.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!tenant) { res.status(404).json({ error: "Tenant not found" }); return; }

    const created = await prisma.webhookDestination.create({
      data: {
        tenantId: req.params.id,
        name: name.trim(),
        url: url.trim(),
        signingSecret: generateSigningSecret(),
        events: eventList,
      },
    });
    res.status(201).json(created);
  } catch (err) { next(err); }
});

// PUT /api/admin/tenants/:id/webhooks/:destId — update name/url/events/enabled.
router.put("/tenants/:id/webhooks/:destId", allowMutations, async (req, res, next) => {
  try {
    const dest = await prisma.webhookDestination.findFirst({
      where: { id: req.params.destId, tenantId: req.params.id },
    });
    if (!dest) { res.status(404).json({ error: "Destination not found" }); return; }
    const { name, url, events, enabled } = req.body as {
      name?: unknown; url?: unknown; events?: unknown; enabled?: unknown;
    };
    const data: Record<string, unknown> = {};
    if (typeof name === "string" && name.trim()) data.name = name.trim();
    if (typeof url === "string" && /^https?:\/\//.test(url.trim())) data.url = url.trim();
    if (Array.isArray(events)) {
      data.events = events.filter((e): e is string =>
        typeof e === "string" && STANDARD_EVENTS.includes(e as never),
      );
    }
    if (typeof enabled === "boolean") {
      data.enabled = enabled;
      // Re-enabling a destination resets failure tracking.
      if (enabled) {
        data.consecutiveFailures = 0;
        data.disabledAt = null;
      }
    }
    const updated = await prisma.webhookDestination.update({ where: { id: dest.id }, data });
    res.json(updated);
  } catch (err) { next(err); }
});

// DELETE /api/admin/tenants/:id/webhooks/:destId — remove destination.
router.delete("/tenants/:id/webhooks/:destId", allowMutations, async (req, res, next) => {
  try {
    const dest = await prisma.webhookDestination.findFirst({
      where: { id: req.params.destId, tenantId: req.params.id },
      select: { id: true },
    });
    if (!dest) { res.status(404).json({ error: "Destination not found" }); return; }
    await prisma.webhookDestination.delete({ where: { id: dest.id } });
    res.status(204).end();
  } catch (err) { next(err); }
});

// GET /api/admin/tenants/:id/webhooks/:destId/deliveries — recent log.
router.get("/tenants/:id/webhooks/:destId/deliveries", async (req, res, next) => {
  try {
    const dest = await prisma.webhookDestination.findFirst({
      where: { id: req.params.destId, tenantId: req.params.id },
      select: { id: true },
    });
    if (!dest) { res.status(404).json({ error: "Destination not found" }); return; }
    const deliveries = await prisma.webhookDelivery.findMany({
      where: { destinationId: dest.id },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true, event: true, status: true, httpStatus: true,
        responseSnippet: true, attempts: true, nextRetryAt: true,
        createdAt: true, deliveredAt: true,
      },
    });
    res.json({ deliveries });
  } catch (err) { next(err); }
});

export default router;
