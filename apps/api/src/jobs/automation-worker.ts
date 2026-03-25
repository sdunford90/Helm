import { Worker, type Job } from "bullmq";
import { redisConnection } from "../lib/queue.js";
import { prisma } from "../lib/prisma.js";
import { queues } from "../lib/queue.js";

// ---------------------------------------------------------------------------
// Automation Worker
//
// BullMQ worker that processes the "automation" queue.
// Handles scheduled/automated tasks:
//   1. rental-reminders — Pre-arrival and post-stay emails
//   2. abandoned-cart — Follow up on incomplete reservations
//   3. compliance-check — Check for expiring insurance/registrations
//   4. past-due-followup — Send reminders for past-due invoices
//   5. nps-survey — Send NPS surveys after rental completion
// ---------------------------------------------------------------------------

interface RentalReminderPayload {
  type: "rental-reminders";
  tenantId: string;
}

interface AbandonedCartPayload {
  type: "abandoned-cart";
  tenantId: string;
}

interface ComplianceCheckPayload {
  type: "compliance-check";
  tenantId: string;
}

interface PastDueFollowupPayload {
  type: "past-due-followup";
  tenantId: string;
}

interface NpsSurveyPayload {
  type: "nps-survey";
  tenantId: string;
}

type AutomationJobPayload =
  | RentalReminderPayload
  | AbandonedCartPayload
  | ComplianceCheckPayload
  | PastDueFollowupPayload
  | NpsSurveyPayload;

async function processAutomationJob(job: Job<AutomationJobPayload>): Promise<unknown> {
  const { data } = job;

  switch (data.type) {
    case "rental-reminders": {
      return handleRentalReminders(data.tenantId);
    }

    case "abandoned-cart": {
      return handleAbandonedCart(data.tenantId);
    }

    case "compliance-check": {
      return handleComplianceCheck(data.tenantId);
    }

    case "past-due-followup": {
      return handlePastDueFollowup(data.tenantId);
    }

    case "nps-survey": {
      return handleNpsSurvey(data.tenantId);
    }

    default:
      throw new Error(`Unknown automation job type: ${(data as { type: string }).type}`);
  }
}

// ---------------------------------------------------------------------------
// Rental Reminders — 24h pre-arrival emails
// ---------------------------------------------------------------------------

async function handleRentalReminders(tenantId: string): Promise<{ sent: number }> {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);

  const dayAfterTomorrow = new Date(tomorrow);
  dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 1);

  const reservations = await prisma.reservation.findMany({
    where: {
      tenantId,
      status: "CONFIRMED",
      startDate: { gte: tomorrow, lt: dayAfterTomorrow },
    },
    include: {
      customer: true,
      rentalProduct: true,
    },
  });

  let sent = 0;
  for (const r of reservations) {
    if (r.customer?.email) {
      await queues.email.add("rental-reminder", {
        type: "rental-confirmation",
        tenantId,
        to: r.customer.email,
        customerName: `${r.customer.firstName} ${r.customer.lastName}`,
        productName: r.rentalProduct?.name ?? "Rental",
        startDate: r.startDate.toLocaleDateString(),
        endDate: r.endDate.toLocaleDateString(),
        totalAmount: `$${(r.totalCents / 100).toFixed(2)}`,
      });
      sent++;
    }
  }

  console.log(`[automation] Sent ${sent} rental reminders for tenant ${tenantId}`);
  return { sent };
}

// ---------------------------------------------------------------------------
// Abandoned Cart — Follow up on PENDING reservations older than 2 hours
// ---------------------------------------------------------------------------

async function handleAbandonedCart(tenantId: string): Promise<{ sent: number }> {
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);

  const pending = await prisma.reservation.findMany({
    where: {
      tenantId,
      status: "PENDING",
      createdAt: { lte: twoHoursAgo },
    },
    include: { customer: true, rentalProduct: true },
  });

  let sent = 0;
  for (const r of pending) {
    if (r.customer?.email) {
      await queues.email.add("abandoned-cart", {
        type: "generic",
        tenantId,
        to: r.customer.email,
        subject: "Complete Your Booking",
        html: `<p>Hi ${r.customer.firstName},</p><p>You have an incomplete booking for <strong>${r.rentalProduct?.name ?? "a rental"}</strong>. Complete your reservation before it expires!</p>`,
      });

      await prisma.rentalAutomationEvent.create({
        data: {
          tenantId,
          reservationId: r.id,
          eventType: "ABANDONED_CART",
          channel: "EMAIL",
          sentAt: new Date(),
        },
      });

      sent++;
    }
  }

  console.log(`[automation] Sent ${sent} abandoned cart emails for tenant ${tenantId}`);
  return { sent };
}

