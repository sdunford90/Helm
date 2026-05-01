import type { PrismaClient } from '@prisma/client';

// ── Tax Rates ────────────────────────────────────────────────────────────────
// Florida marina example: state + county surtax on standard goods,
// separate fuel tax rate, exempt class always zero.
const TAX_RATE_DEFS = [
  { jurisdiction: 'State - FL',          taxClass: 'STANDARD', rate: 6.0   },
  { jurisdiction: 'County - Palm Beach', taxClass: 'STANDARD', rate: 1.0   },
  { jurisdiction: 'State - FL',          taxClass: 'FUEL_TAX', rate: 4.5   },
  { jurisdiction: 'County - Palm Beach', taxClass: 'FUEL_TAX', rate: 0.5   },
  // EXEMPT rows not needed — zero-rate is the default when no match found
];

// ── Per-location accounting data ─────────────────────────────────────────────
// Matches the GL account numbers seeded in gl-accounts.ts.
const SYSTEM_ACCOUNT_MAP: Record<string, string> = {
  ACCOUNTS_RECEIVABLE:  '1100',
  CASH:                 '1010',
  CARD_CLEARING:        '1020',
  ACH_CLEARING:         '1030',
  DEFERRED_REVENUE:     '2100',
  SECURITY_DEPOSITS_HELD: '2200',
  SALES_TAX_PAYABLE:    '2300',
  INVENTORY_ASSET:      '1140',
  ACCOUNTS_PAYABLE:     '2000',
};

const REVENUE_STREAM_MAP: Record<string, string> = {
  DOCKAGE:    '4100',
  ELECTRICITY: '4200',
  RENTAL:     '4300',
  FUEL:       '4400',
  RETAIL:     '4500',
  TRANSIENT:  '4600',
  RAMP:       '4700',
  CONCIERGE:  '4800',
};

const PAYMENT_METHOD_MAP: Record<string, string> = {
  CARD: '1020',
  ACH:  '1030',
  CASH: '1010',
};

const DOCKAGE_RATES = [
  { slipType: '25ft Open Slip',      monthlyRateCents: 45000,  quarterlyRateCents: 130000, annualRateCents: 495000,  electricityMode: 'METERED', electricityRateCents: 14 },
  { slipType: '30ft Covered Slip',   monthlyRateCents: 72500,  quarterlyRateCents: 210000, annualRateCents: 795000,  electricityMode: 'METERED', electricityRateCents: 14 },
  { slipType: '40ft Open Slip',      monthlyRateCents: 85000,  quarterlyRateCents: 247000, annualRateCents: 936000,  electricityMode: 'METERED', electricityRateCents: 14 },
  { slipType: '50ft End-Tie',        monthlyRateCents: 125000, quarterlyRateCents: 362000, annualRateCents: 1375000, electricityMode: 'FLAT',    electricityRateCents: 5000 },
  { slipType: 'Dry Stack (small)',    monthlyRateCents: 38000,  quarterlyRateCents: 110000, annualRateCents: 420000,  electricityMode: 'NONE',    electricityRateCents: 0 },
  { slipType: 'Dry Stack (large)',    monthlyRateCents: 55000,  quarterlyRateCents: 159000, annualRateCents: 605000,  electricityMode: 'NONE',    electricityRateCents: 0 },
];

const SERVICE_FEES = [
  { name: 'Late Payment Fee',  amountCents: 2500,  revenueAccount: '4950' },
  { name: 'ACH Return Fee',    amountCents: 3500,  revenueAccount: '4950' },
  { name: 'Pump-Out Service',  amountCents: 7500,  revenueAccount: '4800' },
  { name: 'Transient Check-In', amountCents: 1500, revenueAccount: '4600' },
  { name: 'Haul-Out Fee',      amountCents: 15000, revenueAccount: '4800' },
];

const PRODUCT_CATEGORIES = [
  { name: 'Fuel',            costingMethod: 'FIFO', revenueAccount: '4400', cogsAccount: '5100' },
  { name: 'Bait & Tackle',   costingMethod: 'WAC',  revenueAccount: '4500', cogsAccount: '5200' },
  { name: 'Marine Supplies', costingMethod: 'WAC',  revenueAccount: '4500', cogsAccount: '5200' },
  { name: 'Provisions',      costingMethod: 'WAC',  revenueAccount: '4500', cogsAccount: '5200' },
  { name: 'Apparel',         costingMethod: 'WAC',  revenueAccount: '4500', cogsAccount: '5200' },
  { name: 'Boat Parts',      costingMethod: 'FIFO', revenueAccount: '4500', cogsAccount: '5200' },
];

const FISCAL_PERIODS = [
  { name: 'January 2026',  startDate: new Date('2026-01-01'), endDate: new Date('2026-01-31'), status: 'LOCKED', closedAt: new Date('2026-02-04'), lockedAt: new Date('2026-03-01') },
  { name: 'February 2026', startDate: new Date('2026-02-01'), endDate: new Date('2026-02-28'), status: 'LOCKED', closedAt: new Date('2026-03-04'), lockedAt: new Date('2026-04-01') },
  { name: 'March 2026',    startDate: new Date('2026-03-01'), endDate: new Date('2026-03-31'), status: 'CLOSED', closedAt: new Date('2026-04-05') },
  { name: 'April 2026',    startDate: new Date('2026-04-01'), endDate: new Date('2026-04-30'), status: 'OPEN' },
  { name: 'May 2026',      startDate: new Date('2026-05-01'), endDate: new Date('2026-05-31'), status: 'OPEN' },
];

