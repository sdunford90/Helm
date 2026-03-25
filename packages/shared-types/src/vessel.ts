/** Overall compliance score for a vessel. */
export type ComplianceScore = 'ALL_GOOD' | 'ATTENTION_REQUIRED' | 'NON_COMPLIANT';

/** A boat / vessel registered at the marina. */
export interface Boat {
  id: string;
  tenantId: string;
  /** Owner (customer) of the vessel. */
  customerId: string;
  /** Vessel name. */
  name: string;
  /** Make / manufacturer. */
  make: string | null;
  /** Model. */
  model: string | null;
  /** Year built / model year. */
  year: number | null;
  /** Length overall in feet. */
  lengthFt: number;
  /** Beam (width) in feet. */
  beamFt: number;
  /** Draft in feet. */
  draftFt: number;
  /** Registration / documentation number. */
  registrationNumber: string | null;
  /** Hull identification number. */
  hullId: string | null;
  /** Vessel type (e.g. "Sailboat", "Powerboat", "Catamaran"). */
  vesselType: string;
  /** Fuel type (e.g. "Gasoline", "Diesel", "Electric"). */
  fuelType: string | null;
  /** Current compliance score based on safety and insurance records. */
  complianceScore: ComplianceScore;
  /** URL or path to the vessel photo. */
  photoUrl: string | null;
  /** Additional notes. */
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A safety inspection record for a vessel. */
export interface VesselSafetyRecord {
  id: string;
  tenantId: string;
  /** The vessel this record is for. */
  boatId: string;
  /** Type of inspection (e.g. "USCG", "Fire Extinguisher", "Annual"). */
  inspectionType: string;
  /** Date of the inspection (ISO date string). */
  inspectionDate: string;
  /** Date the inspection expires (ISO date string). */
  expirationDate: string | null;
  /** Whether the vessel passed the inspection. */
  passed: boolean;
  /** Inspector name or authority. */
  inspector: string | null;
  /** Findings or notes from the inspection. */
  findings: string | null;
  /** URL or path to the inspection document. */
  documentUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

/** An insurance policy record for a vessel. */
export interface InsuranceRecord {
  id: string;
  tenantId: string;
  /** The vessel this insurance covers. */
  boatId: string;
  /** Insurance provider / carrier name. */
  provider: string;
  /** Policy number. */
  policyNumber: string;
  /** Policy effective start date (ISO date string). */
  effectiveDate: string;
  /** Policy expiration date (ISO date string). */
  expirationDate: string;
  /** Whether the policy is currently verified as active. */
  verified: boolean;
  /** Coverage details as JSON. */
  coverageJson: {
    /** Liability coverage limit in cents. */
    liabilityCents: number;
    /** Hull / property coverage limit in cents. */
    hullCents: number;
    /** Whether pollution / environmental coverage is included. */
    pollutionCoverage: boolean;
    /** Whether salvage / wreck removal coverage is included. */
    salvageCoverage: boolean;
    /** Deductible amount in cents. */
    deductibleCents: number;
  };
  /** URL or path to the insurance certificate document. */
  certificateUrl: string | null;
  createdAt: string;
  updatedAt: string;
}
