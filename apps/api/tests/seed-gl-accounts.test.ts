import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SEED_GL_ACCOUNTS, GL_POSTING_ACCOUNT_NUMBERS } from '../prisma/seed/gl-accounts.js';

describe('seeded chart of accounts', () => {
  it('contains every account number services/gl-posting.ts references', () => {
    const src = readFileSync(
      fileURLToPath(new URL('../src/services/gl-posting.ts', import.meta.url)),
      'utf8',
    );
    const block = src.match(/const ACCOUNTS = \{([\s\S]*?)\} as const;/);
    expect(block).not.toBeNull();
    const referenced = [...block![1].matchAll(/"(\d{4})"/g)].map((m) => m[1]);
    expect(referenced.length).toBeGreaterThan(5);

    const seeded = new Set(SEED_GL_ACCOUNTS.map((a) => a.accountNumber));
    for (const n of referenced) expect(seeded.has(n), `GL account ${n}`).toBe(true);
    expect([...referenced].sort()).toEqual([...GL_POSTING_ACCOUNT_NUMBERS].sort());
  });

  it('has unique account numbers and marks deferred revenue', () => {
    const numbers = SEED_GL_ACCOUNTS.map((a) => a.accountNumber);
    expect(new Set(numbers).size).toBe(numbers.length);
    expect(SEED_GL_ACCOUNTS.find((a) => a.accountNumber === '2400')).toMatchObject({ isDeferredRevenue: true });
  });
});
