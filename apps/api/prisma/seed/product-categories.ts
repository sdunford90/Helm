import type { PrismaClient, ProductCategory } from '@prisma/client';

/**
 * Inventory categories. Every Product MUST belong to one (the column is
 * NOT NULL after migration 20260429080000). GL posting for retail/POS
 * inventory flows from per-location ProductCategoryGlMapping (configured
 * by the operator in Settings → Categories once their QBO chart is
 * imported), NOT from these category rows directly.
 *
 * `defaultTaxCategory` aligns with TaxRate.category — the tax engine uses
 * it to look up the right rate for the customer's location.
 */
export async function seedProductCategories(
  prisma: PrismaClient,
  tenantId: string,
): Promise<Record<string, ProductCategory>> {
  await prisma.productCategory.deleteMany({ where: { tenantId } });

  const seedRows = [
    // Marine fuel is taxed via a separate fuel-tax rate (MOTOR_FUEL),
    // not standard sales tax. Mark non-taxable so the sales-tax engine
    // skips it; the fuel-tax overlay still applies at the rate level.
    { name: 'Fuel', defaultTaxCategory: 'fuel', taxable: false },
    { name: 'Bait & Tackle', defaultTaxCategory: 'general', taxable: true },
    { name: 'Convenience', defaultTaxCategory: 'general', taxable: true },
    { name: 'Marine Hardware', defaultTaxCategory: 'general', taxable: true },
    { name: 'Apparel', defaultTaxCategory: 'general', taxable: true },
    // Required fallback for any product whose category gets soft-deleted.
    // Mirrors the "Uncategorized" seed that the migration creates.
    { name: 'Uncategorized', defaultTaxCategory: null, taxable: true },
  ];

  const created = await Promise.all(
    seedRows.map((row) =>
      prisma.productCategory.create({
        data: { tenantId, ...row, active: true },
      }),
    ),
  );

  // Return as a name-keyed map so pos.ts can look categories up by label.
  return Object.fromEntries(created.map((c) => [c.name, c])) as Record<
    string,
    ProductCategory
  >;
}
