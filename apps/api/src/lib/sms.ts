import twilio from "twilio";

// --------------------------------------------------------------------------
// Twilio client
// --------------------------------------------------------------------------

// Lazy: twilio() throws at construction time when credentials are missing,
// and this module is imported by the worker and by tests.
type TwilioClient = ReturnType<typeof twilio>;
let client: TwilioClient | null = null;

function getClient(): TwilioClient {
  if (!client) {
    if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
      throw new SmsSendError("Twilio credentials are not configured", { permanent: true });
    }
    client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  }
  return client;
}

/** Test hook: inject a fake Twilio client (or reset with null). */
export function __setTwilioClientForTests(fake: unknown): void {
  client = fake as TwilioClient | null;
}

/**
 * Thrown when an SMS cannot be sent. `permanent` errors (missing config,
 * invalid number, recipient opted out via STOP) must not be retried.
 */
export class SmsSendError extends Error {
  readonly permanent: boolean;
  readonly cause?: unknown;
  constructor(message: string, opts: { permanent?: boolean; cause?: unknown } = {}) {
    super(message);
    this.name = "SmsSendError";
    this.permanent = opts.permanent ?? false;
    this.cause = opts.cause;
  }
}

// Twilio error codes that will never succeed on retry:
// 21211 invalid 'To', 21408 region not enabled, 21610 unsubscribed (STOP),
// 21612 cannot route, 21614 not a mobile number.
const PERMANENT_TWILIO_CODES = new Set([21211, 21408, 21610, 21612, 21614]);

// --------------------------------------------------------------------------
// Send SMS
// --------------------------------------------------------------------------

/**
 * Send an SMS message via Twilio.  Uses the marina's 10DLC number when
 * provided, otherwise falls back to the platform default.
 *
 * Returns the Twilio message SID. Throws SmsSendError on failure so that a
 * BullMQ job fails and is retried instead of the error being swallowed.
 */
export async function sendSms(
  to: string,
  body: string,
  fromNumber?: string,
): Promise<string> {
  const from = fromNumber || process.env.TWILIO_DEFAULT_NUMBER || "";

  if (!from) {
    throw new SmsSendError("No SMS from-number configured", { permanent: true });
  }
  if (!to) {
    throw new SmsSendError("No SMS recipient", { permanent: true });
  }

  const twilioClient = getClient();
  try {
    const message = await twilioClient.messages.create({ to, from, body });
    return message.sid;
  } catch (err) {
    const code = Number((err as { code?: unknown }).code);
    throw new SmsSendError(
      `Twilio send failed${Number.isFinite(code) ? ` (${code})` : ""}: ${
        err instanceof Error ? err.message : String(err)
      }`,
      { permanent: PERMANENT_TWILIO_CODES.has(code), cause: err },
    );
  }
}

// --------------------------------------------------------------------------
// Phone number provisioning
// --------------------------------------------------------------------------

/**
 * Search for an available local 10DLC-capable number in the given area code,
 * purchase it, and return the phone number string (E.164 format).
 */
export async function provisionPhoneNumber(
  areaCode?: string,
): Promise<string> {
  const searchParams: Record<string, unknown> = {
    smsEnabled: true,
    voiceEnabled: false,
    limit: 1,
  };

  if (areaCode) {
    searchParams.areaCode = areaCode;
  }

  const twilioClient = getClient();
  const available = await twilioClient
    .availablePhoneNumbers("US")
    .local.list(searchParams as any);

  if (available.length === 0) {
    throw new Error(
      `[sms] No available numbers found${areaCode ? ` for area code ${areaCode}` : ""}`,
    );
  }

  const purchased = await twilioClient.incomingPhoneNumbers.create({
    phoneNumber: available[0].phoneNumber,
  });

  console.log("[sms] Provisioned number:", purchased.phoneNumber);
  return purchased.phoneNumber;
}
