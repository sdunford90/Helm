import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { scanBuffer } from "./clamd-client.js";

// ---------------------------------------------------------------------------
// File upload safety — pre-upload whitelist + post-upload magic-byte check
//
// Presigned URLs mean the client uploads directly to R2, so we can't look at
// the bytes on the way in. We defend with two checks:
//   1. BEFORE signing: reject requests whose declared content-type or
//      extension isn't allowed for the upload category.
//   2. AFTER upload: download the first 256 bytes and verify magic bytes
//      match the expected family (PDF, PNG, JPEG, etc).
//
// Antivirus is deliberately out of scope — plug a real scanner (ClamAV,
// S3 virus scan via Lambda, etc.) into verifyUploadedFile before rollout
// to paying customers.
// ---------------------------------------------------------------------------

export type FileCategory =
  | "insurance"
  | "photos"
  | "contracts"
  | "invoices"
  | "documents"
  | "logo";

interface CategoryPolicy {
  maxBytes: number;
  // Allowed MIME types (declared by the client at presign time).
  allowedContentTypes: string[];
  // Case-insensitive filename extensions.
  allowedExtensions: string[];
}

const MB = 1024 * 1024;

const POLICY: Record<FileCategory, CategoryPolicy> = {
  // Insurance = certificates of insurance, mostly PDFs; allow images too.
  insurance: {
    maxBytes: 15 * MB,
    allowedContentTypes: ["application/pdf", "image/png", "image/jpeg"],
    allowedExtensions: [".pdf", ".png", ".jpg", ".jpeg"],
  },
  photos: {
    maxBytes: 10 * MB,
    allowedContentTypes: ["image/png", "image/jpeg", "image/webp"],
    allowedExtensions: [".png", ".jpg", ".jpeg", ".webp"],
  },
  contracts: {
    maxBytes: 20 * MB,
    allowedContentTypes: ["application/pdf"],
    allowedExtensions: [".pdf"],
  },
  invoices: {
    maxBytes: 20 * MB,
    allowedContentTypes: ["application/pdf"],
    allowedExtensions: [".pdf"],
  },
  // Generic "documents" kept loose but bounded.
  documents: {
    maxBytes: 20 * MB,
    allowedContentTypes: [
      "application/pdf",
      "image/png",
      "image/jpeg",
      "text/plain",
      "text/csv",
    ],
    allowedExtensions: [".pdf", ".png", ".jpg", ".jpeg", ".txt", ".csv"],
  },
  // Tenant logo uploaded from Settings; small raster image only.
  // (SVG intentionally excluded — verifyUploadedFile() does magic-byte
  // checks and SVG would always trip MAGIC_MISMATCH.)
  logo: {
    maxBytes: 5 * MB,
    allowedContentTypes: ["image/png", "image/jpeg", "image/webp"],
    allowedExtensions: [".png", ".jpg", ".jpeg", ".webp"],
  },
};

export interface ValidationFailure {
  ok: false;
  code:
    | "CATEGORY_UNKNOWN"
    | "CONTENT_TYPE_FORBIDDEN"
    | "EXTENSION_FORBIDDEN"
    | "SIZE_EXCEEDED"
    | "MAGIC_MISMATCH"
    | "AV_INFECTED"
    | "AV_REQUIRED_BUT_SKIPPED";
  message: string;
}

export interface ValidationSuccess {
  ok: true;
  maxBytes: number;
}

export type ValidationResult = ValidationSuccess | ValidationFailure;

export function validatePresignRequest(
  category: string,
  filename: string,
  contentType: string,
): ValidationResult {
  const policy = POLICY[category as FileCategory];
  if (!policy) {
    return { ok: false, code: "CATEGORY_UNKNOWN", message: `Unknown category: ${category}` };
  }

  const normalized = contentType.toLowerCase();
  if (!policy.allowedContentTypes.includes(normalized)) {
    return {
      ok: false,
      code: "CONTENT_TYPE_FORBIDDEN",
      message: `Content type ${contentType} not allowed for ${category}`,
    };
  }

  const ext = extensionOf(filename).toLowerCase();
  if (!policy.allowedExtensions.includes(ext)) {
    return {
      ok: false,
      code: "EXTENSION_FORBIDDEN",
      message: `Extension ${ext || "(none)"} not allowed for ${category}`,
    };
  }

  return { ok: true, maxBytes: policy.maxBytes };
}

