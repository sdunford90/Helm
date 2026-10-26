import { z } from "zod";

// --------------------------------------------------------------------------
// Validated environment.
//
// `loadEnv()` is called once at startup (index.ts). It fails fast — the
// process exits with a clear message — when:
//   * a variable that is required in production is missing, or
//   * HELM_DEV_AUTH_BYPASS is enabled while NODE_ENV=production.
//
// Everything that is optional (Stripe, QBO, R2, Twilio, …) stays optional;
// the code paths that need them check for them at use time.
// --------------------------------------------------------------------------

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v === undefined || v.trim() === "" ? undefined : v));

const booleanFlag = z
  .string()
  .optional()
  .transform((v) => v !== undefined && ["true", "1", "yes"].includes(v.trim().toLowerCase()));

const EnvSchema = z.object({
  NODE_ENV: z.string().default("development"),
  API_PORT: z.coerce.number().int().positive().default(3001),

  // Core (required in production — see superRefine below)
  DATABASE_URL: optionalString,
  CLERK_SECRET_KEY: optionalString,
  CLERK_PUBLISHABLE_KEY: optionalString,

  // Local-development escape hatch. Never allowed in production.
  HELM_DEV_AUTH_BYPASS: booleanFlag,

  // Comma-separated list of allowed browser origins.
  CORS_ORIGINS: optionalString,
  // Optional comma-separated Clerk authorized parties (azp claim allow-list).
  CLERK_AUTHORIZED_PARTIES: optionalString,

  // Optional integrations
  STRIPE_SECRET_KEY: optionalString,
  STRIPE_WEBHOOK_SECRET: optionalString,
  STRIPE_CLIENT_ID: optionalString,
  STRIPE_CONNECT_REDIRECT_URI: optionalString,
  QBO_CLIENT_ID: optionalString,
  QBO_CLIENT_SECRET: optionalString,
  QBO_REDIRECT_URI: optionalString,
  QBO_WEBHOOK_VERIFIER_TOKEN: optionalString,
  QBO_ENVIRONMENT: z.enum(["sandbox", "production"]).optional().or(z.literal("").transform(() => undefined)),
  CLERK_WEBHOOK_SECRET: optionalString,
  APP_URL: optionalString,
  APP_BASE_URL: optionalString,
  REDIS_URL: optionalString,
  R2_ENDPOINT: optionalString,
  R2_ACCESS_KEY_ID: optionalString,
  R2_SECRET_ACCESS_KEY: optionalString,
  R2_BUCKET: optionalString,
  R2_PUBLIC_URL: optionalString,
  R2_UPLOAD_URL: optionalString,
  RESEND_API_KEY: optionalString,
  TWILIO_ACCOUNT_SID: optionalString,
  TWILIO_AUTH_TOKEN: optionalString,
  TWILIO_DEFAULT_NUMBER: optionalString,
  ANTHROPIC_API_KEY: optionalString,
  ESIGN_PROVIDER: optionalString,
  DOCUSIGN_API_KEY: optionalString,
  DOCUSIGN_ACCOUNT_ID: optionalString,
  RECAPTCHA_SECRET_KEY: optionalString,
  SENTRY_DSN: optionalString,
});

export type Env = z.infer<typeof EnvSchema>;

const REQUIRED_IN_PRODUCTION = ["DATABASE_URL", "CLERK_SECRET_KEY", "CLERK_PUBLISHABLE_KEY"] as const;

export class EnvError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Invalid environment configuration:\n  - ${problems.join("\n  - ")}`);
    this.name = "EnvError";
  }
}

/**
 * Pure validation (no side effects) so it can be unit-tested.
 * Throws EnvError listing every problem.
 */
export function validateEnv(source: Record<string, string | undefined>): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    throw new EnvError(
      parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
    );
  }

  const env = parsed.data;
  const problems: string[] = [];

  if (env.NODE_ENV === "production") {
    for (const key of REQUIRED_IN_PRODUCTION) {
      if (!env[key]) problems.push(`${key} is required when NODE_ENV=production`);
    }
    if (env.HELM_DEV_AUTH_BYPASS) {
      problems.push(
        "HELM_DEV_AUTH_BYPASS=true is refused when NODE_ENV=production (it disables authentication)",
      );
    }
  }

  if (problems.length > 0) throw new EnvError(problems);
  return env;
}

let cached: Env | undefined;

/**
 * Validate process.env once at startup. On failure, log a clear message and
 * exit the process (fail fast — never boot half-configured).
 */
export function loadEnv(): Env {
  try {
    cached = validateEnv(process.env);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[helm-api] FATAL: ${(err as Error).message}`);
    process.exit(1);
  }
  if (cached.HELM_DEV_AUTH_BYPASS) {
    // eslint-disable-next-line no-console
    console.warn(
      "[helm-api] WARNING: HELM_DEV_AUTH_BYPASS is ON — requests are NOT authenticated. Local development only.",
    );
  }
  return cached;
}

/** Parsed env (validates lazily if loadEnv() has not run, e.g. in tests). */
export function getEnv(): Env {
  return cached ?? validateEnv(process.env);
}

/**
 * Whether the local-dev auth bypass is active. Evaluated per call against the
 * live process.env so it can never be silently on in production: if the flag
 * is set while NODE_ENV=production this throws (and loadEnv() exits at boot).
 */
export function isDevAuthBypassEnabled(): boolean {
  const flag = ["true", "1", "yes"].includes((process.env.HELM_DEV_AUTH_BYPASS ?? "").trim().toLowerCase());
  if (!flag) return false;
  if (process.env.NODE_ENV === "production") {
    throw new EnvError([
      "HELM_DEV_AUTH_BYPASS=true is refused when NODE_ENV=production (it disables authentication)",
    ]);
  }
  return true;
}

/** Parse a comma-separated env value into a trimmed, non-empty list. */
export function parseList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
