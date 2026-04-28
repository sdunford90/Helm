import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import crypto from 'node:crypto';
import { mockPrisma } from '../setup.js';

// handleQboWebhook is what the dispatcher delegates to. We mock it so we
// can simulate transient failures (FAILED rows) and successful replays.
const mockHandleQboWebhook = vi.fn();
vi.mock('../../src/services/qbo-sync.js', async () => {
  const actual = await vi.importActual<any>('../../src/services/qbo-sync.js');
  return {
    ...actual,
    handleQboWebhook: mockHandleQboWebhook,
  };
});

const VERIFIER_TOKEN = 'test-qbo-verifier';

let app: any;

function signedRequest(body: Record<string, unknown>) {
  const payload = JSON.stringify(body);
  const signature = crypto
    .createHmac('sha256', VERIFIER_TOKEN)
    .update(payload)
    .digest('base64');
  return { payload, signature };
}

function buildPayload(realmId: string): Record<string, unknown> {
  return {
    eventNotifications: [
      {
        realmId,
        dataChangeEvent: {
          entities: [{ name: 'Customer', id: '42', operation: 'Update' }],
        },
      },
    ],
  };
}

beforeEach(async () => {
  vi.clearAllMocks();
  process.env.QBO_WEBHOOK_VERIFIER_TOKEN = VERIFIER_TOKEN;

  // Default: realm doesn't resolve to a tenant/location.
  (mockPrisma as any).location.findFirst = vi.fn().mockResolvedValue(null);
  mockPrisma.tenant.findFirst = vi.fn().mockResolvedValue(null) as any;

  // QboWebhookDelivery mock — capture the row id so the route uses it for
  // background processing, and so the test can assert status updates.
  let nextId = 0;
  const rows = new Map<string, any>();
  (mockPrisma as any).qboWebhookDelivery = {
    create: vi.fn().mockImplementation(({ data }: any) => {
      const id = `delivery-${++nextId}`;
      const row = { id, attempts: 0, ...data };
      rows.set(id, row);
      return Promise.resolve(row);
    }),
    update: vi.fn().mockImplementation(({ where, data }: any) => {
      const row = rows.get(where.id);
      if (!row) return Promise.resolve(null);
      const merged = { ...row, ...data };
      if (data.attempts && typeof data.attempts === 'object' && data.attempts.increment) {
        merged.attempts = (row.attempts ?? 0) + data.attempts.increment;
      }
      rows.set(where.id, merged);
      return Promise.resolve(merged);
    }),
    findUnique: vi.fn().mockImplementation(({ where }: any) =>
      Promise.resolve(rows.get(where.id) ?? null),
    ),
    findMany: vi.fn().mockImplementation(({ where }: any) => {
      const all = [...rows.values()];
      const filtered = all.filter((r) => {
        if (where?.tenantId && r.tenantId !== where.tenantId) return false;
        if (where?.status && r.status !== where.status) return false;
        return true;
      });
      return Promise.resolve(filtered);
    }),
  };

  const mod = await import('../../src/index.js');
  app = mod.default;
});

// Helper to wait for the background `void processDeliveryInBackground(...)`
// chain to flush. The route calls .then() chains that resolve on the
// microtask queue; two setImmediate ticks is more than enough.
async function flushBackground() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

describe('POST /api/qbo/webhook — delivery persistence', () => {
  it('saves the delivery and marks it PROCESSED on a successful dispatch', async () => {
    mockHandleQboWebhook.mockResolvedValue(undefined);

    const body = buildPayload('realm-success');
    const { payload, signature } = signedRequest(body);

    const res = await request(app)
      .post('/api/qbo/webhook')
      .set('intuit-signature', signature)
      .set('Content-Type', 'application/json')
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });

    // Row was persisted with the raw payload + signature.
    expect((mockPrisma as any).qboWebhookDelivery.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          realmId: 'realm-success',
          signature,
          status: 'PENDING',
          attempts: 0,
        }),
      }),
    );

    await flushBackground();

    // Status was advanced to PROCESSED after the dispatcher succeeded.
    const updateCalls = (mockPrisma as any).qboWebhookDelivery.update.mock.calls;
    const processedCall = updateCalls.find(
      ([args]: [any]) => args?.data?.status === 'PROCESSED',
    );
    expect(processedCall).toBeDefined();
    expect(processedCall[0].data.processedAt).toBeInstanceOf(Date);
  });

  it('marks the delivery FAILED when the background dispatcher throws', async () => {
    mockHandleQboWebhook.mockRejectedValue(new Error('QBO API 503'));

    const body = buildPayload('realm-fail');
    const { payload, signature } = signedRequest(body);

    const res = await request(app)
      .post('/api/qbo/webhook')
      .set('intuit-signature', signature)
      .set('Content-Type', 'application/json')
      .send(payload);

    expect(res.status).toBe(200);

    await flushBackground();

    const updateCalls = (mockPrisma as any).qboWebhookDelivery.update.mock.calls;
    const failedCall = updateCalls.find(
      ([args]: [any]) => args?.data?.status === 'FAILED',
    );
    expect(failedCall).toBeDefined();
    expect(failedCall[0].data.lastError).toContain('QBO API 503');
  });

  it('rejects deliveries with an invalid signature without saving a row', async () => {
    const body = buildPayload('realm-bad-sig');

    const res = await request(app)
      .post('/api/qbo/webhook')
      .set('intuit-signature', 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(body));

    expect(res.status).toBe(401);
    expect((mockPrisma as any).qboWebhookDelivery.create).not.toHaveBeenCalled();
    expect(mockHandleQboWebhook).not.toHaveBeenCalled();
  });

  it('resolves the realmId to a Location when one matches', async () => {
    (mockPrisma as any).location.findFirst.mockResolvedValue({
      id: 'loc-abc',
      tenantId: 'tenant-abc',
    });
    mockHandleQboWebhook.mockResolvedValue(undefined);

    const body = buildPayload('realm-with-location');
    const { payload, signature } = signedRequest(body);

    await request(app)
      .post('/api/qbo/webhook')
      .set('intuit-signature', signature)
      .set('Content-Type', 'application/json')
      .send(payload);

    expect((mockPrisma as any).qboWebhookDelivery.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: 'tenant-abc',
          locationId: 'loc-abc',
          realmId: 'realm-with-location',
        }),
      }),
    );
  });
});

