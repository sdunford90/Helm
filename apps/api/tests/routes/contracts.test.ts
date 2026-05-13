import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { mockPrisma } from '../setup.js';
import { buildContract, buildSlip, buildCustomer } from '../helpers.js';
import * as glPosting from '../../src/services/gl-posting.js';

let app: any;

beforeEach(async () => {
  vi.clearAllMocks();
  const mod = await import('../../src/index.js');
  app = mod.default;
});

describe('GET /api/contracts', () => {
  it('returns contract list with pagination', async () => {
    const mockContracts = [
      buildContract({ status: 'ACTIVE' }),
      buildContract({ status: 'ACTIVE' }),
    ];
    mockPrisma.slipContract.findMany.mockResolvedValue(mockContracts);
    mockPrisma.slipContract.count.mockResolvedValue(2);

    const res = await request(app).get('/api/contracts');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(res.body).toHaveProperty('pagination');
    expect(res.body.data).toHaveLength(2);
    expect(res.body.pagination).toEqual(
      expect.objectContaining({ total: 2 }),
    );
  });

  it('filters by status query param', async () => {
    mockPrisma.slipContract.findMany.mockResolvedValue([]);
    mockPrisma.slipContract.count.mockResolvedValue(0);

    const res = await request(app).get('/api/contracts?status=ACTIVE');

    expect(res.status).toBe(200);
    expect(mockPrisma.slipContract.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'ACTIVE' }),
      }),
    );
  });
});

describe('POST /api/contracts', () => {
  it('creates a contract with valid data', async () => {
    const SLIP_ID = '00000000-1111-0000-0000-000000000001';
    const CUST_ID = '00000000-2222-0000-0000-000000000002';
    const slip = buildSlip({ id: SLIP_ID, status: 'VACANT' });
    const customer = buildCustomer({ id: CUST_ID });
    const contract = buildContract({
      slipId: SLIP_ID,
      customerId: CUST_ID,
      status: 'ACTIVE',
    });

    mockPrisma.slip.findFirst.mockResolvedValue(slip);
    mockPrisma.customer.findFirst.mockResolvedValue(customer);
    mockPrisma.$transaction.mockImplementation(async (fn: any) => {
      const tx = {
        slipContract: { create: vi.fn().mockResolvedValue(contract) },
        slip: { update: vi.fn().mockResolvedValue(slip) },
        securityDeposit: {
          create: vi.fn().mockImplementation(({ data }: any) =>
            Promise.resolve({ id: 'dep-1', ...data }),
          ),
        },
      };
      return fn(tx);
    });
    mockPrisma.auditLog.create.mockResolvedValue({});

    const res = await request(app)
      .post('/api/contracts')
      .send({
        slipId: SLIP_ID,
        customerId: CUST_ID,
        startDate: '2025-01-01',
        rateCents: 150000,
      });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
  });

  it('persists the caller-intended calendar day when startDate carries a non-UTC offset', async () => {
    // "2026-05-01T23:30:00-07:00" is the instant 2026-05-02T06:30Z.
    // Writing that to a DATE column would truncate to May 2 — the
    // wrong day. The Zod transformer must lock in May 1 first.
    const SLIP_ID = '00000000-1111-0000-0000-000000000099';
    const CUST_ID = '00000000-2222-0000-0000-000000000099';
    const slip = buildSlip({ id: SLIP_ID, status: 'VACANT' });
    const customer = buildCustomer({ id: CUST_ID });
    const contract = buildContract({
      slipId: SLIP_ID,
      customerId: CUST_ID,
      status: 'ACTIVE',
    });

    let observedCreate: any = null;
    mockPrisma.slip.findFirst.mockResolvedValue(slip);
    mockPrisma.customer.findFirst.mockResolvedValue(customer);
    mockPrisma.$transaction.mockImplementation(async (fn: any) => {
      const tx = {
        slipContract: {
          create: vi.fn().mockImplementation((args: any) => {
            observedCreate = args;
            return Promise.resolve(contract);
          }),
        },
        slip: { update: vi.fn().mockResolvedValue(slip) },
        securityDeposit: {
          create: vi.fn().mockResolvedValue({ id: 'dep-tz' }),
        },
      };
      return fn(tx);
    });
    mockPrisma.auditLog.create.mockResolvedValue({});

    const res = await request(app)
      .post('/api/contracts')
      .send({
        slipId: SLIP_ID,
        customerId: CUST_ID,
        startDate: '2026-05-01T23:30:00-07:00',
        endDate: '2026-12-31T23:59:00-07:00',
        rateCents: 150000,
      });

    expect(res.status).toBe(201);
    expect(observedCreate).not.toBeNull();
    const persistedStart: Date = observedCreate.data.startDate;
    const persistedEnd: Date = observedCreate.data.endDate;
    expect(persistedStart.toISOString()).toBe('2026-05-01T00:00:00.000Z');
    expect(persistedEnd.toISOString()).toBe('2026-12-31T00:00:00.000Z');
  });

  it('returns 404 when slip does not exist', async () => {
    mockPrisma.slip.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/contracts')
      .send({
        slipId: '00000000-0000-0000-0000-000000000001',
        customerId: '00000000-0000-0000-0000-000000000002',
        startDate: '2025-01-01',
        rateCents: 150000,
      });

    expect(res.status).toBe(404);
  });

  it('books a security deposit to the originating marina’s GL when one is configured', async () => {
    // When a contract is signed with a security deposit, the route must
    // call postSecurityDeposit inside the create transaction so the
    // deposit lands on the originating marina's bank + 2300 liability
    // (the deposit row carries the slip's locationId, which scopes
    // both lookups to the per-location chart of accounts).  Without
    // this step the SecurityDeposit row would exist but no GL entries
    // would be produced — the deposit would never appear in the
    // marina's books.
    const SLIP_ID = '00000000-1111-0000-0000-000000000010';
    const CUST_ID = '00000000-2222-0000-0000-000000000020';
    const LOC_ID = '00000000-3333-0000-0000-000000000030';
    const slip = buildSlip({ id: SLIP_ID, status: 'VACANT', locationId: LOC_ID });
    const customer = buildCustomer({ id: CUST_ID });
    const contract = buildContract({
      slipId: SLIP_ID,
      customerId: CUST_ID,
      status: 'ACTIVE',
    });

    mockPrisma.slip.findFirst.mockResolvedValue(slip);
    mockPrisma.customer.findFirst.mockResolvedValue(customer);
    mockPrisma.$transaction.mockImplementation(async (fn: any) => {
      const tx = {
        slipContract: { create: vi.fn().mockResolvedValue(contract) },
        slip: { update: vi.fn().mockResolvedValue(slip) },
        securityDeposit: {
          create: vi.fn().mockImplementation(({ data }: any) =>
            Promise.resolve({ id: 'dep-from-create', ...data }),
          ),
        },
      };
      return fn(tx);
    });
    mockPrisma.auditLog.create.mockResolvedValue({});

    const res = await request(app)
      .post('/api/contracts')
      .send({
        slipId: SLIP_ID,
        customerId: CUST_ID,
        startDate: '2025-01-01',
        rateCents: 150000,
        securityDepositCents: 50000,
      });

    expect(res.status).toBe(201);
    expect(glPosting.postSecurityDeposit).toHaveBeenCalledTimes(1);
    expect(glPosting.postSecurityDeposit).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'dep-from-create',
        tenantId: 'test-tenant-id',
        amountCents: 50000,
        locationId: LOC_ID,
      }),
      expect.anything(),
    );
  });

  it('does not post a security deposit GL entry when none is configured', async () => {
    const SLIP_ID = '00000000-1111-0000-0000-000000000011';
    const CUST_ID = '00000000-2222-0000-0000-000000000021';
    const slip = buildSlip({ id: SLIP_ID, status: 'VACANT', locationId: 'loc-1' });
    const customer = buildCustomer({ id: CUST_ID });
    const contract = buildContract({ slipId: SLIP_ID, customerId: CUST_ID });

    mockPrisma.slip.findFirst.mockResolvedValue(slip);
    mockPrisma.customer.findFirst.mockResolvedValue(customer);
    mockPrisma.$transaction.mockImplementation(async (fn: any) => {
      const tx = {
        slipContract: { create: vi.fn().mockResolvedValue(contract) },
        slip: { update: vi.fn() },
        securityDeposit: { create: vi.fn() },
      };
      return fn(tx);
    });

    const res = await request(app)
      .post('/api/contracts')
      .send({
        slipId: SLIP_ID,
        customerId: CUST_ID,
        startDate: '2025-01-01',
        rateCents: 150000,
      });

    expect(res.status).toBe(201);
    expect(glPosting.postSecurityDeposit).not.toHaveBeenCalled();
  });
});

