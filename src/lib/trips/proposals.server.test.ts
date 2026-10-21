import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PackPlace, Proposal } from './decisions';
import type { Booking, Stay, Trip, Wish } from './model';

// Proposals with the stores in memory and the real solver and dry run: a
// small Rome trip (one stay, two must-sees over two days), a research pack of
// five real places, the planner's lookups and the re-plan stubbed.
const h = vi.hoisted(() => ({
  proposals: [] as Array<Record<string, any>>,
  pack: [] as Array<Record<string, any>>,
  lookups: [] as string[],
  applied: [] as Array<{ ops: unknown[]; opts: unknown }>,
  wishUpdates: [] as Array<{ id: string; patch: unknown }>,
  packUpdates: [] as Array<{ id: string; patch: Record<string, unknown> }>,
  checks: [] as unknown[],
  logged: [] as string[],
  superseded: [] as unknown[],
  expired: [] as unknown[],
  jobs: [] as Array<{ kind: string; work: () => Promise<unknown> }>,
  ideas: null as unknown,
  latestVersion: 4,
  wishes: [] as Wish[],
  bookings: [] as Booking[],
  questions: 0,
}));

vi.mock('./decisions.store.server', () => ({
  addProposals: async (_t: string, list: Array<Record<string, unknown>>) =>
    list.map((p) => {
      const row = { ...p, id: `p${h.proposals.length + 1}`, status: 'open', reason: null, createdAt: 'now', decidedAt: null };
      h.proposals.push(row);
      return JSON.parse(JSON.stringify(row));
    }),
  getProposal: async (_t: string, id: string) => {
    const p = h.proposals.find((x) => x.id === id);
    return p ? JSON.parse(JSON.stringify(p)) : null;
  },
  listProposals: async () => h.proposals.filter((p) => p.status === 'open'),
  decideProposal: async (_t: string, id: string, status: string, reason: string | null) => {
    const p = h.proposals.find((x) => x.id === id);
    if (!p || p.status !== 'open') return false;
    Object.assign(p, { status, reason });
    return true;
  },
  supersedeGroup: async (_t: string, group: string, except: string, reason: string) => {
    h.superseded.push({ group, except, reason });
    for (const p of h.proposals) if (p.groupId === group && p.id !== except && p.status === 'open') Object.assign(p, { status: 'superseded', reason });
  },
  expireProposals: async (_t: string, kinds: string[], reason: string) => void h.expired.push({ kinds, reason }),
  listPackPlaces: async (_t: string, opts: { status?: string[] } = {}) => h.pack.filter((p) => !opts.status || opts.status.includes(p.status)),
  getPackPlace: async (_t: string, id: string) => h.pack.find((p) => p.id === id) ?? null,
  updatePackPlace: async (_t: string, id: string, patch: Record<string, unknown>) => {
    h.packUpdates.push({ id, patch });
    Object.assign(h.pack.find((p) => p.id === id) ?? {}, patch);
  },
  readPack: async () => ({ status: h.pack.length ? 'ready' : 'none' }),
}));
vi.mock('./proposals.store.server', () => ({
  updateProposalCheck: async (_t: string, id: string, check: Record<string, unknown>) => {
    h.checks.push({ id, ...check });
    Object.assign(h.proposals.find((p) => p.id === id) ?? {}, check);
  },
  moveProposal: async (_t: string, id: string, _from: string, to: string, reason: string) => Object.assign(h.proposals.find((p) => p.id === id) ?? {}, { status: to, reason }),
  supersedeSlot: async (_t: string, slot: { date: string | null; stage: string | null; wishId: string | null }, keep: string) => {
    for (const p of h.proposals) {
      const sc = (p.scope ?? {}) as { date?: string | null; stage?: string | null; wishId?: string | null };
      if (p.status === 'open' && ['swap', 'fill', 'day'].includes(p.kind as string) && p.groupId !== keep && sc.date === slot.date && (!slot.stage || sc.stage === slot.stage) && (!slot.wishId || sc.wishId === slot.wishId)) Object.assign(p, { status: 'superseded' });
    }
  },
}));
vi.mock('./converse.server', () => ({
  applyDirect: async (_trip: unknown, ops: Array<{ op: string }>, opts: unknown) => {
    h.applied.push({ ops, opts });
    const adds = ops.filter((o) => o.op === 'addWish').length;
    return { result: { applied: ops, rejected: [], research: adds ? [{ wishIds: ['new-wish'], depth: 'brief' }] : [], suggest: [], changed: true }, created: { stays: [], wishes: adds ? ['new-wish'] : [], bookings: [], transport: [] } };
  },
  logEdit: async (_t: string, text: string) => void h.logged.push(text),
}));
vi.mock('./research.server', () => ({
  findPlaceLoosely: async (q: string) => {
    h.lookups.push(q);
    return q.startsWith('Sant') ? { name: "Sant'Ignazio", location: { lat: 41.8992, lng: 12.4797 }, osmId: 'way/9', address: 'Piazza di Sant’Ignazio', openingHoursText: null, website: null, wikidata: 'Q1' } : null;
  },
  startResearch: async () => true,
}));
vi.mock('./questions.server', () => ({ refreshQuestions: async () => void h.questions++ }));
vi.mock('./shapes.server', () => ({ requestShapes: async () => [] }));
vi.mock('./images.server', () => ({ fetchImage: async () => ({ url: 'https://upload.wikimedia.org/x.jpg', width: 800, height: 600, credit: null, license: null, sourceUrl: 'https://commons.wikimedia.org/x', wikidata: 'Q1' }) }));
vi.mock('./ideas.server', () => ({ findIdeas: async () => h.ideas }));
vi.mock('./jobs.server', () => ({
  startJob: (_owner: string, kind: string, work: () => Promise<unknown>) => {
    h.jobs.push({ kind, work });
    return { id: 'job1', kind, status: 'running' };
  },
}));