// ---------------------------------------------------------------------------
// Compliance Check — Insurance/registration expiring within 30 days
// ---------------------------------------------------------------------------

async function handleComplianceCheck(tenantId: string): Promise<{ alerts: number }> {
  const thirtyDaysFromNow = new Date();
  thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

  const expiringInsurance = await prisma.insuranceRecord.findMany({
    where: {
      tenantId,
      status: "APPROVED",
      expiresAt: { lte: thirtyDaysFromNow, gte: new Date() },
    },
    include: { boat: { include: { customer: true } } },
  });

  let alerts = 0;
  for (const ins of expiringInsurance) {
    const customer = ins.boat?.customer;
    if (customer?.email) {
      await queues.email.add("compliance-expiry", {
        type: "generic",
        tenantId,
        to: customer.email,
        subject: "Insurance Expiring Soon",
        html: `<p>Hi ${customer.firstName},</p><p>Your insurance policy for <strong>${ins.boat?.name ?? "your vessel"}</strong> expires on ${ins.expiresAt?.toLocaleDateString()}. Please submit updated proof of insurance.</p>`,
      });
      alerts++;
    }
  }

  console.log(`[automation] Sent ${alerts} compliance alerts for tenant ${tenantId}`);
  return { alerts };
}

// ---------------------------------------------------------------------------
// Past Due Followup — Reminders for past-due invoices
// ---------------------------------------------------------------------------

async function handlePastDueFollowup(tenantId: string): Promise<{ sent: number }> {
  const pastDueInvoices = await prisma.invoice.findMany({
    where: {
      tenantId,
      status: "PAST_DUE",
    },
    include: { customer: true },
  });

  let sent = 0;
  for (const inv of pastDueInvoices) {
    if (inv.customer?.email) {
      await queues.email.add("past-due-reminder", {
        type: "invoice",
        tenantId,
        to: inv.customer.email,
        customerName: `${inv.customer.firstName} ${inv.customer.lastName}`,
        invoiceNumber: inv.invoiceNumber,
        amountDue: `$${(inv.totalCents / 100).toFixed(2)}`,
        dueDate: inv.dueDate?.toLocaleDateString() ?? "Overdue",
      });
      sent++;
    }

    // Also send SMS if customer has phone
    if (inv.customer?.phone) {
      await queues.sms.add("past-due-sms", {
        type: "invoice-reminder",
        tenantId,
        to: inv.customer.phone,
        customerName: inv.customer.firstName,
        invoiceNumber: inv.invoiceNumber,
        amountDue: `$${(inv.totalCents / 100).toFixed(2)}`,
        dueDate: inv.dueDate?.toLocaleDateString() ?? "Overdue",
      });
    }
  }

  console.log(`[automation] Sent ${sent} past-due reminders for tenant ${tenantId}`);
  return { sent };
}

// ---------------------------------------------------------------------------
// NPS Survey — Send after rental checkout (24h delay)
// ---------------------------------------------------------------------------

async function handleNpsSurvey(tenantId: string): Promise<{ sent: number }> {
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const dayBefore = new Date(Date.now() - 48 * 60 * 60 * 1000);

  const recentCheckouts = await prisma.reservation.findMany({
    where: {
      tenantId,
      status: "CHECKED_OUT",
      checkedOutAt: { gte: dayBefore, lte: yesterday },
    },
    include: { customer: true, rentalProduct: true },
  });

  let sent = 0;
  for (const r of recentCheckouts) {
    // Check if NPS survey already sent
    const existing = await prisma.npsSurvey.findFirst({
      where: { tenantId, reservationId: r.id },
    });
    if (existing) continue;

    if (r.customer?.email) {
      // Create the NPS survey record
      await prisma.npsSurvey.create({
        data: {
          tenantId,
          reservationId: r.id,
          customerId: r.customerId!,
          sentAt: new Date(),
        },
      });

      await queues.email.add("nps-survey", {
        type: "generic",
        tenantId,
        to: r.customer.email,
        subject: "How was your experience?",
        html: `<p>Hi ${r.customer.firstName},</p><p>Thanks for renting <strong>${r.rentalProduct?.name ?? "with us"}</strong>! We'd love your feedback. How likely are you to recommend us?</p>`,
      });

      sent++;
    }
  }

  console.log(`[automation] Sent ${sent} NPS surveys for tenant ${tenantId}`);
  return { sent };
}

const automationWorker = new Worker("automation", processAutomationJob, {
  connection: redisConnection,
  concurrency: 2,
});

automationWorker.on("completed", (job) => {
  console.log(`[automation] Job ${job.id} completed`);
});

automationWorker.on("failed", (job, err) => {
  console.error(`[automation] Job ${job?.id} failed:`, err.message);
});

export default automationWorker;
