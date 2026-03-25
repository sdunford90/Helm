import twilio from "twilio";

// --------------------------------------------------------------------------
// Twilio client
// --------------------------------------------------------------------------

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN,
);

const DEFAULT_FROM = process.env.TWILIO_DEFAULT_NUMBER ?? "";

// --------------------------------------------------------------------------
// Send SMS
// --------------------------------------------------------------------------

/**
 * Send an SMS message via Twilio.  Uses the marina's 10DLC number when
 * provided, otherwise falls back to the platform default.
 *
 * Returns the Twilio message SID on success, or null on failure (error is
 * logged but not thrown so background workers don't crash).
 */
export async function sendSms(
  to: string,
  body: string,
  fromNumber?: string,
): Promise<string | null> {
  const from = fromNumber || DEFAULT_FROM;

  if (!from) {
    console.error("[sms] No from number configured — skipping send");
    return null;
  }

  try {
    const message = await client.messages.create({
      to,
      from,
      body,
    });

    return message.sid;
  } catch (err) {
    console.error("[sms] Failed to send:", err);
    return null;
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

  const available = await client
    .availablePhoneNumbers("US")
    .local.list(searchParams as any);

  if (available.length === 0) {
    throw new Error(
      `[sms] No available numbers found${areaCode ? ` for area code ${areaCode}` : ""}`,
    );
  }

  const purchased = await client.incomingPhoneNumbers.create({
    phoneNumber: available[0].phoneNumber,
  });

  console.log("[sms] Provisioned number:", purchased.phoneNumber);
  return purchased.phoneNumber;
}