const { solveTrip } = await import('./solver');
const { estimateMatrix } = await import('./solver/estimate');
const { makeWish } = await import('./solver/fixtures/build');

const TRIP = {
  id: 't1', ownerEmail: 'o@example.test', title: 'Rome', destination: 'Rome, Italy', timeZone: 'Europe/Rome', startDate: '2026-10-27', endDate: '2026-10-28',
  pace: 'normal', modes: ['walk'], status: 'planned', notes: null, dayLoads: {}, research: null, guide: null, profile: null, updatedAt: 'x',
} as Trip & { research: null; guide: null; profile: null; updatedAt: string };
const STAY: Stay = { id: 'campo', name: 'Flat', address: null, location: { lat: 41.8952, lng: 12.4716 }, fromDate: '2026-10-27', toDate: '2026-10-29', checkInMin: null, checkOutMin: null };
const baseWishes = (): Wish[] => [
  makeWish('pantheon', 'Pantheon and Piazza Navona', { lat: 41.8986, lng: 12.4769 }, { minutes: 180, fixedDate: '2026-10-27', partOfDay: 'morning' }),
  makeWish('capitoline', 'Capitoline Museums', { lat: 41.893, lng: 12.4828 }, { priority: 'nice', minutes: 180, fixedDate: '2026-10-28', partOfDay: 'afternoon' }),
  makeWish('trastevere', 'Trastevere walk', { lat: 41.8894, lng: 12.47 }, { minutes: 180, fixedDate: '2026-10-28', partOfDay: 'morning' }),
];
function inputFor(wishes: Wish[]) {
  return {
    trip: { id: TRIP.id, timeZone: TRIP.timeZone, startDate: TRIP.startDate, endDate: TRIP.endDate, pace: TRIP.pace, modes: TRIP.modes, dayLoads: TRIP.dayLoads },
    stays: [STAY],
    wishes,
    bookings: h.bookings,
    transport: [],
    matrix: estimateMatrix([{ id: 'stay:campo', location: STAY.location }, ...wishes.map((w) => ({ id: w.id, location: w.place!.location }))], ['walk']),
  };
}
vi.mock('./plan.server', () => ({
  solverInput: async () => ({ input: inputFor(h.wishes), state: { stays: [STAY], wishes: h.wishes, bookings: h.bookings }, routingNotes: [] }),
  replan: async () => {
    h.latestVersion += 1;
    return { created: true, plan: { version: h.latestVersion, changes: ['Palazzo Altemps added on Tue 27 Oct at 14:30.'], plan: solveTrip(inputFor(h.wishes)) } };
  },
}));
vi.mock('./store.server', () => ({
  latestPlan: async () => ({ version: h.latestVersion, plan: solveTrip(inputFor(h.wishes)), changes: [] }),
  getTripById: async () => TRIP,
  loadState: async () => ({ stays: [STAY], wishes: h.wishes, bookings: h.bookings }),
  tripOnly: (t: Record<string, unknown>) => {
    const { research: _r, updatedAt: _u, guide: _g, profile: _p, ...rest } = t;
    return rest;
  },
  updateWish: async (_t: string, id: string, patch: unknown) => void h.wishUpdates.push({ id, patch }),
}));

