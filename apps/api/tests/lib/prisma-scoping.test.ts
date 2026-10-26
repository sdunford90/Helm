import { describe, it, expect, vi } from 'vitest';
import { Prisma } from '@prisma/client';

// tests/setup.ts replaces lib/prisma.js with a mock; load the real module.
type PrismaModule = typeof import('../../src/lib/prisma.js');
const real = await vi.importActual<PrismaModule>('../../src/lib/prisma.js');
const { TENANT_SCOPED_MODELS, buildTenantScopedModels, scopeQueryArgs, TenantScopeError } = real;

const T = 'tenant-a';

describe('TENANT_SCOPED_MODELS (derived from the Prisma DMMF)', () => {
  it('includes models the hand-written list missed', () => {
    for (const m of [
      'SlipContract',
      'GlEntry',
      'GlAccount',
      'PromoCode',
      'SecurityDeposit',
      'InsuranceRecord',
      'ApiKey',
      'MeterReading',
      'ConciergeVendor',
      'CommunicationPreference',
    ]) {
      expect(TENANT_SCOPED_MODELS.has(m), m).toBe(true);
    }
  });

  it('excludes models without a tenantId column (which used to crash) and phantom names', () => {
    for (const m of [
      'PricingRule',
      'PricingCalendarOverride',
      'DemandSurgeTier',
      'AlgorithmicSuggestion',
      'PosLineItem',
      'DockWalkItem',
      'AnnouncementDelivery',
      'Tenant',
      'SaasTier',
      'POSTransaction',
      'Contract',
    ]) {
      expect(TENANT_SCOPED_MODELS.has(m), m).toBe(false);
    }
  });

  it('matches exactly the schema models that have a tenantId field', () => {
    const expected = Prisma.dmmf.datamodel.models
      .filter((m) => m.fields.some((f) => f.name === 'tenantId'))
      .map((m) => m.name)
      .sort();
    expect([...TENANT_SCOPED_MODELS].sort()).toEqual(expected);
  });

  it('buildTenantScopedModels is a pure function of the model list', () => {
    const set = buildTenantScopedModels([
      { name: 'A', fields: [{ name: 'id' }, { name: 'tenantId' }] },
      { name: 'B', fields: [{ name: 'id' }] },
    ]);
    expect([...set]).toEqual(['A']);
  });
});

describe('scopeQueryArgs', () => {
  it('injects tenantId into reads, including findUnique (extendedWhereUnique)', () => {
    expect(scopeQueryArgs('SlipContract', 'findUnique', { where: { id: 'c1' } }, T)).toEqual({
      where: { id: 'c1', tenantId: T },
    });
    expect(scopeQueryArgs('Customer', 'findMany', {}, T)).toEqual({ where: { tenantId: T } });
    expect(scopeQueryArgs('Payment', 'aggregate', { where: { status: 'COMPLETED' } }, T).where).toEqual({
      status: 'COMPLETED',
      tenantId: T,
    });
  });

  it('leaves models without tenantId untouched', () => {
    const args = { where: { id: 'r1' }, data: { name: 'x' } };
    expect(scopeQueryArgs('PricingRule', 'update', args, T)).toEqual(args);
    expect(scopeQueryArgs('PricingRule', 'create', { data: { name: 'x' } }, T)).toEqual({ data: { name: 'x' } });
  });

  it('scopes update/delete/updateMany/deleteMany/updateManyAndReturn where', () => {
    for (const op of ['update', 'delete', 'updateMany', 'deleteMany', 'updateManyAndReturn']) {
      expect(scopeQueryArgs('GlEntry', op, { where: { id: 'g1' } }, T).where).toEqual({ id: 'g1', tenantId: T });
    }
  });

  it('stamps tenantId on create, createMany and createManyAndReturn', () => {
    expect(scopeQueryArgs('PromoCode', 'create', { data: { code: 'X' } }, T).data).toEqual({ code: 'X', tenantId: T });
    expect(
      scopeQueryArgs('MeterReading', 'createManyAndReturn', { data: [{ kwh: 1 }, { kwh: 2 }] }, T).data,
    ).toEqual([
      { kwh: 1, tenantId: T },
      { kwh: 2, tenantId: T },
    ]);
    expect(scopeQueryArgs('MeterReading', 'createMany', { data: { kwh: 1 } }, T).data).toEqual({
      kwh: 1,
      tenantId: T,
    });
  });

  it('scopes upsert where + create', () => {
    const out = scopeQueryArgs('ApiKey', 'upsert', { where: { id: 'k' }, create: { keyHash: 'h' }, update: {} }, T);
    expect(out.where).toEqual({ id: 'k', tenantId: T });
    expect(out.create).toEqual({ keyHash: 'h', tenantId: T });
  });

  it('rejects (does not silently overwrite) a different tenant in where', () => {
    expect(() => scopeQueryArgs('Customer', 'findMany', { where: { tenantId: 'tenant-b' } }, T)).toThrow(
      TenantScopeError,
    );
  });

  it('accepts the same tenant and ANDs the context onto tenantId filter objects', () => {
    expect(scopeQueryArgs('Customer', 'findMany', { where: { tenantId: T } }, T).where).toEqual({ tenantId: T });
    expect(
      scopeQueryArgs('Customer', 'findMany', { where: { tenantId: { in: [T, 'tenant-b'] } } }, T).where,
    ).toEqual({ tenantId: { in: [T, 'tenant-b'] }, AND: [{ tenantId: T }] });
  });

  it('rejects creating rows for, or moving rows to, another tenant', () => {
    expect(() => scopeQueryArgs('Invoice', 'create', { data: { tenantId: 'tenant-b' } }, T)).toThrow(TenantScopeError);
    expect(() =>
      scopeQueryArgs('User', 'create', { data: { tenant: { connect: { id: 'tenant-b' } } } }, T),
    ).toThrow(TenantScopeError);
    expect(() =>
      scopeQueryArgs('Invoice', 'update', { where: { id: 'i' }, data: { tenantId: 'tenant-b' } }, T),
    ).toThrow(TenantScopeError);
    expect(() =>
      scopeQueryArgs('Invoice', 'updateMany', { where: {}, data: { tenantId: { set: 'tenant-b' } } }, T),
    ).toThrow(TenantScopeError);
  });

  it('allows the relation-connect form for the same tenant without adding the scalar', () => {
    const out = scopeQueryArgs('User', 'create', { data: { email: 'a', tenant: { connect: { id: T } } } }, T);
    expect(out.data).toEqual({ email: 'a', tenant: { connect: { id: T } } });
  });
});
