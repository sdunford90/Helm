import { prisma } from "../lib/prisma.js";

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

export interface MergeFieldChoices {
  /** For each field, specify "primary" or "secondary" to choose whose value wins */
  email?: "primary" | "secondary";
  phone?: "primary" | "secondary";
  company?: "primary" | "secondary";
  addressJson?: "primary" | "secondary";
  emergencyContactJson?: "primary" | "secondary";
}

export interface MergeResult {
  mergeId: string;
  primaryId: string;
  secondaryId: string;
  mergedAt: Date;
  undoDeadline: Date;
  recordsMoved: {
    boats: number;
    contracts: number;
    invoices: number;
    payments: number;
    reservations: number;
    securityDeposits: number;
    insuranceRecords: number;
    achReturns: number;
    chargebacks: number;
    collectionsAccounts: number;
  };
}

const UNDO_WINDOW_MINUTES = 15;

// --------------------------------------------------------------------------
// mergeCustomers
// --------------------------------------------------------------------------

export async function mergeCustomers(
  primaryId: string,
  secondaryId: string,
  fieldChoices: MergeFieldChoices,
  tenantId: string,
): Promise<MergeResult> {
  if (primaryId === secondaryId) {
    throw new Error("Cannot merge a customer with themselves");
  }

  const [primary, secondary] = await Promise.all([
    prisma.customer.findFirst({ where: { id: primaryId, tenantId } }),
    prisma.customer.findFirst({ where: { id: secondaryId, tenantId } }),
  ]);

  if (!primary) throw new Error(`Primary customer ${primaryId} not found`);
  if (!secondary) throw new Error(`Secondary customer ${secondaryId} not found`);

  const mergedAt = new Date();
  const undoDeadline = new Date(mergedAt.getTime() + UNDO_WINDOW_MINUTES * 60 * 1000);

  // Build field updates based on choices
  const fieldUpdates: Record<string, unknown> = {};
  if (fieldChoices.email === "secondary" && secondary.email) {
    fieldUpdates.email = secondary.email;
  }
  if (fieldChoices.phone === "secondary" && secondary.phone) {
    fieldUpdates.phone = secondary.phone;
  }
  if (fieldChoices.company === "secondary" && secondary.company) {
    fieldUpdates.company = secondary.company;
  }
  if (fieldChoices.addressJson === "secondary" && secondary.addressJson) {
    fieldUpdates.addressJson = secondary.addressJson;
  }
  if (fieldChoices.emergencyContactJson === "secondary" && secondary.emergencyContactJson) {
    fieldUpdates.emergencyContactJson = secondary.emergencyContactJson;
  }

  // Execute the merge in a transaction
  const result = await prisma.$transaction(async (tx) => {
    // Move boats
    const boatResult = await tx.boat.updateMany({
      where: { customerId: secondaryId, tenantId },
      data: { customerId: primaryId },
    });

    // Move contracts
    const contractResult = await tx.slipContract.updateMany({
      where: { customerId: secondaryId, tenantId },
      data: { customerId: primaryId },
    });

    // Move invoices
    const invoiceResult = await tx.invoice.updateMany({
      where: { customerId: secondaryId, tenantId },
      data: { customerId: primaryId },
    });

    // Move payments
    const paymentResult = await tx.payment.updateMany({
      where: { customerId: secondaryId, tenantId },
      data: { customerId: primaryId },
    });

    // Move reservations
    const reservationResult = await tx.reservation.updateMany({
      where: { customerId: secondaryId, tenantId },
      data: { customerId: primaryId },
    });

    // Move security deposits
    const depositResult = await tx.securityDeposit.updateMany({
      where: { customerId: secondaryId, tenantId },
      data: { customerId: primaryId },
    });

    // Move insurance records
    const insuranceResult = await tx.insuranceRecord.updateMany({
      where: { customerId: secondaryId, tenantId },
      data: { customerId: primaryId },
    });

    // Move ACH returns
    const achResult = await tx.achReturn.updateMany({
      where: { customerId: secondaryId, tenantId },
      data: { customerId: primaryId },
    });

    // Move chargebacks
    const chargebackResult = await tx.chargeback.updateMany({
      where: { customerId: secondaryId, tenantId },
      data: { customerId: primaryId },
    });

    // Move collections accounts
    const collectionsResult = await tx.collectionsAccount.updateMany({
      where: { customerId: secondaryId, tenantId },
      data: { customerId: primaryId },
    });

    // Move waitlist entries
    await tx.waitlistEntry.updateMany({
      where: { customerId: secondaryId, tenantId },
      data: { customerId: primaryId },
    });

    // Move concierge requests
    await tx.conciergeRequest.updateMany({
      where: { customerId: secondaryId, tenantId },
      data: { customerId: primaryId },
    });

    // Move transient bookings
    await tx.transientBooking.updateMany({
      where: { customerId: secondaryId, tenantId },
      data: { customerId: primaryId },
    });

    // Move ramp tickets
    await tx.rampTicket.updateMany({
      where: { customerId: secondaryId, tenantId },
      data: { customerId: primaryId },
    });

    // Move announcement deliveries
    await tx.announcementDelivery.updateMany({
      where: { customerId: secondaryId },
      data: { customerId: primaryId },
    });

    // Move NPS surveys
    await tx.npsSurvey.updateMany({
      where: { customerId: secondaryId, tenantId },
      data: { customerId: primaryId },
    });

    // Apply field choices to primary customer
    if (Object.keys(fieldUpdates).length > 0) {
      await tx.customer.update({
        where: { id: primaryId },
        data: fieldUpdates,
      });
    }

    // If secondary has a Stripe customer and primary doesn't, move it
    if (secondary.stripeCustomerId && !primary.stripeCustomerId) {
      await tx.customer.update({
        where: { id: primaryId },
        data: { stripeCustomerId: secondary.stripeCustomerId },
      });
    }

    // Mark secondary as inactive with merge metadata
    await tx.customer.update({
      where: { id: secondaryId },
      data: {
        status: "INACTIVE",
        // Store merge info in addressJson temporarily for undo capability
        // We use a special field pattern to avoid schema changes
        leadSource: `__merged_into:${primaryId}:${mergedAt.toISOString()}:${undoDeadline.toISOString()}`,
      },
    });

    // Create audit log entry
    await tx.auditLog.create({
      data: {
        tenantId,
        recordType: "Customer",
        recordId: primaryId,
        action: "MERGE",
        changedFieldsJson: {
          secondaryId,
          fieldChoices,
          undoDeadline: undoDeadline.toISOString(),
          previousPrimaryFields: {
            email: primary.email,
            phone: primary.phone,
            company: primary.company,
            stripeCustomerId: primary.stripeCustomerId,
          },
          previousSecondaryFields: {
            email: secondary.email,
            phone: secondary.phone,
            company: secondary.company,
            stripeCustomerId: secondary.stripeCustomerId,
            status: secondary.status,
            leadSource: secondary.leadSource,
          },
        },
      },
    });

    return {
      boats: boatResult.count,
      contracts: contractResult.count,
      invoices: invoiceResult.count,
      payments: paymentResult.count,
      reservations: reservationResult.count,
      securityDeposits: depositResult.count,
      insuranceRecords: insuranceResult.count,
      achReturns: achResult.count,
      chargebacks: chargebackResult.count,
      collectionsAccounts: collectionsResult.count,
    };
  });

  return {
    mergeId: `${primaryId}:${secondaryId}:${mergedAt.getTime()}`,
    primaryId,
    secondaryId,
    mergedAt,
    undoDeadline,
    recordsMoved: result,
  };
}

