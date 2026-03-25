import { Worker, type Job } from "bullmq";
import { redisConnection } from "../lib/queue.js";
import { prisma } from "../lib/prisma.js";
import {
  sendEmail,
  invoiceEmailHtml,
  announcementEmailHtml,
  rentalConfirmationEmailHtml,
  overstayAlertEmailHtml,
} from "../lib/resend.js";

// ---------------------------------------------------------------------------
// Email Worker
//
// BullMQ worker that processes the "email" queue.
// Handles all outbound email types: invoices, announcements, rental
// confirmations, overstay alerts, and generic notifications.
// ---------------------------------------------------------------------------

interface InvoiceEmailPayload {
  type: "invoice";
  tenantId: string;
  to: string;
  customerName: string;
  invoiceNumber: string;
  amountDue: string;
  dueDate: string;
  paymentUrl?: string;
}

interface AnnouncementEmailPayload {
  type: "announcement";
  tenantId: string;
  announcementId: string;
  to: string;
  customerId: string;
  marinaName: string;
  title: string;
  body: string;
  isEmergency: boolean;
}

interface RentalConfirmationPayload {
  type: "rental-confirmation";
  tenantId: string;
  to: string;
  customerName: string;
  productName: string;
  startDate: string;
  endDate: string;
  totalAmount: string;
}

interface OverstayAlertPayload {
  type: "overstay-alert";
  tenantId: string;
  to: string | string[];
  guestName: string;
  slipNumber: string;
  expectedCheckout: string;
}

interface GenericEmailPayload {
  type: "generic";
  tenantId: string;
  to: string;
  subject: string;
  html: string;
}

type EmailJobPayload =
  | InvoiceEmailPayload
  | AnnouncementEmailPayload
  | RentalConfirmationPayload
  | OverstayAlertPayload
  | GenericEmailPayload;

async function processEmailJob(job: Job<EmailJobPayload>): Promise<unknown> {
  const { data } = job;

  switch (data.type) {
    case "invoice": {
      const html = invoiceEmailHtml({
        customerName: data.customerName,
        invoiceNumber: data.invoiceNumber,
        amountDue: data.amountDue,
        dueDate: data.dueDate,
        paymentUrl: data.paymentUrl,
      });
      return sendEmail({
        to: data.to,
        subject: `Invoice ${data.invoiceNumber} — ${data.amountDue} due ${data.dueDate}`,
        html,
      });
    }

    case "announcement": {
      const html = announcementEmailHtml({
        marinaName: data.marinaName,
        title: data.title,
        body: data.body,
        isEmergency: data.isEmergency,
      });
      const result = await sendEmail({
        to: data.to,
        subject: data.isEmergency ? `🚨 ${data.title}` : data.title,
        html,
      });

      // Update delivery record
      await prisma.announcementDelivery.updateMany({
        where: {
          announcementId: data.announcementId,
          customerId: data.customerId,
          channel: "EMAIL",
        },
        data: {
          status: result.success ? "SENT" : "FAILED",
          sentAt: result.success ? new Date() : undefined,
        },
      });

      return result;
    }

    case "rental-confirmation": {
      const html = rentalConfirmationEmailHtml({
        customerName: data.customerName,
        productName: data.productName,
        startDate: data.startDate,
        endDate: data.endDate,
        totalAmount: data.totalAmount,
      });
      return sendEmail({
        to: data.to,
        subject: `Booking Confirmed — ${data.productName}`,
        html,
      });
    }

    case "overstay-alert": {
      const html = overstayAlertEmailHtml({
        guestName: data.guestName,
        slipNumber: data.slipNumber,
        expectedCheckout: data.expectedCheckout,
      });
      return sendEmail({
        to: data.to,
        subject: `Overstay Alert — ${data.guestName} at Slip ${data.slipNumber}`,
        html,
      });
    }

    case "generic": {
      return sendEmail({
        to: data.to,
        subject: data.subject,
        html: data.html,
      });
    }

    default:
      throw new Error(`Unknown email job type: ${(data as { type: string }).type}`);
  }
}

const emailWorker = new Worker("email", processEmailJob, {
  connection: redisConnection,
  concurrency: 5,
});

emailWorker.on("completed", (job) => {
  console.log(`[email-worker] Job ${job.id} completed`);
});

emailWorker.on("failed", (job, err) => {
  console.error(`[email-worker] Job ${job?.id} failed:`, err.message);
});

export default emailWorker;
