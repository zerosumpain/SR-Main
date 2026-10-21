import { describe, expect, it } from 'vitest';
import type { PackPlace, PlanDiff } from './decisions';
import { EMPTY_DIFF } from './decisions';
import type { Verdict } from './ideas';
import type { Booking, PlannedDay, PlannedStop, SolvedPlan, Wish } from './model';
import {
  changeSummary,
  costValue,
  isOutdoor,
  legacyOption,
  lighterOps,
  materiallyDiffers,
  nudgeRank,
  openSlot,
  optionDrafts,
  orderChecked,
  packDraft,
  packFacts,
  pickBest,
  rainyOps,
  rankCandidates,
  readDecision,
  readProposalRequest,
  slotFor,
  swapDaysOps,
} from './proposals';

const at = (lat: number, lng: number) => ({ lat, lng });
const FLAT = at(41.8986, 12.4699);
const stop = (id: string, kind: PlannedStop['kind'], title: string, arriveMin: number, departMin: number, stage: PlannedStop['stage'], location = FLAT): PlannedStop => ({
  id, kind, wishId: kind === 'wish' ? id : null, title, location, arriveMin, departMin, waitSec: 0, locked: false, bookingId: null, warnings: [], stage,
});
const DAY: PlannedDay = {
  date: '2026-10-27', stayId: 's1', warnings: [], legs: [],
  stops: [
    stop('stay:2026-10-27:start', 'stay', 'Flat', 540, 540, 'morning'),
    stop('forum', 'wish', 'Roman Forum', 570, 720, 'morning', at(41.8925, 12.4853)),
    stop('meal:2026-10-27:lunch', 'meal', 'Lunch', 735, 795, 'lunch', at(41.894, 12.48)),
    stop('gianicolo', 'wish', 'Gianicolo walk', 840, 930, 'afternoon', at(41.8919, 12.4611)),
    stop('stay:2026-10-27:end', 'stay', 'Flat', 1140, 1140, 'evening'),
  ],
};
const DAY2: PlannedDay = { ...DAY, date: '2026-10-28', stops: [stop('stay:2026-10-28:start', 'stay', 'Flat', 540, 540, 'morning'), stop('vatican', 'wish', 'Vatican Museums', 495, 690, 'morning', at(41.9065, 12.4536)), stop('stay:2026-10-28:end', 'stay', 'Flat', 1140, 1140, 'evening')] };
const PLAN: SolvedPlan = { days: [DAY, DAY2], dropped: [], warnings: [], score: 0 };

const wish = (id: string, title: string, extra: Partial<Wish> = {}): Wish => ({
  id, title, place: { name: title, location: FLAT, osmId: null, address: null }, priority: 'nice', durationSec: 3600, partOfDay: 'any', fixedDate: null, fixedStartMin: null, locked: false, suggested: false, skipped: false, facts: null, note: null, sortHint: 0, ...extra,
});
const WISHES = [wish('forum', 'Roman Forum', { priority: 'must' }), wish('gianicolo', 'Gianicolo walk'), wish('vatican', 'Vatican Museums', { fixedStartMin: 495, locked: true, fixedDate: '2026-10-28' })];
const BOOKED: Booking[] = [];

const pp = (id: string, name: string, extra: Partial<PackPlace> = {}): PackPlace => ({
  id, name, kind: 'museum', tags: [], place: { name, location: FLAT, osmId: null, address: null }, why: null, neighbourhood: null, durationMin: 60, indoor: true, kidFriendly: null, costText: null,
  lessVisited: false, bookingRequired: null, bookAheadDays: null, facts: null, image: null, wikidata: null, sources: [], status: 'candidate', rejectReason: null, wishId: null, checkedAt: null, ...extra,
});

