import { describe, expect, it, vi } from 'vitest';

// On homeserv the hook lets /api/scraper/script through with no session (the
// VPS used to proxy to it), so the route must check the caller itself: the
// service bearer or the owner (pre-invite audit, 2026-09-27). The route was
// retired with the stealth-scrape node on 2026-10-02 and now answers 410 — but
// only to a caller that passes the same check.

const h = vi.hoisted(() => ({ owner: false }));
vi.mock('os', () => ({ hostname: () => 'homeserv', default: { hostname: () => 'homeserv' } }));
vi.mock('$env/dynamic/private', () => ({ env: { SCRAPER_SERVICE_TOKEN: 'svc-token' } }));
vi.mock('$lib/server/owner', () => ({ isOwnerRequest: async () => h.owner }));

const { GET, DELETE, POST } = await import('./+server');
const ev = (method: string, bearer?: string) =>
  ({
    url: new URL('https://homeserv.test/api/scraper/script?profile=p1'),
    request: new Request('https://homeserv.test/api/scraper/script?profile=p1', {
      method,
      headers: bearer ? { authorization: `Bearer ${bearer}` } : {},
    }),
    locals: {},
    getClientAddress: () => '100.64.0.9',
  }) as never;

describe('/api/scraper/script on homeserv', () => {
  it('refuses a caller with neither the bearer nor an owner session', async () => {
    h.owner = false;
    await expect(GET(ev('GET'))).rejects.toMatchObject({ status: 401 });
    await expect(DELETE(ev('DELETE', 'wrong'))).rejects.toMatchObject({ status: 401 });
    await expect(POST(ev('POST'))).rejects.toMatchObject({ status: 401 });
  });

  it('answers 410 to the service bearer and the owner', async () => {
    h.owner = false;
    await expect(GET(ev('GET', 'svc-token'))).rejects.toMatchObject({ status: 410 });
    h.owner = true;
    await expect(DELETE(ev('DELETE'))).rejects.toMatchObject({ status: 410 });
  });
});
