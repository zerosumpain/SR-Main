import { describe, it, expect } from 'vitest';
import {
  detectCrossings,
  eventId,
  isDuplicate,
  raisesCrossing,
  stepCrossings,
  type CrossingPlace,
  type InsideState,
  type TrailFix,
} from './crossings';

// Made-up coordinates. A fix `m` metres due north of the place's centre.
const PLACE: CrossingPlace = { id: 'p1', lat: 51.0, lon: -1.0, radiusM: 100 };
const M_PER_DEG_LAT = 111_195;
function north(m: number, accuracyM: number | null = 10, id = 1, minute = 0): TrailFix {
  return {
    id,
    lat: PLACE.lat + m / M_PER_DEG_LAT,
    lon: PLACE.lon,
    accuracyM,
    ts: new Date(Date.UTC(2026, 8, 26, 9, minute)),
  };
}
const none = () => ({ inside: new Set<string>() });

describe('detectCrossings', () => {
  it('arrives inside the radius with a precise fix', () => {
    const r = detectCrossings(none(), north(60), [PLACE]);
    expect(r.events).toEqual([{ placeId: 'p1', kind: 'arrive' }]);
    expect([...r.inside]).toEqual(['p1']);
  });

  it('does not arrive when the accuracy circle is as wide as the radius', () => {
    expect(detectCrossings(none(), north(20, 100), [PLACE]).events).toEqual([]);
    expect(detectCrossings(none(), north(20, 400), [PLACE]).events).toEqual([]);
  });

  it('uses the place radius, not a constant', () => {
    const wide = { ...PLACE, radiusM: 500 };
    expect(detectCrossings(none(), north(400), [PLACE]).events).toEqual([]);
    expect(detectCrossings(none(), north(400), [wide]).events).toEqual([{ placeId: 'p1', kind: 'arrive' }]);
  });

  it('leaves only beyond radius + 50 m, with the whole accuracy circle out there', () => {
    const inside = { inside: new Set(['p1']) };
    expect(detectCrossings(inside, north(140), [PLACE]).events).toEqual([]);
    expect([...detectCrossings(inside, north(140), [PLACE]).inside]).toEqual(['p1']);
    // 160 m out with a 10 m circle: the near edge is 150 m, not past the band.
    expect(detectCrossings(inside, north(160), [PLACE]).events).toEqual([]);
    expect(detectCrossings(inside, north(161), [PLACE]).events).toEqual([{ placeId: 'p1', kind: 'leave' }]);
    // No accuracy given: the fix itself must be past the band.
    expect(detectCrossings(inside, north(151, null), [PLACE]).events).toEqual([{ placeId: 'p1', kind: 'leave' }]);
  });

  it('does not flap on indoor drift: an 80 m circle on a 50 m place raises nothing', () => {
    const small: CrossingPlace = { ...PLACE, radiusM: 50 };
    // Sitting indoors; the phone wanders 20–170 m with an 80 m circle.
    const drift = [20, 110, 40, 150, 60, 170, 30].map((m, i) => north(m, 80, i + 2, i + 1));
    const r = stepCrossings({ inside: ['p1'], lastId: 1, watched: ['p1'], lastTsMs: 0 }, drift, [small]);
    expect(r.events).toEqual([]);
    expect(r.state?.inside).toEqual(['p1']);
  });

  it('does not arrive from a fix moving at rail speed, but still leaves', () => {
    const at = (m: number, speedKmh: number | null, mode: string | null) => ({ ...north(m), speedKmh, mode });
    expect(detectCrossings(none(), at(20, 120, 'rail'), [PLACE]).events).toEqual([]);
    expect(detectCrossings(none(), at(20, 90, 'vehicle'), [PLACE]).events).toEqual([]);
    expect([...detectCrossings(none(), at(20, 95, null), [PLACE]).inside]).toEqual([]);
    // A car at 50 km/h, or a walker, still arrives.
    expect(detectCrossings(none(), at(20, 50, 'vehicle'), [PLACE]).events).toEqual([{ placeId: 'p1', kind: 'arrive' }]);
    expect(detectCrossings(none(), at(20, 4, 'walking'), [PLACE]).events).toEqual([{ placeId: 'p1', kind: 'arrive' }]);
    // Leaving on a train is still leaving.
    expect(detectCrossings({ inside: new Set(['p1']) }, at(900, 120, 'rail'), [PLACE]).events).toEqual([
      { placeId: 'p1', kind: 'leave' },
    ]);
  });

  it('drops an unwatched place from the state without a leave', () => {
    const r = detectCrossings({ inside: new Set(['gone']) }, north(0), []);
    expect(r.events).toEqual([]);
    expect(r.inside.size).toBe(0);
  });
});

