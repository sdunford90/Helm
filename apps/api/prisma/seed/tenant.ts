import type { PrismaClient } from '@prisma/client';

export async function seedTenantAndUsers(prisma: PrismaClient, tierId: string) {
  await prisma.user.deleteMany();
  await prisma.tenant.deleteMany();

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
