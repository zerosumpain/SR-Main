import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NoteFact } from './decisions';
import type { JobStage } from './decisions';
import { linkBookings, noteOpsInTwo, parseTripStart, START_STAGES, startDetail, startTravellers } from './start';

// The guided start: one staged job. The store, the planner path and the
// research/shapes/questions steps are stubs; the stages, the order, what is
// kept and the cancel are real.
const h = vi.hoisted(() => ({
  trips: new Map<string, Record<string, unknown>>(),
  applied: [] as Array<{ ops: unknown[]; eventText: string }>,
  provenance: {} as Record<string, unknown>,
  profiles: [] as unknown[],
  wishes: [] as Array<{ id: string; title: string }>,
  stays: [] as Array<{ id: string; name: string }>,
  bookings: [] as Array<{ id: string; title: string }>,
  transport: [] as Array<{ id: string; number: string | null; departDate: string }>,
  replans: 0,
  plan: null as null | { version: number },
  notes: [] as NoteFact[],
  gathered: 0,
}));

vi.mock('./store.server', () => ({
  createTrip: async (owner: string, input: Record<string, unknown>) => {
    const t = { id: 'trip-new', ownerEmail: owner, status: 'draft', research: null, guide: null, profile: null, updatedAt: 'x', ...input };
    h.trips.set('trip-new', t);
    return t;
  },
  getTripById: async (id: string) => h.trips.get(id) ?? null,
  latestPlan: async () => h.plan,
  loadState: async () => ({ stays: [...h.stays], wishes: [...h.wishes], bookings: [...h.bookings] }),
  listTransport: async () => [...h.transport],
}));
vi.mock('./decisions.store.server', () => ({ noteProvenance: async (_t: string, e: Record<string, unknown>) => void Object.assign(h.provenance, e) }));
vi.mock('./converse.server', () => ({
  applyAndReplan: async (_t: unknown, ops: Array<Record<string, any>>, opts: { eventText: string }) => {
    h.applied.push({ ops, eventText: opts.eventText });
    for (const o of ops) {
      if (o.op === 'addTransport') h.transport.push({ id: `tr-${h.transport.length}`, number: o.segment.number, departDate: o.segment.departDate });
      if (o.op === 'addStay') h.stays.push({ id: `st-${h.stays.length}`, name: o.name });
      if (o.op === 'addWish') h.wishes.push({ id: `w-${h.wishes.length}`, title: o.wish.title });
      if (o.op === 'addBooking') h.bookings.push({ id: `b-${h.bookings.length}`, title: o.booking.title });
    }
    h.plan = { version: (h.plan?.version ?? 0) + 1 };
    return { applied: ops, rejected: [], planVersion: h.plan.version };
  },
}));
vi.mock('./plan.server', () => ({ replan: async () => { h.replans++; h.plan = { version: 1 }; return { plan: h.plan, created: true }; } }));
vi.mock('./profile.server', () => ({
  gatherProfile: async () => {
    h.gathered++;
    return { travellers: [{ name: 'You', relation: 'the owner', notes: [] }], preferences: [{ text: 'Long lunches', source: 'memory', ref: 'm1' }], constraints: [], history: [], gatheredAt: 'x' };
  },
  saveProfile: async (_id: string, p: unknown) => void h.profiles.push(p),
}));
vi.mock('./notes.server', () => ({ confirmedNotes: async (_c: unknown, _q: unknown, ids: string[]) => h.notes.filter((n) => ids.includes(n.id)) }));
vi.mock('./pack.server', () => ({ buildPack: vi.fn(), geocode: vi.fn() }));
vi.mock('./shapes.server', () => ({ requestShapes: vi.fn() }));
vi.mock('./questions.server', () => ({ refreshQuestions: vi.fn() }));

const { runStart, startTripJob } = await import('./start.server');
const { readJob, clearJobsForTest } = await import('./jobs.server');
type Steps = import('./start.server').StartSteps;

const START = { destination: 'Rome', startDate: '2026-10-26', endDate: '2026-10-30', travellers: [{ name: 'John', age: null, personId: 'f_john' }, { name: 'Sam', age: 9, personId: null }], pace: 'normal' as const, confirmNotes: ['note:transport:abc', 'note:booking:def'], text: 'We love food markets' };
const NOTES: NoteFact[] = [
  { id: 'note:transport:abc', kind: 'transport', label: 'Flight LS1235 NCL 07:35 → FCO', detail: null, ops: [{ op: 'addTransport', segment: { number: 'LS1235', departDate: '2026-10-26' } } as never], ref: 'm790' },
  { id: 'note:booking:def', kind: 'booking', label: 'Vatican tour, Wed 28 Oct 08:15', detail: null, ops: [{ op: 'addWish', wish: { title: 'Vatican tour' } } as never, { op: 'addBooking', booking: { title: 'Vatican tour', wishId: null, status: 'booked' } } as never], ref: 'm900' },
  { id: 'note:stay:zzz', kind: 'stay', label: 'Not confirmed', detail: null, ops: [{ op: 'addStay', name: 'Hotel' } as never], ref: null },
];

