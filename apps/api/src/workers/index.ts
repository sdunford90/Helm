import { Worker } from "bullmq";
import { redisConnection, queues } from "../lib/queue.js";
import {
  sendEmail,
  invoiceEmailHtml,
  paymentReceiptHtml,
  achReturnHtml,
  expiryReminderHtml,
  announcementHtml,
  cardExpiryReminderHtml,
} from "../lib/email.js";
import { sendSms } from "../lib/sms.js";
import { prisma } from "../lib/prisma.js";
import { runAlgorithmicPricing } from "../jobs/algorithmic-pricing.js";
import { runTenantLifecycleCheck } from "../jobs/tenant-lifecycle.js";
import { runInventoryReconciliation } from "../jobs/inventory-reconciliation.js";
import { generateRecurringInvoices } from "../services/billing.js";
import { recognizeDeferred } from "../services/deferred-revenue.js";
import { runCardExpiryRemindersForAllTenants, runCardExpiryReminders } from "../services/card-expiry-reminders.js";
import {
  syncCustomer,
  syncInvoice,
  syncPayment,
  getValidAccessToken,
} from "../services/qbo-sync.js";
import { generateReportData, type ScheduleFormat } from "../services/report-data.js";

// --------------------------------------------------------------------------
// Email worker
// --------------------------------------------------------------------------

const emailWorker = new Worker(
  "email",
  async (job) => {
    const { type, to, data, marinaDomain } = job.data;

    let subject: string;
    let html: string;

    switch (type) {
      case "invoice":
        subject = `Invoice ${data.invoiceNumber} — ${data.amount} due ${data.dueDate}`;
        html = invoiceEmailHtml(data);
        break;
      case "payment_receipt":
        subject = `Payment received — ${data.amount}`;
        html = paymentReceiptHtml(data);
        break;
      case "ach_return":
        subject = "ACH Payment Returned — Action Required";
        html = achReturnHtml(data);
        break;
      case "expiry_reminder":
        subject = `Your ${data.documentType} expires on ${data.expiryDate}`;
        html = expiryReminderHtml(data);
        break;
      case "announcement":
        subject = data.subject;
        html = announcementHtml(data);
        break;
      case "card_expiry_reminder":
        subject =
          data.window === "7_DAY"
            ? `Action needed: your saved card expires ${data.expiryLabel}`
            : `Heads up: your saved card expires ${data.expiryLabel}`;
        html = cardExpiryReminderHtml(data);
        break;
      default:
        console.error(`[email-worker] Unknown email type: ${type}`);
        return;
    }

    const tenantId = job.data.tenantId as string | undefined;
    const messageId = await sendEmail(
      { to, subject, html, ...(tenantId ? { tenantId } : {}) },
      marinaDomain,
    );
    if (messageId) {
      console.log(`[email-worker] Sent ${type} email to ${to} (${messageId})`);
    }
  },
  { connection: redisConnection, concurrency: 10 },
);

emailWorker.on("failed", (job, err) => {
  console.error(`[email-worker] Job ${job?.id} failed:`, err.message);
});

// --------------------------------------------------------------------------
// SMS worker
// --------------------------------------------------------------------------

const smsWorker = new Worker(
  "sms",
  async (job) => {
    const { to, body, fromNumber } = job.data;
    const sid = await sendSms(to, body, fromNumber);
    if (sid) {
      console.log(`[sms-worker] Sent SMS to ${to} (${sid})`);
    }
  },
  { connection: redisConnection, concurrency: 5 },
);

smsWorker.on("failed", (job, err) => {
  console.error(`[sms-worker] Job ${job?.id} failed:`, err.message);
});

// --------------------------------------------------------------------------
// Automation worker (marketing sequences)
// --------------------------------------------------------------------------

