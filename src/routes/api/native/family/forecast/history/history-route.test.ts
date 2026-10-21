import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  role: 'owner' as 'owner' | 'member',
  viewer: null as null | { kind: 'household'; subject: string | null; wards?: string[] },
  asked: [] as Array<{ viewer: unknown; days: number; person: string | null }>,
}));

vi.mock('$lib/server/native-handler', () => ({
  withNativeAccess:
    (_area: string, fn: (event: unknown, identity: unknown, role: string) => unknown) => async (event: unknown) => {
      const r = await fn(event, { ownerEmail: 'owner@example.test' }, h.role);
      return r instanceof Response ? r : Response.json(r);
    },
}));
vi.mock('$lib/home/presence/viewer', () => ({ peopleViewerOf: async () => h.viewer }));
vi.mock('$lib/home/presence/forecast.server', () => ({
  // The real loader scopes people by viewer; this one does the same by hand.
  loadForecast: async (viewer: { kind: string; subject?: string }, days: number, person: string | null) => {
    h.asked.push({ viewer, days, person });
    const all = ['alex', 'sam'];
    const mine = viewer.kind === 'owner' ? all : all.filter((s) => s === viewer.subject);
    const people = mine.filter((s) => !person || s === person).map((s) => ({ subject: s, displayName: s.toUpperCase() }));
    return { insights: { generatedAt: '', days, people, routes: [], arrivals: [], live: [], groups: [], together: 0, daily: [] } };
  },
}));

const route = await import('./+server');

function call(query: string) {
  const url = new URL(`https://strangeramblings.com/api/native/family/forecast/history${query}`);
  return (route.GET as unknown as (e: unknown) => Promise<Response>)({ url, request: new Request(url), locals: {} });
}

beforeEach(() => {
  h.role = 'owner';
  h.viewer = null;
  h.asked = [];
});

describe('GET /api/native/family/forecast/history', () => {
  it('answers the owner about anyone, 90 days by default', async () => {
    const res = await call('?subject=sam');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ subject: 'sam', name: 'SAM', days: 90, trips: [], pattern: expect.any(Array) });
    expect(h.asked[0]).toMatchObject({ days: 90, person: 'sam' });
  });

  it('takes 7, 28 or 90 days and nothing else', async () => {
    await call('?subject=sam&days=7');
    await call('?subject=sam&days=365');
    expect(h.asked.map((a) => a.days)).toEqual([7, 90]);
  });

  it('answers a member about themselves, 404s anybody else, and 403s outsiders', async () => {
    h.role = 'member';
    h.viewer = { kind: 'household', subject: 'alex', wards: [] };
    expect((await call('?subject=alex')).status).toBe(200);
    expect((await call('?subject=sam')).status).toBe(404);
    h.viewer = null;
    expect((await call('?subject=alex')).status).toBe(403);
  });

  it('is 400 without a subject', async () => {
    expect((await call('')).status).toBe(400);
  });
});