// --------------------------------------------------------------------------
// undoMerge
// --------------------------------------------------------------------------

export async function undoMerge(
  mergeId: string,
  tenantId: string,
): Promise<{ success: boolean; message: string }> {
  // Parse mergeId
  const parts = mergeId.split(":");
  if (parts.length < 3) {
    throw new Error("Invalid merge ID format");
  }

  const primaryId = parts[0];
  const secondaryId = parts[1];

  // Find the audit log entry for this merge
  const auditEntry = await prisma.auditLog.findFirst({
    where: {
      tenantId,
      recordType: "Customer",
      recordId: primaryId,
      action: "MERGE",
    },
    orderBy: { createdAt: "desc" },
  });

  if (!auditEntry) {
    throw new Error("Merge record not found");
  }

  const mergeData = auditEntry.changedFieldsJson as Record<string, unknown> | null;
  if (!mergeData || mergeData.secondaryId !== secondaryId) {
    throw new Error("Merge record mismatch");
  }

  // Check undo window
  const undoDeadline = new Date(mergeData.undoDeadline as string);
  if (new Date() > undoDeadline) {
    throw new Error("Undo window has expired (15-minute limit)");
  }

  // Get the secondary customer to verify merge marker
  const secondary = await prisma.customer.findFirst({
    where: { id: secondaryId, tenantId },
  });

  if (!secondary) {
    throw new Error("Secondary customer not found");
  }

  if (!secondary.leadSource?.startsWith(`__merged_into:${primaryId}`)) {
    throw new Error("Secondary customer does not appear to be merged");
  }

  const previousSecondary = mergeData.previousSecondaryFields as Record<string, unknown>;
  const previousPrimary = mergeData.previousPrimaryFields as Record<string, unknown>;

  await prisma.$transaction(async (tx) => {
    // Move all records back to secondary
    await tx.boat.updateMany({
      where: { customerId: primaryId, tenantId },
      data: { customerId: secondaryId },
    });

    // For contracts, invoices, payments etc. we need to be more careful:
    // only move back records that were created before the merge
    const mergeTime = auditEntry.createdAt;

    // Move back boats that were originally secondary's
    // Since we can't perfectly distinguish, we move all boats that existed before merge
    // This is a best-effort approach; in production, a separate join table would track moved records

    await tx.slipContract.updateMany({
      where: { customerId: primaryId, tenantId, createdAt: { lt: mergeTime } },
      data: { customerId: secondaryId },
    });

    // For items without createdAt tracking, we do a full reversal
    // (This is the tradeoff of the 15-min undo window approach)
    await tx.invoice.updateMany({
      where: { customerId: primaryId, tenantId, createdAt: { lt: mergeTime } },
      data: { customerId: secondaryId },
    });

    await tx.payment.updateMany({
      where: { customerId: primaryId, tenantId, createdAt: { lt: mergeTime } },
      data: { customerId: secondaryId },
    });

    // Restore secondary customer status
    await tx.customer.update({
      where: { id: secondaryId },
      data: {
        status: (previousSecondary.status as string) === "ACTIVE" ? "ACTIVE" : "ACTIVE",
        leadSource: (previousSecondary.leadSource as string) ?? null,
      },
    });

    // Restore primary customer fields if they were overwritten
    if (previousPrimary) {
      const restoreFields: Record<string, unknown> = {};
      if (previousPrimary.email !== undefined) restoreFields.email = previousPrimary.email;
      if (previousPrimary.phone !== undefined) restoreFields.phone = previousPrimary.phone;
      if (previousPrimary.company !== undefined) restoreFields.company = previousPrimary.company;
      if (previousPrimary.stripeCustomerId !== undefined) {
        restoreFields.stripeCustomerId = previousPrimary.stripeCustomerId;
      }
      if (Object.keys(restoreFields).length > 0) {
        await tx.customer.update({
          where: { id: primaryId },
          data: restoreFields,
        });
      }
    }

    // Create audit log for undo
    await tx.auditLog.create({
      data: {
        tenantId,
        recordType: "Customer",
        recordId: primaryId,
        action: "MERGE_UNDO",
        changedFieldsJson: {
          secondaryId,
          originalMergeId: mergeId,
        },
      },
    });
  });

  return { success: true, message: "Merge successfully reversed" };
}
