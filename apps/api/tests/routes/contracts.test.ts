import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { mockPrisma } from '../setup.js';
import { buildContract, buildSlip, buildCustomer } from '../helpers.js';

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
        securityDeposit: { create: vi.fn() },
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
});

describe('POST /api/contracts/:id/terminate', () => {
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
});
