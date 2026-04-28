import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  S3Client,
  PutBucketCorsCommand,
  GetBucketCorsCommand,
  type CORSRule,
} from "@aws-sdk/client-s3";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const POLICY_PATH = resolve(__dirname, "..", "r2-cors.json");

interface RawRule {
  AllowedOrigins?: string[];
  AllowedMethods?: string[];
  AllowedHeaders?: string[];
  ExposeHeaders?: string[];
  MaxAgeSeconds?: number;
  [k: string]: unknown;
}

interface RawPolicy {
  CORSRules?: RawRule[];
  [k: string]: unknown;
}

function stripComments<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((v) => stripComments(v)) as unknown as T;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k.startsWith("_")) continue;
      out[k] = stripComments(v);
    }
    return out as unknown as T;
  }
  return value;
}

function loadPolicy(): CORSRule[] {
  const raw = JSON.parse(readFileSync(POLICY_PATH, "utf-8")) as RawPolicy;
  const cleaned = stripComments(raw);
  if (!cleaned.CORSRules || cleaned.CORSRules.length === 0) {
    throw new Error(`No CORSRules found in ${POLICY_PATH}`);
  }
  return cleaned.CORSRules.map((r) => ({
    AllowedOrigins: r.AllowedOrigins ?? [],
    AllowedMethods: r.AllowedMethods ?? [],
    AllowedHeaders: r.AllowedHeaders ?? [],
    ExposeHeaders: r.ExposeHeaders ?? [],
    MaxAgeSeconds: r.MaxAgeSeconds,
  }));
}

function mergeOrigin(rules: CORSRule[], origin: string | undefined): CORSRule[] {
  if (!origin) return rules;
  return rules.map((rule) => {
    const existing = rule.AllowedOrigins ?? [];
    if (existing.includes(origin)) return rule;
    return { ...rule, AllowedOrigins: [...existing, origin] };
  });
}

async function main() {
  const endpoint = process.env.R2_ENDPOINT;
  const bucket = process.env.R2_BUCKET ?? "helm-files";
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

  if (!endpoint || !accessKeyId || !secretAccessKey) {
    throw new Error(
      "R2_ENDPOINT, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY must be set",
    );
  }

  let rules = loadPolicy();

  // Auto-include the current Replit dev preview host so dev uploads work
  // without hand-editing the JSON.
  const replitDev = process.env.REPLIT_DEV_DOMAIN
    ? `https://${process.env.REPLIT_DEV_DOMAIN}`
    : undefined;
  for (const origin of [
    process.env.APP_URL,
    process.env.APP_PORTAL_URL,
    process.env.APP_ADMIN_URL,
    replitDev,
  ]) {
    if (origin && /^https?:\/\//.test(origin)) {
      rules = mergeOrigin(rules, origin);
    }
  }

  const client = new S3Client({
    region: "auto",
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
  });

  console.log(`Applying CORS to bucket "${bucket}" at ${endpoint}`);
  for (const rule of rules) {
    console.log("  rule:", {
      AllowedOrigins: rule.AllowedOrigins,
      AllowedMethods: rule.AllowedMethods,
      AllowedHeaders: rule.AllowedHeaders,
      ExposeHeaders: rule.ExposeHeaders,
      MaxAgeSeconds: rule.MaxAgeSeconds,
    });
  }

  await client.send(
    new PutBucketCorsCommand({
      Bucket: bucket,
      CORSConfiguration: { CORSRules: rules },
    }),
  );

  // Read it back to confirm.
  const verify = await client.send(
    new GetBucketCorsCommand({ Bucket: bucket }),
  );
  console.log("\nApplied. Bucket reports:");
  console.log(JSON.stringify(verify.CORSRules, null, 2));
}

main().catch((err) => {
  console.error("Failed to apply R2 CORS:", err);
  const code =
    err && typeof err === "object" && "Code" in err
      ? (err as { Code?: string }).Code
      : undefined;
  if (code === "AccessDenied") {
    console.error(
      "\nThe R2 token in R2_ACCESS_KEY_ID does not have bucket-admin\n" +
        "permission. PutBucketCors needs an Account API token with R2 admin\n" +
        "scope, not the runtime object-only token. Either:\n" +
        "  1. Issue a temporary admin R2 token in the Cloudflare dashboard\n" +
        "     (R2 → Manage API Tokens → Create) and rerun this script with\n" +
        "     R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY pointing at it, OR\n" +
        "  2. Run `wrangler r2 bucket cors put <bucket> --rules apps/api/r2-cors.json`,\n" +
        "  3. Paste the CORSRules from apps/api/r2-cors.json into the bucket's\n" +
        "     CORS Policy editor in the Cloudflare dashboard.",
    );
  }
  process.exitCode = 1;
});
