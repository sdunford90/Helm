-- CreateTable
CREATE TABLE "user_locations" (
    "userId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_locations_pkey" PRIMARY KEY ("userId", "locationId")
);

-- CreateIndex
CREATE INDEX "user_locations_userId_idx" ON "user_locations"("userId");
CREATE INDEX "user_locations_locationId_idx" ON "user_locations"("locationId");
CREATE INDEX "user_locations_tenantId_idx" ON "user_locations"("tenantId");

-- AddForeignKey
ALTER TABLE "user_locations" ADD CONSTRAINT "user_locations_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_locations" ADD CONSTRAINT "user_locations_locationId_fkey"
    FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: grant every existing user access to every Location in their tenant
-- so the rollout doesn't suddenly lock anyone out. Idempotent via ON CONFLICT.
INSERT INTO "user_locations" ("userId", "locationId", "tenantId", "createdAt")
SELECT u."id", l."id", u."tenantId", CURRENT_TIMESTAMP
FROM "users" u
JOIN "locations" l ON l."tenantId" = u."tenantId"
ON CONFLICT ("userId", "locationId") DO NOTHING;
