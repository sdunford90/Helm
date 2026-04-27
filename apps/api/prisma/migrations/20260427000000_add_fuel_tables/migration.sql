-- CreateTable
CREATE TABLE IF NOT EXISTS "fuel_sales" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customerId" TEXT,
    "guestName" TEXT,
    "fuelType" TEXT NOT NULL,
    "gallons" DOUBLE PRECISION NOT NULL,
    "priceCentsPerGallon" INTEGER NOT NULL,
    "totalCents" INTEGER NOT NULL,
    "pumpNumber" INTEGER,
    "staffId" TEXT,
    "paymentMethod" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fuel_sales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "fuel_deliveries" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "supplier" TEXT NOT NULL,
    "fuelType" TEXT NOT NULL,
    "gallons" DOUBLE PRECISION NOT NULL,
    "costCentsPerGallon" INTEGER NOT NULL,
    "totalCostCents" INTEGER NOT NULL,
    "tankLevelAfterGallons" DOUBLE PRECISION,
    "notes" TEXT,
    "deliveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fuel_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "fuel_sales_tenantId_idx" ON "fuel_sales"("tenantId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "fuel_deliveries_tenantId_idx" ON "fuel_deliveries"("tenantId");
