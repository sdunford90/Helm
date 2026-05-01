import type { PrismaClient, Location } from '@prisma/client';

export async function seedRentals(prisma: PrismaClient, tenantId: string, customers: any[], locations: Location[]) {
  await prisma.reservation.deleteMany({ where: { tenantId } });
  await prisma.pricingRule.deleteMany({ where: { rentalProduct: { tenantId } } });
  await prisma.rentalProduct.deleteMany({ where: { tenantId } });

  const mainId = locations[0]?.id;           // Sunset Harbor
  const pelicanCoveId = locations[1]?.id ?? mainId; // Pelican Cove

  const products = await Promise.all([
    prisma.rentalProduct.create({
      data: {
        tenantId,
        locationId: mainId,
        name: 'Bay Explorer 24',
        description: '24ft center console, great for Sarasota Bay fishing and exploring',
        durationType: 'HOURLY',
        basePriceCents: 8500,
        floorPriceCents: 6000,
        ceilingPriceCents: 15000,
        damageWaiverCents: 2500,
        depositCents: 50000,
        active: true,
      },
    }),
    prisma.rentalProduct.create({
      data: {
        tenantId,
        locationId: mainId,
        name: 'Sunset Pontoon 22',
        description: '22ft pontoon boat, perfect for family outings and sunset cruises',
        durationType: 'HOURLY',
        basePriceCents: 7500,
        floorPriceCents: 5500,
        ceilingPriceCents: 13000,
        damageWaiverCents: 2000,
        depositCents: 40000,
        active: true,
      },
    }),
    prisma.rentalProduct.create({
      data: {
        tenantId,
        locationId: mainId,
        name: 'Kayak Single',
        description: 'Single-seat kayak for harbor and mangrove tours',
        durationType: 'HOURLY',
        basePriceCents: 2500,
        floorPriceCents: 1500,
        ceilingPriceCents: 5000,
        damageWaiverCents: 0,
        depositCents: 0,
        active: true,
      },
    }),
    prisma.rentalProduct.create({
      data: {
        tenantId,
        locationId: pelicanCoveId,
        name: 'Pelican Cruiser 28',
        description: '28ft bowrider ideal for Venice Inlet and Shark River trips',
        durationType: 'HOURLY',
        basePriceCents: 9500,
        floorPriceCents: 7000,
        ceilingPriceCents: 17000,
        damageWaiverCents: 3000,
        depositCents: 60000,
        active: true,
      },
    }),
  ]);

  // Pricing rules
  await Promise.all([
    prisma.pricingRule.create({ data: { rentalProductId: products[0].id, ruleType: 'SEASONAL', value: 25, startDate: new Date('2026-06-01'), endDate: new Date('2026-09-01'), priority: 1 } }),
    prisma.pricingRule.create({ data: { rentalProductId: products[0].id, ruleType: 'PEAK_DAY', value: 15, startDate: new Date('2026-01-01'), endDate: new Date('2026-12-31'), daysJson: [0, 6], priority: 2 } }),
    prisma.pricingRule.create({ data: { rentalProductId: products[1].id, ruleType: 'SEASONAL', value: 20, startDate: new Date('2026-06-01'), endDate: new Date('2026-09-01'), priority: 1 } }),
    prisma.pricingRule.create({ data: { rentalProductId: products[1].id, ruleType: 'LEAD_TIME', value: -10, startDate: new Date('2026-01-01'), endDate: new Date('2026-12-31'), priority: 3 } }),
  ]);

  // Reservations
  const statuses = ['CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT', 'CONFIRMED', 'CONFIRMED', 'CANCELLED', 'CONFIRMED', 'CHECKED_OUT'] as const;
  const reservations = await Promise.all(
    statuses.map((status, i) => {
      const dayOffset = i < 4 ? i : -(i - 3);
      const startDt = new Date(2026, 3, 24 + dayOffset, 9, 0);
      const endDt = new Date(startDt);
      endDt.setHours(endDt.getHours() + 4);
      const product = products[i % products.length];
      const customer = customers[i % customers.length];
      return prisma.reservation.create({
        data: {
          tenantId,
          customerId: customer.id,
          rentalProductId: product.id,
          startDt,
          endDt,
          totalCents: product.basePriceCents * 4,
          status,
          waiverSelected: Math.random() > 0.4,
        },
      });
    }),
  );

  return { products, reservations };
}
