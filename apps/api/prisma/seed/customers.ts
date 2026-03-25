import type { PrismaClient } from '@prisma/client';

export async function seedCustomersAndBoats(prisma: PrismaClient, tenantId: string) {
  await prisma.boat.deleteMany({ where: { tenantId } });
  await prisma.customer.deleteMany({ where: { tenantId } });

  const custData = [
    { firstName: 'James', lastName: 'Harborview', email: 'james.harborview@email.com', phone: '5552345678', status: 'ACTIVE' as const, addressJson: { street: '1420 Pelican Way', city: 'Bayshore', state: 'FL', zip: '33541' }, dob: new Date('1975-06-15'), dlNumber: 'H123-456-78-901', dlState: 'FL' },
    { firstName: 'Maria', lastName: 'Seabreeze', email: 'maria.seabreeze@email.com', phone: '5553456789', status: 'ACTIVE' as const, addressJson: { street: '890 Coastal Blvd', city: 'Bayshore', state: 'FL', zip: '33541' } },
    { firstName: 'David', lastName: 'Tidewater', email: 'david.tidewater@email.com', phone: '5554567890', status: 'ACTIVE' as const, addressJson: { street: '2100 Harbor Dr', city: 'Tampa', state: 'FL', zip: '33602' }, dob: new Date('1968-03-22') },
    { firstName: 'Elena', lastName: 'Windward', email: 'elena.windward@email.com', phone: '5555678901', status: 'SEASONAL' as const, addressJson: { street: '45 Oak Lane', city: 'Sarasota', state: 'FL', zip: '34236' } },
    { firstName: 'Robert', lastName: 'Chen', email: 'robert.chen@email.com', phone: '5556789012', status: 'ACTIVE' as const, addressJson: { street: '333 Mangrove Ct', city: 'Bayshore', state: 'FL', zip: '33541' } },
    { firstName: 'Coastal Charters', lastName: 'LLC', company: 'Coastal Charters LLC', email: 'billing@coastalcharters.com', phone: '5557890123', status: 'ACTIVE' as const, addressJson: { street: '100 Marina Plaza Ste 200', city: 'Bayshore', state: 'FL', zip: '33541' }, taxExempt: true },
    { firstName: 'Blue Water', lastName: 'Excursions', company: 'Blue Water Excursions Inc', email: 'ops@bluewaterexcursions.com', phone: '5558901234', status: 'ACTIVE' as const, addressJson: { street: '505 Waterfront Dr', city: 'St Petersburg', state: 'FL', zip: '33701' }, taxExempt: true },
    { firstName: 'Sarah', lastName: 'Mitchell', email: 'sarah.mitchell@email.com', phone: '5559012345', status: 'ACTIVE' as const, addressJson: { street: '1200 Sunset Ave', city: 'Clearwater', state: 'FL', zip: '33756' } },
    { firstName: 'Tom', lastName: 'Seaside', email: 'tom.seaside@email.com', phone: '5550123456', status: 'ACTIVE' as const, addressJson: { street: '78 Anchor St', city: 'Bayshore', state: 'FL', zip: '33541' } },
    { firstName: 'Amy', lastName: 'Portview', email: 'amy.portview@email.com', phone: '5551234560', status: 'ACTIVE' as const, addressJson: { street: '420 Seagull Lane', city: 'Bayshore', state: 'FL', zip: '33541' } },
    { firstName: 'Mike', lastName: 'Anchorage', email: 'mike.anchorage@email.com', phone: '5552345670', status: 'ACTIVE' as const, addressJson: { street: '99 Dockside Rd', city: 'Bayshore', state: 'FL', zip: '33541' } },
    { firstName: 'Lisa', lastName: 'Bayfront', email: 'lisa.bayfront@email.com', phone: '5553456780', status: 'ACTIVE' as const, addressJson: { street: '155 Bayfront Circle', city: 'Bayshore', state: 'FL', zip: '33541' } },
    { firstName: 'Kevin', lastName: "O'Malley", email: 'kevin.omalley@email.com', phone: '5554567801', status: 'WAITLIST' as const, addressJson: { street: '800 Lighthouse Rd', city: 'Tarpon Springs', state: 'FL', zip: '34688' } },
    { firstName: 'Patricia', lastName: 'Nguyen', email: 'patricia.nguyen@email.com', phone: '5555678012', status: 'ACTIVE' as const, addressJson: { street: '620 Palm Harbor Dr', city: 'Palm Harbor', state: 'FL', zip: '34683' } },
    { firstName: 'Carlos', lastName: 'Rivera', email: 'carlos.rivera@email.com', phone: '5556780123', status: 'ACTIVE' as const, achBlocked: true, addressJson: { street: '310 Gulf Blvd', city: 'Madeira Beach', state: 'FL', zip: '33708' } },
  ];

  const customers = await Promise.all(custData.map((c) => prisma.customer.create({ data: { tenantId, ...c, emergencyContactJson: { name: 'Emergency Contact', phone: '5559999999', relationship: 'Spouse' } } })));

  const boatData = [
    { custIdx: 0, name: 'Sea Spirit', registrationNumber: 'FL-3821-AB', registrationState: 'FL', hin: 'FLZ12345A303', make: 'Catalina', model: '385', year: 2019, lengthFt: 38, beamFt: 12, draftFt: 6, fuelType: 'Diesel', engineCount: 1, engineHp: 40 },
    { custIdx: 1, name: 'Coastal Dream', registrationNumber: 'FL-9923-CD', registrationState: 'FL', hin: 'FLZ23456B204', make: 'Sea Ray', model: '320 Sundancer', year: 2020, lengthFt: 32, beamFt: 10, draftFt: 3, fuelType: 'Gas', engineCount: 2, engineHp: 300 },
    { custIdx: 2, name: 'Tidewater Express', registrationNumber: 'FL-6678-EF', registrationState: 'FL', hin: 'FLZ34567C105', make: 'Viking', model: '48 Convertible', year: 2018, lengthFt: 48, beamFt: 16, draftFt: 5, fuelType: 'Diesel', engineCount: 2, engineHp: 800 },
    { custIdx: 3, name: 'Windward', registrationNumber: 'FL-8847-GH', registrationState: 'FL', hin: 'FLZ45678D006', make: 'Beneteau', model: 'Oceanis 30.1', year: 2021, lengthFt: 28, beamFt: 10, draftFt: 5, fuelType: 'Diesel', engineCount: 1, engineHp: 21 },
    { custIdx: 4, name: 'Harbor Light', registrationNumber: 'FL-2209-IJ', registrationState: 'FL', hin: 'FLZ56789E107', make: 'Boston Whaler', model: '250 Outrage', year: 2022, lengthFt: 26, beamFt: 9, draftFt: 2, fuelType: 'Gas', engineCount: 2, engineHp: 300 },
    { custIdx: 5, name: 'Charter One', registrationNumber: 'FL-4410-KL', registrationState: 'FL', hin: 'FLZ67890F208', make: 'Yellowfin', model: '42 Offshore', year: 2020, lengthFt: 45, beamFt: 13, draftFt: 3, fuelType: 'Gas', engineCount: 3, engineHp: 350 },
    { custIdx: 6, name: 'Blue Wave', registrationNumber: 'FL-5567-MN', registrationState: 'FL', hin: 'FLZ78901G309', make: 'Azimut', model: '50 Flybridge', year: 2017, lengthFt: 52, beamFt: 15, draftFt: 5, fuelType: 'Diesel', engineCount: 2, engineHp: 600 },
    { custIdx: 7, name: 'Sunrise Runner', registrationNumber: 'FL-7712-OP', registrationState: 'FL', hin: 'FLZ89012H410', make: 'Grady-White', model: '336 Canyon', year: 2021, lengthFt: 34, beamFt: 11, draftFt: 2, fuelType: 'Gas', engineCount: 2, engineHp: 350 },
    { custIdx: 8, name: 'Mariner II', registrationNumber: 'FL-3344-QR', registrationState: 'FL', hin: 'FLZ90123I511', make: 'Nordic Tug', model: '34', year: 2019, lengthFt: 35, beamFt: 12, draftFt: 4, fuelType: 'Diesel', engineCount: 1, engineHp: 200 },
    { custIdx: 9, name: 'Portside', registrationNumber: 'FL-1199-ST', registrationState: 'FL', hin: 'FLZ01234J612', make: 'Robalo', model: 'R242', year: 2023, lengthFt: 24, beamFt: 9, draftFt: 2, fuelType: 'Gas', engineCount: 1, engineHp: 300 },
    { custIdx: 10, name: 'Bayrunner', registrationNumber: 'FL-8833-UV', registrationState: 'FL', hin: 'FLZ12345K713', make: 'Chaparral', model: '267 SSX', year: 2022, lengthFt: 26, beamFt: 9, draftFt: 3, fuelType: 'Gas', engineCount: 1, engineHp: 350 },
    { custIdx: 11, name: 'Sunset Chaser', registrationNumber: 'FL-5544-WX', registrationState: 'FL', hin: 'FLZ23456L814', make: 'Regal', model: '33 Express', year: 2020, lengthFt: 30, beamFt: 10, draftFt: 3, fuelType: 'Gas', engineCount: 2, engineHp: 300 },
    { custIdx: 13, name: 'Pacific Star', registrationNumber: 'FL-2298-YZ', registrationState: 'FL', hin: 'FLZ34567M915', make: 'Pursuit', model: 'S 288', year: 2021, lengthFt: 29, beamFt: 10, draftFt: 2, fuelType: 'Gas', engineCount: 2, engineHp: 300 },
    { custIdx: 14, name: 'Tideline', registrationNumber: 'FL-7788-AA', registrationState: 'FL', hin: 'FLZ45678N016', make: 'Wellcraft', model: '222 Fisherman', year: 2022, lengthFt: 22, beamFt: 9, draftFt: 2, fuelType: 'Gas', engineCount: 1, engineHp: 200 },
  ];

  const regExpiry = new Date('2027-03-31');
  const boats = await Promise.all(boatData.map((b) => {
    const { custIdx, ...rest } = b;
    return prisma.boat.create({ data: { tenantId, customerId: customers[custIdx].id, registrationExpiry: regExpiry, ...rest } });
  }));

  return { customers, boats };
}
