import { Prisma, PrismaClient } from "@prisma/client";
import { AsyncLocalStorage } from "node:async_hooks";

// --------------------------------------------------------------------------
// Async-local storage to propagate tenantId through the request lifecycle
// --------------------------------------------------------------------------
export interface TenantContext {
  tenantId: string;
}

export const tenantStore = new AsyncLocalStorage<TenantContext>();

// --------------------------------------------------------------------------
// Tenant-scoped models, derived from the Prisma schema (DMMF): every model
// that has a `tenantId` field. This replaces a hand-maintained list that had
// drifted (it missed SlipContract, GlEntry, GlAccount, PromoCode,
// SecurityDeposit, InsuranceRecord, ApiKey, MeterReading, … and listed
// models with no tenantId column such as PricingRule, which made Prisma throw).
// --------------------------------------------------------------------------

interface DmmfModelLike {
  name: string;
  fields: readonly { name: string }[];
}

export function buildTenantScopedModels(models: readonly DmmfModelLike[]): ReadonlySet<string> {
  return new Set(models.filter((m) => m.fields.some((f) => f.name === "tenantId")).map((m) => m.name));
}

export const TENANT_SCOPED_MODELS: ReadonlySet<string> = buildTenantScopedModels(
  Prisma.dmmf.datamodel.models,
);

export class TenantScopeError extends Error {
  readonly statusCode = 403;
  readonly code = "TENANT_SCOPE_VIOLATION";
  constructor(message: string) {
    super(message);
    this.name = "TenantScopeError";
  }
}

// --------------------------------------------------------------------------
// Argument rewriting (pure; unit-tested)
//
// KNOWN GAPS — this is app-layer scoping only; Postgres RLS lands in Phase 1:
//   * $queryRaw / $queryRawUnsafe / $executeRaw* bypass this entirely. Raw SQL
//     must filter on tenant_id by hand.
//   * Nested writes/reads (relation `create`/`connectOrCreate`/`update`
//     inside `data`, `include`/`select` filters) are NOT rewritten; only the
//     top-level `where`/`data` are. Nested reads are safe only because the
//     parent row is already tenant-bound; nested `connect` by id is not
//     checked.
//   * With NO tenant context (workers/jobs, /api/admin, signature-verified
//     webhooks, OAuth callbacks) queries pass through unscoped and must filter
//     by tenantId explicitly. Wrap tenant work in tenantStore.run().
// --------------------------------------------------------------------------

type Args = Record<string, unknown>;

const WHERE_OPS = new Set([
  "findUnique",
  "findUniqueOrThrow",
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
  "update",
  "updateMany",
  "updateManyAndReturn",
  "delete",
  "deleteMany",
  "upsert",
]);

const CREATE_DATA_OPS = new Set(["create", "createMany", "createManyAndReturn"]);
const UPDATE_DATA_OPS = new Set(["update", "updateMany", "updateManyAndReturn"]);

function isObject(v: unknown): v is Args {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Add the context tenant to a `where`. Never silently overwrite a different
 * tenant the caller asked for (that is how the BI API used to leak): a
 * conflicting literal tenantId throws; a tenantId filter object is kept and
 * the context tenant is AND-ed on top.
 *
 * findUnique/findUniqueOrThrow/update/delete/upsert take a WhereUniqueInput;
 * since Prisma 5 (extendedWhereUnique, GA) non-unique fields such as tenantId
 * and AND are allowed next to the unique field, so this is valid for them.
 */
function scopeWhere(model: string, where: unknown, tenantId: string): Args {
  const w: Args = isObject(where) ? { ...where } : {};
  const requested = w.tenantId;

  if (requested === undefined) {
    w.tenantId = tenantId;
    return w;
  }
  if (typeof requested === "string") {
    if (requested !== tenantId) {
      throw new TenantScopeError(`${model}: query for another tenant rejected`);
    }
    return w;
  }
  const and = w.AND === undefined ? [] : Array.isArray(w.AND) ? w.AND : [w.AND];
  w.AND = [...and, { tenantId }];
  return w;
}

/** Stamp the context tenant on a create payload; reject a different one. */
function scopeCreateData(model: string, data: unknown, tenantId: string): Args {
  const d: Args = isObject(data) ? { ...data } : {};

  // Relation form: `tenant: { connect: { id } }` — can't be mixed with the
  // scalar tenantId, so validate it instead.
  if (isObject(d.tenant)) {
    const connectId = isObject(d.tenant.connect) ? d.tenant.connect.id : undefined;
    if (connectId !== tenantId) {
      throw new TenantScopeError(`${model}: create for another tenant rejected`);
    }
    return d;
  }

  if (d.tenantId !== undefined && d.tenantId !== tenantId) {
    throw new TenantScopeError(`${model}: create for another tenant rejected`);
  }
  d.tenantId = tenantId;
  return d;
}

/** Updates may not move a row to another tenant. */
function checkUpdateData(model: string, data: unknown, tenantId: string): void {
  if (!isObject(data)) return;
  const t = data.tenantId;
  if (t === undefined) return;
  const value = isObject(t) ? t.set : t;
  if (value !== tenantId) {
    throw new TenantScopeError(`${model}: changing tenantId is not allowed`);
  }
}

/**
 * Rewrite Prisma operation args so they are confined to `tenantId`.
 * Returns the args unchanged for models without a tenantId column.
 */
export function scopeQueryArgs(model: string, operation: string, args: unknown, tenantId: string): Args {
  const a: Args = isObject(args) ? { ...args } : {};
  if (!TENANT_SCOPED_MODELS.has(model)) return a;

  if (WHERE_OPS.has(operation)) {
    a.where = scopeWhere(model, a.where, tenantId);
  }

  if (CREATE_DATA_OPS.has(operation)) {
    a.data = Array.isArray(a.data)
      ? a.data.map((d) => scopeCreateData(model, d, tenantId))
      : scopeCreateData(model, a.data, tenantId);
  }

  if (UPDATE_DATA_OPS.has(operation)) {
    checkUpdateData(model, a.data, tenantId);
  }

  if (operation === "upsert") {
    a.create = scopeCreateData(model, a.create, tenantId);
    checkUpdateData(model, a.update, tenantId);
  }

  return a;
}

// --------------------------------------------------------------------------
// Singleton PrismaClient with tenant-scoped query enforcement via $extends
// --------------------------------------------------------------------------

function createPrismaClient() {
  const base = new PrismaClient({
    log: ["warn", "error"],
  });

  return base.$extends({
    query: {
      $allModels: {
        async $allOperations({
          model,
          operation,
          args,
          query,
        }: {
          model: string;
          operation: string;
          args: Record<string, unknown>;
          query: (args: Record<string, unknown>) => Promise<unknown>;
        }) {
          const ctx = tenantStore.getStore();

          // No tenant context, or model not scoped — pass through untouched
          if (!ctx?.tenantId || !TENANT_SCOPED_MODELS.has(model)) {
            return query(args);
          }

          return query(scopeQueryArgs(model, operation, args, ctx.tenantId));
        },
      },
    },
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const globalForPrisma = globalThis as unknown as { prisma: any };

export const prisma: ReturnType<typeof createPrismaClient> =
  globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
