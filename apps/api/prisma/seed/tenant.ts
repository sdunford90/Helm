import type { PrismaClient } from '@prisma/client';

export async function seedTenantAndUsers(prisma: PrismaClient, tierId: string) {
  // Wipe all user-data tables in one shot — dynamically so we never miss a table
  // Exclude system/lookup tables: saas_tiers, _prisma_migrations, tax_jurisdictions, tax_rates,
  // platform_settings (singleton config row that should survive reseeds).
  const EXCLUDE = new Set([
    '_prisma_migrations',
    'saas_tiers',
    'tax_jurisdictions',
    'tax_rates',
    'platform_settings',
  ]);
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
      name: 'Demo Marina',
      subdomain: 'demo',
      customDomain: 'app.demomarina.example',
      status: 'ACTIVE',
      saasTierId: tierId,
      timezone: 'America/New_York',
      fiscalYearEnd: '12/31',
      brandingJson: {
        logo: null,
        primaryColor: '#0A2342',
        accentColor: '#00D4FF',
        marinaName: 'Demo Marina',
        tagline: 'Sample data for click-through testing',
      },
      invoiceTemplateJson: { prefix: 'INV-', nextNumber: 1050, paymentTerms: 'NET_30', lateFeePercent: 1.5, gracePeriodDays: 5, defaultTaxRate: 7.0 },
    },
  });

  const users = await Promise.all([
    prisma.user.create({ data: { tenantId: tenant.id, email: 'sarah@demomarina.example', role: 'MARINA_OWNER', firstName: 'Sarah', lastName: 'Dunford', active: true } }),
    prisma.user.create({ data: { tenantId: tenant.id, email: 'jake@demomarina.example', role: 'MARINA_MANAGER', firstName: 'Jake', lastName: 'Martinez', active: true } }),
    prisma.user.create({ data: { tenantId: tenant.id, email: 'maria@demomarina.example', role: 'DOCK_STAFF', firstName: 'Maria', lastName: 'Santos', active: true } }),
    prisma.user.create({ data: { tenantId: tenant.id, email: 'tom@demomarina.example', role: 'POS_CASHIER', firstName: 'Tom', lastName: 'Anderson', active: true } }),
    prisma.user.create({ data: { tenantId: tenant.id, email: 'lisa@demomarina.example', role: 'ACCOUNTING', firstName: 'Lisa', lastName: 'Chen', active: true } }),
    prisma.user.create({ data: { tenantId: tenant.id, email: 'robert@demomarina.example', role: 'DOCK_STAFF', firstName: 'Robert', lastName: 'Garcia', active: true } }),
  ]);

  return { tenant, users };
}
