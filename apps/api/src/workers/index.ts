import { Worker } from "bullmq";
import { redisConnection } from "../lib/queue.js";
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
        const tenants = await prisma.tenant.findMany({ where: { active: true }, select: { id: true } });
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
      where: { id: customerId, tenant_id: tenantId },
      select: { id: true, first_name: true, last_name: true, email: true, phone: true },
    });

    if (!customer) {
      console.warn(`[automation-worker] Customer ${customerId} not found — skipping ${type}`);
      return;
    }

    const name = [customer.first_name, customer.last_name].filter(Boolean).join(" ");

    switch (type) {
      case "ABANDONED_CART_1":
        // 1 hour after abandonment — gentle reminder
        if (customer.email) {
          await sendEmail({
            to: customer.email,
            subject: "Still interested? Your reservation is waiting",
            html: `<p>Hi ${name},</p><p>Looks like you didn't finish your reservation. Your spot is still available — complete your booking before it's gone!</p>`,
          });
        }
        break;

      case "ABANDONED_CART_2":
        // 24 hours — follow-up with urgency
        if (customer.email) {
          await sendEmail({
            to: customer.email,
            subject: "Your reservation is about to expire",
            html: `<p>Hi ${name},</p><p>Just a heads-up — the spot you were looking at is in high demand. Complete your reservation soon to lock in your rate.</p>`,
          });
        }
        break;

      case "ABANDONED_CART_3":
        // 72 hours — final nudge via SMS if available
        if (customer.phone) {
          await sendSms(
            customer.phone,
            `Hi ${name}, your reservation is still waiting! Complete your booking before availability changes.`,
          );
        }
        break;

      case "POST_BOOKING":
        // Confirmation + what to expect
        if (customer.email) {
          await sendEmail({
            to: customer.email,
            subject: "Booking confirmed! Here's what to expect",
            html: `<p>Hi ${name},</p><p>Your reservation has been confirmed. We'll send you arrival details closer to your date. Welcome aboard!</p>`,
          });
        }
        break;

      case "PRE_ARRIVAL":
        // Day before arrival — logistics + checklist
        if (customer.email) {
          await sendEmail({
            to: customer.email,
            subject: "Arriving tomorrow — here's everything you need",
            html: `<p>Hi ${name},</p><p>We're looking forward to seeing you tomorrow! Please have your registration and insurance documents ready upon arrival.</p>`,
          });
        }
        break;

      case "POST_RENTAL":
        // After departure — thank you + review request
        if (customer.email) {
          await sendEmail({
            to: customer.email,
            subject: "Thanks for visiting! How was your experience?",
            html: `<p>Hi ${name},</p><p>We hope you had a great time. We'd love to hear about your experience — your feedback helps us improve.</p>`,
          });
        }
        break;

      case "NPS_SURVEY":
        // NPS score request
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
// QBO sync worker (stub)
// --------------------------------------------------------------------------

const qboSyncWorker = new Worker(
  "qbo-sync",
  async (job) => {
    console.log("[qbo-sync] Processing:", job.data.type, job.data);
    // TODO: Implement OAuth token refresh + entity sync
    // Supported types will include: invoice, payment, customer, credit_memo
  },
  { connection: redisConnection, concurrency: 3 },
);

qboSyncWorker.on("failed", (job, err) => {
  console.error(`[qbo-sync] Job ${job?.id} failed:`, err.message);
});

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
  ]);
  console.log("[helm-workers] All workers stopped");
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

// --------------------------------------------------------------------------
console.log("[helm-workers] All workers started");
