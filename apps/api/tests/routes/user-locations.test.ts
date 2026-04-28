import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { mockPrisma, TEST_TENANT_ID, TEST_USER_ID } from '../setup.js';

const LOC_1 = 'aebdf7e8-4a48-40a0-834e-b078a46038fb';
const LOC_2 = '0bfc8e46-49db-4607-88d6-c252293580b2';
const LOC_3 = 'c3ee7f8f-e744-4cd8-ae10-224b1e340695';
const LOC_BOGUS = '7c8632a6-1f3f-4d85-8381-a61b2ef093c9';

let app: any;

beforeEach(async () => {
  vi.clearAllMocks();
  const mod = await import('../../src/index.js');
  app = mod.default;
});

describe('GET /api/settings/team', () => {
  it('returns members with locationIds derived from userLocations', async () => {
    mockPrisma.user.findMany.mockResolvedValue([
      {
        id: 'u-owner',
        clerkId: 'c1',
        email: 'owner@test.com',
        firstName: 'Olive',
        lastName: 'Owner',
        role: 'MARINA_OWNER',
        active: true,
        createdAt: new Date(),
        userLocations: [],
      },
      {
        id: 'u-staff',
        clerkId: 'c2',
        email: 'dock@test.com',
        firstName: 'Dock',
        lastName: 'Staffer',
        role: 'DOCK_STAFF',
        active: true,
        createdAt: new Date(),
        userLocations: [{ locationId: LOC_1 }, { locationId: LOC_2 }],
      },
    ]);

    const res = await request(app).get('/api/settings/team');

    expect(res.status).toBe(200);
    expect(res.body.members).toHaveLength(2);
    const owner = res.body.members.find((m: any) => m.id === 'u-owner');
    const staff = res.body.members.find((m: any) => m.id === 'u-staff');
    expect(owner.locationIds).toEqual([]);
    expect(staff.locationIds).toEqual([LOC_1, LOC_2]);
  });
});

describe('POST /api/settings/team/invite', () => {
  it('rejects invite with locationIds that do not belong to tenant', async () => {
    mockPrisma.user.findFirst.mockResolvedValue(null);
    mockPrisma.location.findMany.mockResolvedValue([{ id: LOC_1 }]);

    const res = await request(app)
      .post('/api/settings/team/invite')
      .send({
        email: 'new@test.com',
        firstName: 'New',
        lastName: 'User',
        role: 'DOCK_STAFF',
        locationIds: [LOC_1, LOC_BOGUS],
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_LOCATION');
    expect(mockPrisma.user.create).not.toHaveBeenCalled();
    expect(mockPrisma.userLocation.createMany).not.toHaveBeenCalled();
  });

  it('creates user, persists UserLocation rows, and writes audit log INVITE', async () => {
    mockPrisma.user.findFirst.mockResolvedValue(null);
    mockPrisma.location.findMany.mockResolvedValue([
      { id: LOC_1 },
      { id: LOC_2 },
    ]);
    mockPrisma.user.create.mockResolvedValue({
      id: 'u-new',
      tenantId: TEST_TENANT_ID,
      email: 'new@test.com',
      firstName: 'New',
      lastName: 'User',
      role: 'DOCK_STAFF',
      active: true,
    });

    const res = await request(app)
      .post('/api/settings/team/invite')
      .send({
        email: 'new@test.com',
        firstName: 'New',
        lastName: 'User',
        role: 'DOCK_STAFF',
        locationIds: [LOC_1, LOC_2],
      });

    expect(res.status).toBe(201);
    expect(res.body.member.locationIds).toEqual([LOC_1, LOC_2]);

    expect(mockPrisma.userLocation.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          { userId: 'u-new', locationId: LOC_1, tenantId: TEST_TENANT_ID },
          { userId: 'u-new', locationId: LOC_2, tenantId: TEST_TENANT_ID },
        ],
        skipDuplicates: true,
      }),
    );

    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          recordType: 'User',
          recordId: 'u-new',
          action: 'INVITE',
          changedFieldsJson: expect.objectContaining({
            role: 'DOCK_STAFF',
            locationIds: [LOC_1, LOC_2],
          }),
        }),
      }),
    );
  });

  it('refuses to create a duplicate user in the same tenant', async () => {
    mockPrisma.user.findFirst.mockResolvedValue({ id: 'existing', email: 'dup@test.com' });

    const res = await request(app)
      .post('/api/settings/team/invite')
      .send({
        email: 'dup@test.com',
        firstName: 'Dup',
        lastName: 'User',
        role: 'DOCK_STAFF',
      });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('DUPLICATE_USER');
    expect(mockPrisma.user.create).not.toHaveBeenCalled();
  });
});

