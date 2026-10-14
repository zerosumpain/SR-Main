import { beforeEach, describe, expect, it, vi } from 'vitest';

// The phone lane, v5: open to the family, gated per trip. The device gate,
// the family roster, the store, the planner and pushes are stubs; the access
// rules (`tripAccess`) and the suggestion flow (`family.server`) are real.
const OWNER = 'owner@example.test';
const PARENT = 'parent@example.test';
const KID = 'kid@example.test';
const TRIP_ID = '11111111-1111-4111-8111-111111111111';
const SID = '22222222-2222-4222-8222-222222222222';

const h = vi.hoisted(() => ({
  who: 'owner@example.test' as string,
  family: true,
  creator: 'owner@example.test',
  pushes: [] as Array<{ to: string[]; body: string }>,
  applied: [] as unknown[],
  conversed: [] as unknown[],
  created: [] as string[],
  suggestions: new Map<string, Record<string, unknown>>(),
  events: [] as string[],
  logged: [] as string[],
}));

vi.mock('$lib/server/native-handler', () => ({
  withNativeAccess:
    (_area: string, fn: (event: unknown, identity: unknown, role: string) => unknown) => async (event: unknown) => {
      const r = await fn(event, { ownerEmail: h.who }, h.who === 'owner@example.test' ? 'owner' : 'member');
      return r instanceof Response ? r : Response.json(r);
    },
}));
vi.mock('$lib/family/access.server', () => ({
  familyCaller: async () => (h.family ? { email: h.who, parent: h.who !== 'kid@example.test' } : null),
}));
vi.mock('$lib/family/roster.server', () => ({
  familyPersonFor: async (email: string, parent: boolean) => ({ id: `f_${email.split('@')[0]}`, email, name: email.split('@')[0], parent, pilot: true }),
  familyRoster: async () => [
    { id: 'f_owner', email: 'owner@example.test', name: 'owner', parent: true },
    { id: 'f_parent', email: 'parent@example.test', name: 'parent', parent: true },
    { id: 'f_kid', email: 'kid@example.test', name: 'kid', parent: false },
  ],
}));
vi.mock('$lib/server/access', () => ({ isOwnerEmail: (e: string) => e === 'owner@example.test', getOwnerEmails: () => ['owner@example.test'] }));
vi.mock('$lib/server/push-devices', () => ({
  pushToEmails: async (to: string[], m: { body: string }) => {
    h.pushes.push({ to: [...to].sort(), body: m.body });
    return { sent: to.length };
  },
}));

