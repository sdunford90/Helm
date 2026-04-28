import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createTestApp } from '../helpers.js';
import { mockPrisma } from '../setup.js';

let app: Express;

beforeAll(async () => {
  app = await createTestApp();
});

beforeEach(() => {
  Object.values(mockPrisma).forEach((model) => {
    if (typeof model === 'object' && model !== null) {
      Object.values(model).forEach((fn) => {
        if (typeof fn === 'function' && 'mockReset' in fn) {
          (fn as any).mockReset();
        }
      });
    }
  });
});

describe('GET /api/reports/occupancy', () => {
  it('returns occupancy data with summary and byDock breakdown', async () => {
    mockPrisma.slip.count
      .mockResolvedValueOnce(100)  // total
      .mockResolvedValueOnce(75)   // occupied
      .mockResolvedValueOnce(20)   // vacant
      .mockResolvedValueOnce(3)    // maintenance
      .mockResolvedValueOnce(2);   // reserved

    mockPrisma.slip.groupBy
      .mockResolvedValueOnce([
        { dockId: 'A', _count: { id: 50 } },
        { dockId: 'B', _count: { id: 50 } },
      ])
      .mockResolvedValueOnce([
        { dockId: 'A', _count: { id: 40 } },
        { dockId: 'B', _count: { id: 35 } },
      ])
      .mockResolvedValueOnce([
        { dockId: 'A', _count: { id: 1 } },
        { dockId: 'B', _count: { id: 2 } },
      ]);

    const res = await request(app).get('/api/reports/occupancy');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('summary');
    expect(res.body.summary).toHaveProperty('total', 100);
    expect(res.body.summary).toHaveProperty('occupied', 75);
    expect(res.body.summary).toHaveProperty('vacant', 20);
    expect(res.body.summary).toHaveProperty('maintenance', 3);
    expect(res.body.summary).toHaveProperty('reserved', 2);
    expect(res.body.summary).toHaveProperty('occupancyRate');
    expect(res.body).toHaveProperty('byDock');
    expect(Array.isArray(res.body.byDock)).toBe(true);
    expect(res.body.byDock).toHaveLength(2);
  });

  it('returns zero occupancy when marina is empty', async () => {
    mockPrisma.slip.count.mockResolvedValue(0);
    mockPrisma.slip.groupBy.mockResolvedValue([]);

    const res = await request(app).get('/api/reports/occupancy');

    expect(res.status).toBe(200);
    expect(res.body.summary.total).toBe(0);
    expect(res.body.summary.occupancyRate).toBe('0.0');
  });
});

describe('GET /api/reports/revenue', () => {
  it('returns revenue data for the period', async () => {
    mockPrisma.payment.aggregate.mockResolvedValue({
      _sum: { amountCents: 5000000 },
      _count: { id: 47 },
    });
    mockPrisma.invoice.aggregate.mockResolvedValue({
      _sum: { totalCents: 6000000 },
      _count: { id: 55 },
    });
    mockPrisma.payment.groupBy.mockResolvedValue([
      { method: 'CARD', _sum: { amountCents: 3000000 }, _count: { id: 30 } },
      { method: 'ACH', _sum: { amountCents: 1500000 }, _count: { id: 12 } },
      { method: 'CASH', _sum: { amountCents: 500000 }, _count: { id: 5 } },
    ]);

    const res = await request(app).get('/api/reports/revenue');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('period');
    expect(res.body.period).toHaveProperty('startDate');
    expect(res.body.period).toHaveProperty('endDate');
    expect(res.body).toHaveProperty('revenue');
    expect(res.body.revenue).toHaveProperty('totalCents', 5000000);
    expect(res.body.revenue).toHaveProperty('paymentCount', 47);
    expect(res.body).toHaveProperty('invoiced');
    expect(res.body.invoiced).toHaveProperty('totalCents', 6000000);
    expect(res.body).toHaveProperty('byPaymentMethod');
    expect(res.body.byPaymentMethod).toHaveLength(3);
  });

  it('supports custom date range', async () => {
    mockPrisma.payment.aggregate.mockResolvedValue({
      _sum: { amountCents: 0 },
      _count: { id: 0 },
    });
    mockPrisma.invoice.aggregate.mockResolvedValue({
      _sum: { totalCents: 0 },
      _count: { id: 0 },
    });
    mockPrisma.payment.groupBy.mockResolvedValue([]);

    const res = await request(app).get('/api/reports/revenue?startDate=2025-01-01&endDate=2025-01-31');

    expect(res.status).toBe(200);
    expect(res.body.revenue.totalCents).toBe(0);
  });
});

