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
// Models that carry a tenant_id column and must be auto-scoped
// --------------------------------------------------------------------------
const TENANT_SCOPED_MODELS = new Set([
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
  "Product",
  "PosTransaction",
  "PosLineItem",
  "Inventory",
  "Shift",
  "PurchaseOrder",
  "Rental",
  "RentalProduct",
  "PricingRule",
  "PricingCalendarOverride",
  "DemandSurgeTier",
  "AlgorithmicSuggestion",
  "Reservation",
  "CancellationPolicy",
  "CancellationRule",
  "Announcement",
  "AnnouncementDelivery",
  "User",
]);

// --------------------------------------------------------------------------
// Factory — returns an extended PrismaClient with tenant-scoped query hooks
// --------------------------------------------------------------------------
function createPrismaClient() {
  const base = new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? ["warn", "error"]
        : ["warn", "error"],
  });

  return base.$extends({
    query: {
      $allModels: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async $allOperations({ model, operation, args, query }: any) {
          const ctx = tenantStore.getStore();

          if (!ctx?.tenantId || !model || !TENANT_SCOPED_MODELS.has(model)) {
            return query(args);
          }

          const tenantId = ctx.tenantId;
          // Clone args so we don't mutate the caller's object
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const a: any = { ...args };

          if (
            operation === "findUnique" ||
            operation === "findFirst" ||
            operation === "findMany" ||
            operation === "count" ||
            operation === "aggregate" ||
            operation === "groupBy"
          ) {
            a.where = { ...a.where, tenant_id: tenantId };
          }

          if (operation === "create") {
            a.data = { ...a.data, tenant_id: tenantId };
          }

          if (operation === "createMany") {
            if (Array.isArray(a.data)) {
              a.data = a.data.map((d: Record<string, unknown>) => ({
                ...d,
                tenant_id: tenantId,
              }));
            } else {
              a.data = { ...a.data, tenant_id: tenantId };
            }
          }

          if (operation === "update" || operation === "updateMany") {
            a.where = { ...a.where, tenant_id: tenantId };
          }

          if (operation === "delete" || operation === "deleteMany") {
            a.where = { ...a.where, tenant_id: tenantId };
          }

          if (operation === "upsert") {
            a.where = { ...a.where, tenant_id: tenantId };
            a.create = { ...a.create, tenant_id: tenantId };
          }

          return query(a);
        },
      },
    },
  });
}

// --------------------------------------------------------------------------
// Singleton — reuse the same client across hot-reloads in development
// --------------------------------------------------------------------------
type PrismaClientSingleton = ReturnType<typeof createPrismaClient>;

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClientSingleton | undefined;
};

export const prisma: PrismaClientSingleton =
  globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
