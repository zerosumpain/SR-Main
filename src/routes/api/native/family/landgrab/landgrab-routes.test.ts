import { beforeEach, describe, expect, it, vi } from 'vitest';

// The two Landgrab routes end to end below the device gate: the family check,
// the parameters, the projection (real), and what the phone sees when Health
// misbehaves. The service lane and the household table are mocked; names,
// emails and coordinates are synthetic because this repository is public.

const h = vi.hoisted(() => ({
  role: 'owner' as 'owner' | 'member',
  viewer: null as null | { kind: 'member'; principalId: string; email: string; grants: Set<string> },
  calls: [] as string[],
  fail: null as null | Error,
}));

vi.mock('$lib/server/native-handler', async (importOriginal) => ({
  // Keep the real clampLimit; the gate calls the handler straight through.
  ...(await importOriginal<typeof import('$lib/server/native-handler')>()),
  withNativeAccess:
    (_area: string, fn: (event: unknown, identity: unknown, role: string) => unknown) => async (event: unknown) => {
      const r = await fn(event, { ownerEmail: 'owner@example.test' }, h.role);
      return r instanceof Response ? r : Response.json(r);
    },
}));

vi.mock('$lib/home/presence/members', () => ({
  listMembers: async () => [
    { subject: 'owner', email: 'owner@example.test', displayName: 'Owner' },
    { subject: 'kid', email: 'kid@example.test', displayName: 'Kid' },
    { subject: 'gran', email: null, displayName: 'Gran' },
  ],
}));

const row = (subject: string, rank: number) => ({ subject, won: 3, taken: 1, lost: 1, net: 2, held: 10, rank, colour: '#336699' });

vi.mock('$lib/server/extracted-app', () => ({
  getFromExtracted: vi.fn(async (_app: string, path: string) => {
    h.calls.push(path);
    if (h.fail) throw h.fail;
    if (path.startsWith('/api/health/landgrab/family/weeks')) {
      return {
        updatedAt: '2026-10-04T08:00:00.000Z',
        weeks: [{ start: '2026-09-28', end: '2026-10-04', current: true, people: [row('kid', 1), row('owner', 2), row('gran', 2)] }],
      };
    }
    return {
      week: { start: '2026-09-28', end: '2026-10-04', current: true },
      bounds: null,
      people: [{ subject: 'kid', colour: '#336699' }],
      hexes: [{ id: 0, polygon: [[40.77, -73.97]], owner: 'kid', previous: 'gran' }],
      changes: [
        { id: 'unattributed:kid', subject: 'kid', at: '2026-10-01T09:00:00.000Z', won: 1, taken: 1, from: [{ subject: 'gran', hexes: 1 }], hexIds: [0], activity: null },
      ],
    };
  }),
}));

const { familyId, familySubjectId } = await import('$lib/family/roster.server');
const weeksRoute = await import('./+server');
const changesRoute = await import('./changes/+server');

type Handler = (e: unknown) => Promise<Response>;
function call(handler: unknown, query = '') {
  const url = new URL(`https://strangeramblings.com/api/native/family/landgrab${query}`);
  const locals = { viewer: h.viewer ? Promise.resolve(h.viewer) : undefined };
  return (handler as Handler)({ request: new Request(url), locals, params: {}, url });
}

function asMember(email: string, grants: string[]) {
  h.role = 'member';
  h.viewer = { kind: 'member', principalId: 'p', email, grants: new Set(grants) };
}

beforeEach(() => {
  h.role = 'owner';
  h.viewer = null;
  h.calls = [];
  h.fail = null;
});

describe('who gets in', () => {
  it('refuses a member with no family grant on both routes, without asking Health', async () => {
    asMember('guest@example.test', ['games:self']);
    for (const [handler, q] of [[weeksRoute.GET, ''], [changesRoute.GET, '?week=2026-09-28']] as const) {
      const res = await call(handler, q);
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: 'Steps and tasks are for the family.' });
    }
    expect(h.calls).toEqual([]);
  });
});

