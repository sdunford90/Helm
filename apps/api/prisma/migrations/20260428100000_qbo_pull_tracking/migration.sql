-- Migration: track when we last pulled Vendors and Bills from QuickBooks Online
-- back into Helm. Per-tenant for tenant-level QBO connections, per-location
-- for the now-default per-location QBO connections. The columns let the pull
-- service ask QBO for "everything updated since X" without re-importing the
-- entire vendor / bill list every poll.

ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "qboLastVendorPullAt" TIMESTAMP(3);
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "qboLastBillPullAt"   TIMESTAMP(3);

ALTER TABLE "locations" ADD COLUMN IF NOT EXISTS "qboLastVendorPullAt" TIMESTAMP(3);
ALTER TABLE "locations" ADD COLUMN IF NOT EXISTS "qboLastBillPullAt"   TIMESTAMP(3);
