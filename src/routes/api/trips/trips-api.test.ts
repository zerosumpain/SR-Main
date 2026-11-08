import { beforeEach, describe, expect, it, vi } from 'vitest';

// The site lane: only the owner's session (or the dev-only LAN bypass) reaches
// a trip; a member, a guest or nobody gets the site's 403.
const h = vi.hoisted(() => ({ email: null as string | null, bypass: false, created: [] as unknown[] }));

vi.mock('$lib/server/access', () => ({
  isOwnerEmail: (e: string) => e === 'owner@example.test',
  getOwnerEmails: () => ['owner@example.test'],
}));
vi.mock('$lib/server/owner', () => ({ isOwnerRequest: async () => h.bypass }));
vi.mock('$lib/trips/store.server', () => ({
  listTrips: async (owner: string) => [{ id: 't1', owner }],
  createTrip: async (owner: string, input: unknown) => {
    h.created.push({ owner, input });
    return { id: 'new' };
  },
}));

const route = await import('./+server');

function ev(init: RequestInit = {}) {
  return {
    locals: { auth: async () => (h.email ? { user: { email: h.email } } : null) },
    getClientAddress: () => '100.83.68.1',
    request: new Request('http://x/api/trips', init),
  } as never;
}

beforeEach(() => {
  h.email = null;
  h.bypass = false;
  h.created = [];
});

async function status(p: Response | Promise<Response>): Promise<number> {
  try {
    return (await p).status;
  } catch (err) {
    return (err as { status: number }).status;
  }
}

describe('/api/trips', () => {
  it('refuses anyone but the owner', async () => {
    expect(await status(route.GET(ev()))).toBe(403);
    h.email = 'kid@example.test';
    expect(await status(route.GET(ev()))).toBe(403);
    expect(await status(route.POST(ev({ method: 'POST', body: '{}' })))).toBe(403);
  });

  it('lists and creates for the owner', async () => {
    h.email = 'Owner@Example.test';
    expect(await (await route.GET(ev())).json()).toEqual({ trips: [{ id: 't1', owner: 'owner@example.test' }] });
    const res = await route.POST(
      ev({ method: 'POST', body: JSON.stringify({ destination: 'Rome', timeZone: 'Europe/Rome', startDate: '2026-10-27', endDate: '2026-10-30' }) }),
    );
    expect(res.status).toBe(201);
    expect(h.created).toEqual([{ owner: 'owner@example.test', input: expect.objectContaining({ destination: 'Rome' }) }]);
  });

  it('answers the dev LAN bypass as the first allow-listed owner', async () => {
    h.bypass = true;
    expect(await (await route.GET(ev())).json()).toEqual({ trips: [{ id: 't1', owner: 'owner@example.test' }] });
  });

  it('400s a bad intake', async () => {
    h.email = 'owner@example.test';
    expect(await status(route.POST(ev({ method: 'POST', body: JSON.stringify({ destination: 'Rome' }) })))).toBe(400);
  });
});
