import type { PrismaClient } from '@prisma/client';

export async function seedGlAccounts(prisma: PrismaClient, tenantId: string) {
  await prisma.glAccount.deleteMany({ where: { tenantId } });

  const accounts = [
    { accountNumber: '1010', name: 'Cash on Hand', type: 'ASSET', subType: 'current' },
    { accountNumber: '1020', name: 'Stripe Clearing', type: 'ASSET', subType: 'current' },
    { accountNumber: '1030', name: 'ACH Clearing', type: 'ASSET', subType: 'current' },
    { accountNumber: '1100', name: 'Accounts Receivable', type: 'ASSET', subType: 'current' },
    { accountNumber: '2100', name: 'Deferred Revenue — Slips', type: 'LIABILITY', subType: 'current', isDeferredRevenue: true },
    { accountNumber: '2200', name: 'Security Deposits Held', type: 'LIABILITY', subType: 'current' },
    { accountNumber: '2300', name: 'Sales Tax Payable', type: 'LIABILITY', subType: 'current' },
    { accountNumber: '2400', name: 'Tips Payable', type: 'LIABILITY', subType: 'current' },
    { accountNumber: '2500', name: 'Customer Deposits', type: 'LIABILITY', subType: 'current' },
    { accountNumber: '3000', name: 'Retained Earnings', type: 'EQUITY', subType: 'equity' },
    { accountNumber: '4100', name: 'Slip Revenue', type: 'REVENUE', subType: 'operating' },
    { accountNumber: '4200', name: 'Electricity Revenue', type: 'REVENUE', subType: 'operating' },
    { accountNumber: '4300', name: 'Rental Revenue', type: 'REVENUE', subType: 'operating' },
    { accountNumber: '4400', name: 'Fuel Revenue', type: 'REVENUE', subType: 'operating' },
    { accountNumber: '4500', name: 'Retail Revenue', type: 'REVENUE', subType: 'operating' },
    { accountNumber: '4600', name: 'Transient Revenue', type: 'REVENUE', subType: 'operating' },
    { accountNumber: '4700', name: 'Ramp Revenue', type: 'REVENUE', subType: 'operating' },
    { accountNumber: '4800', name: 'Concierge Revenue', type: 'REVENUE', subType: 'operating' },
    { accountNumber: '4900', name: 'Damage Waiver Revenue', type: 'REVENUE', subType: 'operating' },
    { accountNumber: '4950', name: 'Late Fee Revenue', type: 'REVENUE', subType: 'operating' },
    { accountNumber: '5100', name: 'Fuel Cost of Goods Sold', type: 'COGS', subType: 'cogs' },
    { accountNumber: '5200', name: 'Retail Cost of Goods Sold', type: 'COGS', subType: 'cogs' },
    { accountNumber: '6100', name: 'Operating Expenses', type: 'EXPENSE', subType: 'operating' },
    { accountNumber: '6200', name: 'Maintenance & Repairs', type: 'EXPENSE', subType: 'operating' },
    { accountNumber: '6300', name: 'Insurance Expense', type: 'EXPENSE', subType: 'operating' },
  ];

  return Promise.all(accounts.map((a) => prisma.glAccount.create({ data: { tenantId, ...a } })));
}