describe('GET /api/reports/ar-aging', () => {
  it('returns aging buckets with invoice details', async () => {
    const now = new Date();
    const pastDue45Days = new Date(now.getTime() - 45 * 86400000);
    const pastDue5Days = new Date(now.getTime() - 5 * 86400000);

    mockPrisma.invoice.findMany.mockResolvedValue([
      {
        id: 'inv-1',
        invoiceNumber: 'INV-1001',
        dueDate: pastDue45Days,
        balanceCents: 50000,
        customer: { id: 'cust-1', firstName: 'Jane', lastName: 'Smith', email: 'jane@test.com' },
      },
      {
        id: 'inv-2',
        invoiceNumber: 'INV-1002',
        dueDate: pastDue5Days,
        balanceCents: 75000,
        customer: { id: 'cust-2', firstName: 'Bob', lastName: 'Jones', email: 'bob@test.com' },
      },
    ]);

    const res = await request(app).get('/api/reports/ar-aging');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('buckets');
    expect(res.body.buckets).toHaveProperty('current');
    expect(res.body.buckets).toHaveProperty('days30');
    expect(res.body.buckets).toHaveProperty('days60');
    expect(res.body.buckets).toHaveProperty('days90');
    expect(res.body.buckets).toHaveProperty('days120plus');
    expect(res.body).toHaveProperty('totalOutstanding');
    expect(res.body).toHaveProperty('invoiceCount', 2);
    expect(res.body).toHaveProperty('details');
    expect(Array.isArray(res.body.details)).toBe(true);
    expect(res.body.details).toHaveLength(2);
  });

  it('returns empty aging when no outstanding invoices', async () => {
    mockPrisma.invoice.findMany.mockResolvedValue([]);

    const res = await request(app).get('/api/reports/ar-aging');

    expect(res.status).toBe(200);
    expect(res.body.totalOutstanding).toBe(0);
    expect(res.body.invoiceCount).toBe(0);
    expect(res.body.details).toHaveLength(0);
  });
});

describe('GET /api/reports/gl-summary', () => {
  it('returns GL account summary with debits and credits', async () => {
    mockPrisma.glAccount.findMany.mockResolvedValue([
      { id: 'gl-1', accountNumber: '1000', name: 'Cash', type: 'ASSET' },
      { id: 'gl-2', accountNumber: '4000', name: 'Slip Revenue', type: 'REVENUE' },
    ]);

    mockPrisma.glEntry.groupBy.mockResolvedValue([
      { accountId: 'gl-1', _sum: { debitCents: 500000, creditCents: 100000 } },
      { accountId: 'gl-2', _sum: { debitCents: 0, creditCents: 500000 } },
    ]);

    const res = await request(app).get('/api/reports/gl-summary');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('period');
    expect(res.body).toHaveProperty('accounts');
    expect(Array.isArray(res.body.accounts)).toBe(true);
    expect(res.body.accounts).toHaveLength(2);
    expect(res.body.accounts[0]).toHaveProperty('accountNumber');
    expect(res.body.accounts[0]).toHaveProperty('name');
    expect(res.body.accounts[0]).toHaveProperty('type');
    expect(res.body.accounts[0]).toHaveProperty('debitsCents');
    expect(res.body.accounts[0]).toHaveProperty('creditsCents');
    expect(res.body.accounts[0]).toHaveProperty('netCents');
  });

  it('returns empty accounts when no GL data', async () => {
    mockPrisma.glAccount.findMany.mockResolvedValue([]);
    mockPrisma.glEntry.groupBy.mockResolvedValue([]);

    const res = await request(app).get('/api/reports/gl-summary');

    expect(res.status).toBe(200);
    expect(res.body.accounts).toHaveLength(0);
  });
});

