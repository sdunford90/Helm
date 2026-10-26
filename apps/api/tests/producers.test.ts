import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { mockPrisma } from './setup.js';
import { buildInvoice } from './helpers.js';
import { queues } from '../src/lib/queue.js';

// Every producer must enqueue a payload that matches the worker contract
// (EmailJobData / SmsJobData in src/lib/queue.ts): a known `type` and `to`.

let app: any;
const emailAdd = queues.email.add as unknown as ReturnType<typeof vi.fn>;
const smsAdd = queues.sms.add as unknown as ReturnType<typeof vi.fn>;

beforeEach(async () => {
  vi.clearAllMocks();
  app = (await import('../src/index.js')).default;
});

describe('job producers use the typed payload contract', () => {
  it('POST /api/invoices/:id/send queues type "invoice" with `to` and the balance due', async () => {
    mockPrisma.invoice.findFirst.mockResolvedValue(
      buildInvoice({ status: 'ISSUED', balanceCents: 5000, totalCents: 107000 }),
    );
    mockPrisma.auditLog.create.mockResolvedValue({});

    const res = await request(app).post('/api/invoices/inv-1/send');

    expect(res.status).toBe(200);
    const [name, payload] = emailAdd.mock.calls[0];
    expect(name).toBe('send-invoice');
    expect(payload).toEqual({
      type: 'invoice',
      tenantId: 'test-tenant-id',
      to: 'jane@test.com',
      invoiceId: 'inv-1',
      invoiceNumber: 'INV-1001',
      customerName: 'Jane Smith',
      amountDueCents: 5000,
      dueDate: expect.any(String),
    });
  });

  it('POST /api/announcements queues email with type "announcement" and SMS with `to`', async () => {
    mockPrisma.announcement.create.mockResolvedValue({ id: 'ann-1' });
    mockPrisma.customer.findMany.mockResolvedValue([
      { id: 'cust-1', email: 'a@example.com', phone: '+15551234567' },
    ]);
    mockPrisma.announcementDelivery.createMany.mockResolvedValue({ count: 2 });
    mockPrisma.announcement.update.mockResolvedValue({ id: 'ann-1' });
    mockPrisma.announcement.findFirst.mockResolvedValue({ id: 'ann-1', _count: { deliveries: 2 } });
    mockPrisma.auditLog.create.mockResolvedValue({});

    const res = await request(app)
      .post('/api/announcements')
      .send({ title: 'Hello', body: 'World', channel: 'BOTH', audience: 'all' });

    expect(res.status).toBe(201);
    expect(emailAdd.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        type: 'announcement',
        to: 'a@example.com',
        announcementId: 'ann-1',
        customerId: 'cust-1',
        subject: 'Hello',
        body: 'World',
      }),
    );
    const smsPayload = smsAdd.mock.calls[0][1];
    expect(smsPayload).toEqual(expect.objectContaining({ to: '+15551234567', body: 'World', announcementId: 'ann-1' }));
    expect(smsPayload).not.toHaveProperty('phone');
  });

  it('handleAchReturn queues type "ach_return" and leaves customerNotifiedAt to the worker', async () => {
    const { handleAchReturn } = await import('../src/services/ach-handler.js');
    mockPrisma.payment.findFirst.mockResolvedValue({
      id: 'pay-1',
      customerId: 'cust-1',
      amountCents: 5000,
      invoice: { id: 'inv-1', status: 'PAID', balanceCents: 0, totalCents: 5000 },
      customer: { id: 'cust-1', email: 'jane@test.com', firstName: 'Jane', lastName: 'Smith' },
    });
    mockPrisma.achReturn.update.mockReset();

    await handleAchReturn(
      {
        data: {
          object: { payment_intent: 'pi_1', failure_code: 'R01', failure_message: 'R01', metadata: {} },
        },
      } as any,
      'test-tenant-id',
    );

    const [name, payload, opts] = emailAdd.mock.calls[0];
    expect(name).toBe('ach-return-notification');
    expect(payload).toEqual(
      expect.objectContaining({ type: 'ach_return', to: 'jane@test.com', tenantId: 'test-tenant-id', amountCents: 5000 }),
    );
    expect(opts.jobId).toBe(`ach-return-${payload.achReturnId}`);
    expect(mockPrisma.achReturn.update).not.toHaveBeenCalled();
  });
});