export async function seedAccounting(
  prisma: PrismaClient,
  tenantId: string,
  locationIds: string[],
) {
  // 1. Tax rates (tenant-level, not per-location)
  await prisma.taxRate.deleteMany({ where: { tenantId } });
  const taxRates = await Promise.all(
    TAX_RATE_DEFS.map((r) =>
      prisma.taxRate.create({ data: { tenantId, ...r } })
    )
  );

  // 2. Fiscal periods (tenant-level)
  await prisma.fiscalPeriod.deleteMany({ where: { tenantId } });
  const periods = await Promise.all(
    FISCAL_PERIODS.map((p) =>
      prisma.fiscalPeriod.create({
        data: {
          tenantId,
          name: p.name,
          startDate: p.startDate,
          endDate: p.endDate,
          status: p.status as any,
          closedAt: p.closedAt ?? null,
          lockedAt: (p as any).lockedAt ?? null,
        },
      })
    )
  );

  // 3. Per-location data
  let totalMappings = 0, totalDockage = 0, totalFees = 0, totalCategories = 0;

  for (const locationId of locationIds) {
    // GL accounts for this location (look up by accountNumber)
    const glAccounts = await prisma.glAccount.findMany({ where: { tenantId, locationId } });
    const byNumber = Object.fromEntries(glAccounts.map((a) => [a.accountNumber, a.id]));

    if (glAccounts.length === 0) continue; // Skip if no GL accounts (QBO not connected)

    // 3a. Account mappings — system
    for (const [sourceKey, acctNum] of Object.entries(SYSTEM_ACCOUNT_MAP)) {
      const glAccountId = byNumber[acctNum];
      if (!glAccountId) continue;
      await prisma.accountMapping.upsert({
        where: { locationId_mappingType_sourceKey: { locationId, mappingType: 'SYSTEM_ACCOUNT', sourceKey } },
        update: { glAccountId },
        create: { tenantId, locationId, mappingType: 'SYSTEM_ACCOUNT', sourceKey, glAccountId },
      });
      totalMappings++;
    }

    // 3b. Account mappings — revenue streams
    for (const [sourceKey, acctNum] of Object.entries(REVENUE_STREAM_MAP)) {
      const glAccountId = byNumber[acctNum];
      if (!glAccountId) continue;
      await prisma.accountMapping.upsert({
        where: { locationId_mappingType_sourceKey: { locationId, mappingType: 'REVENUE_STREAM', sourceKey } },
        update: { glAccountId },
        create: { tenantId, locationId, mappingType: 'REVENUE_STREAM', sourceKey, glAccountId },
      });
      totalMappings++;
    }

    // 3c. Account mappings — payment methods
    for (const [sourceKey, acctNum] of Object.entries(PAYMENT_METHOD_MAP)) {
      const glAccountId = byNumber[acctNum];
      if (!glAccountId) continue;
      await prisma.accountMapping.upsert({
        where: { locationId_mappingType_sourceKey: { locationId, mappingType: 'PAYMENT_METHOD', sourceKey } },
        update: { glAccountId },
        create: { tenantId, locationId, mappingType: 'PAYMENT_METHOD', sourceKey, glAccountId },
      });
      totalMappings++;
    }

    // 3d. Dockage rates
    await prisma.dockageRate.deleteMany({ where: { tenantId, locationId } });
    for (const dr of DOCKAGE_RATES) {
      const glRevenueAccountId = byNumber['4100'] ?? null;
      await prisma.dockageRate.create({
        data: {
          tenantId, locationId,
          slipType: dr.slipType,
          monthlyRateCents: dr.monthlyRateCents,
          quarterlyRateCents: dr.quarterlyRateCents,
          annualRateCents: dr.annualRateCents,
          electricityMode: dr.electricityMode as any,
          electricityRateCents: dr.electricityRateCents,
          glRevenueAccountId,
        },
      });
      totalDockage++;
    }

    // 3e. Service fees
    await prisma.serviceFee.deleteMany({ where: { tenantId, locationId } });
    for (const sf of SERVICE_FEES) {
      const glAccountId = byNumber[sf.revenueAccount] ?? null;
      await prisma.serviceFee.create({
        data: { tenantId, locationId, name: sf.name, amountCents: sf.amountCents, glAccountId },
      });
      totalFees++;
    }

    // 3f. Product categories
    await prisma.productCategory.deleteMany({ where: { tenantId, locationId } });
    for (const cat of PRODUCT_CATEGORIES) {
      const glRevenueAccountId = byNumber[cat.revenueAccount] ?? null;
      const glCogsAccountId = byNumber[cat.cogsAccount] ?? null;
      await prisma.productCategory.create({
        data: {
          tenantId, locationId,
          name: cat.name,
          costingMethod: cat.costingMethod as any,
          glRevenueAccountId,
          glCogsAccountId,
        },
      });
      totalCategories++;
    }
  }

  return { taxRates, periods, totalMappings, totalDockage, totalFees, totalCategories };
}
