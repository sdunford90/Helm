import type { PrismaClient } from '@prisma/client';

// GL accounts are now sourced from QuickBooks Online per location.
// This seed creates a dev/test set of mock QBO-synced accounts for a given location
// so local development works without a live QBO connection.
export async function seedGlAccounts(prisma: PrismaClient, tenantId: string, locationId: string) {
  await prisma.glAccount.deleteMany({ where: { tenantId, locationId } });

  const accounts = [
    { accountNumber: '1010', name: 'Cash on Hand',           type: 'ASSET',     subType: 'current',   qboAccountId: 'qbo-mock-1010' },
    { accountNumber: '1020', name: 'Stripe Clearing',        type: 'ASSET',     subType: 'current',   qboAccountId: 'qbo-mock-1020' },
    { accountNumber: '1030', name: 'ACH Clearing',           type: 'ASSET',     subType: 'current',   qboAccountId: 'qbo-mock-1030' },
    { accountNumber: '1100', name: 'Accounts Receivable',    type: 'ASSET',     subType: 'current',   qboAccountId: 'qbo-mock-1100' },
    { accountNumber: '1140', name: 'Inventory Asset',        type: 'ASSET',     subType: 'current',   qboAccountId: 'qbo-mock-1140' },
    { accountNumber: '2000', name: 'Accounts Payable',       type: 'LIABILITY', subType: 'current',   qboAccountId: 'qbo-mock-2000' },
    { accountNumber: '2100', name: 'Deferred Revenue',       type: 'LIABILITY', subType: 'current',   qboAccountId: 'qbo-mock-2100', isDeferredRevenue: true },
    { accountNumber: '2200', name: 'Security Deposits Held', type: 'LIABILITY', subType: 'current',   qboAccountId: 'qbo-mock-2200' },
    { accountNumber: '2300', name: 'Sales Tax Payable',      type: 'LIABILITY', subType: 'current',   qboAccountId: 'qbo-mock-2300' },
    { accountNumber: '4100', name: 'Slip Rental Income',     type: 'REVENUE',   subType: 'operating', qboAccountId: 'qbo-mock-4100' },
    { accountNumber: '4200', name: 'Utilities Income',       type: 'REVENUE',   subType: 'operating', qboAccountId: 'qbo-mock-4200' },
    { accountNumber: '4300', name: 'Boat Rental Income',     type: 'REVENUE',   subType: 'operating', qboAccountId: 'qbo-mock-4300' },
    { accountNumber: '4400', name: 'Fuel Sales',             type: 'REVENUE',   subType: 'operating', qboAccountId: 'qbo-mock-4400' },
    { accountNumber: '4500', name: 'Retail Sales',           type: 'REVENUE',   subType: 'operating', qboAccountId: 'qbo-mock-4500' },
    { accountNumber: '4600', name: 'Transient Income',       type: 'REVENUE',   subType: 'operating', qboAccountId: 'qbo-mock-4600' },
    { accountNumber: '4700', name: 'Ramp Fee Income',        type: 'REVENUE',   subType: 'operating', qboAccountId: 'qbo-mock-4700' },
    { accountNumber: '4800', name: 'Service Income',         type: 'REVENUE',   subType: 'operating', qboAccountId: 'qbo-mock-4800' },
    { accountNumber: '4950', name: 'Late Fee Income',        type: 'REVENUE',   subType: 'operating', qboAccountId: 'qbo-mock-4950' },
    { accountNumber: '5100', name: 'Cost of Fuel Sold',      type: 'EXPENSE',   subType: 'cogs',      qboAccountId: 'qbo-mock-5100' },
    { accountNumber: '5200', name: 'Cost of Goods Sold',     type: 'EXPENSE',   subType: 'cogs',      qboAccountId: 'qbo-mock-5200' },
  ];

  return Promise.all(
    accounts.map((a) =>
      prisma.glAccount.create({
        data: { tenantId, locationId, isDeferredRevenue: false, ...a },
      }),
    ),
  );
}
