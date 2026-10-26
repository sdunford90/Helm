import { UnrecoverableError } from "bullmq";
import { prisma } from "../lib/prisma.js";
import {
  sendEmail,
  EmailSendError,
  escapeHtml,
  escapeTemplateParams,
  textToHtml,
  sanitizeSubject,
  invoiceEmailHtml,
  paymentReceiptHtml,
  achReturnHtml,
  expiryReminderHtml,
  announcementHtml,
  contractSignatureRequiredHtml,
  simpleMessageHtml,
} from "../lib/email.js";
import { sendSms, SmsSendError } from "../lib/sms.js";
import type { EmailJobData, SmsJobData } from "../lib/queue.js";

// ---------------------------------------------------------------------------
// Job processors
//
// Pure functions of the job payload, kept separate from the BullMQ Worker
// wiring in ./index.ts so they can be unit-tested without Redis.
//
// Error policy: provider errors are re-thrown so BullMQ retries with backoff.
// Errors that can never succeed (bad config, invalid recipient, unknown job
// type) are thrown as UnrecoverableError so the job fails immediately.
// ---------------------------------------------------------------------------

export function portalBaseUrl(): string {
  return (process.env.PORTAL_URL ?? "https://portal.gethelm.com").replace(/\/+$/, "");
}

export function formatCents(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    (Number.isFinite(cents) ? cents : 0) / 100,
  );
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Consent check against CommunicationPreference. Matches the defaults used by
 * routes/communication-prefs.ts: no row means opted in, except "marketing",
 * which defaults to opted out.
 */
export async function isOptedIn(
  tenantId: string,
  customerId: string,
  channel: "email" | "sms",
  category: "billing" | "inspections" | "marketing" | "announcements",
): Promise<boolean> {
  const pref = await prisma.communicationPreference.findFirst({
    where: { tenantId, customerId, channel, category },
    select: { optedIn: true },
  });
  if (pref) return pref.optedIn;
  return category !== "marketing";
}

async function tenantName(tenantId: string): Promise<string> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { name: true },
  });
  return tenant?.name ?? "your marina";
}

function toUnrecoverable(err: unknown): never {
  if ((err instanceof EmailSendError || err instanceof SmsSendError) && err.permanent) {
    throw new UnrecoverableError(err.message);
  }
  throw err;
}

// ---------------------------------------------------------------------------
// Email
// ---------------------------------------------------------------------------

export interface RenderedEmail {
  to: string;
  subject: string;
  html: string;
  marinaDomain?: string;
}

/** Outcome of an email job, for logging/tests. */
export type EmailJobOutcome =
  | { status: "sent"; messageId: string }
  | { status: "skipped"; reason: string };

type Skip = { skip: string };

/**
 * Build subject + HTML for a job. Every interpolated value is HTML-escaped
 * here (templates in lib/email.ts insert params verbatim). Returns
 * `{ skip }` when the message must not be sent (stale reminder, opted out).
 */
