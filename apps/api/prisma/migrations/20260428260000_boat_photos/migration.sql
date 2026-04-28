-- CreateTable
CREATE TABLE "boat_photos" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "boatId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "boat_photos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "boat_photos_tenantId_idx" ON "boat_photos"("tenantId");

-- CreateIndex
CREATE INDEX "boat_photos_boatId_idx" ON "boat_photos"("boatId");

-- AddForeignKey
ALTER TABLE "boat_photos" ADD CONSTRAINT "boat_photos_boatId_fkey" FOREIGN KEY ("boatId") REFERENCES "boats"("id") ON DELETE CASCADE ON UPDATE CASCADE;
