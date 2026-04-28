import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { S3Client } from "@aws-sdk/client-s3";
import { clerkAuth } from "../middleware/auth.js";
import { appError } from "../middleware/error.js";
import {
  getPresignedUploadUrl,
  getPresignedDownloadUrl,
  deleteFile,
  getStorageUsage,
  enforceStorageQuota,
} from "../lib/storage.js";
import {
  validatePresignRequest,
  verifyUploadedFile,
} from "../lib/file-validation.js";

const router: Router = Router();

// All storage routes require authentication
router.use(...clerkAuth());

// --------------------------------------------------------------------------
// Zod Schemas
// --------------------------------------------------------------------------

const FileCategoryEnum = z.enum([
  "insurance",
  "photos",
  "boats",
  "contracts",
  "invoices",
  "documents",
  "logo",
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

      // Whitelist content-type + extension per category. Rejects obvious
      // mismatches before the client even gets a URL.
      const validation = validatePresignRequest(category, filename, contentType);
      if (!validation.ok) {
        throw appError(validation.message, 400, validation.code);
      }

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
        maxBytes: validation.maxBytes,
      });
    } catch (err) {
      next(err);
    }
  },
);

// --------------------------------------------------------------------------
// POST /verify-upload — Post-upload magic-byte check
//
// Call this after a successful PUT to the presigned URL. We download the
// first 16 bytes of the object and check the magic signature matches the
// declared content-type. If it fails, the caller should delete the object
// and refuse to link it into the tenant's data.
// --------------------------------------------------------------------------

const VerifyUploadSchema = z.object({
  key: z.string().min(1),
  contentType: z.string().min(1),
});

router.post(
  "/verify-upload",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const { key, contentType } = VerifyUploadSchema.parse(req.body);

      if (!key.startsWith(`${tenantId}/`)) {
        throw appError("Access denied to this file", 403, "FORBIDDEN");
      }

      const r2 = new S3Client({
        region: "auto",
        endpoint: process.env.R2_ENDPOINT,
        credentials: {
          accessKeyId: process.env.R2_ACCESS_KEY_ID ?? "",
          secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? "",
        },
      });

      const result = await verifyUploadedFile(
        r2,
        process.env.R2_BUCKET ?? "helm-files",
        key,
        contentType,
      );
      if (!result.ok) {
        // Don't delete the object here — caller decides. Return 422 so
        // the UI knows the upload is rejected.
        res.status(422).json({
          ok: false,
          code: result.code,
          error: result.message,
        });
        return;
      }
      const publicBase = (process.env.R2_PUBLIC_URL ?? "").replace(/\/$/, "");
      const publicUrl = publicBase ? `${publicBase}/${key}` : null;
      res.json({ ok: true, publicUrl });
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
// POST /presign-download-batch — Get presigned download URLs for many keys
//
// Returns one signed URL per requested key in a single round-trip. This is
// the workhorse for grids that need to render a lot of private R2 objects
// (e.g. boat photo thumbnails) without making N sequential calls. Keys that
// fail tenant scoping or signing are reported individually so a single bad
// key never poisons the whole batch.
// --------------------------------------------------------------------------

const PresignDownloadBatchSchema = z.object({
  keys: z.array(z.string().min(1)).min(1).max(100),
});

router.post(
  "/presign-download-batch",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const { keys } = PresignDownloadBatchSchema.parse(req.body);

      // Dedupe so callers passing the same key twice only sign it once.
      const uniqueKeys = Array.from(new Set(keys));

      const urls: Record<string, string> = {};
      const errors: Record<string, { code: string; error: string }> = {};

      await Promise.all(
        uniqueKeys.map(async (key) => {
          if (!key.startsWith(`${tenantId}/`)) {
            errors[key] = {
              code: "FORBIDDEN",
              error: "Access denied to this file",
            };
            return;
          }
          try {
            urls[key] = await getPresignedDownloadUrl(key);
          } catch (err) {
            errors[key] = {
              code: "SIGN_FAILED",
              error: err instanceof Error ? err.message : "Failed to sign URL",
            };
          }
        }),
      );

      res.json({ urls, errors, expiresIn: 3600 });
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
