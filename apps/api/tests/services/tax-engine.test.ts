import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockPrisma } from '../setup.js';

// tests/setup.ts mocks the tax engine for route tests; test the real module.
vi.unmock('../../src/services/tax-engine.js');

let tax: typeof import('../../src/services/tax-engine.js');

beforeEach(async () => {
  vi.clearAllMocks();
  mockPrisma.tenant.findUnique.mockReset();
  mockPrisma.customer.findFirst.mockReset().mockResolvedValue({ taxExempt: false, exemptionExpiry: null });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  tax = await import('../../src/services/tax-engine.js');
});

describe('resolveTaxRates', () => {
  it('reads the taxRate PERCENT that PUT /api/settings/billing writes, as a fraction', () => {
    expect(tax.resolveTaxRates({ taxRate: 7 })).toEqual([
      { jurisdiction: 'default', category: 'general', rate: 0.07 },
    ]);
    expect(tax.resolveTaxRates({ taxRate: 8.25 })[0].rate).toBeCloseTo(0.0825, 10);
  });

  it('treats a legacy taxRates[] rate > 1 as a percentage, never 700%', () => {
    const rates = tax.resolveTaxRates({ taxRates: [{ jurisdiction: 'FL', category: 'general', rate: 7 }] });
    expect(rates).toEqual([{ jurisdiction: 'FL', category: 'general', rate: 0.07 }]);
  });

  it('keeps fractional legacy category overrides alongside the settings rate', () => {
    const rates = tax.resolveTaxRates({
      taxRate: 6,
      taxRates: [
        { category: 'general', rate: 0.5 }, // superseded by taxRate
        { category: 'electricity', rate: 0.02 },
      ],
    });
    expect(rates.find((r) => r.category === 'general')?.rate).toBeCloseTo(0.06, 10);
    expect(rates.find((r) => r.category === 'electricity')?.rate).toBe(0.02);
    expect(rates.filter((r) => r.category === 'general')).toHaveLength(1);
  });

  it('ignores invalid values and falls back to 0%', () => {
    expect(tax.resolveTaxRates({ taxRate: 250 })).toEqual([
      { jurisdiction: 'default', category: 'general', rate: 0 },
    ]);
    expect(tax.resolveTaxRates({ taxRate: -1 })[0].rate).toBe(0);
    expect(tax.resolveTaxRates(null)[0].rate).toBe(0);
    expect(tax.resolveTaxRates({ taxRates: [{ rate: 'abc' }] })[0].rate).toBe(0);
  });

  it('percentToFraction / normalizeFractionalRate guards', () => {
    expect(tax.percentToFraction(7)).toBe(0.07);
    expect(tax.percentToFraction('7')).toBe(0.07);
    expect(tax.percentToFraction(101)).toBeNull();
    expect(tax.normalizeFractionalRate(0.07)).toBe(0.07);
    expect(tax.normalizeFractionalRate(1)).toBe(1); // exactly 100% is a valid fraction
    expect(tax.normalizeFractionalRate(7)).toBe(0.07);
    expect(tax.normalizeFractionalRate(-0.1)).toBeNull();
  });
});

describe('calculateTax', () => {
  it('taxes invoices at the configured settings rate (was always 0%)', async () => {
    mockPrisma.tenant.findUnique.mockResolvedValue({ invoiceTemplateJson: { taxRate: 7 } });

    const result = await tax.calculateTax('tenant-1', 'cust-1', [
      { description: 'Slip A-1', amountCents: 100000, taxCategory: 'slip_rental' },
    ]);

    expect(result.items[0].taxRate).toBe(0.07);
    expect(result.items[0].taxCents).toBe(7000);
    expect(result.totalTaxCents).toBe(7000);
  });

  it('never taxes at 700% when someone hand-enters taxRates [{ rate: 7 }]', async () => {
    mockPrisma.tenant.findUnique.mockResolvedValue({
      invoiceTemplateJson: { taxRates: [{ jurisdiction: 'x', category: 'general', rate: 7 }] },
    });

    const result = await tax.calculateTax('tenant-1', 'cust-1', [
      { description: 'Line', amountCents: 10000 },
    ]);

    expect(result.items[0].taxCents).toBe(700);
  });

  it('exempt customers pay no tax', async () => {
    mockPrisma.customer.findFirst.mockResolvedValue({ taxExempt: true, exemptionExpiry: null });
    mockPrisma.tenant.findUnique.mockResolvedValue({ invoiceTemplateJson: { taxRate: 7 } });
    const result = await tax.calculateTax('tenant-1', 'cust-1', [{ description: 'Line', amountCents: 10000 }]);
    expect(result.totalTaxCents).toBe(0);
  });
});
