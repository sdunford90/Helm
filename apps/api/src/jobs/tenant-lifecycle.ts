import { prisma } from '../lib/prisma.js';
import { enqueueEmail } from '../lib/queue.js';

// --------------------------------------------------------------------------
// Tenant Lifecycle Enforcement Job (SaaS subscription dunning)
//
// SAFETY (Phase 0): Helm has no SaaS-subscription billing model yet. The
// previous implementation treated ANY past-due *boater* invoice (a marina's
// own customer invoice) as the marina's unpaid Helm subscription, and would
// have moved the marina to GRACE_PERIOD and then LOCKED it (deactivating all
// staff users) because one boater paid late. That logic has been removed.
//
// What this job does now:
//   * It NEVER moves a tenant from ACTIVE to GRACE_PERIOD. Only a platform
//     admin (or, later, the SaaS billing integration) may set
//     Tenant.status = GRACE_PERIOD and Tenant.gracePeriodStartedAt.
//   * It is a no-op that only logs unless TENANT_LIFECYCLE_ENFORCEMENT_ENABLED
//     is "true". When enabled, it only acts on tenants a platform admin has
//     already placed in GRACE_PERIOD: day 7 / day 14 reminders, then LOCKED
//     after 30 days.
//
// TODO(saas-billing): replace the admin-set GRACE_PERIOD trigger with Helm's
// own Stripe Billing subscription status per tenant (see
// docs/audit/02-money-invoicing-payments.md F-LC-1). Boater invoices
// (prisma.invoice) must never be consulted here.
// --------------------------------------------------------------------------

export interface LifecycleResult {
  transitioned: number;
  notified: number;
  skipped?: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function isTenantLifecycleEnforcementEnabled(): boolean {
  return process.env.TENANT_LIFECYCLE_ENFORCEMENT_ENABLED === 'true';
}

const ownerSelect = {
  id: true,
  name: true,
  gracePeriodStartedAt: true,
  users: {
    where: { role: 'MARINA_OWNER' as const, active: true },
    select: { email: true, firstName: true },
    take: 1,
  },
};

async function notifyOwner(
  tenant: {
    id: string;
    name: string;
    gracePeriodStartedAt: Date | null;
    users: { email: string; firstName: string | null }[];
  },
  graceDayNumber: number,
  subject: string,
  message: string,
): Promise<boolean> {
  const owner = tenant.users[0];
  if (!owner?.email) return false;
  await enqueueEmail(
    'tenant-lifecycle-email',
    {
      type: 'tenant_lifecycle',
      tenantId: tenant.id,
      to: owner.email,
      tenantName: tenant.name,
      recipientName: owner.firstName ?? '',
      subject,
      message,
      graceDayNumber,
    },
    // Deterministic job id (BullMQ forbids ':' in custom ids): re-running the
    // job never double-sends the same notice for the same grace period.
    {
      jobId: `tenant-lifecycle-${tenant.id}-${tenant.gracePeriodStartedAt?.toISOString().slice(0, 10) ?? 'na'}-day${graceDayNumber}`,
    },
  );
  return true;
}

export async function runTenantLifecycleCheck(now: Date = new Date()): Promise<LifecycleResult> {
  if (!isTenantLifecycleEnforcementEnabled()) {
    console.log(
      '[tenant-lifecycle] Skipped: TENANT_LIFECYCLE_ENFORCEMENT_ENABLED is not "true" ' +
        '(no SaaS billing model yet; tenants are never locked automatically).',
    );
    return { transitioned: 0, notified: 0, skipped: true };
  }

  let transitioned = 0;
  let notified = 0;

  // NOTE: there is intentionally no ACTIVE → GRACE_PERIOD step here.

  // ── 1. GRACE_PERIOD → LOCKED (30+ days, admin-initiated grace only) ──────
  const thirtyDaysAgo = new Date(now.getTime() - 30 * DAY_MS);
  const expiredGraceTenants = await prisma.tenant.findMany({
    where: {
      status: 'GRACE_PERIOD',
      gracePeriodStartedAt: { not: null, lte: thirtyDaysAgo },
    },
    select: ownerSelect,
  });

  for (const tenant of expiredGraceTenants) {
    await prisma.tenant.update({
      where: { id: tenant.id },
      data: { status: 'LOCKED', lockedAt: now },
    });
    transitioned++;

    // Block staff logins. Never touch portal users or platform admins.
    await prisma.user.updateMany({
      where: {
        tenantId: tenant.id,
        role: { notIn: ['PORTAL_USER', 'PLATFORM_ADMIN'] },
      },
      data: { active: false },
    });

    if (
      await notifyOwner(
        tenant,
        30,
        'Your Helm account has been locked',
        'Your Helm account has been locked due to non-payment. Staff logins have been disabled. ' +
          'The customer portal remains available in read-only mode. Please contact support to restore access.',
      )
    ) {
      notified++;
    }
  }

  // ── 2. Mid-grace reminders (day 7 and day 14) ─────────────────────────────
  const reminders: { day: number; subject: string; message: string }[] = [
    {
      day: 7,
      subject: 'Action required: subscription payment overdue',
      message:
        'Your Helm subscription payment is now 7 days overdue. Please update your payment method ' +
        'immediately to maintain uninterrupted service.',
    },
    {
      day: 14,
      subject: 'Final notice: subscription will be locked in 16 days',
      message:
        'This is your final notice. Your Helm subscription payment is 14 days overdue. If payment is ' +
        'not received within 16 days, your account will be locked and staff access will be disabled.',
    },
  ];

  for (const r of reminders) {
    const windowEnd = new Date(now.getTime() - r.day * DAY_MS);
    const windowStart = new Date(now.getTime() - (r.day + 1) * DAY_MS);
    const tenants = await prisma.tenant.findMany({
      where: {
        status: 'GRACE_PERIOD',
        gracePeriodStartedAt: { gte: windowStart, lte: windowEnd },
      },
      select: ownerSelect,
    });
    for (const tenant of tenants) {
      if (await notifyOwner(tenant, r.day, r.subject, r.message)) notified++;
    }
  }

  console.log(
    `[tenant-lifecycle] Complete: ${transitioned} transitions, ${notified} notifications queued`,
  );

  return { transitioned, notified };
}
