import { describe, it, expect } from 'vitest';
import {
  detectCrossings,
  eventId,
  isDuplicate,
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

  it('leaves only beyond radius + 50 m', () => {
    const inside = { inside: new Set(['p1']) };
    expect(detectCrossings(inside, north(140), [PLACE]).events).toEqual([]);
    expect([...detectCrossings(inside, north(140), [PLACE]).inside]).toEqual(['p1']);
    expect(detectCrossings(inside, north(160), [PLACE]).events).toEqual([{ placeId: 'p1', kind: 'leave' }]);
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
