/** Type of report. */
export type ReportType =
  | 'OCCUPANCY'
  | 'REVENUE'
  | 'AGING'
  | 'COLLECTIONS'
  | 'CUSTOMER_ACTIVITY'
  | 'RENTAL_UTILIZATION'
  | 'POS_SALES'
  | 'GL_SUMMARY'
  | 'CUSTOM';

/** Format for report output. */
export type ReportFormat = 'PDF' | 'CSV' | 'XLSX' | 'JSON';

/** A saved / generated report definition. */
export interface Report {
  id: string;
  tenantId: string;
  /** Report name / title. */
  name: string;
  /** Report type. */
  type: ReportType;
  /** Report parameters and filters as JSON. */
  parametersJson: Record<string, unknown>;
  /** Output format. */
  format: ReportFormat;
  /** Cron schedule for recurring reports (null = one-time). */
  schedule: string | null;
  /** Email addresses to send the report to. */
  recipients: string[];
  /** URL of the last generated report file. */
  lastGeneratedUrl: string | null;
  /** Timestamp of the last generation. */
  lastGeneratedAt: string | null;
  /** ID of the staff member who created the report. */
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

/** A dashboard card / widget configuration. */
export interface DashboardCard {
  id: string;
  tenantId: string;
  /** Card title. */
  title: string;
  /** Type of visualization (e.g. "KPI", "BAR_CHART", "LINE_CHART", "TABLE", "PIE_CHART"). */
  chartType: string;
  /** Data source query or configuration as JSON. */
  dataSourceJson: Record<string, unknown>;
  /** Position in the dashboard grid (row). */
  gridRow: number;
  /** Position in the dashboard grid (column). */
  gridCol: number;
  /** Width in grid units. */
  gridWidth: number;
  /** Height in grid units. */
  gridHeight: number;
  /** Refresh interval in seconds (0 = manual only). */
  refreshIntervalSec: number;
  /** ID of the user this card belongs to (null = shared). */
  userId: string | null;
  createdAt: string;
  updatedAt: string;
}

/** An API key for external integrations. */
export interface ApiKey {
  id: string;
  tenantId: string;
  /** Display name for the key. */
  name: string;
  /** The hashed API key (the raw key is only shown once at creation). */
  keyHash: string;
  /** Key prefix for identification (e.g. "hk_live_abc..."). */
  keyPrefix: string;
  /** Scopes / permissions granted to this key. */
  scopes: string[];
  /** Timestamp when the key expires (null = no expiration). */
  expiresAt: string | null;
  /** Timestamp of the last time this key was used. */
  lastUsedAt: string | null;
  /** Whether the key is currently active. */
  active: boolean;
  /** ID of the user who created the key. */
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}
