/** A dock walk inspection round. */
export interface DockWalk {
  id: string;
  tenantId: string;
  /** Staff member who performed the walk. */
  performedBy: string;
  /** Timestamp when the walk started. */
  startedAt: string;
  /** Timestamp when the walk was completed. */
  completedAt: string | null;
  /** Current status. */
  status: 'IN_PROGRESS' | 'COMPLETED';
  /** General notes about the walk. */
  notes: string | null;
  /** Number of items flagged during the walk. */
  flaggedCount: number;
  /** Total number of slips checked. */
  totalChecked: number;
  createdAt: string;
}

/** An individual item observed during a dock walk. */
export interface DockWalkItem {
  id: string;
  dockWalkId: string;
  /** The slip inspected. */
  slipId: string;
  /** Whether the vessel was present in the slip. */
  vesselPresent: boolean;
  /** Whether any issues were flagged. */
  flagged: boolean;
  /** Category of the issue, if flagged. */
  issueCategory: string | null;
  /** Description of the issue. */
  issueDescription: string | null;
  /** Severity level. */
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' | null;
  /** URL or path to a photo taken during the inspection. */
  photoUrl: string | null;
  /** Whether the issue has been resolved. */
  resolved: boolean;
  /** Timestamp when the issue was resolved. */
  resolvedAt: string | null;
  createdAt: string;
}

/** A pump-out service record. */
export interface PumpOut {
  id: string;
  tenantId: string;
  /** The slip where the pump-out was performed. */
  slipId: string;
  /** The boat that received the pump-out. */
  boatId: string;
  /** Staff member who performed the service. */
  performedBy: string;
  /** Timestamp of the pump-out. */
  performedAt: string;
  /** Gallons pumped. */
  gallons: number | null;
  /** Fee charged in cents (0 if complimentary). */
  feeCents: number;
  /** Notes about the service. */
  notes: string | null;
  createdAt: string;
}
