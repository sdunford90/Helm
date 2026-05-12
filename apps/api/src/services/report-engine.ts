// ─────────────────────────────────────────────────────────────────────────────
// Universal Report Builder — query engine.
//
// Translates a validated ReportSpec into a Prisma query, with hard guardrails:
//
//   • tenant scope is appended server-side and is never optional
//   • only catalog-known scalar fields are accepted
//   • sensitive fields are stripped from the projection regardless of UI state
//   • limit is clamped to a hard maximum
//   • row count is the limit+1 "cheap has-more" check, not a COUNT(*)
//   • relation traversal / group-by / aggregates are deferred (rejected)
//
// The engine returns a structured ReportRunResult that the UI renders. Any
// rejected fields show up as warnings on the result — the query still runs
// with the valid subset, so the user sees partial output instead of a hard
// 400 for a typo'd field.
// ─────────────────────────────────────────────────────────────────────────────

import { createHash } from "node:crypto";
import { prisma } from "../lib/prisma.js";
import {
  getReportCatalog,
  type CatalogField,
  type CatalogModel,
} from "./report-catalog.js";
import type {
  ReportSpec,
  ReportFilter,
  ReportSort,
  ReportRunResult,
  ReportAggregate,
  AggregateFn,
} from "@helm/shared-types";

const HARD_ROW_CAP = 10_000;
const DEFAULT_LIMIT = 100;

// Field names the engine refuses to expose regardless of role. This is a
// belt-and-suspenders alongside the catalog's `sensitive` flag — if either
// rule trips, the field is dropped.
const ENGINE_BLOCKED_FIELDS = new Set([
  "hashedKey",
  "signature",
  "payloadJson",
  "stripeChargeId",
  "stripePaymentIntentId",
  "stripeSubscriptionId",
  "stripeCustomerId",
  "clerkId",
  "webhookSecret",
]);

export class ReportEngineError extends Error {
  constructor(message: string, public readonly statusCode = 400) {
    super(message);
    this.name = "ReportEngineError";
  }
}

// Map our spec ops to Prisma `where` clauses for a single scalar field.
function buildWhereClause(
  field: CatalogField,
  filter: ReportFilter,
): Record<string, unknown> | null {
  // Cast `value` to the right JS type based on the field's Prisma type so
  // numeric filters don't accidentally compare strings.
  const castValue = (v: unknown): unknown => {
    if (v === null || v === undefined) return v;
    if (field.type === "Int" || field.type === "BigInt" || field.type === "Float" || field.type === "Decimal") {
      const n = typeof v === "number" ? v : Number(v);
      return Number.isFinite(n) ? n : v;
    }
    if (field.type === "DateTime") {
      return typeof v === "string" || v instanceof Date ? new Date(v as string) : v;
    }
    if (field.type === "Boolean") {
      return typeof v === "boolean" ? v : String(v).toLowerCase() === "true";
    }
    return v;
  };

  switch (filter.op) {
    case "eq": return { equals: castValue(filter.value) };
    case "ne": return { not: castValue(filter.value) };
    case "lt": return { lt: castValue(filter.value) };
    case "lte": return { lte: castValue(filter.value) };
    case "gt": return { gt: castValue(filter.value) };
    case "gte": return { gte: castValue(filter.value) };
    case "in":
      return Array.isArray(filter.in)
        ? { in: filter.in.map(castValue) }
        : null;
    case "notIn":
      return Array.isArray(filter.in)
        ? { notIn: filter.in.map(castValue) }
        : null;
    case "contains":
      return field.type === "String"
        ? { contains: String(filter.value ?? ""), mode: "insensitive" }
        : null;
    case "startsWith":
      return field.type === "String"
        ? { startsWith: String(filter.value ?? ""), mode: "insensitive" }
        : null;
    case "endsWith":
      return field.type === "String"
        ? { endsWith: String(filter.value ?? ""), mode: "insensitive" }
        : null;
    case "isNull":
      return field.optional ? { equals: null } : null;
    case "isNotNull":
      return field.optional ? { not: null } : null;
    case "between":
      if (!filter.values || filter.values.length !== 2) return null;
      return { gte: castValue(filter.values[0]), lte: castValue(filter.values[1]) };
    default:
      return null;
  }
}

