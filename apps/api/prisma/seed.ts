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

async function seedTaxJurisdictions(
  prisma: PrismaClient,
  tenantId: string,
  locationId: string,
) {
  // Tax jurisdictions are excluded from the TRUNCATE so we upsert them
  const fl = await prisma.taxJurisdiction.upsert({
    where: { tenantId_code: { tenantId, code: 'FL-STATE' } },
    update: {},
    create: {
      tenantId,
      code: 'FL-STATE',
      name: 'Florida State Tax',
      kind: 'STATE',
    },
  });

  const sarasota = await prisma.taxJurisdiction.upsert({
    where: { tenantId_code: { tenantId, code: 'FL-SARASOTA' } },
    update: {},
    create: {
      tenantId,
      code: 'FL-SARASOTA',
      name: 'Sarasota County Surtax',
      kind: 'COUNTY',
    },
  });

  // Tax rates
  const now = new Date('2025-01-01');

  await prisma.taxRate.upsert({
    where: { id: `seed-rate-fl-general` },
    update: {},
    create: {
      id: `seed-rate-fl-general`,
      tenantId,
      jurisdictionId: fl.id,
      category: 'general',
      ratePctBps: 600, // 6.0%
      effectiveFrom: now,
    },
  });

  await prisma.taxRate.upsert({
    where: { id: `seed-rate-sarasota-general` },
    update: {},
    create: {
      id: `seed-rate-sarasota-general`,
      tenantId,
      jurisdictionId: sarasota.id,
      category: 'general',
      ratePctBps: 100, // 1.0%
      effectiveFrom: now,
    },
  });

  // Link both jurisdictions to the primary location
  await prisma.locationTaxJurisdiction.upsert({
    where: { locationId_jurisdictionId: { locationId, jurisdictionId: fl.id } },
    update: {},
    create: { tenantId, locationId, jurisdictionId: fl.id, sortOrder: 0 },
  });

  await prisma.locationTaxJurisdiction.upsert({
    where: { locationId_jurisdictionId: { locationId, jurisdictionId: sarasota.id } },
    update: {},
    create: { tenantId, locationId, jurisdictionId: sarasota.id, sortOrder: 1 },
  });

  return [fl, sarasota];
}