describe('the slot', () => {
  it('a fill is the gap in a part of the day', () => {
    const r = slotFor(PLAN, WISHES, BOOKED, 'fill', { date: '2026-10-27', stage: 'afternoon' });
    expect(r.ok && r.slot).toMatchObject({ kind: 'fill', date: '2026-10-27', stage: 'afternoon', replaces: null });
  });

  it('a swap is the stop and its neighbours', () => {
    const r = slotFor(PLAN, WISHES, BOOKED, 'swap', { stopId: 'gianicolo' });
    if (!r.ok) throw new Error(r.error);
    expect(r.slot.gap.before.stopId).toBe('meal:2026-10-27:lunch');
    expect(r.slot.gap.after.stopId).toBe('stay:2026-10-27:end');
    expect(r.slot.replaces).toMatchObject({ wishId: 'gianicolo', title: 'Gianicolo walk' });
  });

  it('never swaps a locked or booked stop', () => {
    expect(slotFor(PLAN, WISHES, BOOKED, 'swap', { wishId: 'vatican' })).toMatchObject({ ok: false, status: 409 });
    const booked: Booking[] = [{ id: 'b', wishId: 'gianicolo', title: 'x', date: null, startMin: null, endMin: null, reference: null, url: null, documentId: null, status: 'booked' }];
    expect(slotFor(PLAN, WISHES, booked, 'swap', { stopId: 'gianicolo' })).toMatchObject({ ok: false, status: 409 });
    expect(slotFor(PLAN, WISHES, BOOKED, 'swap', { stopId: 'nope' })).toMatchObject({ ok: false, status: 404 });
    expect(slotFor(PLAN, WISHES, BOOKED, 'fill', { date: '2026-11-30', stage: 'morning' })).toMatchObject({ ok: false, status: 404 });
  });
});

describe('which pack places to check', () => {
  const slot = (() => {
    const r = slotFor(PLAN, WISHES, BOOKED, 'fill', { date: '2026-10-27', stage: 'afternoon' });
    if (!r.ok) throw new Error('no slot');
    return r.slot;
  })();

  it('nearest first; only candidates, not already wishes, open that day, the right kind', () => {
    const places = [
      pp('far', 'Far museum', { place: { name: 'Far', location: at(41.95, 12.5), osmId: null, address: null } }),
      pp('near', 'Near museum', { place: { name: 'Near', location: at(41.8925, 12.4855), osmId: null, address: null } }),
      pp('planned', 'Planned one', { status: 'planned' }),
      pp('rejected', 'Turned down', { status: 'rejected', rejectReason: 'too-far' }),
      pp('dup', 'Roman Forum'),
      pp('closed', 'Closed Tuesdays', { facts: { openingHoursText: null, hours: { 2: [] }, closedDates: [], bookingRequired: null, bookAheadDays: null, bookingUrl: null, officialUrl: null, priceText: null, typicalVisitSec: null, summary: null, sources: [], checkedAt: null, depth: 'brief', unknown: [] } }),
      pp('food', 'A trattoria', { kind: 'food' }),
    ];
    expect(rankCandidates(places, slot, WISHES).map((c) => c.place.id)).toEqual(['near', 'far']);
    expect(rankCandidates(places, slot, WISHES, { limit: 1 }).map((c) => c.place.id)).toEqual(['near']);
  });

  it('a meal slot draws places to eat', () => {
    const lunch = slotFor(PLAN, WISHES, BOOKED, 'fill', { date: '2026-10-27', stage: 'lunch' });
    if (!lunch.ok) throw new Error('no slot');
    expect(lunch.slot.gap.meal).toBe('lunch');
    expect(rankCandidates([pp('m', 'Museum'), pp('f', 'Trattoria', { kind: 'food' })], lunch.slot, WISHES).map((c) => c.place.id)).toEqual(['f']);
  });

  it('nudges re-rank relative to the one nudged', () => {
    const cands = [
      { place: pp('a', 'A', { costText: '€15 each', kind: 'museum', tags: ['roman'] }), distanceM: 300 },
      { place: pp('b', 'B', { costText: 'Free', kind: 'church', lessVisited: true }), distanceM: 900 },
      { place: pp('c', 'C', { costText: '€5', kind: 'museum', tags: ['roman', 'sculpture'] }), distanceM: 1200 },
    ];
    const ref = { place: pp('r', 'R', { costText: '€10', kind: 'museum', tags: ['sculpture'] }), distanceM: 1000, walkMin: 12 };
    expect(nudgeRank(cands, 'closer', ref).map((c) => c.place.id)).toEqual(['a', 'b']);
    expect(nudgeRank(cands, 'cheaper', ref).map((c) => c.place.id)).toEqual(['b', 'c']);
    expect(nudgeRank(cands, 'quieter', ref).map((c) => c.place.id)).toEqual(['b']);
    expect(nudgeRank(cands, 'more-like-this', ref).map((c) => c.place.id)).toEqual(['c', 'a']);
    expect(orderChecked([{ id: 'x', walkMin: 14 }, { id: 'y', walkMin: 3 }, { id: 'z', walkMin: 8 }], 'less-walking', ref).map((c) => c.id)).toEqual(['y', 'z']);
    expect(costValue({ costText: 'About £12.50', tags: [] })).toBe(12.5);
    expect(costValue({ costText: null, tags: ['free'] })).toBe(0);
  });

  it('keeps the best three that fit, with one less visited when one fits', () => {
    const c = (id: string, fits: boolean, lessVisited = false) => ({ id, fits, lessVisited });
    expect(pickBest([c('a', true), c('b', false), c('c', true), c('d', true), c('e', true, true)]).map((x) => x.id)).toEqual(['a', 'c', 'e']);
    expect(pickBest([c('a', true, true), c('b', true), c('c', true), c('d', true, true)]).map((x) => x.id)).toEqual(['a', 'b', 'c']);
    expect(pickBest([c('a', false)])).toEqual([]);
  });
});