const automationWorker = new Worker(
  "automation",
  async (job) => {
    // Handle algorithmic pricing job (recurring)
    if (job.name === "algorithmic-pricing") {
      const tenantId = job.data.tenantId;
      if (tenantId) {
        const result = await runAlgorithmicPricing(tenantId);
        console.log(`[automation-worker] Algorithmic pricing complete: ${result.suggestionsCreated} suggestions created`);
      } else {
        // If no specific tenant, run for all active tenants
        const tenants = await prisma.tenant.findMany({ where: { status: 'ACTIVE' }, select: { id: true } });
        let totalSuggestions = 0;
        for (const tenant of tenants) {
          const result = await runAlgorithmicPricing(tenant.id);
          totalSuggestions += result.suggestionsCreated;
        }
        console.log(`[automation-worker] Algorithmic pricing complete for ${tenants.length} tenants: ${totalSuggestions} total suggestions`);
      }
      return;
    }

    const { type, reservationId, customerId, tenantId } = job.data;

    // Look up customer contact info
    const customer = await prisma.customer.findFirst({
      where: { id: customerId, tenantId },
      select: { id: true, firstName: true, lastName: true, email: true, phone: true },
    });

    if (!customer) {
      console.warn(`[automation-worker] Customer ${customerId} not found — skipping ${type}`);
      return;
    }

    const name = [customer.firstName, customer.lastName].filter(Boolean).join(" ");

    switch (type) {
      case "ABANDONED_CART_1":
        if (customer.email) {
          await sendEmail({
            to: customer.email,
            subject: "Still interested? Your reservation is waiting",
            html: `<p>Hi ${name},</p><p>Looks like you didn't finish your reservation. Your spot is still available — complete your booking before it's gone!</p>`,
          });
        }
        break;

      case "ABANDONED_CART_2":
        if (customer.email) {
          await sendEmail({
            to: customer.email,
            subject: "Your reservation is about to expire",
            html: `<p>Hi ${name},</p><p>Just a heads-up — the spot you were looking at is in high demand. Complete your reservation soon to lock in your rate.</p>`,
          });
        }
        break;

      case "ABANDONED_CART_3":
        if (customer.phone) {
          await sendSms(
            customer.phone,
            `Hi ${name}, your reservation is still waiting! Complete your booking before availability changes.`,
          );
        }
        break;

      case "POST_BOOKING":
        if (customer.email) {
          await sendEmail({
            to: customer.email,
            subject: "Booking confirmed! Here's what to expect",
            html: `<p>Hi ${name},</p><p>Your reservation has been confirmed. We'll send you arrival details closer to your date. Welcome aboard!</p>`,
          });
        }
        break;

      case "PRE_ARRIVAL":
        if (customer.email) {
          await sendEmail({
            to: customer.email,
            subject: "Arriving tomorrow — here's everything you need",
            html: `<p>Hi ${name},</p><p>We're looking forward to seeing you tomorrow! Please have your registration and insurance documents ready upon arrival.</p>`,
          });
        }
        break;

      case "POST_RENTAL":
        if (customer.email) {
          await sendEmail({
            to: customer.email,
            subject: "Thanks for visiting! How was your experience?",
            html: `<p>Hi ${name},</p><p>We hope you had a great time. We'd love to hear about your experience — your feedback helps us improve.</p>`,
          });
        }
        break;

      case "NPS_SURVEY":
        if (customer.email) {
          await sendEmail({
            to: customer.email,
            subject: "Quick question — would you recommend us?",
            html: `<p>Hi ${name},</p><p>On a scale of 0-10, how likely are you to recommend us to a friend? Reply to this email with your score and any comments.</p>`,
          });
        }
        break;

      default:
        console.warn(`[automation-worker] Unknown automation type: ${type}`);
    }

    console.log(`[automation-worker] Processed ${type} for customer ${customerId}`);
  },
  { connection: redisConnection, concurrency: 5 },
);

automationWorker.on("failed", (job, err) => {
  console.error(`[automation-worker] Job ${job?.id} failed:`, err.message);
});

// --------------------------------------------------------------------------
// QBO sync worker — token refresh + entity sync
// --------------------------------------------------------------------------

