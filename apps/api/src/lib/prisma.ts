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
// Models that carry a tenantId column and must be scoped per request.
// System-level tables (e.g. Tenant, SaasTier, Location) are excluded.
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
  "VesselSafetyRecord",
  "DockWalk",
  // NOTE: DockWalkItem is intentionally NOT tenant-scoped here — the
  // model has no `tenantId` column. It inherits tenancy through its
  // parent DockWalk; call sites filter via `dockWalk: { tenantId }`
  // (or via slip/contracts). Adding it back would auto-inject an
  // unknown `tenantId` argument and crash every read.
  "PumpOut",
  "POSTransaction",
  "PosTransaction",
  "PosLineItem",
  "Product",
  "ProductCategory",
  "Inventory",
  "Shift",
  "PurchaseOrder",
  "Rental",
  "RentalProduct",
  "Reservation",
  "RentalTimeSlot",
  "CancellationPolicy",
  "Announcement",
  // NOTE: AnnouncementDelivery is intentionally NOT tenant-scoped —
  // the model has no `tenantId` column. It inherits tenancy through
  // its parent Announcement; call sites filter via
  // `announcement: { tenantId }`.
  "User",
  "RampTicket",
  "FuelDispense",
  "TransientBooking",
  "ConciergeRequest",
  "Contract",
  "AuditLog",
  "Vendor",
  "QboInventorySyncRef",
  "PoLineItem",
  "InventoryAdjustment",
  "InventoryCountSession",
  "CustomerDocument",
  "CardExpiryReminder",
  "PaymentRefund",
]);

// --------------------------------------------------------------------------
// Singleton PrismaClient with tenant-scoped query enforcement via $extends
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

          const tenantId = ctx.tenantId;
          const a = { ...(args ?? {}) } as Record<string, unknown>;

          // ── Read operations: inject tenantId into where ──────────────────
          if (
            operation === "findUnique" ||
            operation === "findUniqueOrThrow" ||
            operation === "findFirst" ||
            operation === "findFirstOrThrow" ||
            operation === "findMany" ||
            operation === "count" ||
            operation === "aggregate" ||
            operation === "groupBy"
          ) {
            a.where = { ...(a.where as object | undefined), tenantId };
          }

          // ── Create: inject tenantId into data ────────────────────────────
          if (operation === "create") {
            a.data = { ...(a.data as object | undefined), tenantId };
          }

          if (operation === "createMany") {
            if (Array.isArray(a.data)) {
              a.data = (a.data as Record<string, unknown>[]).map((d) => ({
                ...d,
                tenantId,
              }));
            } else {
              a.data = { ...(a.data as object | undefined), tenantId };
            }
          }

          // ── Update / delete: scope where ─────────────────────────────────
          if (
            operation === "update" ||
            operation === "updateMany" ||
            operation === "delete" ||
            operation === "deleteMany"
          ) {
            a.where = { ...(a.where as object | undefined), tenantId };
          }

          if (operation === "upsert") {
            a.where = { ...(a.where as object | undefined), tenantId };
            a.create = { ...(a.create as object | undefined), tenantId };
          }

          return query(a);
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
