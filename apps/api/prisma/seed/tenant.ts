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
      name: 'Sunset Harbor Marina Group',
      subdomain: 'sunset-harbor',
      customDomain: 'app.sunsetharbormarinas.example',
      status: 'ACTIVE',
      saasTierId: tierId,
      timezone: 'America/New_York',
      fiscalYearEnd: '12/31',
      brandingJson: {
        logo: null,
        primaryColor: '#0D4F6B',
        accentColor: '#F4A623',
        marinaName: 'Sunset Harbor Marina',
        tagline: 'Your home on the water — Sarasota, FL',
      },
      invoiceTemplateJson: {
        prefix: 'SHM-',
        nextNumber: 1001,
        paymentTerms: 'NET_30',
        lateFeePercent: 1.5,
        gracePeriodDays: 5,
        defaultTaxRate: 7.0,
      },
    },
  });

  const users = await Promise.all([
    prisma.user.create({
      data: {
        tenantId: tenant.id,
        email: 'sarahchen@sunsetharbormarinas.com',
        role: 'TENANT_ADMIN',
        firstName: 'Sarah',
        lastName: 'Chen',
        active: true,
      },
    }),
    prisma.user.create({
      data: {
        tenantId: tenant.id,
        email: 'miketorres@sunsetharbormarinas.com',
        role: 'MARINA_MANAGER',
        firstName: 'Mike',
        lastName: 'Torres',
        active: true,
      },
    }),
    prisma.user.create({
      data: {
        tenantId: tenant.id,
        email: 'jessicanguyen@sunsetharbormarinas.com',
        role: 'ACCOUNTING',
        firstName: 'Jessica',
        lastName: 'Nguyen',
        active: true,
      },
    }),
    prisma.user.create({
      data: {
        tenantId: tenant.id,
        email: 'tylerbrooks@sunsetharbormarinas.com',
        role: 'DOCK_STAFF',
        firstName: 'Tyler',
        lastName: 'Brooks',
        active: true,
      },
    }),
    prisma.user.create({
      data: {
        tenantId: tenant.id,
        email: 'amandaross@sunsetharbormarinas.com',
        role: 'POS_CASHIER',
        firstName: 'Amanda',
        lastName: 'Ross',
        active: true,
      },
    }),
    prisma.user.create({
      data: {
        tenantId: tenant.id,
        email: 'carlosreyes@sunsetharbormarinas.com',
        role: 'MARINA_MANAGER',
        firstName: 'Carlos',
        lastName: 'Reyes',
        active: true,
      },
    }),
  ]);

  return { tenant, users };
}
