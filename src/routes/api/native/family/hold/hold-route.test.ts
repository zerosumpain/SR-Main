import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ owner: true, stored: null as unknown }));

vi.mock('$lib/server/native-handler', () => ({
  // The owner-only gate: a member's phone (or the owner viewing as one) is refused before the handler.
  withDevice: (fn: (event: unknown) => unknown) => async (event: unknown) => {
    if (!h.owner) return Response.json({ error: 'This account can no longer use the app.' }, { status: 403 });
    const r = await fn(event);
    return r instanceof Response ? r : Response.json(r);
  },
}));
vi.mock('$lib/home/presence/location-hold.server', () => ({
  getHold: async () => h.stored,
  setHold: async (hold: unknown) => { h.stored = hold; },
  clearHold: async () => { h.stored = null; },
}));

const route = await import('./+server');

function call(handler: unknown, method: string, body?: unknown) {
  const request = new Request('https://strangeramblings.com/api/native/family/hold', {
    method, body: body === undefined ? undefined : JSON.stringify(body), headers: { 'content-type': 'application/json' },
  });
  return (handler as (e: unknown) => Promise<Response>)({ request, url: new URL(request.url), locals: {} });
}

beforeEach(() => {
  h.owner = true;
  h.stored = null;
});

describe('/api/native/family/hold', () => {
  it('sets, reads and clears the owner\'s hold', async () => {
    const until = new Date(Date.now() + 3_600_000).toISOString();
    const put = await call(route.PUT, 'PUT', { lat: 54.5, lon: -1.5, label: 'Home', until });
    expect(put.status).toBe(200);
    expect(await put.json()).toMatchObject({ hold: { lat: 54.5, lon: -1.5, label: 'Home', until } });
    expect(await (await call(route.GET, 'GET')).json()).toMatchObject({ hold: { label: 'Home' } });
    expect(await (await call(route.DELETE, 'DELETE')).json()).toEqual({ hold: null });
    expect(h.stored).toBeNull();
  });

  it('is 400 for a bad hold and stores nothing', async () => {
    const res = await call(route.PUT, 'PUT', { lat: 54.5, lon: -1.5, label: 'Home', until: '2020-01-01T00:00:00Z' });
    expect(res.status).toBe(400);
    expect(h.stored).toBeNull();
  });

  it('refuses everyone but the owner, reads included', async () => {
    h.owner = false;
    for (const [handler, method] of [[route.GET, 'GET'], [route.PUT, 'PUT'], [route.DELETE, 'DELETE']] as const) {
      expect((await call(handler, method, method === 'PUT' ? {} : undefined)).status).toBe(403);
    }
  });
});
