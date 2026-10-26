import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UnrecoverableError } from 'bullmq';
import { mockPrisma } from '../setup.js';

vi.mock('../../src/lib/email.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/email.js')>();
  return { ...actual, sendEmail: vi.fn().mockResolvedValue('msg_1') };
});
vi.mock('../../src/lib/sms.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/sms.js')>();
  return { ...actual, sendSms: vi.fn().mockResolvedValue('SM1') };
});

import { sendEmail, EmailSendError } from '../../src/lib/email.js';
import { sendSms } from '../../src/lib/sms.js';
import {
  processEmailJob,
  processSmsJob,
  processRentalAutomationJob,
  renderEmailJob,
} from '../../src/workers/processors.js';

const send = sendEmail as unknown as ReturnType<typeof vi.fn>;
const sms = sendSms as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  send.mockReset().mockResolvedValue('msg_1');
  sms.mockReset().mockResolvedValue('SM1');
  mockPrisma.communicationPreference.findFirst.mockReset().mockResolvedValue(null);
  mockPrisma.achReturn.updateMany.mockReset().mockResolvedValue({ count: 1 });
  mockPrisma.announcementDelivery.updateMany.mockReset().mockResolvedValue({ count: 1 });
  mockPrisma.tenant.findUnique.mockReset().mockResolvedValue({ name: 'Bayshore <Marina>' });
  mockPrisma.insuranceRecord.findFirst.mockReset();
  mockPrisma.customer.findFirst.mockReset();
});

