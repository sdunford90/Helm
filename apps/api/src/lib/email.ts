import { Resend } from "resend";

// --------------------------------------------------------------------------
// Resend client (lazy: the Resend constructor throws without an API key, and
// this module is imported by the worker and by tests)
// --------------------------------------------------------------------------

let resendClient: Resend | null = null;

function getResend(): Resend {
  if (!resendClient) {
    const key = process.env.RESEND_API_KEY;
    if (!key) {
      throw new EmailSendError("RESEND_API_KEY is not configured", { permanent: true });
    }
    resendClient = new Resend(key);
  }
  return resendClient;
}

/** Test hook: inject a fake Resend client (or reset with null). */
export function __setResendClientForTests(client: unknown): void {
  resendClient = client as Resend | null;
}

/**
 * Thrown when an email cannot be sent. `permanent` errors (bad configuration,
 * invalid recipient) should not be retried; everything else should be, so
 * BullMQ's retry/backoff applies.
 */
export class EmailSendError extends Error {
  readonly permanent: boolean;
  readonly cause?: unknown;
  constructor(message: string, opts: { permanent?: boolean; cause?: unknown } = {}) {
    super(message);
    this.name = "EmailSendError";
    this.permanent = opts.permanent ?? false;
    this.cause = opts.cause;
  }
}

// --------------------------------------------------------------------------
// Escaping helpers
//
// The templates below interpolate their params verbatim. Callers that pass
// user- or tenant-controlled values (names, invoice numbers, announcement
// bodies, ...) MUST escape them first; the email worker does this with
// escapeTemplateParams().
// --------------------------------------------------------------------------

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
  "`": "&#96;",
};

export function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).replace(/[&<>"'`]/g, (ch) => HTML_ESCAPES[ch]);
}

/** Escape plain text and keep its line breaks. */
export function textToHtml(value: unknown): string {
  return escapeHtml(value).replace(/\r?\n/g, "<br>");
}

/** Only allow http(s) links in hrefs; anything else becomes "#". Escaped. */
export function safeUrl(value: unknown): string {
  if (typeof value !== "string") return "#";
  try {
    const u = new URL(value);
    if (u.protocol !== "https:" && u.protocol !== "http:") return "#";
    return escapeHtml(u.toString());
  } catch {
    return "#";
  }
}

/**
 * Return a copy of `params` with every string value HTML-escaped. Keys listed
 * in `urlKeys` are validated as http(s) URLs instead.
 */
export function escapeTemplateParams<T extends object>(
  params: T,
  urlKeys: readonly (keyof T & string)[] = [],
): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params)) {
    if ((urlKeys as readonly string[]).includes(k)) out[k] = safeUrl(v);
    else if (typeof v === "string") out[k] = escapeHtml(v);
    else out[k] = v;
  }
  return out as T;
}

/** Subjects are plain-text headers: strip CR/LF (header injection) and trim. */
export function sanitizeSubject(value: unknown): string {
  return String(value ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, 250);
}

// --------------------------------------------------------------------------
// Core send helper
// --------------------------------------------------------------------------

interface EmailOptions {
  to: string | string[];
  from?: string;
  subject: string;
  html: string;
  replyTo?: string;
  tags?: Array<{ name: string; value: string }>;
}

/**
 * Send an email via Resend and return the Resend message id.
 *
 * Throws EmailSendError on any failure (missing config, API error, network
 * error) so that a BullMQ job fails and is retried, instead of the error
 * being logged and swallowed.
 */