function buildOrderBy(
  model: CatalogModel,
  sorts: ReportSort[] | undefined,
): Array<Record<string, "asc" | "desc">> {
  if (!sorts) return [];
  const scalarFieldNames = new Set(
    model.fields.filter((f) => f.kind === "scalar" || f.kind === "enum").map((f) => f.name),
  );
  return sorts
    .filter((s) => scalarFieldNames.has(s.field))
    .map((s) => ({ [s.field]: s.dir }));
}

// Lowercase the model name to match Prisma's delegate property. Prisma's
// PrismaClient exposes models like `prisma.boat`, `prisma.customer`,
// `prisma.qboWebhookDelivery`. The catalog's model name is the Pascal-cased
// Prisma model name, so a simple first-letter lowercase is the right
// translation in every case our schema uses.
function modelDelegate(modelName: string): unknown {
  const key = modelName[0].toLowerCase() + modelName.slice(1);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const delegate = (prisma as any)[key];
  if (!delegate || typeof delegate.findMany !== "function") return null;
  return delegate;
}

// Stable-ish hash of a spec so two identical runs share a hash even though
// their object identity is different (JSON.stringify with sorted keys).
function hashSpec(spec: ReportSpec): string {
  const sorted = JSON.stringify(spec, Object.keys(spec).sort());
  return createHash("sha256").update(sorted).digest("hex").slice(0, 16);
}

async function writeRunLog(args: {
  tenantId: string;
  userId: string | null;
  spec: ReportSpec;
  result: ReportRunResult | null;
  errorMessage: string | null;
  startedAt: number;
}): Promise<void> {
  try {
    await prisma.insightsRunLog.create({
      data: {
        tenantId: args.tenantId,
        userId: args.userId,
        specHash: hashSpec(args.spec),
        model: args.spec.model,
        rowCount: args.result?.rowCount ?? 0,
        hasMore: args.result?.hasMore ?? false,
        runtimeMs: args.result?.runtimeMs ?? Date.now() - args.startedAt,
        warningCount: args.result?.warnings.length ?? 0,
        errorMessage: args.errorMessage,
        specJson: args.spec as unknown as object,
      },
    });
  } catch {
    // Audit logging is best-effort — never let a logging failure break the
    // user-facing query. The console error already surfaces in stdout.
  }
}

export interface RunOptions {
  /** Caller user id, written to the audit row. */
  userId?: string | null;
  /**
   * R10: when true the engine lets fields tagged `sensitive` in the catalog
   * pass through (Stripe IDs, QBO IDs, PII like DL number). The truly
   * non-negotiable subset (secrets, signatures, raw webhook payloads,
   * Clerk IDs) is still blocked via ENGINE_BLOCKED_FIELDS regardless.
   */
  allowSensitive?: boolean;
}

export async function runReportSpec(
  spec: ReportSpec,
  tenantId: string,
  options: RunOptions = {},
): Promise<ReportRunResult> {
  const startedAt = Date.now();
  const userId = options.userId ?? null;
  try {
    const result = await runReportSpecInternal(spec, tenantId, startedAt, !!options.allowSensitive);
    await writeRunLog({ tenantId, userId, spec, result, errorMessage: null, startedAt });
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await writeRunLog({ tenantId, userId, spec, result: null, errorMessage: message, startedAt });
    throw err;
  }
}

