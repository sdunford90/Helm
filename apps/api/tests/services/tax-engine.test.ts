import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockPrisma } from '../setup.js';

// tax-engine is module-mocked in tests/setup.ts so the route tests can
// assert on the call signature. This file deliberately bypasses that mock
// with vi.importActual to get the REAL calculateTax implementation, then
// stubs only the prisma calls it makes (locationTaxJurisdiction.findMany,
// customer.findFirst). That way we can prove jurisdiction-driven tax
// math actually differs across locations and respects category fallback —
// which the route-level tests can't show because they mock the engine.
const { calculateTax } = await vi.importActual<
  typeof import('../../src/services/tax-engine.js')
>('../../src/services/tax-engine.js');

const TENANT = 'tenant-1';
const LOC_LOW = 'loc-low-tax';
const LOC_HIGH = 'loc-high-tax';

// Helper that builds a minimal locationTaxJurisdiction row matching what the
// engine selects with its include({ jurisdiction: { include: { rates } } }).
function jurisdictionLink(opts: {
  locationId: string;
  jurisdictionId: string;
  code: string;
  name: string;
  kind: string;
  sortOrder: number;
  rates: Array<{ category: string; ratePctBps: number }>;
}) {
  return {
    locationId: opts.locationId,
    tenantId: TENANT,
    jurisdictionId: opts.jurisdictionId,
    sortOrder: opts.sortOrder,
    jurisdiction: {
      id: opts.jurisdictionId,
      code: opts.code,
      name: opts.name,
      kind: opts.kind,
      rates: opts.rates.map((r, i) => ({
        id: `rate-${opts.jurisdictionId}-${i}`,
        tenantId: TENANT,
        jurisdictionId: opts.jurisdictionId,
        category: r.category,
        ratePctBps: r.ratePctBps,
        glAccountId: null,
        effectiveFrom: new Date('2020-01-01'),
        effectiveTo: null,
      })),
    },
  };
}

describe('calculateTax — multi-location jurisdiction stacks (real engine)', () => {
  beforeEach(() => {
    mockPrisma.locationTaxJurisdiction.findMany.mockReset();
    mockPrisma.customer.findFirst.mockReset();
  });

  it('returns higher tax for the same line at a higher-rate location', async () => {
    // Same product line, two locations: marina-A in a 4% county, marina-B in
    // a 4% county PLUS a 4% special-district stack. The engine adds rates
    // additively across the jurisdiction stack, so the same $100 sale should
    // produce $4 tax at the low-tax marina and $8 at the high-tax marina.
    mockPrisma.locationTaxJurisdiction.findMany.mockImplementation(async ({ where }: any) => {
      if (where.locationId === LOC_LOW) {
        return [
          jurisdictionLink({
            locationId: LOC_LOW,
            jurisdictionId: 'j-county',
            code: 'COUNTY',
            name: 'County',
            kind: 'COUNTY',
            sortOrder: 1,
            rates: [{ category: 'general', ratePctBps: 400 }], // 4.00%
          }),
        ];
      }
      if (where.locationId === LOC_HIGH) {
        return [
          jurisdictionLink({
            locationId: LOC_HIGH,
            jurisdictionId: 'j-county',
            code: 'COUNTY',
            name: 'County',
            kind: 'COUNTY',
            sortOrder: 1,
            rates: [{ category: 'general', ratePctBps: 400 }], // 4.00%
          }),
          jurisdictionLink({
            locationId: LOC_HIGH,
            jurisdictionId: 'j-special',
            code: 'SPECIAL',
            name: 'Special District',
            kind: 'SPECIAL',
            sortOrder: 2,
            rates: [{ category: 'general', ratePctBps: 400 }], // 4.00%
          }),
        ];
      }
      return [];
    });

    const lineItems = [
      { description: 'Bait', amountCents: 10_000, taxCategory: 'general' },
    ];

    const lowResult = await calculateTax({
      tenantId: TENANT,
      locationId: LOC_LOW,
      customerId: null,
      lineItems,
    });
    const highResult = await calculateTax({
      tenantId: TENANT,
      locationId: LOC_HIGH,
      customerId: null,
      lineItems,
    });

    // 10000 * 0.04 = 400  vs  10000 * 0.08 = 800
    expect(lowResult.totalTaxCents).toBe(400);
    expect(highResult.totalTaxCents).toBe(800);
    expect(highResult.totalTaxCents).toBeGreaterThan(lowResult.totalTaxCents);
    // High-tax location reports both jurisdictions in its breakdown
    expect(highResult.items[0].breakdowns).toHaveLength(2);
    expect(lowResult.items[0].breakdowns).toHaveLength(1);
  });

  it('selects category-specific rate when present, falls back to general otherwise', async () => {
    // One location with a stack that has a 4% general rate AND a 7% food
    // rate on the SAME jurisdiction. A "food" line should be taxed at 7%;
    // a "general" line at 4%; an unknown "fuel" line should fall back to
    // the general rate (4%) per the engine's fallback rule.
    mockPrisma.locationTaxJurisdiction.findMany.mockResolvedValue([
      jurisdictionLink({
        locationId: LOC_LOW,
        jurisdictionId: 'j-county',
        code: 'COUNTY',
        name: 'County',
        kind: 'COUNTY',
        sortOrder: 1,
        rates: [
          { category: 'general', ratePctBps: 400 },
          { category: 'food', ratePctBps: 700 },
        ],
      }),
    ]);

    const result = await calculateTax({
      tenantId: TENANT,
      locationId: LOC_LOW,
      customerId: null,
      lineItems: [
        { description: 'Bait (food)', amountCents: 10_000, taxCategory: 'food' },
        { description: 'Slip rental', amountCents: 10_000, taxCategory: 'general' },
        { description: 'Fuel surcharge', amountCents: 10_000, taxCategory: 'fuel' },
      ],
    });

    // food: 10000 * 0.07 = 700, general: 10000 * 0.04 = 400, fuel→general: 400
    expect(result.items[0].taxCents).toBe(700);
    expect(result.items[1].taxCents).toBe(400);
    expect(result.items[2].taxCents).toBe(400);
    expect(result.totalTaxCents).toBe(1500);
  });

  it('returns zero tax when the location has no jurisdiction stack configured', async () => {
    mockPrisma.locationTaxJurisdiction.findMany.mockResolvedValue([]);
    const result = await calculateTax({
      tenantId: TENANT,
      locationId: 'loc-unconfigured',
      customerId: null,
      lineItems: [
        { description: 'Slip rental', amountCents: 10_000, taxCategory: 'general' },
      ],
    });
    expect(result.totalTaxCents).toBe(0);
    expect(result.items[0].taxCents).toBe(0);
  });

  it('short-circuits to zero tax when a customer is flagged exempt', async () => {
    // Customer exempt should bypass the jurisdiction stack entirely; the
    // engine returns zero tax without ever loading rates.
    mockPrisma.customer.findFirst.mockResolvedValue({
      taxExempt: true,
      exemptionExpiry: null,
    } as any);
    const result = await calculateTax({
      tenantId: TENANT,
      locationId: LOC_HIGH,
      customerId: 'cust-exempt',
      lineItems: [
        { description: 'Slip rental', amountCents: 10_000, taxCategory: 'general' },
      ],
    });
    expect(result.totalTaxCents).toBe(0);
    expect(mockPrisma.locationTaxJurisdiction.findMany).not.toHaveBeenCalled();
  });
});