function extensionOf(filename: string): string {
  const i = filename.lastIndexOf(".");
  return i < 0 ? "" : filename.slice(i);
}

// ---------------------------------------------------------------------------
// Post-upload magic-byte verification
// ---------------------------------------------------------------------------

interface MagicSignature {
  name: string;
  mime: string;
  bytes: number[];
  offset?: number;
}

const MAGIC_SIGS: MagicSignature[] = [
  { name: "PDF", mime: "application/pdf", bytes: [0x25, 0x50, 0x44, 0x46] }, // %PDF
  { name: "PNG", mime: "image/png", bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { name: "JPEG", mime: "image/jpeg", bytes: [0xff, 0xd8, 0xff] },
  { name: "WEBP", mime: "image/webp", bytes: [0x52, 0x49, 0x46, 0x46] }, // RIFF (also WAV/AVI; good enough for this pass)
];

function matches(head: Uint8Array, sig: MagicSignature): boolean {
  const offset = sig.offset ?? 0;
  if (head.length < offset + sig.bytes.length) return false;
  for (let i = 0; i < sig.bytes.length; i++) {
    if (head[offset + i] !== sig.bytes[i]) return false;
  }
  return true;
}

/**
 * Download the first 16 bytes of an uploaded object and check the magic
 * bytes match the declared content-type family. Text/CSV files are let
 * through without a magic check — they don't have reliable signatures.
 */
export async function verifyUploadedFile(
  r2: S3Client,
  bucket: string,
  key: string,
  declaredContentType: string,
): Promise<ValidationResult> {
  // Fetch the full object once. We check magic bytes + AV in one pass so
  // we don't pay for two GET requests. For very large files this could
  // pull an LRU buffer cap; for the categories we accept (≤20 MB) the
  // memory cost is fine.
  const cmd = new GetObjectCommand({ Bucket: bucket, Key: key });
  const resp = await r2.send(cmd);
  const bytes = Buffer.from(await resp.Body!.transformToByteArray());

  // 1. Magic-byte check (skipped for text/* — no reliable signature).
  if (!/^text\//.test(declaredContentType)) {
    const matched = MAGIC_SIGS.find((sig) => matches(bytes, sig));
    const declared = declaredContentType.toLowerCase();

    if (!matched) {
      return {
        ok: false,
        code: "MAGIC_MISMATCH",
        message: "Uploaded file does not match any known safe format",
      };
    }
    const familyMatch =
      matched.mime === declared ||
      (matched.name === "WEBP" && declared === "image/webp") ||
      (matched.name === "JPEG" && (declared === "image/jpg" || declared === "image/jpeg"));
    if (!familyMatch) {
      return {
        ok: false,
        code: "MAGIC_MISMATCH",
        message: `Declared ${declared} but file is ${matched.name}`,
      };
    }
  }

  // 2. AV scan via clamd. When CLAMD_HOST is unset, scanBuffer returns
  //    skipped=true; we treat skipped as a hard failure if AV_REQUIRED=true,
  //    otherwise it passes. This keeps dev frictionless while letting prod
  //    refuse unscannable uploads.
  const av = await scanBuffer(bytes);
  if (av.skipped && process.env.AV_REQUIRED === "true") {
    return {
      ok: false,
      code: "AV_REQUIRED_BUT_SKIPPED",
      message: `AV scan unavailable (${av.reason}) and AV_REQUIRED=true`,
    };
  }
  if (!av.clean && av.virus) {
    return {
      ok: false,
      code: "AV_INFECTED",
      message: `Antivirus matched: ${av.virus}`,
    };
  }

  return { ok: true, maxBytes: Number.POSITIVE_INFINITY };
}
