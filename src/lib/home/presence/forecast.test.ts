import { describe, expect, it } from 'vitest';
import {
  buildForecast,
  correctedShare,
  departureGrid,
  learnedTravel,
  localClock,
  nextMoves,
  routinesOf,
  watchItems,
  type ForecastCorrection,
  type Routine,
} from './forecast';
import type { LiveState, PresenceInsights, RouteInsight } from './insights';

// Weekdays of 7–25 Sep 2026 (BST). 07:20Z is 08:20 local.
const WEEKDAYS = ['07', '08', '09', '10', '11', '14', '15', '16', '17', '18', '21', '22', '23', '24', '25'].map((d) => `2026-09-${d}`);

function route(over: Partial<RouteInsight> & { starts: string[]; minutes?: number[] }): RouteInsight {
  const minutes = over.minutes ?? over.starts.map((_, i) => 15 + (i % 5));
  return {
    id: `${over.subject ?? 'alex'}:home:school:vehicle`,
    subject: 'alex', person: 'Alex', fromId: 'home', toId: 'school', from: 'Home', to: 'School',
    samples: over.starts.length, average: 17, median: 17, low: 15, high: 19, departure: '08:20', morning: 0,
    mode: 'vehicle', broken: 0,
    trips: over.starts.map((s, i) => ({ start: s, minutes: minutes[i], broken: false })),
    ...over,
  };
}
const schoolRun = (subject = 'alex', at = '07:20') =>
  route({ subject, person: subject === 'alex' ? 'Alex' : 'Sam', id: `${subject}:home:school:vehicle`, starts: WEEKDAYS.slice(0, 12).map((d) => `${d}T${at}:00Z`) });

const atHome = (subject = 'alex', lastSeen = '2026-09-28T07:40:00Z'): LiveState => ({
  subject, placeId: 'home', since: '2026-09-27T17:00:00Z', lastSeen, moving: null,
});

describe('local clock', () => {
  it('reads Europe/London, not UTC', () => {
    expect(localClock(new Date('2026-09-28T07:20:00Z'))).toEqual({ weekday: 0, date: '2026-09-28', minute: 8 * 60 + 20 });
    expect(localClock(new Date('2026-12-01T07:20:00Z')).minute).toBe(7 * 60 + 20);
  });
});

describe('routines', () => {
  const now = new Date('2026-09-28T06:00:00Z');
  it('finds the weekday school run with its usual time and how often it ran', () => {
    const [r] = routinesOf([schoolRun()], now, 28);
    expect(r).toMatchObject({ dayType: 'weekday', departure: '08:20', days: 12, minutes: { median: 16.5 } });
    // Counted from the first run (7 Sep), not the window's start.
    expect(r.of).toBe(15);
  });
  it('needs three runs near one time, and keeps odd departures out of the slot', () => {
    const odd = route({ starts: ['2026-09-08T07:20:00Z', '2026-09-09T13:00:00Z', '2026-09-10T18:00:00Z'] });
    expect(routinesOf([odd], now, 28)).toHaveLength(0);
  });
  it('leaves broken trips out of the journey time', () => {
    const r = route({ starts: WEEKDAYS.slice(0, 5).map((d) => `${d}T07:20:00Z`), minutes: [17, 16, 18, 17, 17] });
    r.trips.push({ start: '2026-09-15T07:20:00Z', minutes: 140, broken: true });
    expect(routinesOf([r], now, 28)[0].minutes.high).toBeLessThan(19);
  });
});

