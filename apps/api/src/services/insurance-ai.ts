import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "../lib/prisma.js";
import { queues } from "../lib/queue.js";

// --------------------------------------------------------------------------
// Claude API client
// --------------------------------------------------------------------------

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

export interface ExtractionResult {
  insurer: string | null;
  policyNumber: string | null;
  startDate: string | null;
  expiryDate: string | null;
  coverageLimits: {
    bodilyInjury: number | null;
    propertyDamage: number | null;
    medicalPayments: number | null;
    generalAggregate: number | null;
  };
  additionalInsured: string | null;
  confidence: Record<string, "high" | "medium" | "low">;
  rawExtraction: string;
}

export interface CoverageGap {
  field: string;
  required: number;
  actual: number | null;
  status: "pass" | "fail" | "unknown";
}

export interface ValidationResult {
  meetsMinimums: boolean;
  gaps: CoverageGap[];
}

// --------------------------------------------------------------------------
// Default minimum coverage requirements (in dollars)
// --------------------------------------------------------------------------

const DEFAULT_MINIMUMS: Record<string, number> = {
  bodilyInjury: 300_000,
  propertyDamage: 100_000,
  medicalPayments: 5_000,
  generalAggregate: 500_000,
};

// --------------------------------------------------------------------------
// parseInsuranceDocument — Extract ACORD 25 fields via Claude
// --------------------------------------------------------------------------

