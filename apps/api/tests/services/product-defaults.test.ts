import { describe, it, expect } from 'vitest';
import {
  resolveProductTaxCategory,
  isTaxExempt,
} from '../../src/services/product-defaults.js';

// After 20260429080000_inventory_category_only_gl, the only per-product →
// category fall-through this module owns is the tax category and taxable
// flag. GL accounts (revenue/cogs/inventoryAsset) now resolve through the
// per-(category, location) ProductCategoryGlMapping table only — see
// gl-account-resolver.test.ts for that path.

const taxableCat = {
  defaultTaxCategory: 'food',
  taxable: true,
};

describe('resolveProductTaxCategory', () => {
  it('falls back to category defaultTaxCategory when product has no taxClass', () => {
    const out = resolveProductTaxCategory({
      taxClass: null,
      productCategory: taxableCat,
    });
    expect(out.taxCategory).toBe('food');
    expect(out.taxable).toBe(true);
  });

  it('per-product taxClass overrides category default', () => {
    const out = resolveProductTaxCategory({
      taxClass: 'luxury',
      productCategory: taxableCat,
    });
    expect(out.taxCategory).toBe('luxury');
    expect(out.taxable).toBe(true);
  });

  it('falls back to "general" when neither product nor category set a tax category', () => {
    const out = resolveProductTaxCategory({
      taxClass: null,
      productCategory: { defaultTaxCategory: null, taxable: true },
    });
    expect(out.taxCategory).toBe('general');
    expect(out.taxable).toBe(true);
  });

  it('honours per-product "Tax Exempt" override even when the category is taxable', () => {
    const out = resolveProductTaxCategory({
      taxClass: 'Tax Exempt',
      productCategory: taxableCat,
    });
    expect(out.taxable).toBe(false);
    expect(out.taxCategory).toBeNull();
  });

  it('also recognises the legacy "Exempt" sentinel as tax-exempt', () => {
    const out = resolveProductTaxCategory({
      taxClass: 'Exempt',
      productCategory: taxableCat,
    });
    expect(out.taxable).toBe(false);
  });

  it('non-taxable category forces taxable=false on inheriting products', () => {
    const out = resolveProductTaxCategory({
      taxClass: null,
      productCategory: { defaultTaxCategory: 'food', taxable: false },
    });
    expect(out.taxable).toBe(false);
    expect(out.taxCategory).toBeNull();
  });

  it('with no category and no override, defaults to general/taxable', () => {
    const out = resolveProductTaxCategory({
      taxClass: null,
      productCategory: null,
    });
    expect(out.taxCategory).toBe('general');
    expect(out.taxable).toBe(true);
  });

  it('treats "Standard" taxClass as "use the category default", not as a literal tax category', () => {
    // The product modal writes "Standard" to mean "no override"; the
    // resolver must fall through to the category's defaultTaxCategory in
    // that case rather than using "Standard" verbatim.
    const out = resolveProductTaxCategory({
      taxClass: 'Standard',
      productCategory: { defaultTaxCategory: 'food', taxable: true },
    });
    expect(out.taxCategory).toBe('food');
  });
});

describe('isTaxExempt', () => {
  it('matches the canonical and legacy labels case-insensitively', () => {
    expect(isTaxExempt('Tax Exempt')).toBe(true);
    expect(isTaxExempt('tax exempt')).toBe(true);
    expect(isTaxExempt('  TAX EXEMPT  ')).toBe(true);
    expect(isTaxExempt('Exempt')).toBe(true);
    expect(isTaxExempt('exempt')).toBe(true);
  });

  it('returns false for null, empty, or unrelated taxClass strings', () => {
    expect(isTaxExempt(null)).toBe(false);
    expect(isTaxExempt(undefined)).toBe(false);
    expect(isTaxExempt('')).toBe(false);
    expect(isTaxExempt('Standard')).toBe(false);
    expect(isTaxExempt('luxury')).toBe(false);
  });
});