describe('GET /api/reports/pnl', () => {
  it('returns P&L data with revenue, expenses, and net income', async () => {
    mockPrisma.glEntry.aggregate
      .mockResolvedValueOnce({ _sum: { creditCents: 1000000, debitCents: 50000 } })   // revenue
      .mockResolvedValueOnce({ _sum: { debitCents: 300000, creditCents: 10000 } })     // expenses
      .mockResolvedValueOnce({ _sum: { debitCents: 100000, creditCents: 5000 } });     // COGS

    const res = await request(app).get('/api/reports/pnl');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('period');
    expect(res.body).toHaveProperty('revenueCents');
    expect(res.body).toHaveProperty('cogsCents');
    expect(res.body).toHaveProperty('grossProfitCents');
    expect(res.body).toHaveProperty('expensesCents');
    expect(res.body).toHaveProperty('netIncomeCents');
    // revenue = 1000000 - 50000 = 950000
    expect(res.body.revenueCents).toBe(950000);
    // cogs = 100000 - 5000 = 95000
    expect(res.body.cogsCents).toBe(95000);
    // grossProfit = 950000 - 95000 = 855000
    expect(res.body.grossProfitCents).toBe(855000);
    // expenses = 300000 - 10000 = 290000
    expect(res.body.expensesCents).toBe(290000);
    // netIncome = 950000 - 95000 - 290000 = 565000
    expect(res.body.netIncomeCents).toBe(565000);
  });

  it('returns zero values when no GL entries exist', async () => {
    mockPrisma.glEntry.aggregate.mockResolvedValue({ _sum: { creditCents: 0, debitCents: 0 } });

    const res = await request(app).get('/api/reports/pnl');

    expect(res.status).toBe(200);
    expect(res.body.revenueCents).toBe(0);
    expect(res.body.netIncomeCents).toBe(0);
  });
});

describe('GET /api/reports/compliance', () => {
  it('returns compliance data for insurance and registration', async () => {
    mockPrisma.insuranceRecord.count
      .mockResolvedValueOnce(50)  // total
      .mockResolvedValueOnce(3)   // expired
      .mockResolvedValueOnce(5);  // expiring soon

    mockPrisma.boat.count
      .mockResolvedValueOnce(40)  // total boats
      .mockResolvedValueOnce(2);  // reg expired

    const res = await request(app).get('/api/reports/compliance');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('insurance');
    expect(res.body.insurance).toHaveProperty('total', 50);
    expect(res.body.insurance).toHaveProperty('expired', 3);
    expect(res.body.insurance).toHaveProperty('expiringSoon', 5);
    expect(res.body.insurance).toHaveProperty('compliant', 42);
    expect(res.body).toHaveProperty('registration');
    expect(res.body.registration).toHaveProperty('total', 40);
    expect(res.body.registration).toHaveProperty('expired', 2);
    expect(res.body.registration).toHaveProperty('current', 38);
  });

  it('returns zero compliance counts when no records exist', async () => {
    mockPrisma.insuranceRecord.count.mockResolvedValue(0);
    mockPrisma.boat.count.mockResolvedValue(0);

    const res = await request(app).get('/api/reports/compliance');

    expect(res.status).toBe(200);
    expect(res.body.insurance.total).toBe(0);
    expect(res.body.registration.total).toBe(0);
  });
});
