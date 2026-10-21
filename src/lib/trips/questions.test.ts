import { describe, expect, it } from 'vitest';
import type { PackPlace } from './decisions';
import type { Booking, PlannedDay, SolvedPlan, Stay, Trip, Wish } from './model';
import {
  answerSummary,
  briefPatchOps,
  briefQuestions,
  canInvert,
  clashQuestions,
  generateQuestions,
  inverseOps,
  planSignature,
  reactionQuestions,
  researchQuestions,
  shortLabel,
  tieQuestions,
  uncoveredNights,
  urgency,
  whyLine,
  type GenContext,
} from './questions';
import { provenanceKeys } from './provenance-ops';
import { emptyFacts } from './research';

const TRIP: Trip = { id: 't', ownerEmail: 'o@example.test', title: 'Rome', destination: 'Rome', timeZone: 'Europe/Rome', startDate: '2026-10-26', endDate: '2026-10-30', pace: 'normal', modes: ['walk'], status: 'planned', notes: null, dayLoads: {} };
const FLAT: Stay = { id: 'flat', name: 'The flat', address: null, location: { lat: 41.8992, lng: 12.4731 }, fromDate: '2026-10-26', toDate: '2026-10-31', checkInMin: null, checkOutMin: null };

function wish(id: string, over: Partial<Wish> = {}): Wish {
  return { id, title: id[0].toUpperCase() + id.slice(1), place: { name: id, location: { lat: 41.9, lng: 12.48 }, osmId: `node/${id.length}`, address: null }, priority: 'nice', durationSec: 3600, partOfDay: 'any', fixedDate: null, fixedStartMin: null, locked: false, suggested: false, skipped: false, facts: null, note: null, sortHint: 0, replacesMeal: null, ...over };
}

function day(date: string, ids: string[], start = 600): PlannedDay {
  return {
    date,
    stayId: 'flat',
    warnings: [],
    legs: [],
    stops: ids.map((id, i) => ({ id, kind: 'wish' as const, wishId: id, title: id, location: { lat: 41.9, lng: 12.48 }, arriveMin: start + i * 90, departMin: start + i * 90 + 60, waitSec: 0, locked: false, bookingId: null, warnings: [] })),
  };
}

