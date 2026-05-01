import type { PrismaClient } from '@prisma/client';

export async function seedLocations(prisma: PrismaClient, tenantId: string) {
  const existing = await prisma.location.findMany({ where: { tenantId } });
  if (existing.length > 0) return existing;

  return Promise.all([
    prisma.location.create({
      data: {
        tenantId,
        name: 'Sunset Harbor',
        address: '1400 Marina Drive',
        city: 'Sarasota',
        state: 'FL',
        zip: '34236',
        phone: '9415550100',
        timezone: 'America/New_York',
        autoExecuteRenewals: true,
        // accountingSetupComplete is set after GL accounts are wired up
        // (updated in gl-accounts.ts after accounts are created)
        accountingSetupComplete: false,
        brandingJson: { primaryColor: '#0D4F6B', accentColor: '#F4A623' },
      },
    }),
    prisma.location.create({
      data: {
        tenantId,
        name: 'Pelican Cove',
        address: '850 Harbor Boulevard',
        city: 'Venice',
        state: 'FL',
        zip: '34285',
        phone: '9415550200',
        timezone: 'America/New_York',
        autoExecuteRenewals: false,
        brandingJson: { primaryColor: '#0D4F6B', accentColor: '#F4A623' },
      },
    }),
  ]);
}
