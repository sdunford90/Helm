import { PrismaClient } from '@prisma/client';
import { seedTiers } from './seed/tiers.js';
import { seedTenantAndUsers } from './seed/tenant.js';
import { seedGlAccounts } from './seed/gl-accounts.js';
import { seedSlips } from './seed/slips.js';
import { seedCustomersAndBoats } from './seed/customers.js';
import { seedContracts } from './seed/contracts.js';
import { seedInvoicesAndPayments } from './seed/invoices.js';
import { seedLeadsAndWaitlist } from './seed/leads.js';
import { seedRentals } from './seed/rentals.js';
import { seedPosAndInventory } from './seed/pos.js';
import { seedOperations } from './seed/operations.js';

const prisma = new PrismaClient();

async function main() {
  console.log('🚢 Seeding Helm database...\n');

  // Order matters for foreign keys
  const tiers = await seedTiers(prisma);
  console.log(`  ✓ ${tiers.length} SaaS tiers`);

  const { tenant, users } = await seedTenantAndUsers(prisma, tiers[1].id);
  console.log(`  ✓ Tenant: ${tenant.name}`);
  console.log(`  ✓ ${users.length} staff users`);

  const glAccounts = await seedGlAccounts(prisma, tenant.id);
  console.log(`  ✓ ${glAccounts.length} GL accounts`);

  const slips = await seedSlips(prisma, tenant.id);
  console.log(`  ✓ ${slips.length} slips across 3 docks`);

  const { customers, boats } = await seedCustomersAndBoats(prisma, tenant.id);
  console.log(`  ✓ ${customers.length} customers`);
  console.log(`  ✓ ${boats.length} boats`);

  const contracts = await seedContracts(prisma, tenant.id, customers, boats, slips);
  console.log(`  ✓ ${contracts.length} slip contracts`);

  const { invoices, payments } = await seedInvoicesAndPayments(prisma, tenant.id, customers, contracts);
  console.log(`  ✓ ${invoices.length} invoices`);
  console.log(`  ✓ ${payments.length} payments`);

  const { leads, waitlist } = await seedLeadsAndWaitlist(prisma, tenant.id);
  console.log(`  ✓ ${leads.length} leads`);
  console.log(`  ✓ ${waitlist.length} waitlist entries`);

  const { products: rentalProducts, reservations } = await seedRentals(prisma, tenant.id, customers);
  console.log(`  ✓ ${rentalProducts.length} rental products`);
  console.log(`  ✓ ${reservations.length} reservations`);

  const { products: posProducts, transactions } = await seedPosAndInventory(prisma, tenant.id, users);
  console.log(`  ✓ ${posProducts.length} POS products`);
  console.log(`  ✓ ${transactions.length} POS transactions`);

  const { walks, announcements } = await seedOperations(prisma, tenant.id, users, slips);
  console.log(`  ✓ ${walks.length} dock walks`);
  console.log(`  ✓ ${announcements.length} announcements`);

  console.log('\n✅ Seed complete!');
}

main()
  .catch((e) => { console.error('❌ Seed failed:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
