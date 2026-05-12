import type { PrismaClient } from "@prisma/client";

export type LocationLike = {
  id: string;
  tenantId: string;
  createdAt: Date;
};

export type ProductLike = {
  id: string;
  tenantId: string;
  locationId: string | null;
};

/**
 * Per-tenant primary-location selection rule for the Task #340 backfill.
 *
 * The Location model has no primary/default boolean today, so the rule is
 * strictly: pick the OLDEST location by createdAt for the tenant, with a
 * deterministic id tie-break. This must match the SQL in
 * `apps/api/prisma/migrations/20260512000000_backfill_product_location`
 * exactly so the runtime verifier and the migration agree.
 */
export function selectPrimaryLocationByTenant(
  locations: ReadonlyArray<LocationLike>,
): Map<string, LocationLike> {
  const byTenant = new Map<string, LocationLike>();
  for (const loc of locations) {
    const current = byTenant.get(loc.tenantId);
    if (!current) {
      byTenant.set(loc.tenantId, loc);
      continue;
    }
    const olderByCreatedAt = loc.createdAt.getTime() < current.createdAt.getTime();
    const sameAgeOlderId =
      loc.createdAt.getTime() === current.createdAt.getTime() && loc.id < current.id;
    if (olderByCreatedAt || sameAgeOlderId) {
      byTenant.set(loc.tenantId, loc);
    }
  }
  return byTenant;
}

export type BackfillVerifyResult = {
  ok: boolean;
  unassignedCount: number;
  perTenantUnassigned: Array<{ tenantId: string | null; count: number }>;
};

/**
 * Verify the post-backfill invariant for Task #340: no Product may have
 * `locationId === null` after deploy. We deliberately do NOT assert that
 * every product matches its tenant's primary location — operators are
 * free to (re)assign products to any active location later, and a
 * stricter check would create false alarms during normal usage.
 *
 * Pure / synchronous on purpose — the migration runs raw SQL, so this
 * helper is what the post-deploy script and the unit tests both call to
 * keep one source of truth for the rule.
 */
export function verifyProductLocationBackfill(
  products: ReadonlyArray<ProductLike>,
): BackfillVerifyResult {
  const unassigned = products.filter((p) => p.locationId == null);
  const perTenantMap = new Map<string | null, number>();
  for (const p of unassigned) {
    perTenantMap.set(p.tenantId, (perTenantMap.get(p.tenantId) ?? 0) + 1);
  }

  return {
    ok: unassigned.length === 0,
    unassignedCount: unassigned.length,
    perTenantUnassigned: Array.from(perTenantMap.entries()).map(([tenantId, count]) => ({
      tenantId,
      count,
    })),
  };
}

/**
 * Live verifier — runs the same invariant against a Prisma-backed DB.
 * Used by the post-deploy script and any operational health check.
 */
export async function verifyProductLocationBackfillLive(
  prisma: PrismaClient,
): Promise<BackfillVerifyResult> {
  const products = await prisma.product.findMany({
    select: { id: true, tenantId: true, locationId: true },
  });
  return verifyProductLocationBackfill(products);
}
