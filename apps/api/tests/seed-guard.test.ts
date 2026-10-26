import { describe, it, expect } from 'vitest';
import { assertSeedAllowed, SeedRefusedError } from '../prisma/seed/guard.js';

const LOCAL = 'postgresql://helm@localhost:5432/helm';

describe('seed guard', () => {
  it('refuses NODE_ENV=production even for a local database or with the override', () => {
    expect(() => assertSeedAllowed({ NODE_ENV: 'production', DATABASE_URL: LOCAL })).toThrow(SeedRefusedError);
    expect(() =>
      assertSeedAllowed({ NODE_ENV: 'production', DATABASE_URL: LOCAL, SEED_ALLOW_REMOTE: 'true' }),
    ).toThrow(/production/);
  });

  it('allows local databases', () => {
    expect(() => assertSeedAllowed({ DATABASE_URL: LOCAL })).not.toThrow();
    expect(() => assertSeedAllowed({ DATABASE_URL: 'postgresql://helm@127.0.0.1:5433/helm' })).not.toThrow();
    expect(() => assertSeedAllowed({ DATABASE_URL: 'postgresql://helm@[::1]:5432/helm' })).not.toThrow();
  });

  it('refuses a remote database unless SEED_ALLOW_REMOTE=true', () => {
    const remote = 'postgresql://u:p@db.prod.example.com:5432/helm';
    expect(() => assertSeedAllowed({ DATABASE_URL: remote })).toThrow(/not localhost/);
    expect(() => assertSeedAllowed({ DATABASE_URL: remote, SEED_ALLOW_REMOTE: '1' })).toThrow();
    expect(() => assertSeedAllowed({ DATABASE_URL: remote, SEED_ALLOW_REMOTE: 'true' })).not.toThrow();
  });

  it('refuses a missing or unparsable DATABASE_URL', () => {
    expect(() => assertSeedAllowed({})).toThrow(/not set/);
    expect(() => assertSeedAllowed({ DATABASE_URL: 'not a url' })).toThrow(/parsed/);
  });

  it('does not treat a hostname that merely contains "localhost" as local', () => {
    expect(() => assertSeedAllowed({ DATABASE_URL: 'postgresql://u@localhost.evil.example.com/helm' })).toThrow();
  });
});
