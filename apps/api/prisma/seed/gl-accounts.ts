import { GLAccountType, GlAccountSource, type PrismaClient } from '@prisma/client';

type SeedAccount = {
  accountNumber: string;
  name: string;
  type: GLAccountType;
  subType: string;
  isDeferredRevenue?: boolean;
};

export async function seedGlAccounts(prisma: PrismaClient, tenantId: string) {
  await prisma.glAccount.deleteMany({ where: { tenantId } });

  const accounts: SeedAccount[] = [
    { accountNumber: '1010', name: 'Cash on Hand', type: GLAccountType.ASSET, subType: 'current' },
    { accountNumber: '1020', name: 'Stripe Clearing', type: GLAccountType.ASSET, subType: 'current' },
    { accountNumber: '1030', name: 'ACH Clearing', type: GLAccountType.ASSET, subType: 'current' },
    { accountNumber: '1100', name: 'Accounts Receivable', type: GLAccountType.ASSET, subType: 'current' },
    { accountNumber: '2100', name: 'Deferred Revenue — Slips', type: GLAccountType.LIABILITY, subType: 'current', isDeferredRevenue: true },
    { accountNumber: '2200', name: 'Security Deposits Held', type: GLAccountType.LIABILITY, subType: 'current' },
    { accountNumber: '2300', name: 'Sales Tax Payable', type: GLAccountType.LIABILITY, subType: 'current' },
    { accountNumber: '2400', name: 'Tips Payable', type: GLAccountType.LIABILITY, subType: 'current' },
    { accountNumber: '2500', name: 'Customer Deposits', type: GLAccountType.LIABILITY, subType: 'current' },
    { accountNumber: '3000', name: 'Retained Earnings', type: GLAccountType.EQUITY, subType: 'equity' },
    { accountNumber: '4100', name: 'Slip Revenue', type: GLAccountType.REVENUE, subType: 'operating' },
    { accountNumber: '4200', name: 'Electricity Revenue', type: GLAccountType.REVENUE, subType: 'operating' },
    { accountNumber: '4300', name: 'Rental Revenue', type: GLAccountType.REVENUE, subType: 'operating' },
    { accountNumber: '4400', name: 'Fuel Revenue', type: GLAccountType.REVENUE, subType: 'operating' },
    { accountNumber: '4500', name: 'Retail Revenue', type: GLAccountType.REVENUE, subType: 'operating' },
    { accountNumber: '4600', name: 'Transient Revenue', type: GLAccountType.REVENUE, subType: 'operating' },
    { accountNumber: '4700', name: 'Ramp Revenue', type: GLAccountType.REVENUE, subType: 'operating' },
    { accountNumber: '4800', name: 'Concierge Revenue', type: GLAccountType.REVENUE, subType: 'operating' },
    { accountNumber: '4900', name: 'Damage Waiver Revenue', type: GLAccountType.REVENUE, subType: 'operating' },
    { accountNumber: '4950', name: 'Late Fee Revenue', type: GLAccountType.REVENUE, subType: 'operating' },
    { accountNumber: '5100', name: 'Fuel Cost of Goods Sold', type: GLAccountType.EXPENSE, subType: 'cogs' },
    { accountNumber: '5200', name: 'Retail Cost of Goods Sold', type: GLAccountType.EXPENSE, subType: 'cogs' },
    { accountNumber: '6100', name: 'Operating Expenses', type: GLAccountType.EXPENSE, subType: 'operating' },
    { accountNumber: '6200', name: 'Maintenance & Repairs', type: GLAccountType.EXPENSE, subType: 'operating' },
    { accountNumber: '6300', name: 'Insurance Expense', type: GLAccountType.EXPENSE, subType: 'operating' },
  ];

  return Promise.all(
    accounts.map((a) =>
      prisma.glAccount.create({
        data: { tenantId, source: GlAccountSource.MANUAL, isActive: true, ...a },
      }),
    ),
  );
}
