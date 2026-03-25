import { PrismaClient } from "@prisma/client";
import { AsyncLocalStorage } from "node:async_hooks";

// --------------------------------------------------------------------------
// Async-local storage to propagate tenantId through the request lifecycle
// --------------------------------------------------------------------------
export interface TenantContext {
  tenantId: string;
}

export const tenantStore = new AsyncLocalStorage<TenantContext>();

// --------------------------------------------------------------------------
// Singleton PrismaClient with tenant-scoped query enforcement
// --------------------------------------------------------------------------

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined };

function createPrismaClient(): PrismaClient {
  const client = new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? ["query", "warn", "error"]
        : ["warn", "error"],
  });

  // Middleware: automatically scope every query to the current tenant when a
  // tenantId is present in the async-local store.  Models that don't carry a
  // tenant_id column (e.g. system-level tables) are skipped gracefully by the
  // database — Prisma will simply ignore unknown `where` fields at runtime
  // when using raw queries, and the generated client will raise a type error
  // at compile time so those cases must be handled explicitly below.
  client.$use(async (params, next) => {
    const ctx = tenantStore.getStore();
    if (!ctx?.tenantId) {
      return next(params);
    }

    const tenantId = ctx.tenantId;

    // Models that are tenant-scoped.  If a model is NOT in this set the
    // middleware passes through without modification — system tables like
    // `processed_webhooks` are handled explicitly in their own service layer.
    const tenantScopedModels = new Set([
      "Slip",
      "Customer",
      "Invoice",
      "Payment",
      "Lead",
      "LeadForm",
      "WaitlistEntry",
      "Boat",
      "DockWalk",
      "DockWalkItem",
      "PumpOut",
      "POSTransaction",
      "Rental",
      "Announcement",
      "AnnouncementDelivery",
      "User",
    ]);

    if (!params.model || !tenantScopedModels.has(params.model)) {
      return next(params);
    }

    // Inject tenant_id into reads
    if (
      params.action === "findUnique" ||
      params.action === "findFirst" ||
      params.action === "findMany" ||
      params.action === "count" ||
      params.action === "aggregate" ||
      params.action === "groupBy"
    ) {
      params.args = params.args ?? {};
      params.args.where = { ...params.args.where, tenant_id: tenantId };
    }

    // Inject tenant_id into writes
    if (params.action === "create") {
      params.args = params.args ?? {};
      params.args.data = { ...params.args.data, tenant_id: tenantId };
    }

    if (params.action === "createMany") {
      params.args = params.args ?? {};
      if (Array.isArray(params.args.data)) {
        params.args.data = params.args.data.map((d: Record<string, unknown>) => ({
          ...d,
          tenant_id: tenantId,
        }));
      } else {
        params.args.data = { ...params.args.data, tenant_id: tenantId };
      }
    }

    if (params.action === "update" || params.action === "updateMany") {
      params.args = params.args ?? {};
      params.args.where = { ...params.args.where, tenant_id: tenantId };
    }

    if (params.action === "delete" || params.action === "deleteMany") {
      params.args = params.args ?? {};
      params.args.where = { ...params.args.where, tenant_id: tenantId };
    }

    if (params.action === "upsert") {
      params.args = params.args ?? {};
      params.args.where = { ...params.args.where, tenant_id: tenantId };
      params.args.create = { ...params.args.create, tenant_id: tenantId };
    }

    return next(params);
  });

  return client;
}

export const prisma: PrismaClient = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
