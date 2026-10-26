// ---------------------------------------------------------------------------
// Seed safety guard
//
// The seed deletes every tenant (deleteMany) before inserting demo data, so it
// must never run against a production or shared database by accident.
//
// Rules:
//   * NODE_ENV=production            -> always refused (no override)
//   * DATABASE_URL missing/unparsable -> refused
//   * DATABASE_URL host not local     -> refused unless SEED_ALLOW_REMOTE=true
// ---------------------------------------------------------------------------

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

export class SeedRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SeedRefusedError';
  }
}

export function databaseHost(databaseUrl: string): string | null {
  try {
    return new URL(databaseUrl).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function assertSeedAllowed(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV === 'production') {
    throw new SeedRefusedError(
      'Refusing to seed: NODE_ENV=production. The seed deletes all tenants.',
    );
  }

  const url = env.DATABASE_URL;
  if (!url) {
    throw new SeedRefusedError('Refusing to seed: DATABASE_URL is not set.');
  }

  const host = databaseHost(url);
  if (!host) {
    throw new SeedRefusedError('Refusing to seed: DATABASE_URL could not be parsed.');
  }

  if (!LOCAL_HOSTS.has(host) && env.SEED_ALLOW_REMOTE !== 'true') {
    throw new SeedRefusedError(
      `Refusing to seed: database host "${host}" is not localhost. ` +
        'The seed deletes all tenants. Set SEED_ALLOW_REMOTE=true to override.',
    );
  }
}