const P = await import('./proposals.server');

const place = (id: string, name: string, lat: number, lng: number, extra: Partial<PackPlace> = {}): PackPlace => ({
  id, name, kind: 'museum', tags: [], place: { name, location: { lat, lng }, osmId: `way/${id}`, address: null }, why: `${name}, near the flat.`, neighbourhood: 'Parione', durationMin: 60, indoor: true, kidFriendly: null,
  costText: null, lessVisited: false, bookingRequired: null, bookAheadDays: null, facts: null, image: null, wikidata: null, sources: [{ url: `https://example.test/${id}`, title: name }], status: 'candidate', rejectReason: null, wishId: null, checkedAt: null, ...extra,
});
const PACK = () => [
  place('altemps', 'Palazzo Altemps', 41.9007, 12.4728, { lessVisited: true, costText: '€10 each', image: { url: 'https://upload.wikimedia.org/a.jpg', width: 800, height: 533, credit: null, license: null, sourceUrl: 'https://commons.wikimedia.org/a', wikidata: 'Q2' } }),
  place('spada', 'Galleria Spada', 41.8944, 12.4713, { costText: '€5' }),
  place('ignazio', "Sant'Ignazio", 41.8992, 12.4797, { kind: 'church', costText: 'Free' }),
  place('gianicolo', 'Gianicolo terrace', 41.8919, 12.4611, { kind: 'viewpoint', indoor: false, costText: 'Free' }),
  place('roscioli', 'Roscioli', 41.8938, 12.4729, { kind: 'food' }),
];
const CALLER = { email: 'o@example.test', name: 'John', isOwner: true, surface: 'site' as const };

beforeEach(() => {
  h.proposals = [];
  h.pack = PACK();
  h.lookups = [];
  h.applied = [];
  h.wishUpdates = [];
  h.packUpdates = [];
  h.checks = [];
  h.logged = [];
  h.superseded = [];
  h.expired = [];
  h.jobs = [];
  h.ideas = null;
  h.latestVersion = 4;
  h.wishes = baseWishes();
  h.bookings = [];
  h.questions = 0;
});