function steps(over: Partial<Steps> = {}): Steps & { order: string[] } {
  const order: string[] = [];
  return {
    order,
    zoneOf: async () => 'Europe/Rome',
    roster: async () => [{ id: 'f_john', name: 'John' }, { id: 'f_sam', name: 'Sam' }],
    pack: async (_t, handle) => {
      order.push('pack');
      for (const s of START_STAGES.slice(1, 6)) {
        handle.stage(s.key, 'running');
        handle.stage(s.key, 'done', s.key === 'places' ? 'Found 38 places' : null);
      }
    },
    shapes: async () => {
      order.push('shapes');
      return [{}, {}, {}];
    },
    questions: async () => {
      order.push('questions');
      return [{}, {}];
    },
    ...over,
  };
}

function handle(cancelAt: string | null = null) {
  const stages: Record<string, string> = {};
  let kept: Record<string, unknown> = {};
  const details: Record<string, string | null> = {};
  return {
    stages,
    details,
    get kept() {
      return kept;
    },
    keep: (p: Record<string, unknown>) => void (kept = { ...kept, ...p }),
    stage: (key: string, state: string, detail?: string | null) => {
      stages[key] = state;
      if (detail !== undefined) details[key] = detail ?? null;
    },
    cancelled: async () => !!cancelAt && stages[cancelAt] === 'done',
  };
}

beforeEach(() => {
  h.trips.clear();
  h.applied = [];
  h.provenance = {};
  h.profiles = [];
  h.wishes = [];
  h.stays = [];
  h.bookings = [];
  h.transport = [];
  h.replans = 0;
  h.plan = null;
  h.notes = NOTES;
  h.gathered = 0;
  clearJobsForTest();
});

describe('parsing the start', () => {
  it('reads the fields, leniently, and refuses what is not a trip', () => {
    expect(parseTripStart({ ...START, travellers: [...START.travellers, { name: '' }, { name: 'Robin', age: 'x' }], pace: 'zippy', confirmNotes: ['note:stay:1', 'drop table'] })).toEqual({
      ok: true,
      value: { ...START, travellers: [...START.travellers, { name: 'Robin', age: null, personId: null }], pace: 'normal', confirmNotes: ['note:stay:1'] },
    });
    expect(parseTripStart({ ...START, destination: ' ' })).toEqual({ ok: false, error: 'Where are you going?' });
    expect(parseTripStart({ ...START, endDate: '2026-10-01' }).ok).toBe(false);
    expect(parseTripStart({ ...START, endDate: '2026-12-30' }).ok).toBe(false);
    expect(startDetail(START)).toBe('Rome, 26–30 Oct, 2 travellers');
    expect(startTravellers(START, [{ id: 'f_john', name: 'John' }, { id: 'f_sam', name: 'Sam' }])).toEqual([
      { name: 'John', relation: 'family', notes: [], age: null, personId: 'f_john' },
      { name: 'Sam', relation: 'family', notes: [], age: 9, personId: 'f_sam' },
    ]);
  });

  it('a note’s booking is tied to the wish the note made', () => {
    const { first, bookings } = noteOpsInTwo(NOTES.slice(0, 2));
    expect(first.map((o) => o.op)).toEqual(['addTransport', 'addWish']);
    expect(linkBookings(bookings, [{ id: 'w-9', title: 'Vatican Tour' }])).toEqual([{ op: 'addBooking', booking: { title: 'Vatican tour', wishId: 'w-9', status: 'booked' } }]);
  });
});

