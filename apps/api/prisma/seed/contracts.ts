import type { PrismaClient } from '@prisma/client';

export async function seedContracts(
  prisma: PrismaClient,
  tenantId: string,
  customers: any[],
  boats: any[],
  slips: any[],
) {
  await prisma.securityDeposit.deleteMany({ where: { tenantId } });
  await prisma.slipContract.deleteMany({ where: { tenantId } });

  const contracts: any[] = [];

  // 3 active annual contracts:
  //   James Whitfield  → Slip A-1 (30ft, annual)
  //   Patricia Stanton → Slip A-3 (30ft, annual)
  //   Robert Martinez  → Slip B-2 (40ft, annual)
  const assignments = [
    {
      custIdx: 0,  // James Whitfield
      boatIdx: 0,  // Sea Breeze
      slipNumber: 'A-1',
      rate: 270000,        // $2,700/month (30ft × $90/ft)
      annualRate: 2916000, // $29,160/yr (10% off)
      cycle: 'ANNUAL' as const,
      start: '2025-01-01',
      end: '2025-12-31',
      auto: true,
      depositCents: 270000,
    },
    {
      custIdx: 1,  // Patricia Stanton
      boatIdx: 1,  // Lucky Strike
      slipNumber: 'A-3',
      rate: 270000,
      annualRate: 2916000,
      cycle: 'ANNUAL' as const,
      start: '2025-01-01',
      end: '2025-12-31',
      auto: true,
      depositCents: 270000,
    },
    {
      custIdx: 2,  // Robert Martinez
      boatIdx: 2,  // Pelican's Nest
      slipNumber: 'B-2',
      rate: 360000,        // $3,600/month (40ft × $90/ft)
      annualRate: 3888000, // $38,880/yr
      cycle: 'ANNUAL' as const,
      start: '2025-01-01',
      end: '2025-12-31',
      auto: true,
      depositCents: 360000,
    },
  ];

  for (const a of assignments) {
    const slip = slips.find((s: any) => s.slipNumber === a.slipNumber);
    if (!slip) continue;

    const c = await prisma.slipContract.create({
      data: {
        tenantId,
        slipId: slip.id,
        customerId: customers[a.custIdx].id,
        boatId: boats[a.boatIdx]?.id,
        startDate: new Date(a.start),
        endDate: new Date(a.end),
        billingCycle: a.cycle,
        rateCents: a.annualRate,
        autoRenew: a.auto,
        status: 'ACTIVE',
        securityDepositCents: a.depositCents,
      },
    });
    contracts.push(c);

    await prisma.securityDeposit.create({
      data: {
        tenantId,
        customerId: customers[a.custIdx].id,
        contractId: c.id,
        amountCents: a.depositCents,
        status: 'HELD',
      },
    });
  }

  return contracts;
}
