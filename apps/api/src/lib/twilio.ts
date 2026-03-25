import twilio from "twilio";

// ---------------------------------------------------------------------------
// Twilio SMS Client
//
// Sends SMS messages for announcements, overstay alerts, waitlist
// notifications, and other marina communications.
// ---------------------------------------------------------------------------

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const fromNumber = process.env.TWILIO_FROM_NUMBER;

const client =
  accountSid && authToken ? twilio(accountSid, authToken) : null;

interface SendSmsResult {
  sid: string;
  success: boolean;
  error?: string;
}

/**
 * Send a single SMS message via Twilio.
 */
export async function sendSms(
  to: string,
  body: string,
): Promise<SendSmsResult> {
  if (!client || !fromNumber) {
    console.warn("[twilio] Skipping SMS (not configured):", body.slice(0, 50));
    return { sid: "disabled", success: false, error: "Twilio not configured" };
  }

  try {
    const message = await client.messages.create({
      to,
      from: fromNumber,
      body,
    });

    return { sid: message.sid, success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[twilio] Send failed:", msg);
    return { sid: "", success: false, error: msg };
  }
}

/**
 * Send an SMS to multiple recipients (sequentially to respect rate limits).
 */
export async function sendBulkSms(
  recipients: { to: string; body: string }[],
): Promise<SendSmsResult[]> {
  const results: SendSmsResult[] = [];
  for (const r of recipients) {
    const result = await sendSms(r.to, r.body);
    results.push(result);
  }
  return results;
}

// ---------------------------------------------------------------------------
// Message Templates
// ---------------------------------------------------------------------------

export function announcementSmsBody(params: {
  marinaName: string;
  title: string;
  isEmergency: boolean;
}): string {
  const prefix = params.isEmergency ? "🚨 EMERGENCY: " : "";
  return `${prefix}${params.marinaName}: ${params.title}`;
}

export function waitlistNotificationSmsBody(params: {
  customerName: string;
  slipType: string;
  expiresAt: string;
}): string {
  return `Hi ${params.customerName}, a ${params.slipType} slip is available! Reply or contact us by ${params.expiresAt} to claim it.`;
}

export function overstayAlertSmsBody(params: {
  guestName: string;
  slipNumber: string;
}): string {
  return `Overstay Alert: ${params.guestName} at slip ${params.slipNumber} has exceeded their checkout time. Please follow up.`;
}

export function invoiceReminderSmsBody(params: {
  customerName: string;
  invoiceNumber: string;
  amountDue: string;
  dueDate: string;
}): string {
  return `Hi ${params.customerName}, invoice ${params.invoiceNumber} for ${params.amountDue} is due ${params.dueDate}. Log in to pay online.`;
}
