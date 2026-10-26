import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mockPrisma } from '../setup.js';
import { queues } from '../../src/lib/queue.js';

let runTenantLifecycleCheck: typeof import('../../src/jobs/tenant-lifecycle.js').runTenantLifecycleCheck;

const DAY = 86400000;

beforeEach(async () => {
  vi.clearAllMocks();
  mockPrisma.tenant.findMany.mockReset().mockResolvedValue([]);
  mockPrisma.tenant.update.mockReset().mockResolvedValue({});
  mockPrisma.user.updateMany.mockReset().mockResolvedValue({ count: 0 });
  mockPrisma.invoice.findFirst.mockReset().mockResolvedValue(null);
  const mod = await import('../../src/jobs/tenant-lifecycle.js');
  runTenantLifecycleCheck = mod.runTenantLifecycleCheck;
});

afterEach(() => {
  delete process.env.TENANT_LIFECYCLE_ENFORCEMENT_ENABLED;
});

describe('runTenantLifecycleCheck', () => {
  it('is a logged no-op unless TENANT_LIFECYCLE_ENFORCEMENT_ENABLED=true', async () => {
    const result = await runTenantLifecycleCheck();

    expect(result).toEqual({ transitioned: 0, notified: 0, skipped: true });
    expect(mockPrisma.tenant.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.tenant.update).not.toHaveBeenCalled();
    expect(mockPrisma.user.updateMany).not.toHaveBeenCalled();
  });

  it('never moves an ACTIVE marina to GRACE_PERIOD because of a past-due boater invoice', async () => {
    process.env.TENANT_LIFECYCLE_ENFORCEMENT_ENABLED = 'true';
    // A boater invoice that is badly past due exists...
    mockPrisma.invoice.findFirst.mockResolvedValue({
      id: 'inv-late',
      tenantId: 'tenant-1',
      status: 'PAST_DUE',
      dueDate: new Date(Date.now() - 60 * DAY),
    });
    // ...and no tenant is in an admin-set grace period.
    mockPrisma.tenant.findMany.mockResolvedValue([]);

    const result = await runTenantLifecycleCheck();

    expect(result.transitioned).toBe(0);
    // Boater invoices are never consulted.
    expect(mockPrisma.invoice.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.invoice.findMany).not.toHaveBeenCalled();
    // Nothing is ever set to GRACE_PERIOD by the job.
    for (const call of mockPrisma.tenant.update.mock.calls) {
      expect(call[0].data.status).not.toBe('GRACE_PERIOD');
    }
    // Only GRACE_PERIOD tenants are queried.
    for (const call of mockPrisma.tenant.findMany.mock.calls) {
      expect(call[0].where.status).toBe('GRACE_PERIOD');
    }
  });

  it('locks only tenants a platform admin put in grace 30+ days ago, sparing admins and portal users', async () => {
    process.env.TENANT_LIFECYCLE_ENFORCEMENT_ENABLED = 'true';
    const graceStart = new Date(Date.now() - 31 * DAY);
    mockPrisma.tenant.findMany.mockResolvedValueOnce([
      {
        id: 'tenant-grace',
        name: 'Grace Marina',
        gracePeriodStartedAt: graceStart,
        users: [{ email: 'owner@grace.test', firstName: 'Olive' }],
      },
    ]);

    const result = await runTenantLifecycleCheck();

    expect(result.transitioned).toBe(1);
    expect(mockPrisma.tenant.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'tenant-grace' },
        data: expect.objectContaining({ status: 'LOCKED' }),
      }),
    );
    const userUpdate = mockPrisma.user.updateMany.mock.calls[0][0];
    expect(userUpdate.where.tenantId).toBe('tenant-grace');
    expect(userUpdate.where.role.notIn).toEqual(expect.arrayContaining(['PORTAL_USER', 'PLATFORM_ADMIN']));

    // Lock notice uses the typed email contract.
    const [, payload, opts] = (queues.email.add as any).mock.calls[0];
    expect(payload).toEqual(
      expect.objectContaining({
        type: 'tenant_lifecycle',
        tenantId: 'tenant-grace',
        to: 'owner@grace.test',
        graceDayNumber: 30,
      }),
    );
    expect(opts.jobId).not.toContain(':');
  });
});
