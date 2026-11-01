import { describe, expect, it } from 'vitest';
import {
  compareMonths, dominantSources, historyView, londonMidnight, mergeMonth, monthsTouching,
  type MonthPerson, type MonthSummary,
} from './patterns-history';

function person(over: Partial<MonthPerson> = {}): MonthPerson {
  return {
    subject: 'sam', displayName: 'Sam', source: 'app', coverage: 0.9, observedDays: 28, awayDays: 0, localDays: 28,
    outPerDay: 3, trips: 60, travelHours: 20, distanceKm: 400, roamKm: 4, distinctPlaces: 20, aloneOutShare: 0.3, predictability: 0.75,
    firstOut: { weekday: '08:00', weekend: '10:00' }, lastHome: { weekday: '17:00', weekend: '18:00' },
    steps: 6000, stepDays: 28, categories: {}, places: [], routines: [], weekdays: [4, 4, 4, 4, 4, 4, 4], slots: {}, ...over,
  };
}
function month(key: string, people: MonthPerson[], over: Partial<MonthSummary> = {}): MonthSummary {
  return {
    month: key, version: 1, builtAt: '', from: '', to: '', coveredDays: 30, monthDays: 30, final: true,
    people, pairs: [], household: { categories: {}, outings: 0, medianOuting: null }, ...over,
  };
}

describe('months', () => {
  it('starts a month at London midnight, summer or winter', () => {
    expect(new Date(londonMidnight('2026-10-01')).toISOString()).toBe('2026-09-30T23:00:00.000Z');
    expect(new Date(londonMidnight('2026-11-01')).toISOString()).toBe('2026-11-01T00:00:00.000Z');
  });

  it('lists the months a window touches, oldest first', () => {
    const m = monthsTouching(Date.parse('2026-08-03T12:00:00Z'), Date.parse('2026-11-01T12:00:00Z'));
    expect(m.map((x) => x.month)).toEqual(['2026-08', '2026-09', '2026-10', '2026-11']);
    expect(m[2].end).toBe(m[3].start);
  });

  it('never replaces a finished month with one built from less of it', () => {
    const full = month('2026-09', [person()]);
    const less = month('2026-09', [person({ outPerDay: 9 })], { coveredDays: 12 });
    const h = mergeMonth(mergeMonth({ months: {} }, full), less);
    expect(h.months['2026-09'].people[0].outPerDay).toBe(3);
    // A month still running is replaced every night.
    const running = mergeMonth({ months: {} }, month('2026-11', [person()], { final: false, coveredDays: 1 }));
    expect(mergeMonth(running, month('2026-11', [person()], { final: false, coveredDays: 2 })).months['2026-11'].coveredDays).toBe(2);
  });
});

describe('compareMonths', () => {
  it('names what moved enough, in words', () => {
    const sport = { category: 'sport' as const, weekday: 3, rate: 0.8, hits: 4, of: 5, usual: '17:00' };
    const was = month('2026-09', [person({ routines: [sport], slots: { sport: [0, 0, 0, 4, 0, 0, 0] } })]);
    const now = month('2026-10', [person({ outPerDay: 4.5, steps: 7500, aloneOutShare: 0.5, slots: { sport: [0, 0, 0, 1, 0, 0, 0] } })]);
    const texts = compareMonths(was, now).map((c) => c.text);
    expect(texts).toContain('Sam was out more in October than in September: 4.5 hours a day against 3.');
    expect(texts).toContain('Sam walked more in October: 7,500 steps a day against 6,000 in September.');
    expect(texts.some((t) => t.startsWith('Sam spent more of their time out without anyone from home'))).toBe(true);
    expect(texts).toContain('Sam’s sport & fitness on Thursdays did not hold in October: 1 of 4, against 4 of 5 in September.'.replace('’', "'"));
  });

  it('never calls a routine faded for missing the month’s top list', () => {
    const sport = { category: 'sport' as const, weekday: 3, rate: 0.8, hits: 4, of: 5, usual: '17:00' };
    const was = month('2026-09', [person({ routines: [sport] })]);
    // October still had it three Thursdays of four; it just was not among the strongest.
    const now = month('2026-10', [person({ slots: { sport: [0, 0, 0, 3, 0, 0, 0] } })]);
    expect(compareMonths(was, now)).toEqual([]);
  });

  it('compares nothing across a change of tracker, or off too few days', () => {
    const was = month('2026-09', [person({ source: 'life360' })]);
    // person() is the app by default: a different tracker.
    expect(compareMonths(was, month('2026-10', [person({ outPerDay: 6 })]))).toEqual([]);
    expect(compareMonths(month('2026-09', [person()]), month('2026-10', [person({ outPerDay: 6, localDays: 6 })]))).toEqual([]);
  });

  it('compares the last two finished months only', () => {
    const v = historyView({ months: {
      '2026-09': month('2026-09', [person()]), '2026-10': month('2026-10', [person({ outPerDay: 5 })]),
      '2026-11': month('2026-11', [person({ outPerDay: 0 })], { final: false }),
    } });
    expect(v.compared).toEqual(['2026-09', '2026-10']);
    expect(v.changes).toHaveLength(1);
    expect(historyView({ months: { '2026-11': month('2026-11', [person()], { final: false }) } }).compared).toBeNull();
  });

  it('takes the tracker that wrote most of a person\'s rows', () => {
    const s = dominantSources([{ subject: 'a', source: 'poll' }, { subject: 'a', source: 'companion' }, { subject: 'a', source: 'companion' },
      { subject: 'b', source: 'poll' }, { subject: 'b', source: 'backfill' }]);
    expect(s.get('a')).toBe('app');
    // Polled and backfilled rows are both Life360.
    expect(s.get('b')).toBe('life360');
  });
});
