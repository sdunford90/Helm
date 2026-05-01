import type { PrismaClient } from '@prisma/client';

export async function seedInvoicesAndPayments(
  prisma: PrismaClient,
  tenantId: string,
  customers: any[],
  contracts: any[],
  slips: any[],
) {
  await prisma.payment.deleteMany({ where: { tenantId } });
  await prisma.invoiceLineItem.deleteMany({ where: { invoice: { tenantId } } });
  await prisma.invoice.deleteMany({ where: { tenantId } });

  // Build a fast slipId → locationId lookup
  const locationBySlipId = new Map<string, string | null>(
    slips.map((s: any) => [s.id, s.locationId ?? null]),
  );

  const invoices: any[] = [];
  const payments: any[] = [];

  // Helper to find locationId for a contract
  const locForContract = (c: any) => locationBySlipId.get(c.slipId) ?? null;

  // ── 3 PAID invoices (annual slip contracts — Q1 installment) ────────────────
  for (let i = 0; i < 3; i++) {
    const contract = contracts[i];
    if (!contract) continue;
    const locationId = locForContract(contract);
    const customer = customers[i];

    const issuedDate = new Date('2025-01-05');
    const dueDate = new Date('2025-02-05');
    const slipRentCents = contract.rateCents; // annual amount
    const taxCents = Math.round(slipRentCents * 0.07);
    const totalCents = slipRentCents + taxCents;

    const inv = await prisma.invoice.create({
      data: {
        tenantId,
        customerId: customer.id,
        locationId,
        invoiceNumber: `SHM-${1001 + i}`,
        issuedDate,
        dueDate,
        status: 'PAID',
        subtotalCents: slipRentCents,
        taxCents,
        totalCents,
        balanceCents: 0,
      },
    });
    await prisma.invoiceLineItem.createMany({
      data: [
        {
          invoiceId: inv.id,
          description: 'Annual Slip Rental 2025',
          quantity: 1,
          unitPriceCents: slipRentCents,
          taxRate: 7,
          taxCents,
          extendedCents: slipRentCents,
          sourceType: 'CONTRACT',
          sourceId: contract.id,
        },
      ],
    });
    invoices.push(inv);

    // Payment for the PAID invoice
    const method = i % 2 === 0 ? 'CARD' : 'CASH';
    const pay = await prisma.payment.create({
      data: {
        tenantId,
        customerId: customer.id,
        invoiceId: inv.id,
        amountCents: totalCents,
        method: method as any,
        status: 'COMPLETED',
        postedDate: new Date('2025-01-10'),
      },
    });
    payments.push(pay);
  }

  // ── 3 ISSUED (sent) invoices — fuel and dockage ───────────────────────────
  const sentInvoicesData = [
    {
      custIdx: 0, // James Whitfield — fuel purchase
      invNum: 'SHM-1004',
      issued: new Date('2026-04-01'),
      due: new Date('2026-05-01'),
      lines: [
        { description: 'Regular Unleaded Fuel — 45 gal @ $4.50', quantity: 45, unitPriceCents: 450, taxRate: 0, taxCents: 0, extendedCents: 45 * 450, sourceType: 'FUEL_SALE' },
      ],
    },
    {
      custIdx: 3, // Linda Chen — ship store + dockage
      invNum: 'SHM-1005',
      issued: new Date('2026-04-05'),
      due: new Date('2026-05-05'),
      lines: [
        { description: 'Dock Lines Set', quantity: 1, unitPriceCents: 3999, taxRate: 7, taxCents: Math.round(3999 * 0.07), extendedCents: 3999, sourceType: 'POS' },
        { description: 'Marine Rope 50ft', quantity: 2, unitPriceCents: 2499, taxRate: 7, taxCents: Math.round(2 * 2499 * 0.07), extendedCents: 2 * 2499, sourceType: 'POS' },
        { description: 'Transient Dockage — 2 nights', quantity: 2, unitPriceCents: 9500, taxRate: 7, taxCents: Math.round(2 * 9500 * 0.07), extendedCents: 2 * 9500, sourceType: 'TRANSIENT' },
      ],
    },
    {
      custIdx: 4, // Mark Davidson — engine service
      invNum: 'SHM-1006',
      issued: new Date('2026-04-10'),
      due: new Date('2026-05-10'),
      lines: [
        { description: 'Engine Service — Annual Maintenance', quantity: 1, unitPriceCents: 35000, taxRate: 7, taxCents: Math.round(35000 * 0.07), extendedCents: 35000, sourceType: 'SERVICE' },
        { description: 'Labor — 4 hrs @ $95/hr', quantity: 4, unitPriceCents: 9500, taxRate: 7, taxCents: Math.round(4 * 9500 * 0.07), extendedCents: 4 * 9500, sourceType: 'SERVICE' },
      ],
    },
  ];

  for (const d of sentInvoicesData) {
    const customer = customers[d.custIdx];
    const subtotal = d.lines.reduce((s, l) => s + l.extendedCents, 0);
    const tax = d.lines.reduce((s, l) => s + l.taxCents, 0);
    const total = subtotal + tax;

    const inv = await prisma.invoice.create({
      data: {
        tenantId,
        customerId: customer.id,
        locationId: null,
        invoiceNumber: d.invNum,
        issuedDate: d.issued,
        dueDate: d.due,
        status: 'ISSUED',
        subtotalCents: subtotal,
        taxCents: tax,
        totalCents: total,
        balanceCents: total,
      },
    });
    await prisma.invoiceLineItem.createMany({
      data: d.lines.map((l) => ({ invoiceId: inv.id, ...l })),
    });
    invoices.push(inv);
  }

  // ── 2 DRAFT invoices ──────────────────────────────────────────────────────
  const draftInvoicesData = [
    {
      custIdx: 2, // Robert Martinez — haul & launch
      invNum: 'SHM-1007',
      issued: new Date('2026-04-20'),
      due: new Date('2026-05-20'),
      lines: [
        { description: 'Haul & Launch — 42ft Vessel', quantity: 1, unitPriceCents: 25000, taxRate: 7, taxCents: Math.round(25000 * 0.07), extendedCents: 25000, sourceType: 'SERVICE' },
        { description: 'Bottom Paint — 42ft @ $18/ft', quantity: 42, unitPriceCents: 1800, taxRate: 7, taxCents: Math.round(42 * 1800 * 0.07), extendedCents: 42 * 1800, sourceType: 'SERVICE' },
      ],
    },
    {
      custIdx: 1, // Patricia Stanton — premium fuel
      invNum: 'SHM-1008',
      issued: new Date('2026-04-22'),
      due: new Date('2026-05-22'),
      lines: [
        { description: 'Premium Unleaded — 60 gal @ $4.80', quantity: 60, unitPriceCents: 480, taxRate: 0, taxCents: 0, extendedCents: 60 * 480, sourceType: 'FUEL_SALE' },
        { description: 'Diesel — 30 gal @ $4.20', quantity: 30, unitPriceCents: 420, taxRate: 0, taxCents: 0, extendedCents: 30 * 420, sourceType: 'FUEL_SALE' },
      ],
    },
  ];

  for (const d of draftInvoicesData) {
    const customer = customers[d.custIdx];
    const subtotal = d.lines.reduce((s, l) => s + l.extendedCents, 0);
    const tax = d.lines.reduce((s, l) => s + l.taxCents, 0);
    const total = subtotal + tax;

    const inv = await prisma.invoice.create({
      data: {
        tenantId,
        customerId: customer.id,
        locationId: null,
        invoiceNumber: d.invNum,
        issuedDate: d.issued,
        dueDate: d.due,
        status: 'DRAFT',
        subtotalCents: subtotal,
        taxCents: tax,
        totalCents: total,
        balanceCents: total,
      },
    });
    await prisma.invoiceLineItem.createMany({
      data: d.lines.map((l) => ({ invoiceId: inv.id, ...l })),
    });
    invoices.push(inv);
  }

  return { invoices, payments };
}