const PLAN = {
  days: [
    {
      date: '2026-10-28', stayId: 's', warnings: [],
      stops: [
        { id: 'stay:2026-10-28:start', kind: 'stay', wishId: null, title: 'Flat', location: { lat: 41.895, lng: 12.4716 }, arriveMin: 540, departMin: 540, waitSec: 0, locked: true, bookingId: null, warnings: [] },
        { id: 'pantheon', kind: 'wish', wishId: 'pantheon', title: 'Pantheon', location: { lat: 41.8986, lng: 12.4769 }, arriveMin: 560, departMin: 605, waitSec: 0, locked: false, bookingId: null, warnings: [] },
      ],
      legs: [],
    },
  ],
  dropped: [], warnings: [], score: 0,
};
vi.mock('$lib/trips/store.server', () => ({
  listAllTrips: async () => [{ id: TRIP_ID, title: 'Rome' }],
  getTripById: async (id: string) => (id === TRIP_ID ? { id: TRIP_ID, title: 'Rome', ownerEmail: h.creator, timeZone: 'Europe/Rome', profile: null } : null),
  createTrip: async (owner: string) => {
    h.created.push(owner);
    return { id: 'new-trip', ownerEmail: owner };
  },
  latestPlan: async () => ({ plan: PLAN }),
  addSuggestion: async (_t: string, s: Record<string, unknown>) => {
    const row = { id: SID, tripId: TRIP_ID, status: 'pending', decidedById: null, decidedAt: null, createdAt: 'now', ...s };
    h.suggestions.set(SID, row);
    return row;
  },
  getSuggestion: async (_t: string, id: string) => h.suggestions.get(id) ?? null,
  decideSuggestion: async (_t: string, id: string, status: string) => {
    const s = h.suggestions.get(id);
    if (!s || s.status !== 'pending') return null;
    s.status = status;
    return s;
  },
  suggestionWire: (s: Record<string, unknown>) => {
    const { byEmail: _e, ...rest } = s;
    return rest;
  },
}));
vi.mock('$lib/trips/plan.server', async () => {
  const { bundleEtag } = await import('$lib/trips/bundle');
  return {
    tripBundle: async (_trip: unknown, opts: { access: unknown; viewerEmail: string; creator: { id: string; name: string } }) => {
      const body = { trip: { id: TRIP_ID, createdById: opts.creator.id, createdByName: opts.creator.name }, access: opts.access, viewer: opts.viewerEmail, profile: { travellers: [] } };
      return { ...body, etag: bundleEtag(body as never) };
    },
    applyEvents: async (_trip: unknown, events: Array<{ clientId: string }>) => {
      h.events.push(...events.map((e) => e.clientId));
      return { accepted: events.map((e) => e.clientId), planVersion: 7 };
    },
    replanOptions: async () => [{ id: 'o1' }],
    tripReplan: async () => ({ tripOptions: [], narrative: 'n', quickReplies: [] }),
  };
});
vi.mock('$lib/trips/converse.server', () => ({
  converse: async (_trip: unknown, input: unknown) => {
    h.conversed.push(input);
    return { reply: 'ok', applied: [], rejected: [], quickReplies: [], planVersion: 1, changes: [], messages: [] };
  },
  logEdit: async (_t: string, text: string) => void h.logged.push(text),
  applyAndReplan: async (_trip: unknown, ops: unknown[]) => {
    h.applied.push(...ops);
    return { applied: ops, rejected: [], planVersion: 8 };
  },
}));
vi.mock('$lib/trips/ideas.server', () => ({ findIdeas: async (_t: unknown, ask: unknown, surface: string, deps: unknown) => ({ ask, surface, deps }) }));
vi.mock('$lib/trips/routing.server', () => ({ routeFor: async (_t: string, mode: string) => ({ line: [], durationSec: mode === 'taxi' ? 900 : 600, distanceM: 800, estimated: true }) }));
vi.mock('$lib/trips/guidance.server', () => ({ readGuidance: async () => ({}) }));

const list = await import('./+server');
const one = await import('./[id]/+server');
const events = await import('./[id]/events/+server');
const replan = await import('./[id]/replan/+server');
const talk = await import('./[id]/converse/+server');
const ideas = await import('./[id]/ideas/+server');
const route = await import('./[id]/route/+server');
const suggestions = await import('./[id]/suggestions/+server');
const decide = await import('./[id]/suggestions/[sid]/+server');

function ev(params: Record<string, string> = {}, init: RequestInit = {}, query = '') {
  return { params, locals: {}, request: new Request(`http://x/api/native/trips${query}`, init), url: new URL(`http://x/api/native/trips${query}`) } as never;
}
const post = (body: unknown) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const as = (who: string) => (h.who = who);
const suggestion = { date: '2026-10-28', stage: 'afternoon', wish: { title: 'Gelato at Giolitti', placeQuery: 'Giolitti, Rome', durationMin: 20 }, note: 'Please!' };

beforeEach(() => {
  h.who = OWNER;
  h.family = true;
  h.creator = OWNER;
  h.pushes = [];
  h.applied = [];
  h.conversed = [];
  h.created = [];
  h.suggestions = new Map();
  h.events = [];
  h.logged = [];
});

