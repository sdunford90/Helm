-- CreateTable
CREATE TABLE "scheduled_reports" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "reportName" TEXT NOT NULL,
    "frequency" TEXT NOT NULL,
    "format" TEXT NOT NULL DEFAULT 'CSV',
    "recipients" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Active',
    "nextRun" TIMESTAMP(3) NOT NULL,
    "lastRun" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scheduled_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "scheduled_reports_tenantId_idx" ON "scheduled_reports"("tenantId");

-- CreateIndex
CREATE INDEX "scheduled_reports_tenantId_status_idx" ON "scheduled_reports"("tenantId", "status");

-- AddForeignKey
ALTER TABLE "scheduled_reports" ADD CONSTRAINT "scheduled_reports_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
