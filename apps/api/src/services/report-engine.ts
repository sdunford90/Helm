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

export async function runReportSpec(
  spec: ReportSpec,
  tenantId: string,
): Promise<ReportRunResult> {
  const warnings: string[] = [];
  const startedAt = Date.now();

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

  // ─── Deferred feature checks ──────────────────────────────────────────────
  if (spec.groupBy && spec.groupBy.length > 0) {
    throw new ReportEngineError("group-by queries are not supported yet");
  }
  if (spec.aggregates && spec.aggregates.length > 0) {
    throw new ReportEngineError("aggregate queries are not supported yet");
  }

  // ─── Field projection ─────────────────────────────────────────────────────
  // Scalar + enum fields only. Drop sensitive, engine-blocked, relation,
  // and json fields. If the caller didn't ask for a specific list, project
  // every safe scalar/enum field.
  const safeFields: CatalogField[] = model.fields.filter(
    (f) =>
      (f.kind === "scalar" || f.kind === "enum") &&
      !f.sensitive &&
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

  // ─── Filters ──────────────────────────────────────────────────────────────
  const filterFieldByName = new Map(model.fields.map((f) => [f.name, f]));
  const whereClauses: Record<string, unknown> = {
    // Tenant scope, hardcoded — non-overridable.
    tenantId,
  };
  for (const filter of spec.filters ?? []) {
    const field = filterFieldByName.get(filter.field);
    if (!field) {
      warnings.push(`Filter on unknown field "${filter.field}" ignored`);
      continue;
    }
    if (field.sensitive || ENGINE_BLOCKED_FIELDS.has(field.name)) {
      warnings.push(`Filter on sensitive field "${filter.field}" ignored`);
      continue;
    }
    if (field.kind === "relation" || field.kind === "json" || field.isList) {
      warnings.push(`Filter on non-scalar field "${filter.field}" ignored`);
      continue;
    }
    if (filter.field === "tenantId") {
      // Never let the caller widen or narrow tenant scope via filters.
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
