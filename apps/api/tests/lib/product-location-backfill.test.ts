import { describe, it, expect } from 'vitest';
import {
  selectPrimaryLocationByTenant,
  verifyProductLocationBackfill,
} from '../../src/lib/product-location-backfill.js';

// These tests guard the Task #340 backfill invariant. They mirror the SQL
// in apps/api/prisma/migrations/20260512000000_backfill_product_location
// in pure TS so the runtime verifier and the migration can't drift apart.

describe('selectPrimaryLocationByTenant', () => {
  it('picks the oldest location by createdAt for each tenant', () => {
    const locations = [
      { id: 'loc-A2', tenantId: 'T1', createdAt: new Date('2024-06-01') },
      { id: 'loc-A1', tenantId: 'T1', createdAt: new Date('2023-01-01') },
      { id: 'loc-A3', tenantId: 'T1', createdAt: new Date('2025-01-01') },
      { id: 'loc-B1', tenantId: 'T2', createdAt: new Date('2024-01-01') },
    ];
    const result = selectPrimaryLocationByTenant(locations);
    expect(result.get('T1')?.id).toBe('loc-A1');
    expect(result.get('T2')?.id).toBe('loc-B1');
  });

  it('uses lexicographic id as a deterministic tie-break when createdAt is identical', () => {
    const same = new Date('2024-01-01');
    const locations = [
      { id: 'loc-zzz', tenantId: 'T1', createdAt: same },
      { id: 'loc-aaa', tenantId: 'T1', createdAt: same },
      { id: 'loc-mmm', tenantId: 'T1', createdAt: same },
    ];
    const result = selectPrimaryLocationByTenant(locations);
    expect(result.get('T1')?.id).toBe('loc-aaa');
  });

  it('does NOT prefer active locations over inactive ones (rule is strictly oldest)', () => {
    // Defensive: the migration must NOT add an active-DESC preference.
    // If someone reintroduces `active` into the rule, this test fails.
    const locations = [
      { id: 'loc-old-inactive', tenantId: 'T1', createdAt: new Date('2022-01-01') },
      { id: 'loc-new-active', tenantId: 'T1', createdAt: new Date('2024-01-01') },
    ];
    const result = selectPrimaryLocationByTenant(locations);
    expect(result.get('T1')?.id).toBe('loc-old-inactive');
  });

  it('returns no entry for tenants with zero locations', () => {
    const result = selectPrimaryLocationByTenant([]);
    expect(result.size).toBe(0);
  });
});

describe('verifyProductLocationBackfill', () => {
  it('passes when no products have a NULL locationId', () => {
    const products = [
      { id: 'p1', tenantId: 'T1', locationId: 'loc-T1-old' },
      // Operators are free to reassign products to any other location
      // post-backfill — the verifier must NOT flag this as a violation.
      { id: 'p2', tenantId: 'T1', locationId: 'loc-T1-new' },
      { id: 'p3', tenantId: 'T2', locationId: 'loc-T2' },
    ];
    const result = verifyProductLocationBackfill(products);
    expect(result.ok).toBe(true);
    expect(result.unassignedCount).toBe(0);
  });

  it('fails and reports per-tenant counts when products are still unassigned', () => {
    const products = [
      { id: 'p1', tenantId: 'T1', locationId: null },
      { id: 'p2', tenantId: 'T1', locationId: null },
      { id: 'p3', tenantId: 'T2', locationId: 'loc-T2' },
    ];
    const result = verifyProductLocationBackfill(products);
    expect(result.ok).toBe(false);
    expect(result.unassignedCount).toBe(2);
    expect(result.perTenantUnassigned).toEqual([{ tenantId: 'T1', count: 2 }]);
  });

  it('treats a tenant with zero locations as a fatal unassigned-count failure', () => {
    const products = [{ id: 'p-orphan', tenantId: 'T-no-loc', locationId: null }];
    const result = verifyProductLocationBackfill(products);
    expect(result.ok).toBe(false);
    expect(result.unassignedCount).toBe(1);
    expect(result.perTenantUnassigned).toContainEqual({
      tenantId: 'T-no-loc',
      count: 1,
    });
  });
});
