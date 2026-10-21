import { beforeEach, describe, expect, it, vi } from 'vitest';

// v8 (S2) routes on the phone lane and the site: the guided start, the
// research pack, quick questions, "from your notes", cancelling a job. The
// device gate, the roster and the work itself are stubs; who may do what is
// what is tested here.
const OWNER = 'owner@example.test';
const TRIP_ID = '11111111-1111-4111-8111-111111111111';
const h = vi.hoisted(() => ({
  who: 'owner@example.test',
  creator: 'owner@example.test',
  started: [] as Array<{ caller: Record<string, unknown>; start: Record<string, unknown>; surface: string }>,
  packs: [] as Array<{ owner: string; action: string; theme: string | null }>,
  answered: [] as Array<{ qid: string; act: unknown; caller: Record<string, unknown> }>,
  notes: [] as Array<{ caller: Record<string, unknown>; surface: string }>,
  rejected: [] as string[],
}));

vi.mock('$lib/server/native-handler', () => ({
  withNativeAccess:
    (_area: string, fn: (event: unknown, identity: unknown, role: string) => unknown) => async (event: unknown) => {
      const r = await fn(event, { ownerEmail: h.who }, h.who === 'owner@example.test' ? 'owner' : 'member');
      return r instanceof Response ? r : Response.json(r);
    },
}));
vi.mock('$lib/family/access.server', () => ({ familyCaller: async () => ({ email: h.who, parent: h.who !== 'kid@example.test' }) }));
vi.mock('$lib/family/roster.server', () => ({
  familyPersonFor: async (email: string, parent: boolean) => ({ id: `f_${email.split('@')[0]}`, email, name: email.split('@')[0], parent, pilot: true }),
  familyRoster: async () => [],
}));
vi.mock('$lib/server/access', () => ({ isOwnerEmail: (e: string) => e === 'owner@example.test', getOwnerEmails: () => ['owner@example.test'] }));
vi.mock('$lib/server/owner', () => ({ isOwnerRequest: async () => false }));
vi.mock('$lib/trips/store.server', () => ({
  getTripById: async (id: string) => (id === TRIP_ID ? { id: TRIP_ID, title: 'Rome', ownerEmail: h.creator, timeZone: 'Europe/Rome', profile: null } : null),
  getTrip: async (_o: string, id: string) => (id === TRIP_ID ? { id: TRIP_ID, title: 'Rome', ownerEmail: h.creator, timeZone: 'Europe/Rome', profile: null } : null),
  createTrip: vi.fn(),
  listAllTrips: async () => [],
  listTrips: async () => [],
}));
vi.mock('$lib/trips/start.server', () => ({
  startTripJob: (caller: Record<string, unknown>, start: Record<string, unknown>, surface: string) => {
    h.started.push({ caller, start, surface });
    return { id: 'job-1', kind: 'start', status: 'running', tripId: null, stages: [{ key: 'brief', label: 'Setting up the trip', state: 'waiting', detail: null }], startedAt: 'x', finishedAt: null, result: null, error: null };
  },
}));
vi.mock('$lib/trips/pack.server', () => ({
  ensurePack: vi.fn(),
  packWire: async (_id: string, q: Record<string, unknown>) => ({ pack: { status: 'ready' }, places: [{ id: 'p', status: 'rejected', q }] }),
  startPackJob: (_t: unknown, owner: string, action: string, opts: { theme: string | null }) => {
    h.packs.push({ owner, action, theme: opts.theme });
    return { job: { id: 'job-p', kind: 'pack', status: 'running' }, joined: false, mine: true };
  },
  buildPack: vi.fn(),
  refreshPack: vi.fn(),
  morePlaces: vi.fn(),
  rejectPackPlace: async (_t: string, id: string, reason: string) => {
    h.rejected.push(`${id}:${reason}`);
    return { id, status: 'rejected', rejectReason: reason };
  },
}));
vi.mock('$lib/trips/questions.server', async () => {
  const real = await vi.importActual<typeof import('$lib/trips/questions.server')>('$lib/trips/questions.server');
  return {
    parseQuestionAction: real.parseQuestionAction,
    answerQuestion: async (_t: unknown, qid: string, act: unknown, caller: Record<string, unknown>) => {
      h.answered.push({ qid, act, caller });
      return qid === 'gone' ? { status: 409, body: { error: 'That question has already been answered.' } } : { status: 200, body: { question: { id: qid }, planVersion: 3, changes: [], diff: {}, undo: null, remember: null } };
    },
  };
});
vi.mock('$lib/trips/notes.server', async () => {
  const real = await vi.importActual<typeof import('$lib/trips/notes.server')>('$lib/trips/notes.server');
  return {
    readNotesQuery: real.readNotesQuery,
    noteFacts: async (caller: Record<string, unknown>, _q: unknown, opts: { surface: string }) => {
      h.notes.push({ caller, surface: opts.surface });
      return [{ id: 'note:stay:1', kind: 'stay', label: 'Airbnb in Parione', detail: null, ops: [], ref: opts.surface === 'phone' ? null : 'm812' }];
    },
  };
});

