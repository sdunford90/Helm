import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { mockPrisma } from '../setup.js';
import { buildAuditLogEntry } from '../helpers.js';

let app: any;

beforeEach(async () => {
  vi.clearAllMocks();
  const mod = await import('../../src/index.js');
  app = mod.default;
});

describe('GET /api/audit-log', () => {
  it('returns entries with pagination', async () => {
    const entries = [
      buildAuditLogEntry({ action: 'CREATED', recordType: 'SlipContract' }),
      buildAuditLogEntry({ action: 'UPDATED', recordType: 'Customer' }),
    ];

    mockPrisma.auditLog.findMany.mockResolvedValue(entries);
    mockPrisma.auditLog.count.mockResolvedValue(2);
    mockPrisma.user.findMany.mockResolvedValue([]);

    const res = await request(app).get('/api/audit-log');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(res.body.data).toHaveLength(2);
    expect(res.body).toHaveProperty('pagination');
    expect(res.body.pagination).toEqual(
      expect.objectContaining({ total: 2 }),
    );
  });

  it('filters by recordType query param', async () => {
    mockPrisma.auditLog.findMany.mockResolvedValue([]);
    mockPrisma.auditLog.count.mockResolvedValue(0);
    mockPrisma.user.findMany.mockResolvedValue([]);

    const res = await request(app).get('/api/audit-log?recordType=SlipContract');

    expect(res.status).toBe(200);
    expect(mockPrisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ recordType: 'SlipContract' }),
      }),
    );
  });

  it('enriches entries with user info', async () => {
    const entries = [
      buildAuditLogEntry({ userId: 'user-1', action: 'CREATED' }),
    ];
    const users = [{ id: 'user-1', email: 'admin@marina.com', role: 'admin' }];

    mockPrisma.auditLog.findMany.mockResolvedValue(entries);
    mockPrisma.auditLog.count.mockResolvedValue(1);
    mockPrisma.user.findMany.mockResolvedValue(users);

    const res = await request(app).get('/api/audit-log');

    expect(res.status).toBe(200);
    expect(res.body.data[0]).toHaveProperty('user');
    expect(res.body.data[0].user).toEqual(
      expect.objectContaining({ email: 'admin@marina.com' }),
    );
  });
});

describe('GET /api/audit-log/export', () => {
  it('returns CSV with correct headers', async () => {
    const entries = [
      buildAuditLogEntry({
        action: 'CREATED',
        recordType: 'Invoice',
        userId: 'user-1',
      }),
    ];

    mockPrisma.auditLog.findMany.mockResolvedValue(entries);

    const res = await request(app).get('/api/audit-log/export');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain('audit-log.csv');
    expect(res.text).toContain('id,createdAt,userId,userName,recordType,recordId,action,changedFieldsJson,ipAddress');
  });
});
