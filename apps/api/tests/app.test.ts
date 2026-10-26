import { describe, it, expect, vi } from 'vitest';
import http from 'node:http';
import request from 'supertest';

describe('src/index.ts', () => {
  it('exports the app without listening when imported (tests can import it in parallel)', async () => {
    const listen = vi.spyOn(http.Server.prototype, 'listen');
    const { default: app } = await import('../src/index.js');

    expect(typeof app).toBe('function');
    expect(listen).not.toHaveBeenCalled();

    // supertest binds its own ephemeral port.
    const res = await request(app).get('/api/health');
    expect(res.status).toBeLessThan(500);
    listen.mockRestore();
  });
});
