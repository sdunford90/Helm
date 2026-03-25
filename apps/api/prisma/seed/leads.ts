import type { PrismaClient } from '@prisma/client';

export async function seedLeadsAndWaitlist(prisma: PrismaClient, tenantId: string) {
  await prisma.waitlistEntry.deleteMany({ where: { tenantId } });
  await prisma.lead.deleteMany({ where: { tenantId } });

  const leads = await Promise.all([
    prisma.lead.create({ data: { tenantId, firstName: 'Alex', lastName: 'Thompson', email: 'alex.t@email.com', phone: '5551001001', stage: 'NEW', sourceUrl: 'https://bayshoremarina.com/slips', utmSource: 'google', utmMedium: 'cpc' } }),
    prisma.lead.create({ data: { tenantId, firstName: 'Jennifer', lastName: 'Walsh', email: 'jennifer.w@email.com', phone: '5551002002', stage: 'NEW', sourceUrl: 'https://bayshoremarina.com/contact', utmSource: 'facebook' } }),
    prisma.lead.create({ data: { tenantId, firstName: 'Marcus', lastName: 'Bell', email: 'marcus.b@email.com', phone: '5551003003', stage: 'NEW', boatLength: 35 } }),
    prisma.lead.create({ data: { tenantId, firstName: 'Diana', lastName: 'Foster', email: 'diana.f@email.com', phone: '5551004004', stage: 'CONTACTED', boatLength: 42 } }),
    prisma.lead.create({ data: { tenantId, firstName: 'Steven', lastName: 'Park', email: 'steven.p@email.com', phone: '5551005005', stage: 'CONTACTED', utmSource: 'referral', referralCode: 'BROKER-JONES' } }),
    prisma.lead.create({ data: { tenantId, firstName: 'Rachel', lastName: 'Kim', email: 'rachel.k@email.com', phone: '5551006006', stage: 'QUALIFIED', boatLength: 28, slipType: '30ft Open' } }),
    prisma.lead.create({ data: { tenantId, firstName: 'Brian', lastName: 'Cooper', email: 'brian.c@email.com', phone: '5551007007', stage: 'QUALIFIED', boatLength: 50, slipType: '50ft Covered' } }),
    prisma.lead.create({ data: { tenantId, firstName: 'Laura', lastName: 'Hughes', email: 'laura.h@email.com', phone: '5551008008', stage: 'PROPOSAL_SENT', boatLength: 38 } }),
    prisma.lead.create({ data: { tenantId, firstName: 'Kevin', lastName: "O'Malley", email: 'kevin.o@email.com', phone: '5551009009', stage: 'WON', boatLength: 40, convertedAt: new Date('2026-03-10') } }),
    prisma.lead.create({ data: { tenantId, firstName: 'Patricia', lastName: 'Nguyen', email: 'patricia.n@email.com', phone: '5551010010', stage: 'WON', boatLength: 29, convertedAt: new Date('2026-03-18') } }),
    prisma.lead.create({ data: { tenantId, firstName: 'George', lastName: 'Martin', email: 'george.m@email.com', phone: '5551011011', stage: 'LOST', lostReason: 'Price too high' } }),
    prisma.lead.create({ data: { tenantId, firstName: 'Sandra', lastName: 'White', email: 'sandra.w@email.com', phone: '5551012012', stage: 'LOST', lostReason: 'Chose competitor' } }),
  ]);

  const waitlist = await Promise.all([
    prisma.waitlistEntry.create({ data: { tenantId, customerId: null, slipType: '40ft Covered', boatLength: 38, status: 'WAITING', queuePosition: 1 } }),
    prisma.waitlistEntry.create({ data: { tenantId, customerId: null, slipType: '50ft Covered', boatLength: 48, status: 'WAITING', queuePosition: 2 } }),
    prisma.waitlistEntry.create({ data: { tenantId, customerId: null, slipType: '40ft Covered', boatLength: 40, status: 'WAITING', queuePosition: 3 } }),
    prisma.waitlistEntry.create({ data: { tenantId, customerId: null, slipType: '30ft Open', boatLength: 28, status: 'NOTIFIED', queuePosition: 1 } }),
    prisma.waitlistEntry.create({ data: { tenantId, customerId: null, slipType: '30ft Open', boatLength: 26, status: 'ACCEPTED', queuePosition: 0 } }),
  ]);

  return { leads, waitlist };
}
