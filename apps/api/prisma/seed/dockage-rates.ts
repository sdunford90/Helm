import {
  ElectricityMode,
  type Location,
  type PrismaClient,
} from '@prisma/client';

/**
 * Per-location, per-slip-type dockage rates for Sunset Harbor Marina.
 * These are the rack rates for transient and seasonal dockage.
 *
 * Sunset Harbor (Sarasota):
 *   - 30ft slips: $90/ft/month → $2,700/month
 *   - 40ft slips: $95/ft/month → $3,800/month (covered premium)
 *
 * Pelican Cove (Venice):
 *   - 30ft slips: $75/ft/month
 *   - 40ft slips: $80/ft/month
 */
export async function seedDockageRates(
  prisma: PrismaClient,
  tenantId: string,
  locations: Location[],
) {
  await prisma.dockageRate.deleteMany({ where: { tenantId } });

  const sunsetHarbor = locations[0];
  const pelicanCove = locations[1];

  const rows: any[] = [];

  if (sunsetHarbor) {
    // 30ft open slips (Dock A)
    const monthly30 = 30 * 9000; // $90/ft × 30ft = $2,700
    rows.push({
      tenantId,
      locationId: sunsetHarbor.id,
      slipType: '30ft Open',
      monthlyRateCents: monthly30,
      quarterlyRateCents: Math.round(monthly30 * 3 * 0.95),
      annualRateCents: Math.round(monthly30 * 12 * 0.90),
      electricityMode: ElectricityMode.METERED,
      electricityRateCents: 12,
      taxClass: 'Standard',
      active: true,
    });
    // 40ft covered slips (Dock B)
    const monthly40 = 40 * 9500; // $95/ft × 40ft = $3,800
    rows.push({
      tenantId,
      locationId: sunsetHarbor.id,
      slipType: '40ft Covered',
      monthlyRateCents: monthly40,
      quarterlyRateCents: Math.round(monthly40 * 3 * 0.95),
      annualRateCents: Math.round(monthly40 * 12 * 0.90),
      electricityMode: ElectricityMode.METERED,
      electricityRateCents: 12,
      taxClass: 'Standard',
      active: true,
    });
  }

  if (pelicanCove) {
    const monthly30vc = 30 * 7500; // $75/ft
    rows.push({
      tenantId,
      locationId: pelicanCove.id,
      slipType: '30ft Open',
      monthlyRateCents: monthly30vc,
      quarterlyRateCents: Math.round(monthly30vc * 3 * 0.95),
      annualRateCents: Math.round(monthly30vc * 12 * 0.90),
      electricityMode: ElectricityMode.METERED,
      electricityRateCents: 12,
      taxClass: 'Standard',
      active: true,
    });
    const monthly40vc = 40 * 8000;
    rows.push({
      tenantId,
      locationId: pelicanCove.id,
      slipType: '40ft Covered',
      monthlyRateCents: monthly40vc,
      quarterlyRateCents: Math.round(monthly40vc * 3 * 0.95),
      annualRateCents: Math.round(monthly40vc * 12 * 0.90),
      electricityMode: ElectricityMode.METERED,
      electricityRateCents: 12,
      taxClass: 'Standard',
      active: true,
    });
  }

  await prisma.dockageRate.createMany({ data: rows });
  return rows.length;
}