describe('PUT /api/settings/team/:userId', () => {
  it('replaces UserLocation rows in a transaction and writes audit log UPDATE', async () => {
    mockPrisma.user.findFirst.mockResolvedValue({
      id: 'u-target',
      tenantId: TEST_TENANT_ID,
      role: 'DOCK_STAFF',
    });
    mockPrisma.location.findMany.mockResolvedValue([
      { id: LOC_1 },
      { id: LOC_3 },
    ]);
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'u-target',
      tenantId: TEST_TENANT_ID,
      email: 't@test.com',
      role: 'POS_CASHIER',
      active: true,
    });

    const res = await request(app)
      .put('/api/settings/team/u-target')
      .send({ role: 'POS_CASHIER', locationIds: [LOC_1, LOC_3] });

    expect(res.status).toBe(200);
    expect(res.body.member.locationIds).toEqual([LOC_1, LOC_3]);

    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u-target' },
      data: { role: 'POS_CASHIER' },
    });

    expect(mockPrisma.$transaction).toHaveBeenCalled();
    expect(mockPrisma.userLocation.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'u-target' },
    });
    expect(mockPrisma.userLocation.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          { userId: 'u-target', locationId: LOC_1, tenantId: TEST_TENANT_ID },
          { userId: 'u-target', locationId: LOC_3, tenantId: TEST_TENANT_ID },
        ],
        skipDuplicates: true,
      }),
    );

    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          recordType: 'User',
          recordId: 'u-target',
          action: 'UPDATE',
          changedFieldsJson: expect.objectContaining({
            role: { from: 'DOCK_STAFF', to: 'POS_CASHIER' },
            locationIds: [LOC_1, LOC_3],
          }),
        }),
      }),
    );
  });

  it('rejects locationIds that do not belong to the tenant', async () => {
    mockPrisma.user.findFirst.mockResolvedValue({
      id: 'u-target',
      tenantId: TEST_TENANT_ID,
      role: 'DOCK_STAFF',
    });
    mockPrisma.location.findMany.mockResolvedValue([{ id: LOC_1 }]);

    const res = await request(app)
      .put('/api/settings/team/u-target')
      .send({ locationIds: [LOC_1, LOC_BOGUS] });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_LOCATION');
    expect(mockPrisma.userLocation.deleteMany).not.toHaveBeenCalled();
  });

  it('returns 400 when user tries to change their own role', async () => {
    const res = await request(app)
      .put(`/api/settings/team/${TEST_USER_ID}`)
      .send({ role: 'DOCK_STAFF' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('SELF_ROLE_CHANGE');
  });

  it('returns 404 when target user not found in tenant', async () => {
    mockPrisma.user.findFirst.mockResolvedValue(null);
    const res = await request(app)
      .put('/api/settings/team/u-missing')
      .send({ role: 'DOCK_STAFF' });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });
});

describe('Location filter helpers (via GET /api/locations)', () => {
  it('admin (allowedLocationIds=null) sees all locations', async () => {
    mockPrisma.location.findMany.mockResolvedValue([
      { id: LOC_1, name: 'Main', tenantId: TEST_TENANT_ID, active: true, transientEnabled: true, rentalsEnabled: true },
      { id: LOC_2, name: 'Fuel', tenantId: TEST_TENANT_ID, active: true, transientEnabled: false, rentalsEnabled: false },
    ]);

    const res = await request(app).get('/api/locations');

    expect(res.status).toBe(200);
    const call = mockPrisma.location.findMany.mock.calls[0][0];
    expect(call.where).toEqual(expect.objectContaining({ tenantId: TEST_TENANT_ID, active: true }));
    expect(call.where).not.toHaveProperty('id');
  });
});
