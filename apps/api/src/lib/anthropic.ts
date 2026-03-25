import Anthropic from "@anthropic-ai/sdk";

// ---------------------------------------------------------------------------
// Anthropic Claude Integration
//
// Used for AI-powered insurance document extraction — parses uploaded
// insurance certificates and extracts structured data (carrier, policy
// number, coverage amounts, dates, etc.).
// ---------------------------------------------------------------------------

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

const client = ANTHROPIC_API_KEY ? new Anthropic({ apiKey: ANTHROPIC_API_KEY }) : null;

export interface InsuranceExtraction {
  carrier: string | null;
  policyNumber: string | null;
  insuredName: string | null;
  effectiveDate: string | null;
  expirationDate: string | null;
  coverageAmountCents: number | null;
  deductibleCents: number | null;
  liabilityCoverageCents: number | null;
  hullValueCents: number | null;
  vesselName: string | null;
  vesselHin: string | null;
  additionalInsured: string[] | null;
  confidence: number;
}

/**
 * Extract structured insurance data from a document image or PDF.
 * Uses Claude's vision capabilities to parse insurance certificates.
 */
export async function extractInsuranceData(
  fileBase64: string,
  mediaType: "image/jpeg" | "image/png" | "image/webp" | "application/pdf",
): Promise<InsuranceExtraction> {
  if (!client) {
    console.warn("[anthropic] Skipping extraction (no API key)");
    return createEmptyExtraction();
  }

  const contentBlock =
    mediaType === "application/pdf"
      ? {
          type: "document" as const,
          source: {
            type: "base64" as const,
            media_type: mediaType,
            data: fileBase64,
          },
        }
      : {
          type: "image" as const,
          source: {
            type: "base64" as const,
            media_type: mediaType,
            data: fileBase64,
          },
        };

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1024,
    messages: [
      {
        role: "user",
        content: [
          contentBlock,
          {
            type: "text",
            text: `Extract the following insurance information from this document and return it as JSON only (no markdown, no explanation):

{
  "carrier": "insurance company name",
  "policyNumber": "policy number",
  "insuredName": "name of insured party",
  "effectiveDate": "YYYY-MM-DD",
  "expirationDate": "YYYY-MM-DD",
  "coverageAmountCents": total coverage in cents (integer),
  "deductibleCents": deductible in cents (integer),
  "liabilityCoverageCents": liability coverage in cents (integer),
  "hullValueCents": hull value in cents (integer),
  "vesselName": "name of vessel if listed",
  "vesselHin": "HIN if listed",
  "additionalInsured": ["list of additional insured parties"],
  "confidence": 0.0 to 1.0 confidence score
}

If a field cannot be found, use null. For dollar amounts, convert to cents (multiply by 100).`,
          },
        ],
      },
    ],
  });

  try {
    const text =
      response.content[0].type === "text" ? response.content[0].text : "";
    const parsed = JSON.parse(text) as InsuranceExtraction;
    return {
      ...createEmptyExtraction(),
      ...parsed,
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.5,
    };
  } catch {
    console.error("[anthropic] Failed to parse extraction response");
    return createEmptyExtraction();
  }
}

function createEmptyExtraction(): InsuranceExtraction {
  return {
    carrier: null,
    policyNumber: null,
    insuredName: null,
    effectiveDate: null,
    expirationDate: null,
    coverageAmountCents: null,
    deductibleCents: null,
    liabilityCoverageCents: null,
    hullValueCents: null,
    vesselName: null,
    vesselHin: null,
    additionalInsured: null,
    confidence: 0,
  };
}