async function runReportSpecInternal(
  spec: ReportSpec,
  tenantId: string,
  startedAt: number,
  allowSensitive: boolean,
): Promise<ReportRunResult> {
  const warnings: string[] = [];

  // ─── Catalog lookup ───────────────────────────────────────────────────────
  const catalog = getReportCatalog();
  const model = catalog.models.find((m) => m.name === spec.model);
  if (!model) {
    throw new ReportEngineError(`Unknown model: ${spec.model}`);
  }
  if (!model.tenantScoped) {
    // Models without a tenantId column (e.g. Tenant itself, ProcessedWebhook)
    // can't be safely exposed through the tenant-facing builder. Punt to a
    // future platform-admin variant.
    throw new ReportEngineError(`Model ${spec.model} is not tenant-scoped and cannot be queried from the tenant builder.`);
  }

  // ─── Filter field map (shared by both code paths) ────────────────────────
  const filterFieldByName = new Map(model.fields.map((f) => [f.name, f]));

  // ─── Build the where clause now so the group-by path can reuse it.
  const whereClauses: Record<string, unknown> = { tenantId };
  for (const filter of spec.filters ?? []) {
    const field = filterFieldByName.get(filter.field);
    if (!field) {
      warnings.push(`Filter on unknown field "${filter.field}" ignored`);
      continue;
    }
    if ((field.sensitive && !allowSensitive) || ENGINE_BLOCKED_FIELDS.has(field.name)) {
      warnings.push(`Filter on sensitive field "${filter.field}" ignored`);
      continue;
    }
    if (field.kind === "relation" || field.kind === "json" || field.isList) {
      warnings.push(`Filter on non-scalar field "${filter.field}" ignored`);
      continue;
    }
    if (filter.field === "tenantId") {
      warnings.push(`Tenant scope cannot be filtered`);
      continue;
    }
    const clause = buildWhereClause(field, filter);
    if (clause === null) {
      warnings.push(`Filter "${filter.field} ${filter.op}" was invalid`);
      continue;
    }
    whereClauses[field.name] = clause;
  }

  // ─── Group-by / aggregate path (R4) ───────────────────────────────────────
  const groupBy = spec.groupBy ?? [];
  const aggregates = spec.aggregates ?? [];
  if (groupBy.length > 0 || aggregates.length > 0) {
    return runGroupedQuery({
      model,
      groupBy,
      aggregates,
      whereClauses,
      allowSensitive,
      sort: spec.sort,
      limit: spec.limit,
      offset: spec.offset,
      startedAt,
      warnings,
    });
  }


  // ─── Field projection ─────────────────────────────────────────────────────
  // Scalar + enum fields only. Drop sensitive, engine-blocked, relation,
  // and json fields. If the caller didn't ask for a specific list, project
  // every safe scalar/enum field.
  //
  // R10: when allowSensitive is on, the catalog's `sensitive` flag is
  // bypassed but ENGINE_BLOCKED_FIELDS is still absolute.
  const safeFields: CatalogField[] = model.fields.filter(
    (f) =>
      (f.kind === "scalar" || f.kind === "enum") &&
      (allowSensitive || !f.sensitive) &&
      !ENGINE_BLOCKED_FIELDS.has(f.name) &&
      !f.isList,
  );
  const safeFieldNames = new Set(safeFields.map((f) => f.name));

  let projectedNames: string[];
  if (spec.fields && spec.fields.length > 0) {
    projectedNames = [];
    for (const name of spec.fields) {
      if (!safeFieldNames.has(name)) {
        const reason =
          !model.fields.some((f) => f.name === name) ? "unknown" :
          model.fields.some((f) => f.name === name && f.sensitive) ? "sensitive" :
          model.fields.some((f) => f.name === name && f.kind === "relation") ? "relation" :
          model.fields.some((f) => f.name === name && f.kind === "json") ? "json" :
          model.fields.some((f) => f.name === name && f.isList) ? "list" :
          "blocked";
        warnings.push(`Field "${name}" dropped (${reason})`);
        continue;
      }
      projectedNames.push(name);
    }
    if (projectedNames.length === 0) {
      // Always project at least the id so the result isn't empty objects.
      const id = safeFields.find((f) => f.isId);
      if (id) projectedNames.push(id.name);
    }
  } else {
    projectedNames = safeFields.map((f) => f.name);
  }

  // ─── Limit + offset ───────────────────────────────────────────────────────
  const requestedLimit = typeof spec.limit === "number" ? spec.limit : DEFAULT_LIMIT;
  const limit = Math.max(1, Math.min(HARD_ROW_CAP, Math.floor(requestedLimit)));
  if (requestedLimit > HARD_ROW_CAP) {
    warnings.push(`Limit clamped from ${requestedLimit} to ${HARD_ROW_CAP}`);
  }
  const offset = Math.max(0, Math.floor(spec.offset ?? 0));

  // ─── Execute ──────────────────────────────────────────────────────────────
  const delegate = modelDelegate(model.name);
  if (!delegate) {
    throw new ReportEngineError(
      `Model ${model.name} is not callable through the Prisma client. This usually means the catalog is ahead of the generated client — run prisma generate.`,
      500,
    );
  }

  const select: Record<string, true> = {};
  for (const name of projectedNames) {
    select[name] = true;
  }

  // Fetch limit+1 rows; trim the tail and set hasMore based on whether the
  // extra row was present. Saves a separate COUNT query for the common case.
  let rows: Array<Record<string, unknown>>;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rows = await (delegate as any).findMany({
      where: whereClauses,
      select,
      orderBy: buildOrderBy(model, spec.sort),
      skip: offset,
      take: limit + 1,
    });
  } catch (err) {
    throw new ReportEngineError(
      `Query failed: ${err instanceof Error ? err.message : String(err)}`,
      500,
    );
  }

  const hasMore = rows.length > limit;
  const trimmed = hasMore ? rows.slice(0, limit) : rows;

  return {
    model: model.name,
    fields: projectedNames,
    rows: trimmed,
    rowCount: trimmed.length,
    hasMore,
    runtimeMs: Date.now() - startedAt,
    warnings,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Group-by / aggregate path (R4).
//
// Uses Prisma's `groupBy` API. The spec's `groupBy` lists the columns to
// partition by; `aggregates` lists the functions to compute on top.
// Examples:
//
//   { groupBy: ["status"], aggregates: [{ fn: "count" }] }
//     → SELECT status, COUNT(*) FROM customers WHERE tenantId=… GROUP BY status
//
//   { groupBy: ["locationId"], aggregates: [
//       { fn: "sum", field: "lengthFt", alias: "totalLength" }
//     ] }
//     → SELECT locationId, SUM(lengthFt) FROM boats WHERE tenantId=… GROUP BY locationId
//
// Returned rows flatten the grouped column values and aggregate aliases
// into a single object so the UI doesn't need to know about Prisma's
// nested _sum/_avg/_count shape.
// ─────────────────────────────────────────────────────────────────────────────

interface GroupedQueryArgs {
  model: CatalogModel;
  groupBy: string[];
  aggregates: ReportAggregate[];
  whereClauses: Record<string, unknown>;
  allowSensitive: boolean;
  sort: ReportSort[] | undefined;
  limit: number | undefined;
  offset: number | undefined;
  startedAt: number;
  warnings: string[];
}

const NUMERIC_TYPES = new Set(["Int", "BigInt", "Float", "Decimal"]);

async function runGroupedQuery(args: GroupedQueryArgs): Promise<ReportRunResult> {
  const { model, groupBy, aggregates, whereClauses, allowSensitive, sort, startedAt, warnings } = args;

  // ─── Validate groupBy fields ─────────────────────────────────────────────
  const fieldByName = new Map(model.fields.map((f) => [f.name, f]));
  const safeGroupBy: string[] = [];
  for (const name of groupBy) {
    const field = fieldByName.get(name);
    if (!field) {
      warnings.push(`Group-by field "${name}" is unknown — ignored`);
      continue;
    }
    if (field.kind === "relation" || field.kind === "json" || field.isList) {
      warnings.push(`Group-by field "${name}" is non-scalar — ignored`);
      continue;
    }
    if ((field.sensitive && !allowSensitive) || ENGINE_BLOCKED_FIELDS.has(field.name)) {
      warnings.push(`Group-by field "${name}" is sensitive — ignored`);
      continue;
    }
    safeGroupBy.push(name);
  }

  // ─── Validate aggregates ─────────────────────────────────────────────────
  // Bucket by Prisma's _count / _sum / _avg / _min / _max shape. Each
  // aggregate also gets an alias for the result row.
  const buckets: Record<AggregateFn, Record<string, true>> = {
    count: {}, sum: {}, avg: {}, min: {}, max: {},
  };
  const aliases: Array<{ alias: string; fn: AggregateFn; field: string }> = [];

  for (const agg of aggregates) {
    if (agg.fn === "count") {
      const field = agg.field ?? "_all";
      // Validate the field exists if it's not the synthetic _all
      if (field !== "_all") {
        const f = fieldByName.get(field);
        if (!f || f.kind === "relation" || f.kind === "json" || f.isList) {
          warnings.push(`Aggregate count("${field}") field is not scalar — ignored`);
          continue;
        }
      }
      buckets.count[field] = true;
      aliases.push({ alias: agg.alias ?? `count_${field}`, fn: "count", field });
      continue;
    }
    // sum / avg / min / max need a numeric field
    const fieldName = agg.field;
    if (!fieldName) {
      warnings.push(`Aggregate ${agg.fn} needs a field — ignored`);
      continue;
    }
    const f = fieldByName.get(fieldName);
    if (!f) {
      warnings.push(`Aggregate ${agg.fn}("${fieldName}") unknown field — ignored`);
      continue;
    }
    if (!NUMERIC_TYPES.has(f.type)) {
      warnings.push(`Aggregate ${agg.fn}("${fieldName}") needs a numeric field — ignored`);
      continue;
    }
    if ((f.sensitive && !allowSensitive) || ENGINE_BLOCKED_FIELDS.has(f.name)) {
      warnings.push(`Aggregate on sensitive field "${fieldName}" ignored`);
      continue;
    }
    buckets[agg.fn][fieldName] = true;
    aliases.push({ alias: agg.alias ?? `${agg.fn}_${fieldName}`, fn: agg.fn, field: fieldName });
  }

  if (safeGroupBy.length === 0 && aliases.length === 0) {
    throw new ReportEngineError(
      "Group-by query had no valid groupBy fields or aggregates after validation",
    );
  }

  // ─── Order-by: only scalar group-by fields and aggregate aliases work ────
  const orderBy: Array<Record<string, "asc" | "desc">> = [];
  for (const s of sort ?? []) {
    if (safeGroupBy.includes(s.field)) {
      orderBy.push({ [s.field]: s.dir });
      continue;
    }
    // Prisma's groupBy supports orderBy on _count etc. but the API surface
    // is awkward and our UI doesn't need it yet — drop sort on aggregates
    // with a warning.
    warnings.push(`Sort on "${s.field}" ignored (only group-by columns are sortable today)`);
  }

  // ─── Limit + offset ──────────────────────────────────────────────────────
  const requestedLimit = typeof args.limit === "number" ? args.limit : DEFAULT_LIMIT;
  const limit = Math.max(1, Math.min(HARD_ROW_CAP, Math.floor(requestedLimit)));
  if (requestedLimit > HARD_ROW_CAP) {
    warnings.push(`Limit clamped from ${requestedLimit} to ${HARD_ROW_CAP}`);
  }
  const offset = Math.max(0, Math.floor(args.offset ?? 0));

  // ─── Execute ─────────────────────────────────────────────────────────────
  const delegate = modelDelegate(model.name);
  if (!delegate) {
    throw new ReportEngineError(
      `Model ${model.name} is not callable through the Prisma client.`,
      500,
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const groupByArgs: any = {
    by: safeGroupBy.length > 0 ? safeGroupBy : ["tenantId"],
    where: whereClauses,
    take: limit + 1,
    skip: offset,
  };
  if (orderBy.length > 0) groupByArgs.orderBy = orderBy;
  if (Object.keys(buckets.count).length > 0) groupByArgs._count = buckets.count;
  if (Object.keys(buckets.sum).length > 0) groupByArgs._sum = buckets.sum;
  if (Object.keys(buckets.avg).length > 0) groupByArgs._avg = buckets.avg;
  if (Object.keys(buckets.min).length > 0) groupByArgs._min = buckets.min;
  if (Object.keys(buckets.max).length > 0) groupByArgs._max = buckets.max;

  let raw: Array<Record<string, unknown>>;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    raw = await (delegate as any).groupBy(groupByArgs);
  } catch (err) {
    throw new ReportEngineError(
      `Group-by query failed: ${err instanceof Error ? err.message : String(err)}`,
      500,
    );
  }

  // ─── Flatten the result rows ─────────────────────────────────────────────
  // Prisma returns each row with the by-columns at the top level plus
  // nested _count/_sum/etc. objects. The UI just wants a flat key/value map.
  const fields = [...safeGroupBy, ...aliases.map((a) => a.alias)];
  const hasMore = raw.length > limit;
  const trimmed = hasMore ? raw.slice(0, limit) : raw;
  const flatRows: Array<Record<string, unknown>> = trimmed.map((row) => {
    const out: Record<string, unknown> = {};
    for (const g of safeGroupBy) out[g] = row[g];
    for (const a of aliases) {
      const bucket = row[`_${a.fn}`] as Record<string, unknown> | undefined;
      // For count("_all") Prisma puts the value under bucket["_all"];
      // for count("<field>") it's nested similarly.
      out[a.alias] = bucket ? bucket[a.field] ?? null : null;
    }
    return out;
  });

  return {
    model: model.name,
    fields,
    rows: flatRows,
    rowCount: flatRows.length,
    hasMore,
    runtimeMs: Date.now() - startedAt,
    warnings,
  };
}
