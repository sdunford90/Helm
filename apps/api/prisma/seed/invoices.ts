import type { PrismaClient } from '@prisma/client';

export async function seedInvoicesAndPayments(prisma: PrismaClient, tenantId: string, customers: any[], contracts: any[]) {
  await prisma.payment.deleteMany({ where: { tenantId } });
  await prisma.invoiceLineItem.deleteMany({ where: { invoice: { tenantId } } });
  await prisma.invoice.deleteMany({ where: { tenantId } });

  const invoices: any[] = [];
  const payments: any[] = [];
  let invNum = 1001;

  // Generate 3 months of invoices for each contract
  for (const contract of contracts) {
    for (let monthOffset = 2; monthOffset >= 0; monthOffset--) {
      const issued = new Date(2026, 2 - monthOffset, 1); // Jan, Feb, Mar 2026
      const due = new Date(issued); due.setDate(due.getDate() + 30);
      const electricityCents = Math.floor(Math.random() * 15000) + 5000;
      const totalCents = contract.rateCents + electricityCents;
      const isPaid = monthOffset > 0 || Math.random() > 0.3;

      const inv = await prisma.invoice.create({
        data: {
          tenantId,
          customerId: contract.customerId,
          invoiceNumber: `INV-${invNum++}`,
          issuedDate: issued,
          dueDate: due,
          status: isPaid ? 'PAID' : (due < new Date() ? 'PAST_DUE' : 'ISSUED'),
          subtotalCents: totalCents,
          taxCents: Math.round(totalCents * 0.07),
          totalCents: totalCents + Math.round(totalCents * 0.07),
          balanceCents: isPaid ? 0 : totalCents + Math.round(totalCents * 0.07),
        },
      });

      await prisma.invoiceLineItem.createMany({
        data: [
          { invoiceId: inv.id, description: 'Slip Rental — Monthly', quantity: 1, unitPriceCents: contract.rateCents, taxRate: 0, taxCents: 0, extendedCents: contract.rateCents, sourceType: 'CONTRACT', sourceId: contract.id },
          { invoiceId: inv.id, description: 'Electricity', quantity: 1, unitPriceCents: electricityCents, taxRate: 7, taxCents: Math.round(electricityCents * 0.07), extendedCents: electricityCents, sourceType: 'ELECTRICITY' },
        ],
      });

      invoices.push(inv);

      if (isPaid) {
        const methods = ['CARD', 'ACH', 'CARD', 'ACH', 'CARD'] as const;
        const pay = await prisma.payment.create({
          data: {
            tenantId,
            customerId: contract.customerId,
            invoiceId: inv.id,
            amountCents: inv.totalCents,
            method: methods[Math.floor(Math.random() * methods.length)],
            status: 'COMPLETED',
            postedDate: new Date(issued.getTime() + 5 * 86400000),
          },
        });
        payments.push(pay);
      }
    }
  }

  return { invoices, payments };
}
