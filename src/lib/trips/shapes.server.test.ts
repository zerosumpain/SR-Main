import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PackPlace } from './decisions';
import type { SolvedPlan, Stay, Trip } from './model';
import { distinctShapes, fallbackShapes, readShapes, shapeOps, shapeStops, shapeSummary, shapesPrompt } from './shapes';

// Shapes: the model chooses from the pack (by id), the solver checks each
// choice as a whole; stored as one group of `shape` proposals.
const h = vi.hoisted(() => ({ places: [] as unknown[], proposals: [] as Array<Record<string, unknown>>, expired: 0, wishes: [] as unknown[] }));

const FLAT: Stay = { id: 'flat', name: 'The flat', address: null, location: { lat: 41.8952, lng: 12.4716 }, fromDate: '2026-10-26', toDate: '2026-10-30', checkInMin: null, checkOutMin: null };
const TRIP = { id: 't1', ownerEmail: 'owner@example.test', title: 'Rome', destination: 'Rome', timeZone: 'Europe/Rome', startDate: '2026-10-26', endDate: '2026-10-29', pace: 'normal', modes: ['walk'], status: 'planned', notes: null, dayLoads: {}, research: null, guide: null, profile: { travellers: [{ name: 'You', relation: null, notes: [] }, { name: 'Sam', relation: null, notes: [], age: 9 }], preferences: [{ text: 'Loves Roman history', source: 'memory', ref: 'm1' }], constraints: [], history: [], gatheredAt: 'x' }, updatedAt: 'x' };

vi.mock('./decisions.store.server', () => ({
  listPackPlaces: async () => h.places,
  readPack: async () => ({ calendar: [{ date: '2026-10-28', kind: 'weather', text: 'Rain likely in the afternoon', placeId: null, sources: [] }] }),
  addProposals: async (_t: string, ps: Array<Record<string, unknown>>) => {
    const rows = ps.map((p, i) => ({ ...p, id: `prop-${i}`, status: 'open' }));
    h.proposals.push(...rows);
    return rows;
  },
  expireProposals: async () => void h.expired++,
}));
vi.mock('./store.server', () => ({
  latestPlan: async () => ({ version: 4, plan: { days: [], dropped: [], warnings: [], score: 0 }, matrix: null }),
  listTransport: async () => [],
  tripOnly: (t: Record<string, unknown>) => {
    const { research: _r, updatedAt: _u, guide: _g, profile: _p, ...rest } = t;
    return rest;
  },
}));
vi.mock('./llm.server', () => ({ jsonCall: vi.fn(async () => { throw new Error('no model'); }) }));
vi.mock('./plan.server', async () => {
  const { estimateMatrix } = await import('$lib/trips/solver');
  return {
    replan: vi.fn(),
    solverInput: async () => ({
      input: { trip: { id: 't1', timeZone: 'Europe/Rome', startDate: '2026-10-26', endDate: '2026-10-29', pace: 'normal', modes: ['walk'], dayLoads: {} }, stays: [FLAT], wishes: h.wishes, bookings: [], transport: [], matrix: estimateMatrix([{ id: 'stay:flat', location: FLAT.location }], ['walk']) },
      state: { stays: [FLAT], wishes: h.wishes, bookings: [] },
      routingNotes: [],
    }),
  };
});

const { requestShapes, startShapesJob } = await import('./shapes.server');
const { readJob } = await import('./jobs.server');

const ROME: Array<[string, number, number, boolean, string]> = [
  ['Colosseum', 41.8902, 12.4922, false, 'sight'],
  ['Roman Forum', 41.8925, 12.4853, false, 'sight'],
  ['Pantheon', 41.8986, 12.4769, false, 'church'],
  ['Trevi Fountain', 41.9009, 12.4833, false, 'sight'],
  ['Capitoline Museums', 41.893, 12.4828, false, 'museum'],
  ['Palazzo Altemps', 41.9007, 12.4728, true, 'museum'],
  ['Crypta Balbi', 41.8955, 12.4776, true, 'museum'],
  ['Aventine keyhole', 41.8833, 12.4794, true, 'viewpoint'],
  ['Villa Farnesina', 41.8935, 12.4669, true, 'museum'],
  ['Santa Maria in Trastevere', 41.8895, 12.4697, false, 'church'],
  ['Campo de’ Fiori', 41.8956, 12.4722, false, 'market'],
  ['Palazzo Massimo', 41.9012, 12.4977, true, 'museum'],
  ['Galleria Spada', 41.8942, 12.4712, true, 'museum'],
  ['Giolitti', 41.9008, 12.4766, false, 'gelato'],
];
const places: PackPlace[] = ROME.map(([name, lat, lng, quiet, kind], i) => ({ id: `pp${i}`, name, kind: kind as PackPlace['kind'], tags: [], place: { name, location: { lat, lng }, osmId: `node/${i}`, address: null }, why: null, neighbourhood: null, durationMin: 60, indoor: kind === 'museum', kidFriendly: true, costText: null, lessVisited: quiet, bookingRequired: name === 'Colosseum' ? true : null, bookAheadDays: null, facts: null, image: i === 0 ? { url: 'https://upload.wikimedia.org/c.jpg', width: 800, height: 600, credit: null, license: null, sourceUrl: 'https://commons.wikimedia.org/wiki/File:C.jpg', wikidata: 'Q10285' } : null, wikidata: null, sources: [{ url: `https://example.org/${i}`, title: name }], status: 'candidate', rejectReason: null, wishId: null, checkedAt: null }));