export async function parseInsuranceDocument(
  documentText: string,
  _tenantId: string,
): Promise<ExtractionResult> {
  const systemPrompt = `You are an expert insurance document parser specializing in ACORD 25 Certificate of Liability Insurance forms. Your job is to extract structured data from certificate text with high accuracy.

Rules:
- Extract ONLY what is explicitly stated in the document. Do not infer or guess values.
- For monetary amounts, return the numeric value in dollars (e.g., 1000000 for "$1,000,000").
- For dates, return in ISO 8601 format (YYYY-MM-DD).
- If a field is not found or illegible, return null for that field.
- Assign a confidence score to each extracted field: "high" (clearly legible and unambiguous), "medium" (partially legible or potentially ambiguous), or "low" (barely legible, inferred from context, or uncertain).

Return your response as a single JSON object with NO additional text or markdown formatting.`;

  const userPrompt = `Parse the following insurance certificate text and extract the fields below.

DOCUMENT TEXT:
---
${documentText}
---

Return a JSON object with exactly this structure:
{
  "insurer": "Name of the insurance company, or null if not found",
  "policyNumber": "Policy number string, or null if not found",
  "startDate": "YYYY-MM-DD format, or null if not found",
  "expiryDate": "YYYY-MM-DD format, or null if not found",
  "coverageLimits": {
    "bodilyInjury": number_in_dollars_or_null,
    "propertyDamage": number_in_dollars_or_null,
    "medicalPayments": number_in_dollars_or_null,
    "generalAggregate": number_in_dollars_or_null
  },
  "additionalInsured": "Name of additional insured party, or null if not listed",
  "confidence": {
    "insurer": "high|medium|low",
    "policyNumber": "high|medium|low",
    "startDate": "high|medium|low",
    "expiryDate": "high|medium|low",
    "bodilyInjury": "high|medium|low",
    "propertyDamage": "high|medium|low",
    "medicalPayments": "high|medium|low",
    "generalAggregate": "high|medium|low",
    "additionalInsured": "high|medium|low"
  }
}

Important:
- Look for "COMMERCIAL GENERAL LIABILITY" section for bodily injury, property damage, medical payments, and general aggregate limits.
- The insurer name is typically in the "INSURER(S) AFFORDING COVERAGE" section.
- Policy effective and expiration dates are in the "POLICY EFF" and "POLICY EXP" columns.
- Additional insured information is in the "DESCRIPTION OF OPERATIONS" or "CERTIFICATE HOLDER" section.`;

  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 2048,
    messages: [
      {
        role: "user",
        content: userPrompt,
      },
    ],
    system: systemPrompt,
  });

  // Extract text content from the response
  const rawText =
    response.content
      .filter((block) => block.type === "text")
      .map((block) => {
        if (block.type === "text") return block.text;
        return "";
      })
      .join("") || "";

  // Parse the JSON from Claude's response — strip markdown fences if present
  let jsonString = rawText.trim();
  if (jsonString.startsWith("```")) {
    jsonString = jsonString.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(jsonString);
  } catch {
    // If parsing fails, return empty result with low confidence
    console.error("[insurance-ai] Failed to parse Claude response:", rawText);
    return {
      insurer: null,
      policyNumber: null,
      startDate: null,
      expiryDate: null,
      coverageLimits: {
        bodilyInjury: null,
        propertyDamage: null,
        medicalPayments: null,
        generalAggregate: null,
      },
      additionalInsured: null,
      confidence: {
        insurer: "low",
        policyNumber: "low",
        startDate: "low",
        expiryDate: "low",
        bodilyInjury: "low",
        propertyDamage: "low",
        medicalPayments: "low",
        generalAggregate: "low",
        additionalInsured: "low",
      },
      rawExtraction: rawText,
    };
  }

  const limits = (parsed.coverageLimits ?? {}) as Record<string, unknown>;
  const confidence = (parsed.confidence ?? {}) as Record<string, string>;

  const toConfidence = (val: unknown): "high" | "medium" | "low" => {
    if (val === "high" || val === "medium" || val === "low") return val;
    return "low";
  };

  const toNumberOrNull = (val: unknown): number | null => {
    if (val === null || val === undefined) return null;
    const n = Number(val);
    return Number.isFinite(n) ? n : null;
  };

  const toStringOrNull = (val: unknown): string | null => {
    if (val === null || val === undefined || val === "") return null;
    return String(val);
  };

  return {
    insurer: toStringOrNull(parsed.insurer),
    policyNumber: toStringOrNull(parsed.policyNumber),
    startDate: toStringOrNull(parsed.startDate),
    expiryDate: toStringOrNull(parsed.expiryDate),
    coverageLimits: {
      bodilyInjury: toNumberOrNull(limits.bodilyInjury),
      propertyDamage: toNumberOrNull(limits.propertyDamage),
      medicalPayments: toNumberOrNull(limits.medicalPayments),
      generalAggregate: toNumberOrNull(limits.generalAggregate),
    },
    additionalInsured: toStringOrNull(parsed.additionalInsured),
    confidence: {
      insurer: toConfidence(confidence.insurer),
      policyNumber: toConfidence(confidence.policyNumber),
      startDate: toConfidence(confidence.startDate),
      expiryDate: toConfidence(confidence.expiryDate),
      bodilyInjury: toConfidence(confidence.bodilyInjury),
      propertyDamage: toConfidence(confidence.propertyDamage),
      medicalPayments: toConfidence(confidence.medicalPayments),
      generalAggregate: toConfidence(confidence.generalAggregate),
      additionalInsured: toConfidence(confidence.additionalInsured),
    },
    rawExtraction: rawText,
  };
}

// --------------------------------------------------------------------------
// validateCoverage — Compare extraction against tenant minimums
// --------------------------------------------------------------------------

export async function validateCoverage(
  extraction: ExtractionResult,
  tenantId: string,
): Promise<ValidationResult> {
  // Try to load tenant-specific minimums from brandingJson / invoiceTemplateJson
  let minimums: Record<string, number> = { ...DEFAULT_MINIMUMS };

  try {
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { invoiceTemplateJson: true },
    });

    if (tenant?.invoiceTemplateJson && typeof tenant.invoiceTemplateJson === "object") {
      const settings = tenant.invoiceTemplateJson as Record<string, unknown>;
      const insuranceMins = settings.insuranceMinimums as Record<string, number> | undefined;
      if (insuranceMins) {
        minimums = { ...DEFAULT_MINIMUMS, ...insuranceMins };
      }
    }
  } catch {
    // Fall back to defaults on any error
  }

  const gaps: CoverageGap[] = [];
  const limitFields: Array<{ field: string; key: keyof ExtractionResult["coverageLimits"] }> = [
    { field: "bodilyInjury", key: "bodilyInjury" },
    { field: "propertyDamage", key: "propertyDamage" },
    { field: "medicalPayments", key: "medicalPayments" },
    { field: "generalAggregate", key: "generalAggregate" },
  ];

  let meetsMinimums = true;

  for (const { field, key } of limitFields) {
    const required = minimums[field] ?? 0;
    const actual = extraction.coverageLimits[key];

    if (actual === null) {
      gaps.push({ field, required, actual: null, status: "unknown" });
      meetsMinimums = false;
    } else if (actual >= required) {
      gaps.push({ field, required, actual, status: "pass" });
    } else {
      gaps.push({ field, required, actual, status: "fail" });
      meetsMinimums = false;
    }
  }

  return { meetsMinimums, gaps };
}

