import { prisma } from '../lib/prisma.js';
import { queues } from '../lib/queue.js';

// --------------------------------------------------------------------------
// Tenant Lifecycle Enforcement Job
//
// Runs daily to enforce SaaS subscription lifecycle:
//   ACTIVE → GRACE_PERIOD  (invoice 1+ days past due)
//   GRACE_PERIOD → LOCKED  (grace period 30+ days)
//
// Queues email notifications at day 1, 7, 14, and 30 of grace period.
// --------------------------------------------------------------------------

interface LifecycleResult {
  transitioned: number;
  notified: number;
}

export async function runTenantLifecycleCheck(): Promise<LifecycleResult> {
  const now = new Date();
  let transitioned = 0;
  let notified = 0;

  // ── 1. ACTIVE → GRACE_PERIOD ──────────────────────────────────────────────
  // Find active tenants whose SaaS subscription invoices are 1+ days past due.
  // We identify "SaaS invoices" as invoices where the tenant itself is the
  // customer context and the invoice is PAST_DUE with a dueDate before today.
  // Since there is no separate SaaS invoice model, we look for tenants with
  // status ACTIVE that have at least one PAST_DUE invoice with dueDate < now.
  // In production this would check the Stripe subscription status instead.

  const activeTenants = await prisma.tenant.findMany({
    where: { status: 'ACTIVE' },
    select: {
      id: true,
      name: true,
      users: {
        where: { role: 'MARINA_OWNER', active: true },
        select: { email: true, firstName: true },
        take: 1,
      },
    },
  });

  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  for (const tenant of activeTenants) {
    // Check if any invoice for this tenant is past due (dueDate before yesterday)
    const overdueInvoice = await prisma.invoice.findFirst({
      where: {
        tenantId: tenant.id,
        status: 'PAST_DUE',
        dueDate: { lt: oneDayAgo },
      },
    });

    if (overdueInvoice) {
      await prisma.tenant.update({
        where: { id: tenant.id },
        data: {
          status: 'GRACE_PERIOD',
          gracePeriodStartedAt: now,
        },
      });
      transitioned++;

      // Queue Day 1 grace period notification
      const owner = tenant.users[0];
      if (owner?.email) {
        await queues.email.add('tenant-lifecycle-email', {
          type: 'tenant_lifecycle',
          to: owner.email,
          data: {
            tenantName: tenant.name,
            recipientName: owner.firstName,
            subject: 'Your Helm subscription payment is past due',
            message:
              'Your Helm subscription payment is past due. Please update your payment method to avoid service interruption.',
            graceDayNumber: 1,
          },
        });
        notified++;
      }
    }
  }

  // ── 2. GRACE_PERIOD → LOCKED (30+ days) ───────────────────────────────────

  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const expiredGraceTenants = await prisma.tenant.findMany({
    where: {
      status: 'GRACE_PERIOD',
      gracePeriodStartedAt: { lte: thirtyDaysAgo },
    },
    select: {
      id: true,
      name: true,
      users: {
        where: { role: 'MARINA_OWNER', active: true },
        select: { email: true, firstName: true },
        take: 1,
      },
    },
  });

  for (const tenant of expiredGraceTenants) {
    await prisma.tenant.update({
      where: { id: tenant.id },
      data: {
        status: 'LOCKED',
        lockedAt: now,
      },
    });
    transitioned++;

    // Block staff logins by deactivating non-portal users
    await prisma.user.updateMany({
      where: {
        tenantId: tenant.id,
        role: { notIn: ['PORTAL_USER'] },
      },
      data: { active: false },
    });

    // Queue Day 30 lock notification
    const owner = tenant.users[0];
    if (owner?.email) {
      await queues.email.add('tenant-lifecycle-email', {
        type: 'tenant_lifecycle',
        to: owner.email,
        data: {
          tenantName: tenant.name,
          recipientName: owner.firstName,
          subject: 'Your Helm account has been locked',
          message:
            'Your Helm account has been locked due to non-payment. Staff logins have been disabled. The customer portal remains available in read-only mode. Please contact support to restore access.',
          graceDayNumber: 30,
        },
      });
      notified++;
    }
  }

  // ── 3. Mid-grace notifications (day 7 and day 14) ─────────────────────────

  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const eightDaysAgo = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000);
  const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
  const fifteenDaysAgo = new Date(now.getTime() - 15 * 24 * 60 * 60 * 1000);

  // Day 7 notification: grace started 7 days ago (within a 1-day window)
  const day7Tenants = await prisma.tenant.findMany({
    where: {
      status: 'GRACE_PERIOD',
      gracePeriodStartedAt: { gte: eightDaysAgo, lte: sevenDaysAgo },
    },
    select: {
      id: true,
      name: true,
      users: {
        where: { role: 'MARINA_OWNER', active: true },
        select: { email: true, firstName: true },
        take: 1,
      },
    },
  });

  for (const tenant of day7Tenants) {
    const owner = tenant.users[0];
    if (owner?.email) {
      await queues.email.add('tenant-lifecycle-email', {
        type: 'tenant_lifecycle',
        to: owner.email,
        data: {
          tenantName: tenant.name,
          recipientName: owner.firstName,
          subject: 'Action required: subscription payment overdue',
          message:
            'Your Helm subscription payment is now 7 days overdue. Please update your payment method immediately to maintain uninterrupted service.',
          graceDayNumber: 7,
        },
      });
      notified++;
    }
  }

  // Day 14 notification: grace started 14 days ago (within a 1-day window)
  const day14Tenants = await prisma.tenant.findMany({
    where: {
      status: 'GRACE_PERIOD',
      gracePeriodStartedAt: { gte: fifteenDaysAgo, lte: fourteenDaysAgo },
    },
    select: {
      id: true,
      name: true,
      users: {
        where: { role: 'MARINA_OWNER', active: true },
        select: { email: true, firstName: true },
        take: 1,
      },
    },
  });

  for (const tenant of day14Tenants) {
    const owner = tenant.users[0];
    if (owner?.email) {
      await queues.email.add('tenant-lifecycle-email', {
        type: 'tenant_lifecycle',
        to: owner.email,
        data: {
          tenantName: tenant.name,
          recipientName: owner.firstName,
          subject: 'Final notice: subscription will be locked in 16 days',
          message:
            'This is your final notice. Your Helm subscription payment is 14 days overdue. If payment is not received within 16 days, your account will be locked and staff access will be disabled.',
          graceDayNumber: 14,
        },
      });
      notified++;
    }
  }

  console.log(
    `[tenant-lifecycle] Complete: ${transitioned} transitions, ${notified} notifications queued`,
  );

  return { transitioned, notified };
}

export function scheduleTenantLifecycle(): void {
  queues.billing.add(
    'tenant-lifecycle',
    {},
    {
      repeat: { pattern: '0 6 * * *' }, // Daily at 6 AM
      removeOnComplete: 10,
    },
  );
}