const qboSyncWorker = new Worker(
  "qbo-sync",
  async (job) => {
    // Two enqueue conventions are in use across the codebase:
    //   (a) { type: "invoice"|"customer"|"payment", tenantId, entityId }
    //   (b) job.name === "sync-invoice"|"sync-customer"|"sync-payment"
    //       with { tenantId, invoiceId|customerId|paymentId }
    // Normalise both to the (type, entityId) pair the switch below expects.
    const data = job.data as {
      type?: string;
      tenantId: string;
      entityId?: string;
      invoiceId?: string;
      customerId?: string;
      paymentId?: string;
    };
    const { tenantId } = data;
    let { type, entityId } = data;

    if (!type) {
      switch (job.name) {
        case "sync-invoice":
          type = "invoice";
          entityId = data.invoiceId ?? entityId;
          break;
        case "sync-customer":
          type = "customer";
          entityId = data.customerId ?? entityId;
          break;
        case "sync-payment":
          type = "payment";
          entityId = data.paymentId ?? entityId;
          break;
      }
    }

    if (!tenantId) {
      console.warn("[qbo-sync] Missing tenantId — skipping job");
      return;
    }

    // Proactively ensure the token is valid before any sync operation.
    // getValidAccessToken will refresh if expiry is within 5 minutes.
    let accessToken: string | null = null;
    try {
      const tokens = await getValidAccessToken(tenantId);
      accessToken = tokens.accessToken;
    } catch (err) {
      console.warn(`[qbo-sync] Token refresh failed for tenant ${tenantId}:`, (err as Error).message);
      return;
    }

    if (!accessToken) {
      console.warn(`[qbo-sync] No valid QBO token for tenant ${tenantId} — skipping ${type}`);
      return;
    }

    switch (type) {
      case "customer":
        if (!entityId) {
          console.warn("[qbo-sync] customer sync requires entityId");
          return;
        }
        try {
          await syncCustomer(entityId, tenantId);
          console.log(`[qbo-sync] Synced customer ${entityId} for tenant ${tenantId}`);
        } catch (err) {
          console.error(`[qbo-sync] Customer sync failed for ${entityId}:`, (err as Error).message);
          throw err; // rethrow so BullMQ can retry
        }
        break;

      case "invoice":
        if (!entityId) {
          console.warn("[qbo-sync] invoice sync requires entityId");
          return;
        }
        try {
          await syncInvoice(entityId, tenantId);
          console.log(`[qbo-sync] Synced invoice ${entityId} for tenant ${tenantId}`);
        } catch (err) {
          console.error(`[qbo-sync] Invoice sync failed for ${entityId}:`, (err as Error).message);
          throw err;
        }
        break;

      case "payment":
        if (!entityId) {
          console.warn("[qbo-sync] payment sync requires entityId");
          return;
        }
        try {
          await syncPayment(entityId, tenantId);
          console.log(`[qbo-sync] Synced payment ${entityId} for tenant ${tenantId}`);
        } catch (err) {
          console.error(`[qbo-sync] Payment sync failed for ${entityId}:`, (err as Error).message);
          throw err;
        }
        break;

      case "token-refresh":
        // Pure token refresh job — just calling getValidAccessToken above is sufficient.
        console.log(`[qbo-sync] Token refresh complete for tenant ${tenantId}`);
        break;

      default:
        console.warn(`[qbo-sync] Unknown job type: ${type}`);
    }
  },
  { connection: redisConnection, concurrency: 3 },
);

qboSyncWorker.on("failed", (job, err) => {
  console.error(`[qbo-sync] Job ${job?.id} failed:`, err.message);
});

// --------------------------------------------------------------------------
// Billing worker — recurring invoice generation + tenant lifecycle
// --------------------------------------------------------------------------

const billingWorker = new Worker(
  "billing",
  async (job) => {
    switch (job.name) {
      case "tenant-lifecycle": {
        const result = await runTenantLifecycleCheck();
        console.log(
          `[billing-worker] Tenant lifecycle check complete: ${result.transitioned} transitions, ${result.notified} notifications`,
        );
        break;
      }

      case "card-expiry-reminders": {
        const tenantId = job.data?.tenantId as string | undefined;
        if (tenantId) {
          const r = await runCardExpiryReminders(tenantId);
          console.log(
            `[billing-worker] card-expiry-reminders for tenant ${tenantId}: scanned=${r.scanned} sent=${r.remindersSent} alreadySent=${r.skippedAlreadySent} noCard=${r.skippedNoCard} expired=${r.skippedExpired} errors=${r.errors}`,
          );
        } else {
          const r = await runCardExpiryRemindersForAllTenants();
          console.log(
            `[billing-worker] card-expiry-reminders complete — ${r.totalSent} reminders across ${r.tenants} tenants (${r.totalErrors} errors)`,
          );
        }
        break;
      }

      case "generate-recurring-invoices": {
        // Run for a specific tenant or all active tenants
        const tenantId = job.data?.tenantId as string | undefined;
        if (tenantId) {
          const invoices = await generateRecurringInvoices(tenantId);
          console.log(`[billing-worker] Generated ${invoices.length} invoices for tenant ${tenantId}`);
        } else {
          const tenants = await prisma.tenant.findMany({
            where: { status: "ACTIVE" },
            select: { id: true },
          });
          let total = 0;
          for (const tenant of tenants) {
            try {
              const invoices = await generateRecurringInvoices(tenant.id);
              total += invoices.length;
            } catch (err) {
              console.error(`[billing-worker] Recurring billing failed for tenant ${tenant.id}:`, (err as Error).message);
            }
          }
          console.log(`[billing-worker] Recurring billing complete — ${total} invoices across ${tenants.length} tenants`);
        }
        break;
      }

      case "inventory-reconciliation": {
        // Run for a specific tenant or all locations with QB connections
        const tenantId = job.data?.tenantId as string | undefined;
        await runInventoryReconciliation(tenantId);
        console.log(
          `[billing-worker] Inventory reconciliation complete${tenantId ? ` for tenant ${tenantId}` : " for all tenants"}`,
        );
        break;
      }

      default:
        console.warn(`[billing-worker] Unknown job name: ${job.name}`);
    }
  },
  { connection: redisConnection, concurrency: 1 },
);

