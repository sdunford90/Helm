-- CreateTable
CREATE TABLE "email_suppressions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_suppressions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "email_suppressions_tenantId_idx" ON "email_suppressions"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "email_suppressions_tenantId_email_key" ON "email_suppressions"("tenantId", "email");
