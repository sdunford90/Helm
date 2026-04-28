import { prisma } from "../lib/prisma.js";

// --------------------------------------------------------------------------
// Lead -> Customer conversion service
// --------------------------------------------------------------------------

export interface ConvertLeadOptions {
  /** Boat info to create alongside the customer */
  boat?: {
    name?: string;
    registrationNumber?: string;
    registrationState?: string;
    hin?: string;
    make?: string;
    model?: string;
    year?: number;
    lengthFt: number;
    beamFt?: number;
    draftFt?: number;
    fuelType?: string;
    engineCount?: number;
    engineHp?: number;
  };

  /** Assign the new customer to a slip and create a contract */
  slipAssignment?: {
    slipId: string;
    startDate: Date;
    endDate?: Date;
    rateCents: number;
    billingCycle?: "MONTHLY" | "QUARTERLY" | "SEMI_ANNUAL" | "ANNUAL";
    autoRenew?: boolean;
    securityDepositCents?: number;
  };

  /** Optional overrides for the customer record */
  customerOverrides?: {
    company?: string;
    phone?: string;
    email?: string;
    addressJson?: Record<string, unknown>;
  };

  /** The user performing the conversion (for audit trail) */
  performedBy?: string;
  performedByName?: string;
}

export interface ConvertLeadResult {
  customer: {
    id: string;
    firstName: string;
    lastName: string;
    email: string | null;
  };
  boat?: { id: string; name: string | null; lengthFt: number };
  contract?: { id: string; slipId: string; startDate: Date };
}

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

function appError(
  message: string,
  statusCode: number,
  code: string,
): Error & { statusCode: number; code: string } {
  const err = new Error(message) as Error & {
    statusCode: number;
    code: string;
  };
  err.statusCode = statusCode;
  err.code = code;
  return err;
}

// --------------------------------------------------------------------------
// Main conversion function
// --------------------------------------------------------------------------

/**
 * Converts a WON lead into a full Customer, optionally creating a Boat and
 * SlipContract in a single transaction.  All source attribution is carried
 * forward.  An AuditLog entry is created for traceability.
 */
export async function convertLeadToCustomer(
  leadId: string,
  tenantId: string,
  options: ConvertLeadOptions = {},
): Promise<ConvertLeadResult> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return prisma.$transaction(async (tx: any) => {
    // 1. Fetch the lead and verify it's in WON stage
    const lead = await tx.lead.findFirst({
      where: { id: leadId, tenantId },
    });

    if (!lead) {
      throw appError("Lead not found", 404, "NOT_FOUND");
    }

    if (lead.stage !== "WON") {
      throw appError(
        "Lead must be in WON stage to convert. Current stage: " + lead.stage,
        400,
        "INVALID_STAGE",
      );
    }

    if (lead.customerId) {
      throw appError("Lead has already been converted", 400, "ALREADY_CONVERTED");
    }

    // 2. Create Customer — carry forward source attribution.
    // Prefer the first-class `source` enum (set on every lead).  When the lead
    // is in the OTHER catch-all and we have UTM/referral data, fall back to
    // the legacy slash-joined string so existing reporting keeps working.
    const SOURCE_LABELS: Record<string, string> = {
      WEBSITE: "Website",
      REFERRAL: "Referral",
      WALK_IN: "Walk-in",
      PHONE: "Phone call",
      SOCIAL_MEDIA: "Social media",
      EMAIL: "Email",
      OTHER: "Other",
    };
    const utmJoined = [lead.utmSource, lead.utmMedium, lead.referralCode]
      .filter(Boolean)
      .join(" / ");
    const leadSource =
      lead.source && lead.source !== "OTHER"
        ? SOURCE_LABELS[lead.source as string] ?? (lead.source as string)
        : utmJoined || SOURCE_LABELS[(lead.source as string) ?? "OTHER"] || "direct";

    const customer = await tx.customer.create({
      data: {
        tenantId,
        firstName: lead.firstName,
        lastName: lead.lastName,
        email: options.customerOverrides?.email ?? lead.email,
        phone: options.customerOverrides?.phone ?? lead.phone,
        company: options.customerOverrides?.company,
        addressJson: options.customerOverrides?.addressJson,
        leadSource,
        convertedFromLeadId: lead.id,
        status: "ACTIVE",
      },
    });

    // 3. Optionally create Boat
    let boat: { id: string; name: string | null; lengthFt: number } | undefined;
    if (options.boat) {
      const createdBoat = await tx.boat.create({
        data: {
          tenantId,
          customerId: customer.id,
          name: options.boat.name,
          registrationNumber: options.boat.registrationNumber,
          registrationState: options.boat.registrationState,
          hin: options.boat.hin,
          make: options.boat.make,
          model: options.boat.model,
          year: options.boat.year,
          lengthFt: options.boat.lengthFt,
          beamFt: options.boat.beamFt,
          draftFt: options.boat.draftFt,
          fuelType: options.boat.fuelType,
          engineCount: options.boat.engineCount,
          engineHp: options.boat.engineHp,
        },
      });
      boat = {
        id: createdBoat.id,
        name: createdBoat.name,
        lengthFt: createdBoat.lengthFt,
      };
    }

    // 4. Optionally create SlipContract
    let contract:
      | { id: string; slipId: string; startDate: Date }
      | undefined;
    if (options.slipAssignment) {
      const sa = options.slipAssignment;

      // Verify slip exists and is available
      const slip = await tx.slip.findFirst({
        where: { id: sa.slipId, tenantId },
      });

      if (!slip) {
        throw appError("Slip not found", 404, "SLIP_NOT_FOUND");
      }

      if (slip.status !== "VACANT" && slip.status !== "RESERVED") {
        throw appError(
          "Slip is not available. Current status: " + slip.status,
          400,
          "SLIP_UNAVAILABLE",
        );
      }

      const createdContract = await tx.slipContract.create({
        data: {
          tenantId,
          slipId: sa.slipId,
          customerId: customer.id,
          boatId: boat?.id,
          startDate: sa.startDate,
          endDate: sa.endDate,
          rateCents: sa.rateCents,
          billingCycle: sa.billingCycle ?? "MONTHLY",
          autoRenew: sa.autoRenew ?? false,
          securityDepositCents: sa.securityDepositCents,
          status: "ACTIVE",
        },
      });

      // Mark slip as occupied
      await tx.slip.update({
        where: { id: sa.slipId },
        data: { status: "OCCUPIED" },
      });

      contract = {
        id: createdContract.id,
        slipId: createdContract.slipId,
        startDate: createdContract.startDate,
      };
    }

    // 5. Update lead with conversion data
    await tx.lead.update({
      where: { id: leadId },
      data: {
        stage: "WON",
        convertedAt: new Date(),
        customerId: customer.id,
      },
    });

    // 6. Audit log
    await tx.auditLog.create({
      data: {
        tenantId,
        userId: options.performedBy,
        userName: options.performedByName,
        recordType: "Lead",
        recordId: leadId,
        action: "CONVERTED",
        changedFieldsJson: {
          customerId: customer.id,
          boatId: boat?.id ?? null,
          contractId: contract?.id ?? null,
          leadSource,
        },
      },
    });

    return {
      customer: {
        id: customer.id,
        firstName: customer.firstName,
        lastName: customer.lastName,
        email: customer.email,
      },
      boat,
      contract,
    };
  });
}
