import type { PrismaClient, Location } from '@prisma/client';

export async function seedSlips(prisma: PrismaClient, tenantId: string, locations: Location[]) {
  await prisma.slip.deleteMany({ where: { tenantId } });

  const sunsetHarborId = locations[0]?.id;

  const slips = [
    // Dock A — 30ft slips
    { slipNumber: 'A-1', dockId: 'A', lengthFt: 30, beamFt: 10, depthFt: 5, slipType: 'Open', shorePower: '30A', status: 'OCCUPIED' as const, electricityMode: 'METERED' as const, flatFeeCents: 0, kwhRateCents: 12, transientCapable: false },
    { slipNumber: 'A-2', dockId: 'A', lengthFt: 30, beamFt: 10, depthFt: 5, slipType: 'Open', shorePower: '30A', status: 'VACANT' as const, electricityMode: 'METERED' as const, flatFeeCents: 0, kwhRateCents: 12, transientCapable: true },
    { slipNumber: 'A-3', dockId: 'A', lengthFt: 30, beamFt: 10, depthFt: 5, slipType: 'Open', shorePower: '30A', status: 'OCCUPIED' as const, electricityMode: 'FLAT_FEE' as const, flatFeeCents: 6000, kwhRateCents: 0, transientCapable: false },
    { slipNumber: 'A-4', dockId: 'A', lengthFt: 30, beamFt: 10, depthFt: 5, slipType: 'Open', shorePower: '30A/50A', status: 'RESERVED' as const, electricityMode: 'METERED' as const, flatFeeCents: 0, kwhRateCents: 12, transientCapable: false },
    { slipNumber: 'A-5', dockId: 'A', lengthFt: 30, beamFt: 10, depthFt: 5, slipType: 'Open', shorePower: '30A', status: 'OCCUPIED' as const, electricityMode: 'METERED' as const, flatFeeCents: 0, kwhRateCents: 12, transientCapable: false },
    // Dock B — 40ft slips
    { slipNumber: 'B-1', dockId: 'B', lengthFt: 40, beamFt: 14, depthFt: 7, slipType: 'Covered', shorePower: '30A/50A', status: 'VACANT' as const, electricityMode: 'METERED' as const, flatFeeCents: 0, kwhRateCents: 12, transientCapable: true },
    { slipNumber: 'B-2', dockId: 'B', lengthFt: 40, beamFt: 14, depthFt: 7, slipType: 'Covered', shorePower: '50A', status: 'OCCUPIED' as const, electricityMode: 'METERED' as const, flatFeeCents: 0, kwhRateCents: 12, transientCapable: false },
    { slipNumber: 'B-3', dockId: 'B', lengthFt: 40, beamFt: 14, depthFt: 7, slipType: 'Covered', shorePower: '50A', status: 'OCCUPIED' as const, electricityMode: 'METERED' as const, flatFeeCents: 0, kwhRateCents: 12, transientCapable: false },
    { slipNumber: 'B-4', dockId: 'B', lengthFt: 40, beamFt: 14, depthFt: 7, slipType: 'Covered', shorePower: '30A/50A', status: 'MAINTENANCE' as const, electricityMode: 'METERED' as const, flatFeeCents: 0, kwhRateCents: 12, transientCapable: false },
    { slipNumber: 'B-5', dockId: 'B', lengthFt: 40, beamFt: 14, depthFt: 7, slipType: 'Covered', shorePower: '50A', status: 'OCCUPIED' as const, electricityMode: 'FLAT_FEE' as const, flatFeeCents: 12000, kwhRateCents: 0, transientCapable: false },
  ];

  return Promise.all(slips.map((s) =>
    prisma.slip.create({
      data: {
        tenantId,
        locationId: sunsetHarborId,
        ...s,
      },
    }),
  ));
}