describe('GET /api/native/family/landgrab', () => {
  it('answers a family member, with the steps board ids and the caller marked', async () => {
    asMember('kid@example.test', ['family:circle']);
    const res = await call(weeksRoute.GET);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.updatedAt).toBe('2026-10-04T08:00:00.000Z');
    expect(body.weeks[0].people).toEqual([
      { id: familyId('kid@example.test'), name: 'Kid', me: true, won: 3, taken: 1, lost: 1, net: 2, held: 10, rank: 1, colour: '#336699' },
      { id: familyId('owner@example.test'), name: 'Owner', me: false, won: 3, taken: 1, lost: 1, net: 2, held: 10, rank: 2, colour: '#336699' },
      { id: familySubjectId('gran'), name: 'Gran', me: false, won: 3, taken: 1, lost: 1, net: 2, held: 10, rank: 2, colour: '#336699' },
    ]);
    const text = JSON.stringify(body);
    expect(text).not.toContain('subject');
    expect(text).not.toContain('@');
    expect(text).not.toMatch(/"(kid|owner|gran)"/);
  });

  it('marks the owner’s own row when the owner’s phone asks', async () => {
    const body = await (await call(weeksRoute.GET)).json();
    expect(body.weeks[0].people.filter((p: { me: boolean }) => p.me).map((p: { name: string }) => p.name)).toEqual(['Owner']);
  });

  it('clamps weeks to 1..12, defaulting to 6', async () => {
    for (const [q, n] of [['', 6], ['?weeks=3', 3], ['?weeks=99', 12], ['?weeks=0', 1], ['?weeks=-4', 1], ['?weeks=lots', 6], ['?weeks=', 6]] as const) {
      h.calls = [];
      await call(weeksRoute.GET, q);
      expect(new URL(h.calls[0], 'http://x').searchParams.get('weeks'), q).toBe(String(n));
    }
  });

  it('is a 502 with no stack when Health fails, or has not shipped the endpoint', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const fail of [new Error('health/api/health/landgrab/family/weeks returned 404'), new Error('connect ECONNREFUSED')]) {
      h.fail = fail;
      const res = await call(weeksRoute.GET);
      expect(res.status).toBe(502);
      expect(await res.json()).toEqual({ error: 'landgrab unavailable' });
    }
    errors.mockRestore();
  });
});

describe('GET /api/native/family/landgrab/changes', () => {
  it('answers a family member with every subject replaced by an id', async () => {
    asMember('kid@example.test', ['family:circle']);
    const res = await call(changesRoute.GET, '?week=2026-09-28');
    expect(res.status).toBe(200);
    const body = await res.json();
    const kid = familyId('kid@example.test');
    const gran = familySubjectId('gran');
    expect(body.people).toEqual([{ id: kid, name: 'Kid', colour: '#336699' }]);
    expect(body.hexes).toEqual([{ id: 0, polygon: [[40.77, -73.97]], owner: kid, previous: gran }]);
    expect(body.changes).toEqual([
      { id: `unattributed:${kid}`, personId: kid, at: '2026-10-01T09:00:00.000Z', won: 1, taken: 1, from: [{ id: gran, hexes: 1 }], hexIds: [0], activity: null },
    ]);
    expect(JSON.stringify(body)).not.toMatch(/subject|"kid"|"gran"|:kid|@/);
    expect(h.calls[0]).toBe('/api/health/landgrab/family/changes?week=2026-09-28&subjects=owner%2Ckid%2Cgran');
  });

  it('refuses a missing or malformed week before asking Health', async () => {
    for (const q of ['', '?week=', '?week=last', '?week=2026-13-01', '?week=2026-09-28%26subjects%3Dx']) {
      const res = await call(changesRoute.GET, q);
      expect(res.status, q).toBe(400);
    }
    expect(h.calls).toEqual([]);
  });

  it('passes Health’s 400 through for a week it will not answer (not a Monday, out of range)', async () => {
    h.fail = new Error('health/api/health/landgrab/family/changes?week=2026-09-29 returned 400');
    const res = await call(changesRoute.GET, '?week=2026-09-29');
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Monday/);
  });

  it('is a 502 with no stack for any other Health failure', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const fail of [new Error('… returned 404'), new Error('… returned 500'), new Error('… timed out after 15000ms')]) {
      h.fail = fail;
      const res = await call(changesRoute.GET, '?week=2026-09-28');
      expect(res.status).toBe(502);
      expect(await res.json()).toEqual({ error: 'landgrab unavailable' });
    }
    errors.mockRestore();
  });
});
