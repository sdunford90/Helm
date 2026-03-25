import { prisma } from "../lib/prisma.js";

// --------------------------------------------------------------------------
// Compliance score types
// --------------------------------------------------------------------------

export type ComplianceLevel = "ALL_GOOD" | "ATTENTION_REQUIRED" | "NON_COMPLIANT";

export interface InsuranceCompliance {
  status: "VALID" | "EXPIRED" | "MISSING";
  expiryDate: Date | null;
  policyNumber: string | null;
  insurer: string | null;
}

export interface RegistrationCompliance {
  status: "VALID" | "EXPIRED" | "MISSING";
  expiryDate: Date | null;
  registrationNumber: string | null;
}

export interface SafetyCompliance {
  status: "ALL_GOOD" | "NEEDS_ATTENTION" | "NO_INSPECTION";
  lastInspection: Date | null;
  nextDueDate: Date | null;
  passFail: string | null;
  issues: string[];
}

export interface BoatComplianceResult {
  boatId: string;
  overallScore: ComplianceLevel;
  insurance: InsuranceCompliance;
  registration: RegistrationCompliance;
  safety: SafetyCompliance;
}

export interface ExpiringItem {
  type: "INSURANCE" | "REGISTRATION" | "SAFETY_INSPECTION" | "FIRE_EXTINGUISHER" | "FLARES";
  boatId: string;
  boatName: string | null;
  customerId: string;
  customerName: string;
  expiryDate: Date;
  daysUntilExpiry: number;
}

export interface ExpiringComplianceResult {
  insurance: ExpiringItem[];
  registration: ExpiringItem[];
  safetyEquipment: ExpiringItem[];
}

// --------------------------------------------------------------------------
// calculateBoatCompliance
// --------------------------------------------------------------------------

export async function calculateBoatCompliance(
  boatId: string,
  _tenantId: string,
): Promise<BoatComplianceResult> {
  const now = new Date();

  const boat = await prisma.boat.findUnique({
    where: { id: boatId },
    include: {
      insuranceRecords: {
        orderBy: { expiryDate: "desc" },
        take: 1,
      },
      safetyRecords: {
        orderBy: { inspectionDate: "desc" },
        take: 1,
      },
    },
  });

  if (!boat) {
    throw new Error(`Boat ${boatId} not found`);
  }

  // --- Insurance ---
  let insurance: InsuranceCompliance;
  const latestInsurance = boat.insuranceRecords[0];
  if (!latestInsurance) {
    insurance = { status: "MISSING", expiryDate: null, policyNumber: null, insurer: null };
  } else if (
    latestInsurance.expiryDate &&
    latestInsurance.expiryDate < now
  ) {
    insurance = {
      status: "EXPIRED",
      expiryDate: latestInsurance.expiryDate,
      policyNumber: latestInsurance.policyNumber,
      insurer: latestInsurance.insurer,
    };
  } else {
    insurance = {
      status: "VALID",
      expiryDate: latestInsurance.expiryDate,
      policyNumber: latestInsurance.policyNumber,
      insurer: latestInsurance.insurer,
    };
  }

  // --- Registration ---
  let registration: RegistrationCompliance;
  if (!boat.registrationNumber) {
    registration = { status: "MISSING", expiryDate: null, registrationNumber: null };
  } else if (boat.registrationExpiry && boat.registrationExpiry < now) {
    registration = {
      status: "EXPIRED",
      expiryDate: boat.registrationExpiry,
      registrationNumber: boat.registrationNumber,
    };
  } else {
    registration = {
      status: "VALID",
      expiryDate: boat.registrationExpiry,
      registrationNumber: boat.registrationNumber,
    };
  }

  // --- Safety ---
  let safety: SafetyCompliance;
  const latestSafety = boat.safetyRecords[0];
  if (!latestSafety) {
    safety = {
      status: "NO_INSPECTION",
      lastInspection: null,
      nextDueDate: null,
      passFail: null,
      issues: [],
    };
  } else {
    const issues: string[] = [];

    if (latestSafety.fireExtExpiry && latestSafety.fireExtExpiry < now) {
      issues.push("Fire extinguisher expired");
    }
    if (latestSafety.flareExpiry && latestSafety.flareExpiry < now) {
      issues.push("Flares expired");
    }
    if (latestSafety.passFail === "FAIL") {
      issues.push("Last inspection failed");
    }
    if (latestSafety.nextDueDate && latestSafety.nextDueDate < now) {
      issues.push("Safety inspection overdue");
    }
    if (!latestSafety.hasHorn) {
      issues.push("No horn recorded");
    }
    if (!latestSafety.hasThrowable) {
      issues.push("No throwable device recorded");
    }

    safety = {
      status: issues.length > 0 ? "NEEDS_ATTENTION" : "ALL_GOOD",
      lastInspection: latestSafety.inspectionDate,
      nextDueDate: latestSafety.nextDueDate,
      passFail: latestSafety.passFail,
      issues,
    };
  }

  // --- Overall score ---
  let overallScore: ComplianceLevel = "ALL_GOOD";
  if (
    insurance.status === "MISSING" ||
    registration.status === "MISSING" ||
    safety.status === "NO_INSPECTION"
  ) {
    overallScore = "NON_COMPLIANT";
  } else if (
    insurance.status === "EXPIRED" ||
    registration.status === "EXPIRED" ||
    safety.status === "NEEDS_ATTENTION"
  ) {
    overallScore = "ATTENTION_REQUIRED";
  }

  return {
    boatId,
    overallScore,
    insurance,
    registration,
    safety,
  };
}