beforeEach(() => {
  h.places = places;
  h.proposals = [];
  h.expired = 0;
  h.wishes = [];
});

describe('shapes, the rules', () => {
  const ids = new Set(places.map((p) => p.id));
  const dates = ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29'];

  it('the model sees the pack (no restaurants), the fixed items and the weather', () => {
    const p = shapesPrompt({ trip: TRIP as unknown as Trip, dates, travellers: 'You, Sam (9)', preferences: ['Loves Roman history'], fixed: [{ date: '2026-10-28', text: 'Vatican tour at 08:15 (booked)' }], places: places.filter((x) => x.kind !== 'gelato'), calendar: [{ date: '2026-10-28', kind: 'weather', text: 'Rain likely in the afternoon', placeId: null, sources: [] }] });
    expect(p).toContain('- Wed 28 Oct: Vatican tour at 08:15 (booked)');
    expect(p).toContain('- Wed 28 Oct: Rain likely in the afternoon');
    expect(p).toContain('"id":"pp5","name":"Palazzo Altemps","kind":"museum"');
    expect(p).not.toContain('Giolitti');
  });

  it('reads only real ids, on the trip’s days, 8–14 places', () => {
    const raw = { shapes: [
      { headline: 'Ancient Rome first', why: 'For the history.', days: [{ date: '2026-10-26', theme: 'Ancient', placeIds: ['pp0', 'pp1', 'pp4', 'made-up'] }, { date: '2026-10-27', placeIds: ['pp2', 'pp3', 'pp5', 'pp6', 'pp7'] }, { date: '2099-01-01', placeIds: ['pp8'] }] },
      { headline: 'Too few', days: [{ date: '2026-10-26', placeIds: ['pp0'] }] },
    ] };
    const [s] = readShapes(raw, ids, dates);
    expect(s.placeIds).toEqual(['pp0', 'pp1', 'pp4', 'pp2', 'pp3', 'pp5', 'pp6', 'pp7', 'pp8']);
    expect(s.days.get('pp0')).toBe('2026-10-26');
    expect(s.days.get('pp8')).toBe('');
    expect(readShapes(raw, ids, dates)).toHaveLength(1);
  });

  it('ops add each place with its place already found, skipping what is already a wish', () => {
    const [s] = readShapes({ shapes: [{ headline: 'x', placeIds: places.slice(0, 8).map((p) => p.id) }] }, ids, dates);
    const ops = shapeOps(s, places, [{ title: 'Pantheon', place: null, skipped: false }]);
    expect(ops).toHaveLength(7);
    expect(ops[0]).toEqual({ op: 'addWish', wish: expect.objectContaining({ title: 'Colosseum', place: { name: 'Colosseum', location: { lat: 41.8902, lng: 12.4922 }, osmId: 'node/0', address: null }, fixedDate: null }) });
  });

  it('shapes that differ in fewer than 3 stops are one', () => {
    const a = new Set(['a@1', 'b@1', 'c@2']);
    expect(distinctShapes([a, new Set(['a@1', 'b@1', 'd@2']), new Set(['x@1', 'y@1', 'z@2'])])).toEqual([0, 2]);
    expect(distinctShapes([a, new Set(['a@1', 'b@1', 'c@2', 'd@3', 'e@3'])])).toEqual([0]);
  });

  it('a line per day, and the fallback pair', () => {
    const plan = { days: [{ date: '2026-10-26', stayId: null, legs: [], warnings: [], stops: [{ id: 'transport:o:arrive', kind: 'transport', wishId: null, title: 'FCO', location: null, arriveMin: 690, departMin: 700, waitSec: 0, locked: true, bookingId: null, warnings: [] }, { id: 'w', kind: 'wish', wishId: 'w', title: 'Pantheon', location: null, arriveMin: 900, departMin: 960, waitSec: 0, locked: false, bookingId: null, warnings: [] }] }, { date: '2026-10-27', stayId: null, legs: [], warnings: [], stops: [] }], dropped: [], warnings: [], score: 0 } as unknown as SolvedPlan;
    expect(shapeSummary('X', plan, ['Colosseum'])).toEqual({ headline: 'X', days: [{ date: '2026-10-26', line: 'Land 11:30 · Pantheon' }, { date: '2026-10-27', line: 'A free day' }], leavesOut: ['Colosseum'] });
    expect(shapeStops(plan)).toEqual(new Set(['pantheon@2026-10-26']));
    const pair = fallbackShapes(places, dates);
    expect(pair.map((s) => s.headline)).toEqual(['The famous sights', 'Quieter corners']);
    expect(pair[1].placeIds[0]).toBe('pp5');
  });
});