async function seedPurchaseOrders(
  prisma: PrismaClient,
  tenantId: string,
  locationId: string,
  products: any[],
  users: any[],
) {
  await prisma.poLineItem.deleteMany({ where: { tenantId } });
  await prisma.purchaseOrder.deleteMany({ where: { tenantId } });
  await prisma.vendor.deleteMany({ where: { tenantId } });

  // Create vendors
  const coastFuel = await prisma.vendor.create({
    data: {
      tenantId,
      name: 'Coast Petroleum Distributors',
      email: 'orders@coastpetro.example',
      phone: '8005551000',
      address: '3200 Industrial Blvd, Tampa, FL 33602',
      active: true,
    },
  });

  const marineSupply = await prisma.vendor.create({
    data: {
      tenantId,
      name: 'Gulf Marine Supply Co.',
      email: 'orders@gulfmarinesupply.example',
      phone: '8005552000',
      address: '750 Commerce Dr, Fort Myers, FL 33907',
      active: true,
    },
  });

  const regularFuel = products.find((p: any) => p.sku === 'FUEL-REG');
  const premiumFuel = products.find((p: any) => p.sku === 'FUEL-PRM');
  const dieselFuel = products.find((p: any) => p.sku === 'FUEL-DSL');
  const rope = products.find((p: any) => p.sku === 'SS-ROPE50');
  const dockLines = products.find((p: any) => p.sku === 'SS-DKLN');
  const cleaner = products.find((p: any) => p.sku === 'SS-CLNR');
  const lifeVest = products.find((p: any) => p.sku === 'SS-PFD');

  const receivingUser = users.find((u: any) => u.role === 'MARINA_MANAGER') ?? users[0];

  // PO 1 — RECEIVED (fuel delivery last week)
  const po1 = await prisma.purchaseOrder.create({
    data: {
      tenantId,
      locationId,
      vendorId: coastFuel.id,
      vendorName: coastFuel.name,
      poNumber: 'PO-2026-0041',
      status: 'RECEIVED',
      expectedDate: new Date('2026-04-18'),
      notes: 'Spring fuel top-off. Diesel increased volume for upcoming season.',
      totalCents: (5000 * 310) + (2000 * 320) + (8000 * 345),
      receivedAt: new Date('2026-04-19T09:30:00Z'),
      receivedByUserId: receivingUser.id,
    },
  });

  if (dieselFuel && regularFuel && premiumFuel) {
    await prisma.poLineItem.createMany({
      data: [
        { tenantId, purchaseOrderId: po1.id, productId: dieselFuel.id, productName: 'Diesel (gal)', quantity: 8000, unitCostCents: 310, receivedQty: 8000, receivedAt: new Date('2026-04-19'), unitCostAtReceipt: 310 },
        { tenantId, purchaseOrderId: po1.id, productId: regularFuel.id, productName: 'Regular Unleaded (gal)', quantity: 5000, unitCostCents: 320, receivedQty: 5000, receivedAt: new Date('2026-04-19'), unitCostAtReceipt: 320 },
        { tenantId, purchaseOrderId: po1.id, productId: premiumFuel.id, productName: 'Premium Unleaded (gal)', quantity: 2000, unitCostCents: 345, receivedQty: 2000, receivedAt: new Date('2026-04-19'), unitCostAtReceipt: 345 },
      ],
    });
  }

  // PO 2 — SUBMITTED (ship store order, awaiting delivery)
  const ropeQty = 12, linesQty = 15, cleanerQty = 24, vestQty = 10;
  const po2Total =
    (rope ? ropeQty * 1399 : 0) +
    (dockLines ? linesQty * 2199 : 0) +
    (cleaner ? cleanerQty * 799 : 0) +
    (lifeVest ? vestQty * 2799 : 0);

  const po2 = await prisma.purchaseOrder.create({
    data: {
      tenantId,
      locationId,
      vendorId: marineSupply.id,
      vendorName: marineSupply.name,
      poNumber: 'PO-2026-0042',
      status: 'SUBMITTED',
      expectedDate: new Date('2026-05-02'),
      notes: 'Ship store restock for peak season. Rush order for life vests.',
      totalCents: po2Total,
    },
  });

  const po2Lines = [
    rope && { tenantId, purchaseOrderId: po2.id, productId: rope.id, productName: 'Marine Rope 50ft', quantity: ropeQty, unitCostCents: 1399 },
    dockLines && { tenantId, purchaseOrderId: po2.id, productId: dockLines.id, productName: 'Dock Lines Set', quantity: linesQty, unitCostCents: 2199 },
    cleaner && { tenantId, purchaseOrderId: po2.id, productId: cleaner.id, productName: 'Boat Cleaner 32oz', quantity: cleanerQty, unitCostCents: 799 },
    lifeVest && { tenantId, purchaseOrderId: po2.id, productId: lifeVest.id, productName: 'Life Vest Adult', quantity: vestQty, unitCostCents: 2799 },
  ].filter(Boolean) as any[];

  if (po2Lines.length) {
    await prisma.poLineItem.createMany({ data: po2Lines });
  }

  // PO 3 — DRAFT (upcoming fuel order)
  const po3 = await prisma.purchaseOrder.create({
    data: {
      tenantId,
      locationId,
      vendorId: coastFuel.id,
      vendorName: coastFuel.name,
      poNumber: 'PO-2026-0043',
      status: 'DRAFT',
      expectedDate: new Date('2026-05-15'),
      notes: 'Mid-May fuel replenishment — adjust volumes based on Memorial Day weekend demand forecast.',
      totalCents: (6000 * 318) + (3000 * 348) + (10000 * 308),
    },
  });

  if (regularFuel && premiumFuel && dieselFuel) {
    await prisma.poLineItem.createMany({
      data: [
        { tenantId, purchaseOrderId: po3.id, productId: regularFuel.id, productName: 'Regular Unleaded (gal)', quantity: 6000, unitCostCents: 318 },
        { tenantId, purchaseOrderId: po3.id, productId: premiumFuel.id, productName: 'Premium Unleaded (gal)', quantity: 3000, unitCostCents: 348 },
        { tenantId, purchaseOrderId: po3.id, productId: dieselFuel.id, productName: 'Diesel (gal)', quantity: 10000, unitCostCents: 308 },
      ],
    });
  }

  return [po1, po2, po3];
}