describe('checking drafts', () => {
  it('looks a model’s place up, dry-runs it, and stores it with its difference, fit and the version it was checked on', async () => {
    const out = await P.checkDrafts(TRIP, [
      { kind: 'fill', title: "Sant'Ignazio", why: 'A painted ceiling.', group: 'tue-pm', scope: { date: '2026-10-27', stage: 'afternoon' }, ops: [{ op: 'addWish', wish: { title: "Sant'Ignazio", placeQuery: "Sant'Ignazio, Rome", fixedDate: '2026-10-27', partOfDay: 'afternoon', durationMin: 30, place: { name: 'Invented', location: { lat: 0, lng: 0 } } } }] },
      { kind: 'change', title: 'Drop a ghost', why: 'x', group: null, scope: {}, ops: [{ op: 'removeWish', id: 'ghost' }] },
      { kind: 'change', title: 'Nothing', why: 'x', group: null, scope: {}, ops: [{ op: 'setTrip', fields: { pace: 'normal' } }] },
    ], { authorEmail: 'o@example.test' });
    expect(h.lookups).toEqual(["Sant'Ignazio, Rome"]);
    expect(out.proposals).toHaveLength(1);
    const p = out.proposals[0];
    expect(p).toMatchObject({ kind: 'fill', title: "Sant'Ignazio", basedOnVersion: 4, packPlaceId: 'ignazio', status: 'open', scope: { date: '2026-10-27', stage: 'afternoon' } });
    expect(p.groupId).toMatch(/^tue-pm:/);
    // The model's own coordinates were never used: the map's place is what accepting replays.
    expect(p.ops).toEqual([{ op: 'addWish', wish: expect.objectContaining({ place: expect.objectContaining({ name: "Sant'Ignazio", location: { lat: 41.8992, lng: 12.4797 } }) }) }]);
    expect(p.diff.changes).toEqual([expect.objectContaining({ kind: 'added', title: "Sant'Ignazio", date: '2026-10-27' })]);
    expect(p.preview.map((d) => d.date)).toEqual(['2026-10-27']);
    expect(p.tradeoffs).toMatchObject({ fits: true, costText: 'Free' });
    expect(p.tradeoffs.fitText).toMatch(/^\d\d:\d\d–\d\d:\d\d/);
    // The family's current app gets the same as an option card.
    expect(out.options).toEqual([expect.objectContaining({ title: "Sant'Ignazio", date: '2026-10-27', stage: 'afternoon', wish: expect.objectContaining({ place: expect.any(Object) }), verdict: expect.objectContaining({ fits: true }) })]);
  });

  it('a pack draft carries the pack’s place, facts, photo and evidence — no lookup', async () => {
    const out = await P.checkDrafts(TRIP, [
      { kind: 'fill', title: 'Palazzo Altemps', why: 'Quiet.', group: null, packPlaceId: 'altemps', scope: { date: '2026-10-27', stage: 'afternoon' }, ops: [{ op: 'addWish', wish: { title: 'Palazzo Altemps', fixedDate: '2026-10-27', partOfDay: 'afternoon' } }] },
    ]);
    expect(h.lookups).toEqual([]);
    expect(out.proposals[0]).toMatchObject({ packPlaceId: 'altemps', image: { wikidata: 'Q2' }, evidence: [{ url: 'https://example.test/altemps' }], tradeoffs: { lessVisited: true, indoor: true, costText: '€10 each' } });
  });

  it('never proposes a pack place that was turned down — by its id, or found again by name', async () => {
    h.pack[0].status = 'rejected';
    const out = await P.checkDrafts(TRIP, [{ kind: 'fill', title: 'Palazzo Altemps', why: '', group: null, packPlaceId: 'altemps', scope: { date: '2026-10-27', stage: 'afternoon' }, ops: [{ op: 'addWish', wish: { title: 'Palazzo Altemps' } }] }]);
    expect(out.proposals).toEqual([]);
    h.pack[2].status = 'rejected';
    const again = await P.checkDrafts(TRIP, [{ kind: 'fill', title: "Sant'Ignazio", why: '', group: null, scope: { date: '2026-10-27', stage: 'afternoon' }, ops: [{ op: 'addWish', wish: { title: "Sant'Ignazio", placeQuery: "Sant'Ignazio, Rome", fixedDate: '2026-10-27', partOfDay: 'afternoon' } }] }]);
    expect(again.proposals).toEqual([]);
  });
});

