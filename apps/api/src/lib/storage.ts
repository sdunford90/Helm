import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// --------------------------------------------------------------------------
// Cloudflare R2 File Storage Service
// --------------------------------------------------------------------------

const r2 = new S3Client({
  region: "auto",
  endpoint: process.env.R2_ENDPOINT!, // https://<account-id>.r2.cloudflarestorage.com
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

const BUCKET = process.env.R2_BUCKET || "helm-files";

// Key format: {tenantId}/{category}/{filename}
type FileCategory = "insurance" | "photos" | "boats" | "contracts" | "invoices" | "documents" | "logo";

/**
 * Upload a file directly to R2.
 * Returns the storage key for future reference.
 */
export async function uploadFile(
  tenantId: string,
  category: FileCategory,
  filename: string,
  body: Buffer,
  contentType: string,
): Promise<string> {
  const key = `${tenantId}/${category}/${filename}`;

  await r2.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
      Metadata: {
        tenantId,
        category,
        uploadedAt: new Date().toISOString(),
      },
    }),
  );

  return key;
}

/**
 * Generate a presigned PUT URL for client-side direct upload.
 * Default expiry is 15 minutes.
 */
export async function getPresignedUploadUrl(
  tenantId: string,
  category: FileCategory,
  filename: string,
  contentType: string,
  expiresIn = 900,
): Promise<{ url: string; key: string }> {
  const key = `${tenantId}/${category}/${filename}`;

  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    ContentType: contentType,
    Metadata: {
      tenantId,
      category,
      uploadedAt: new Date().toISOString(),
    },
  });

  const url = await getSignedUrl(r2, command, { expiresIn });

  return { url, key };
}

/**
 * Generate a presigned GET URL for file download.
 * Default expiry is 1 hour.
 */
export async function getPresignedDownloadUrl(
  key: string,
  expiresIn = 3600,
): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: BUCKET,
    Key: key,
  });

  return getSignedUrl(r2, command, { expiresIn });
}

/**
 * Delete a file from R2.
 */
export async function deleteFile(key: string): Promise<void> {
  await r2.send(
    new DeleteObjectCommand({
      Bucket: BUCKET,
      Key: key,
    }),
  );
}

/**
 * Calculate storage usage for a tenant, broken down by category.
 * Lists all objects under the tenant prefix and sums sizes.
 */
export async function getStorageUsage(
  tenantId: string,
): Promise<{
  totalBytes: number;
  fileCount: number;
  byCategory: Record<FileCategory, number>;
}> {
  const categories: FileCategory[] = [
    "insurance",
    "photos",
    "boats",
    "contracts",
    "invoices",
    "documents",
    "logo",
  ];
  const byCategory: Record<FileCategory, number> = {
    insurance: 0,
    photos: 0,
    boats: 0,
    contracts: 0,
    invoices: 0,
    documents: 0,
    logo: 0,
  };

  let totalBytes = 0;
  let fileCount = 0;
  let continuationToken: string | undefined;

  do {
    const response = await r2.send(
      new ListObjectsV2Command({
        Bucket: BUCKET,
        Prefix: `${tenantId}/`,
        ContinuationToken: continuationToken,
        MaxKeys: 1000,
      }),
    );

    for (const obj of response.Contents || []) {
      const size = obj.Size || 0;
      totalBytes += size;
      fileCount++;

      // Determine category from key path
      const keyParts = obj.Key?.split("/") || [];
      if (keyParts.length >= 2) {
        const cat = keyParts[1] as FileCategory;
        if (categories.includes(cat)) {
          byCategory[cat] += size;
        }
      }
    }

    continuationToken = response.IsTruncated
      ? response.NextContinuationToken
      : undefined;
  } while (continuationToken);

  return { totalBytes, fileCount, byCategory };
}

/**
 * Check if a tenant is within their storage quota.
 * Returns true if the tenant can still upload files.
 */
export async function enforceStorageQuota(
  tenantId: string,
  quotaBytes: number,
): Promise<boolean> {
  const usage = await getStorageUsage(tenantId);
  return usage.totalBytes < quotaBytes;
}