export async function sendEmail(
  options: EmailOptions,
  marinaDomain?: string,
): Promise<string> {
  const from =
    options.from ||
    (marinaDomain ? `billing@${marinaDomain}` : "noreply@gethelm.com");

  const client = getResend();

  let result: Awaited<ReturnType<Resend["emails"]["send"]>>;
  try {
    result = await client.emails.send({
      from,
      to: Array.isArray(options.to) ? options.to : [options.to],
      subject: sanitizeSubject(options.subject),
      html: options.html,
      ...(options.replyTo ? { replyTo: options.replyTo } : {}),
      ...(options.tags ? { tags: options.tags } : {}),
    });
  } catch (err) {
    throw new EmailSendError(
      `Resend request failed: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }

  const { data, error } = result;
  if (error) {
    // Validation-type errors will never succeed on retry.
    const name = String((error as { name?: string }).name ?? "");
    const permanent = /validation|missing_required|invalid_|restricted/i.test(name);
    throw new EmailSendError(`Resend API error (${name}): ${error.message}`, {
      permanent,
      cause: error,
    });
  }
  if (!data?.id) {
    throw new EmailSendError("Resend returned no message id");
  }
  return data.id;
}

// --------------------------------------------------------------------------
// Shared styles
// --------------------------------------------------------------------------

const baseStyle = `
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  color: #1a1a1a;
  line-height: 1.6;
`;

function layout(body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f5f7;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:32px 0;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0"
        style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
        <tr><td style="padding:32px 40px;${baseStyle}">
          ${body}
        </td></tr>
      </table>
      <p style="font-size:12px;color:#999;margin-top:16px;">Powered by Helm</p>
    </td></tr>
  </table>
</body>
</html>`;
}

function btn(href: string, label: string): string {
  return `<a href="${href}" style="display:inline-block;padding:12px 28px;background:#0066ff;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:600;margin:16px 0;">${label}</a>`;
}

// --------------------------------------------------------------------------
// Email templates
// --------------------------------------------------------------------------

export function invoiceEmailHtml(params: {
  customerName: string;
  invoiceNumber: string;
  amount: string;
  dueDate: string;
  portalUrl: string;
}): string {
  return layout(`
    <h2 style="margin:0 0 8px;">Invoice ${params.invoiceNumber}</h2>
    <p>Hi ${params.customerName},</p>
    <p>A new invoice has been generated for your account.</p>
    <table role="presentation" width="100%" style="margin:16px 0;border-collapse:collapse;">
      <tr>
        <td style="padding:8px 0;border-bottom:1px solid #eee;font-weight:600;">Amount Due</td>
        <td style="padding:8px 0;border-bottom:1px solid #eee;text-align:right;">${params.amount}</td>
      </tr>
      <tr>
        <td style="padding:8px 0;border-bottom:1px solid #eee;font-weight:600;">Due Date</td>
        <td style="padding:8px 0;border-bottom:1px solid #eee;text-align:right;">${params.dueDate}</td>
      </tr>
    </table>
    <p style="text-align:center;">${btn(params.portalUrl, "View &amp; Pay Invoice")}</p>
    <p style="font-size:13px;color:#666;">If you have questions about this invoice, please reply to this email or contact your marina office.</p>
  `);
}

export function paymentReceiptHtml(params: {
  customerName: string;
  amount: string;
  method: string;
  invoiceNumber: string;
}): string {
  return layout(`
    <h2 style="margin:0 0 8px;">Payment Received</h2>
    <p>Hi ${params.customerName},</p>
    <p>We've received your payment. Here are the details:</p>
    <table role="presentation" width="100%" style="margin:16px 0;border-collapse:collapse;">
      <tr>
        <td style="padding:8px 0;border-bottom:1px solid #eee;font-weight:600;">Invoice</td>
        <td style="padding:8px 0;border-bottom:1px solid #eee;text-align:right;">${params.invoiceNumber}</td>
      </tr>
      <tr>
        <td style="padding:8px 0;border-bottom:1px solid #eee;font-weight:600;">Amount</td>
        <td style="padding:8px 0;border-bottom:1px solid #eee;text-align:right;">${params.amount}</td>
      </tr>
      <tr>
        <td style="padding:8px 0;border-bottom:1px solid #eee;font-weight:600;">Method</td>
        <td style="padding:8px 0;border-bottom:1px solid #eee;text-align:right;">${params.method}</td>
      </tr>
    </table>
    <p style="color:#22863a;font-weight:600;">Thank you for your payment!</p>
  `);
}

export function achReturnHtml(params: {
  customerName: string;
  amount: string;
  reason: string;
}): string {
  return layout(`
    <h2 style="margin:0 0 8px;color:#d73a49;">ACH Payment Returned</h2>
    <p>Hi ${params.customerName},</p>
    <p>Unfortunately, your recent ACH payment was returned by your bank.</p>
    <table role="presentation" width="100%" style="margin:16px 0;border-collapse:collapse;">
      <tr>
        <td style="padding:8px 0;border-bottom:1px solid #eee;font-weight:600;">Amount</td>
        <td style="padding:8px 0;border-bottom:1px solid #eee;text-align:right;">${params.amount}</td>
      </tr>
      <tr>
        <td style="padding:8px 0;border-bottom:1px solid #eee;font-weight:600;">Reason</td>
        <td style="padding:8px 0;border-bottom:1px solid #eee;text-align:right;">${params.reason}</td>
      </tr>
    </table>
    <p>Please contact your marina office to arrange an alternative payment method. A return fee may apply.</p>
  `);
}

export function expiryReminderHtml(params: {
  customerName: string;
  documentType: string;
  expiryDate: string;
  portalUrl: string;
}): string {
  return layout(`
    <h2 style="margin:0 0 8px;">Document Expiring Soon</h2>
    <p>Hi ${params.customerName},</p>
    <p>Your <strong>${params.documentType}</strong> is set to expire on <strong>${params.expiryDate}</strong>.</p>
    <p>Please upload a renewed document to keep your records current and avoid any service interruptions.</p>
    <p style="text-align:center;">${btn(params.portalUrl, "Upload Document")}</p>
  `);
}

/**
 * Generic message template. `heading` and `greetingName` are interpolated
 * verbatim and `bodyHtml` is inserted as HTML, so callers must escape them
 * first (escapeHtml / textToHtml).
 */
export function simpleMessageHtml(params: {
  heading: string;
  greetingName?: string;
  bodyHtml: string;
}): string {
  return layout(`
    <h2 style="margin:0 0 8px;">${params.heading}</h2>
    ${params.greetingName ? `<p>Hi ${params.greetingName},</p>` : ""}
    <p>${params.bodyHtml}</p>
  `);
}

export function announcementHtml(params: {
  subject: string;
  body: string;
  marinaName: string;
}): string {
  return layout(`
    <h2 style="margin:0 0 4px;">${params.subject}</h2>
    <p style="font-size:13px;color:#666;margin:0 0 16px;">From ${params.marinaName}</p>
    <div>${params.body}</div>
  `);
}

// --------------------------------------------------------------------------
// Booking & Rental Templates
// --------------------------------------------------------------------------

export function bookingConfirmationHtml(params: {
  customerName: string;
  productName: string;
  date: string;
  timeSlot: string;
  duration: string;
  totalAmount: string;
  confirmationNumber: string;
  marinaName: string;
  portalUrl: string;
}): string {
  return layout(`
    <h2 style="margin:0 0 8px;color:#0A2342;">Booking Confirmed!</h2>
    <p>Hi ${params.customerName},</p>
    <p>Your rental reservation has been confirmed. Here are the details:</p>
    <table role="presentation" width="100%" style="margin:16px 0;border-collapse:collapse;">
      <tr><td style="padding:10px 12px;border-bottom:1px solid #eee;font-weight:600;width:40%;">Confirmation #</td><td style="padding:10px 12px;border-bottom:1px solid #eee;font-family:monospace;font-weight:700;color:#0A2342;">${params.confirmationNumber}</td></tr>
      <tr><td style="padding:10px 12px;border-bottom:1px solid #eee;font-weight:600;">Rental</td><td style="padding:10px 12px;border-bottom:1px solid #eee;">${params.productName}</td></tr>
      <tr><td style="padding:10px 12px;border-bottom:1px solid #eee;font-weight:600;">Date</td><td style="padding:10px 12px;border-bottom:1px solid #eee;">${params.date}</td></tr>
      <tr><td style="padding:10px 12px;border-bottom:1px solid #eee;font-weight:600;">Time</td><td style="padding:10px 12px;border-bottom:1px solid #eee;">${params.timeSlot}</td></tr>
      <tr><td style="padding:10px 12px;border-bottom:1px solid #eee;font-weight:600;">Duration</td><td style="padding:10px 12px;border-bottom:1px solid #eee;">${params.duration}</td></tr>
      <tr><td style="padding:10px 12px;font-weight:700;font-size:16px;">Total</td><td style="padding:10px 12px;font-weight:700;font-size:16px;color:#0A2342;">${params.totalAmount}</td></tr>
    </table>
    <p style="text-align:center;">${btn(params.portalUrl, "View Reservation")}</p>
    <h3 style="margin:24px 0 8px;font-size:15px;">What to Bring</h3>
    <ul style="color:#444;padding-left:20px;">
      <li>Valid photo ID</li>
      <li>Sunscreen and weather-appropriate clothing</li>
      <li>Signed rental agreement (link below)</li>
    </ul>
    <p style="font-size:13px;color:#666;">Need to modify or cancel? Visit your portal or contact ${params.marinaName}.</p>
  `);
}

export function contractSignatureRequiredHtml(params: {
  customerName: string;
  contractType: string;
  slipNumber: string;
  startDate: string;
  endDate: string;
  monthlyRate: string;
  signingUrl: string;
  marinaName: string;
}): string {
  return layout(`
    <h2 style="margin:0 0 8px;color:#0A2342;">Contract Ready for Signature</h2>
    <p>Hi ${params.customerName},</p>
    <p>Your ${params.contractType} contract is ready for your electronic signature. Please review and sign at your earliest convenience.</p>
    <table role="presentation" width="100%" style="margin:16px 0;border-collapse:collapse;background:#f8fafc;border-radius:6px;">
      <tr><td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;font-weight:600;width:40%;">Contract Type</td><td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;">${params.contractType}</td></tr>
      <tr><td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;font-weight:600;">Slip</td><td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;">${params.slipNumber}</td></tr>
      <tr><td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;font-weight:600;">Term</td><td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;">${params.startDate} — ${params.endDate}</td></tr>
      <tr><td style="padding:10px 12px;font-weight:600;">Monthly Rate</td><td style="padding:10px 12px;font-weight:700;color:#0A2342;">${params.monthlyRate}</td></tr>
    </table>
    <p style="text-align:center;">${btn(params.signingUrl, "Review &amp; Sign Contract")}</p>
    <p style="font-size:13px;color:#666;">This signing link expires in 7 days. If you have questions about the contract terms, please contact ${params.marinaName}.</p>
  `);
}

export function rentalReservationReminderHtml(params: {
  customerName: string;
  productName: string;
  date: string;
  timeSlot: string;
  checkInTime: string;
  confirmationNumber: string;
  marinaName: string;
  marinaAddress: string;
  marinaPhone: string;
  portalUrl: string;
}): string {
  return layout(`
    <h2 style="margin:0 0 8px;color:#0A2342;">Reminder: Your Rental is Tomorrow!</h2>
    <p>Hi ${params.customerName},</p>
    <p>Just a friendly reminder that your rental reservation is coming up:</p>
    <table role="presentation" width="100%" style="margin:16px 0;border-collapse:collapse;background:#f0fdf4;border-radius:6px;border:1px solid #bbf7d0;">
      <tr><td style="padding:10px 12px;border-bottom:1px solid #bbf7d0;font-weight:600;width:40%;">Rental</td><td style="padding:10px 12px;border-bottom:1px solid #bbf7d0;">${params.productName}</td></tr>
      <tr><td style="padding:10px 12px;border-bottom:1px solid #bbf7d0;font-weight:600;">Date</td><td style="padding:10px 12px;border-bottom:1px solid #bbf7d0;font-weight:700;">${params.date}</td></tr>
      <tr><td style="padding:10px 12px;border-bottom:1px solid #bbf7d0;font-weight:600;">Time Slot</td><td style="padding:10px 12px;border-bottom:1px solid #bbf7d0;">${params.timeSlot}</td></tr>
      <tr><td style="padding:10px 12px;font-weight:600;">Check-In By</td><td style="padding:10px 12px;font-weight:700;color:#16a34a;">${params.checkInTime}</td></tr>
    </table>
    <h3 style="margin:20px 0 8px;font-size:15px;">Check-In Instructions</h3>
    <ol style="color:#444;padding-left:20px;line-height:1.8;">
      <li>Arrive at the marina at least 15 minutes before your time slot</li>
      <li>Bring a valid photo ID</li>
      <li>Check in at the rental dock office</li>
      <li>Complete safety briefing and sign rental agreement</li>
    </ol>
    <h3 style="margin:20px 0 8px;font-size:15px;">Marina Location</h3>
    <p style="color:#444;">${params.marinaName}<br/>${params.marinaAddress}<br/>Phone: ${params.marinaPhone}</p>
    <p style="text-align:center;">${btn(params.portalUrl, "View Reservation Details")}</p>
    <p style="font-size:13px;color:#666;">Confirmation #: ${params.confirmationNumber}</p>
  `);
}

export function rentalAgreementSignatureHtml(params: {
  customerName: string;
  productName: string;
  date: string;
  duration: string;
  waiverType: string;
  depositAmount: string;
  signingUrl: string;
  marinaName: string;
}): string {
  return layout(`
    <h2 style="margin:0 0 8px;color:#0A2342;">Rental Agreement — Signature Required</h2>
    <p>Hi ${params.customerName},</p>
    <p>Before your upcoming rental, please review and sign the rental agreement and liability waiver.</p>
    <table role="presentation" width="100%" style="margin:16px 0;border-collapse:collapse;">
      <tr><td style="padding:10px 12px;border-bottom:1px solid #eee;font-weight:600;width:40%;">Rental</td><td style="padding:10px 12px;border-bottom:1px solid #eee;">${params.productName}</td></tr>
      <tr><td style="padding:10px 12px;border-bottom:1px solid #eee;font-weight:600;">Date</td><td style="padding:10px 12px;border-bottom:1px solid #eee;">${params.date}</td></tr>
      <tr><td style="padding:10px 12px;border-bottom:1px solid #eee;font-weight:600;">Duration</td><td style="padding:10px 12px;border-bottom:1px solid #eee;">${params.duration}</td></tr>
      <tr><td style="padding:10px 12px;border-bottom:1px solid #eee;font-weight:600;">Protection</td><td style="padding:10px 12px;border-bottom:1px solid #eee;">${params.waiverType}</td></tr>
      <tr><td style="padding:10px 12px;font-weight:600;">Security Deposit</td><td style="padding:10px 12px;font-weight:700;color:#0A2342;">${params.depositAmount}</td></tr>
    </table>
    <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:6px;padding:12px 16px;margin:16px 0;">
      <strong style="color:#92400e;">Important:</strong>
      <span style="color:#78350f;"> All renters must sign the rental agreement before check-in. Unsigned agreements may result in cancellation.</span>
    </div>
    <p style="text-align:center;">${btn(params.signingUrl, "Review &amp; Sign Agreement")}</p>
    <p style="font-size:13px;color:#666;">Questions? Contact ${params.marinaName} before your rental date.</p>
  `);
}

export function postRentalThankYouHtml(params: {
  customerName: string;
  productName: string;
  date: string;
  npsUrl: string;
  reviewUrl: string;
  marinaName: string;
}): string {
  return layout(`
    <h2 style="margin:0 0 8px;color:#0A2342;">Thanks for Renting with Us!</h2>
    <p>Hi ${params.customerName},</p>
    <p>We hope you had a great time on the <strong>${params.productName}</strong> on ${params.date}!</p>
    <p>We'd love to hear about your experience. Your feedback helps us improve and helps other customers find us.</p>
    <div style="text-align:center;margin:24px 0;">
      ${btn(params.npsUrl, "Rate Your Experience")}
    </div>
    <p style="text-align:center;font-size:14px;color:#444;">Had an amazing time? <a href="${params.reviewUrl}" style="color:#0066ff;font-weight:600;">Leave us a Google review!</a></p>
    <p style="font-size:13px;color:#666;">Thanks for choosing ${params.marinaName}. We look forward to seeing you again!</p>
  `);
}

export function contractRenewalNoticeHtml(params: {
  customerName: string;
  slipNumber: string;
  currentEndDate: string;
  newRate: string;
  rateChange: string;
  renewalDeadline: string;
  portalUrl: string;
  marinaName: string;
}): string {
  return layout(`
    <h2 style="margin:0 0 8px;color:#0A2342;">Contract Renewal Notice</h2>
    <p>Hi ${params.customerName},</p>
    <p>Your slip contract for <strong>${params.slipNumber}</strong> is approaching its end date of <strong>${params.currentEndDate}</strong>.</p>
    <h3 style="font-size:15px;margin:20px 0 8px;">Renewal Terms</h3>
    <table role="presentation" width="100%" style="margin:8px 0 16px;border-collapse:collapse;background:#f8fafc;border-radius:6px;">
      <tr><td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;font-weight:600;">New Monthly Rate</td><td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;font-weight:700;color:#0A2342;">${params.newRate}</td></tr>
      <tr><td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;font-weight:600;">Rate Change</td><td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;">${params.rateChange}</td></tr>
      <tr><td style="padding:10px 12px;font-weight:600;">Response Deadline</td><td style="padding:10px 12px;font-weight:700;color:#d97706;">${params.renewalDeadline}</td></tr>
    </table>
    <p style="text-align:center;">${btn(params.portalUrl, "Review Renewal")}</p>
    <p style="font-size:13px;color:#666;">If we don't hear from you by ${params.renewalDeadline}, your contract will be renewed automatically at the new rate. Contact ${params.marinaName} with any questions.</p>
  `);
}