export async function renderEmailJob(data: EmailJobData): Promise<RenderedEmail | Skip> {
  const portal = portalBaseUrl();

  switch (data.type) {
    case "invoice": {
      const amount = formatCents(data.amountDueCents);
      const dueDate = formatDate(data.dueDate);
      const p = escapeTemplateParams(
        {
          customerName: data.customerName,
          invoiceNumber: data.invoiceNumber,
          amount,
          dueDate,
          portalUrl: `${portal}/invoices/${encodeURIComponent(data.invoiceId)}`,
        },
        ["portalUrl"],
      );
      return {
        to: data.to,
        marinaDomain: data.marinaDomain,
        subject: `Invoice ${data.invoiceNumber} — ${amount} due ${dueDate}`,
        html: invoiceEmailHtml(p),
      };
    }

    case "payment_receipt": {
      const amount = formatCents(data.amountCents);
      return {
        to: data.to,
        marinaDomain: data.marinaDomain,
        subject: `Payment received — ${amount}`,
        html: paymentReceiptHtml(
          escapeTemplateParams({
            customerName: data.customerName,
            amount,
            method: data.method,
            invoiceNumber: data.invoiceNumber,
          }),
        ),
      };
    }

    case "ach_return": {
      const fee = data.returnFeeCents > 0 ? ` A return fee of ${formatCents(data.returnFeeCents)} has been applied.` : "";
      return {
        to: data.to,
        marinaDomain: data.marinaDomain,
        subject: "ACH Payment Returned — Action Required",
        html: achReturnHtml(
          escapeTemplateParams({
            customerName: data.customerName,
            amount: formatCents(data.amountCents),
            reason: `${data.rCode} — ${data.reason}.${fee}`,
          }),
        ),
      };
    }

    case "insurance_expiry_reminder": {
      // Delayed job: resolve everything at send time.
      const record = await prisma.insuranceRecord.findFirst({
        where: { id: data.insuranceRecordId, tenantId: data.tenantId },
        select: {
          expiryDate: true,
          customer: { select: { id: true, firstName: true, lastName: true, email: true } },
        },
      });
      if (!record) return { skip: "insurance record no longer exists" };
      if (!record.customer.email) return { skip: "customer has no email" };
      if (
        !record.expiryDate ||
        record.expiryDate.toISOString().slice(0, 10) !== String(data.expiryDate).slice(0, 10)
      ) {
        return { skip: "insurance expiry date changed since the reminder was scheduled" };
      }
      if (!(await isOptedIn(data.tenantId, record.customer.id, "email", "inspections"))) {
        return { skip: "customer opted out of inspection/insurance email" };
      }
      const expiryDate = formatDate(record.expiryDate.toISOString());
      return {
        to: record.customer.email,
        subject: `Your insurance certificate expires on ${expiryDate}`,
        html: expiryReminderHtml(
          escapeTemplateParams(
            {
              customerName: `${record.customer.firstName} ${record.customer.lastName}`,
              documentType: "insurance certificate",
              expiryDate,
              portalUrl: `${portal}/insurance`,
            },
            ["portalUrl"],
          ),
        ),
      };
    }

    case "announcement": {
      if (!(await isOptedIn(data.tenantId, data.customerId, "email", "announcements"))) {
        return { skip: "customer opted out of announcement email" };
      }
      const marinaName = data.marinaName ?? (await tenantName(data.tenantId));
      return {
        to: data.to,
        marinaDomain: data.marinaDomain,
        subject: data.subject,
        html: announcementHtml({
          subject: escapeHtml(data.subject),
          marinaName: escapeHtml(marinaName),
          // Announcement bodies are plain text: escape, keep line breaks.
          body: textToHtml(data.body),
        }),
      };
    }

    case "renewal_esign": {
      const marinaName = await tenantName(data.tenantId);
      const cycle = data.billingCycle.toLowerCase().replace(/_/g, "-");
      return {
        to: data.to,
        marinaDomain: data.marinaDomain,
        subject: `Your slip ${data.slipNumber} renewal is ready for review`,
        html: contractSignatureRequiredHtml(
          escapeTemplateParams(
            {
              customerName: data.customerName,
              contractType: "slip renewal",
              slipNumber: data.slipNumber,
              startDate: formatDate(data.startDate),
              endDate: data.endDate ? formatDate(data.endDate) : "open-ended",
              monthlyRate: `${formatCents(data.rateCents)} (${cycle})`,
              signingUrl: `${portal}/contracts/${encodeURIComponent(data.contractId)}`,
              marinaName,
            },
            ["signingUrl"],
          ),
        ),
      };
    }

    case "tenant_lifecycle": {
      return {
        to: data.to,
        subject: data.subject,
        html: simpleMessageHtml({
          heading: escapeHtml(data.subject),
          greetingName: data.recipientName ? escapeHtml(data.recipientName) : undefined,
          bodyHtml: textToHtml(data.message),
        }),
      };
    }

    case "automation": {
      return {
        to: data.to,
        marinaDomain: data.marinaDomain,
        subject: data.subject,
        // Template markup is tenant-authored; merged values were escaped by
        // mergeTemplate() in services/email-automation.ts.
        html: data.templateHtml,
      };
    }

    default: {
      const unknown = data as { type?: unknown };
      throw new UnrecoverableError(`Unknown email type: ${String(unknown.type)}`);
    }
  }
}

