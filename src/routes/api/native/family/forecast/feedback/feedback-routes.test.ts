import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  role: 'owner' as 'owner' | 'member',
  viewer: null as null | { kind: 'household' },
  inserted: [] as Array<Record<string, unknown>>,
  deleted: [] as unknown[],
  next: [] as Array<Record<string, unknown>>,
}));

vi.mock('$lib/server/native-handler', () => ({
  withNativeAccess:
    (_area: string, fn: (event: unknown, identity: unknown, role: string) => unknown) => async (event: unknown) => {
      const r = await fn(event, { ownerEmail: 'Owner@example.test' }, h.role);
      return r instanceof Response ? r : Response.json(r);
    },
}));
vi.mock('$lib/home/presence/viewer', () => ({ peopleViewerOf: async () => h.viewer }));
vi.mock('$lib/home/presence/forecast.server', () => ({
  loadForecast: async () => ({ forecast: { next: h.next } }),
}));
vi.mock('$lib/db', () => ({
  db: {
    insert: () => ({ values: (v: Record<string, unknown>) => ({ returning: async () => { h.inserted.push(v); return [{ id: 'c1' }]; } }) }),
    delete: () => ({ where: () => ({ returning: async () => { h.deleted.push(1); return h.deleted.length === 1 ? [{ id: 'c1' }] : []; } }) }),
  },
}));

const route = await import('./+server');

type Handler = (e: unknown) => Promise<Response>;
function call(handler: unknown, opts: { method?: string; body?: unknown; query?: string } = {}) {
  const request = new Request(`https://strangeramblings.com/api/native/family/forecast/feedback${opts.query ?? ''}`, {
    method: opts.method ?? 'POST',
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    headers: { 'content-type': 'application/json' },
  });
  const locals = { viewer: Promise.resolve({ kind: 'member', email: 'kid@example.test' }) };
  return (handler as Handler)({ request, locals, url: new URL(request.url) });
}

const routineMove = { subject: 'katie', kind: 'routine', routineId: 'katie:home:station:walk:weekday', to: 'Station', leaveAt: '2026-10-05T07:00:00.000Z' };

beforeEach(() => {
  h.role = 'owner';
  h.viewer = null;
  h.inserted = [];
  h.deleted = [];
  h.next = [routineMove];
});

describe('POST /api/native/family/forecast/feedback', () => {
  it('records a correction to a move the forecast is showing', async () => {
    const res = await call(route.POST, { body: { subject: 'katie', kind: 'routine', routineId: routineMove.routineId, note: ' Off sick ' } });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: 'c1' });
    expect(h.inserted[0]).toMatchObject({
      subject: 'katie', kind: 'routine', routineId: routineMove.routineId, toPlace: 'Station', note: 'Off sick', reporterEmail: 'owner@example.test',
    });
    expect(h.inserted[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('is 404 for a move the forecast is not showing (or a person out of scope)', async () => {
    const res = await call(route.POST, { body: { subject: 'katie', kind: 'routine', routineId: 'katie:home:gym:walk:weekday' } });
    expect(res.status).toBe(404);
    expect(h.inserted).toEqual([]);
  });

  it('refuses somebody without the family, and a malformed body', async () => {
    h.role = 'member';
    expect((await call(route.POST, { body: { subject: 'katie', kind: 'routine', routineId: routineMove.routineId } })).status).toBe(403);
    h.role = 'owner';
    expect((await call(route.POST, { body: { subject: 'katie', kind: 'routine' } })).status).toBe(400);
    expect((await call(route.POST, { body: { subject: 'katie', kind: 'teleport' } })).status).toBe(400);
    expect(h.inserted).toEqual([]);
  });

  it('records a live journey by its departure', async () => {
    h.next = [{ subject: 'katie', kind: 'arriving', routineId: null, to: 'Station', leaveAt: '2026-10-05T07:20:00Z' }];
    const res = await call(route.POST, { body: { subject: 'katie', kind: 'arriving', departedAt: '2026-10-05T07:20:00Z' } });
    expect(res.status).toBe(201);
    expect(h.inserted[0]).toMatchObject({ kind: 'arriving', routineId: null, departedAt: '2026-10-05T07:20:00Z' });
  });
});

describe('DELETE /api/native/family/forecast/feedback', () => {
  it('takes your own correction back, once', async () => {
    const id = '0b5f2b2e-3f4a-4b7e-9d43-0f6a1d2c3b4a';
    expect((await call(route.DELETE, { method: 'DELETE', query: `?id=${id}` })).status).toBe(200);
    expect((await call(route.DELETE, { method: 'DELETE', query: `?id=${id}` })).status).toBe(404);
    expect((await call(route.DELETE, { method: 'DELETE', query: '?id=nope' })).status).toBe(400);
  });
});
