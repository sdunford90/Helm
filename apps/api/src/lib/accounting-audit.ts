import { prisma } from "./prisma.js";

export type GlAuditEntity =
  | "PostingAccount"
  | "ProductCategoryGlMapping"
  | "DockageRateGlMapping"
  | "ServiceFeeGlMapping"
  | "RentalProductGlMapping"
  | "TaxRate"
  | "AccountingPeriod"
  | "QboConnection"
  | "CostingMethod";

export async function logAccountingChange(params: {
  tenantId: string;
  locationId: string;
  userId: string | undefined;
  userName: string | undefined;
  entity: GlAuditEntity;
  entityId: string;
  action:
    | "CREATE"
    | "UPDATE"
    | "DELETE"
    | "CONNECT"
    | "DISCONNECT"
    | "CLOSE"
    | "REOPEN";
  changes: Record<string, { from: unknown; to: unknown }>;
  ipAddress?: string;
}): Promise<void> {
  await prisma.auditLog.create({
    data: {
      tenantId: params.tenantId,
      userId: params.userId ?? null,
      userName: params.userName ?? null,
      recordType: params.entity,
      recordId: params.entityId,
      action: params.action,
      changedFieldsJson: params.changes,
      ipAddress: params.ipAddress ?? null,
    },
  });
}
