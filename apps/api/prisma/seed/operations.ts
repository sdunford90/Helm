import type { PrismaClient, Location } from '@prisma/client';

export async function seedOperations(
  prisma: PrismaClient,
  tenantId: string,
  users: any[],
  slips: any[],
  customers?: any[],
  locations?: Location[],
) {
  await prisma.dockWalkItem.deleteMany({ where: { dockWalk: { tenantId } } });
  await prisma.dockWalk.deleteMany({ where: { tenantId } });
  await prisma.pumpOut.deleteMany({ where: { tenantId } });
  await prisma.announcementDelivery.deleteMany({ where: { announcement: { tenantId } } });
  await prisma.announcement.deleteMany({ where: { tenantId } });
  await prisma.rampTicket.deleteMany({ where: { tenantId } });
  await prisma.transientBooking.deleteMany({ where: { tenantId } });
  await prisma.auditLog.deleteMany({ where: { tenantId } });

  const dockStaff = users.filter((u: any) =>
    ['DOCK_STAFF', 'MARINA_MANAGER'].includes(u.role),
  );

  // ── Dock walks — last 8 days ──────────────────────────────────────────────
  const walks = await Promise.all(
    [0, 1, 2, 3, 4, 5, 6, 7].map(async (dayBack) => {
      const d = new Date(2026, 3, 26 - dayBack, 7, 0); // April 26 going back
      const inspector = dockStaff[dayBack % dockStaff.length];
      const dockLetter = dayBack % 2 === 0 ? 'A' : 'B';
      const walk = await prisma.dockWalk.create({
        data: {
          tenantId,
          inspectorId: inspector.id,
          dockId: dockLetter,
          startedAt: d,
          completedAt: dayBack > 0 ? new Date(d.getTime() + (25 + dayBack * 5) * 60000) : null,
          status: dayBack > 0 ? 'COMPLETED' : 'IN_PROGRESS',
        },
      });

      const dockSlips = slips.filter((s: any) => s.dockId === dockLetter);
      for (const slip of dockSlips) {
        const hasViolation = Math.random() < 0.12;
        await prisma.dockWalkItem.create({
          data: {
            dockWalkId: walk.id,
            slipId: slip.id,
            status: hasViolation ? 'VIOLATION' : 'OK',
            notes: hasViolation
              ? [
                  'Shore power cord showing exposed insulation.',
                  'Port-side dock line frayed near cleat.',
                  'Oil sheen observed around vessel.',
                  'Fire extinguisher expired.',
                ][Math.floor(Math.random() * 4)]
              : 'All clear',
            violationType: hasViolation
              ? ['SAFETY_HAZARD', 'LINE_CONDITION', 'ELECTRICAL', 'CLEANLINESS'][
                  Math.floor(Math.random() * 4)
                ]
              : null,
          },
        });
      }
      return walk;
    }),
  );

  // ── Pump outs ─────────────────────────────────────────────────────────────
  const occupiedSlips = slips.filter((s: any) => s.status === 'OCCUPIED');
  await Promise.all(
    [0, 2, 4, 6].map((dayBack, i) => {
      const d = new Date(2026, 3, 26 - dayBack, 10, 0);
      const staff = dockStaff[dayBack % dockStaff.length];
      const slip = occupiedSlips[i % Math.max(occupiedSlips.length, 1)] ?? slips[0];
      return prisma.pumpOut.create({
        data: {
          tenantId,
          slipId: slip.id,
          staffId: staff.id,
          eventDate: d,
          gallons: Math.floor(Math.random() * 25) + 10,
          feeCents: 5000,
        },
      });
    }),
  );

  // ── Announcements ─────────────────────────────────────────────────────────
  const announcements = await Promise.all([
    prisma.announcement.create({
      data: {
        tenantId,
        subject: 'Spring Marina Events — April 26-27',
        body: 'Join us for our spring open house and sunset cruise this weekend. Live music, food trucks, and vendor exhibits from 10 AM to 6 PM at Sunset Harbor.',
        audienceFilter: 'ALL',
        channels: 'BOTH',
        isEmergency: false,
        sentAt: new Date('2026-04-24'),
        staffId: users[0].id,
      },
    }),
    prisma.announcement.create({
      data: {
        tenantId,
        subject: 'Dock B Maintenance — April 28',
        body: 'Scheduled power maintenance on Dock B from 8 AM to 12 PM. Shore power will be temporarily unavailable during this window. Vessels should take precautions.',
        audienceFilter: 'DOCK_B',
        channels: 'BOTH',
        isEmergency: false,
        sentAt: new Date('2026-04-23'),
        staffId: users[1].id,
      },
    }),
    prisma.announcement.create({
      data: {
        tenantId,
        subject: 'Small Craft Advisory — Afternoon Storms',
        body: 'The National Weather Service has issued a small craft advisory for the Sarasota Bay area from 2 PM to 8 PM today. Please secure your vessels and avoid open water.',
        audienceFilter: 'ALL',
        channels: 'BOTH',
        isEmergency: true,
        sentAt: new Date('2026-04-22'),
        staffId: users[0].id,
      },
    }),
    prisma.announcement.create({
      data: {
        tenantId,
        subject: 'New Fuel Pricing Effective May 1',
        body: 'Starting May 1, fuel prices will be updated. Regular Unleaded: $4.50/gal, Premium Unleaded: $4.80/gal, Diesel: $4.20/gal. Thank you for your continued business.',
        audienceFilter: 'ALL',
        channels: 'EMAIL',
        isEmergency: false,
        sentAt: new Date('2026-04-20'),
        staffId: users[0].id,
      },
    }),
    prisma.announcement.create({
      data: {
        tenantId,
        subject: 'Spring Insurance Renewal Reminder',
        body: 'Please ensure your vessel insurance is current for the 2026 season. Upload your renewed certificate via the customer portal or drop off at the marina office.',
        audienceFilter: 'SLIP_HOLDERS',
        channels: 'EMAIL',
        isEmergency: false,
        sentAt: new Date('2026-04-15'),
        staffId: users[0].id,
      },
    }),
    prisma.announcement.create({
      data: {
        tenantId,
        subject: 'Welcome to the 2026 Boating Season!',
        body: 'Spring is here! The marina office is now open extended hours (6 AM – 8 PM) through October. Fuel dock and ship store are fully stocked for the season. Safe boating!',
        audienceFilter: 'ALL',
        channels: 'BOTH',
        isEmergency: false,
        sentAt: new Date('2026-04-01'),
        staffId: users[0].id,
      },
    }),
  ]);

  // ── Transient bookings ────────────────────────────────────────────────────
  const transientSlips = slips.filter((s: any) => s.transientCapable);
  const transientCustomers = customers ?? [];
  const transientData = [
    { daysBack: 0, nights: 2, guestName: 'James Harrington', boatName: 'Wanderer', length: 28 },
    { daysBack: 1, nights: 3, guestName: 'Cynthia Moore', boatName: 'Coastal Dream', length: 32 },
    { daysBack: 2, nights: 1, guestName: 'Ted Novak', boatName: 'Sea Hawk', length: 36 },
    { daysBack: 3, nights: 5, guestName: 'Barbara Klein', boatName: 'Moonrise', length: 38 },
    { daysBack: 0, nights: 1, guestName: 'Rick Sandoval', boatName: 'Blue Runner', length: 24 },
    { daysBack: 5, nights: 2, guestName: null, boatName: 'Island Hopper', length: 30, customerId: transientCustomers[3]?.id },
    { daysBack: 7, nights: 4, guestName: null, boatName: 'Tiderunner', length: 34, customerId: transientCustomers[4]?.id },
  ];

  await Promise.all(
    transientData.map((td, i) => {
      const slip = transientSlips[i % Math.max(transientSlips.length, 1)] ?? slips[0];
      const checkIn = new Date(2026, 3, 26 - td.daysBack);
      const checkOut = new Date(checkIn);
      checkOut.setDate(checkOut.getDate() + td.nights);
      const rateCents = 9500 + (td.length - 24) * 250;
      return prisma.transientBooking.create({
        data: {
          tenantId,
          slipId: slip.id,
          customerId: (td as any).customerId ?? null,
          guestName: (td as any).guestName ?? 'Guest',
          boatName: td.boatName,
          boatLength: td.length,
          checkIn,
          checkOut,
          rateCents,
          totalCents: rateCents * td.nights,
          status: td.daysBack === 0 ? 'CHECKED_IN' : td.daysBack < 0 ? 'BOOKED' : 'CHECKED_OUT',
        },
      });
    }),
  );

  // ── Ramp tickets ──────────────────────────────────────────────────────────
  const mainLocationId = locations?.[0]?.id;
  const rampDays = [0, 0, 1, 1, 2, 2, 3, 4, 5, 6, 7, 8];
  const rampTypes = [
    'SINGLE_LAUNCH', 'DAILY_PASS', 'SINGLE_LAUNCH', 'SINGLE_LAUNCH',
    'DAILY_PASS', 'SINGLE_LAUNCH', 'SINGLE_LAUNCH', 'DAILY_PASS',
    'SEASONAL_PASS', 'SINGLE_LAUNCH', 'DAILY_PASS', 'SINGLE_LAUNCH',
  ] as const;
  const rampAmounts: Record<string, number> = { SINGLE_LAUNCH: 2500, DAILY_PASS: 4500, SEASONAL_PASS: 24900 };
  const rampGuests = [
    'Mike Donovan', 'Carol Simms', 'Frank Paulson', 'Guest',
    'Rita Vance', 'Steve Hooper', 'Guest', 'Nancy Webb',
    'Dave Kowalski', 'Guest', 'Jan Fisher', 'Amy Cole',
  ];
  const rampPlates = [
    'FL-1234', 'FL-5678', 'GA-2222', 'FL-3333',
    'AL-4444', 'FL-5555', 'SC-6666', 'FL-7777',
    'GA-8888', 'FL-9999', 'FL-0001', 'FL-0002',
  ];

  await Promise.all(
    rampDays.map((daysBack, i) => {
      const d = new Date(2026, 3, 26 - daysBack, 7 + (i % 8), 0);
      const ticketType = rampTypes[i];
      return prisma.rampTicket.create({
        data: {
          tenantId,
          locationId: mainLocationId,
          ticketType,
          guestName: rampGuests[i],
          customerId: null,
          licensePlate: rampPlates[i],
          boatRegistration: `FL-${String(2000 + i).padStart(4, '0')}-SH`,
          amountCents: rampAmounts[ticketType],
          paymentMethod: (['CARD', 'CASH', 'CARD', 'CARD', 'CASH'] as const)[i % 5],
          createdAt: d,
        },
      });
    }),
  );

  // ── Audit log entries (GL configuration changes) ──────────────────────────
  const adminUser = users.find((u: any) => u.role === 'TENANT_ADMIN') ?? users[0];
  const accountingUser = users.find((u: any) => u.role === 'ACCOUNTING') ?? users[2];

  const auditEntries = [
    {
      tenantId,
      userId: adminUser.id,
      userName: `${adminUser.firstName} ${adminUser.lastName}`,
      recordType: 'GlAccount',
      recordId: 'seed-gl-1100',
      action: 'CREATE',
      changedFieldsJson: { accountNumber: '1100', name: 'Accounts Receivable', type: 'ASSET' },
      createdAt: new Date('2025-11-15T10:05:00Z'),
    },
    {
      tenantId,
      userId: adminUser.id,
      userName: `${adminUser.firstName} ${adminUser.lastName}`,
      recordType: 'Location',
      recordId: 'sunset-harbor-location',
      action: 'UPDATE',
      changedFieldsJson: { accountingSetupComplete: true, arGlAccountId: 'set', undepositedFundsGlAccountId: 'set' },
      createdAt: new Date('2025-11-15T10:30:00Z'),
    },
    {
      tenantId,
      userId: accountingUser.id,
      userName: `${accountingUser.firstName} ${accountingUser.lastName}`,
      recordType: 'GlAccount',
      recordId: 'seed-gl-4400',
      action: 'UPDATE',
      changedFieldsJson: { description: 'Updated to Slip Rental Revenue for 2026 fiscal year' },
      createdAt: new Date('2025-12-01T09:15:00Z'),
    },
    {
      tenantId,
      userId: accountingUser.id,
      userName: `${accountingUser.firstName} ${accountingUser.lastName}`,
      recordType: 'SlipContract',
      recordId: 'seed-contract-1',
      action: 'CREATE',
      changedFieldsJson: { customerId: 'James Whitfield', slipNumber: 'A-1', billingCycle: 'ANNUAL', rateCents: 2916000 },
      createdAt: new Date('2024-12-15T14:00:00Z'),
    },
    {
      tenantId,
      userId: adminUser.id,
      userName: `${adminUser.firstName} ${adminUser.lastName}`,
      recordType: 'TaxJurisdiction',
      recordId: 'seed-tax-fl',
      action: 'CREATE',
      changedFieldsJson: { code: 'FL-STATE', name: 'Florida State Tax', ratePctBps: 600 },
      createdAt: new Date('2025-11-10T08:00:00Z'),
    },
  ];

  await prisma.auditLog.createMany({ data: auditEntries });

  return { walks, announcements };
}
