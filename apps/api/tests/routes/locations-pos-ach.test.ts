import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { mockPrisma } from '../setup.js';

let app: any;

beforeEach(async () => {
  vi.clearAllMocks();
  const mod = await import('../../src/index.js');
  app = mod.default;
});

describe('GET /api/locations — exposes posAchEnabled for POS gating (task #225)', () => {
  it('returns posAchEnabled per location so the POS UI can hide the ACH button when a location opted out', async () => {
    // The POS counter (apps/web/src/pages/POS.tsx) reads
    // `locations[].posAchEnabled` from this exact endpoint to decide
    // whether to render the ACH payment button. This contract test locks
    // the field name and Prisma `select` shape so a future refactor of
    // the locations response (e.g. dropping `posAchEnabled` from select)
    // can't silently re-enable ACH for tenants that opted out.
    mockPrisma.location.findMany.mockResolvedValue([
      {
        id: 'loc-on',
        name: 'Bayfront',
        address: '1 Pier Rd',
        city: 'Newport',
        state: 'RI',
        phone: null,
        timezone: 'America/New_York',
        transientEnabled: true,
        rentalsEnabled: false,
        rampEnabled: false,
        conciergeEnabled: false,
        posAchEnabled: true,
      },
      {
        id: 'loc-off',
        name: 'Riverside',
        address: '2 River Ln',
        city: 'Bristol',
        state: 'RI',
        phone: null,
        timezone: 'America/New_York',
        transientEnabled: true,
        rentalsEnabled: false,
        rampEnabled: false,
        conciergeEnabled: false,
        posAchEnabled: false,
      },
    ]);

    const res = await request(app).get('/api/locations');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);

    const byId = Object.fromEntries(
      (res.body.data as Array<{ id: string; posAchEnabled: boolean }>).map((l) => [l.id, l]),
    );
    expect(byId['loc-on'].posAchEnabled).toBe(true);
    expect(byId['loc-off'].posAchEnabled).toBe(false);

    // Catch a regression where someone removes `posAchEnabled` from the
    // Prisma `select` clause but leaves the field name intact in routes
    // — the call below must request it explicitly so Prisma includes it.
    const findManyArgs = mockPrisma.location.findMany.mock.calls[0][0] as any;
    expect(findManyArgs.select).toMatchObject({ posAchEnabled: true });
  });

  it('defaults to ACH hidden — when a location row stores posAchEnabled=false the API returns false (not undefined)', async () => {
    // The POS UI uses `=== true` for the gate, so undefined would also
    // hide the button — but we want the schema default (false) to come
    // through verbatim so admins reading the JSON in DevTools see the
    // honest stored value.
    mockPrisma.location.findMany.mockResolvedValue([
      {
        id: 'loc-default',
        name: 'New Marina',
        address: null,
        city: null,
        state: null,
        phone: null,
        timezone: 'America/New_York',
        transientEnabled: false,
        rentalsEnabled: false,
        rampEnabled: false,
        conciergeEnabled: false,
        posAchEnabled: false,
      },
    ]);

    const res = await request(app).get('/api/locations');
    expect(res.status).toBe(200);
    expect(res.body.data[0]).toHaveProperty('posAchEnabled', false);
  });
});
