import type { PrismaClient, Location } from '@prisma/client';

export async function seedSlips(prisma: PrismaClient, tenantId: string, locations: Location[]) {
  await prisma.slip.deleteMany({ where: { tenantId } });

  const locationByDock: Record<string, string> = {
    A: locations[0]?.id,
    B: locations[1]?.id ?? locations[0]?.id,
    C: locations[2]?.id ?? locations[0]?.id,
  };

  const slips = [
    // Dock A — Main Marina — 40ft covered, 30A/50A
    { slipNumber: 'A-01', dockId: 'A', lengthFt: 40, beamFt: 14, depthFt: 8, slipType: 'Covered', shorePower: '30A/50A', status: 'OCCUPIED' as const, electricityMode: 'METERED' as const, flatFeeCents: 0, kwhRateCents: 12 },
    { slipNumber: 'A-02', dockId: 'A', lengthFt: 40, beamFt: 14, depthFt: 8, slipType: 'Covered', shorePower: '30A', status: 'OCCUPIED' as const, electricityMode: 'FLAT_FEE' as const, flatFeeCents: 7500, kwhRateCents: 0 },
    { slipNumber: 'A-03', dockId: 'A', lengthFt: 35, beamFt: 12, depthFt: 7, slipType: 'Open', shorePower: '30A', status: 'VACANT' as const, electricityMode: 'METERED' as const, flatFeeCents: 0, kwhRateCents: 12 },
    { slipNumber: 'A-04', dockId: 'A', lengthFt: 35, beamFt: 12, depthFt: 7, slipType: 'Open', shorePower: '30A', status: 'RESERVED' as const, electricityMode: 'METERED' as const, flatFeeCents: 0, kwhRateCents: 12 },
    { slipNumber: 'A-05', dockId: 'A', lengthFt: 40, beamFt: 14, depthFt: 8, slipType: 'Covered', shorePower: '30A/50A', status: 'OCCUPIED' as const, electricityMode: 'METERED' as const, flatFeeCents: 0, kwhRateCents: 12 },
    { slipNumber: 'A-06', dockId: 'A', lengthFt: 35, beamFt: 12, depthFt: 7, slipType: 'Open', shorePower: '30A', status: 'OCCUPIED' as const, electricityMode: 'FLAT_FEE' as const, flatFeeCents: 6000, kwhRateCents: 0 },
    { slipNumber: 'A-07', dockId: 'A', lengthFt: 40, beamFt: 14, depthFt: 8, slipType: 'Covered', shorePower: '50A', status: 'OCCUPIED' as const, electricityMode: 'METERED' as const, flatFeeCents: 0, kwhRateCents: 12 },
    { slipNumber: 'A-08', dockId: 'A', lengthFt: 35, beamFt: 12, depthFt: 7, slipType: 'Open', shorePower: '30A', status: 'MAINTENANCE' as const, electricityMode: 'METERED' as const, flatFeeCents: 0, kwhRateCents: 12 },
    // Dock B — North Dock — 50ft covered, 50A/100A
    { slipNumber: 'B-01', dockId: 'B', lengthFt: 50, beamFt: 16, depthFt: 10, slipType: 'Covered', shorePower: '50A/100A', status: 'OCCUPIED' as const, electricityMode: 'METERED' as const, flatFeeCents: 0, kwhRateCents: 12 },
    { slipNumber: 'B-02', dockId: 'B', lengthFt: 50, beamFt: 16, depthFt: 10, slipType: 'Covered', shorePower: '50A', status: 'VACANT' as const, electricityMode: 'METERED' as const, flatFeeCents: 0, kwhRateCents: 12 },
    { slipNumber: 'B-03', dockId: 'B', lengthFt: 45, beamFt: 14, depthFt: 9, slipType: 'Covered', shorePower: '50A', status: 'OCCUPIED' as const, electricityMode: 'METERED' as const, flatFeeCents: 0, kwhRateCents: 12 },
    { slipNumber: 'B-04', dockId: 'B', lengthFt: 55, beamFt: 18, depthFt: 10, slipType: 'Covered', shorePower: '50A/100A', status: 'OCCUPIED' as const, electricityMode: 'METERED' as const, flatFeeCents: 0, kwhRateCents: 12 },
    { slipNumber: 'B-05', dockId: 'B', lengthFt: 50, beamFt: 16, depthFt: 10, slipType: 'Covered', shorePower: '50A', status: 'OCCUPIED' as const, electricityMode: 'FLAT_FEE' as const, flatFeeCents: 15000, kwhRateCents: 0 },
    { slipNumber: 'B-06', dockId: 'B', lengthFt: 45, beamFt: 14, depthFt: 9, slipType: 'Covered', shorePower: '50A', status: 'MAINTENANCE' as const, electricityMode: 'METERED' as const, flatFeeCents: 0, kwhRateCents: 12 },
    // Dock C — South Cove — 30ft open, 30A
    { slipNumber: 'C-01', dockId: 'C', lengthFt: 30, beamFt: 10, depthFt: 6, slipType: 'Open', shorePower: '30A', status: 'OCCUPIED' as const, electricityMode: 'FLAT_FEE' as const, flatFeeCents: 5000, kwhRateCents: 0 },
    { slipNumber: 'C-02', dockId: 'C', lengthFt: 30, beamFt: 10, depthFt: 6, slipType: 'Open', shorePower: '30A', status: 'OCCUPIED' as const, electricityMode: 'METERED' as const, flatFeeCents: 0, kwhRateCents: 12 },
    { slipNumber: 'C-03', dockId: 'C', lengthFt: 30, beamFt: 10, depthFt: 6, slipType: 'Open', shorePower: '30A', status: 'VACANT' as const, electricityMode: 'METERED' as const, flatFeeCents: 0, kwhRateCents: 12 },
    { slipNumber: 'C-04', dockId: 'C', lengthFt: 30, beamFt: 10, depthFt: 6, slipType: 'Open', shorePower: '30A', status: 'OCCUPIED' as const, electricityMode: 'METERED' as const, flatFeeCents: 0, kwhRateCents: 12 },
    { slipNumber: 'C-05', dockId: 'C', lengthFt: 28, beamFt: 10, depthFt: 6, slipType: 'Open', shorePower: '30A', status: 'OCCUPIED' as const, electricityMode: 'FLAT_FEE' as const, flatFeeCents: 4000, kwhRateCents: 0 },
    { slipNumber: 'C-06', dockId: 'C', lengthFt: 28, beamFt: 10, depthFt: 6, slipType: 'Open', shorePower: '30A', status: 'OCCUPIED' as const, electricityMode: 'METERED' as const, flatFeeCents: 0, kwhRateCents: 12 },
  ];

  return Promise.all(slips.map((s) => prisma.slip.create({
    data: {
      tenantId,
      locationId: locationByDock[s.dockId],
      transientCapable: s.slipType === 'Open' && s.status === 'VACANT',
      ...s,
    },
  })));
}