describe('stepCrossings', () => {
  const state = (inside: string[] = [], lastId = 0): InsideState => ({
    inside,
    lastId,
    watched: ['p1'],
    lastTsMs: 0,
  });

  it('turns jitter at the edge into one arrive and one leave', () => {
    // 95 in, 105 out, 98 in, 130 out, 90 in, 145 out — all within the band —
    // then really gone at 300.
    const walk = [200, 95, 105, 98, 130, 90, 145, 300].map((m, i) => north(m, 10, i + 1, i));
    const r = stepCrossings(state(), walk, [PLACE]);
    expect(r.events.map((e) => e.kind)).toEqual(['arrive', 'leave']);
    expect(r.events[0].at).toEqual(walk[1].ts);
    expect(r.events[1].at).toEqual(walk[7].ts);
    expect(r.state?.inside).toEqual([]);
    expect(r.state?.lastId).toBe(8);
  });

  it('raises nothing on the first run for a person, only sets their state', () => {
    const r = stepCrossings(null, [north(300, 10, 1), north(10, 10, 2, 1)], [PLACE]);
    expect(r.events).toEqual([]);
    expect(r.state).toMatchObject({ inside: ['p1'], lastId: 2, watched: ['p1'] });
  });

  it('keeps the stored state when there is nothing new', () => {
    const s = state(['p1'], 7);
    expect(stepCrossings(s, [], [PLACE])).toEqual({ events: [], state: s });
  });

  it('does not announce an arrival at a place flagged while someone is in it', () => {
    const s: InsideState = { inside: [], lastId: 1, watched: [], lastTsMs: 0 };
    const r = stepCrossings(s, [north(10, 10, 2), north(20, 10, 3, 1)], [PLACE]);
    expect(r.events).toEqual([]);
    expect(r.state?.inside).toEqual(['p1']);
    expect(r.state?.watched).toEqual(['p1']);
  });

  it('seeds a newly watched place from the first USABLE fix, not the first fix', () => {
    const s: InsideState = { inside: [], lastId: 1, watched: [], lastTsMs: 0 };
    // Flagged while they sit in it. The first fix is a 900 m circle, which
    // cannot say "inside"; seeding from it would make the next good fix an
    // arrival at a place they never left.
    const r = stepCrossings(s, [north(10, 900, 2), north(20, 10, 3, 1)], [PLACE]);
    expect(r.events).toEqual([]);
    expect(r.state?.inside).toEqual(['p1']);
  });

  it('leaves a newly flagged place unwatched while no fix can seed it', () => {
    const s: InsideState = { inside: [], lastId: 1, watched: [], lastTsMs: 0 };
    const r = stepCrossings(s, [north(10, 900, 2)], [PLACE]);
    expect(r.events).toEqual([]);
    expect(r.state?.watched).toEqual([]);
    // Next run: a good fix inside seeds it quietly, as a flag-while-there should.
    const next = stepCrossings(r.state, [north(10, 10, 3, 1)], [PLACE]);
    expect(next.events).toEqual([]);
    expect(next.state?.inside).toEqual(['p1']);
  });

  it('steps over a fix too imprecise to say anything, in or out', () => {
    const r = stepCrossings(state(['p1']), [north(1000, 900, 2, 1), north(20, 10, 3, 2)], [PLACE]);
    expect(r.events).toEqual([]);
    expect(r.state?.lastId).toBe(3);
  });

  it('steps over a fix written late but taken earlier than one already walked', () => {
    const s = { ...state(['p1'], 5), lastTsMs: north(0, 10, 5, 30).ts.getTime() };
    const r = stepCrossings(s, [north(900, 10, 6, 10)], [PLACE]);
    expect(r.events).toEqual([]);
    expect(r.state?.inside).toEqual(['p1']);
    expect(r.state?.lastId).toBe(6);
  });
});

describe('dedupe', () => {
  const at = new Date('2026-09-26T09:00:00Z');
  const key = { subject: 'sam', placeId: 'p1', kind: 'arrive', at };

  it('treats the same crossing within ten minutes as a repeat', () => {
    expect(isDuplicate([key], { ...key, at: new Date(at.getTime() + 9 * 60_000) })).toBe(true);
    expect(isDuplicate([key], { ...key, at: new Date(at.getTime() - 9 * 60_000) })).toBe(true);
  });

  it('lets it through after ten minutes, or for another kind, place or person', () => {
    expect(isDuplicate([key], { ...key, at: new Date(at.getTime() + 11 * 60_000) })).toBe(false);
    expect(isDuplicate([key], { ...key, kind: 'leave' })).toBe(false);
    expect(isDuplicate([key], { ...key, placeId: 'p2' })).toBe(false);
    expect(isDuplicate([key], { ...key, subject: 'alex' })).toBe(false);
  });

  it('builds the row id from subject, place, kind and epoch seconds', () => {
    expect(eventId('sam', 'p1', 'arrive', at)).toBe(`sam:p1:arrive:${at.getTime() / 1000}`);
  });
});

