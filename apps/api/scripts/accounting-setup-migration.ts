import { prisma } from "../src/lib/prisma.js";

async function main() {
  const locations = await prisma.location.findMany({
    select: {
      id: true,
      tenantId: true,
      name: true,
      qboRealmId: true,
      accountingSetupComplete: true,
      arGlAccountId: true,
      undepositedFundsGlAccountId: true,
      deferredRevenueGlAccountId: true,
      defaultRevenueGlAccountId: true,
      salesTaxGlAccountId: true,
      // Task #353 — earlyTermination/achReturnFee are no longer Location
      // pins; they live on per-location system ServiceFee products.
      _count: {
        select: {
          glAccounts: true,
          productCategoryGlMappings: true,
        },
      },
    },
  });

  let autoComplete = 0;
  let gracePeriod = 0;
  let needsSetup = 0;

  for (const loc of locations) {
    if (loc.accountingSetupComplete) {
      console.log(`[SKIP] ${loc.name} — already complete`);
      continue;
    }

    const hasQbo = !!loc.qboRealmId;
    const hasChartOfAccounts = loc._count.glAccounts > 0;
    const postingAccountsSet = [
      loc.arGlAccountId,
      loc.undepositedFundsGlAccountId,
      loc.deferredRevenueGlAccountId,
      loc.defaultRevenueGlAccountId,
      loc.salesTaxGlAccountId,
    ].filter(Boolean).length >= 5; // require at least 5 of 7
    const hasCategoryMappings = loc._count.productCategoryGlMappings > 0;

    const isTierA = hasQbo && hasChartOfAccounts && postingAccountsSet && hasCategoryMappings;
    const isTierB = hasQbo && !isTierA;

    if (isTierA) {
      await prisma.location.update({
        where: { id: loc.id },
        data: {
          accountingSetupComplete: true,
          accountingSetupCompletedAt: new Date(),
          accountingSetupStep: 5,
        },
      });
      console.log(`[COMPLETE] ${loc.name} — auto-marked as setup complete`);
      autoComplete++;
    } else if (isTierB) {
      const gracePeriodEnd = new Date();
      gracePeriodEnd.setDate(gracePeriodEnd.getDate() + 30);
      await prisma.location.update({
        where: { id: loc.id },
        data: { accountingGracePeriodEndsAt: gracePeriodEnd },
      });
      console.log(`[GRACE] ${loc.name} — 30-day grace period set (expires ${gracePeriodEnd.toDateString()})`);
      gracePeriod++;
    } else {
      console.log(`[NEEDS SETUP] ${loc.name} — no QB connection, will require setup`);
      needsSetup++;
    }
  }

  console.log(`\nSummary: ${autoComplete} auto-complete, ${gracePeriod} grace period, ${needsSetup} need setup`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
