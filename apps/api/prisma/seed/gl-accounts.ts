import type { PrismaClient } from '@prisma/client';

/**
 * GL accounts are NOT seeded.
 *
 * The product flow is: tenants connect QuickBooks Online from
 * Settings → Accounting → "Connect QuickBooks", then click "Import Chart of
 * Accounts" to pull their real chart in via the QBO API. Seeding fake GL
 * accounts here would either (a) get out of the way (the user re-imports
 * and our placeholders linger as orphans), or (b) collide on numbers with
 * real QBO accounts.
 *
 * We keep the deleteMany so reseeding a previously-populated tenant cleans
 * up any imported chart, leaving the tenant ready to reconnect QBO from a
 * known-empty state.
 */
export async function seedGlAccounts(prisma: PrismaClient, tenantId: string) {
  await prisma.glAccount.deleteMany({ where: { tenantId } });
  return [];
}