describe('pack places as wishes', () => {
  it('a swap removes the stop and adds the pack place, pinned to the slot, carrying its place', () => {
    const r = slotFor(PLAN, WISHES, BOOKED, 'swap', { stopId: 'gianicolo' });
    if (!r.ok) throw new Error('no slot');
    const d = packDraft(pp('alt', 'Palazzo Altemps', { why: 'Quiet sculpture.', costText: '€10', lessVisited: true, sources: [{ url: 'https://example.test/altemps', title: 'Altemps' }] }), r.slot, 'g1');
    expect(d).toMatchObject({ kind: 'swap', title: 'Palazzo Altemps', why: 'Quiet sculpture.', group: 'g1', packPlaceId: 'alt', costText: '€10', scope: { date: '2026-10-27', stage: 'afternoon', wishId: 'gianicolo' } });
    expect(d.ops).toEqual([
      { op: 'removeWish', id: 'gianicolo' },
      { op: 'addWish', wish: expect.objectContaining({ title: 'Palazzo Altemps', fixedDate: '2026-10-27', partOfDay: 'afternoon', place: expect.objectContaining({ name: 'Palazzo Altemps' }) }) },
    ]);
    expect(d.evidence).toHaveLength(1);
  });

  it('the pack’s facts become the wish’s', () => {
    const f = packFacts(pp('x', 'X', { bookingRequired: true, bookAheadDays: 14, costText: '€18', durationMin: 90, why: 'Big.', sources: [{ url: 'https://example.test', title: null }], checkedAt: '2026-10-21T12:00:00Z' }));
    expect(f).toMatchObject({ bookingRequired: true, bookAheadDays: 14, priceText: '€18', typicalVisitSec: 5400, summary: 'Big.', checkedAt: '2026-10-21T12:00:00Z' });
    expect(f.sources).toHaveLength(1);
  });
});

