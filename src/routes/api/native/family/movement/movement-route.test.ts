import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  role: 'owner' as 'owner' | 'member',
  viewer: null as null | { kind: 'household'; subject: string | null; wards?: string[] },
  asked: [] as Array<{ subject: string; days: number | undefined }>,
}));

vi.mock('$lib/server/native-handler', () => ({
  withNativeAccess:
    (_area: string, fn: (event: unknown, identity: unknown, role: string) => unknown) => async (event: unknown) => {
      const r = await fn(event, { ownerEmail: 'owner@example.test' }, h.role);
      return r instanceof Response ? r : Response.json(r);
    },
}));
vi.mock('$lib/home/presence/viewer', async (orig) => ({
  ...(await orig<typeof import('$lib/home/presence/viewer')>()),
  peopleViewerOf: async () => h.viewer,
}));
vi.mock('$lib/home/presence/members', () => ({
  listMembers: async () => [{ subject: 'alex', displayName: 'Alex' }, { subject: 'sam', displayName: 'Sam' }, { subject: 'rory', displayName: 'Rory' }],
}));
vi.mock('$lib/home/presence/movement', () => ({
  loadPeopleMovement: async (people: Array<{ subject: string; displayName: string }>, opts: { days?: number }) => {
    h.asked.push({ subject: people[0].subject, days: opts.days });
    return people.map((p) => ({ ...p, stats: { walkingPace: null, commonTrips: [] }, commuting: [{ route: 'secret' }], error: null }));
  },
}));

const route = await import('./+server');

function call(query: string) {
  const url = new URL(`https://strangeramblings.com/api/native/family/movement${query}`);
  return (route.GET as unknown as (e: unknown) => Promise<Response>)({ url, request: new Request(url), locals: {} });
}

beforeEach(() => {
  h.role = 'owner';
  h.viewer = null;
  h.asked = [];
});

describe('GET /api/native/family/movement', () => {
  it('answers the owner about anyone, 30 days by default, with no routes', async () => {
    const res = await call('?subject=sam');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ subject: 'sam', name: 'Sam', days: 30, stats: { walkingPace: null, commonTrips: [] } });
    expect(JSON.stringify(body)).not.toContain('secret');
  });

  it('takes 30 or 90 days and nothing else', async () => {
    await call('?subject=sam&days=90');
    await call('?subject=sam&days=365');
    expect(h.asked.map((a) => a.days)).toEqual([90, 30]);
  });

  it('answers a member about themselves and their wards, 404s anyone else, 403s outsiders', async () => {
    h.role = 'member';
    h.viewer = { kind: 'household', subject: 'alex', wards: ['rory'] };
    expect((await call('?subject=alex')).status).toBe(200);
    expect((await call('?subject=rory')).status).toBe(200);
    expect((await call('?subject=sam')).status).toBe(404);
    expect(h.asked.map((a) => a.subject)).toEqual(['alex', 'rory']);
    h.viewer = null;
    expect((await call('?subject=alex')).status).toBe(403);
  });

  it('is 400 without a subject and 404 for nobody', async () => {
    expect((await call('')).status).toBe(400);
    expect((await call('?subject=ghost')).status).toBe(404);
  });
});
