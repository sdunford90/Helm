import type { PrismaClient } from '@prisma/client';

export async function seedLocations(prisma: PrismaClient, tenantId: string) {
  const existing = await prisma.location.findMany({ where: { tenantId } });
  if (existing.length > 0) return existing;

  const locations = await Promise.all([
    prisma.location.create({
      data: {
        tenantId,
        name: 'Main Marina',
        address: '100 Harbor Drive',
        city: 'Bayshore',
        state: 'FL',
        zip: '34201',
        timezone: 'America/New_York',
        autoExecuteRenewals: true,
        brandingJson: { primaryColor: '#0A2342', accentColor: '#00D4FF' },
      },
    }),
    prisma.location.create({
      data: {
        tenantId,
        name: 'North Dock',
        address: '200 North Quay Road',
        city: 'Bayshore',
        state: 'FL',
        zip: '34202',
        timezone: 'America/New_York',
        autoExecuteRenewals: false,
        brandingJson: { primaryColor: '#0A2342', accentColor: '#00D4FF' },
      },
    }),
    prisma.location.create({
      data: {
        tenantId,
        name: 'South Cove',
        address: '50 South Cove Lane',
        city: 'Bayshore',
        state: 'FL',
        zip: '34203',
        timezone: 'America/New_York',
        autoExecuteRenewals: true,
        brandingJson: { primaryColor: '#0A2342', accentColor: '#00D4FF' },
      },
    }),
  ]);

  // Distribute existing slips across locations
  const slips = await prisma.slip.findMany({ where: { tenantId }, select: { id: true, dockId: true } });
  for (const slip of slips) {
    let locationId = locations[0].id;
    if (slip.dockId === 'B') locationId = locations[1].id;
    else if (slip.dockId === 'C') locationId = locations[2].id;
    await prisma.slip.update({ where: { id: slip.id }, data: { locationId } });
  }

  return locations;
}
