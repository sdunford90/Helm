import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { mockPrisma } from '../setup.js';
import {
  assertSystemFeeGlAccountId,
  resolveSystemFeeProduct,
} from '../../src/services/system-fee-products.js';

let app: any;

beforeEach(async () => {
  vi.clearAllMocks();
  const mod = await import('../../src/index.js');
  app = mod.default;
});

describe('Task #353 — system ServiceFee guards', () => {
  describe('DELETE /api/settings/catalog/service-fees/:id', () => {
    it('refuses to delete an EARLY_TERMINATION_FEE system row', async () => {
      mockPrisma.serviceFee.findFirst.mockResolvedValue({
        id: 'fee-etf',
        tenantId: 'test-tenant-id',
        locationId: 'loc-1',
        kind: 'EARLY_TERMINATION_FEE',
        name: 'Early Termination Fee',
      });

      const res = await request(app)
        .delete('/api/settings/catalog/service-fees/fee-etf');

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('SYSTEM_FEE_UNDELETABLE');
      expect(res.body.error).toMatch(/system fee/i);
      expect(mockPrisma.serviceFee.delete).not.toHaveBeenCalled();
    });

    it('refuses to delete an ACH_RETURN_FEE system row', async () => {
      mockPrisma.serviceFee.findFirst.mockResolvedValue({
        id: 'fee-ach',
        tenantId: 'test-tenant-id',
        locationId: 'loc-1',
        kind: 'ACH_RETURN_FEE',
        name: 'ACH Return Fee',
      });

      const res = await request(app)
        .delete('/api/settings/catalog/service-fees/fee-ach');

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('SYSTEM_FEE_UNDELETABLE');
    });

    it('still allows deleting a STANDARD service fee', async () => {
      mockPrisma.serviceFee.findFirst.mockResolvedValue({
        id: 'fee-std',
        tenantId: 'test-tenant-id',
        locationId: 'loc-1',
        kind: 'STANDARD',
        name: 'Pump-out',
      });
      mockPrisma.serviceFee.delete.mockResolvedValue({ id: 'fee-std' });

      const res = await request(app)
        .delete('/api/settings/catalog/service-fees/fee-std');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(mockPrisma.serviceFee.delete).toHaveBeenCalledWith({
        where: { id: 'fee-std' },
      });
    });
  });

  describe('Zero-fee precedence (review fix)', () => {
    it('contract terminate with $0 system fee + no GL must NOT 500', async () => {
      // Plan 2 follow-up — newly seeded EARLY_TERMINATION_FEE rows default
      // to FLAT $0 and have no GL mapping. A no-fee termination must
      // succeed (no penalty leg posted, no UNCONFIGURED_GL_MAPPING).
      const { buildContract } = await import('../helpers.js');
      const contract = buildContract({
        status: 'ACTIVE',
        earlyTerminationType: null,
        earlyTerminationValue: null,
        locationId: 'loc-Z',
      });
      mockPrisma.slipContract.findFirst.mockResolvedValue({
        ...contract,
        slip: { id: contract.slipId, locationId: 'loc-Z' },
        securityDeposits: [],
      });
      // System fee exists but has no GL mapping & $0 amount.
      mockPrisma.serviceFee.findFirst.mockResolvedValue({
        id: 'sysfee-etf-Z',
        feeType: 'FLAT',
        amountCents: 0,
        pct: null,
        taxClass: 'Tax Exempt',
        glAccountId: null,
      });
      mockPrisma.serviceFeeGlMapping.findFirst.mockResolvedValue(null);
      mockPrisma.location.findUnique.mockResolvedValue({
        id: 'loc-Z',
        qboRealmId: null,
      });
      mockPrisma.$transaction.mockImplementation(async (fn: any) => {
        const tx = {
          slipContract: { update: vi.fn() },
          slip: { update: vi.fn() },
          securityDeposit: { update: vi.fn() },
          glEntry: { create: vi.fn() },
          deferredSchedule: {
            findMany: vi.fn().mockResolvedValue([]),
            update: vi.fn(),
          },
          auditLog: { create: vi.fn() },
        };
        return fn(tx);
      });

      const res = await request(app)
        .post(`/api/contracts/${contract.id}/terminate`)
        .send({ reason: 'no-fee terminate' });

      expect(res.status).toBe(200);
    });

    it('assertSystemFeeGlAccountId throws with operator-friendly message', () => {
      expect(() =>
        assertSystemFeeGlAccountId(
          {
            serviceFeeId: 'sf-1',
            feeType: 'FLAT',
            amountCents: 5000,
            pct: null,
            taxClass: null,
            glAccountId: null,
          },
          'EARLY_TERMINATION_FEE',
          'loc-Q',
          'unit test',
        ),
      ).toThrow(/UNCONFIGURED_GL_MAPPING.*Early Termination Fee.*Settings/);
    });

    it('resolveSystemFeeProduct returns null GL on QBO loc without mapping (no throw)', async () => {
      mockPrisma.serviceFee.findFirst.mockResolvedValue({
        id: 'sf-qbo',
        feeType: 'FLAT',
        amountCents: 0,
        pct: null,
        taxClass: null,
        glAccountId: null,
      });
      mockPrisma.serviceFeeGlMapping.findFirst.mockResolvedValue(null);
      mockPrisma.location.findUnique.mockResolvedValue({
        id: 'loc-qbo',
        qboRealmId: 'realm-1', // QBO-connected
      });

      const fee = await resolveSystemFeeProduct(
        'test-tenant-id',
        'loc-qbo',
        'ACH_RETURN_FEE',
        'unit test',
      );
      expect(fee.glAccountId).toBeNull();
      expect(fee.amountCents).toBe(0);
    });
  });

  describe('PUT /api/settings/catalog/service-fees/:id', () => {
    it('rejects PERCENT writes against ACH_RETURN_FEE (FLAT-only)', async () => {
      mockPrisma.serviceFee.findFirst.mockResolvedValue({
        id: 'fee-ach',
        tenantId: 'test-tenant-id',
        locationId: 'loc-1',
        kind: 'ACH_RETURN_FEE',
        name: 'ACH Return Fee',
      });

      const res = await request(app)
        .put('/api/settings/catalog/service-fees/fee-ach')
        .send({ feeType: 'PERCENT', pct: 1.5 });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('ACH_RETURN_FEE_FLAT_ONLY');
      expect(mockPrisma.serviceFee.update).not.toHaveBeenCalled();
    });

    it('strips name updates on system rows but keeps editable fields', async () => {
      mockPrisma.serviceFee.findFirst.mockResolvedValue({
        id: 'fee-etf',
        tenantId: 'test-tenant-id',
        locationId: 'loc-1',
        kind: 'EARLY_TERMINATION_FEE',
        name: 'Early Termination Fee',
        glAccountId: null,
      });
      mockPrisma.glAccount.findFirst.mockResolvedValue({
        id: 'gl-1',
        tenantId: 'test-tenant-id',
      });
      mockPrisma.serviceFee.update.mockImplementation(({ data }: any) =>
        Promise.resolve({ id: 'fee-etf', ...data }),
      );

      const res = await request(app)
        .put('/api/settings/catalog/service-fees/fee-etf')
        .send({
          name: 'Renamed By Client',
          feeType: 'FLAT',
          amountCents: 5000,
          active: false,
        });

      expect(res.status).toBe(200);
      const updateArgs = mockPrisma.serviceFee.update.mock.calls[0]?.[0];
      expect(updateArgs?.data).toBeDefined();
      // name + active must NOT be passed through for system rows
      expect(updateArgs.data).not.toHaveProperty('name');
      expect(updateArgs.data).not.toHaveProperty('active');
      // amount + feeType still flow through
      expect(updateArgs.data.feeType).toBe('FLAT');
      expect(updateArgs.data.amountCents).toBe(5000);
    });
  });
});
