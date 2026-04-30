import {
  ElectricityMode,
  type Location,
  type PrismaClient,
} from '@prisma/client';

/**
 * Per-location, per-slip-type dockage rates. These are the "rack rates" the
 * marina lists publicly and that the slip-contract creation flow looks up
 * to pre-fill the contract rate. Real contracts can override these (the
 * 15 contracts seeded by `contracts.ts` carry their own `rateCents` and do
 * not depend on these rows existing).
 *
 * Coverage matches the slip types actually present in `slips.ts`:
 *   • Main Marina   — 35ft, 40ft (Dock A)
 *   • North Dock    — 45ft, 50ft, 55ft (Dock B)
 *   • South Cove    — 28ft, 30ft (Dock C)
 *
 * Pricing model is per-foot per-month, with quarterly at a small discount
 * (~5%) and annual at a meaningful one (~10%) — typical US East Coast wet-
 * slip pricing. Premium location (Main) is priced higher per foot than the
 * budget location (South).
 */
export async function seedDockageRates(
  prisma: PrismaClient,
  tenantId: string,
  locations: Location[],
) {
  await prisma.dockageRate.deleteMany({ where: { tenantId } });

  const main = locations[0];
  const north = locations[1];
  const south = locations[2];

  type Tier = { slipType: string; lengthFt: number };

  const planByLocation: Array<{
    location: Location | undefined;
    perFootMonthlyCents: number;
    tiers: Tier[];
  }> = [
    {
      // Premium: $20/ft/month, 12¢/kWh metered
      location: main,
      perFootMonthlyCents: 2000,
      tiers: [
        { slipType: '35ft Open',    lengthFt: 35 },
        { slipType: '40ft Covered', lengthFt: 40 },
      ],
    },
    {
      // Mid: $24/ft/month — bigger boats, covered, deeper water
      location: north,
      perFootMonthlyCents: 2400,
      tiers: [
        { slipType: '45ft Covered', lengthFt: 45 },
        { slipType: '50ft Covered', lengthFt: 50 },
        { slipType: '55ft Covered', lengthFt: 55 },
      ],
    },
    {
      // Budget: $14/ft/month
      location: south,
      perFootMonthlyCents: 1400,
      tiers: [
        { slipType: '28ft Open', lengthFt: 28 },
        { slipType: '30ft Open', lengthFt: 30 },
      ],
    },
  ];

  const rows = planByLocation.flatMap(({ location, perFootMonthlyCents, tiers }) => {
    if (!location) return [];
    return tiers.map((tier) => {
      const monthly = tier.lengthFt * perFootMonthlyCents;
      const quarterly = Math.round(monthly * 3 * 0.95); // 5% off
      const annual = Math.round(monthly * 12 * 0.9); // 10% off
      return {
        tenantId,
        locationId: location.id,
        slipType: tier.slipType,
        monthlyRateCents: monthly,
        quarterlyRateCents: quarterly,
        annualRateCents: annual,
        electricityMode: ElectricityMode.METERED,
        electricityRateCents: 12, // 12¢/kWh — matches slips.ts
        // glAccountId is intentionally null — operator wires per-location
        // GL accounts after connecting QBO.
        taxClass: 'Standard',
        active: true,
      };
    });
  });

  await prisma.dockageRate.createMany({ data: rows });
  return rows.length;
}
