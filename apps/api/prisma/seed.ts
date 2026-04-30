import { PrismaClient } from '@prisma/client';
import { seedTiers } from './seed/tiers.js';
import { seedTenantAndUsers } from './seed/tenant.js';
import { seedPlatformAdmin } from './seed/platform-admin.js';
import { seedGlAccounts } from './seed/gl-accounts.js';
import { seedLocations } from './seed/locations.js';
import { seedSlips } from './seed/slips.js';
import { seedDockageRates } from './seed/dockage-rates.js';
import { seedCustomersAndBoats } from './seed/customers.js';
import { seedContracts } from './seed/contracts.js';
import { seedInvoicesAndPayments } from './seed/invoices.js';
import { seedLeadsAndWaitlist } from './seed/leads.js';
import { seedRentals } from './seed/rentals.js';
import { seedProductCategories } from './seed/product-categories.js';
import { seedPosAndInventory } from './seed/pos.js';
import { seedOperations } from './seed/operations.js';

const prisma = new PrismaClient();

// --------------------------------------------------------------------------
// Production safety guard
//
// The seed pipeline TRUNCATEs every user-data table. Running it against a
// populated production DB would erase real customer data, so when
// NODE_ENV=production we refuse to run unless either:
//
//   (a) the DB is genuinely empty (no tenants AND no users), or
//   (b) the operator passed an explicit override:
//       HELM_PROD_SEED_CONFIRM=yes
//
// This check runs BEFORE we touch any table — the guard cannot itself be
// the thing that nukes prod.
// --------------------------------------------------------------------------
async function assertProdSeedAllowed(): Promise<void> {
  if (process.env.NODE_ENV !== 'production') return;

  const override = process.env.HELM_PROD_SEED_CONFIRM === 'yes';
  if (override) {
    console.warn(
      '⚠️  HELM_PROD_SEED_CONFIRM=yes set — running prod seed against a non-empty database is destructive.',
    );
    return;
  }

  const [tenantCount, userCount] = await Promise.all([
    prisma.tenant.count(),
    prisma.user.count(),
  ]);

  if (tenantCount === 0 && userCount === 0) {
    console.log('🟢 Empty production database detected — proceeding with first-run seed.');
    return;
  }

  console.error(
    [
      '',
      '🛑 Refusing to seed: NODE_ENV=production and the database is not empty.',
      `   Found ${tenantCount} tenant(s) and ${userCount} user(s).`,
      '   The seed pipeline truncates all user-data tables, so running it here',
      '   would destroy real customer data.',
      '',
      '   To proceed anyway (this WILL wipe everything), re-run with:',
      '       HELM_PROD_SEED_CONFIRM=yes pnpm db:seed:prod',
      '',
    ].join('\n'),
  );
  process.exit(1);
}

async function main() {
  await assertProdSeedAllowed();

  console.log('🚢 Seeding Helm database...\n');

  // Order matters for foreign keys
  const tiers = await seedTiers(prisma);
  console.log(`  ✓ ${tiers.length} SaaS tiers`);

  const { tenant, users } = await seedTenantAndUsers(prisma, tiers[1].id);
  console.log(`  ✓ Tenant: ${tenant.name}`);
  console.log(`  ✓ ${users.length} staff users`);

  // Platform Admin lives outside the demo tenant's role hierarchy and is
  // what we sign in as on the admin app. Seeding here so the user shows
  // up under requirePlatformAdmin in every environment, including prod.
  const platformAdmin = await seedPlatformAdmin(prisma, tenant.id);
  console.log(`  ✓ Platform admin: ${platformAdmin.email}`);

  // GL accounts are intentionally NOT seeded — tenants connect QuickBooks
  // and import their real chart of accounts from Settings → Accounting.
  await seedGlAccounts(prisma, tenant.id);
  console.log('  ✓ GL accounts skipped (import from QuickBooks)');

  // Locations must come before slips, rentals, pos, leads, and operations
  const locations = await seedLocations(prisma, tenant.id);
  console.log(`  ✓ ${locations.length} locations`);

  // Slips now receive locations so they can be assigned inline
  const slips = await seedSlips(prisma, tenant.id, locations);
  console.log(`  ✓ ${slips.length} slips across 3 docks`);

  const dockageRateCount = await seedDockageRates(prisma, tenant.id, locations);
  console.log(`  ✓ ${dockageRateCount} dockage rates`);

  const { customers, boats } = await seedCustomersAndBoats(prisma, tenant.id);
  console.log(`  ✓ ${customers.length} customers`);
  console.log(`  ✓ ${boats.length} boats`);

  const contracts = await seedContracts(prisma, tenant.id, customers, boats, slips);
  console.log(`  ✓ ${contracts.length} slip contracts`);

  const { invoices, payments } = await seedInvoicesAndPayments(prisma, tenant.id, customers, contracts, slips);
  console.log(`  ✓ ${invoices.length} invoices`);
  console.log(`  ✓ ${payments.length} payments`);

  const { leads, waitlist } = await seedLeadsAndWaitlist(prisma, tenant.id, locations);
  console.log(`  ✓ ${leads.length} leads`);
  console.log(`  ✓ ${waitlist.length} waitlist entries`);

  const { products: rentalProducts, reservations } = await seedRentals(prisma, tenant.id, customers, locations);
  console.log(`  ✓ ${rentalProducts.length} rental products`);
  console.log(`  ✓ ${reservations.length} reservations`);

  const productCategories = await seedProductCategories(prisma, tenant.id);
  console.log(`  ✓ ${Object.keys(productCategories).length} product categories`);

  const { products: posProducts, transactions } = await seedPosAndInventory(
    prisma,
    tenant.id,
    users,
    locations,
    productCategories,
  );
  console.log(`  ✓ ${posProducts.length} POS products`);
  console.log(`  ✓ ${transactions.length} POS transactions`);

  const { walks, announcements } = await seedOperations(prisma, tenant.id, users, slips, customers, locations);
  console.log(`  ✓ ${walks.length} dock walks`);
  console.log(`  ✓ ${announcements.length} announcements`);

  console.log('\n✅ Seed complete!');
}

main()
  .catch((e) => { console.error('❌ Seed failed:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