describe('outside the family', () => {
  it.each([
    ['list', () => list.GET(ev())],
    ['bundle', () => one.GET(ev({ id: TRIP_ID }))],
    ['events', () => events.POST(ev({ id: TRIP_ID }, post({ events: [], basePlanVersion: 0 })))],
    ['replan', () => replan.POST(ev({ id: TRIP_ID }, post({ date: '2026-10-28', nowMin: 600, doneStopIds: [] })))],
    ['converse', () => talk.POST(ev({ id: TRIP_ID }, post({ text: 'hi' })))],
    ['ideas', () => ideas.POST(ev({ id: TRIP_ID }, post({ date: '2026-10-28', stage: 'afternoon' })))],
    ['route', () => route.GET(ev({ id: TRIP_ID }, {}, '?from=a&to=b&mode=walk&date=2026-10-28'))],
    ['suggest', () => suggestions.POST(ev({ id: TRIP_ID }, post(suggestion)))],
  ])('refuses %s with 403', async (_n, call) => {
    as('stranger@example.test');
    h.family = false;
    expect((await call()).status).toBe(403);
  });
});

describe('the family', () => {
  it('a member lists and opens trips, with member access', async () => {
    as(KID);
    expect(await (await list.GET(ev())).json()).toEqual({ trips: [{ id: TRIP_ID, title: 'Rome' }] });
    const b = await (await one.GET(ev({ id: TRIP_ID }))).json();
    expect(b.access).toEqual({ canEdit: false, canApprove: false, canSuggest: true, role: 'member' });
    // The creator by family id and name; the bundle is built for this caller's thread.
    expect(b.trip).toEqual({ id: TRIP_ID, createdById: 'f_owner', createdByName: 'owner' });
    expect(b.viewer).toBe(KID);
    as(PARENT);
    expect((await (await one.GET(ev({ id: TRIP_ID }))).json()).access).toEqual({ canEdit: true, canApprove: true, canSuggest: true, role: 'parent' });
  });

  it('a member creates a trip and becomes its creator', async () => {
    as(KID);
    const res = await list.POST(ev({}, post({ text: 'Legoland in May!' })));
    expect(res.status).toBe(201);
    expect(h.created).toEqual([KID]);
    expect(h.conversed[0]).toMatchObject({ caller: { isOwner: false, canEdit: true, email: KID } });
  });

  it('a member reports arrivals but cannot apply an option, skip or add a stop', async () => {
    as(KID);
    const ok = await events.POST(ev({ id: TRIP_ID }, post({ basePlanVersion: 1, events: [{ clientId: 'a', kind: 'arrived', stopId: 's', at: '2026-10-28T09:00:00Z' }] })));
    expect(ok.status).toBe(200);
    const no = await events.POST(ev({ id: TRIP_ID }, post({ basePlanVersion: 1, events: [{ clientId: 'b', kind: 'skipped', stopId: 's', wishId: 'w', at: '2026-10-28T09:00:00Z' }] })));
    expect(no.status).toBe(403);
    expect(h.events).toEqual(['a']);
  });

  it('a member’s conversation is advice only, without the owner’s memory', async () => {
    as(KID);
    await talk.POST(ev({ id: TRIP_ID }, post({ text: 'Can we add gelato?' })));
    expect(h.conversed[0]).toMatchObject({ caller: { isOwner: false, canEdit: false, email: KID } });
    await ideas.POST(ev({ id: TRIP_ID }, post({ date: '2026-10-28', stage: 'afternoon' })));
    as(OWNER);
    await talk.POST(ev({ id: TRIP_ID }, post({ text: 'Add gelato' })));
    expect(h.conversed[1]).toMatchObject({ caller: { isOwner: true, canEdit: true } });
  });
});

