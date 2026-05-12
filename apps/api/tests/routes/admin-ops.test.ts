import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { mockPrisma } from '../setup.js';

let app: any;

beforeEach(async () => {
  vi.clearAllMocks();
  const mod = await import('../../src/index.js');
  app = mod.default;
});

const tenantRow = (over: Record<string, unknown> = {}) => ({
  id: 'tenant-1',
  name: 'Sunset Cove Marina',
  subdomain: 'sunsetcove',
  customDomain: null,
  status: 'ACTIVE',
  saasTierId: 'tier-pro',
  lockedAt: null,
  gracePeriodStartedAt: null,
  ...over,
});

const ownerRow = {
  id: 'user-owner-1',
  email: 'owner@sunsetcove.com',
  role: 'MARINA_OWNER',
  active: true,
  firstName: 'Sam',
  lastName: 'Sailor',
};

// ==========================================================================
//  Impersonation
// ==========================================================================

describe('POST /api/admin/tenants/:id/impersonate', () => {
  it('returns a token and records an audit event', async () => {
    mockPrisma.tenant.findUnique.mockResolvedValue({
      ...tenantRow(),
      users: [ownerRow],
    });

    const res = await request(app)
      .post('/api/admin/tenants/tenant-1/impersonate')
      .send({ reason: 'Investigating reported billing discrepancy' });

    expect(res.status).toBe(200);
    expect(res.body.token).toMatch(/^imp_/);
    expect(res.body.tokenId).toBeTruthy();
    expect(res.body.tenantSubdomain).toBe('sunsetcove');
    expect(res.body.asUser).toEqual(
      expect.objectContaining({ id: 'user-owner-1', email: 'owner@sunsetcove.com' }),
    );
    expect(mockPrisma.adminAuditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'IMPERSONATION_STARTED',
          tenantId: 'tenant-1',
        }),
      }),
    );
  });

  it('404s when tenant is missing', async () => {
    mockPrisma.tenant.findUnique.mockResolvedValue(null);
    const res = await request(app)
      .post('/api/admin/tenants/missing/impersonate')
      .send({ reason: 'customer escalation' });
    expect(res.status).toBe(404);
  });

  it('400s when tenant has no active owner', async () => {
    mockPrisma.tenant.findUnique.mockResolvedValue({ ...tenantRow(), users: [] });
    const res = await request(app)
      .post('/api/admin/tenants/tenant-1/impersonate')
      .send({ reason: 'customer escalation' });
    expect(res.status).toBe(400);
  });

  it('400s when no reason supplied (A11)', async () => {
    mockPrisma.tenant.findUnique.mockResolvedValue({
      ...tenantRow(),
      users: [ownerRow],
    });
    const res = await request(app).post('/api/admin/tenants/tenant-1/impersonate');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('IMPERSONATION_REASON_REQUIRED');
  });
});

describe('Public impersonation handoff', () => {
  async function mintToken(): Promise<string> {
    mockPrisma.tenant.findUnique.mockResolvedValue({
      ...tenantRow(),
      users: [ownerRow],
    });
    const res = await request(app)
      .post('/api/admin/tenants/tenant-1/impersonate')
      .send({ reason: 'support session' });
    return res.body.token;
  }

  describe('POST /api/impersonation/verify', () => {
    it('verifies a freshly minted token and records VERIFIED event', async () => {
      const token = await mintToken();
      mockPrisma.adminAuditEvent.create.mockClear();

      const res = await request(app)
        .post('/api/impersonation/verify')
        .send({ token });

      expect(res.status).toBe(200);
      expect(res.body.tenantSubdomain).toBe('sunsetcove');
      expect(res.body.asUser.email).toBe('owner@sunsetcove.com');
      expect(res.body.adminEmail).toBe('admin@test.com');
      expect(res.body.tokenId).toBeTruthy();
      expect(res.body.expiresAt).toBeTruthy();
      expect(mockPrisma.adminAuditEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'IMPERSONATION_VERIFIED',
            tenantId: 'tenant-1',
          }),
        }),
      );
    });

    it('rejects a malformed token', async () => {
      const res = await request(app)
        .post('/api/impersonation/verify')
        .send({ token: 'not-a-real-token' });
      expect(res.status).toBe(401);
    });

    it('rejects a tampered signature', async () => {
      const token = await mintToken();
      const tampered = token.slice(0, -4) + '0000';
      const res = await request(app)
        .post('/api/impersonation/verify')
        .send({ token: tampered });
      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/impersonation/end', () => {
    it('records an IMPERSONATION_ENDED event for a valid token', async () => {
      const token = await mintToken();
      mockPrisma.adminAuditEvent.create.mockClear();

      const res = await request(app)
        .post('/api/impersonation/end')
        .send({ token });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(mockPrisma.adminAuditEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'IMPERSONATION_ENDED',
            tenantId: 'tenant-1',
          }),
        }),
      );
    });

    it('rejects a malformed token', async () => {
      const res = await request(app)
        .post('/api/impersonation/end')
        .send({ token: 'imp_garbage.deadbeef' });
      expect(res.status).toBe(401);
    });
  });
});

