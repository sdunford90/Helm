import type { PrismaClient } from '@prisma/client';

export async function seedTenantAndUsers(prisma: PrismaClient, tierId: string) {
  // Wipe all user-data tables in one shot — dynamically so we never miss a table
  // Exclude system/lookup tables: saas_tiers, _prisma_migrations, tax_jurisdictions, tax_rates
  const EXCLUDE = new Set(['_prisma_migrations', 'saas_tiers', 'tax_jurisdictions', 'tax_rates']);
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename
  `;
  const toTruncate = tables
    .map((t) => t.tablename)
    .filter((t) => !EXCLUDE.has(t))
    .map((t) => `"${t}"`)
    .join(', ');
  if (toTruncate) {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${toTruncate} RESTART IDENTITY CASCADE`);
  }

  const tenant = await prisma.tenant.create({
    data: {
      name: 'Bayshore Marina',
      subdomain: 'bayshore',
      customDomain: 'app.bayshoremarina.com',
      status: 'ACTIVE',
      saasTierId: tierId,
      timezone: 'America/New_York',
      fiscalYearEnd: '12/31',
      brandingJson: { logo: null, primaryColor: '#0A2342', accentColor: '#00D4FF', marinaName: 'Bayshore Marina', tagline: 'Your home on the water' },
      invoiceTemplateJson: { prefix: 'INV-', nextNumber: 1050, paymentTerms: 'NET_30', lateFeePercent: 1.5, gracePeriodDays: 5, defaultTaxRate: 7.0 },
    },
  });

  const users = await Promise.all([
    prisma.user.create({ data: { tenantId: tenant.id, email: 'sarah@bayshoremarina.com', role: 'MARINA_OWNER', firstName: 'Sarah', lastName: 'Dunford', active: true } }),
    prisma.user.create({ data: { tenantId: tenant.id, email: 'jake@bayshoremarina.com', role: 'MARINA_MANAGER', firstName: 'Jake', lastName: 'Martinez', active: true } }),
    prisma.user.create({ data: { tenantId: tenant.id, email: 'maria@bayshoremarina.com', role: 'DOCK_STAFF', firstName: 'Maria', lastName: 'Santos', active: true } }),
    prisma.user.create({ data: { tenantId: tenant.id, email: 'tom@bayshoremarina.com', role: 'POS_CASHIER', firstName: 'Tom', lastName: 'Anderson', active: true } }),
    prisma.user.create({ data: { tenantId: tenant.id, email: 'lisa@bayshoremarina.com', role: 'ACCOUNTING', firstName: 'Lisa', lastName: 'Chen', active: true } }),
    prisma.user.create({ data: { tenantId: tenant.id, email: 'robert@bayshoremarina.com', role: 'DOCK_STAFF', firstName: 'Robert', lastName: 'Garcia', active: true } }),
  ]);

  return { tenant, users };
}