// --------------------------------------------------------------------------
// getExpiringCompliance
// --------------------------------------------------------------------------

export async function getExpiringCompliance(
  _tenantId: string,
  days: number,
): Promise<ExpiringComplianceResult> {
  const now = new Date();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() + days);

  // Insurance expiring
  const expiringInsurance = await prisma.insuranceRecord.findMany({
    where: {
      expiryDate: { gte: now, lte: cutoff },
    },
    include: {
      boat: true,
      customer: true,
    },
  });

  const insuranceItems: ExpiringItem[] = expiringInsurance.map((r) => ({
    type: "INSURANCE" as const,
    boatId: r.boatId ?? "",
    boatName: r.boat?.name ?? null,
    customerId: r.customerId,
    customerName: `${r.customer.firstName} ${r.customer.lastName}`,
    expiryDate: r.expiryDate!,
    daysUntilExpiry: Math.ceil(
      (r.expiryDate!.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
    ),
  }));

  // Registration expiring
  const expiringRegistration = await prisma.boat.findMany({
    where: {
      registrationExpiry: { gte: now, lte: cutoff },
    },
    include: {
      customer: true,
    },
  });

  const registrationItems: ExpiringItem[] = expiringRegistration.map((b) => ({
    type: "REGISTRATION" as const,
    boatId: b.id,
    boatName: b.name,
    customerId: b.customerId,
    customerName: `${b.customer.firstName} ${b.customer.lastName}`,
    expiryDate: b.registrationExpiry!,
    daysUntilExpiry: Math.ceil(
      (b.registrationExpiry!.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
    ),
  }));

  // Safety equipment expiring (fire ext + flares + next inspection due)
  const expiringSafety = await prisma.vesselSafetyRecord.findMany({
    where: {
      OR: [
        { fireExtExpiry: { gte: now, lte: cutoff } },
        { flareExpiry: { gte: now, lte: cutoff } },
        { nextDueDate: { gte: now, lte: cutoff } },
      ],
    },
    include: {
      boat: {
        include: { customer: true },
      },
    },
  });

  const safetyItems: ExpiringItem[] = [];
  for (const s of expiringSafety) {
    if (s.fireExtExpiry && s.fireExtExpiry >= now && s.fireExtExpiry <= cutoff) {
      safetyItems.push({
        type: "FIRE_EXTINGUISHER",
        boatId: s.boatId,
        boatName: s.boat.name,
        customerId: s.boat.customerId,
        customerName: `${s.boat.customer.firstName} ${s.boat.customer.lastName}`,
        expiryDate: s.fireExtExpiry,
        daysUntilExpiry: Math.ceil(
          (s.fireExtExpiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
        ),
      });
    }
    if (s.flareExpiry && s.flareExpiry >= now && s.flareExpiry <= cutoff) {
      safetyItems.push({
        type: "FLARES",
        boatId: s.boatId,
        boatName: s.boat.name,
        customerId: s.boat.customerId,
        customerName: `${s.boat.customer.firstName} ${s.boat.customer.lastName}`,
        expiryDate: s.flareExpiry,
        daysUntilExpiry: Math.ceil(
          (s.flareExpiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
        ),
      });
    }
    if (s.nextDueDate && s.nextDueDate >= now && s.nextDueDate <= cutoff) {
      safetyItems.push({
        type: "SAFETY_INSPECTION",
        boatId: s.boatId,
        boatName: s.boat.name,
        customerId: s.boat.customerId,
        customerName: `${s.boat.customer.firstName} ${s.boat.customer.lastName}`,
        expiryDate: s.nextDueDate,
        daysUntilExpiry: Math.ceil(
          (s.nextDueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
        ),
      });
    }
  }

  return {
    insurance: insuranceItems,
    registration: registrationItems,
    safetyEquipment: safetyItems,
  };
}