// ==========================================================================
//  Global Search
// ==========================================================================

describe('GET /api/admin/search', () => {
  it('returns empty groups when query is too short', async () => {
    const res = await request(app).get('/api/admin/search?q=a');
    expect(res.status).toBe(200);
    expect(res.body.groups.tenants).toEqual([]);
    expect(res.body.groups.users).toEqual([]);
    expect(mockPrisma.tenant.findMany).not.toHaveBeenCalled();
  });

  it('fans out across tenants/users/boats/saasInvoices', async () => {
    mockPrisma.tenant.findMany.mockResolvedValue([
      { id: 'tenant-1', name: 'Sunset Cove Marina', subdomain: 'sunsetcove', status: 'ACTIVE' },
    ]);
    mockPrisma.user.findMany.mockResolvedValue([
      {
        id: 'user-1', email: 'sam@sunset.com', firstName: 'Sam', lastName: 'Sailor',
        role: 'MARINA_OWNER', tenantId: 'tenant-1',
        tenant: { name: 'Sunset Cove Marina', subdomain: 'sunsetcove' },
      },
    ]);
    mockPrisma.boat.findMany.mockResolvedValue([
      {
        id: 'boat-1', name: 'Sea Breeze', registrationNumber: 'SC-1234',
        make: null, model: null, year: 2018, tenantId: 'tenant-1', customerId: 'cust-1',
      },
    ]);
    mockPrisma.saasInvoice.findMany.mockResolvedValue([
      {
        id: 'sinv-1', tenantId: 'tenant-1', amountCents: 49900, status: 'paid',
        issuedAt: new Date('2026-04-01T00:00:00Z'),
        tenant: { name: 'Sunset Cove Marina' },
      },
    ]);

    const res = await request(app).get('/api/admin/search?q=sunset');

    expect(res.status).toBe(200);
    expect(res.body.query).toBe('sunset');
    expect(res.body.groups.tenants).toHaveLength(1);
    expect(res.body.groups.users[0].email).toBe('sam@sunset.com');
    expect(res.body.groups.boats[0].name).toBe('Sea Breeze');
    expect(res.body.groups.saasInvoices[0].tenantName).toBe('Sunset Cove Marina');
  });
});

// ==========================================================================
//  Tenant Notes & Activity
// ==========================================================================

describe('Tenant notes', () => {
  it('lists notes for a tenant', async () => {
    mockPrisma.tenantNote.findMany.mockResolvedValue([
      {
        id: 'note-1',
        tenantId: 'tenant-1',
        authorId: 'admin-1',
        authorEmail: 'admin@helmhq.com',
        body: 'Watch their churn risk this month',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    const res = await request(app).get('/api/admin/tenants/tenant-1/notes');
    expect(res.status).toBe(200);
    expect(res.body.notes).toHaveLength(1);
    expect(res.body.notes[0].body).toMatch(/churn risk/);
  });

  it('rejects creation with empty body', async () => {
    mockPrisma.tenant.findUnique.mockResolvedValue({ id: 'tenant-1' });
    const res = await request(app)
      .post('/api/admin/tenants/tenant-1/notes')
      .send({ body: '   ' });
    expect(res.status).toBe(400);
  });

  it('creates a note and records an audit event', async () => {
    mockPrisma.tenant.findUnique.mockResolvedValue({ id: 'tenant-1' });
    mockPrisma.tenantNote.create.mockResolvedValue({
      id: 'note-new',
      tenantId: 'tenant-1',
      authorId: 'test-user-id',
      authorEmail: 'admin@test.com',
      body: 'Saw a billing issue',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const res = await request(app)
      .post('/api/admin/tenants/tenant-1/notes')
      .send({ body: 'Saw a billing issue' });

    expect(res.status).toBe(201);
    expect(res.body.id).toBe('note-new');
    expect(mockPrisma.tenantNote.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: 'tenant-1',
          body: 'Saw a billing issue',
        }),
      }),
    );
    expect(mockPrisma.adminAuditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'NOTE_CREATED', tenantId: 'tenant-1' }),
      }),
    );
  });

  it('forbids deleting another admin\'s note', async () => {
    mockPrisma.tenantNote.findUnique.mockResolvedValue({
      id: 'note-9', tenantId: 'tenant-1', authorId: 'someone-else',
      body: 'x', createdAt: new Date(), updatedAt: new Date(),
    });

    const res = await request(app)
      .delete('/api/admin/tenants/tenant-1/notes/note-9');

    expect(res.status).toBe(403);
    expect(mockPrisma.tenantNote.delete).not.toHaveBeenCalled();
  });

  it('returns 404 for a note belonging to a different tenant', async () => {
    mockPrisma.tenantNote.findUnique.mockResolvedValue({
      id: 'note-9', tenantId: 'other-tenant', authorId: 'test-user-id',
      body: 'x', createdAt: new Date(), updatedAt: new Date(),
    });

    const res = await request(app)
      .delete('/api/admin/tenants/tenant-1/notes/note-9');

    expect(res.status).toBe(404);
  });
});

