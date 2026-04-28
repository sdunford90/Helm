import { describe, it, expect } from 'vitest';
import { resolveEffectiveValues } from '../../src/services/product-defaults.js';

// resolveEffectiveValues is the single source of truth for the
// per-product → category → "general" precedence rule. These tests pin the
// behaviour the rest of the system (POS, invoices, QBO sync) relies on.

const cat = {
  defaultRevenueGlAccountId: 'rev-cat',
  defaultCogsGlAccountId: 'cogs-cat',
  defaultInventoryAssetGlAccountId: 'inv-cat',
  defaultTaxCategory: 'food',
  taxable: true,
};

describe('resolveEffectiveValues', () => {
  it('returns category defaults when per-product fields are blank', () => {
    const out = resolveEffectiveValues({
      override: {
        revenueGlAccountId: null,
        cogsGlAccountId: null,
        inventoryAssetGlAccountId: null,
        taxClass: null,
      },
      category: cat,
    });
    expect(out.revenueGlAccountId).toBe('rev-cat');
    expect(out.cogsGlAccountId).toBe('cogs-cat');
    expect(out.inventoryAssetGlAccountId).toBe('inv-cat');
    expect(out.taxCategory).toBe('food');
    expect(out.taxable).toBe(true);
  });

  it('per-product overrides win over category defaults', () => {
    const out = resolveEffectiveValues({
      override: {
        revenueGlAccountId: 'rev-prod',
        cogsGlAccountId: 'cogs-prod',
        inventoryAssetGlAccountId: 'inv-prod',
        taxClass: 'luxury',
      },
      category: cat,
    });
    expect(out.revenueGlAccountId).toBe('rev-prod');
    expect(out.cogsGlAccountId).toBe('cogs-prod');
    expect(out.inventoryAssetGlAccountId).toBe('inv-prod');
    expect(out.taxCategory).toBe('luxury');
  });

  it('falls back to "general" when neither product nor category set a tax category', () => {
    const out = resolveEffectiveValues({
      override: {
        revenueGlAccountId: null,
        cogsGlAccountId: null,
        inventoryAssetGlAccountId: null,
        taxClass: null,
      },
      category: { ...cat, defaultTaxCategory: null },
    });
    expect(out.taxCategory).toBe('general');
  });

  it('honours per-product Tax Exempt override even with taxable category', () => {
    const out = resolveEffectiveValues({
      override: {
        revenueGlAccountId: null,
        cogsGlAccountId: null,
        inventoryAssetGlAccountId: null,
        taxClass: 'Tax Exempt',
      },
      category: cat,
    });
    expect(out.taxable).toBe(false);
  });

  it('non-taxable category sets taxable=false on inheriting products', () => {
    const out = resolveEffectiveValues({
      override: {
        revenueGlAccountId: null,
        cogsGlAccountId: null,
        inventoryAssetGlAccountId: null,
        taxClass: null,
      },
      category: { ...cat, taxable: false },
    });
    expect(out.taxable).toBe(false);
  });

  it('with no category and no override, defaults to general/taxable', () => {
    const out = resolveEffectiveValues({
      override: {
        revenueGlAccountId: null,
        cogsGlAccountId: null,
        inventoryAssetGlAccountId: null,
        taxClass: null,
      },
      category: null,
    });
    expect(out.revenueGlAccountId).toBeNull();
    expect(out.cogsGlAccountId).toBeNull();
    expect(out.inventoryAssetGlAccountId).toBeNull();
    expect(out.taxCategory).toBe('general');
    expect(out.taxable).toBe(true);
  });
});
