import { prisma } from "../lib/prisma.js";

// --------------------------------------------------------------------------
// Tenant hard-delete
//
// 24-hour grace flow:
//   Superuser POST /tenants/:id/delete  -> creates TenantDeletion(PENDING)
//   ...within 24h Superuser can DELETE   -> status CANCELLED
//   tenant lifecycle daily job calls executePendingDeletions() which
//   processes any PENDING row with scheduledFor <= now.
//
// Many tenant-scoped child tables already cascade through their parent
// (e.g. BoatPhoto → Boat, RolePermission → CustomRole). The cascade
// below removes the rest in dependency order so foreign-key constraints
// don't trip the transaction. New tenant-scoped models that don't have
// `onDelete: Cascade` from a parent must be appended here.
// --------------------------------------------------------------------------

export const GRACE_PERIOD_MS = 24 * 60 * 60 * 1000;

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

async function safeDeleteMany(fn: () => Promise<unknown>): Promise<void> {
  try { await fn(); } catch { /* swallow — table may not exist after partial migration */ }
}

async function cascadeDelete(tx: Tx, tenantId: string) {
  // 1. POS / transient / ramp / fuel / concierge — leaf-ish operational data.
  // Some children don't carry tenantId; filter via parent relation.
  await safeDeleteMany(() => tx.posLineItem.deleteMany({ where: { transaction: { tenantId } } }));
  await safeDeleteMany(() => tx.posTransaction.deleteMany({ where: { tenantId } }));
  await safeDeleteMany(() => tx.shift.deleteMany({ where: { tenantId } }));
  await safeDeleteMany(() => tx.transientBooking.deleteMany({ where: { tenantId } }));
  await safeDeleteMany(() => tx.rampTicket.deleteMany({ where: { tenantId } }));
  await safeDeleteMany(() => tx.conciergeRequest.deleteMany({ where: { tenantId } }));
  await safeDeleteMany(() => tx.fuelSale.deleteMany({ where: { tenantId } }));
  await safeDeleteMany(() => tx.fuelDelivery.deleteMany({ where: { tenantId } }));
  await safeDeleteMany(() => tx.dockWalkItem.deleteMany({ where: { dockWalk: { tenantId } } }));
  await safeDeleteMany(() => tx.dockWalk.deleteMany({ where: { tenantId } }));
  await safeDeleteMany(() => tx.portalMessage.deleteMany({ where: { tenantId } }));

  // 2. Inventory chain
  await safeDeleteMany(() => tx.poLineItem.deleteMany({ where: { purchaseOrder: { tenantId } } }));
  await safeDeleteMany(() => tx.purchaseOrder.deleteMany({ where: { tenantId } }));
  await safeDeleteMany(() => tx.inventoryCountItem.deleteMany({ where: { countSession: { tenantId } } }));
  await safeDeleteMany(() => tx.inventoryCountSession.deleteMany({ where: { tenantId } }));
  await safeDeleteMany(() => tx.inventoryAdjustment.deleteMany({ where: { tenantId } }));
  await safeDeleteMany(() => tx.inventory.deleteMany({ where: { tenantId } }));
  await safeDeleteMany(() => tx.product.deleteMany({ where: { tenantId } }));
  await safeDeleteMany(() => tx.productCategory.deleteMany({ where: { tenantId } }));
  await safeDeleteMany(() => tx.vendor.deleteMany({ where: { tenantId } }));

  // 3. Invoicing & payments
  await safeDeleteMany(() => tx.invoiceLineItemTax.deleteMany({ where: { lineItem: { invoice: { tenantId } } } }));
  await safeDeleteMany(() => tx.invoiceLineItem.deleteMany({ where: { invoice: { tenantId } } }));
  await safeDeleteMany(() => tx.paymentRefund.deleteMany({ where: { tenantId } }));
  await safeDeleteMany(() => tx.payment.deleteMany({ where: { tenantId } }));
  await safeDeleteMany(() => tx.invoice.deleteMany({ where: { tenantId } }));
  await safeDeleteMany(() => tx.saasInvoice.deleteMany({ where: { tenantId } }));

  // 4. Boats / slips / contracts / waitlist / leads / rentals / reservations
  await safeDeleteMany(() => tx.reservation.deleteMany({ where: { tenantId } }));
  await safeDeleteMany(() => tx.rentalTimeSlot.deleteMany({ where: { tenantId } }));
  await safeDeleteMany(() => tx.rentalUnit.deleteMany({ where: { rentalProduct: { tenantId } } }));
  await safeDeleteMany(() => tx.rentalProduct.deleteMany({ where: { tenantId } }));
  await safeDeleteMany(() => tx.slipContract.deleteMany({ where: { tenantId } }));
  await safeDeleteMany(() => tx.boat.deleteMany({ where: { tenantId } }));
  await safeDeleteMany(() => tx.slip.deleteMany({ where: { tenantId } }));
  await safeDeleteMany(() => tx.waitlistEntry.deleteMany({ where: { tenantId } }));
  await safeDeleteMany(() => tx.lead.deleteMany({ where: { tenantId } }));
  await safeDeleteMany(() => tx.referralPartner.deleteMany({ where: { tenantId } }));

  // 5. Customers (parent for many of the above)
  await safeDeleteMany(() => tx.customer.deleteMany({ where: { tenantId } }));

  // 6. Audit + per-tenant settings
  await safeDeleteMany(() => tx.auditLog.deleteMany({ where: { tenantId } }));
  await safeDeleteMany(() => tx.scheduledReport.deleteMany({ where: { tenantId } }));
  await safeDeleteMany(() => tx.supportTicket.deleteMany({ where: { tenantId } }));
  await safeDeleteMany(() => tx.emailSuppression.deleteMany({ where: { tenantId } }));
  await safeDeleteMany(() => tx.tenantExport.deleteMany({ where: { tenantId } }));
  await safeDeleteMany(() => tx.apiKey.deleteMany({ where: { tenantId } }));
  await safeDeleteMany(() => tx.announcement.deleteMany({ where: { tenantId } }));
  await safeDeleteMany(() => tx.emailTemplate.deleteMany({ where: { tenantId } }));
  await safeDeleteMany(() => tx.automationRule.deleteMany({ where: { tenantId } }));

  // 7. Roles + user/location bindings + users
  await safeDeleteMany(() => tx.userLocation.deleteMany({ where: { tenantId } }));
  await safeDeleteMany(() => tx.customRole.deleteMany({ where: { tenantId } }));
  await safeDeleteMany(() => tx.user.deleteMany({ where: { tenantId } }));

  // 8. Locations
  await safeDeleteMany(() => tx.location.deleteMany({ where: { tenantId } }));

  // 9. Finally the tenant itself.
  await tx.tenant.delete({ where: { id: tenantId } });
}