async function main() {
  await assertProdSeedAllowed();

  console.log('🚢 Seeding Helm database — Sunset Harbor Marina...\n');

  // Order matters for foreign keys
  const tiers = await seedTiers(prisma);
  console.log(`  ✓ ${tiers.length} SaaS tiers`);

  const { tenant, users } = await seedTenantAndUsers(prisma, tiers[1].id);
  console.log(`  ✓ Tenant: ${tenant.name}`);
  console.log(`  ✓ ${users.length} staff users`);

  // Platform Admin lives outside the demo tenant's role hierarchy and is
  // what we sign in as on the admin app.
  const platformAdmin = await seedPlatformAdmin(prisma, tenant.id);
  console.log(`  ✓ Platform admin: ${platformAdmin.email}`);

  // Locations must come before GL accounts (GL accounts are scoped to location)
  const locations = await seedLocations(prisma, tenant.id);
  console.log(`  ✓ ${locations.length} locations`);

  // GL accounts — now seeded with realistic marina chart of accounts
  const glAccounts = await seedGlAccounts(prisma, tenant.id, locations);
  console.log(`  ✓ ${glAccounts.length} GL accounts (chart of accounts)`);
  console.log('  ✓ Accounting setup marked complete for Sunset Harbor');

  // Slips now receive locations so they can be assigned inline
  const slips = await seedSlips(prisma, tenant.id, locations);
  console.log(`  ✓ ${slips.length} slips (A-1..A-5, B-1..B-5)`);

  const dockageRateCount = await seedDockageRates(prisma, tenant.id, locations);
  console.log(`  ✓ ${dockageRateCount} dockage rates`);

  const { customers, boats } = await seedCustomersAndBoats(prisma, tenant.id);
  console.log(`  ✓ ${customers.length} customers`);
  console.log(`  ✓ ${boats.length} boats`);

  const contracts = await seedContracts(prisma, tenant.id, customers, boats, slips);
  console.log(`  ✓ ${contracts.length} slip contracts`);

  const { invoices, payments } = await seedInvoicesAndPayments(prisma, tenant.id, customers, contracts, slips);
  console.log(`  ✓ ${invoices.length} invoices (3 paid, 3 issued, 2 draft)`);
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
  console.log(`  ✓ ${posProducts.length} POS products (3 fuels + 6 ship store + 3 services)`);
  console.log(`  ✓ ${transactions.length} POS transactions`);

  // Purchase orders (3: received, submitted, draft)
  const primaryLocationId = locations[0].id;
  const purchaseOrders = await seedPurchaseOrders(
    prisma,
    tenant.id,
    primaryLocationId,
    posProducts,
    users,
  );
  console.log(`  ✓ ${purchaseOrders.length} purchase orders (1 received, 1 submitted, 1 draft)`);

  // Tax jurisdictions
  const taxJurisdictions = await seedTaxJurisdictions(
    prisma,
    tenant.id,
    primaryLocationId,
  );
  console.log(`  ✓ ${taxJurisdictions.length} tax jurisdictions (FL state + Sarasota county)`);

  const { walks, announcements } = await seedOperations(prisma, tenant.id, users, slips, customers, locations);
  console.log(`  ✓ ${walks.length} dock walks`);
  console.log(`  ✓ ${announcements.length} announcements`);
  console.log('  ✓ 5 audit log entries');

  console.log('\n✅ Seed complete — Sunset Harbor Marina is ready!');
}

main()
  .catch((e) => { console.error('❌ Seed failed:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