describe('runStart', () => {
  it('sets the trip up, keeps its id at once, then research, shapes and questions in order', async () => {
    const s = steps();
    const hd = handle();
    const out = await runStart({ email: 'owner@example.test', name: 'John', isOwner: true }, START, 'phone', hd, s);
    expect(out).toEqual({ id: 'trip-new' });
    expect(hd.kept).toEqual({ id: 'trip-new' });
    expect(s.order).toEqual(['pack', 'shapes', 'questions']);
    expect(Object.values(hd.stages).every((x) => x === 'done')).toBe(true);
    expect(hd.details).toMatchObject({ brief: 'Rome, 26–30 Oct, 2 travellers', places: 'Found 38 places', shapes: '3 ways to do it', questions: '2 quick questions' });
    const trip = h.trips.get('trip-new')!;
    expect(trip).toMatchObject({ destination: 'Rome', title: 'Rome', timeZone: 'Europe/Rome', startDate: '2026-10-26', endDate: '2026-10-30', pace: 'normal', notes: 'We love food markets' });
    // The owner's profile from memory, with the travellers chosen (roster ids kept).
    expect(h.gathered).toBe(1);
    expect(h.profiles.at(-1)).toMatchObject({ travellers: [{ name: 'John', personId: 'f_john' }, { name: 'Sam', age: 9, personId: 'f_sam' }], preferences: [{ text: 'Long lunches' }] });
    // Only the confirmed notes, bookings tied to their wish, with provenance 'notes'.
    expect(h.applied.map((a) => a.ops.map((o) => (o as { op: string }).op))).toEqual([['addTransport', 'addWish'], ['addBooking']]);
    expect((h.applied[1].ops[0] as { booking: { wishId: string } }).booking.wishId).toBe('w-0');
    expect(h.applied[0].eventText).toBe('From your notes: Flight LS1235 NCL 07:35 → FCO; Vatican tour, Wed 28 Oct 08:15.');
    expect(h.provenance).toMatchObject({
      destination: { source: 'you', note: null },
      dates: { source: 'you' },
      pace: { source: 'you' },
      travellers: { source: 'you' },
      'transport:tr-0': { source: 'notes', ref: 'm790', note: 'Flight LS1235 NCL 07:35 → FCO' },
      'wish:w-0': { source: 'notes', ref: 'm900' },
      'booking:b-0': { source: 'notes', ref: 'm900' },
    });
    expect(h.stays).toEqual([]);
  });

  it('someone in the family: no memory read, no notes applied; the time zone assumed when not found', async () => {
    const hd = handle();
    await runStart({ email: 'kid@example.test', name: 'Sam', isOwner: false }, START, 'phone', hd, steps({ zoneOf: async () => null }));
    expect(h.gathered).toBe(0);
    expect(h.applied).toEqual([]);
    expect(h.replans).toBe(1);
    expect(h.trips.get('trip-new')).toMatchObject({ ownerEmail: 'kid@example.test', timeZone: 'Europe/London' });
    expect(h.provenance.destination).toMatchObject({ note: 'Time zone not found — assumed Europe/London' });
    expect(h.profiles.at(-1)).toMatchObject({ travellers: [{ name: 'John' }, { name: 'Sam' }], preferences: [] });
  });

  it('research that fails does not fail the start', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const hd = handle();
    const s = steps({
      pack: async (_t, h2) => {
        h2.stage('places', 'running');
        h2.stage('places', 'done');
        h2.stage('food', 'running');
        throw new Error('overpass down');
      },
    });
    expect(await runStart({ email: 'owner@example.test', name: null, isOwner: true }, { ...START, confirmNotes: [] }, 'site', hd, s)).toEqual({ id: 'trip-new' });
    expect(hd.stages).toMatchObject({ places: 'done', food: 'failed', hours: 'skipped', writing: 'skipped', shapes: 'done', questions: 'done' });
  });

  it('as a job: the declared stages, the trip id as soon as it exists, and a cancel between stages keeps the trip', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const s = steps({ pack: async (_t, h2) => { h2.stage('places', 'running'); await gate; h2.stage('places', 'done'); } });
    const job = startTripJob({ email: 'owner@example.test', name: 'John', isOwner: true }, START, 'phone', s);
    expect(job.stages.map((x: JobStage) => x.label)).toEqual(['Setting up the trip', 'Finding places', 'Finding places to eat', 'Checking opening hours on your dates', 'Looking for closures and events', 'Writing it up', 'Drafting ways to do it', 'A few quick questions']);
    await vi.waitFor(() => expect(readJob('owner@example.test', job.id)?.tripId).toBe('trip-new'));
    const { cancelJob } = await import('./jobs.server');
    await cancelJob('owner@example.test', job.id);
    release();
    await vi.waitFor(() => expect(readJob('owner@example.test', job.id)?.status).toBe('cancelled'));
    const done = readJob('owner@example.test', job.id)!;
    expect(done.result).toEqual({ id: 'trip-new' });
    expect(s.order).toEqual([]);
    expect(done.stages.find((x) => x.key === 'brief')?.state).toBe('done');
    expect(done.stages.find((x) => x.key === 'shapes')?.state).toBe('skipped');
  });
});
