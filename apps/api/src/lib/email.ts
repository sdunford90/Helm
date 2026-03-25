import { Resend } from "resend";

// --------------------------------------------------------------------------
// Resend client
// --------------------------------------------------------------------------

const resend = new Resend(process.env.RESEND_API_KEY);

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
 * Send an email via Resend.  Returns the Resend message id on success, or
 * null when the send fails (error is logged but not thrown so callers in
 * background workers don't crash the process).
 */
export async function sendEmail(
  options: EmailOptions,
  marinaDomain?: string,
): Promise<string | null> {
  const from =
    options.from ||
    (marinaDomain ? `billing@${marinaDomain}` : "noreply@gethelm.com");

  try {
    const { data, error } = await resend.emails.send({
      from,
      to: Array.isArray(options.to) ? options.to : [options.to],
      subject: options.subject,
      html: options.html,
      ...(options.replyTo ? { replyTo: options.replyTo } : {}),
      ...(options.tags ? { tags: options.tags } : {}),
    });

    if (error) {
      console.error("[email] Resend API error:", error);
      return null;
    }

    return data?.id ?? null;
  } catch (err) {
    console.error("[email] Failed to send:", err);
    return null;
  }
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