describe('day variants', () => {
  const trip = { startDate: '2026-10-26', endDate: '2026-10-30', dayLoads: { '2026-10-28': 'light' as const } };

  it('lighter sets the day’s load, once', () => {
    expect(lighterOps(trip, '2026-10-27')).toEqual({ ok: true, ops: [{ op: 'setTrip', fields: { dayLoads: { '2026-10-27': 'light' } } }] });
    expect(lighterOps(trip, '2026-10-28')).toMatchObject({ ok: false, status: 409 });
  });

  it('swapping days moves what can move and leaves the fixed', () => {
    const r = swapDaysOps(PLAN, trip, WISHES, BOOKED, '2026-10-27', '2026-10-28');
    expect(r).toMatchObject({ ok: true, kept: ['Vatican Museums'] });
    if (!r.ok) return;
    expect(r.ops).toEqual([
      { op: 'updateWish', id: 'forum', fields: { fixedDate: '2026-10-28' } },
      { op: 'updateWish', id: 'gianicolo', fields: { fixedDate: '2026-10-28' } },
      { op: 'setTrip', fields: { dayLoads: { '2026-10-27': 'light', '2026-10-28': 'normal' } } },
    ]);
    expect(swapDaysOps(PLAN, trip, WISHES, BOOKED, '2026-10-27', null)).toMatchObject({ ok: false, status: 400 });
  });

  it('a rainy day swaps outdoor nice-to-haves for the nearest indoor place, keeping must-dos', () => {
    const pack = [
      pp('gw', 'Gianicolo walk', { kind: 'walk', indoor: false, status: 'planned', wishId: 'gianicolo' }),
      pp('rf', 'Roman Forum', { kind: 'sight', indoor: false }),
      pp('in', 'Palazzo Spada', { indoor: true, place: { name: 'Spada', location: at(41.8945, 12.4714), osmId: null, address: null } }),
    ];
    const r = rainyOps(PLAN, WISHES, BOOKED, pack, '2026-10-27');
    expect(r).toMatchObject({ ok: true, swaps: [{ out: 'Gianicolo walk', in: 'Palazzo Spada' }], kept: ['Roman Forum'] });
    expect(isOutdoor(pack[0])).toBe(true);
    expect(isOutdoor(null)).toBe(false);
    expect(rainyOps(PLAN, WISHES, BOOKED, [], '2026-10-27')).toMatchObject({ ok: false, status: 409 });
  });
});

describe('describing a change', () => {
  const diff = (changes: PlanDiff['changes'], walkDeltaM: number | null = null): PlanDiff => ({ ...EMPTY_DIFF, changes, walkDeltaM });
  const ch = (kind: PlanDiff['changes'][number]['kind'], title: string, date: string | null, fromDate: string | null = null) => ({ kind, wishId: title.toLowerCase(), title, date, fromDate, fromMin: null, toMin: null, reason: null });

  it('in a line', () => {
    expect(changeSummary(diff([ch('added', 'A', '2026-10-27'), ch('moved', 'B', '2026-10-28', '2026-10-27'), ch('dropped', 'C', null, '2026-10-27')], 1200))).toBe('1 added · 1 stop moves · 1 left out · 1.2 km more walking');
    expect(changeSummary(diff([]))).toBe('Small changes to the times');
  });

  it('a re-check is materially different when stops change days or drop, not when they are re-timed', () => {
    const shown = diff([ch('added', 'A', '2026-10-27')]);
    expect(materiallyDiffers(shown, diff([ch('added', 'A', '2026-10-27'), ch('retimed', 'B', '2026-10-27', '2026-10-27')]))).toBe(false);
    expect(materiallyDiffers(shown, diff([ch('added', 'A', '2026-10-28')]))).toBe(true);
    expect(materiallyDiffers(shown, diff([ch('added', 'A', '2026-10-27'), ch('dropped', 'B', null, '2026-10-27')]))).toBe(true);
  });

  it('the legacy option card the current app draws', () => {
    const verdict: Verdict = { fits: true, arriveMin: 850, departMin: 925, landedStage: 'afternoon', legInMin: 12, legOutMin: 8, legInMode: 'walk', legOutMode: 'walk', pushesOut: [], moves: [], reason: null };
    const place = { name: 'Palazzo Altemps', location: at(41.9, 12.47), osmId: 'way/3', address: null };
    const o = legacyOption(
      {
        kind: 'fill', title: 'Palazzo Altemps', why: 'Quiet.', scope: { date: '2026-10-27', stage: 'afternoon', stopId: null, wishId: null },
        ops: [{ op: 'addWish', wish: { title: 'Palazzo Altemps', placeQuery: null, priority: 'nice', durationMin: 75, partOfDay: 'afternoon', fixedDate: '2026-10-27', fixedStartMin: null, note: null, place } }],
        tradeoffs: { fits: true, fitText: '14:10–15:25 · 12 min walk in', walkMin: 3, walkKmPerDay: null, earlyStarts: null, toBook: null, costText: '€10', indoor: true, kidFriendly: null, lessVisited: true, pushesOut: [], moves: [] },
      },
      verdict,
      0,
    );
    expect(o).toEqual({
      id: '2026-10-27:afternoon:0', date: '2026-10-27', stage: 'afternoon', title: 'Palazzo Altemps', why: 'Quiet.', fit: '14:10–15:25 · 12 min walk in', indoor: true, kidFriendly: null, costText: '€10',
      wish: expect.objectContaining({ title: 'Palazzo Altemps', placeQuery: 'Palazzo Altemps', place }), verdict,
    });
    expect(legacyOption({ kind: 'day', title: 'x', why: '', scope: { date: null, stage: null, stopId: null, wishId: null }, ops: [], tradeoffs: {} as never }, verdict, 0)).toBeNull();
  });

  it('the emptiest open part of the earliest day, for a turn that could only talk', () => {
    expect(openSlot(PLAN, '2026-10-21')).toEqual({ date: '2026-10-27', stage: 'evening' });
    expect(openSlot(PLAN, '2026-11-01')).toBeNull();
  });
});

