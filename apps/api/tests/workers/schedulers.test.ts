import { describe, it, expect, vi } from 'vitest';
import { registerSchedulers, SCHEDULERS, isSchedulerEnabled } from '../../src/workers/schedulers.js';

function fakeRegistry() {
  const mk = () => ({ upsertJobScheduler: vi.fn().mockResolvedValue(undefined), removeJobScheduler: vi.fn().mockResolvedValue(true) });
  return {
    billing: mk(),
    'deferred-revenue': mk(),
    'qbo-sync': mk(),
    email: mk(),
    sms: mk(),
    renewals: mk(),
    automation: mk(),
  } as any;
}

describe('registerSchedulers', () => {
  it('registers nothing dangerous by default and removes stale schedules', async () => {
    const registry = fakeRegistry();
    const result = await registerSchedulers({ env: {}, queueRegistry: registry });

    for (const id of [
      'billing-recurring-invoices',
      'renewals-auto-renew-check',
      'billing-tenant-lifecycle',
      'automation-algorithmic-pricing',
    ]) {
      expect(result.removed).toContain(id);
      expect(result.registered).not.toContain(id);
    }
    for (const q of Object.values(registry) as any[]) {
      expect(q.upsertJobScheduler).not.toHaveBeenCalled();
    }
    expect(registry.billing.removeJobScheduler).toHaveBeenCalledWith('billing-recurring-invoices');
  });

  it('registers a gated scheduler via upsertJobScheduler only when its flag is exactly "true"', async () => {
    const registry = fakeRegistry();
    await registerSchedulers({ env: { ENABLE_ALGORITHMIC_PRICING_SCHEDULER: '1' }, queueRegistry: registry });
    expect(registry.automation.upsertJobScheduler).not.toHaveBeenCalled();

    await registerSchedulers({ env: { ENABLE_ALGORITHMIC_PRICING_SCHEDULER: 'true' }, queueRegistry: registry });
    expect(registry.automation.upsertJobScheduler).toHaveBeenCalledWith(
      'automation-algorithmic-pricing',
      { pattern: '0 0 * * 0' },
      expect.objectContaining({ name: 'algorithmic-pricing' }),
    );
    // Others stay off.
    expect(registry.billing.upsertJobScheduler).not.toHaveBeenCalled();
    expect(registry.renewals.upsertJobScheduler).not.toHaveBeenCalled();
  });

  it('every billing/renewal/lifecycle/pricing scheduler is behind an env flag', () => {
    for (const def of SCHEDULERS) {
      if (['billing', 'renewals'].includes(def.queue) || def.jobName === 'algorithmic-pricing') {
        expect(def.enabledByEnv, def.id).toMatch(/^ENABLE_[A-Z_]+_SCHEDULER$/);
        expect(isSchedulerEnabled(def, {}), def.id).toBe(false);
      }
    }
  });
});
