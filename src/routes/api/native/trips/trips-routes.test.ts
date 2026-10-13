import { beforeEach, describe, expect, it, vi } from 'vitest';

// The phone lane: owner only (D2), the bundle's ETag and the events' idempotency
// as the routes see them. The gate is called straight through as the owner or
// a member; the store and the planner are stubs.
const h = vi.hoisted(() => ({
  role: 'owner' as 'owner' | 'member',
  applied: [] as string[],
  seen: new Set<string>(),
}));

vi.mock('$lib/server/native-handler', () => ({
  withNativeAccess:
    (_area: string, fn: (event: unknown, identity: unknown, role: string) => unknown) => async (event: unknown) => {
      const r = await fn(event, { ownerEmail: h.role === 'owner' ? 'owner@example.test' : 'kid@example.test' }, h.role);
      return r instanceof Response ? r : Response.json(r);
    },
}));
vi.mock('$lib/server/access', () => ({
  isOwnerEmail: (e: string) => e === 'owner@example.test',
  getOwnerEmails: () => ['owner@example.test'],
}));
vi.mock('$lib/server/owner', () => ({ isOwnerRequest: async () => false }));

const TRIP = { id: '11111111-1111-4111-8111-111111111111', title: 'Rome', research: null };
vi.mock('$lib/trips/store.server', () => ({
  listTrips: async (owner: string) => [{ id: TRIP.id, title: 'Rome', owner }],
  getTrip: async (owner: string, id: string) => (owner === 'owner@example.test' && id === TRIP.id ? TRIP : null),
}));
vi.mock('$lib/trips/plan.server', async () => {
  const { bundleEtag } = await import('$lib/trips/bundle');
  return {
    tripBundle: async () => {
      const body = { trip: TRIP, stays: [], wishes: [], bookings: [], plan: null, matrices: {} };
      return { ...body, etag: bundleEtag(body as never) };
    },
    applyEvents: async (_trip: unknown, events: Array<{ clientId: string }>) => {
      for (const e of events) if (!h.seen.has(e.clientId)) {
        h.seen.add(e.clientId);
        h.applied.push(e.clientId);
      }
      return { accepted: events.map((e) => e.clientId), planVersion: 7 };
    },
    replanOptions: async () => [{ id: 'o1', label: 'Push everything back 20 min' }],
  };
});

const list = await import('./+server');
const one = await import('./[id]/+server');
const events = await import('./[id]/events/+server');
const replan = await import('./[id]/replan/+server');

function ev(params: Record<string, string> = {}, init: RequestInit = {}) {
  return { params, request: new Request('http://x/api/native/trips', init), url: new URL('http://x/api/native/trips') } as never;
}
const post = (body: unknown) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

beforeEach(() => {
  h.role = 'owner';
  h.applied = [];
  h.seen = new Set();
});

describe('owner only (D2)', () => {
  it.each([
    ['list', () => list.GET(ev())],
    ['bundle', () => one.GET(ev({ id: TRIP.id }))],
    ['events', () => events.POST(ev({ id: TRIP.id }, post({ events: [], basePlanVersion: 0 })))],
    ['replan', () => replan.POST(ev({ id: TRIP.id }, post({ date: '2026-10-27', nowMin: 600, doneStopIds: [] })))],
  ])('refuses a member on %s with 403', async (_name, call) => {
    h.role = 'member';
    const res = await call();
    expect(res.status).toBe(403);
  });

  it('lists the owner’s trips', async () => {
    const res = await list.GET(ev());
    expect(await res.json()).toEqual({ trips: [{ id: TRIP.id, title: 'Rome', owner: 'owner@example.test' }] });
  });

  it('404s a trip that is not theirs', async () => {
    const res = await one.GET(ev({ id: '22222222-2222-4222-8222-222222222222' }));
    expect(res.status).toBe(404);
  });
});

describe('the bundle', () => {
  it('carries an ETag and answers 304 to If-None-Match', async () => {
    const first = await one.GET(ev({ id: TRIP.id }));
    expect(first.status).toBe(200);
    const tag = first.headers.get('etag')!;
    expect(tag).toMatch(/^"[0-9a-f]{32}"$/);
    expect((await first.json()).etag).toBe(tag);
    const again = await one.GET(ev({ id: TRIP.id }, { headers: { 'if-none-match': tag } }));
    expect(again.status).toBe(304);
    expect(await again.text()).toBe('');
    const other = await one.GET(ev({ id: TRIP.id }, { headers: { 'if-none-match': '"stale"' } }));
    expect(other.status).toBe(200);
  });
});

describe('events', () => {
  const body = {
    basePlanVersion: 6,
    events: [
      { clientId: 'a', kind: 'arrived', stopId: 's', at: '2026-10-27T09:00:00Z' },
      { clientId: 'b', kind: 'left', stopId: 's', at: '2026-10-27T10:00:00Z' },
    ],
  };
  it('accepts every clientId and applies each once across retries', async () => {
    const r1 = await events.POST(ev({ id: TRIP.id }, post(body)));
    expect(await r1.json()).toEqual({ accepted: ['a', 'b'], planVersion: 7 });
    const r2 = await events.POST(ev({ id: TRIP.id }, post(body)));
    expect(await r2.json()).toEqual({ accepted: ['a', 'b'], planVersion: 7 });
    expect(h.applied).toEqual(['a', 'b']);
  });

  it('400s a malformed batch', async () => {
    const res = await events.POST(ev({ id: TRIP.id }, post({ events: [{ kind: 'arrived' }] })));
    expect(res.status).toBe(400);
  });
});

describe('replan', () => {
  it('returns the options', async () => {
    const res = await replan.POST(ev({ id: TRIP.id }, post({ date: '2026-10-27', nowMin: 600, position: null, atStopId: null, doneStopIds: [] })));
    expect(await res.json()).toEqual({ options: [{ id: 'o1', label: 'Push everything back 20 min' }] });
  });
});