const create = await import('./+server');
const pack = await import('./[id]/pack/+server');
const question = await import('./[id]/questions/[qid]/+server');
const notes = await import('./notes/+server');
const siteCreate = await import('../../trips/+server');
const sitePack = await import('../../trips/[id]/pack/+server');
const siteNotes = await import('../../trips/notes/+server');

const START = { destination: 'Rome', startDate: '2026-10-26', endDate: '2026-10-30', travellers: [{ name: 'Sam', age: 9 }], pace: 'normal', confirmNotes: [], text: null };
function ev(params: Record<string, string>, body?: unknown, url = 'http://x/api/native/trips') {
  return {
    params,
    url: new URL(url),
    locals: { auth: async () => ({ user: { email: h.who } }) },
    getClientAddress: () => '100.83.68.1',
    request: new Request(url, body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }),
  } as never;
}

beforeEach(() => {
  h.who = OWNER;
  h.creator = OWNER;
  h.started = [];
  h.packs = [];
  h.answered = [];
  h.notes = [];
  h.rejected = [];
});

describe('the guided start', () => {
  it('phone: { start } → 202 { job } for anyone in the family; memory only for the owner', async () => {
    h.who = 'kid@example.test';
    const res = await create.POST(ev({}, { start: START, async: true }));
    expect(res.status).toBe(202);
    expect((await res.json()).job).toMatchObject({ kind: 'start', stages: [{ label: 'Setting up the trip' }] });
    expect(h.started[0]).toMatchObject({ caller: { email: 'kid@example.test', isOwner: false }, surface: 'phone', start: { destination: 'Rome', pace: 'normal' } });
    expect((await create.POST(ev({}, { start: { ...START, destination: '' } }))).status).toBe(400);
  });

  it('site: the owner only', async () => {
    const res = await siteCreate.POST(ev({}, { start: START, async: true }, 'http://x/api/trips'));
    expect(res.status).toBe(202);
    expect(h.started[0]).toMatchObject({ caller: { email: OWNER, isOwner: true }, surface: 'site' });
    h.who = 'kid@example.test';
    await expect(siteCreate.POST(ev({}, { start: START }, 'http://x/api/trips'))).rejects.toMatchObject({ status: 403 });
  });
});