describe('suggestions', () => {
  it('a member suggests, the parents are pushed, never with an email on the wire', async () => {
    as(KID);
    const res = await suggestions.POST(ev({ id: TRIP_ID }, post(suggestion)));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.suggestion).toMatchObject({ byId: 'f_kid', byName: 'kid', status: 'pending', stage: 'afternoon' });
    expect(JSON.stringify(body)).not.toContain('@');
    expect(h.pushes).toEqual([{ to: [OWNER, PARENT], body: 'kid suggested Gelato at Giolitti for Wed 28 Oct afternoon' }]);
  });

  it('a member cannot approve; a parent approves → the wish goes in through the ops path, pinned; the suggester is pushed', async () => {
    as(KID);
    await suggestions.POST(ev({ id: TRIP_ID }, post(suggestion)));
    expect((await decide.POST(ev({ id: TRIP_ID, sid: SID }, post({ action: 'approve' })))).status).toBe(403);
    as(PARENT);
    h.pushes = [];
    const res = await decide.POST(ev({ id: TRIP_ID, sid: SID }, post({ action: 'approve' })));
    expect(await res.json()).toEqual({ suggestionId: SID, status: 'approved', planVersion: 8 });
    expect(h.applied).toEqual([{ op: 'addWish', wish: expect.objectContaining({ title: 'Gelato at Giolitti', fixedDate: '2026-10-28', partOfDay: 'afternoon' }) }]);
    expect(h.pushes).toEqual([{ to: [KID], body: 'parent approved your Gelato at Giolitti for Wed 28 Oct afternoon' }]);
    expect((await decide.POST(ev({ id: TRIP_ID, sid: SID }, post({ action: 'reject' })))).status).toBe(409);
  });

  it('a rejection is a plan-history event, not the parent’s chat', async () => {
    as(KID);
    await suggestions.POST(ev({ id: TRIP_ID }, post(suggestion)));
    as(PARENT);
    expect(await (await decide.POST(ev({ id: TRIP_ID, sid: SID }, post({ action: 'reject' })))).json()).toMatchObject({ status: 'rejected' });
    expect(h.logged).toEqual(["parent turned down kid's suggestion: Gelato at Giolitti for Wed 28 Oct afternoon."]);
    expect(h.applied).toEqual([]);
  });

  it('only the suggester withdraws, while it is pending', async () => {
    as(KID);
    await suggestions.POST(ev({ id: TRIP_ID }, post(suggestion)));
    as(PARENT);
    expect((await decide.POST(ev({ id: TRIP_ID, sid: SID }, post({ action: 'withdraw' })))).status).toBe(403);
    as(KID);
    expect(await (await decide.POST(ev({ id: TRIP_ID, sid: SID }, post({ action: 'withdraw' })))).json()).toEqual({ suggestionId: SID, status: 'withdrawn' });
    expect((await decide.POST(ev({ id: TRIP_ID, sid: SID }, post({ action: 'nope' })))).status).toBe(400);
  });

  it('400s a suggestion without a wish title or a bad stage', async () => {
    as(KID);
    expect((await suggestions.POST(ev({ id: TRIP_ID }, post({ ...suggestion, wish: {} })))).status).toBe(400);
    expect((await suggestions.POST(ev({ id: TRIP_ID }, post({ ...suggestion, stage: 'brunch' })))).status).toBe(400);
  });
});

describe('route for any mode', () => {
  it('answers any family member, and checks the query', async () => {
    as(KID);
    const r = await route.GET(ev({ id: TRIP_ID }, {}, '?from=stay:2026-10-28:start&to=pantheon&mode=taxi&date=2026-10-28'));
    expect(await r.json()).toEqual({ line: [], durationSec: 900, distanceM: 800, estimated: true, guidance: null });
    expect((await route.GET(ev({ id: TRIP_ID }, {}, '?from=a&to=b&mode=teleport&date=2026-10-28'))).status).toBe(400);
    expect((await route.GET(ev({ id: TRIP_ID }, {}, '?from=nope&to=pantheon&mode=walk&date=2026-10-28'))).status).toBe(404);
  });
});

describe('the bundle', () => {
  it('carries an ETag and answers 304', async () => {
    const first = await one.GET(ev({ id: TRIP_ID }));
    const tag = first.headers.get('etag')!;
    expect((await one.GET(ev({ id: TRIP_ID }, { headers: { 'if-none-match': tag } }))).status).toBe(304);
    // Access differs per caller, so the tag does too.
    as(KID);
    expect((await one.GET(ev({ id: TRIP_ID }))).headers.get('etag')).not.toBe(tag);
  });
});