function ctx(over: Partial<GenContext> = {}): GenContext {
  return {
    trip: TRIP,
    stays: [FLAT],
    wishes: [],
    bookings: [],
    profile: { travellers: [{ name: 'You', relation: null, notes: [] }], preferences: [], constraints: [], history: [], gatheredAt: 'x' },
    plan: { days: ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30'].map((d) => day(d, [])), dropped: [], warnings: [], score: 0 },
    places: [],
    calendar: [],
    rejected: [],
    alternatives: [],
    today: '2026-10-21',
    ...over,
  };
}

const pack = (over: Partial<PackPlace> & { name: string }): PackPlace => ({ id: `pp-${over.name}`, kind: 'sight', tags: [], place: { name: over.name, location: { lat: 41.9, lng: 12.48 }, osmId: null, address: null }, why: null, neighbourhood: null, durationMin: 60, indoor: null, kidFriendly: null, costText: null, lessVisited: false, bookingRequired: null, bookAheadDays: null, facts: null, image: null, wikidata: null, sources: [], status: 'candidate', rejectReason: null, wishId: null, checkedAt: null, ...over });

describe('brief questions', () => {
  it('a stay that misses nights: stretch it (the assumption), or somewhere else', () => {
    const short = { ...FLAT, toDate: '2026-10-28' };
    expect(uncoveredNights(TRIP, [short])).toEqual(['2026-10-28', '2026-10-29']);
    const [q] = briefQuestions(ctx({ stays: [short] }));
    expect(q).toMatchObject({
      key: 'brief:stay-nights:2026-10-28,2026-10-29',
      prompt: 'No stay yet for 2 nights (Wed, Thu). Stay at The flat then too?',
      defaultIndex: 0,
      answers: [{ label: 'Yes, the same place', ops: [{ op: 'updateStay', id: 'flat', fields: { fromDate: '2026-10-26', toDate: '2026-10-30' } }] }, { label: 'Somewhere else', ops: [] }],
    });
    expect(briefQuestions(ctx())).toEqual([]);
    // No stay at all is a typed answer (the brief asks), not a chip.
    expect(briefQuestions(ctx({ stays: [] }))).toEqual([]);
  });

  it('who is going, only when nothing says', () => {
    const [q] = briefQuestions(ctx({ profile: null }));
    expect(q).toMatchObject({ key: 'brief:travellers', answers: [{ label: 'Adults only', ops: [] }, { label: 'With children', ops: [{ op: 'setTrip', fields: { pace: 'relaxed' } }] }] });
  });
});

describe('research questions', () => {
  const colosseum = wish('colosseum', { title: 'Colosseum underground', facts: { ...emptyFacts('brief', null), bookingRequired: true, bookAheadDays: 14 } });
  const plan: SolvedPlan = { days: [day('2026-10-26', []), day('2026-10-27', ['borghese']), day('2026-10-28', ['colosseum', 'park'])], dropped: [], warnings: [], score: 0 };

  it('needs booking: the deadline is the visit day minus the days ahead', () => {
    const [q] = researchQuestions(ctx({ wishes: [colosseum], plan, today: '2026-10-01' }));
    expect(q).toMatchObject({
      key: 'research:book:colosseum',
      prompt: 'Colosseum underground needs booking about 14 days ahead — by Wed 14 Oct. Keep it?',
      deadline: '2026-10-14',
      answers: [{ label: "Keep it, I'll book", ops: [{ op: 'addBooking', booking: { wishId: 'colosseum', title: 'Colosseum underground', date: '2026-10-28', status: 'to-book' } }] }, { label: 'Skip it', ops: [{ op: 'updateWish', id: 'colosseum', fields: { skipped: true } }] }],
    });
    // Past the deadline it says so, and the deadline is today.
    const [late] = researchQuestions(ctx({ wishes: [colosseum], plan }));
    expect(late.prompt).toBe('Colosseum underground usually books up 14 days ahead — it may already be full. Keep it?');
    expect(late.deadline).toBe('2026-10-21');
    // Booked already: nothing to ask.
    const booked: Booking = { id: 'b', wishId: 'colosseum', title: 'x', date: null, startMin: null, endMin: null, reference: null, url: null, documentId: null, status: 'booked' };
    expect(researchQuestions(ctx({ wishes: [colosseum], plan, bookings: [booked] }))).toEqual([]);
    // The pack's facts count when the wish has none of its own.
    const bare = wish('colosseum', { title: 'Colosseum underground' });
    expect(researchQuestions(ctx({ wishes: [bare], plan, places: [pack({ name: 'Colosseum underground', bookingRequired: true, bookAheadDays: 14, facts: { ...emptyFacts('brief', null), bookingRequired: true, bookAheadDays: 14 } })] }))).toHaveLength(1);
  });

  it('closed on its day: move it to a day it is open', () => {
    const borghese = wish('borghese', { title: 'Borghese Gallery', fixedDate: '2026-10-26', facts: { ...emptyFacts('brief', null), openingHoursText: 'Tu-Su 09:00-19:00; Mo off' } });
    const p: SolvedPlan = { ...plan, days: [day('2026-10-26', ['borghese']), day('2026-10-27', [])] };
    const [q] = researchQuestions(ctx({ wishes: [borghese], plan: p }));
    expect(q).toMatchObject({ key: 'research:closed:borghese:2026-10-26', prompt: 'Borghese Gallery is closed on Mon 26 Oct. Move it to Tue?', answers: [{ label: 'Move it to Tue', ops: [{ op: 'updateWish', id: 'borghese', fields: { fixedDate: '2026-10-27' } }] }, { label: 'Skip it' }] });
  });

  it('rain on a day with outdoor stops: keep, move to a dry day, or indoor instead', () => {
    const park = wish('park', { title: 'Villa Borghese gardens' });
    const calendar = [{ date: '2026-10-28', kind: 'weather' as const, text: 'Rain likely in the afternoon', placeId: null, sources: [] }];
    const places = [pack({ name: 'Villa Borghese gardens', kind: 'park', indoor: false }), pack({ name: 'Palazzo Altemps', kind: 'museum', indoor: true, place: { name: 'Palazzo Altemps', location: { lat: 41.9007, lng: 12.4728 }, osmId: 'way/1', address: null } })];
    const [q] = researchQuestions(ctx({ wishes: [park], plan, calendar, places }));
    expect(q.key).toBe('research:rain:2026-10-28');
    expect(q.prompt).toBe('Rain likely Wed afternoon. Change the outdoor stops (Villa Borghese gardens)?');
    expect(q.answers.map((a) => a.label)).toEqual(['Keep the plan', 'Move them to Mon', 'Indoor places instead']);
    expect(q.answers[2].ops).toEqual([
      { op: 'updateWish', id: 'park', fields: { skipped: true } },
      { op: 'addWish', wish: expect.objectContaining({ title: 'Palazzo Altemps', fixedDate: '2026-10-28', place: { name: 'Palazzo Altemps', location: { lat: 41.9007, lng: 12.4728 }, osmId: 'way/1', address: null } }) },
    ]);
  });
});

describe('clash, tie and reaction questions', () => {
  it('a must the plan left out: leave it, drop something, or a fuller day', () => {
    const must = wish('vatican', { title: 'Vatican Museums', priority: 'must', fixedDate: '2026-10-27' });
    const other = wish('gelato', { title: 'Gelato crawl' });
    const plan: SolvedPlan = { days: [day('2026-10-27', ['gelato'])], dropped: [{ wishId: 'vatican', reason: 'no time left that day' }], warnings: [], score: 0 };
    const [q] = clashQuestions(ctx({ wishes: [must, other], plan }));
    expect(q).toMatchObject({ key: 'clash:dropped:vatican', prompt: "Vatican Museums doesn't fit on Tue 27 Oct. What should give?", defaultIndex: 0 });
    expect(q.answers.map((a) => [a.label, a.ops])).toEqual([
      ['Leave it out for now', []],
      ['Drop Gelato crawl', [{ op: 'updateWish', id: 'gelato', fields: { skipped: true } }]],
      ['A fuller Tue', [{ op: 'setTrip', fields: { dayLoads: { '2026-10-27': 'full' } } }]],
    ]);
  });

  it('two shapes within 10 %: which suits you (never applied unasked)', () => {
    const alternatives = [{ groupId: 'shapes:1', kind: 'shape' as const, date: null, items: [
      { id: 'p1', title: 'Ancient Rome first, slow afternoons', ops: [{ op: 'addWish' as const, wish: { title: 'A' } as never }], score: 100 },
      { id: 'p2', title: 'Neighbourhood days', ops: [], score: 105 },
      { id: 'p3', title: 'The big three', ops: [], score: 140 },
    ] }];
    const [q] = tieQuestions(ctx({ alternatives }));
    expect(q).toMatchObject({ key: 'tie:shapes:1', origin: 'tie', assume: false, answers: [{ label: 'Ancient Rome first, slow…' }, { label: 'Neighbourhood days' }] });
    expect(tieQuestions(ctx({ alternatives: [{ ...alternatives[0], items: [alternatives[0].items[0], alternatives[0].items[2]] }] }))).toEqual([]);
  });

  it('two turn-downs for the same reason become a standing preference', () => {
    const far = wish('appia', { title: 'Appian Way', place: { name: 'Appia', location: { lat: 41.85, lng: 12.52 }, osmId: null, address: null } });
    const near = wish('navona', { title: 'Piazza Navona', place: { name: 'Navona', location: { lat: 41.8992, lng: 12.4731 }, osmId: null, address: null } });
    const plan: SolvedPlan = { days: [day('2026-10-27', ['appia', 'navona'])], dropped: [], warnings: [], score: 0 };
    const rejected = [{ reason: 'too-far' as const, kind: null, title: 'x' }, { reason: 'too-far' as const, kind: null, title: 'y' }];
    const [q] = reactionQuestions(ctx({ wishes: [far, near], plan, rejected }));
    expect(q).toMatchObject({ key: 'reaction:too-far', prompt: 'Keep everything within 20 minutes’ walk of where you’re staying?' });
    expect(q.answers[1]).toEqual({ label: 'Yes, keep it close', ops: [{ op: 'updateWish', id: 'appia', fields: { skipped: true } }], remember: 'Keep places within about 20 minutes’ walk of where we stay' });
    expect(reactionQuestions(ctx({ wishes: [far, near], plan, rejected: rejected.slice(0, 1) }))).toEqual([]);
    const museums = [{ reason: 'not-for-us' as const, kind: 'museum' as const, title: 'a' }, { reason: 'not-for-us' as const, kind: 'museum' as const, title: 'b' }];
    const m = wish('altemps', { title: 'Palazzo Altemps' });
    const [fewer] = reactionQuestions(ctx({ wishes: [m], plan: { ...plan, days: [day('2026-10-27', ['altemps'])] }, rejected: museums, places: [pack({ name: 'Palazzo Altemps', kind: 'museum' })] }));
    expect(fewer).toMatchObject({ key: 'reaction:fewer:museum', prompt: 'Fewer museums?' });
  });

  it('every generator once, research first', () => {
    const qs = generateQuestions(ctx({ profile: null, stays: [{ ...FLAT, toDate: '2026-10-29' }] }));
    expect(qs.map((q) => q.key)).toEqual(['brief:stay-nights:2026-10-29', 'brief:travellers']);
  });
});

describe('checking helpers', () => {
  it('urgency: ×3 within 3 days, ×2 within 14', () => {
    expect([urgency(null, '2026-10-21'), urgency('2026-11-30', '2026-10-21'), urgency('2026-11-01', '2026-10-21'), urgency('2026-10-23', '2026-10-21')]).toEqual([1, 1, 2, 3]);
  });

  it('a plan signature compares new places by name and reads the solver facts', () => {
    const a: SolvedPlan = { days: [{ ...day('2026-10-27', []), stops: [{ ...day('d', ['x']).stops[0], wishId: 'dry-wish-1', title: 'Altemps' }] }], dropped: [], warnings: [], score: 0 };
    const b: SolvedPlan = { days: [{ ...day('2026-10-27', []), stops: [{ ...day('d', ['x']).stops[0], wishId: 'dry-wish-1', title: 'Pantheon' }] }], dropped: [], warnings: [], score: 0 };
    expect(planSignature(a)).not.toBe(planSignature(b));
    expect(planSignature(a, { pace: 'normal' })).not.toBe(planSignature(a, { pace: 'relaxed' }));
  });

  it('what an answer changes, in a line', () => {
    expect(answerSummary({ lines: [], changes: [], dates: [], walkDeltaM: null, dropped: [] })).toBeNull();
    expect(answerSummary({ lines: [], dates: [], walkDeltaM: null, dropped: [], changes: [{ kind: 'moved', wishId: 'w', title: 'Pantheon', date: '2026-10-29', fromDate: '2026-10-27', fromMin: 600, toMin: 660, reason: null }] })).toBe('Thu 29 Oct: Pantheon moves to Thu');
    expect(answerSummary({ lines: [], dates: [], walkDeltaM: null, dropped: [], changes: [
      { kind: 'added', wishId: 'a', title: 'A', date: '2026-10-28', fromDate: null, fromMin: null, toMin: 600, reason: null },
      { kind: 'retimed', wishId: 'b', title: 'B', date: '2026-10-28', fromDate: '2026-10-28', fromMin: 600, toMin: 700, reason: null },
    ] })).toBe('Wed 28 Oct: 2 stops change');
    expect(whyLine(['2026-10-28'], 3)).toBe('Changes Wed 28 Oct (3 stops)');
    expect(shortLabel('Ancient Rome first, slow afternoons')).toBe('Ancient Rome first, slow…');
    expect(shortLabel('Carry on')).toBe('Carry on');
  });

  it('a brief answer as ops', () => {
    expect(briefPatchOps({ field: 'pace', pace: 'relaxed' })).toEqual([{ op: 'setTrip', fields: { pace: 'relaxed' } }]);
    expect(briefPatchOps({ field: 'travellers', travellers: [{ name: 'Sam', age: 9 }] })).toEqual([{ op: 'updateProfile', profile: { travellers: [{ name: 'Sam', relation: null, notes: [], age: 9, personId: null }] } }]);
    expect(briefPatchOps(null)).toEqual([]);
  });

  it('putting an assumed answer back', () => {
    const before = { trip: { ...TRIP, dayLoads: { '2026-10-27': 'light' as const } }, stays: [FLAT], wishes: [wish('a', { fixedDate: '2026-10-27' })], bookings: [], profile: null };
    const after = { stays: [{ ...FLAT, toDate: '2026-11-01' }], wishes: [...before.wishes, wish('new', { title: 'Altemps' })], bookings: [] };
    const ops = [
      { op: 'updateStay' as const, id: 'flat', fields: { toDate: '2026-11-01' } },
      { op: 'setTrip' as const, fields: { dayLoads: { '2026-10-27': 'full' as const, '2026-10-28': 'light' as const } } },
      { op: 'updateWish' as const, id: 'a', fields: { fixedDate: '2026-10-28', skipped: true } },
      { op: 'addWish' as const, wish: { title: 'Altemps' } as never },
    ];
    expect(inverseOps(ops, before, after)).toEqual([
      { op: 'removeWish', id: 'new' },
      { op: 'updateWish', id: 'a', fields: { fixedDate: '2026-10-27', skipped: false } },
      { op: 'setTrip', fields: { dayLoads: { '2026-10-27': 'light', '2026-10-28': 'normal' } } },
      { op: 'updateStay', id: 'flat', fields: { toDate: '2026-10-31' } },
    ]);
    expect(canInvert([{ op: 'remember', text: 'x', category: 'preferences' }])).toBe(false);
    expect(canInvert([{ op: 'updateStay', id: 'flat', fields: { placeQuery: 'elsewhere' } }])).toBe(false);
  });

  it('which brief facts the ops touched', () => {
    const before = { stays: [], wishes: [], bookings: [] };
    const after = { stays: [{ id: 's9', name: 'Hotel' }], wishes: [{ id: 'w9', title: 'Vatican tour' }], bookings: [{ id: 'b9', title: 'Vatican tour' }], transport: [{ id: 't9' }] };
    expect(
      provenanceKeys(
        [
          { op: 'setTrip', fields: { startDate: '2026-10-26', pace: 'relaxed' } },
          { op: 'addStay', name: 'Hotel', placeQuery: 'x', fromDate: 'a', toDate: 'b', checkInMin: null, checkOutMin: null },
          { op: 'addWish', wish: { title: 'Vatican tour' } as never },
          { op: 'addBooking', booking: { title: 'Vatican tour' } as never },
          { op: 'addTransport', segment: {} as never },
        ],
        before,
        after,
      ),
    ).toEqual(['dates', 'pace', 'stay:s9', 'wish:w9', 'booking:b9', 'transport:t9']);
  });
});
