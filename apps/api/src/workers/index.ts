import { Worker } from "bullmq";
import { redisConnection, queues } from "../lib/queue.js";
import {
  sendEmail,
  invoiceEmailHtml,
  paymentReceiptHtml,
  achReturnHtml,
  expiryReminderHtml,
  announcementHtml,
} from "../lib/email.js";
import { sendSms } from "../lib/sms.js";
import { prisma } from "../lib/prisma.js";
import { runAlgorithmicPricing } from "../jobs/algorithmic-pricing.js";
import { runTenantLifecycleCheck } from "../jobs/tenant-lifecycle.js";
import { generateRecurringInvoices } from "../services/billing.js";
import { recognizeDeferred } from "../services/deferred-revenue.js";
import {
  syncCustomer,
  syncInvoice,
  syncPayment,
  getValidAccessToken,
} from "../services/qbo-sync.js";

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
      default:
        console.error(`[email-worker] Unknown email type: ${type}`);
        return;
    }

    const messageId = await sendEmail({ to, subject, html }, marinaDomain);
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
    const { type, tenantId, entityId } = job.data as {
      type: string;
      tenantId: string;
      entityId?: string;
    };

    if (!tenantId) {
      console.warn("[qbo-sync] Missing tenantId — skipping job");
      return;
    }

    // Proactively ensure the token is valid before any sync operation.
    // getValidAccessToken will refresh if expiry is within 5 minutes.
    let accessToken: string | null = null;
    try {
      accessToken = await getValidAccessToken(tenantId);
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

    // Weekly Sunday at midnight — algorithmic pricing suggestions
    await queues.automation.add(
      "algorithmic-pricing",
      {},
      {
        repeat: { pattern: "0 0 * * 0" },
        jobId: "cron-algorithmic-pricing",
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
  ]);
  console.log("[helm-workers] All workers stopped");
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

// --------------------------------------------------------------------------
console.log("[helm-workers] All workers started");