describe('reading requests', () => {
  it('POST proposals', () => {
    expect(readProposalRequest({ kind: 'swap', target: { stopId: 's1' } })).toEqual({ ok: true, request: { kind: 'swap', target: { stopId: 's1', wishId: null, date: null, stage: null, proposalId: null }, nudge: null, variant: null, withDate: null } });
    expect(readProposalRequest({ kind: 'fill', target: { date: '2026-10-27' } })).toMatchObject({ ok: false });
    expect(readProposalRequest({ kind: 'nudge', target: { proposalId: 'p1' }, nudge: 'cheaper' })).toMatchObject({ ok: true, request: { nudge: 'cheaper' } });
    expect(readProposalRequest({ kind: 'day', target: { date: '2026-10-27' }, variant: 'swap-days', withDate: '2026-10-28' })).toMatchObject({ ok: true, request: { variant: 'swap-days', withDate: '2026-10-28' } });
    expect(readProposalRequest({ kind: 'teleport' })).toMatchObject({ ok: false });
  });

  it('POST proposals/:pid', () => {
    expect(readDecision({ action: 'accept' })).toEqual({ ok: true, action: 'accept' });
    expect(readDecision({ action: 'reject', reason: 'too-far', note: ' Long walk ' })).toEqual({ ok: true, action: 'reject', reason: 'too-far', note: 'Long walk' });
    expect(readDecision({ action: 'reject', reason: 'meh' })).toEqual({ ok: true, action: 'reject', reason: 'other', note: null });
    expect(readDecision({ action: 'maybe' })).toMatchObject({ ok: false });
  });

  it('v7 options as a fill group', () => {
    const [d] = optionDrafts([{ date: '2026-10-27', stage: 'evening', title: 'Roscioli', placeQuery: 'Roscioli, Rome', durationMin: 75, why: 'Deli.', indoor: true, kidFriendly: null, costText: null }]);
    expect(d).toMatchObject({ kind: 'fill', group: 'options', scope: { date: '2026-10-27', stage: 'evening' }, ops: [{ op: 'addWish', wish: { placeQuery: 'Roscioli, Rome', replacesMeal: 'dinner', partOfDay: 'any', fixedDate: '2026-10-27' } }] });
  });
});
