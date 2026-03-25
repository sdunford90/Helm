import { Worker, type Job } from "bullmq";
import { redisConnection } from "../lib/queue.js";
import { prisma } from "../lib/prisma.js";
import {
  sendSms,
  announcementSmsBody,
  overstayAlertSmsBody,
  waitlistNotificationSmsBody,
  invoiceReminderSmsBody,
} from "../lib/twilio.js";

// ---------------------------------------------------------------------------
// SMS Worker
//
// BullMQ worker that processes the "sms" queue.
// Handles outbound SMS: announcements, overstay alerts, waitlist
// notifications, and invoice reminders.
// ---------------------------------------------------------------------------

interface AnnouncementSmsPayload {
  type: "announcement";
  tenantId: string;
  announcementId: string;
  customerId: string;
  to: string;
  marinaName: string;
  title: string;
  isEmergency: boolean;
}

interface OverstayAlertSmsPayload {
  type: "overstay-alert";
  tenantId: string;
  to: string;
  guestName: string;
  slipNumber: string;
}

interface WaitlistNotificationSmsPayload {
  type: "waitlist-notification";
  tenantId: string;
  to: string;
  customerName: string;
  slipType: string;
  expiresAt: string;
}

interface InvoiceReminderSmsPayload {
  type: "invoice-reminder";
  tenantId: string;
  to: string;
  customerName: string;
  invoiceNumber: string;
  amountDue: string;
  dueDate: string;
}

type SmsJobPayload =
  | AnnouncementSmsPayload
  | OverstayAlertSmsPayload
  | WaitlistNotificationSmsPayload
  | InvoiceReminderSmsPayload;

async function processSmsJob(job: Job<SmsJobPayload>): Promise<unknown> {
  const { data } = job;

  switch (data.type) {
    case "announcement": {
      const body = announcementSmsBody({
        marinaName: data.marinaName,
        title: data.title,
        isEmergency: data.isEmergency,
      });
      const result = await sendSms(data.to, body);

      // Update delivery record
      await prisma.announcementDelivery.updateMany({
        where: {
          announcementId: data.announcementId,
          customerId: data.customerId,
          channel: "SMS",
        },
        data: {
          status: result.success ? "SENT" : "FAILED",
          sentAt: result.success ? new Date() : undefined,
        },
      });

      return result;
    }

    case "overstay-alert": {
      const body = overstayAlertSmsBody({
        guestName: data.guestName,
        slipNumber: data.slipNumber,
      });
      return sendSms(data.to, body);
    }

    case "waitlist-notification": {
      const body = waitlistNotificationSmsBody({
        customerName: data.customerName,
        slipType: data.slipType,
        expiresAt: data.expiresAt,
      });
      return sendSms(data.to, body);
    }

    case "invoice-reminder": {
      const body = invoiceReminderSmsBody({
        customerName: data.customerName,
        invoiceNumber: data.invoiceNumber,
        amountDue: data.amountDue,
        dueDate: data.dueDate,
      });
      return sendSms(data.to, body);
    }

    default:
      throw new Error(`Unknown SMS job type: ${(data as { type: string }).type}`);
  }
}

const smsWorker = new Worker("sms", processSmsJob, {
  connection: redisConnection,
  concurrency: 3,
});

smsWorker.on("completed", (job) => {
  console.log(`[sms-worker] Job ${job.id} completed`);
});

smsWorker.on("failed", (job, err) => {
  console.error(`[sms-worker] Job ${job?.id} failed:`, err.message);
});

export default smsWorker;