describe('next move', () => {
  it('offers the routine due later today from where they are', () => {
    const now = new Date('2026-09-28T06:45:00Z'); // Monday 07:45 local
    const [move] = nextMoves(routinesOf([schoolRun()], now, 28), [atHome()], [], now);
    expect(move).toMatchObject({ kind: 'routine', to: 'School', days: 12 });
    expect(localClock(new Date(move.leaveAt)).minute).toBe(8 * 60 + 20);
    expect(+new Date(move.arriveTo)).toBeGreaterThan(+new Date(move.arriveFrom));
  });
  it('says nothing for someone away from the routine’s start, or at the weekend', () => {
    const monday = new Date('2026-09-28T06:45:00Z');
    const routines = routinesOf([schoolRun()], monday, 28);
    expect(nextMoves(routines, [{ ...atHome(), placeId: 'gran' }], [], monday)).toEqual([]);
    const saturday = new Date('2026-09-26T06:45:00Z');
    expect(nextMoves(routines, [atHome()], [], saturday)).toEqual([]);
  });
  it('does not offer a routine that already ran today', () => {
    const now = new Date('2026-09-25T08:00:00Z');
    const routines = routinesOf([route({ starts: WEEKDAYS.map((d) => `${d}T07:20:00Z`) })], now, 28);
    expect(nextMoves(routines, [atHome()], [], now)).toEqual([]);
  });
  it('prefers a live arrival estimate', () => {
    const now = new Date('2026-09-28T07:25:00Z');
    const arrival = { id: 'x', subject: 'alex', person: 'Alex', from: 'Home', to: 'School', toId: 'school', departedAt: '2026-09-28T07:20:00Z',
      observedAt: '2026-09-28T07:25:00Z', eta: '2026-09-28T07:37:00Z', earliest: '2026-09-28T07:35:00Z', latest: '2026-09-28T07:40:00Z',
      minutesLeft: 12, samples: 12, confidence: 'established' as const, returningHome: false };
    expect(nextMoves([], [{ ...atHome(), placeId: null }], [arrival], now)[0]).toMatchObject({ kind: 'arriving', to: 'School' });
  });
});

describe('watch', () => {
  const names = new Map([['alex', 'Alex']]);
  const homeIds = new Set(['home']);
  it('flags a dependable routine that has not run, from a fresh reading at its start', () => {
    const now = new Date('2026-09-28T07:55:00Z'); // 08:55 local, window ends 08:20
    const routines = routinesOf([schoolRun()], now, 28);
    const [w] = watchItems({ routines, routes: [schoolRun()], live: [atHome('alex', '2026-09-28T07:50:00Z')], arrivals: [], names, homeIds, now });
    expect(w).toMatchObject({ kind: 'overdue', title: "Alex hasn't left for School" });
    expect(w.key).toBe('overdue:alex:home:school:vehicle:weekday:2026-09-28');
  });
  it('stays silent when the reading is stale — a dead phone is not a missed school run', () => {
    const now = new Date('2026-09-28T07:55:00Z');
    const routines = routinesOf([schoolRun()], now, 28);
    expect(watchItems({ routines, routes: [], live: [atHome('alex', '2026-09-28T06:00:00Z')], arrivals: [], names, homeIds, now })
      .filter((w) => w.kind === 'overdue')).toEqual([]);
  });
  it('flags a journey that has gone well past the slowest usual trip', () => {
    const now = new Date('2026-09-28T08:00:00Z');
    const moving: LiveState = { subject: 'alex', placeId: null, since: null, lastSeen: '2026-09-28T07:59:00Z', moving: { fromId: 'home', departedAt: '2026-09-28T07:20:00Z' } };
    const [w] = watchItems({ routines: [], routes: [schoolRun()], live: [moving], arrivals: [], names, homeIds, now });
    expect(w).toMatchObject({ kind: 'running-long', severity: 'alert' });
  });
  it('flags hours of silence away from home in the day, not at home and not at night', () => {
    const day = new Date('2026-09-28T13:00:00Z');
    const away: LiveState = { subject: 'alex', placeId: 'shop', since: null, lastSeen: '2026-09-28T09:00:00Z', moving: null };
    expect(watchItems({ routines: [], routes: [], live: [away], arrivals: [], names, homeIds, now: day })[0].kind).toBe('quiet');
    expect(watchItems({ routines: [], routes: [], live: [{ ...away, placeId: 'home' }], arrivals: [], names, homeIds, now: day })).toEqual([]);
    expect(watchItems({ routines: [], routes: [], live: [away], arrivals: [], names, homeIds, now: new Date('2026-09-28T23:30:00Z') })).toEqual([]);
  });
});

describe('travel time', () => {
  it('uses the person’s own trips first, then the household’s', () => {
    const mine = schoolRun('alex');
    const theirs = route({ subject: 'sam', person: 'Sam', id: 'sam:home:school:vehicle', starts: WEEKDAYS.slice(0, 4).map((d) => `${d}T07:00:00Z`), minutes: [30, 31, 29, 30] });
    expect(learnedTravel([mine, theirs], 'home', 'school', 'alex')).toMatchObject({ source: 'person', median: 16.5, samples: 12 });
    expect(learnedTravel([mine, theirs], 'home', 'school', 'jo')).toMatchObject({ source: 'household' });
    expect(learnedTravel([mine], 'home', 'gran', 'alex')).toBeNull();
  });
});