describe('POST /api/contracts/:id/terminate', () => {
  // The terminate route does a pre-flight glAccount.findFirst per deposit
  // location to check 2300 (Security Deposits Held) and 1200 (A/R) exist —
  // and 400s with DEPOSIT_GL_UNCONFIGURED if either is missing. Tests
  // here aren't exercising that error path (a separate file does), so
  // default the lookup to a found-account stub. Individual tests that
  // need the "unconfigured" behavior override with .mockResolvedValueOnce.
  beforeEach(() => {
    mockPrisma.glAccount.findFirst.mockResolvedValue({ id: 'gl-stub' } as any);
  });

  it('terminates an active contract', async () => {
    const contract = buildContract({
      status: 'ACTIVE',
      earlyTerminationType: 'FIXED',
      earlyTerminationValue: 50000,
    });

    mockPrisma.slipContract.findFirst.mockResolvedValue({
      ...contract,
      slip: { id: contract.slipId },
      securityDeposits: [],
    });
    mockPrisma.$transaction.mockImplementation(async (fn: any) => {
      const tx = {
        slipContract: { update: vi.fn() },
        slip: { update: vi.fn() },
        securityDeposit: { update: vi.fn() },
        glEntry: { create: vi.fn() },
        deferredSchedule: { findMany: vi.fn().mockResolvedValue([]), update: vi.fn() },
        auditLog: { create: vi.fn() },
      };
      return fn(tx);
    });

    const res = await request(app)
      .post(`/api/contracts/${contract.id}/terminate`)
      .send({ reason: 'Relocating' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('success', true);
    expect(res.body).toHaveProperty('contractId', contract.id);
    expect(res.body).toHaveProperty('penaltyCents');
    expect(res.body).toHaveProperty('terminationDate');
  });

  it('persists the caller-intended terminationDate when it carries a non-UTC offset', async () => {
    // Same Zod transformer as the create path: a TZ-bearing input
    // must lock in the caller's calendar day before the DATE column
    // truncates the value.
    const contract = buildContract({
      status: 'ACTIVE',
      earlyTerminationType: 'FIXED',
      earlyTerminationValue: 50000,
    });

    let observedUpdate: any = null;
    mockPrisma.slipContract.findFirst.mockResolvedValue({
      ...contract,
      slip: { id: contract.slipId },
      securityDeposits: [],
    });
    mockPrisma.$transaction.mockImplementation(async (fn: any) => {
      const tx = {
        slipContract: {
          update: vi.fn().mockImplementation((args: any) => {
            observedUpdate = args;
            return Promise.resolve({ ...contract, ...args.data });
          }),
        },
        slip: { update: vi.fn() },
        securityDeposit: { update: vi.fn() },
        glEntry: { create: vi.fn() },
        deferredSchedule: { findMany: vi.fn().mockResolvedValue([]), update: vi.fn() },
        auditLog: { create: vi.fn() },
      };
      return fn(tx);
    });

    const res = await request(app)
      .post(`/api/contracts/${contract.id}/terminate`)
      .send({
        reason: 'Relocating',
        terminationDate: '2026-04-15T22:00:00-07:00',
      });

    expect(res.status).toBe(200);
    expect(observedUpdate).not.toBeNull();
    // The route stamps `terminationDate` (not `endDate`) so the scheduled
    // endDate stays intact for "ended-early vs ended-on-schedule" reporting.
    expect(observedUpdate.data.terminationDate.toISOString()).toBe(
      '2026-04-15T00:00:00.000Z',
    );
    expect(res.body.terminationDate).toBe('2026-04-15');
  });

  it('rejects termination of already-terminated contract', async () => {
    const contract = buildContract({ status: 'TERMINATED' });

    mockPrisma.slipContract.findFirst.mockResolvedValue({
      ...contract,
      slip: { id: contract.slipId },
      securityDeposits: [],
    });

    const res = await request(app)
      .post(`/api/contracts/${contract.id}/terminate`)
      .send({});

    expect(res.status).toBe(400);
  });

  it('releases held security deposits to the originating marina’s GL on termination', async () => {
    // On termination, every HELD deposit must be marked RELEASED *and*
    // a reversing GL entry posted on the originating marina's books.
    // The deposit's frozen locationId scopes the reversal to the same
    // per-location bank + 2300 liability rows the original
    // postSecurityDeposit touched, so multi-marina operators with
    // separate QBO realms see the credit unwind on the correct realm.
    const contract = buildContract({ status: 'ACTIVE' });
    const heldDeposit = {
      id: 'dep-held-1',
      tenantId: 'test-tenant-id',
      locationId: 'loc-marina-A',
      customerId: contract.customerId,
      contractId: contract.id,
      amountCents: 75000,
      status: 'HELD',
      appliedToInvoiceId: null,
      releasedAt: null,
    };

    mockPrisma.slipContract.findFirst.mockResolvedValue({
      ...contract,
      slip: { id: contract.slipId },
      securityDeposits: [heldDeposit],
    });

    const securityDepositUpdate = vi.fn();
    mockPrisma.$transaction.mockImplementation(async (fn: any) => {
      const tx = {
        slipContract: { update: vi.fn() },
        slip: { update: vi.fn() },
        securityDeposit: { update: securityDepositUpdate },
        glEntry: { create: vi.fn() },
        deferredSchedule: { findMany: vi.fn().mockResolvedValue([]), update: vi.fn() },
        auditLog: { create: vi.fn() },
      };
      return fn(tx);
    });

    const res = await request(app)
      .post(`/api/contracts/${contract.id}/terminate`)
      .send({ reason: 'Relocating' });

    expect(res.status).toBe(200);
    // The deposit row itself must transition to RELEASED in the same
    // transaction so the row state and the ledger stay in lockstep.
    expect(securityDepositUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'dep-held-1' },
        data: expect.objectContaining({ status: 'RELEASED' }),
      }),
    );
    expect(glPosting.releaseSecurityDeposit).toHaveBeenCalledTimes(1);
    expect(glPosting.releaseSecurityDeposit).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'dep-held-1',
        tenantId: 'test-tenant-id',
        amountCents: 75000,
        locationId: 'loc-marina-A',
        appliedToInvoiceId: null,
      }),
      expect.anything(),
    );
  });

  it('forwards the deposit’s appliedToInvoiceId so release routes through A/R, not bank', async () => {
    // When a held deposit was previously earmarked against a specific
    // invoice (appliedToInvoiceId set), termination must forward that
    // ID to releaseSecurityDeposit so the GL service debits the 2300
    // liability and credits A/R — instead of refunding it back to the
    // marina's bank. The route is the only place this metadata flows
    // from, so we lock it in with a test.
    const contract = buildContract({ status: 'ACTIVE' });
    const heldDeposit = {
      id: 'dep-held-2',
      tenantId: 'test-tenant-id',
      locationId: 'loc-marina-A',
      customerId: contract.customerId,
      contractId: contract.id,
      amountCents: 30000,
      status: 'HELD',
      appliedToInvoiceId: 'inv-final-99',
      releasedAt: null,
    };

    mockPrisma.slipContract.findFirst.mockResolvedValue({
      ...contract,
      slip: { id: contract.slipId },
      securityDeposits: [heldDeposit],
    });
    mockPrisma.$transaction.mockImplementation(async (fn: any) => {
      const tx = {
        slipContract: { update: vi.fn() },
        slip: { update: vi.fn() },
        securityDeposit: { update: vi.fn() },
        glEntry: { create: vi.fn() },
        deferredSchedule: { findMany: vi.fn().mockResolvedValue([]), update: vi.fn() },
        auditLog: { create: vi.fn() },
        invoice: {
          findUnique: vi.fn().mockResolvedValue({ balanceCents: 50000, status: 'ISSUED' }),
          update: vi.fn(),
        },
      };
      return fn(tx);
    });

    const res = await request(app)
      .post(`/api/contracts/${contract.id}/terminate`)
      .send({ reason: 'Moving out — apply to final invoice' });

    expect(res.status).toBe(200);
    expect(glPosting.releaseSecurityDeposit).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'dep-held-2',
        amountCents: 30000,
        locationId: 'loc-marina-A',
        appliedToInvoiceId: 'inv-final-99',
      }),
      expect.anything(),
    );
  });

  it('applies a held deposit to the chosen invoice when the operator picks APPLY_TO_INVOICE', async () => {
    // Operator picked "apply to invoice" for this deposit during termination.
    // The route must (a) update the SecurityDeposit row's appliedToInvoiceId,
    // (b) forward that ID to releaseSecurityDeposit so the journal debits
    // 2300 / credits A/R, and (c) reduce the invoice's balance accordingly,
    // marking it PAID when fully covered. This is the lock-in for the
    // per-deposit-instruction wiring.
    const contract = buildContract({ status: 'ACTIVE', customerId: '00000000-0000-0000-0000-000000000abc' });
    const heldDeposit = {
      id: '00000000-0000-0000-0000-0000000d3901',
      tenantId: 'test-tenant-id',
      locationId: 'loc-marina-A',
      customerId: contract.customerId,
      contractId: contract.id,
      amountCents: 100000,
      status: 'HELD',
      appliedToInvoiceId: null,
      releasedAt: null,
    };
    const targetInvoiceId = '00000000-0000-0000-0000-0000000d3902';

    mockPrisma.slipContract.findFirst.mockResolvedValue({
      ...contract,
      slip: { id: contract.slipId },
      securityDeposits: [heldDeposit],
    });
    // Pre-validation invoice fetch outside the transaction.
    mockPrisma.invoice.findFirst.mockResolvedValue({
      id: targetInvoiceId,
      customerId: contract.customerId,
      balanceCents: 100000,
      status: 'ISSUED',
    });
    const securityDepositUpdate = vi.fn();
    const invoiceUpdate = vi.fn();
    mockPrisma.$transaction.mockImplementation(async (fn: any) => {
      const tx = {
        slipContract: { update: vi.fn() },
        slip: { update: vi.fn() },
        securityDeposit: { update: securityDepositUpdate },
        glEntry: { create: vi.fn() },
        deferredSchedule: { findMany: vi.fn().mockResolvedValue([]), update: vi.fn() },
        auditLog: { create: vi.fn() },
        invoice: {
          findUnique: vi.fn().mockResolvedValue({ balanceCents: 100000, status: 'ISSUED' }),
          update: invoiceUpdate,
        },
      };
      return fn(tx);
    });

    const res = await request(app)
      .post(`/api/contracts/${contract.id}/terminate`)
      .send({
        reason: 'Final invoice settlement',
        depositInstructions: [
          { depositId: heldDeposit.id, action: 'APPLY_TO_INVOICE', invoiceId: targetInvoiceId },
        ],
      });

    expect(res.status).toBe(200);
    expect(securityDepositUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: heldDeposit.id },
        data: expect.objectContaining({
          status: 'RELEASED',
          appliedToInvoiceId: targetInvoiceId,
        }),
      }),
    );
    expect(glPosting.releaseSecurityDeposit).toHaveBeenCalledWith(
      expect.objectContaining({
        id: heldDeposit.id,
        amountCents: 100000,
        appliedToInvoiceId: targetInvoiceId,
      }),
      expect.anything(),
    );
    // Fully covered → invoice balance zeroes and status flips to PAID.
    expect(invoiceUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: targetInvoiceId },
        data: expect.objectContaining({ balanceCents: 0, status: 'PAID' }),
      }),
    );
  });

  it('rejects APPLY_TO_INVOICE when the deposit exceeds the invoice balance', async () => {
    // Partial application is not supported — we'd be left with an awkward
    // 2300 liability remainder and an over-credited A/R. Block it up front.
    const contract = buildContract({ status: 'ACTIVE', customerId: '00000000-0000-0000-0000-000000000abc' });
    const heldDeposit = {
      id: '00000000-0000-0000-0000-0000000d3a01',
      tenantId: 'test-tenant-id',
      locationId: 'loc-marina-A',
      customerId: contract.customerId,
      contractId: contract.id,
      amountCents: 200000,
      status: 'HELD',
      appliedToInvoiceId: null,
      releasedAt: null,
    };
    const targetInvoiceId = '00000000-0000-0000-0000-0000000d3a02';

    mockPrisma.slipContract.findFirst.mockResolvedValue({
      ...contract,
      slip: { id: contract.slipId },
      securityDeposits: [heldDeposit],
    });
    mockPrisma.invoice.findFirst.mockResolvedValue({
      id: targetInvoiceId,
      customerId: contract.customerId,
      balanceCents: 50000,
      status: 'ISSUED',
    });

    const res = await request(app)
      .post(`/api/contracts/${contract.id}/terminate`)
      .send({
        depositInstructions: [
          { depositId: heldDeposit.id, action: 'APPLY_TO_INVOICE', invoiceId: targetInvoiceId },
        ],
      });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('code', 'DEPOSIT_EXCEEDS_INVOICE_BALANCE');
    expect(glPosting.releaseSecurityDeposit).not.toHaveBeenCalled();
  });

  it('rejects APPLY_TO_INVOICE when the invoice is not open (e.g., DRAFT)', async () => {
    // Status gating: only ISSUED / PAST_DUE / COLLECTIONS invoices should be
    // valid targets. DRAFT isn't yet a customer-facing receivable, PAID has
    // nothing to absorb, and VOID is closed.
    const contract = buildContract({ status: 'ACTIVE', customerId: '00000000-0000-0000-0000-000000000abc' });
    const heldDeposit = {
      id: '00000000-0000-0000-0000-0000000d3c01',
      tenantId: 'test-tenant-id',
      locationId: 'loc-marina-A',
      customerId: contract.customerId,
      contractId: contract.id,
      amountCents: 50000,
      status: 'HELD',
      appliedToInvoiceId: null,
      releasedAt: null,
    };
    const targetInvoiceId = '00000000-0000-0000-0000-0000000d3c02';

    mockPrisma.slipContract.findFirst.mockResolvedValue({
      ...contract,
      slip: { id: contract.slipId },
      securityDeposits: [heldDeposit],
    });
    mockPrisma.invoice.findFirst.mockResolvedValue({
      id: targetInvoiceId,
      customerId: contract.customerId,
      balanceCents: 100000,
      status: 'DRAFT',
    });

    const res = await request(app)
      .post(`/api/contracts/${contract.id}/terminate`)
      .send({
        depositInstructions: [
          { depositId: heldDeposit.id, action: 'APPLY_TO_INVOICE', invoiceId: targetInvoiceId },
        ],
      });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('code', 'INVOICE_NOT_OPEN');
    expect(glPosting.releaseSecurityDeposit).not.toHaveBeenCalled();
  });

  it('rejects when multiple deposits applied to the same invoice would over-credit it', async () => {
    // Two deposits — each individually fits within the invoice balance, but
    // their *sum* exceeds it. The route must aggregate per invoice and
    // reject up front, otherwise GL would post A/R credits totaling more
    // than the receivable, leaving the books off.
    const contract = buildContract({ status: 'ACTIVE', customerId: '00000000-0000-0000-0000-000000000abc' });
    const dep1 = {
      id: '00000000-0000-0000-0000-0000000d3d01',
      tenantId: 'test-tenant-id',
      locationId: 'loc-marina-A',
      customerId: contract.customerId,
      contractId: contract.id,
      amountCents: 60000,
      status: 'HELD',
      appliedToInvoiceId: null,
      releasedAt: null,
    };
    const dep2 = { ...dep1, id: '00000000-0000-0000-0000-0000000d3d02', amountCents: 70000 };
    const targetInvoiceId = '00000000-0000-0000-0000-0000000d3d03';

    mockPrisma.slipContract.findFirst.mockResolvedValue({
      ...contract,
      slip: { id: contract.slipId },
      securityDeposits: [dep1, dep2],
    });
    mockPrisma.invoice.findFirst.mockResolvedValue({
      id: targetInvoiceId,
      customerId: contract.customerId,
      balanceCents: 100000, // less than 60000 + 70000
      status: 'ISSUED',
    });

    const res = await request(app)
      .post(`/api/contracts/${contract.id}/terminate`)
      .send({
        depositInstructions: [
          { depositId: dep1.id, action: 'APPLY_TO_INVOICE', invoiceId: targetInvoiceId },
          { depositId: dep2.id, action: 'APPLY_TO_INVOICE', invoiceId: targetInvoiceId },
        ],
      });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('code', 'DEPOSIT_EXCEEDS_INVOICE_BALANCE');
    expect(glPosting.releaseSecurityDeposit).not.toHaveBeenCalled();
  });

  it('rejects when a concurrent payment shrinks the invoice balance mid-transaction', async () => {
    // Pre-validation saw a balance large enough to absorb the deposit, but
    // by the time the in-tx re-read fires another payment has shrunk it.
    // The route must throw and roll back rather than silently clamp the
    // balance to zero (which would leave A/R over-credited by the GL post).
    const contract = buildContract({ status: 'ACTIVE', customerId: '00000000-0000-0000-0000-000000000abc' });
    const heldDeposit = {
      id: '00000000-0000-0000-0000-0000000d3e01',
      tenantId: 'test-tenant-id',
      locationId: 'loc-marina-A',
      customerId: contract.customerId,
      contractId: contract.id,
      amountCents: 100000,
      status: 'HELD',
      appliedToInvoiceId: null,
      releasedAt: null,
    };
    const targetInvoiceId = '00000000-0000-0000-0000-0000000d3e02';

    mockPrisma.slipContract.findFirst.mockResolvedValue({
      ...contract,
      slip: { id: contract.slipId },
      securityDeposits: [heldDeposit],
    });
    // Pre-validation sees a balance of 100000 — exactly enough.
    mockPrisma.invoice.findFirst.mockResolvedValue({
      id: targetInvoiceId,
      customerId: contract.customerId,
      balanceCents: 100000,
      status: 'ISSUED',
    });
    mockPrisma.$transaction.mockImplementation(async (fn: any) => {
      const tx = {
        slipContract: { update: vi.fn() },
        slip: { update: vi.fn() },
        securityDeposit: { update: vi.fn() },
        glEntry: { create: vi.fn() },
        deferredSchedule: { findMany: vi.fn().mockResolvedValue([]), update: vi.fn() },
        auditLog: { create: vi.fn() },
        invoice: {
          // Mid-transaction re-read sees a smaller balance (a payment landed).
          findUnique: vi.fn().mockResolvedValue({ balanceCents: 25000, status: 'ISSUED' }),
          update: vi.fn(),
        },
      };
      return fn(tx);
    });

    const res = await request(app)
      .post(`/api/contracts/${contract.id}/terminate`)
      .send({
        depositInstructions: [
          { depositId: heldDeposit.id, action: 'APPLY_TO_INVOICE', invoiceId: targetInvoiceId },
        ],
      });

    expect(res.status).toBe(409);
    expect(res.body).toHaveProperty('code', 'INVOICE_BALANCE_CHANGED');
  });

  it('rejects an instruction targeting a deposit that is not on this contract', async () => {
    const contract = buildContract({ status: 'ACTIVE', customerId: '00000000-0000-0000-0000-000000000abc' });
    mockPrisma.slipContract.findFirst.mockResolvedValue({
      ...contract,
      slip: { id: contract.slipId },
      securityDeposits: [], // no held deposits at all
    });

    const res = await request(app)
      .post(`/api/contracts/${contract.id}/terminate`)
      .send({
        depositInstructions: [
          { depositId: '00000000-0000-0000-0000-0000000bad01', action: 'REFUND' },
        ],
      });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('code', 'INVALID_DEPOSIT');
  });

  it('rejects duplicate instructions for the same deposit', async () => {
    const contract = buildContract({ status: 'ACTIVE', customerId: '00000000-0000-0000-0000-000000000abc' });
    const heldDeposit = {
      id: '00000000-0000-0000-0000-0000000d3f01',
      tenantId: 'test-tenant-id',
      locationId: 'loc-marina-A',
      customerId: contract.customerId,
      contractId: contract.id,
      amountCents: 30000,
      status: 'HELD',
      appliedToInvoiceId: null,
      releasedAt: null,
    };
    mockPrisma.slipContract.findFirst.mockResolvedValue({
      ...contract,
      slip: { id: contract.slipId },
      securityDeposits: [heldDeposit],
    });

    const res = await request(app)
      .post(`/api/contracts/${contract.id}/terminate`)
      .send({
        depositInstructions: [
          { depositId: heldDeposit.id, action: 'REFUND' },
          { depositId: heldDeposit.id, action: 'REFUND' },
        ],
      });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('code', 'DUPLICATE_DEPOSIT_INSTRUCTION');
  });

  it('records per-deposit refund/apply choices in the audit log', async () => {
    // The audit trail needs to explain *why* each deposit went where it did,
    // since the choice has real cash-flow consequences (refund vs. A/R offset).
    const contract = buildContract({ status: 'ACTIVE', customerId: '00000000-0000-0000-0000-000000000abc' });
    const heldDeposit = {
      id: '00000000-0000-0000-0000-0000000d3b01',
      tenantId: 'test-tenant-id',
      locationId: 'loc-marina-A',
      customerId: contract.customerId,
      contractId: contract.id,
      amountCents: 40000,
      status: 'HELD',
      appliedToInvoiceId: null,
      releasedAt: null,
    };
    const targetInvoiceId = '00000000-0000-0000-0000-0000000d3b02';

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
    const auditLogCreate = vi.fn();
    mockPrisma.$transaction.mockImplementation(async (fn: any) => {
      const tx = {
        slipContract: { update: vi.fn() },
        slip: { update: vi.fn() },
        securityDeposit: { update: vi.fn() },
        glEntry: { create: vi.fn() },
        deferredSchedule: { findMany: vi.fn().mockResolvedValue([]), update: vi.fn() },
        auditLog: { create: auditLogCreate },
        invoice: {
          findUnique: vi.fn().mockResolvedValue({ balanceCents: 100000, status: 'ISSUED' }),
          update: vi.fn(),
        },
      };
      return fn(tx);
    });

    const res = await request(app)
      .post(`/api/contracts/${contract.id}/terminate`)
      .send({
        depositInstructions: [
          { depositId: heldDeposit.id, action: 'APPLY_TO_INVOICE', invoiceId: targetInvoiceId },
        ],
      });

    expect(res.status).toBe(200);
    expect(auditLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'TERMINATED',
          changedFieldsJson: expect.objectContaining({
            depositActions: [
              expect.objectContaining({
                depositId: heldDeposit.id,
                action: 'APPLY_TO_INVOICE',
                invoiceId: targetInvoiceId,
                amountCents: 40000,
              }),
            ],
          }),
        }),
      }),
    );
  });

  it('calls postEarlyTermination with computed penalty + deferred washout', async () => {
    // Plan 2 — the previously orphaned `postEarlyTermination` helper is now
    // invoked from the terminate handler. Verify both inputs: a calculated
    // penalty from earlyTerminationValue, and a washout summed across
    // pending deferred schedules tied to this contract's invoice lines.
    const contract = buildContract({
      status: 'ACTIVE',
      earlyTerminationType: 'FIXED',
      earlyTerminationValue: 50000,
      locationId: 'loc-marina-A',
    });

    mockPrisma.slipContract.findFirst.mockResolvedValue({
      ...contract,
      slip: { id: contract.slipId, locationId: 'loc-marina-A' },
      securityDeposits: [],
    });
    mockPrisma.$transaction.mockImplementation(async (fn: any) => {
      const tx = {
        slipContract: { update: vi.fn() },
        slip: { update: vi.fn() },
        securityDeposit: { update: vi.fn() },
        glEntry: { create: vi.fn() },
        deferredSchedule: {
          findMany: vi.fn().mockResolvedValue([
            { id: 'ds-1', totalCents: 120000, recognizedCents: 30000 },
            { id: 'ds-2', totalCents: 80000, recognizedCents: 80000 }, // fully recognized — no washout
          ]),
          update: vi.fn(),
        },
        auditLog: { create: vi.fn() },
      };
      return fn(tx);
    });

    const res = await request(app)
      .post(`/api/contracts/${contract.id}/terminate`)
      .send({ reason: 'Plan 2 test' });

    expect(res.status).toBe(200);
    expect(glPosting.postEarlyTermination).toHaveBeenCalledTimes(1);
    expect(glPosting.postEarlyTermination).toHaveBeenCalledWith(
      expect.objectContaining({
        id: contract.id,
        tenantId: 'test-tenant-id',
        locationId: 'loc-marina-A',
      }),
      50000,        // penaltyCents
      90000,        // washoutCents (only ds-1 had 90k unrecognized)
      expect.anything(), // the tx handle
    );
  });
});

