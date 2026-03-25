import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { mockPrisma } from '../setup.js';
import { buildAnnouncement } from '../helpers.js';

let app: any;

beforeEach(async () => {
  vi.clearAllMocks();
  const mod = await import('../../src/index.js');
  app = mod.default;
});

describe('GET /api/announcements', () => {
  it('returns announcement list with delivery stats', async () => {
    const announcements = [
      { ...buildAnnouncement(), _count: { deliveries: 10 } },
      { ...buildAnnouncement(), _count: { deliveries: 5 } },
    ];

    mockPrisma.announcement.findMany.mockResolvedValue(announcements);
    mockPrisma.announcement.count.mockResolvedValue(2);
    mockPrisma.announcementDelivery.groupBy.mockResolvedValue([
      { status: 'SENT', _count: { id: 5 } },
      { status: 'DELIVERED', _count: { id: 3 } },
      { status: 'OPENED', _count: { id: 2 } },
    ]);

    const res = await request(app).get('/api/announcements');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(res.body.data).toHaveLength(2);
    expect(res.body).toHaveProperty('pagination');
    expect(res.body.data[0]).toHaveProperty('deliveryStats');
    expect(res.body.data[0]).toHaveProperty('status');
  });
});

describe('POST /api/announcements', () => {
  it('creates an announcement and queues delivery', async () => {
    const announcement = buildAnnouncement({
      subject: 'Marina Closure Notice',
      body: 'The marina will be closed for maintenance.',
    });
    const recipients = [
      { id: 'cust-1', email: 'a@example.com', phone: '+15551234567' },
      { id: 'cust-2', email: 'b@example.com', phone: null },
    ];

    mockPrisma.announcement.create.mockResolvedValue(announcement);
    mockPrisma.customer.findMany.mockResolvedValue(recipients);
    mockPrisma.announcementDelivery.createMany.mockResolvedValue({ count: 2 });
    mockPrisma.announcement.update.mockResolvedValue({
      ...announcement,
      sentAt: new Date(),
    });
    mockPrisma.announcement.findFirst.mockResolvedValue({
      ...announcement,
      _count: { deliveries: 2 },
    });
    mockPrisma.auditLog.create.mockResolvedValue({});

    const res = await request(app)
      .post('/api/announcements')
      .send({
        title: 'Marina Closure Notice',
        body: 'The marina will be closed for maintenance.',
        channel: 'EMAIL',
        audience: 'all',
      });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
  });

  it('creates a scheduled announcement without immediate send', async () => {
    const futureDate = new Date(Date.now() + 86400000).toISOString();
    const announcement = buildAnnouncement({
      scheduledAt: new Date(futureDate),
    });

    mockPrisma.announcement.create.mockResolvedValue(announcement);
    mockPrisma.announcement.findFirst.mockResolvedValue({
      ...announcement,
      _count: { deliveries: 0 },
    });
    mockPrisma.auditLog.create.mockResolvedValue({});

    const res = await request(app)
      .post('/api/announcements')
      .send({
        title: 'Scheduled Update',
        body: 'Coming soon.',
        channel: 'EMAIL',
        audience: 'all',
        scheduledAt: futureDate,
      });

    expect(res.status).toBe(201);
    // Should not trigger customer lookup since it is scheduled
    expect(mockPrisma.customer.findMany).not.toHaveBeenCalled();
  });
});