describe('the fast path', () => {
  it('fills a part of a day from the pack in under two seconds: three that fit, one less visited, no lookups', async () => {
    const t0 = Date.now();
    const r = await P.generateProposals(TRIP, { kind: 'fill', target: { date: '2026-10-27', stage: 'afternoon' }, nudge: null, variant: null, withDate: null }, CALLER);
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(r.status).toBe(200);
    const list = r.body.proposals as Proposal[];
    expect(list.length).toBeGreaterThanOrEqual(2);
    expect(list.length).toBeLessThanOrEqual(3);
    expect(new Set(list.map((p) => p.groupId)).size).toBe(1);
    expect(list.some((p) => p.tradeoffs.lessVisited)).toBe(true);
    expect(list.every((p) => p.kind === 'fill' && p.tradeoffs.fits && p.packPlaceId)).toBe(true);
    expect(list.map((p) => p.title)).not.toContain('Roscioli'); // not a meal slot
    expect(h.lookups).toEqual([]);
  });

  it('swaps a stop for nearby places, and never swaps a fixed one', async () => {
    const r = await P.generateProposals(TRIP, { kind: 'swap', target: { stopId: 'capitoline' }, nudge: null, variant: null, withDate: null }, CALLER);
    expect(r.status).toBe(200);
    const list = r.body.proposals as Proposal[];
    expect(list.length).toBeGreaterThan(0);
    expect(list[0].ops[0]).toEqual({ op: 'removeWish', id: 'capitoline' });
    expect(list[0].scope.wishId).toBe('capitoline');
    h.wishes[1].locked = true;
    expect(await P.generateProposals(TRIP, { kind: 'swap', target: { stopId: 'capitoline' }, nudge: null, variant: null, withDate: null }, CALLER)).toMatchObject({ status: 409 });
  });

  it('nudges: cheaper returns only cheaper places than the one nudged, and not the same group again', async () => {
    const first = await P.generateProposals(TRIP, { kind: 'fill', target: { date: '2026-10-27', stage: 'afternoon' }, nudge: null, variant: null, withDate: null }, CALLER);
    const altemps = (first.body.proposals as Proposal[]).find((p) => p.packPlaceId === 'altemps')!;
    const r = await P.generateProposals(TRIP, { kind: 'nudge', target: { proposalId: altemps.id }, nudge: 'cheaper', variant: null, withDate: null }, CALLER);
    const list = r.body.proposals as Proposal[] | undefined;
    const ids = (list ?? []).map((p) => p.packPlaceId);
    const before = new Set((first.body.proposals as Proposal[]).map((p) => p.packPlaceId));
    expect(ids.every((id) => !before.has(id))).toBe(true);
    expect(ids.every((id) => ['spada', 'ignazio', 'gianicolo'].includes(id!))).toBe(true);
    expect(r.status).toBe(200);
  });

  it('a lighter day, as one proposal', async () => {
    // A light day moves what is not fixed to it: the Capitoline, free to go on either day.
    h.wishes = h.wishes.map((w) => (w.id === 'capitoline' ? { ...w, fixedDate: null, partOfDay: 'any' } : w));
    const before = solveTrip(inputFor(h.wishes));
    const date = before.days.find((d) => d.stops.some((s) => s.wishId === 'capitoline'))!.date;
    const r = await P.generateProposals(TRIP, { kind: 'day', target: { date }, nudge: null, variant: 'lighter', withDate: null }, CALLER);
    expect(r.status).toBe(200);
    const [p] = r.body.proposals as Proposal[];
    expect(p).toMatchObject({ kind: 'day', ops: [{ op: 'setTrip', fields: { dayLoads: { [date]: 'light' } } }], scope: { date } });
    expect(p.title).toMatch(/^A lighter (Tue 27|Wed 28) Oct$/);
    expect(p.diff.changes.length).toBeGreaterThan(0);
    expect(p.tradeoffs.fitText).not.toBeNull();
    // Already light: said, not stored.
    TRIP.dayLoads = { [date]: 'light' };
    try {
      expect(await P.generateProposals(TRIP, { kind: 'day', target: { date }, nudge: null, variant: 'lighter', withDate: null }, CALLER)).toMatchObject({ status: 409 });
    } finally {
      TRIP.dayLoads = {};
    }
  });

  it('swaps two days, keeping fixed stops', async () => {
    h.wishes = h.wishes.map((w) => ({ ...w, fixedDate: null }));
    const r = await P.generateProposals(TRIP, { kind: 'day', target: { date: '2026-10-27' }, nudge: null, variant: 'swap-days', withDate: '2026-10-28' }, CALLER);
    expect(r.status).toBe(200);
    expect((r.body.proposals as Proposal[])[0]).toMatchObject({ kind: 'day', title: 'Swap Tue 27 Oct and Wed 28 Oct' });
  });

  it('with no research pack yet, starts the live ideas search as a job and says so', async () => {
    h.pack = [];
    h.ideas = {
      gap: null, rejected: [], note: null, research: [],
      ideas: [{ title: "Sant'Ignazio", why: 'Ceiling.', fit: '', wish: { title: "Sant'Ignazio", placeQuery: "Sant'Ignazio, Rome", priority: 'nice', durationMin: 30, partOfDay: 'afternoon', fixedDate: '2026-10-27', fixedStartMin: null, note: null, replacesMeal: null, place: { name: "Sant'Ignazio", location: { lat: 41.8992, lng: 12.4797 }, osmId: 'way/9', address: null } }, verdict: { fits: true, pushesOut: [] }, source: 'planner' }],
    };
    const r = await P.generateProposals(TRIP, { kind: 'fill', target: { date: '2026-10-27', stage: 'afternoon' }, nudge: null, variant: null, withDate: null }, CALLER);
    expect(r).toMatchObject({ status: 202, body: { job: { id: 'job1' }, note: P.NOT_READY_NOTE } });
    expect(h.jobs.map((j) => j.kind)).toEqual(['ideas']);
    const done = (await h.jobs[0].work()) as { proposals: Proposal[] };
    expect(done.proposals.map((p) => [p.kind, p.title])).toEqual([['fill', "Sant'Ignazio"]]);
  });

  it('“Add to the plan” from the research pack: that place, in the part of the day where it fits', async () => {
    const r = await P.generateProposals(TRIP, { kind: 'fill', target: { date: '2026-10-27', packPlaceId: 'spada' }, nudge: null, variant: null, withDate: null }, CALLER);
    expect(r.status).toBe(200);
    expect(r.body.note).toBeUndefined();
    const list = r.body.proposals as Proposal[];
    expect(list.map((p) => [p.kind, p.packPlaceId, p.tradeoffs.fits])).toEqual([['fill', 'spada', true]]);
  });

  it('when the chosen place does not fit, says why and offers what does', async () => {
    h.pack[1].facts = { openingHoursText: null, hours: null, closedDates: ['2026-10-27'], bookingRequired: null, bookAheadDays: null, bookingUrl: null, officialUrl: null, priceText: null, typicalVisitSec: null, summary: null, sources: [], checkedAt: null, depth: 'brief', unknown: [] };
    const r = await P.generateProposals(TRIP, { kind: 'fill', target: { date: '2026-10-27', packPlaceId: 'spada' }, nudge: null, variant: null, withDate: null }, CALLER);
    expect(r.status).toBe(200);
    expect(r.body.note).toMatch(/^Galleria Spada does not fit Tue 27 Oct: .+\.$/);
    const list = r.body.proposals as Proposal[];
    expect(list.length).toBeGreaterThan(0);
    expect(list.every((p) => p.packPlaceId !== 'spada' && p.tradeoffs.fits)).toBe(true);
  });

  it('a chosen place already planned, or not in the pack, is said plainly', async () => {
    h.pack[1].status = 'planned';
    expect(await P.generateProposals(TRIP, { kind: 'fill', target: { date: '2026-10-27', packPlaceId: 'spada' }, nudge: null, variant: null, withDate: null }, CALLER)).toEqual({ status: 409, body: { error: 'Galleria Spada is already in the plan.' } });
    expect(await P.generateProposals(TRIP, { kind: 'fill', target: { date: '2026-10-27', packPlaceId: 'nope' }, nudge: null, variant: null, withDate: null }, CALLER)).toMatchObject({ status: 404 });
  });

  it('shapes come from the research pack, and say so plainly when there is not enough yet', async () => {
    expect(await P.generateProposals(TRIP, { kind: 'shapes', target: {}, nudge: null, variant: null, withDate: null }, CALLER)).toMatchObject({ status: 200, body: { proposals: [], note: expect.stringContaining('not enough in the research') } });
  });
});

