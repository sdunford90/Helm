-- CreateEnum
CREATE TYPE "JurisdictionKind" AS ENUM ('STATE', 'COUNTY', 'CITY', 'SPECIAL');

-- AlterTable
ALTER TABLE "concierge_requests" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "rental_products" ADD COLUMN     "category" TEXT,
ADD COLUMN     "dailyRateCents" INTEGER,
ADD COLUMN     "hourlyRateCents" INTEGER,
ADD COLUMN     "weeklyRateCents" INTEGER;

-- AlterTable
ALTER TABLE "slip_contracts" ADD COLUMN     "esignEnvelopeId" TEXT,
ADD COLUMN     "signedAt" TIMESTAMP(3),
ADD COLUMN     "signedDocumentUrl" TEXT;

-- AlterTable
ALTER TABLE "slips" ADD COLUMN     "locationId" TEXT;

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "qboAccessToken" TEXT,
ADD COLUMN     "qboConnectedAt" TIMESTAMP(3),
ADD COLUMN     "qboRefreshToken" TEXT,
ADD COLUMN     "qboTokenExpiresAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "email_automation_logs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "ruleId" TEXT,
    "templateId" TEXT,
    "trigger" TEXT NOT NULL,
    "recipientEmail" TEXT,
    "recipientPhone" TEXT,
    "customerId" TEXT,
    "channels" JSONB,
    "subject" TEXT,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "scheduledAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "resendMessageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_automation_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_jurisdictions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "JurisdictionKind" NOT NULL,

    CONSTRAINT "tax_jurisdictions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_rates" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "jurisdictionId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "ratePctBps" INTEGER NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "glAccountId" TEXT,

    CONSTRAINT "tax_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "location_tax_jurisdictions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "jurisdictionId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "location_tax_jurisdictions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_line_item_tax" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "lineItemId" TEXT NOT NULL,
    "jurisdictionId" TEXT NOT NULL,
    "ratePctBps" INTEGER NOT NULL,
    "taxableCents" INTEGER NOT NULL,
    "taxCents" INTEGER NOT NULL,

    CONSTRAINT "invoice_line_item_tax_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "email_automation_logs_tenantId_idx" ON "email_automation_logs"("tenantId");

-- CreateIndex
CREATE INDEX "email_automation_logs_tenantId_trigger_idx" ON "email_automation_logs"("tenantId", "trigger");

-- CreateIndex
CREATE INDEX "tax_jurisdictions_tenantId_idx" ON "tax_jurisdictions"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "tax_jurisdictions_tenantId_code_key" ON "tax_jurisdictions"("tenantId", "code");

-- CreateIndex
CREATE INDEX "tax_rates_tenantId_idx" ON "tax_rates"("tenantId");

-- CreateIndex
CREATE INDEX "tax_rates_jurisdictionId_effectiveFrom_idx" ON "tax_rates"("jurisdictionId", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "location_tax_jurisdictions_locationId_jurisdictionId_key" ON "location_tax_jurisdictions"("locationId", "jurisdictionId");

-- CreateIndex
CREATE INDEX "invoice_line_item_tax_tenantId_idx" ON "invoice_line_item_tax"("tenantId");

-- CreateIndex
CREATE INDEX "invoice_line_item_tax_jurisdictionId_idx" ON "invoice_line_item_tax"("jurisdictionId");

-- CreateIndex
CREATE INDEX "invoice_line_item_tax_lineItemId_idx" ON "invoice_line_item_tax"("lineItemId");

-- AddForeignKey
ALTER TABLE "tax_rates" ADD CONSTRAINT "tax_rates_jurisdictionId_fkey" FOREIGN KEY ("jurisdictionId") REFERENCES "tax_jurisdictions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "location_tax_jurisdictions" ADD CONSTRAINT "location_tax_jurisdictions_jurisdictionId_fkey" FOREIGN KEY ("jurisdictionId") REFERENCES "tax_jurisdictions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_line_item_tax" ADD CONSTRAINT "invoice_line_item_tax_lineItemId_fkey" FOREIGN KEY ("lineItemId") REFERENCES "invoice_line_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_line_item_tax" ADD CONSTRAINT "invoice_line_item_tax_jurisdictionId_fkey" FOREIGN KEY ("jurisdictionId") REFERENCES "tax_jurisdictions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