interface ExecuteResult {
  processed: number;
  succeeded: string[];
  failed: { tenantId: string; error: string }[];
}

/**
 * Executes any PENDING TenantDeletion whose scheduledFor has elapsed.
 * Designed to be called from the daily tenant-lifecycle cron.
 */
export async function executePendingDeletions(now: Date = new Date()): Promise<ExecuteResult> {
  const due = await prisma.tenantDeletion.findMany({
    where: { status: "PENDING", scheduledFor: { lte: now } },
  });

  const succeeded: string[] = [];
  const failed: { tenantId: string; error: string }[] = [];

  for (const row of due) {
    try {
      await prisma.$transaction(async (tx) => {
        await cascadeDelete(tx, row.tenantId);
      }, { timeout: 60_000 });

      await prisma.tenantDeletion.update({
        where: { id: row.id },
        data: { status: "COMPLETED", completedAt: new Date() },
      });
      succeeded.push(row.tenantId);
    } catch (err) {
      const message = (err as Error).message ?? "delete failed";
      await prisma.tenantDeletion.update({
        where: { id: row.id },
        data: { status: "FAILED", errorMsg: message, completedAt: new Date() },
      });
      failed.push({ tenantId: row.tenantId, error: message });
    }
  }

  return { processed: due.length, succeeded, failed };
}
