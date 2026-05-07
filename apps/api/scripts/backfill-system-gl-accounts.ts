import { PrismaClient } from '@prisma/client';
import { seedChartOfAccounts } from '../src/services/tenant-provisioning.js';

/**
 * Idempotent one-shot backfill: ensures every existing tenant has the full
 * "system" set of GL accounts the posting service hard-references by number
 * (1000 Bank, 1010 Stripe Clearing, 1200 A/R, 2300 Security Deposits Held,
 * plus the rest of `DEFAULT_GL_ACCOUNTS`). Older tenants — and tenants whose
 * chart-of-accounts seed was skipped during provisioning — were missing one
 * or more of these, causing security-deposit releases / contract creates to
 * 500 with `GL account NNNN not found for tenant ...`.
 *
 * Re-running this script is safe: `seedChartOfAccounts` skips any
 * accountNumber already present per tenant. Logs the per-tenant number of
 * rows created so an operator can confirm the gap closed.
 *
 * Wire-up: invoke alongside the deploy pipeline (e.g. `pnpm --filter
 * @helm/api exec tsx scripts/backfill-system-gl-accounts.ts`) once. Even
 * with the runtime auto-heal in `gl-posting.ts` this backfill is worth
 * running because (a) it surfaces any tenant that's still short of the
 * default chart instead of waiting for the first failed code path to heal
 * it, and (b) it covers accounts beyond the four hard-referenced "system"
 * ones (e.g. revenue account numbers) that the runtime path doesn't touch.
 */
async function main() {
  const prisma = new PrismaClient();
  let totalTenants = 0;
  let touchedTenants = 0;
  let totalCreated = 0;
  try {
    const tenants = await prisma.tenant.findMany({ select: { id: true, name: true } });
    totalTenants = tenants.length;
    for (const t of tenants) {
      const result = await seedChartOfAccounts(prisma, t.id);
      if (result.created > 0) {
        touchedTenants += 1;
        totalCreated += result.created;
        console.log(
          `[backfill-system-gl-accounts] tenant=${t.id} (${t.name}) — created ${result.created} missing account(s)`,
        );
      }
    }
    console.log(
      `[backfill-system-gl-accounts] done: ${touchedTenants}/${totalTenants} tenant(s) needed backfill, ${totalCreated} row(s) created total`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('[backfill-system-gl-accounts] FAILED:', err);
  process.exitCode = 1;
});
