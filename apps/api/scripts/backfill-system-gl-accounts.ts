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
  let totalRenamed = 0;
  let totalPruned = 0;
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

      // Rename mislabeled 2300 rows from the historical seed. Deposits have
      // always posted to 2300 — only the display name was wrong — so a pure
      // rename preserves the entry history without re-pointing any GlEntry.
      const renamed = await prisma.glAccount.updateMany({
        where: {
          tenantId: t.id,
          accountNumber: '2300',
          name: 'Tips Payable',
        },
        data: { name: 'Security Deposits Held' },
      });
      if (renamed.count > 0) {
        totalRenamed += renamed.count;
        console.log(
          `[backfill-system-gl-accounts] tenant=${t.id} (${t.name}) — renamed ${renamed.count} '2300 Tips Payable' row(s) to 'Security Deposits Held'`,
        );
      }

      // Prune the unused 2200 'Security Deposits Held' rows seeded by the
      // historical chart. Only delete rows that are completely unreferenced
      // — no posted entries, no invoice line items, not pinned as a
      // location's posting account, and not used in any product / rental
      // / dockage / service-fee GL mapping. Anything an operator has
      // already wired up stays put even if the name overlaps.
      const orphan2200 = await prisma.glAccount.findMany({
        where: {
          tenantId: t.id,
          accountNumber: '2200',
          name: 'Security Deposits Held',
          entries: { none: {} },
          lineItems: { none: {} },
          locationsBankAccount: { none: {} },
          locationsAr: { none: {} },
          locationsUndepositedFunds: { none: {} },
          locationsDeferredRevenue: { none: {} },
          locationsDefaultRevenue: { none: {} },
          locationsSalesTax: { none: {} },
          locationsEarlyTermination: { none: {} },
          locationsAchReturnFee: { none: {} },
          rentalProductGlMappingsRevenue: { none: {} },
          productCategoryGlMappingsRevenue: { none: {} },
          productCategoryGlMappingsCogs: { none: {} },
          productCategoryGlMappingsInventoryAsset: { none: {} },
          dockageRateGlMappings: { none: {} },
          serviceFeeGlMappings: { none: {} },
        },
        select: { id: true },
      });
      if (orphan2200.length > 0) {
        const pruned = await prisma.glAccount.deleteMany({
          where: { id: { in: orphan2200.map((r) => r.id) } },
        });
        totalPruned += pruned.count;
        console.log(
          `[backfill-system-gl-accounts] tenant=${t.id} (${t.name}) — pruned ${pruned.count} unused '2200 Security Deposits Held' row(s)`,
        );
      }
    }
    console.log(
      `[backfill-system-gl-accounts] done: ${touchedTenants}/${totalTenants} tenant(s) needed backfill, ${totalCreated} row(s) created, ${totalRenamed} '2300' row(s) renamed, ${totalPruned} unused '2200' row(s) pruned`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('[backfill-system-gl-accounts] FAILED:', err);
  process.exitCode = 1;
});
