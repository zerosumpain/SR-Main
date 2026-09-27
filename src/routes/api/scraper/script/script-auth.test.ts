import { describe, expect, it, vi } from 'vitest';

// On homeserv the hook lets /api/scraper/script through with no session (the
// VPS proxies to it), so GET and DELETE must check the caller themselves: the
// service bearer or the owner. They checked nothing (pre-invite audit, 2026-09-27).

const h = vi.hoisted(() => ({ owner: false, deleted: [] as string[] }));
vi.mock('os', () => ({ hostname: () => 'homeserv', default: { hostname: () => 'homeserv' } }));
vi.mock('$env/dynamic/private', () => ({ env: { SCRAPER_SERVICE_TOKEN: 'svc-token' } }));
vi.mock('$lib/server/owner', () => ({ isOwnerRequest: async () => h.owner }));
vi.mock('$lib/workflows/scraper/script-store', () => ({
  readScript: async () => ({ code: 'secret script', meta: {} }),
  deleteScript: async (p: string) => (h.deleted.push(p), true),
}));
vi.mock('$lib/workflows/scraper/script-runner', () => ({ runScript: async () => ({}) }));
vi.mock('$lib/workflows/scraper/script-author', () => ({ runScriptAuthor: async () => ({}) }));

const { GET, DELETE } = await import('./+server');
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
    expect(h.deleted).toEqual([]);
  });

  it('serves the VPS proxy (bearer) and the owner', async () => {
    h.owner = false;
    expect(((await GET(ev('GET', 'svc-token'))) as Response).status).toBe(200);
    h.owner = true;
    expect(((await DELETE(ev('DELETE'))) as Response).status).toBe(200);
    expect(h.deleted).toEqual(['p1']);
  });
});
