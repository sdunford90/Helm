import { Queue, type JobsOptions } from "bullmq";
import IORedis from "ioredis";

// --------------------------------------------------------------------------
// Redis connection
// --------------------------------------------------------------------------

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

export const redisConnection = new IORedis(REDIS_URL, {
  maxRetriesPerRequest: null, // Required by BullMQ
});

// --------------------------------------------------------------------------
// Queue definitions
// --------------------------------------------------------------------------

const QUEUE_NAMES = [
  "billing",
  "deferred-revenue",
  "qbo-sync",
  "email",
  "sms",
  "renewals",
  "automation",
] as const;

export type QueueName = (typeof QUEUE_NAMES)[number];

function createQueue(name: string): Queue {
  return new Queue(name, { connection: redisConnection });
}

export const queues: Record<QueueName, Queue> = {
  billing: createQueue("billing"),
  "deferred-revenue": createQueue("deferred-revenue"),
  "qbo-sync": createQueue("qbo-sync"),
  email: createQueue("email"),
  sms: createQueue("sms"),
  renewals: createQueue("renewals"),
  automation: createQueue("automation"),
};

// --------------------------------------------------------------------------
// Job payload contracts
//
// These types are the single contract between job producers (routes,
// services, jobs) and the workers in src/workers/index.ts. Every producer
// MUST go through enqueueEmail / enqueueSms so the compiler checks that the
// `type` discriminator and fields match what the worker handles.
//
// Conventions:
//   * money is integer cents; the worker formats it for display
//   * dates are ISO-8601 strings (job data is JSON-serialised by BullMQ)
//   * values are raw/unescaped; the email worker HTML-escapes them
// --------------------------------------------------------------------------

interface EmailJobBase {
  tenantId: string;
  /** Recipient email address. */
  to: string;
  /** Optional sending domain for the marina (from: billing@<domain>). */
  marinaDomain?: string;
}

export interface InvoiceEmailJob extends EmailJobBase {
  type: "invoice";
  invoiceId: string;
  invoiceNumber: string;
  customerName: string;
  /** Amount shown as due: the outstanding balance in cents. */
  amountDueCents: number;
  dueDate: string;
}

export interface PaymentReceiptEmailJob extends EmailJobBase {
  type: "payment_receipt";
  paymentId: string;
  invoiceNumber: string;
  customerName: string;
  amountCents: number;
  method: string;
}

export interface AchReturnEmailJob extends EmailJobBase {
  type: "ach_return";
  /** AchReturn row; the worker sets customerNotifiedAt only after a successful send. */
  achReturnId: string;
  customerName: string;
  amountCents: number;
  returnFeeCents: number;
  rCode: string;
  reason: string;
}

/**
 * Insurance expiry reminders are delayed jobs (weeks), so the recipient and
 * dates are resolved at send time from the InsuranceRecord. A reminder whose
 * record is gone, or whose expiry date changed, is dropped.
 */
export interface InsuranceExpiryReminderEmailJob {
  type: "insurance_expiry_reminder";
  tenantId: string;
  customerId: string;
  insuranceRecordId: string;
  /** Expiry date at the time the reminder was scheduled (ISO). */
  expiryDate: string;
  reminderType: "30-day" | "7-day";
}

export interface AnnouncementEmailJob extends EmailJobBase {
  type: "announcement";
  announcementId: string;
  customerId: string;
  subject: string;
  /** Plain text. Escaped by the worker; newlines become <br>. */
  body: string;
  marinaName?: string;
}

export interface RenewalEsignEmailJob extends EmailJobBase {
  type: "renewal_esign";
  batchId: string;
  customerId: string;
  /** Successor contract created by the renewal. */
  contractId: string;
  customerName: string;
  slipNumber: string;
  startDate: string;
  endDate: string | null;
  rateCents: number;
  billingCycle: string;
}

export interface TenantLifecycleEmailJob extends EmailJobBase {
  type: "tenant_lifecycle";
  tenantName: string;
  recipientName: string;
  subject: string;
  message: string;
  graceDayNumber: number;
}

/** Tenant-authored automation email (services/email-automation.ts). */
export interface AutomationEmailJob extends EmailJobBase {
  type: "automation";
  subject: string;
  /** Plain-text body after merge-field substitution. Escaped by the worker. */
  body: string;
  ruleId?: string;
  customerId?: string;
}

export type EmailJobData =
  | InvoiceEmailJob
  | PaymentReceiptEmailJob
  | AchReturnEmailJob
  | InsuranceExpiryReminderEmailJob
  | AnnouncementEmailJob
  | RenewalEsignEmailJob
  | TenantLifecycleEmailJob
  | AutomationEmailJob;

export type EmailJobType = EmailJobData["type"];

export interface SmsJobData {
  tenantId: string;
  /** Recipient phone number (E.164 preferred). */
  to: string;
  body: string;
  /** Marina 10DLC number; falls back to the platform default. */
  fromNumber?: string;
  /** Set for announcement SMS so the worker can update the delivery row. */
  announcementId?: string;
  customerId?: string;
}

/** Default retry policy for outbound notifications. */
export const NOTIFICATION_JOB_OPTS: JobsOptions = {
  attempts: 5,
  backoff: { type: "exponential", delay: 30_000 },
  removeOnComplete: 1000,
  removeOnFail: 5000,
};

export async function enqueueEmail(
  name: string,
  data: EmailJobData,
  opts: JobsOptions = {},
) {
  return queues.email.add(name, data, { ...NOTIFICATION_JOB_OPTS, ...opts });
}

export async function enqueueSms(
  name: string,
  data: SmsJobData,
  opts: JobsOptions = {},
) {
  return queues.sms.add(name, data, { ...NOTIFICATION_JOB_OPTS, ...opts });
}

/**
 * Return the full registry of queues (useful for admin introspection).
 */
export function getQueueRegistry(): Record<QueueName, Queue> {
  return queues;
}

/**
 * Gracefully drain all queues — waits for active jobs to finish then closes.
 * Call during deployment / shutdown.
 */
export async function drainAll(): Promise<void> {
  await Promise.all(
    Object.values(queues).map(async (q) => {
      await q.drain();
      await q.close();
    }),
  );
  await redisConnection.quit();
}