describe('GET /api/admin/tenants/:id/activity', () => {
  it('interleaves notes and audit events sorted by createdAt desc', async () => {
    const olderNote = {
      id: 'note-1', tenantId: 'tenant-1', authorId: 'admin-1',
      authorEmail: 'a@helmhq.com', body: 'older note',
      createdAt: new Date('2026-04-01T00:00:00Z'), updatedAt: new Date(),
    };
    const newerEvent = {
      id: 'evt-1', tenantId: 'tenant-1', adminId: 'admin-1',
      adminEmail: 'a@helmhq.com', action: 'TENANT_LOCKED',
      metadataJson: null, createdAt: new Date('2026-04-15T00:00:00Z'),
    };
    mockPrisma.tenantNote.findMany.mockResolvedValue([olderNote]);
    mockPrisma.adminAuditEvent.findMany.mockResolvedValue([newerEvent]);

    const res = await request(app).get('/api/admin/tenants/tenant-1/activity');

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(2);
    expect(res.body.items[0].kind).toBe('event');
    expect(res.body.items[0].action).toBe('TENANT_LOCKED');
    expect(res.body.items[1].kind).toBe('note');
  });
});

// ==========================================================================
//  Bulk Actions
// ==========================================================================

describe('Bulk tenant actions', () => {
  it('rejects bulk lock with no tenantIds', async () => {
    const res = await request(app)
      .post('/api/admin/bulk/tenants/lock')
      .send({ tenantIds: [] });
    expect(res.status).toBe(400);
  });

  it('locks selected non-locked tenants and skips already-locked', async () => {
    mockPrisma.tenant.findMany.mockResolvedValue([
      { id: 't-1' },
      { id: 't-2' },
    ]);
    mockPrisma.tenant.updateMany.mockResolvedValue({ count: 2 });

    const res = await request(app)
      .post('/api/admin/bulk/tenants/lock')
      .send({ tenantIds: ['t-1', 't-2', 't-3'] });

    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(2);
    expect(res.body.skipped).toBe(1);
    expect(mockPrisma.tenant.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['t-1', 't-2'] } },
        data: expect.objectContaining({ status: 'LOCKED' }),
      }),
    );
    expect(mockPrisma.adminAuditEvent.create).toHaveBeenCalledTimes(2);
  });

  it('unlocks selected non-active tenants', async () => {
    mockPrisma.tenant.findMany.mockResolvedValue([{ id: 't-1' }]);
    mockPrisma.tenant.updateMany.mockResolvedValue({ count: 1 });

    const res = await request(app)
      .post('/api/admin/bulk/tenants/unlock')
      .send({ tenantIds: ['t-1', 't-active'] });

    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(1);
    expect(res.body.skipped).toBe(1);
  });

  it('changes tier for selected tenants when tier exists', async () => {
    mockPrisma.saasTier.findUnique.mockResolvedValue({
      id: 'tier-ent', name: 'Enterprise', monthlyFeeCents: 99900,
    });
    mockPrisma.tenant.findMany.mockResolvedValue([
      { id: 't-1', saasTierId: 'tier-pro' },
      { id: 't-2', saasTierId: 'tier-pro' },
    ]);
    mockPrisma.tenant.updateMany.mockResolvedValue({ count: 2 });

    const res = await request(app)
      .post('/api/admin/bulk/tenants/tier')
      .send({ tenantIds: ['t-1', 't-2'], saasTierId: 'tier-ent' });

    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(2);
    expect(res.body.tierName).toBe('Enterprise');
    expect(mockPrisma.adminAuditEvent.create).toHaveBeenCalledTimes(2);
  });

  it('rejects tier change with invalid saasTierId', async () => {
    mockPrisma.saasTier.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/admin/bulk/tenants/tier')
      .send({ tenantIds: ['t-1'], saasTierId: 'tier-bogus' });

    expect(res.status).toBe(400);
  });

  it('sends an announcement to each selected tenant', async () => {
    mockPrisma.announcement.create.mockResolvedValue({ id: 'ann-1' });

    const res = await request(app)
      .post('/api/admin/bulk/tenants/announce')
      .send({
        tenantIds: ['t-1', 't-2'],
        subject: 'Maintenance window',
        body: 'We will be performing maintenance.',
        isEmergency: false,
      });

    expect(res.status).toBe(200);
    expect(res.body.created).toBe(2);
    expect(res.body.batchId).toBeTruthy();
    expect(mockPrisma.announcement.create).toHaveBeenCalledTimes(2);
    expect(mockPrisma.adminAuditEvent.create).toHaveBeenCalledTimes(2);
    expect(mockPrisma.adminAuditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'ANNOUNCEMENT_SENT' }),
      }),
    );
  });

  it('rejects announcement when subject or body is missing', async () => {
    const res = await request(app)
      .post('/api/admin/bulk/tenants/announce')
      .send({ tenantIds: ['t-1'], subject: '', body: '' });

    expect(res.status).toBe(400);
  });
});
