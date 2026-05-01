import type { PrismaClient } from '@prisma/client';

export async function seedCustomersAndBoats(prisma: PrismaClient, tenantId: string) {
  await prisma.boat.deleteMany({ where: { tenantId } });
  await prisma.customer.deleteMany({ where: { tenantId } });

  const custData = [
    // 0 — James Whitfield (Sea Breeze — Catalina 28)
    {
      firstName: 'James',
      lastName: 'Whitfield',
      email: 'james.whitfield@email.com',
      phone: '9415551001',
      status: 'ACTIVE' as const,
      addressJson: { street: '2210 Osprey Ave', city: 'Sarasota', state: 'FL', zip: '34239' },
      emergencyContactJson: { name: 'Susan Whitfield', phone: '9415559001', relationship: 'Spouse' },
    },
    // 1 — Patricia Stanton (Lucky Strike — Beneteau 38)
    {
      firstName: 'Patricia',
      lastName: 'Stanton',
      email: 'patricia.stanton@email.com',
      phone: '9415551002',
      status: 'ACTIVE' as const,
      addressJson: { street: '4801 Gulf of Mexico Dr', city: 'Longboat Key', state: 'FL', zip: '34228' },
      emergencyContactJson: { name: 'Richard Stanton', phone: '9415559002', relationship: 'Spouse' },
    },
    // 2 — Robert Martinez (Pelican's Nest — Hatteras 42)
    {
      firstName: 'Robert',
      lastName: 'Martinez',
      email: 'bobby.martinez@email.com',
      phone: '9415551003',
      status: 'ACTIVE' as const,
      addressJson: { street: '601 Siesta Dr', city: 'Sarasota', state: 'FL', zip: '34242' },
      emergencyContactJson: { name: 'Maria Martinez', phone: '9415559003', relationship: 'Spouse' },
    },
    // 3 — Linda Chen (Morning Glory — Hunter 32)
    {
      firstName: 'Linda',
      lastName: 'Chen',
      email: 'linda.chen@email.com',
      phone: '9415551004',
      status: 'ACTIVE' as const,
      addressJson: { street: '1330 Boulevard of the Arts', city: 'Sarasota', state: 'FL', zip: '34236' },
      emergencyContactJson: { name: 'David Chen', phone: '9415559004', relationship: 'Spouse' },
    },
    // 4 — Mark Davidson (Wahoo — Boston Whaler 24)
    {
      firstName: 'Mark',
      lastName: 'Davidson',
      email: 'mark.davidson@email.com',
      phone: '9415551005',
      status: 'ACTIVE' as const,
      addressJson: { street: '3500 S Tamiami Trail', city: 'Sarasota', state: 'FL', zip: '34239' },
      emergencyContactJson: { name: 'Karen Davidson', phone: '9415559005', relationship: 'Spouse' },
    },
  ];

  const customers = await Promise.all(
    custData.map((c) => prisma.customer.create({ data: { tenantId, ...c } })),
  );

  const regExpiry = new Date('2027-03-31');
  const boatData = [
    // matching custIdx
    { custIdx: 0, name: 'Sea Breeze', registrationNumber: 'FL-4821-AB', registrationState: 'FL', hin: 'CAT28FL2019A001', make: 'Catalina', model: '28', year: 2019, lengthFt: 28, beamFt: 10, draftFt: 4.5, fuelType: 'Diesel', engineCount: 1, engineHp: 27 },
    { custIdx: 1, name: 'Lucky Strike', registrationNumber: 'FL-7723-CD', registrationState: 'FL', hin: 'BEN38FL2021B002', make: 'Beneteau', model: 'Oceanis 38.1', year: 2021, lengthFt: 38, beamFt: 12, draftFt: 5.5, fuelType: 'Diesel', engineCount: 1, engineHp: 40 },
    { custIdx: 2, name: "Pelican's Nest", registrationNumber: 'FL-3312-EF', registrationState: 'FL', hin: 'HAT42FL2018C003', make: 'Hatteras', model: '42 Convertible', year: 2018, lengthFt: 42, beamFt: 14, draftFt: 4.0, fuelType: 'Diesel', engineCount: 2, engineHp: 600 },
    { custIdx: 3, name: 'Morning Glory', registrationNumber: 'FL-9945-GH', registrationState: 'FL', hin: 'HUN32FL2020D004', make: 'Hunter', model: '32', year: 2020, lengthFt: 32, beamFt: 11, draftFt: 5.0, fuelType: 'Diesel', engineCount: 1, engineHp: 29 },
    { custIdx: 4, name: 'Wahoo', registrationNumber: 'FL-1188-IJ', registrationState: 'FL', hin: 'BSW24FL2022E005', make: 'Boston Whaler', model: '240 Outrage', year: 2022, lengthFt: 24, beamFt: 9, draftFt: 1.5, fuelType: 'Gas', engineCount: 2, engineHp: 300 },
  ];

  const boats = await Promise.all(
    boatData.map((b) => {
      const { custIdx, ...rest } = b;
      return prisma.boat.create({
        data: {
          tenantId,
          customerId: customers[custIdx].id,
          registrationExpiry: regExpiry,
          ...rest,
        },
      });
    }),
  );

  return { customers, boats };
}