describe('requestShapes', () => {
  const model = vi.fn(async () => ({
    shapes: [
      { headline: 'Ancient Rome first, slow afternoons', why: 'For the history, with time to rest.', days: [{ date: '2026-10-26', placeIds: ['pp0', 'pp1', 'pp4'] }, { date: '2026-10-27', placeIds: ['pp2', 'pp3'] }, { date: '2026-10-28', placeIds: ['pp5', 'pp6'] }, { date: '2026-10-29', placeIds: ['pp7'] }] },
      { headline: 'Neighbourhood days', why: 'One area a day, on foot.', days: [{ date: '2026-10-26', placeIds: ['pp9', 'pp8', 'pp12'] }, { date: '2026-10-27', placeIds: ['pp10', 'pp5', 'pp6'] }, { date: '2026-10-28', placeIds: ['pp11', 'pp2'] }] },
      { headline: 'Almost the first again', days: [{ date: '2026-10-26', placeIds: ['pp0', 'pp1', 'pp4'] }, { date: '2026-10-27', placeIds: ['pp2', 'pp3'] }, { date: '2026-10-28', placeIds: ['pp5', 'pp6', 'pp7'] }] },
    ],
  }));

  it('two or three solved shapes, near-duplicates merged, stored as one group replacing the old', async () => {
    const out = await requestShapes(TRIP as never, { email: 'owner@example.test', isOwner: true }, { deps: { model } });
    expect(out.map((p) => p.title)).toEqual(['Ancient Rome first, slow afternoons', 'Neighbourhood days']);
    expect(new Set(out.map((p) => p.groupId)).size).toBe(1);
    expect(h.expired).toBe(1);
    const [first] = out;
    expect(first).toMatchObject({ kind: 'shape', basedOnVersion: 4, image: { wikidata: 'Q10285' }, tradeoffs: { lessVisited: true, kidFriendly: true } });
    expect(first.ops.every((o) => o.op === 'addWish')).toBe(true);
    expect(first.shape!.days).toHaveLength(4);
    expect(first.shape!.days[0].line).toContain('Colosseum');
    expect(first.tradeoffs.walkKmPerDay).not.toBeNull();
    expect(first.evidence.length).toBeGreaterThan(0);
    // The owner's own request may use the owner's preferences (server-side only).
    expect(String((model.mock.calls[0] as unknown[])[1])).toContain('They like: Loves Roman history');
  });

  it('someone else’s request never sees the owner’s preferences', async () => {
    model.mockClear();
    await requestShapes(TRIP as never, { email: 'kid@example.test', isOwner: false }, { deps: { model } });
    expect(String((model.mock.calls[0] as unknown[])[1])).not.toContain('Loves Roman history');
  });

  it('no model: the famous and the quieter, still solved', async () => {
    const out = await requestShapes(TRIP as never, { email: 'owner@example.test', isOwner: true }, { deps: { model: async () => { throw new Error('down'); } } });
    expect(out.map((p) => p.title)).toEqual(['The famous sights', 'Quieter corners']);
  });

  it('too little in the pack: nothing', async () => {
    h.places = places.slice(0, 3);
    expect(await requestShapes(TRIP as never, { email: 'owner@example.test', isOwner: true }, { deps: { model } })).toEqual([]);
  });

  it('as a job with one stage', async () => {
    const job = startShapesJob(TRIP as never, { email: 'owner@example.test', isOwner: true }, { model });
    expect(job.stages).toEqual([{ key: 'shapes', label: 'Drafting ways to do it', state: 'waiting', detail: null }]);
    await vi.waitFor(() => expect(readJob('owner@example.test', job.id)?.status).toBe('done'));
    expect(readJob('owner@example.test', job.id)!.stages[0]).toMatchObject({ state: 'done', detail: '2 ways to do it' });
  });
});
