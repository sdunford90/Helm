import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { v4 as uuid } from "uuid";
import path from "path";

// ---------------------------------------------------------------------------
// Cloudflare R2 Storage Client
//
// Provides file upload/download for insurance documents, invoice PDFs,
// dock walk photos, customer profile images, and other media.
// ---------------------------------------------------------------------------

const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID ?? "";
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID ?? "";
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY ?? "";
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME ?? "helm-uploads";

const s3 = new S3Client({
  region: "auto",
  endpoint: R2_ACCOUNT_ID
    ? `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
    : "http://localhost:9000", // Fallback for local dev (MinIO)
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  },
});

interface UploadResult {
  key: string;
  url: string;
}

/**
 * Upload a file to R2. Returns the object key and public URL.
 */
export async function uploadFile(
  buffer: Buffer,
  originalName: string,
  tenantId: string,
  folder: string,
  contentType?: string,
): Promise<UploadResult> {
  const ext = path.extname(originalName);
  const key = `${tenantId}/${folder}/${uuid()}${ext}`;

  await s3.send(
    new PutObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: key,
      Body: buffer,
      ContentType: contentType ?? guessMimeType(ext),
    }),
  );

  const url = `https://${R2_BUCKET_NAME}.${R2_ACCOUNT_ID}.r2.dev/${key}`;

  return { key, url };
}

/**
 * Generate a presigned URL for temporary access to a private file.
 * Default expiry: 1 hour.
 */
export async function getPresignedUrl(
  key: string,
  expiresInSeconds = 3600,
): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: R2_BUCKET_NAME,
    Key: key,
  });

  return getSignedUrl(s3, command, { expiresIn: expiresInSeconds });
}

/**
 * Delete a file from R2.
 */
export async function deleteFile(key: string): Promise<void> {
  await s3.send(
    new DeleteObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: key,
    }),
  );
}

/**
 * Upload an invoice PDF to R2.
 */
export async function uploadInvoicePdf(
  buffer: Buffer,
  tenantId: string,
  invoiceNumber: string,
): Promise<UploadResult> {
  return uploadFile(buffer, `${invoiceNumber}.pdf`, tenantId, "invoices", "application/pdf");
}

/**
 * Upload a dock walk photo to R2.
 */
export async function uploadDockWalkPhoto(
  buffer: Buffer,
  tenantId: string,
  originalName: string,
): Promise<UploadResult> {
  return uploadFile(buffer, originalName, tenantId, "dock-walks");
}

/**
 * Upload an insurance document to R2.
 */
export async function uploadInsuranceDoc(
  buffer: Buffer,
  tenantId: string,
  originalName: string,
): Promise<UploadResult> {
  return uploadFile(buffer, originalName, tenantId, "insurance");
}

/**
 * Upload a customer profile image to R2.
 */
export async function uploadProfileImage(
  buffer: Buffer,
  tenantId: string,
  originalName: string,
): Promise<UploadResult> {
  return uploadFile(buffer, originalName, tenantId, "profiles");
}

function guessMimeType(ext: string): string {
  const types: Record<string, string> = {
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  };
  return types[ext.toLowerCase()] ?? "application/octet-stream";
}