async function markAnnouncementDelivery(
  tenantId: string,
  announcementId: string,
  customerId: string,
  channel: "EMAIL" | "SMS",
  status: "SENT" | "FAILED",
): Promise<void> {
  // AnnouncementDelivery has no tenantId column: scope via the parent.
  await prisma.announcementDelivery.updateMany({
    where: { announcementId, customerId, channel, announcement: { tenantId } },
    data: { status },
  });
}

/** Run after the final failed attempt of an email job (see workers/index.ts). */
export async function onEmailJobFinallyFailed(data: EmailJobData): Promise<void> {
  if (data.type === "announcement") {
    await markAnnouncementDelivery(data.tenantId, data.announcementId, data.customerId, "EMAIL", "FAILED");
  }
}

export async function processEmailJob(data: EmailJobData): Promise<EmailJobOutcome> {
  const rendered = await renderEmailJob(data);

  if ("skip" in rendered) {
    console.log(`[email-worker] Skipped ${data.type} (tenant ${data.tenantId}): ${rendered.skip}`);
    if (data.type === "announcement") {
      // No SUPPRESSED status exists yet; FAILED is better than PENDING forever.
      await markAnnouncementDelivery(data.tenantId, data.announcementId, data.customerId, "EMAIL", "FAILED");
    }
    return { status: "skipped", reason: rendered.skip };
  }

  let messageId: string;
  try {
    messageId = await sendEmail(
      { to: rendered.to, subject: sanitizeSubject(rendered.subject), html: rendered.html },
      rendered.marinaDomain,
    );
  } catch (err) {
    toUnrecoverable(err);
  }

  // Post-send bookkeeping: only after the provider accepted the message.
  if (data.type === "ach_return") {
    await prisma.achReturn.updateMany({
      where: { id: data.achReturnId, tenantId: data.tenantId },
      data: { customerNotifiedAt: new Date() },
    });
  } else if (data.type === "announcement") {
    await markAnnouncementDelivery(data.tenantId, data.announcementId, data.customerId, "EMAIL", "SENT");
  }

  console.log(`[email-worker] Sent ${data.type} email (tenant ${data.tenantId}, ${messageId})`);
  return { status: "sent", messageId };
}

// ---------------------------------------------------------------------------
// SMS
// ---------------------------------------------------------------------------

export type SmsJobOutcome = { status: "sent"; sid: string } | { status: "skipped"; reason: string };

export async function onSmsJobFinallyFailed(data: SmsJobData): Promise<void> {
  if (data.announcementId && data.customerId) {
    await markAnnouncementDelivery(data.tenantId, data.announcementId, data.customerId, "SMS", "FAILED");
  }
}

export async function processSmsJob(data: SmsJobData): Promise<SmsJobOutcome> {
  if (!data.to) {
    throw new UnrecoverableError("SMS job has no `to` phone number");
  }

  if (data.announcementId && data.customerId) {
    if (!(await isOptedIn(data.tenantId, data.customerId, "sms", "announcements"))) {
      await markAnnouncementDelivery(data.tenantId, data.announcementId, data.customerId, "SMS", "FAILED");
      return { status: "skipped", reason: "customer opted out of announcement SMS" };
    }
  }

  let sid: string;
  try {
    sid = await sendSms(data.to, data.body, data.fromNumber);
  } catch (err) {
    toUnrecoverable(err);
  }

  if (data.announcementId && data.customerId) {
    await markAnnouncementDelivery(data.tenantId, data.announcementId, data.customerId, "SMS", "SENT");
  }

  console.log(`[sms-worker] Sent SMS (tenant ${data.tenantId}, ${sid})`);
  return { status: "sent", sid };
}

