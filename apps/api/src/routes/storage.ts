import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { clerkAuth } from "../middleware/auth.js";
import {
  getPresignedUploadUrl,
  getPresignedDownloadUrl,
  deleteFile,
  getStorageUsage,
  enforceStorageQuota,
} from "../lib/storage.js";

const router: Router = Router();

// All storage routes require authentication
router.use(...clerkAuth());

// --------------------------------------------------------------------------
// Zod Schemas
// --------------------------------------------------------------------------

const FileCategoryEnum = z.enum([
  "insurance",
  "photos",
  "contracts",
  "invoices",
  "documents",
]);

const PresignUploadSchema = z.object({
  category: FileCategoryEnum,
  filename: z.string().min(1).max(255),
  contentType: z.string().min(1),
});

// --------------------------------------------------------------------------
// POST /presign-upload — Get presigned upload URL
// --------------------------------------------------------------------------

router.post(
  "/presign-upload",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const { category, filename, contentType } = PresignUploadSchema.parse(req.body);

      // Enforce storage quota (default 10 GB per tenant)
      const quotaBytes = 10 * 1024 * 1024 * 1024; // 10 GB
      const withinQuota = await enforceStorageQuota(tenantId, quotaBytes);

      if (!withinQuota) {
        res.status(413).json({
          error: "Storage quota exceeded",
          code: "QUOTA_EXCEEDED",
        });
        return;
      }

      // Sanitize filename: remove path separators and special characters
      const sanitized = filename.replace(/[/\\:*?"<>|]/g, "_");
      // Add timestamp prefix to prevent collisions
      const timestamped = `${Date.now()}-${sanitized}`;

      const result = await getPresignedUploadUrl(
        tenantId,
        category,
        timestamped,
        contentType,
      );

      res.json({
        url: result.url,
        key: result.key,
        expiresIn: 900, // 15 minutes
      });
    } catch (err) {
      next(err);
    }
  },
);

// --------------------------------------------------------------------------
// GET /presign-download/:key(*) — Get presigned download URL
// --------------------------------------------------------------------------

router.get(
  "/presign-download/*",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      // The key is the rest of the path after /presign-download/
      const key = req.params[0];

      if (!key) {
        res.status(400).json({ error: "File key is required", code: "MISSING_KEY" });
        return;
      }

      // Ensure the key belongs to this tenant
      if (!key.startsWith(`${tenantId}/`)) {
        res.status(403).json({
          error: "Access denied to this file",
          code: "FORBIDDEN",
        });
        return;
      }

      const url = await getPresignedDownloadUrl(key);

      res.json({ url, expiresIn: 3600 });
    } catch (err) {
      next(err);
    }
  },
);

// --------------------------------------------------------------------------
// DELETE /:key(*) — Delete a file
// --------------------------------------------------------------------------

router.delete(
  "/*",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const key = req.params[0];

      if (!key) {
        res.status(400).json({ error: "File key is required", code: "MISSING_KEY" });
        return;
      }

      // Ensure the key belongs to this tenant
      if (!key.startsWith(`${tenantId}/`)) {
        res.status(403).json({
          error: "Access denied to this file",
          code: "FORBIDDEN",
        });
        return;
      }

      await deleteFile(key);

      res.json({ success: true, message: "File deleted" });
    } catch (err) {
      next(err);
    }
  },
);

// --------------------------------------------------------------------------
// GET /usage — Get tenant storage usage
// --------------------------------------------------------------------------

router.get(
  "/usage",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const usage = await getStorageUsage(tenantId);

      const quotaBytes = 10 * 1024 * 1024 * 1024; // 10 GB
      const usagePercent = Math.round((usage.totalBytes / quotaBytes) * 10000) / 100;

      res.json({
        ...usage,
        quotaBytes,
        usagePercent,
      });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