// ---------------------------------------------------------------------------
// End-to-end: route → real gl-posting service
// ---------------------------------------------------------------------------
// The gl-posting service has its own per-location unit tests. Here we
// rewire the contracts route on top of the *real* service to assert that
// creating a contract with a security deposit produces a balanced
// debit/credit pair against the originating marina's bank (1010) and
// security-deposits-held (2300) chart rows — i.e. the deposit actually
// hits the marina's books, not just a SecurityDeposit row.

describe('POST /api/contracts (security deposit GL — end to end)', () => {
  beforeEach(async () => {
    vi.resetModules();
    // Replace the global gl-posting mock with the real implementation
    // so the route's call to postSecurityDeposit exercises the real
    // chart-of-accounts lookups + glEntry.createMany write.
    vi.doMock('../../src/services/gl-posting.js', async (importOriginal) => {
      return await importOriginal();
    });
    const mod = await import('../../src/index.js');
    app = mod.default;
  });

  it('writes balanced GL entries against the marina’s bank and 2300 liability', async () => {
    const SLIP_ID = '00000000-1111-0000-0000-000000000040';
    const CUST_ID = '00000000-2222-0000-0000-000000000041';
    const LOC_ID = 'loc-marina-A';
    const slip = buildSlip({ id: SLIP_ID, status: 'VACANT', locationId: LOC_ID });
    const customer = buildCustomer({ id: CUST_ID });
    const contract = buildContract({
      slipId: SLIP_ID,
      customerId: CUST_ID,
      status: 'ACTIVE',
    });

    mockPrisma.slip.findFirst.mockResolvedValue(slip);
    mockPrisma.customer.findFirst.mockResolvedValue(customer);

    // Per-location chart of accounts for marina A. The strict
    // postSecurityDeposit lookup path requires the originating marina
    // to be QBO-connected so location.findUnique must return a tokened
    // realm; otherwise resolution falls through to the tenant-wide
    // chart and we lose the per-location guarantee.
    mockPrisma.location.findUnique.mockImplementation(async ({ where }: any) => ({
      id: where.id,
      qboAccessToken: 'tok',
      qboRealmId: `realm-${where.id}`,
    }));
    const CHART: Record<string, string> = {
      '1010': 'acct-A-bank',
      '2300': 'acct-A-deposits',
    };
    mockPrisma.glAccount.findFirst.mockImplementation(async ({ where }: any) => {
      if (where?.locationId !== LOC_ID) return null;
      const id = CHART[where.accountNumber as string];
      return id ? { id } : null;
    });

    const createMany = vi.fn().mockResolvedValue({ count: 2 });
    mockPrisma.$transaction.mockImplementation(async (fn: any) => {
      const tx = {
        slipContract: { create: vi.fn().mockResolvedValue(contract) },
        slip: { update: vi.fn().mockResolvedValue(slip) },
        securityDeposit: {
          create: vi.fn().mockImplementation(({ data }: any) =>
            Promise.resolve({ id: 'dep-e2e-1', ...data }),
          ),
        },
        // The real gl-posting service writes through tx.glEntry / tx.glAccount /
        // tx.location when a transaction client is provided. Mirror them onto
        // the same mocks the test set up above.
        glEntry: { createMany },
        glAccount: mockPrisma.glAccount,
        location: mockPrisma.location,
      };
      return fn(tx);
    });

    const res = await request(app)
      .post('/api/contracts')
      .send({
        slipId: SLIP_ID,
        customerId: CUST_ID,
        startDate: '2025-01-01',
        rateCents: 150000,
        securityDepositCents: 50000,
      });

    expect(res.status).toBe(201);
    expect(createMany).toHaveBeenCalledTimes(1);

    const entries = createMany.mock.calls[0][0].data as Array<{
      accountId: string;
      debitCents: number;
      creditCents: number;
    }>;

    // Balanced
    const totalDebits = entries.reduce((s, e) => s + e.debitCents, 0);
    const totalCredits = entries.reduce((s, e) => s + e.creditCents, 0);
    expect(totalDebits).toBe(50000);
    expect(totalCredits).toBe(50000);

    // Booked against marina A's bank (debit) and 2300 liability (credit)
    const debit = entries.find((e) => e.debitCents > 0);
    const credit = entries.find((e) => e.creditCents > 0);
    expect(debit?.accountId).toBe(CHART['1010']);
    expect(credit?.accountId).toBe(CHART['2300']);
  });
});

