import type { PrismaClient } from '@prisma/client';

/**
 * Account numbers that services/gl-posting.ts looks up by number (its
 * ACCOUNTS map). Every one of these MUST exist in the seeded chart of
 * accounts, or invoice/payment/refund/deposit/ACH/termination posting throws
 * "GL account <n> not found". Keep in sync with gl-posting.ts.
 */
export const GL_POSTING_ACCOUNT_NUMBERS = [
  '1000', // CASH
  '1010', // BANK
  '1200', // ACCOUNTS_RECEIVABLE
  '2300', // SECURITY_DEPOSITS_HELD
  '2400', // DEFERRED_REVENUE
  '4000', // SLIP_RENTAL_REVENUE
  '4100', // ELECTRICITY_REVENUE
  '4500', // GENERAL_REVENUE
  '4600', // ACH_RETURN_FEE_REVENUE
  '4700', // TERMINATION_INCOME
] as const;

export const SEED_GL_ACCOUNTS = [
  // Assets
  { accountNumber: '1000', name: 'Cash on Hand', type: 'ASSET', subType: 'current' },
  { accountNumber: '1010', name: 'Operating Bank Account', type: 'ASSET', subType: 'current' },
  { accountNumber: '1020', name: 'Stripe Clearing', type: 'ASSET', subType: 'current' },
  { accountNumber: '1030', name: 'ACH Clearing', type: 'ASSET', subType: 'current' },
  { accountNumber: '1200', name: 'Accounts Receivable', type: 'ASSET', subType: 'current' },
  // Liabilities
  { accountNumber: '2300', name: 'Security Deposits Held', type: 'LIABILITY', subType: 'current' },
  { accountNumber: '2400', name: 'Deferred Revenue — Slips', type: 'LIABILITY', subType: 'current', isDeferredRevenue: true },
  { accountNumber: '2500', name: 'Customer Deposits', type: 'LIABILITY', subType: 'current' },
  { accountNumber: '2600', name: 'Sales Tax Payable', type: 'LIABILITY', subType: 'current' },
  { accountNumber: '2700', name: 'Tips Payable', type: 'LIABILITY', subType: 'current' },
  // Equity
  { accountNumber: '3000', name: 'Retained Earnings', type: 'EQUITY', subType: 'equity' },
  // Revenue
  { accountNumber: '4000', name: 'Slip Revenue', type: 'REVENUE', subType: 'operating' },
  { accountNumber: '4100', name: 'Electricity Revenue', type: 'REVENUE', subType: 'operating' },
  { accountNumber: '4200', name: 'Rental Revenue', type: 'REVENUE', subType: 'operating' },
  { accountNumber: '4250', name: 'Damage Waiver Revenue', type: 'REVENUE', subType: 'operating' },
  { accountNumber: '4300', name: 'Fuel Revenue', type: 'REVENUE', subType: 'operating' },
  { accountNumber: '4350', name: 'Retail Revenue', type: 'REVENUE', subType: 'operating' },
  { accountNumber: '4400', name: 'Transient Revenue', type: 'REVENUE', subType: 'operating' },
  { accountNumber: '4410', name: 'Ramp Revenue', type: 'REVENUE', subType: 'operating' },
  { accountNumber: '4420', name: 'Concierge Revenue', type: 'REVENUE', subType: 'operating' },
  { accountNumber: '4500', name: 'General Revenue', type: 'REVENUE', subType: 'operating' },
  { accountNumber: '4600', name: 'ACH Return Fee Revenue', type: 'REVENUE', subType: 'operating' },
  { accountNumber: '4700', name: 'Early Termination Income', type: 'REVENUE', subType: 'operating' },
  { accountNumber: '4800', name: 'Late Fee Revenue', type: 'REVENUE', subType: 'operating' },
  // Cost of goods sold (EXPENSE + subType "cogs"; see reports.ts P&L)
  { accountNumber: '5100', name: 'Fuel Cost of Goods Sold', type: 'EXPENSE', subType: 'cogs' },
  { accountNumber: '5200', name: 'Retail Cost of Goods Sold', type: 'EXPENSE', subType: 'cogs' },
  // Operating expenses
  { accountNumber: '6100', name: 'Operating Expenses', type: 'EXPENSE', subType: 'operating' },
  { accountNumber: '6200', name: 'Maintenance & Repairs', type: 'EXPENSE', subType: 'operating' },
  { accountNumber: '6300', name: 'Insurance Expense', type: 'EXPENSE', subType: 'operating' },
] as const;

export async function seedGlAccounts(prisma: PrismaClient, tenantId: string) {
  await prisma.glAccount.deleteMany({ where: { tenantId } });

  return Promise.all(
    SEED_GL_ACCOUNTS.map((a) => prisma.glAccount.create({ data: { tenantId, ...a } })),
  );
}