billingWorker.on("failed", (job, err) => {
  console.error(`[billing-worker] Job ${job?.id} failed:`, err.message);
});

// --------------------------------------------------------------------------
// Deferred revenue worker — monthly recognition
// --------------------------------------------------------------------------

const deferredRevenueWorker = new Worker(
  "deferred-revenue",
  async (job) => {
    if (job.name !== "recognize-deferred") {
      console.warn(`[deferred-revenue] Unknown job name: ${job.name}`);
      return;
    }

    const tenantId = job.data?.tenantId as string | undefined;
    if (tenantId) {
      const count = await recognizeDeferred(tenantId);
      console.log(`[deferred-revenue] Recognized ${count} entries for tenant ${tenantId}`);
    } else {
      const tenants = await prisma.tenant.findMany({
        where: { status: "ACTIVE" },
        select: { id: true },
      });
      let total = 0;
      for (const tenant of tenants) {
        try {
          const count = await recognizeDeferred(tenant.id);
          total += count;
        } catch (err) {
          console.error(`[deferred-revenue] Recognition failed for tenant ${tenant.id}:`, (err as Error).message);
        }
      }
      console.log(`[deferred-revenue] Recognition complete — ${total} entries across ${tenants.length} tenants`);
    }
  },
  { connection: redisConnection, concurrency: 1 },
);

deferredRevenueWorker.on("failed", (job, err) => {
  console.error(`[deferred-revenue] Job ${job?.id} failed:`, err.message);
});

// --------------------------------------------------------------------------
// Report-scheduler worker — sends scheduled reports via email
// --------------------------------------------------------------------------

