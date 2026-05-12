/**
 * Universal Report Builder — query spec types.
 *
 * The builder UI emits a ReportSpec object; the server-side report engine
 * validates it against the catalog and translates it to a safe Prisma query.
 * Tenant scope is always appended by the engine and is never part of the spec.
 *
 * MVP scope: scalar fields on a single model, scalar-typed filters, sort,
 * limit. Relation traversal, aggregations, and group-by are stubs for now —
 * defined here so the spec is future-proof, but the engine will reject them
 * with "not yet supported" until the next phase.
 */

export type ReportFilterOp =
  | 'eq'
  | 'ne'
  | 'lt'
  | 'lte'
  | 'gt'
  | 'gte'
  | 'in'
  | 'notIn'
  | 'contains'
  | 'startsWith'
  | 'endsWith'
  | 'isNull'
  | 'isNotNull'
  | 'between';

export interface ReportFilter {
  /** Field name on the base model. Relation traversal (dotted paths) deferred to a later phase. */
  field: string;
  op: ReportFilterOp;
  /** Single value for unary/binary ops. Required except for isNull / isNotNull. */
  value?: string | number | boolean | null;
  /** Two values for `between` (inclusive). */
  values?: [string | number, string | number];
  /** Array of values for `in` / `notIn`. */
  in?: Array<string | number>;
}

export interface ReportSort {
  field: string;
  dir: 'asc' | 'desc';
}

export type AggregateFn = 'count' | 'sum' | 'avg' | 'min' | 'max';

export interface ReportAggregate {
  fn: AggregateFn;
  field?: string;
  alias?: string;
}

export interface ReportSpec {
  /** Catalog model name, e.g. "Boat" or "Customer". */
  model: string;
  /**
   * Scalar field names to project. Empty/omitted means "all scalar fields".
   * The engine drops any field flagged sensitive in the catalog.
   */
  fields?: string[];
  filters?: ReportFilter[];
  sort?: ReportSort[];
  /** Hard cap, default 100, max 10_000 enforced server-side. */
  limit?: number;
  /** Offset for pagination. Default 0. */
  offset?: number;
  /** Deferred — engine returns 400 if non-empty in the MVP. */
  groupBy?: string[];
  aggregates?: ReportAggregate[];
}

export interface ReportRunResult {
  model: string;
  /** Fields actually returned (post-permission filtering). */
  fields: string[];
  /** Rows as objects keyed by selected field name. */
  rows: Array<Record<string, unknown>>;
  /** Total row count for the *unbounded* query (capped at limit+1 for cheap "has more" detection). */
  rowCount: number;
  /** True if there are more rows than `rows.length`. */
  hasMore: boolean;
  /** Runtime in ms. */
  runtimeMs: number;
  /** Warnings — e.g. dropped sensitive fields, requested-but-unknown fields. */
  warnings: string[];
}
