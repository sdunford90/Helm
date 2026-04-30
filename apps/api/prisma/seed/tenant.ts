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

  // Each location has its own QBO company file connection.
  // In dev/test these are seeded as mock-connected so the app works without live QBO.
  const locations = await Promise.all([
    prisma.location.create({
      data: {
        tenantId: tenant.id,
        name: 'Main Dock',
        address: '100 Marina Blvd',
        city: 'Bayshore',
        state: 'FL',
        zip: '33401',
        phone: '(561) 555-0100',
        timezone: 'America/New_York',
        qboConnected: true,
        qboCompanyName: 'Bayshore Marina LLC',
        qboRealmId: 'mock-realm-main',
        qboLastSync: new Date(),
        rentalGlMode: 'SINGLE',
      },
    }),
    prisma.location.create({
      data: {
        tenantId: tenant.id,
        name: 'Fuel Dock',
        address: '110 Marina Blvd',
        city: 'Bayshore',
        state: 'FL',
        zip: '33401',
        phone: '(561) 555-0110',
        timezone: 'America/New_York',
        qboConnected: false,
        rentalGlMode: 'SINGLE',
      },
    }),
    prisma.location.create({
      data: {
        tenantId: tenant.id,
        name: 'Rental Center',
        address: '120 Marina Blvd',
        city: 'Bayshore',
        state: 'FL',
        zip: '33401',
        phone: '(561) 555-0120',
        timezone: 'America/New_York',
        qboConnected: true,
        qboCompanyName: 'Bayshore Rentals LLC',
        qboRealmId: 'mock-realm-rental',
        qboLastSync: new Date(),
        rentalGlMode: 'PER_PRODUCT',
      },
    }),
  ]);

  const users = await Promise.all([
    prisma.user.create({ data: { tenantId: tenant.id, email: 'sarah@bayshoremarina.com', role: 'MARINA_OWNER', firstName: 'Sarah', lastName: 'Dunford', active: true } }),
    prisma.user.create({ data: { tenantId: tenant.id, email: 'jake@bayshoremarina.com', role: 'MARINA_MANAGER', firstName: 'Jake', lastName: 'Martinez', active: true } }),
    prisma.user.create({ data: { tenantId: tenant.id, email: 'maria@bayshoremarina.com', role: 'DOCK_STAFF', firstName: 'Maria', lastName: 'Santos', active: true } }),
    prisma.user.create({ data: { tenantId: tenant.id, email: 'tom@bayshoremarina.com', role: 'POS_CASHIER', firstName: 'Tom', lastName: 'Anderson', active: true } }),
    prisma.user.create({ data: { tenantId: tenant.id, email: 'lisa@bayshoremarina.com', role: 'ACCOUNTING', firstName: 'Lisa', lastName: 'Chen', active: true } }),
    prisma.user.create({ data: { tenantId: tenant.id, email: 'robert@bayshoremarina.com', role: 'DOCK_STAFF', firstName: 'Robert', lastName: 'Garcia', active: true } }),
  ]);

  return { tenant, locations, users };
}
