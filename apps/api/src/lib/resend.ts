import { Resend } from "resend";

// ---------------------------------------------------------------------------
// Resend Email Client
//
// Provides email sending capabilities for invoices, announcements,
// rental confirmations, and system notifications.
// ---------------------------------------------------------------------------

if (!process.env.RESEND_API_KEY) {
  console.warn("[resend] RESEND_API_KEY not set — email sending will be disabled");
}

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

const DEFAULT_FROM = process.env.EMAIL_FROM ?? "Helm Marina <noreply@helm.marina>";

interface SendEmailOptions {
  to: string | string[];
  subject: string;
  html: string;
  from?: string;
  replyTo?: string;
  tags?: { name: string; value: string }[];
}

interface SendEmailResult {
  id: string;
  success: boolean;
}

/**
 * Send a single email via Resend.
 */
export async function sendEmail(options: SendEmailOptions): Promise<SendEmailResult> {
  if (!resend) {
    console.warn("[resend] Skipping email (no API key):", options.subject);
    return { id: "disabled", success: false };
  }

  const { data, error } = await resend.emails.send({
    from: options.from ?? DEFAULT_FROM,
    to: Array.isArray(options.to) ? options.to : [options.to],
    subject: options.subject,
    html: options.html,
    reply_to: options.replyTo,
    tags: options.tags,
  });

  if (error) {
    console.error("[resend] Send failed:", error);
    return { id: "", success: false };
  }

  return { id: data?.id ?? "", success: true };
}

/**
 * Send a batch of emails via Resend.
 */
export async function sendBatchEmails(
  emails: SendEmailOptions[],
): Promise<SendEmailResult[]> {
  if (!resend) {
    console.warn(`[resend] Skipping batch of ${emails.length} emails (no API key)`);
    return emails.map(() => ({ id: "disabled", success: false }));
  }

  const { data, error } = await resend.batch.send(
    emails.map((e) => ({
      from: e.from ?? DEFAULT_FROM,
      to: Array.isArray(e.to) ? e.to : [e.to],
      subject: e.subject,
      html: e.html,
      reply_to: e.replyTo,
      tags: e.tags,
    })),
  );

  if (error) {
    console.error("[resend] Batch send failed:", error);
    return emails.map(() => ({ id: "", success: false }));
  }

  return (data?.data ?? []).map((d) => ({
    id: d.id,
    success: true,
  }));
}

// ---------------------------------------------------------------------------
// Email Templates
// ---------------------------------------------------------------------------

export function invoiceEmailHtml(params: {
  customerName: string;
  invoiceNumber: string;
  amountDue: string;
  dueDate: string;
  paymentUrl?: string;
}): string {
  return `
    <div style="font-family: -apple-system, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: #0A2342; padding: 24px; border-radius: 8px 8px 0 0;">
        <h1 style="color: #FFFFFF; margin: 0; font-size: 24px;">Invoice ${params.invoiceNumber}</h1>
      </div>
      <div style="padding: 24px; border: 1px solid #E2E8F0; border-top: none; border-radius: 0 0 8px 8px;">
        <p>Hi ${params.customerName},</p>
        <p>A new invoice has been generated for your account.</p>
        <table style="width: 100%; margin: 16px 0;">
          <tr><td style="color: #64748B;">Amount Due</td><td style="text-align: right; font-weight: 600;">${params.amountDue}</td></tr>
          <tr><td style="color: #64748B;">Due Date</td><td style="text-align: right;">${params.dueDate}</td></tr>
        </table>
        ${params.paymentUrl ? `<a href="${params.paymentUrl}" style="display: inline-block; background: #0A2342; color: #FFF; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 600;">Pay Now</a>` : ""}
        <p style="color: #64748B; font-size: 13px; margin-top: 24px;">Thank you for your business.</p>
      </div>
    </div>
  `;
}

export function announcementEmailHtml(params: {
  marinaName: string;
  title: string;
  body: string;
  isEmergency: boolean;
}): string {
  const borderColor = params.isEmergency ? "#DC2626" : "#0A2342";
  return `
    <div style="font-family: -apple-system, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: ${borderColor}; padding: 24px; border-radius: 8px 8px 0 0;">
        <h1 style="color: #FFFFFF; margin: 0; font-size: 24px;">${params.marinaName}</h1>
        ${params.isEmergency ? '<span style="background: #FEE2E2; color: #DC2626; padding: 2px 8px; border-radius: 4px; font-size: 12px; font-weight: 600;">EMERGENCY</span>' : ""}
      </div>
      <div style="padding: 24px; border: 1px solid #E2E8F0; border-top: none; border-radius: 0 0 8px 8px;">
        <h2 style="margin: 0 0 16px 0;">${params.title}</h2>
        <div>${params.body}</div>
      </div>
    </div>
  `;
}

export function rentalConfirmationEmailHtml(params: {
  customerName: string;
  productName: string;
  startDate: string;
  endDate: string;
  totalAmount: string;
}): string {
  return `
    <div style="font-family: -apple-system, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: #0A2342; padding: 24px; border-radius: 8px 8px 0 0;">
        <h1 style="color: #FFFFFF; margin: 0; font-size: 24px;">Booking Confirmed</h1>
      </div>
      <div style="padding: 24px; border: 1px solid #E2E8F0; border-top: none; border-radius: 0 0 8px 8px;">
        <p>Hi ${params.customerName},</p>
        <p>Your rental booking has been confirmed!</p>
        <table style="width: 100%; margin: 16px 0;">
          <tr><td style="color: #64748B;">Rental</td><td style="text-align: right; font-weight: 600;">${params.productName}</td></tr>
          <tr><td style="color: #64748B;">Start</td><td style="text-align: right;">${params.startDate}</td></tr>
          <tr><td style="color: #64748B;">End</td><td style="text-align: right;">${params.endDate}</td></tr>
          <tr><td style="color: #64748B;">Total</td><td style="text-align: right; font-weight: 600;">${params.totalAmount}</td></tr>
        </table>
        <p style="color: #64748B; font-size: 13px; margin-top: 24px;">We look forward to seeing you!</p>
      </div>
    </div>
  `;
}

export function overstayAlertEmailHtml(params: {
  guestName: string;
  slipNumber: string;
  expectedCheckout: string;
}): string {
  return `
    <div style="font-family: -apple-system, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: #DC2626; padding: 24px; border-radius: 8px 8px 0 0;">
        <h1 style="color: #FFFFFF; margin: 0; font-size: 24px;">Overstay Alert</h1>
      </div>
      <div style="padding: 24px; border: 1px solid #E2E8F0; border-top: none; border-radius: 0 0 8px 8px;">
        <p>Transient guest <strong>${params.guestName}</strong> has overstayed their booking.</p>
        <table style="width: 100%; margin: 16px 0;">
          <tr><td style="color: #64748B;">Slip</td><td style="text-align: right;">${params.slipNumber}</td></tr>
          <tr><td style="color: #64748B;">Expected Checkout</td><td style="text-align: right;">${params.expectedCheckout}</td></tr>
        </table>
        <p>Please follow up with the guest immediately.</p>
      </div>
    </div>
  `;
}