const reportSchedulerWorker = new Worker(
  "report-scheduler",
  async (job) => {
    if (job.name !== "send-scheduled-report") {
      console.warn(`[report-scheduler] Unknown job name: ${job.name}`);
      return;
    }

    const { scheduleId, tenantId } = job.data as { scheduleId: string; tenantId: string };

    const schedule = await prisma.scheduledReport.findFirst({
      where: { id: scheduleId, tenantId },
    });

    if (!schedule) {
      console.warn(`[report-scheduler] Schedule ${scheduleId} not found — skipping`);
      return;
    }

    const now = new Date();

    // If the schedule is paused, the BullMQ scheduler should have been removed
    // in the PUT route — but guard here in case of race conditions.
    if (schedule.status !== "Active") {
      console.warn(`[report-scheduler] Schedule ${scheduleId} fired while Paused — skipping send`);
      return;
    }

    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true, subdomain: true } });
    const marinaName = tenant?.name ?? "Marina";
    const marinaDomain = tenant?.subdomain ?? undefined;

    const recipients = schedule.recipients.split(",").map((r) => r.trim()).filter(Boolean);
    const dateStr = now.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
    const format = schedule.format as ScheduleFormat;

    // Generate actual report data for CSV/JSON formats; include summary in email
    const reportResult = await generateReportData(schedule.reportId, tenantId, format);

    const attachmentNote = reportResult
      ? `<p style="color:#64748B;margin:0 0 8px 0;">Your <strong>${format}</strong> report is attached to this email.</p>`
      : `<p style="color:#64748B;margin:0 0 8px 0;">Log in to your Helm dashboard to download the full report in <strong>${format}</strong> format.</p>`;

    const summarySection = reportResult?.summaryHtml
      ? `<div style="margin-bottom:16px;">${reportResult.summaryHtml}</div>`
      : "";

    const subject = `Scheduled Report: ${schedule.reportName} — ${dateStr}`;
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: #0A2342; padding: 24px; border-radius: 8px 8px 0 0;">
          <h1 style="color: #00D4FF; margin: 0; font-size: 20px;">${marinaName}</h1>
          <p style="color: #ffffff; margin: 4px 0 0 0; font-size: 13px;">Automated Report Delivery</p>
        </div>
        <div style="background: #ffffff; padding: 24px; border: 1px solid #E2E8F0; border-top: none; border-radius: 0 0 8px 8px;">
          <h2 style="color: #0A2342; margin: 0 0 4px 0;">${schedule.reportName}</h2>
          <p style="color: #94A3B8; font-size: 12px; margin: 0 0 16px 0;">${schedule.frequency} delivery — ${dateStr}</p>
          ${summarySection}
          ${attachmentNote}
          <div style="background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px; padding: 16px; margin-top: 16px; margin-bottom: 16px;">
            <p style="color: #0A2342; font-weight: 600; margin: 0 0 4px 0;">View full interactive report</p>
            <p style="color: #64748B; font-size: 13px; margin: 0;">Log in to view charts, filter by date range, and export in any format.</p>
          </div>
          <p style="color: #94A3B8; font-size: 12px; margin: 0;">You're receiving this because you're on the recipient list for this scheduled report. Manage schedules from the Reports section of your Helm dashboard.</p>
        </div>
      </div>
    `;

    const emailOptions = {
      subject,
      html,
      tenantId,
      ...(reportResult ? { attachments: [{ filename: reportResult.filename, content: reportResult.content }] } : {}),
    };

    for (const recipient of recipients) {
      await sendEmail({ to: recipient, ...emailOptions }, marinaDomain);
    }

    console.log(`[report-scheduler] Sent ${schedule.reportName} (${format}) to ${recipients.length} recipient(s) for tenant ${tenantId}${reportResult ? " (with attachment)" : " (no attachment)"}`);

    // Update lastRun and compute nextRun for display (BullMQ handles actual re-scheduling).
    const nextRun = calcNextRun(schedule.frequency);
    await prisma.scheduledReport.update({
      where: { id: scheduleId },
      data: { lastRun: now, nextRun },
    });
  },
  { connection: redisConnection, concurrency: 3 },
);

reportSchedulerWorker.on("failed", (job, err) => {
  console.error(`[report-scheduler] Job ${job?.id} failed:`, err.message);
});

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
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 7, 0, 0, 0));
  return next;
}

// --------------------------------------------------------------------------
// Schedule repeatable cron jobs at startup
// --------------------------------------------------------------------------

async function scheduleRepeatableJobs() {
  try {
    // Daily at 05:00 UTC — generate recurring invoices for all active tenants
    await queues.billing.add(
      "generate-recurring-invoices",
      {},
      {
        repeat: { pattern: "0 5 * * *" },
        jobId: "cron-generate-recurring-invoices",
      },
    );

    // Daily at 06:00 UTC — recognize deferred revenue entries
    await queues["deferred-revenue"].add(
      "recognize-deferred",
      {},
      {
        repeat: { pattern: "0 6 * * *" },
        jobId: "cron-recognize-deferred",
      },
    );

    // Daily at 04:00 UTC — tenant lifecycle checks (trial expirations, etc.)
    await queues.billing.add(
      "tenant-lifecycle",
      {},
      {
        repeat: { pattern: "0 4 * * *" },
        jobId: "cron-tenant-lifecycle",
      },
    );

    // Daily at 13:00 UTC — proactive card-expiry reminder emails (30/7-day windows)
    await queues.billing.add(
      "card-expiry-reminders",
      {},
      {
        repeat: { pattern: "0 13 * * *" },
        jobId: "cron-card-expiry-reminders",
      },
    );

    // Weekly Sunday at midnight — algorithmic pricing suggestions
    await queues.automation.add(
      "algorithmic-pricing",
      {},
      {
        repeat: { pattern: "0 0 * * 0" },
        jobId: "cron-algorithmic-pricing",
      },
    );

    // Daily at 02:00 UTC — nightly inventory reconciliation (Helm QOH vs QB)
    await queues.billing.add(
      "inventory-reconciliation",
      {},
      {
        repeat: { pattern: "0 2 * * *" },
        jobId: "cron-inventory-reconciliation",
      },
    );

    console.log("[helm-workers] Repeatable cron jobs scheduled");
  } catch (err) {
    console.error("[helm-workers] Failed to schedule repeatable jobs:", (err as Error).message);
  }
}

void scheduleRepeatableJobs();

// --------------------------------------------------------------------------
// Graceful shutdown
// --------------------------------------------------------------------------

async function shutdown() {
  console.log("[helm-workers] Shutting down...");
  await Promise.all([
    emailWorker.close(),
    smsWorker.close(),
    automationWorker.close(),
    qboSyncWorker.close(),
    billingWorker.close(),
    deferredRevenueWorker.close(),
    reportSchedulerWorker.close(),
  ]);
  console.log("[helm-workers] All workers stopped");
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

// --------------------------------------------------------------------------
console.log("[helm-workers] All workers started");
