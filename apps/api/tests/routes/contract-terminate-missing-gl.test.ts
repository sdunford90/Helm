import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { mockPrisma } from '../setup.js';
import { buildContract } from '../helpers.js';
import * as glPosting from '../../src/services/gl-posting.js';

let app: any;

beforeEach(async () => {
  vi.clearAllMocks();
  const mod = await import('../../src/index.js');
  app = mod.default;
});

// ---------------------------------------------------------------------------
// Route-level regression for task #303.
//
// Production crash: `POST /api/contracts/:id/terminate` returned a generic
// 500 when the tenant's chart of accounts was missing the system 2300
// (Security Deposits Held) row, because `releaseSecurityDeposit` threw a
// plain `Error: GL account 2300 not found ...` mid-transaction.
//
// After the fix the route must surface a clean 4xx with an actionable
// `DEPOSIT_GL_UNCONFIGURED` code — no unhandled exception, no 500.
// ---------------------------------------------------------------------------

describe('POST /api/contracts/:id/terminate — missing system GL account', () => {
  it('returns 400 DEPOSIT_GL_UNCONFIGURED instead of 500 when the location has no 2300 account', async () => {
    const contract = buildContract({ status: 'ACTIVE' });
    const heldDeposit = {
      id: 'dep-no-2300',
      tenantId: 'test-tenant-id',
      locationId: 'loc-missing-2300',
      customerId: contract.customerId,
      contractId: contract.id,
      amountCents: 50000,
      status: 'HELD',
      appliedToInvoiceId: null,
      releasedAt: null,
    };

    mockPrisma.slipContract.findFirst.mockResolvedValue({
      ...contract,
      slip: { id: contract.slipId },
      securityDeposits: [heldDeposit],
    });

    // Pre-flight chart-of-accounts probe: the route runs
    //   findFirst({ where: { tenantId, accountNumber: '2300', OR: [...] }})
    // for each held-deposit location. Returning null simulates the production
    // tenant whose chart never had 2300 created.
    mockPrisma.glAccount.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .post(`/api/contracts/${contract.id}/terminate`)
      .send({ reason: 'No deposit GL configured' });

    // Critical assertion: 400, not 500. The original bug surfaced as an
    // unhandled exception that the Express default error handler turned
    // into a generic 500.
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('code', 'DEPOSIT_GL_UNCONFIGURED');
    expect(String(res.body.error ?? res.body.message ?? '')).toMatch(
      /Security Deposits Held|2300/i,
    );

    // Termination must NOT have proceeded — the pre-flight bails before the
    // $transaction opens, so releaseSecurityDeposit is never called.
    expect(glPosting.releaseSecurityDeposit).not.toHaveBeenCalled();
  });

  it('still returns 400 (not 500) when APPLY_TO_INVOICE is requested but 1200 A/R is also missing', async () => {
    // The pre-flight additionally requires 1200 (A/R) when any deposit is
    // being applied to an invoice rather than refunded. This branch must
    // also surface as 400, not as the historical 500.
    const contract = buildContract({ status: 'ACTIVE', customerId: '00000000-0000-0000-0000-00000000ab01' });
    const heldDeposit = {
      id: '00000000-0000-0000-0000-00000000ab03',
      tenantId: 'test-tenant-id',
      locationId: 'loc-missing-ar',
      customerId: contract.customerId,
      contractId: contract.id,
      amountCents: 25000,
      status: 'HELD',
      appliedToInvoiceId: null,
      releasedAt: null,
    };
    const targetInvoiceId = '00000000-0000-0000-0000-00000000ab02';

    mockPrisma.slipContract.findFirst.mockResolvedValue({
      ...contract,
      slip: { id: contract.slipId },
      securityDeposits: [heldDeposit],
    });
    mockPrisma.invoice.findFirst.mockResolvedValue({
      id: targetInvoiceId,
      customerId: contract.customerId,
      balanceCents: 100000,
      status: 'ISSUED',
    });

    // Pre-flight returns 2300 (so the first guard passes) but null for any
    // other lookup (so 1200 is reported missing). The route's where-clause
    // wraps the account-number filter in an `OR: [{ accountNumber: '…' }, …]`
    // since the subType-fallback landed; match either shape.
    mockPrisma.glAccount.findFirst.mockImplementation(async ({ where }: any) => {
      const wantedNumber: string | undefined =
        where?.accountNumber ?? where?.OR?.[0]?.accountNumber;
      if (wantedNumber === '2300') return { id: 'acct-2300' };
      return null;
    });

    const res = await request(app)
      .post(`/api/contracts/${contract.id}/terminate`)
      .send({
        depositInstructions: [
          { depositId: heldDeposit.id, action: 'APPLY_TO_INVOICE', invoiceId: targetInvoiceId },
        ],
      });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('code', 'DEPOSIT_GL_UNCONFIGURED');
    expect(String(res.body.error ?? res.body.message ?? '')).toMatch(
      /Accounts Receivable|1200/i,
    );
    expect(glPosting.releaseSecurityDeposit).not.toHaveBeenCalled();
  });
});