// ─── Task #274 — DockageRate link on SlipContract ─────────────────
//
// These tests pin the API contract for the new `dockageRateId` field
// on POST /api/contracts. The validation has to be tighter than just
// "FK exists" because mismatched (tenant, location, slipType) would
// silently route a contract's GL/tax through another marina's plan.
describe('POST /api/contracts — dockageRateId link (Task #274)', () => {
  const SLIP_ID = '00000000-1111-0000-0000-000000000201';
  const CUST_ID = '00000000-2222-0000-0000-000000000202';
  const LOC_ID = '00000000-3333-0000-0000-000000000203';
  const RATE_ID = '00000000-4444-0000-0000-000000000204';

  function setupHappyTx(contract: any, slip: any, customer: any) {
    mockPrisma.slip.findFirst.mockResolvedValue(slip);
    mockPrisma.customer.findFirst.mockResolvedValue(customer);
    mockPrisma.$transaction.mockImplementation(async (fn: any) => {
      const tx = {
        slipContract: { create: vi.fn().mockResolvedValue(contract) },
        slip: { update: vi.fn().mockResolvedValue(slip) },
        securityDeposit: { create: vi.fn() },
      };
      return fn(tx);
    });
    mockPrisma.auditLog.create.mockResolvedValue({});
  }

  it('accepts a matching active rate plan and persists dockageRateId', async () => {
    const slip = buildSlip({ id: SLIP_ID, status: 'VACANT', locationId: LOC_ID, slipType: 'STANDARD' });
    const customer = buildCustomer({ id: CUST_ID });
    const contract = buildContract({ slipId: SLIP_ID, customerId: CUST_ID });
    setupHappyTx(contract, slip, customer);
    mockPrisma.dockageRate.findFirst.mockResolvedValue({
      id: RATE_ID,
      locationId: LOC_ID,
      slipType: 'STANDARD',
      active: true,
      monthlyRateCents: 150000,
      electricityMode: null,
    });

    const res = await request(app)
      .post('/api/contracts')
      .send({
        slipId: SLIP_ID,
        customerId: CUST_ID,
        startDate: '2026-05-01',
        rateCents: 150000,
        dockageRateId: RATE_ID,
      });

    expect(res.status).toBe(201);
    // The rate-plan lookup must scope by tenant — never just by id.
    expect(mockPrisma.dockageRate.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: RATE_ID, tenantId: 'test-tenant-id' }) }),
    );
  });

  it('rejects a rate plan whose location differs from the slip', async () => {
    const slip = buildSlip({ id: SLIP_ID, status: 'VACANT', locationId: LOC_ID, slipType: 'STANDARD' });
    const customer = buildCustomer({ id: CUST_ID });
    setupHappyTx(buildContract({ slipId: SLIP_ID, customerId: CUST_ID }), slip, customer);
    mockPrisma.dockageRate.findFirst.mockResolvedValue({
      id: RATE_ID,
      locationId: 'other-loc',
      slipType: 'STANDARD',
      active: true,
      monthlyRateCents: 150000,
      electricityMode: null,
    });

    const res = await request(app)
      .post('/api/contracts')
      .send({
        slipId: SLIP_ID,
        customerId: CUST_ID,
        startDate: '2026-05-01',
        rateCents: 150000,
        dockageRateId: RATE_ID,
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('DOCKAGE_RATE_LOCATION_MISMATCH');
  });

  it('rejects a rate plan whose slipType differs from the slip', async () => {
    const slip = buildSlip({ id: SLIP_ID, status: 'VACANT', locationId: LOC_ID, slipType: 'STANDARD' });
    const customer = buildCustomer({ id: CUST_ID });
    setupHappyTx(buildContract({ slipId: SLIP_ID, customerId: CUST_ID }), slip, customer);
    mockPrisma.dockageRate.findFirst.mockResolvedValue({
      id: RATE_ID,
      locationId: LOC_ID,
      slipType: 'COVERED',
      active: true,
      monthlyRateCents: 200000,
      electricityMode: null,
    });

    const res = await request(app)
      .post('/api/contracts')
      .send({
        slipId: SLIP_ID,
        customerId: CUST_ID,
        startDate: '2026-05-01',
        rateCents: 150000,
        dockageRateId: RATE_ID,
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('DOCKAGE_RATE_SLIP_TYPE_MISMATCH');
  });

  it('rejects an inactive rate plan', async () => {
    const slip = buildSlip({ id: SLIP_ID, status: 'VACANT', locationId: LOC_ID, slipType: 'STANDARD' });
    const customer = buildCustomer({ id: CUST_ID });
    setupHappyTx(buildContract({ slipId: SLIP_ID, customerId: CUST_ID }), slip, customer);
    mockPrisma.dockageRate.findFirst.mockResolvedValue({
      id: RATE_ID,
      locationId: LOC_ID,
      slipType: 'STANDARD',
      active: false,
      monthlyRateCents: 150000,
      electricityMode: null,
    });

    const res = await request(app)
      .post('/api/contracts')
      .send({
        slipId: SLIP_ID,
        customerId: CUST_ID,
        startDate: '2026-05-01',
        rateCents: 150000,
        dockageRateId: RATE_ID,
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('DOCKAGE_RATE_INACTIVE');
  });

  it('returns 404 when the rate plan does not exist for this tenant', async () => {
    const slip = buildSlip({ id: SLIP_ID, status: 'VACANT', locationId: LOC_ID, slipType: 'STANDARD' });
    const customer = buildCustomer({ id: CUST_ID });
    setupHappyTx(buildContract({ slipId: SLIP_ID, customerId: CUST_ID }), slip, customer);
    mockPrisma.dockageRate.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/contracts')
      .send({
        slipId: SLIP_ID,
        customerId: CUST_ID,
        startDate: '2026-05-01',
        rateCents: 150000,
        dockageRateId: RATE_ID,
      });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('DOCKAGE_RATE_NOT_FOUND');
  });

  it('defaults rateCents and electricityMode from the linked plan when caller omits them', async () => {
    const slip = buildSlip({ id: SLIP_ID, status: 'VACANT', locationId: LOC_ID, slipType: 'STANDARD' });
    const customer = buildCustomer({ id: CUST_ID });
    const created = buildContract({ slipId: SLIP_ID, customerId: CUST_ID });
    const createSpy = vi.fn().mockResolvedValue(created);
    mockPrisma.slip.findFirst.mockResolvedValue(slip);
    mockPrisma.customer.findFirst.mockResolvedValue(customer);
    mockPrisma.$transaction.mockImplementation(async (fn: any) => fn({
      slipContract: { create: createSpy },
      slip: { update: vi.fn().mockResolvedValue(slip) },
      securityDeposit: { create: vi.fn() },
    }));
    mockPrisma.auditLog.create.mockResolvedValue({});
    mockPrisma.dockageRate.findFirst.mockResolvedValue({
      id: RATE_ID,
      locationId: LOC_ID,
      slipType: 'STANDARD',
      active: true,
      monthlyRateCents: 175000,
      electricityMode: 'METERED',
    });

    const res = await request(app)
      .post('/api/contracts')
      .send({
        slipId: SLIP_ID,
        customerId: CUST_ID,
        startDate: '2026-05-01',
        dockageRateId: RATE_ID,
      });

    expect(res.status).toBe(201);
    expect(createSpy).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        rateCents: 175000,
        electricityMode: 'METERED',
        dockageRateId: RATE_ID,
      }),
    }));
  });

  it('rejects when neither rateCents nor dockageRateId is provided', async () => {
    const res = await request(app)
      .post('/api/contracts')
      .send({
        slipId: SLIP_ID,
        customerId: CUST_ID,
        startDate: '2026-05-01',
      });

    expect(res.status).toBe(400);
  });

  it('still creates the contract when dockageRateId is omitted (legacy path)', async () => {
    const slip = buildSlip({ id: SLIP_ID, status: 'VACANT', locationId: LOC_ID, slipType: 'STANDARD' });
    const customer = buildCustomer({ id: CUST_ID });
    const contract = buildContract({ slipId: SLIP_ID, customerId: CUST_ID });
    setupHappyTx(contract, slip, customer);

    const res = await request(app)
      .post('/api/contracts')
      .send({
        slipId: SLIP_ID,
        customerId: CUST_ID,
        startDate: '2026-05-01',
        rateCents: 150000,
      });

    expect(res.status).toBe(201);
    // No plan validation should have happened.
    expect(mockPrisma.dockageRate.findFirst).not.toHaveBeenCalled();
  });
});
