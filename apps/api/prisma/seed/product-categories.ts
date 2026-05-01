import type { PrismaClient, ProductCategory } from '@prisma/client';

/**
 * Inventory categories for Sunset Harbor Marina.
 * `defaultTaxCategory` aligns with TaxRate.category — the tax engine uses
 * it to look up the right rate for the customer's location.
 */
export async function seedProductCategories(
  prisma: PrismaClient,
  tenantId: string,
): Promise<Record<string, ProductCategory>> {
  await prisma.productCategory.deleteMany({ where: { tenantId } });

  const seedRows = [
    // Marine fuel: taxed via fuel-tax rate, not standard sales tax
    {
      name: 'Fuel',
      defaultTaxCategory: 'fuel',
      taxable: false,
      isFuelCategory: true,
      costingMethod: 'FIFO' as const,
    },
    {
      name: 'Ship Store',
      defaultTaxCategory: 'general',
      taxable: true,
      isFuelCategory: false,
      costingMethod: 'WAC' as const,
    },
    {
      name: 'Marine Services',
      defaultTaxCategory: 'general',
      taxable: true,
      isFuelCategory: false,
      costingMethod: 'WAC' as const,
    },
    {
      name: 'Slip Rentals',
      defaultTaxCategory: 'general',
      taxable: true,
      isFuelCategory: false,
      costingMethod: 'WAC' as const,
    },
    // Required fallback for any product whose category gets soft-deleted
    {
      name: 'Uncategorized',
      defaultTaxCategory: null,
      taxable: true,
      isFuelCategory: false,
      costingMethod: 'WAC' as const,
    },
  ];

  const created = await Promise.all(
    seedRows.map((row) =>
      prisma.productCategory.create({
        data: { tenantId, ...row, active: true },
      }),
    ),
  );

  return Object.fromEntries(created.map((c) => [c.name, c])) as Record<
    string,
    ProductCategory
  >;
}
