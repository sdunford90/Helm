import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockPrisma } from '../setup.js';
import { buildContract } from '../helpers.js';

let mod: typeof import('../../src/services/renewal-engine.js');

const tx = {
  renewalBatch: { create: vi.fn(), update: vi.fn() },
  slipContract: { updateMany: vi.fn(), create: vi.fn(), update: vi.fn() },
  auditLog: { create: vi.fn() },
};

beforeEach(async () => {
  vi.clearAllMocks();
  mockPrisma.slipContract.findMany.mockReset().mockResolvedValue([]);
  mockPrisma.renewalBatch.update.mockReset();
  mockPrisma.renewalBatch.findFirst.mockReset();
  tx.renewalBatch.create.mockResolvedValue({ id: 'batch-1' });
  mockPrisma.$transaction.mockImplementation(async (fn: any) => fn(tx));
  mod = await import('../../src/services/renewal-engine.js');
});

function withRelations(c: Record<string, unknown>) {
  return {
    ...c,
    slip: { id: 'slip-1', slipNumber: 'A-1', dockId: null, slipType: null },
    customer: { id: 'cust-1', firstName: 'Jane', lastName: 'Smith', email: 'jane@test.com' },
  };
}

describe('autoRenewCheck', () => {
  it('only batches the eligible autoRenew, unbatched contracts and does not auto-approve', async () => {
    const eligible = buildContract({ id: 'con-auto', autoRenew: true, renewalBatchId: null });

    mockPrisma.slipContract.findMany
      // 1st call: eligibility query inside autoRenewCheck
      .mockResolvedValueOnce([eligible])
      // 2nd call: createBatch's query
      .mockResolvedValueOnce([withRelations(eligible)]);

    const result = await mod.autoRenewCheck('tenant-1');

    expect(result).toEqual({ batchId: 'batch-1', contractCount: 1 });

    const eligibilityWhere = mockPrisma.slipContract.findMany.mock.calls[0][0].where;
    expect(eligibilityWhere).toEqual(
      expect.objectContaining({ tenantId: 'tenant-1', autoRenew: true, renewalBatchId: null }),
    );

    const batchWhere = mockPrisma.slipContract.findMany.mock.calls[1][0].where;
    expect(batchWhere).toEqual(
      expect.objectContaining({
        tenantId: 'tenant-1',
        autoRenew: true,
        renewalBatchId: null,
        id: { in: ['con-auto'] },
      }),
    );

    // Created as DRAFT and never approved.
    expect(tx.renewalBatch.create.mock.calls[0][0].data.status).toBe('DRAFT');
    expect(mockPrisma.renewalBatch.update).not.toHaveBeenCalled();
    expect(tx.renewalBatch.update).not.toHaveBeenCalled();
  });

  it('creates no batch when nothing is eligible', async () => {
    mockPrisma.slipContract.findMany.mockResolvedValueOnce([]);
    const result = await mod.autoRenewCheck('tenant-1');
    expect(result).toEqual({ batchId: null, contractCount: 0 });
    expect(tx.renewalBatch.create).not.toHaveBeenCalled();
  });
});

describe('createBatch', () => {
  it('never takes contracts that already belong to another batch', async () => {
    mockPrisma.slipContract.findMany.mockResolvedValueOnce([withRelations(buildContract())]);
    await mod.createBatch('tenant-1', 'user-1', {}, { type: 'fixedPercent', value: 3 });
    const where = mockPrisma.slipContract.findMany.mock.calls[0][0].where;
    expect(where.renewalBatchId).toBeNull();
    expect(where.autoRenew).toBeUndefined();
  });
});

describe('executeBatch', () => {
  it('refuses to execute a DRAFT (unapproved) batch', async () => {
    mockPrisma.renewalBatch.findFirst.mockResolvedValue({ id: 'batch-1', status: 'DRAFT' });
    await expect(mod.executeBatch('batch-1', 'tenant-1', 'user-1')).rejects.toMatchObject({
      code: 'INVALID_BATCH_STATUS',
    });
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('executes an APPROVED batch, unlinks successors and queues a typed renewal email', async () => {
    const { queues } = await import('../../src/lib/queue.js');
    mockPrisma.renewalBatch.findFirst.mockResolvedValue({
      id: 'batch-1',
      status: 'APPROVED',
      rateIncreaseType: 'none',
      rateIncreaseValue: null,
    });
    mockPrisma.slipContract.findMany.mockResolvedValueOnce([
      withRelations(buildContract({ id: 'con-1', endDate: new Date('2026-12-31T00:00:00Z') })),
    ]);
    tx.slipContract.create.mockResolvedValue({ id: 'con-2' });

    const result = await mod.executeBatch('batch-1', 'tenant-1', 'user-1');

    expect(result.newContractIds).toEqual(['con-2']);
    expect(tx.slipContract.create.mock.calls[0][0].data.renewalBatchId).toBeNull();
    const [name, payload] = (queues.email.add as any).mock.calls[0];
    expect(name).toBe('renewal-esign');
    expect(payload).toEqual(
      expect.objectContaining({
        type: 'renewal_esign',
        to: 'jane@test.com',
        contractId: 'con-2',
        slipNumber: 'A-1',
      }),
    );
  });
});