describe('accepting and turning down', () => {
  async function aFill(): Promise<Proposal> {
    const r = await P.generateProposals(TRIP, { kind: 'fill', target: { date: '2026-10-27', stage: 'afternoon' }, nudge: null, variant: null, withDate: null }, CALLER);
    return (r.body.proposals as Proposal[]).find((p) => p.packPlaceId === 'altemps')!;
  }

  it('replays the checked ops, carries the pack’s facts onto the new wish, closes the group and says what changed with its undo', async () => {
    const p = await aFill();
    const r = await P.acceptProposal(TRIP, p.id, CALLER);
    expect(r.status).toBe(200);
    expect(h.applied).toEqual([{ ops: p.ops, opts: { trustedPlaces: true, provenance: 'you' } }]);
    expect(h.wishUpdates).toEqual([{ id: 'new-wish', patch: { facts: expect.objectContaining({ priceText: '€10 each', summary: 'Palazzo Altemps, near the flat.' }) } }]);
    expect(h.packUpdates).toEqual([{ id: 'altemps', patch: { status: 'planned', wishId: 'new-wish' } }]);
    expect(h.superseded).toEqual([{ group: p.groupId, except: p.id, reason: 'Chose Palazzo Altemps' }]);
    expect(h.proposals.filter((x) => x.groupId === p.groupId).map((x) => x.status).sort()).toEqual(['accepted', ...Array(h.proposals.filter((x) => x.groupId === p.groupId).length - 1).fill('superseded')]);
    expect(h.logged).toEqual(['John chose Palazzo Altemps.']);
    expect(r.body).toMatchObject({ proposal: { status: 'accepted' }, planVersion: 5, changes: ['Palazzo Altemps added on Tue 27 Oct at 14:30.'], undo: { toVersion: 4 } });
    expect(r.body.diff).toMatchObject({ lines: expect.any(Array) });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(h.questions).toBe(1);
    // Twice is refused.
    expect(await P.acceptProposal(TRIP, p.id, CALLER)).toMatchObject({ status: 409 });
  });

  it('re-checks a proposal the plan has moved on from; a material difference is shown first (409 stale)', async () => {
    const p = await aFill();
    const row = h.proposals.find((x) => x.id === p.id)!;
    row.basedOnVersion = 3;
    row.diff = { ...row.diff, changes: [...row.diff.changes, { kind: 'dropped', wishId: 'x', title: 'Something', date: null, fromDate: '2026-10-27', fromMin: 600, toMin: null, reason: null }] };
    const r = await P.acceptProposal(TRIP, p.id, CALLER);
    expect(r).toMatchObject({ status: 409, body: { stale: true, proposal: { status: 'open', basedOnVersion: 4 } } });
    expect(h.checks).toHaveLength(1);
    expect(h.applied).toEqual([]);
    // Accepting again (now checked against version 4) goes through.
    expect((await P.acceptProposal(TRIP, p.id, CALLER)).status).toBe(200);
  });

  it('a re-check that comes out the same is applied straight away', async () => {
    const p = await aFill();
    h.proposals.find((x) => x.id === p.id)!.basedOnVersion = 3;
    expect((await P.acceptProposal(TRIP, p.id, CALLER)).status).toBe(200);
    expect(h.checks).toEqual([]);
  });

  it('a proposal that no longer applies expires', async () => {
    const p = await aFill();
    const row = h.proposals.find((x) => x.id === p.id)!;
    row.basedOnVersion = 3;
    row.ops = [{ op: 'removeWish', id: 'gone' }];
    expect(await P.acceptProposal(TRIP, p.id, CALLER)).toMatchObject({ status: 409, body: { error: 'The plan has moved on and this no longer applies.' } });
    expect(row.status).toBe('expired');
  });

  it('turning down records the reason and takes the place off the long list', async () => {
    const p = await aFill();
    const r = await P.rejectProposal(TRIP, p.id, 'too-far', CALLER, 'A long walk with the children');
    expect(r).toMatchObject({ status: 200, body: { proposal: { status: 'rejected', reason: 'Too far: A long walk with the children' } } });
    expect(h.packUpdates).toEqual([{ id: 'altemps', patch: { status: 'rejected', rejectReason: 'too-far' } }]);
    expect(await P.rejectProposal(TRIP, p.id, 'other', CALLER)).toMatchObject({ status: 409 });
    expect(await P.rejectProposal(TRIP, 'nope', 'other', CALLER)).toMatchObject({ status: 404 });
  });

  it('accepting a shape expires the other shapes', async () => {
    h.proposals.push({ id: 's1', groupId: 'shapes:1', kind: 'shape', title: 'Ancient Rome first', why: '', scope: {}, ops: [{ op: 'setTrip', fields: { pace: 'relaxed' } }], diff: { lines: [], changes: [], dates: [], walkDeltaM: null, dropped: [] }, tradeoffs: {}, evidence: [], place: null, image: null, packPlaceId: null, shape: null, preview: [], basedOnVersion: 4, status: 'open', reason: null });
    expect((await P.acceptProposal(TRIP, 's1', CALLER)).status).toBe(200);
    expect(h.expired).toEqual([{ kinds: ['shape'], reason: 'Chose Ancient Rome first' }]);
  });
});

describe('inside a job', () => {
  it('with no pack, a request already running as a job searches inline instead of starting another', async () => {
    h.pack = [];
    h.ideas = { gap: null, rejected: [], note: 'Nothing fits.', research: [], ideas: [] };
    const r = await P.generateProposals(TRIP, { kind: 'fill', target: { date: '2026-10-27', stage: 'afternoon' }, nudge: null, variant: null, withDate: null }, CALLER, { inline: true });
    expect(h.jobs).toEqual([]);
    expect(r).toEqual({ status: 200, body: { proposals: [], note: 'Nothing fits.' } });
  });
});