// ---------------------------------------------------------------------------
// Rental automation drip (no producer exists yet; see audit 12 B.2 #12-18)
// ---------------------------------------------------------------------------

export interface RentalAutomationJobData {
  type: string;
  reservationId?: string;
  customerId: string;
  tenantId: string;
}

const DRIP_EMAILS: Record<string, { subject: string; text: string; marketing: boolean }> = {
  ABANDONED_CART_1: {
    subject: "Still interested? Your reservation is waiting",
    text: "Looks like you didn't finish your reservation. Your spot is still available — complete your booking before it's gone!",
    marketing: true,
  },
  ABANDONED_CART_2: {
    subject: "Your reservation is about to expire",
    text: "Just a heads-up — the spot you were looking at is in high demand. Complete your reservation soon to lock in your rate.",
    marketing: true,
  },
  POST_BOOKING_CONFIRM: {
    subject: "Booking confirmed! Here's what to expect",
    text: "Your reservation has been confirmed. We'll send you arrival details closer to your date. Welcome aboard!",
    marketing: false,
  },
  PRE_ARRIVAL: {
    subject: "Arriving tomorrow — here's everything you need",
    text: "We're looking forward to seeing you tomorrow! Please have your registration and insurance documents ready upon arrival.",
    marketing: false,
  },
  POST_RENTAL_THANKS: {
    subject: "Thanks for visiting! How was your experience?",
    text: "We hope you had a great time. We'd love to hear about your experience — your feedback helps us improve.",
    marketing: true,
  },
  NPS_SURVEY: {
    subject: "Quick question — would you recommend us?",
    text: "On a scale of 0-10, how likely are you to recommend us to a friend? Reply to this email with your score and any comments.",
    marketing: true,
  },
};

export async function processRentalAutomationJob(
  data: RentalAutomationJobData,
): Promise<{ status: "sent" | "skipped"; reason?: string }> {
  const { type, customerId, tenantId } = data;

  const customer = await prisma.customer.findFirst({
    where: { id: customerId, tenantId },
    select: { id: true, firstName: true, lastName: true, email: true, phone: true },
  });

  if (!customer) {
    return { status: "skipped", reason: `customer ${customerId} not found` };
  }

  const name = [customer.firstName, customer.lastName].filter(Boolean).join(" ");

  if (type === "ABANDONED_CART_3") {
    // Marketing SMS: requires explicit opt-in (TCPA).
    if (!customer.phone) return { status: "skipped", reason: "no phone" };
    if (!(await isOptedIn(tenantId, customer.id, "sms", "marketing"))) {
      return { status: "skipped", reason: "no marketing SMS consent" };
    }
    try {
      await sendSms(
        customer.phone,
        `Hi ${name}, your reservation is still waiting! Complete your booking before availability changes. Reply STOP to opt out.`,
      );
    } catch (err) {
      toUnrecoverable(err);
    }
    return { status: "sent" };
  }

  const tpl = DRIP_EMAILS[type];
  if (!tpl) {
    throw new UnrecoverableError(`Unknown automation type: ${type}`);
  }
  if (!customer.email) return { status: "skipped", reason: "no email" };
  if (tpl.marketing && !(await isOptedIn(tenantId, customer.id, "email", "marketing"))) {
    return { status: "skipped", reason: "no marketing email consent" };
  }

  try {
    await sendEmail({
      to: customer.email,
      subject: tpl.subject,
      html: simpleMessageHtml({
        heading: escapeHtml(tpl.subject),
        greetingName: escapeHtml(name),
        bodyHtml: escapeHtml(tpl.text),
      }),
    });
  } catch (err) {
    toUnrecoverable(err);
  }
  return { status: "sent" };
}