describe('stepCrossings — someone with no position yet', () => {
  it('initialises quietly from an unplaced state, keeping the newer high-water id', () => {
    const unplaced: InsideState = { inside: [], lastId: 40, watched: ['p1'], lastTsMs: 0, unplaced: true };
    const r = stepCrossings(unplaced, [north(300, 10, 41), north(10, 10, 42, 1)], [PLACE]);
    expect(r.events).toEqual([]);
    expect(r.state).toMatchObject({ inside: ['p1'], lastId: 42 });
    expect(r.state?.unplaced).toBeUndefined();
  });
});

describe('direction — alert on arrive, on leave, or both', () => {
  const arriveOnly: CrossingPlace = { ...PLACE, alertArrive: true, alertLeave: false };
  const leaveOnly: CrossingPlace = { ...PLACE, alertArrive: false, alertLeave: true };

  it('raises only the directions the place is set to, and still tracks inside', () => {
    const inArrive = detectCrossings(none(), north(20), [leaveOnly]);
    expect(inArrive.events).toEqual([]);
    expect([...inArrive.inside]).toEqual(['p1']);

    const outLeave = detectCrossings({ inside: new Set(['p1']) }, north(900), [arriveOnly]);
    expect(outLeave.events).toEqual([]);
    expect(outLeave.inside.size).toBe(0);
  });

  it('treats an unset direction as on, which is the column default', () => {
    expect(detectCrossings(none(), north(20), [PLACE]).events).toEqual([{ placeId: 'p1', kind: 'arrive' }]);
  });

  it('walks a visit to a leave-only place as one leave, with no phantom arrive after', () => {
    const s: InsideState = { inside: [], lastId: 0, watched: ['p1'], lastTsMs: 0 };
    const walk = [300, 20, 30, 400].map((m, i) => north(m, 10, i + 1, i));
    const r = stepCrossings(s, walk, [leaveOnly]);
    expect(r.events.map((e) => e.kind)).toEqual(['leave']);
    expect(r.state?.inside).toEqual([]);
  });

  it('says which directions a place raises', () => {
    expect(raisesCrossing(PLACE, 'arrive')).toBe(true);
    expect(raisesCrossing(arriveOnly, 'leave')).toBe(false);
    expect(raisesCrossing(leaveOnly, 'arrive')).toBe(false);
    expect(raisesCrossing(undefined, 'arrive')).toBe(true);
  });
});

describe('the master switch', () => {
  // Home is watched with its switch off: who is in is still tracked, but it
  // announces nothing. No place notifies by default.
  const silentHome: CrossingPlace = { ...PLACE, alerts: false };

  it('raises nothing in either direction with alerts off', () => {
    expect(raisesCrossing(silentHome, 'arrive')).toBe(false);
    expect(raisesCrossing(silentHome, 'leave')).toBe(false);
    expect(raisesCrossing({ ...PLACE, alerts: true }, 'arrive')).toBe(true);
  });

  it('still tracks who is inside a silent place', () => {
    const arrive = detectCrossings(none(), north(20), [silentHome]);
    expect(arrive.events).toEqual([]);
    expect([...arrive.inside]).toEqual(['p1']);
    const leave = detectCrossings({ inside: new Set(['p1']) }, north(900), [silentHome]);
    expect(leave.events).toEqual([]);
    expect(leave.inside.size).toBe(0);
  });

  it('walks a visit home with alerts off: no events, state moves', () => {
    const s: InsideState = { inside: [], lastId: 0, watched: ['p1'], lastTsMs: 0 };
    const walk = [300, 20, 30, 400].map((m, i) => north(m, 10, i + 1, i));
    const mid = stepCrossings(s, walk.slice(0, 2), [silentHome]);
    expect(mid.events).toEqual([]);
    expect(mid.state?.inside).toEqual(['p1']);
    const end = stepCrossings(mid.state, walk.slice(2), [silentHome]);
    expect(end.events).toEqual([]);
    expect(end.state?.inside).toEqual([]);
  });
});