describe('email worker: HTML escaping', () => {
  it('escapes interpolated values in the invoice template', async () => {
    await processEmailJob({
      type: 'invoice',
      tenantId: 't1',
      to: 'jane@test.com',
      invoiceId: 'inv-1',
      invoiceNumber: 'INV-<1>',
      customerName: '<script>alert(1)</script>',
      amountDueCents: 123456,
      dueDate: '2026-11-30T00:00:00.000Z',
    });

    const { html, subject, to } = send.mock.calls[0][0];
    expect(to).toBe('jane@test.com');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('INV-&lt;1&gt;');
    expect(html).toContain('$1,234.56');
    expect(html).toContain('/invoices/inv-1');
    expect(subject).toBe('Invoice INV-<1> — $1,234.56 due November 30, 2026');
  });

  it('treats announcement bodies as text (no HTML injection) and escapes the marina name', async () => {
    await processEmailJob({
      type: 'announcement',
      tenantId: 't1',
      to: 'a@test.com',
      announcementId: 'ann-1',
      customerId: 'cust-1',
      subject: 'Closure',
      body: '<img src=x onerror=alert(1)>\nSee you',
    });
    const { html } = send.mock.calls[0][0];
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;<br>See you');
    expect(html).toContain('Bayshore &lt;Marina&gt;');
  });

  it('renders every job type in the contract', async () => {
    mockPrisma.insuranceRecord.findFirst.mockResolvedValue({
      expiryDate: new Date('2026-12-01T00:00:00.000Z'),
      customer: { id: 'cust-1', firstName: 'A', lastName: 'B', email: 'a@b.c' },
    });
    const jobs: Parameters<typeof renderEmailJob>[0][] = [
      { type: 'invoice', tenantId: 't', to: 'a@b.c', invoiceId: 'i', invoiceNumber: 'n', customerName: 'c', amountDueCents: 1, dueDate: '2026-01-01' },
      { type: 'payment_receipt', tenantId: 't', to: 'a@b.c', paymentId: 'p', invoiceNumber: 'n', customerName: 'c', amountCents: 1, method: 'CARD' },
      { type: 'ach_return', tenantId: 't', to: 'a@b.c', achReturnId: 'r', customerName: 'c', amountCents: 1, returnFeeCents: 2500, rCode: 'R01', reason: 'Insufficient Funds' },
      { type: 'insurance_expiry_reminder', tenantId: 't', customerId: 'cust-1', insuranceRecordId: 'ins-1', expiryDate: '2026-12-01T00:00:00.000Z', reminderType: '30-day' },
      { type: 'announcement', tenantId: 't', to: 'a@b.c', announcementId: 'a', customerId: 'c', subject: 's', body: 'b' },
      { type: 'renewal_esign', tenantId: 't', to: 'a@b.c', batchId: 'b', customerId: 'c', contractId: 'k', customerName: 'c', slipNumber: 'A-1', startDate: '2026-01-01', endDate: null, rateCents: 100, billingCycle: 'ANNUAL' },
      { type: 'tenant_lifecycle', tenantId: 't', to: 'a@b.c', tenantName: 'M', recipientName: 'R', subject: 's', message: 'm', graceDayNumber: 7 },
      { type: 'automation', tenantId: 't', to: 'a@b.c', subject: 's', templateHtml: '<p>x</p>' },
    ];
    for (const job of jobs) {
      const rendered = await renderEmailJob(job);
      expect('skip' in rendered, job.type).toBe(false);
      if (!('skip' in rendered)) {
        expect(rendered.to).toBe('a@b.c');
        expect(rendered.html.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('email worker: failure semantics', () => {
  it('rethrows provider errors so BullMQ retries', async () => {
    send.mockRejectedValue(new EmailSendError('rate limited'));
    await expect(
      processEmailJob({ type: 'tenant_lifecycle', tenantId: 't', to: 'a@b.c', tenantName: 'M', recipientName: 'R', subject: 's', message: 'm', graceDayNumber: 7 }),
    ).rejects.toThrow('rate limited');
  });

  it('turns permanent provider errors into UnrecoverableError (no retries)', async () => {
    send.mockRejectedValue(new EmailSendError('bad address', { permanent: true }));
    await expect(
      processEmailJob({ type: 'tenant_lifecycle', tenantId: 't', to: 'bad', tenantName: 'M', recipientName: 'R', subject: 's', message: 'm', graceDayNumber: 7 }),
    ).rejects.toBeInstanceOf(UnrecoverableError);
  });

  it('fails unknown job types loudly instead of dropping them', async () => {
    await expect(processEmailJob({ type: 'send-invoice', tenantId: 't', to: 'x' } as any)).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
    expect(send).not.toHaveBeenCalled();
  });
});

describe('email worker: bookkeeping after send', () => {
  const achJob = {
    type: 'ach_return' as const,
    tenantId: 't1',
    to: 'a@b.c',
    achReturnId: 'achr-1',
    customerName: 'Jane',
    amountCents: 5000,
    returnFeeCents: 2500,
    rCode: 'R01',
    reason: 'Insufficient Funds',
  };

  it('sets AchReturn.customerNotifiedAt only after a successful send', async () => {
    await processEmailJob(achJob);
    expect(mockPrisma.achReturn.updateMany).toHaveBeenCalledWith({
      where: { id: 'achr-1', tenantId: 't1' },
      data: { customerNotifiedAt: expect.any(Date) },
    });
  });

  it('does not mark the ACH customer notified when the send fails', async () => {
    send.mockRejectedValue(new EmailSendError('down'));
    await expect(processEmailJob(achJob)).rejects.toThrow();
    expect(mockPrisma.achReturn.updateMany).not.toHaveBeenCalled();
  });

  it('marks announcement deliveries SENT (scoped to the tenant via the announcement)', async () => {
    await processEmailJob({ type: 'announcement', tenantId: 't1', to: 'a@b.c', announcementId: 'ann-1', customerId: 'cust-1', subject: 's', body: 'b' });
    expect(mockPrisma.announcementDelivery.updateMany).toHaveBeenCalledWith({
      where: { announcementId: 'ann-1', customerId: 'cust-1', channel: 'EMAIL', announcement: { tenantId: 't1' } },
      data: { status: 'SENT' },
    });
  });

  it('respects announcement opt-out', async () => {
    mockPrisma.communicationPreference.findFirst.mockResolvedValue({ optedIn: false });
    const out = await processEmailJob({ type: 'announcement', tenantId: 't1', to: 'a@b.c', announcementId: 'ann-1', customerId: 'cust-1', subject: 's', body: 'b' });
    expect(out.status).toBe('skipped');
    expect(send).not.toHaveBeenCalled();
  });

  it('drops a stale insurance reminder when the expiry date changed', async () => {
    mockPrisma.insuranceRecord.findFirst.mockResolvedValue({
      expiryDate: new Date('2027-06-01T00:00:00.000Z'),
      customer: { id: 'cust-1', firstName: 'A', lastName: 'B', email: 'a@b.c' },
    });
    const out = await processEmailJob({
      type: 'insurance_expiry_reminder',
      tenantId: 't1',
      customerId: 'cust-1',
      insuranceRecordId: 'ins-1',
      expiryDate: '2026-12-01T00:00:00.000Z',
      reminderType: '7-day',
    });
    expect(out.status).toBe('skipped');
    expect(send).not.toHaveBeenCalled();
  });
});

describe('sms worker', () => {
  it('sends to the `to` field (producers used to send `phone`)', async () => {
    await processSmsJob({ tenantId: 't1', to: '+15551234567', body: 'hello' });
    expect(sms).toHaveBeenCalledWith('+15551234567', 'hello', undefined);
  });

  it('rejects a job without `to` as unrecoverable', async () => {
    await expect(processSmsJob({ tenantId: 't1', phone: '+1555', body: 'x' } as any)).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
  });
});

describe('rental automation worker', () => {
  it('queries customers by camelCase tenantId/firstName and uses the schema enum names', async () => {
    mockPrisma.customer.findFirst.mockResolvedValue({ id: 'c1', firstName: 'Jo', lastName: '<b>', email: 'jo@x.y', phone: null });

    const out = await processRentalAutomationJob({ type: 'POST_BOOKING_CONFIRM', customerId: 'c1', tenantId: 't1' });

    expect(out.status).toBe('sent');
    expect(mockPrisma.customer.findFirst).toHaveBeenCalledWith({
      where: { id: 'c1', tenantId: 't1' },
      select: { id: true, firstName: true, lastName: true, email: true, phone: true },
    });
    expect(send.mock.calls[0][0].html).toContain('Jo &lt;b&gt;');
  });

  it('does not send marketing drip without consent', async () => {
    mockPrisma.customer.findFirst.mockResolvedValue({ id: 'c1', firstName: 'Jo', lastName: 'X', email: 'jo@x.y', phone: '+1555' });
    const out = await processRentalAutomationJob({ type: 'ABANDONED_CART_1', customerId: 'c1', tenantId: 't1' });
    expect(out.status).toBe('skipped');
    const smsOut = await processRentalAutomationJob({ type: 'ABANDONED_CART_3', customerId: 'c1', tenantId: 't1' });
    expect(smsOut.status).toBe('skipped');
    expect(send).not.toHaveBeenCalled();
    expect(sms).not.toHaveBeenCalled();
  });
});