describe('POST /api/qbo/webhook-deliveries/:id/replay — operator replay', () => {
  it('replays a FAILED row and marks it PROCESSED on success', async () => {
    // Step 1: simulate an initial FAILED delivery.
    (mockPrisma as any).location.findFirst.mockResolvedValue({
      id: 'loc-1',
      tenantId: 'test-tenant-id',
    });
    mockHandleQboWebhook.mockRejectedValueOnce(new Error('transient DB outage'));

    const body = buildPayload('realm-replay');
    const { payload, signature } = signedRequest(body);

    await request(app)
      .post('/api/qbo/webhook')
      .set('intuit-signature', signature)
      .set('Content-Type', 'application/json')
      .send(payload);

    await flushBackground();

    const failedRow = [...((mockPrisma as any).qboWebhookDelivery.update.mock.calls)]
      .reverse()
      .find(([args]: [any]) => args?.data?.status === 'FAILED');
    expect(failedRow).toBeDefined();
    const deliveryId = failedRow[0].where.id;

    // Step 2: dispatcher recovers; operator hits the replay endpoint.
    mockHandleQboWebhook.mockResolvedValueOnce(undefined);

    const replayRes = await request(app)
      .post(`/api/qbo/webhook-deliveries/${deliveryId}/replay`);

    expect(replayRes.status).toBe(200);
    expect(replayRes.body).toEqual({ id: deliveryId, status: 'PROCESSED' });

    // The row's attempts counter must have been incremented during replay.
    const replayUpdateCalls = (mockPrisma as any).qboWebhookDelivery.update.mock.calls;
    const incrementCall = replayUpdateCalls.find(
      ([args]: [any]) =>
        args?.where?.id === deliveryId &&
        args?.data?.attempts?.increment === 1,
    );
    expect(incrementCall).toBeDefined();

    // And the final state should be PROCESSED.
    const finalProcessed = [...replayUpdateCalls]
      .reverse()
      .find(
        ([args]: [any]) =>
          args?.where?.id === deliveryId && args?.data?.status === 'PROCESSED',
      );
    expect(finalProcessed).toBeDefined();
  });

  it('returns 404 when the delivery belongs to a different tenant', async () => {
    // Pre-seed a delivery owned by a different tenant.
    (mockPrisma as any).qboWebhookDelivery.findUnique = vi
      .fn()
      .mockResolvedValue({ id: 'other-delivery', tenantId: 'other-tenant' });

    const res = await request(app)
      .post('/api/qbo/webhook-deliveries/other-delivery/replay');

    expect(res.status).toBe(404);
  });
});

describe('GET /api/qbo/webhook-deliveries — operator inspection', () => {
  it('returns deliveries scoped to the signed-in tenant', async () => {
    const seeded = [
      {
        id: 'd-1',
        tenantId: 'test-tenant-id',
        realmId: 'r1',
        status: 'FAILED',
        receivedAt: new Date(),
        lastError: 'boom',
      },
      {
        id: 'd-2',
        tenantId: 'other-tenant',
        realmId: 'r2',
        status: 'FAILED',
        receivedAt: new Date(),
      },
    ];
    (mockPrisma as any).qboWebhookDelivery.findMany = vi
      .fn()
      .mockImplementation(({ where, take }: any) => {
        const filtered = seeded.filter((r) => {
          if (where?.tenantId && r.tenantId !== where.tenantId) return false;
          if (where?.status && r.status !== where.status) return false;
          return true;
        });
        return Promise.resolve(filtered.slice(0, take));
      });

    const res = await request(app)
      .get('/api/qbo/webhook-deliveries')
      .query({ status: 'FAILED' });

    expect(res.status).toBe(200);
    expect(res.body.deliveries).toHaveLength(1);
    expect(res.body.deliveries[0].id).toBe('d-1');
  });
});