// --------------------------------------------------------------------------
// processInsuranceUpload — Full pipeline: parse → validate → persist → notify
// --------------------------------------------------------------------------

export async function processInsuranceUpload(
  documentUrl: string,
  documentText: string,
  customerId: string,
  boatId: string,
  tenantId: string,
): Promise<string> {
  // 1. Parse the document via Claude
  const extraction = await parseInsuranceDocument(documentText, tenantId);

  // 2. Validate coverage against tenant minimums
  const validation = await validateCoverage(extraction, tenantId);

  // 3. Determine initial status based on confidence scores
  const hasLowConfidence = Object.values(extraction.confidence).some(
    (c) => c === "low",
  );
  const status = hasLowConfidence ? "PENDING_REVIEW" : "PENDING_REVIEW";
  // Always start as PENDING_REVIEW — staff must approve

  // 4. Create InsuranceRecord in database
  const record = await prisma.insuranceRecord.create({
    data: {
      tenantId,
      customerId,
      boatId: boatId || null,
      documentUrl,
      insurer: extraction.insurer,
      policyNumber: extraction.policyNumber,
      startDate: extraction.startDate ? new Date(extraction.startDate) : null,
      expiryDate: extraction.expiryDate ? new Date(extraction.expiryDate) : null,
      coverageJson: {
        limits: extraction.coverageLimits,
        additionalInsured: extraction.additionalInsured,
        validation,
      },
      extractionConfidence: JSON.stringify(extraction.confidence),
      status,
    },
  });

  // 5. Queue expiry reminder emails (30 days and 7 days before expiry)
  if (extraction.expiryDate) {
    const expiryDate = new Date(extraction.expiryDate);
    const now = new Date();

    const thirtyDaysBefore = new Date(expiryDate);
    thirtyDaysBefore.setDate(thirtyDaysBefore.getDate() - 30);

    const sevenDaysBefore = new Date(expiryDate);
    sevenDaysBefore.setDate(sevenDaysBefore.getDate() - 7);

    const reminders = [
      { date: thirtyDaysBefore, label: "30-day" },
      { date: sevenDaysBefore, label: "7-day" },
    ];

    for (const reminder of reminders) {
      if (reminder.date > now) {
        try {
          await queues.email.add(
            `insurance-expiry-${reminder.label}`,
            {
              type: "insurance_expiry_reminder",
              tenantId,
              customerId,
              insuranceRecordId: record.id,
              expiryDate: extraction.expiryDate,
              reminderType: reminder.label,
            },
            {
              delay: reminder.date.getTime() - now.getTime(),
              attempts: 3,
              backoff: { type: "exponential", delay: 60_000 },
            },
          );
        } catch (err) {
          console.error(
            `[insurance-ai] Failed to queue ${reminder.label} expiry reminder:`,
            err,
          );
        }
      }
    }
  }

  // 6. Log the processing for audit trail
  try {
    await prisma.auditLog.create({
      data: {
        tenantId,
        recordType: "InsuranceRecord",
        recordId: record.id,
        action: "CREATED",
        changedFieldsJson: {
          source: "ai_extraction",
          hasLowConfidence,
          meetsMinimums: validation.meetsMinimums,
          gapCount: validation.gaps.filter((g) => g.status === "fail").length,
        },
      },
    });
  } catch {
    // Audit log failure should not block the main flow
  }

  return record.id;
}