describe('the research pack', () => {
  it('anyone in the family reads it (rejected places included, filters passed)', async () => {
    h.who = 'kid@example.test';
    const res = await pack.GET(ev({ id: TRIP_ID }, undefined, `http://x/api/native/trips/${TRIP_ID}/pack?kind=food&tag=rainy-day`));
    expect(await res.json()).toEqual({ pack: { status: 'ready' }, places: [{ id: 'p', status: 'rejected', q: { kind: 'food', tag: 'rainy-day' } }] });
  });

  it('building, more and turning down: the creator or a parent; a member is refused', async () => {
    h.who = 'kid@example.test';
    expect((await pack.POST(ev({ id: TRIP_ID }, { action: 'build', async: true }))).status).toBe(403);
    h.who = 'parent@example.test';
    expect((await pack.POST(ev({ id: TRIP_ID }, { action: 'more', theme: 'for the kids', async: true }))).status).toBe(202);
    expect(h.packs).toEqual([{ owner: 'parent@example.test', action: 'more', theme: 'for the kids' }]);
    const id = 'c0ffee00-0000-4000-8000-000000000401';
    const rej = await pack.POST(ev({ id: TRIP_ID }, { action: 'reject', placeId: id, reason: 'too-busy' }));
    expect(await rej.json()).toEqual({ place: { id, status: 'rejected', rejectReason: 'too-busy' } });
    expect((await pack.POST(ev({ id: TRIP_ID }, { action: 'reject', placeId: id, reason: 'meh' }))).status).toBe(400);
    h.who = OWNER;
    const site = await sitePack.POST(ev({ id: TRIP_ID }, { action: 'reject', placeId: id, reason: 'not-for-us' }, `http://x/api/trips/${TRIP_ID}/pack`));
    expect(site.status).toBe(200);
    expect(h.rejected).toEqual([`${id}:too-busy`, `${id}:not-for-us`]);
  });
});

describe('quick questions', () => {
  it('passes the caller’s access through; 409 once answered; a bad body is a 400', async () => {
    h.who = 'kid@example.test';
    const res = await question.POST(ev({ id: TRIP_ID, qid: 'q1' }, { action: 'vote', answerId: 'a1' }));
    expect(res.status).toBe(200);
    expect(h.answered[0]).toMatchObject({ qid: 'q1', act: { action: 'vote', answerId: 'a1' }, caller: { email: 'kid@example.test', name: 'kid', isOwner: false, access: { role: 'member' }, surface: 'phone' } });
    expect((await question.POST(ev({ id: TRIP_ID, qid: 'gone' }, { action: 'decide' }))).status).toBe(409);
    expect((await question.POST(ev({ id: TRIP_ID, qid: 'q1' }, { action: 'shout' }))).status).toBe(400);
    h.who = OWNER;
    await question.POST(ev({ id: TRIP_ID, qid: 'q1' }, { action: 'answer', answerId: 'a0' }));
    expect(h.answered.at(-1)!.caller).toMatchObject({ isOwner: true, access: { role: 'creator' } });
  });
});

describe('from your notes', () => {
  const q = '?destination=Rome&startDate=2026-10-26&endDate=2026-10-30';
  it('the owner’s phone gets facts with no memory reference; anyone else gets []', async () => {
    const own = await notes.GET(ev({}, undefined, `http://x/api/native/trips/notes${q}`));
    expect(await own.json()).toEqual({ notes: [expect.objectContaining({ label: 'Airbnb in Parione', ref: null })] });
    expect(h.notes[0]).toMatchObject({ surface: 'phone', caller: { email: OWNER, isOwner: true } });
    h.who = 'parent@example.test';
    expect(await (await notes.GET(ev({}, undefined, `http://x/api/native/trips/notes${q}`))).json()).toEqual({ notes: [] });
    expect(h.notes).toHaveLength(1);
  });

  it('the site: the owner, with the memory reference; a bad query is []', async () => {
    expect(await (await siteNotes.GET(ev({}, undefined, `http://x/api/trips/notes${q}`))).json()).toEqual({ notes: [expect.objectContaining({ ref: 'm812' })] });
    expect(await (await siteNotes.GET(ev({}, undefined, 'http://x/api/trips/notes?destination=Rome'))).json()).toEqual({ notes: [] });
  });
});
