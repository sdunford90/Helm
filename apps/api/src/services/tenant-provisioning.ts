import type { prisma as prismaClient } from "../lib/prisma.js";

type PrismaLike = typeof prismaClient;

// ---------------------------------------------------------------------------
// Tenant provisioning helpers
//
// Shared between POST /api/onboarding/start (first-time signup) and
// POST /api/onboarding/:tenantId/chart-of-accounts (re-run from the UI if
// the initial seed failed).
// ---------------------------------------------------------------------------

interface DefaultAccount {
  accountNumber: string;
  name: string;
  type: "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE";
  isDeferredRevenue?: boolean;
}

const DEFAULT_GL_ACCOUNTS: DefaultAccount[] = [
  // Assets
  { accountNumber: "1000", name: "Cash / Operating Bank", type: "ASSET" },
  { accountNumber: "1010", name: "Stripe Clearing", type: "ASSET" },
  // ACH settlements + undeposited (check / other) funds get their own
  // asset accounts so POS Z-out tender postings reconcile cleanly
  // against bank deposits and ACH batches (Task #320).
  { accountNumber: "1015", name: "ACH Clearing", type: "ASSET" },
  { accountNumber: "1020", name: "Undeposited Funds", type: "ASSET" },
  { accountNumber: "1200", name: "Accounts Receivable", type: "ASSET" },
  // Liabilities (deferred-revenue accounts flagged for rev-rec)
  { accountNumber: "2100", name: "Deferred Revenue - Slips", type: "LIABILITY", isDeferredRevenue: true },
  { accountNumber: "2110", name: "Deferred Revenue - Rentals", type: "LIABILITY", isDeferredRevenue: true },
  { accountNumber: "2210", name: "Customer Deposits", type: "LIABILITY" },
  // 2300 is the number `gl-posting.ts` (ACCOUNTS.SECURITY_DEPOSITS_HELD) has
  // always posted security-deposit liability journals against. The historical
  // seed mislabeled this row "Tips Payable" while creating an empty 2200
  // "Security Deposits Held" row that nothing posted to — confusing for
  // operators reconciling against QuickBooks. The 2200 row is dropped from
  // the default seed; existing tenants are renamed by
  // `scripts/backfill-system-gl-accounts.ts`.
  { accountNumber: "2300", name: "Security Deposits Held", type: "LIABILITY" },
  { accountNumber: "2400", name: "Sales Tax Payable", type: "LIABILITY" },
  { accountNumber: "2401", name: "State Sales Tax Payable", type: "LIABILITY" },
  { accountNumber: "2402", name: "County Sales Tax Payable", type: "LIABILITY" },
  { accountNumber: "2403", name: "City Sales Tax Payable", type: "LIABILITY" },
  // Revenue
  { accountNumber: "4010", name: "Slip Revenue", type: "REVENUE" },
  { accountNumber: "4020", name: "Transient Revenue", type: "REVENUE" },
  { accountNumber: "4030", name: "Rental Revenue", type: "REVENUE" },
  { accountNumber: "4040", name: "Damage Waiver Revenue", type: "REVENUE" },
  { accountNumber: "4050", name: "Fuel Revenue", type: "REVENUE" },
  { accountNumber: "4060", name: "Retail Revenue", type: "REVENUE" },
  { accountNumber: "4070", name: "Ramp Revenue", type: "REVENUE" },
  { accountNumber: "4080", name: "Concierge Revenue", type: "REVENUE" },
  { accountNumber: "4090", name: "Pump-Out Revenue", type: "REVENUE" },
  { accountNumber: "4100", name: "Electricity Revenue", type: "REVENUE" },
  // Expenses
  { accountNumber: "5000", name: "COGS", type: "EXPENSE" },
  { accountNumber: "5100", name: "Payment Processing Fees", type: "EXPENSE" },
  // POS Z-out cash drawer variance dump (Task #320). Debited when the
  // counted drawer comes up short; credited when over.
  { accountNumber: "5900", name: "Cash Over/Short", type: "EXPENSE" },
];

/**
 * Seed the default chart of accounts for a new tenant. Idempotent — skips any
 * accountNumber already present, so it's safe to re-run from the onboarding
 * UI after a partial failure.
 */
export async function seedChartOfAccounts(
  prisma: PrismaLike,
  tenantId: string,
): Promise<{ created: number }> {
  const existing = await prisma.glAccount.findMany({
    where: { tenantId },
    select: { accountNumber: true },
  });
  const existingNums = new Set(existing.map((a) => a.accountNumber));
  const toCreate = DEFAULT_GL_ACCOUNTS.filter(
    (a) => !existingNums.has(a.accountNumber),
  );

  if (toCreate.length === 0) return { created: 0 };

  await prisma.$transaction(
    toCreate.map((account) =>
      prisma.glAccount.create({
        data: {
          tenantId,
          accountNumber: account.accountNumber,
          name: account.name,
          type: account.type,
          isDeferredRevenue: account.isDeferredRevenue ?? false,
        },
      }),
    ),
  );

  return { created: toCreate.length };
}
