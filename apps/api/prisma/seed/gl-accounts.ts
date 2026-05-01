import type { PrismaClient, Location } from '@prisma/client';

/**
 * Seeds a realistic marina chart of accounts for Sunset Harbor.
 * These are tenant-wide (locationId set to the primary location so they're
 * scoped correctly). After creation, the primary location's accounting-setup
 * fields are updated to mark setup complete.
 */
export async function seedGlAccounts(
  prisma: PrismaClient,
  tenantId: string,
  locations?: Location[],
) {
  await prisma.glAccount.deleteMany({ where: { tenantId } });

  const primaryLocationId = locations?.[0]?.id ?? null;

  // Build the chart of accounts
  const accounts = await Promise.all([
    // ── Assets ───────────────────────────────────────────────────────────────
    prisma.glAccount.create({
      data: {
        tenantId,
        locationId: primaryLocationId,
        accountNumber: '1100',
        name: 'Accounts Receivable',
        type: 'ASSET',
        subType: 'AccountsReceivable',
        source: 'MANUAL',
        isActive: true,
        active: true,
        description: 'Amounts owed by customers for marina services',
      },
    }),
    prisma.glAccount.create({
      data: {
        tenantId,
        locationId: primaryLocationId,
        accountNumber: '1200',
        name: 'Undeposited Funds',
        type: 'ASSET',
        subType: 'OtherCurrentAsset',
        source: 'MANUAL',
        isActive: true,
        active: true,
        description: 'Cash and checks received but not yet deposited',
      },
    }),
    prisma.glAccount.create({
      data: {
        tenantId,
        locationId: primaryLocationId,
        accountNumber: '1300',
        name: 'Inventory Asset — Fuel',
        type: 'ASSET',
        subType: 'Inventory',
        source: 'MANUAL',
        isActive: true,
        active: true,
        description: 'Fuel inventory at cost',
      },
    }),
    prisma.glAccount.create({
      data: {
        tenantId,
        locationId: primaryLocationId,
        accountNumber: '1310',
        name: 'Inventory Asset — Ship Store',
        type: 'ASSET',
        subType: 'Inventory',
        source: 'MANUAL',
        isActive: true,
        active: true,
        description: 'Ship store merchandise inventory at cost',
      },
    }),
    // ── Liabilities ──────────────────────────────────────────────────────────
    prisma.glAccount.create({
      data: {
        tenantId,
        locationId: primaryLocationId,
        accountNumber: '2100',
        name: 'Accounts Payable',
        type: 'LIABILITY',
        subType: 'AccountsPayable',
        source: 'MANUAL',
        isActive: true,
        active: true,
        description: 'Amounts owed to suppliers and vendors',
      },
    }),
    // ── Revenue ───────────────────────────────────────────────────────────────
    prisma.glAccount.create({
      data: {
        tenantId,
        locationId: primaryLocationId,
        accountNumber: '4000',
        name: 'Dockage Revenue',
        type: 'REVENUE',
        subType: 'ServiceFeeIncome',
        source: 'MANUAL',
        isActive: true,
        active: true,
        description: 'Revenue from transient and daily dockage fees',
      },
    }),
    prisma.glAccount.create({
      data: {
        tenantId,
        locationId: primaryLocationId,
        accountNumber: '4100',
        name: 'Fuel Revenue',
        type: 'REVENUE',
        subType: 'SalesOfProductIncome',
        source: 'MANUAL',
        isActive: true,
        active: true,
        description: 'Revenue from retail fuel sales',
      },
    }),
    prisma.glAccount.create({
      data: {
        tenantId,
        locationId: primaryLocationId,
        accountNumber: '4200',
        name: 'Ship Store Revenue',
        type: 'REVENUE',
        subType: 'SalesOfProductIncome',
        source: 'MANUAL',
        isActive: true,
        active: true,
        description: 'Revenue from ship store merchandise sales',
      },
    }),
    prisma.glAccount.create({
      data: {
        tenantId,
        locationId: primaryLocationId,
        accountNumber: '4300',
        name: 'Service Revenue',
        type: 'REVENUE',
        subType: 'ServiceFeeIncome',
        source: 'MANUAL',
        isActive: true,
        active: true,
        description: 'Revenue from marine services (haul-out, bottom paint, engine)',
      },
    }),
    prisma.glAccount.create({
      data: {
        tenantId,
        locationId: primaryLocationId,
        accountNumber: '4400',
        name: 'Slip Rental Revenue',
        type: 'REVENUE',
        subType: 'RentalIncome',
        source: 'MANUAL',
        isActive: true,
        active: true,
        description: 'Revenue from seasonal and annual slip contracts',
      },
    }),
    // ── Cost of Goods Sold ────────────────────────────────────────────────────
    prisma.glAccount.create({
      data: {
        tenantId,
        locationId: primaryLocationId,
        accountNumber: '5000',
        name: 'Cost of Goods Sold — Fuel',
        type: 'EXPENSE',
        subType: 'SuppliesMaterials',
        source: 'MANUAL',
        isActive: true,
        active: true,
        description: 'Cost of fuel sold to customers',
      },
    }),
    prisma.glAccount.create({
      data: {
        tenantId,
        locationId: primaryLocationId,
        accountNumber: '5100',
        name: 'Cost of Goods Sold — Ship Store',
        type: 'EXPENSE',
        subType: 'SuppliesMaterials',
        source: 'MANUAL',
        isActive: true,
        active: true,
        description: 'Cost of ship store merchandise sold',
      },
    }),
    prisma.glAccount.create({
      data: {
        tenantId,
        locationId: primaryLocationId,
        accountNumber: '5200',
        name: 'Direct Labor',
        type: 'EXPENSE',
        subType: 'OtherPrimaryExpense',
        source: 'MANUAL',
        isActive: true,
        active: true,
        description: 'Direct labor costs for marine services',
      },
    }),
    // ── Operating Expenses ────────────────────────────────────────────────────
    prisma.glAccount.create({
      data: {
        tenantId,
        locationId: primaryLocationId,
        accountNumber: '6000',
        name: 'Operating Expenses',
        type: 'EXPENSE',
        subType: 'OtherMiscellaneousExpense',
        source: 'MANUAL',
        isActive: true,
        active: true,
        description: 'General operating expenses',
      },
    }),
    prisma.glAccount.create({
      data: {
        tenantId,
        locationId: primaryLocationId,
        accountNumber: '6100',
        name: 'Utilities',
        type: 'EXPENSE',
        subType: 'Utilities',
        source: 'MANUAL',
        isActive: true,
        active: true,
        description: 'Electricity, water, and dock utilities',
      },
    }),
  ]);

  // Wire up the primary location accounting setup after accounts exist
  if (primaryLocationId) {
    const ar = accounts.find((a) => a.accountNumber === '1100')!;
    const undep = accounts.find((a) => a.accountNumber === '1200')!;
    const slipRev = accounts.find((a) => a.accountNumber === '4400')!;

    await prisma.location.update({
      where: { id: primaryLocationId },
      data: {
        accountingSetupComplete: true,
        accountingSetupCompletedAt: new Date('2025-11-15T10:00:00Z'),
        accountingSetupStep: 5,
        arGlAccountId: ar.id,
        undepositedFundsGlAccountId: undep.id,
        defaultRevenueGlAccountId: slipRev.id,
      },
    });
  }

  return accounts;
}