describe('the whole forecast', () => {
  it('counts two people leaving together as one departure', () => {
    const grid = departureGrid([schoolRun('alex'), schoolRun('sam')], new Set(['home']));
    expect(grid[0][8]).toBe(3); // three Mondays in the sample, 08:xx local
    expect(grid.flat().reduce((a, b) => a + b, 0)).toBe(12);
  });
  it('builds from an insights result', () => {
    const now = new Date('2026-09-28T06:45:00Z');
    const insights = { generatedAt: now.toISOString(), days: 28, people: [{ subject: 'alex', displayName: 'Alex' }], routes: [schoolRun()],
      arrivals: [], live: [atHome()], groups: [], together: 0, daily: [] } as unknown as PresenceInsights;
    const f = buildForecast(insights, new Set(['home']), now);
    expect(f.routines).toHaveLength(1);
    expect(f.next[0].to).toBe('School');
    expect(f.departures.flat().reduce((a, b) => a + b, 0)).toBe(12);
    const _typed: Routine = f.routines[0];
    expect(_typed.id).toContain('weekday');
  });
});

describe('corrections ("that’s wrong")', () => {
  const now = new Date('2026-09-28T06:45:00Z'); // Monday 07:45 local
  const routineId = 'alex:home:school:vehicle:weekday';
  const wrong = (date: string): ForecastCorrection => ({ subject: 'alex', kind: 'routine', routineId, departedAt: null, date });

  it('takes the move off for the rest of the day it was said', () => {
    const routines = routinesOf([schoolRun()], now, 28);
    expect(nextMoves(routines, [atHome()], [], now, [wrong('2026-09-28')])).toEqual([]);
    // Somebody else's routine is untouched.
    expect(nextMoves(routines, [atHome()], [], now, [{ ...wrong('2026-09-28'), subject: 'sam' }])).toHaveLength(1);
  });

  it('counts each right correction against the routine afterwards', () => {
    const [r] = routinesOf([schoolRun()], now, 28);
    expect(correctedShare(r)).toBeCloseTo(12 / 15);
    // Two earlier weekdays it did not run on, each said in advance: 12 / (15 + 4).
    const said = [wrong('2026-09-28'), wrong('2026-09-29')];
    expect(correctedShare(r, said)).toBeCloseTo(12 / 19);
    // A correction on a day it ran anyway was wrong itself, and counts for nothing.
    expect(correctedShare(r, [wrong('2026-09-21')])).toBeCloseTo(12 / 15);
  });

  it('drops a routine corrected often enough below the share it is offered at', () => {
    const now2 = new Date('2026-09-29T06:45:00Z');
    const thin = route({ starts: WEEKDAYS.slice(9, 15).map((d) => `${d}T07:20:00Z`) });
    const routines = routinesOf([thin], now2, 28);
    expect(nextMoves(routines, [atHome()], [], now2)).toHaveLength(1);
    // 6 of 7 weekdays; six corrected days make it 6 / (7 + 12), under 0.35.
    const days = ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-07', '2026-09-28'].map(wrong);
    expect(nextMoves(routines, [atHome()], [], now2, days)).toEqual([]);
  });

  it('hides a live journey somebody said is not going there', () => {
    const at = new Date('2026-09-28T07:25:00Z');
    const arrival = { id: 'x', subject: 'alex', person: 'Alex', from: 'Home', to: 'Station', toId: 'station', departedAt: '2026-09-28T07:20:00Z',
      observedAt: '2026-09-28T07:25:00Z', eta: '2026-09-28T07:37:00Z', earliest: '2026-09-28T07:35:00Z', latest: '2026-09-28T07:40:00Z',
      minutesLeft: 12, samples: 12, confidence: 'established' as const, returningHome: false };
    const said: ForecastCorrection = { subject: 'alex', kind: 'arriving', routineId: null, departedAt: arrival.departedAt, date: '2026-09-28' };
    expect(nextMoves([], [{ ...atHome(), placeId: null }], [arrival], at, [said])).toEqual([]);
  });

  it('does not call a corrected routine overdue', () => {
    const late = new Date('2026-09-28T07:55:00Z');
    const routines = routinesOf([schoolRun()], late, 28);
    const live = [atHome('alex', '2026-09-28T07:50:00Z')];
    const input = { routines, routes: [schoolRun()], live, arrivals: [], names: new Map([['alex', 'Alex']]), homeIds: new Set(['home']), now: late };
    expect(watchItems(input).filter((w) => w.kind === 'overdue')).toHaveLength(1);
    expect(watchItems({ ...input, corrections: [wrong('2026-09-28')] }).filter((w) => w.kind === 'overdue')).toEqual([]);
  });
});
