import { describe, it, expect, vi } from 'vitest';

// tests/setup.ts mocks the tenant middleware globally; load the real module.
const { shouldBypassTenant } = await vi.importActual<
  typeof import('../../src/middleware/tenant.js')
>('../../src/middleware/tenant.js');

describe('shouldBypassTenant', () => {
  it('bypasses public lead-form submissions (tenant comes from the embed key)', () => {
    expect(shouldBypassTenant('/api/lead-forms/e5111b3a-cef6-497b-97f8-fd686b170a2d/submit')).toBe(true);
  });

  it('keeps tenant resolution for every other lead-form route', () => {
    expect(shouldBypassTenant('/api/lead-forms')).toBe(false);
    expect(shouldBypassTenant('/api/lead-forms/abc')).toBe(false);
    expect(shouldBypassTenant('/api/lead-forms/abc/submit/extra')).toBe(false);
    expect(shouldBypassTenant('/api/lead-forms//submit')).toBe(false);
  });
});
