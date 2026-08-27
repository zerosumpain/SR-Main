import { describe, it, expect } from 'vitest';
import { segmentJourneys, summariseDay, type JourneyFix } from './journeys';

const T0 = new Date('2026-08-26T08:00:00Z');
const at = (mins: number) => new Date(T0.getTime() + mins * 60_000);
const northOf = (lat: number, metres: number) => lat + metres / 111_320;
const LAT = 54.53;
const LON = -1.55;

const fix = (mins: number, metresNorth: number, extra: Partial<JourneyFix> = {}): JourneyFix => ({
  ts: at(mins),
  lat: northOf(LAT, metresNorth),
  lon: LON,
  subject: 'john',
  ...extra,
});

describe('segmentJourneys', () => {
  it('turns a drive into one journey with a real distance', () => {
    // Six fixes, two minutes apart, 1.5 km between each.
    const fixes = [0, 2, 4, 6, 8, 10].map((m, i) =>
      fix(m, i * 1500, { speedKmh: 45, mode: 'vehicle' }),
    );
    const [j] = segmentJourneys(fixes);
    expect(j.minutes).toBe(10);
    expect(j.distanceKm).toBeCloseTo(7.5, 1);
    expect(j.dominantMode).toBe('vehicle');
    expect(j.fixCount).toBe(6);
  });

  it('does not end a journey at a set of traffic lights', () => {
    // Moving, one stationary pair in the middle, moving again — one journey.
    const fixes = [
      fix(0, 0, { mode: 'vehicle' }),
      fix(2, 1500, { mode: 'vehicle' }),
      fix(4, 1520, { mode: 'still' }), // 20 m — stopped at a junction
      fix(6, 3000, { mode: 'vehicle' }),
      fix(8, 4500, { mode: 'vehicle' }),
    ];
    const journeys = segmentJourneys(fixes);
    expect(journeys).toHaveLength(1);
    expect(journeys[0].minutes).toBe(8);
  });

  it('ends a journey when someone actually stops', () => {
    const out = [0, 2, 4].map((m, i) => fix(m, i * 1500, { mode: 'vehicle' }));
    const sat = [40, 42, 44].map((m) => fix(m, 3000, { mode: 'still' }));
    const back = [90, 92, 94].map((m, i) => fix(m, 3000 - i * 1500, { mode: 'vehicle' }));
    const journeys = segmentJourneys([...out, ...sat, ...back]);
    expect(journeys).toHaveLength(2);
  });

  it('ignores a walk to the car', () => {
    // Under either floor is not a journey: 100 m in one minute.
    const fixes = [fix(0, 0), fix(1, 100)];
    expect(segmentJourneys(fixes)).toEqual([]);
  });

  it('measures a round trip by the ground it covered, not the displacement', () => {
    // Out 3 km and back. Straight-line start-to-end would call this zero.
    const fixes = [
      fix(0, 0, { mode: 'vehicle' }),
      fix(2, 1500, { mode: 'vehicle' }),
      fix(4, 3000, { mode: 'vehicle' }),
      fix(6, 1500, { mode: 'vehicle' }),
      fix(8, 0, { mode: 'vehicle' }),
    ];
    const [j] = segmentJourneys(fixes);
    expect(j.distanceKm).toBeCloseTo(6, 1);
  });

  it('does not let a GPS jump set the mean speed', () => {
    // The trail holds fixes recorded as `vehicle` at 399 km/h. The mean comes
    // from distance over time, so a bad per-fix speed cannot reach it.
    const fixes = [0, 2, 4].map((m, i) => fix(m, i * 1000, { speedKmh: i === 1 ? 399 : 30, mode: 'vehicle' }));
    const [j] = segmentJourneys(fixes);
    expect(j.maxSpeedKmh).toBe(399); // recorded, because it was recorded
    expect(j.meanSpeedKmh).toBeLessThan(80); // but not believed
  });

  it('keeps each person\'s journeys their own', () => {
    const johns = [0, 2, 4].map((m, i) => fix(m, i * 1500, { mode: 'vehicle' }));
    const katies = [0, 2, 4].map((m, i) => fix(m, i * 1500, { subject: 'katie', mode: 'vehicle' }));
    const journeys = segmentJourneys([...johns, ...katies]);
    expect(journeys).toHaveLength(2);
    expect(new Set(journeys.map((j) => j.subject))).toEqual(new Set(['john', 'katie']));
  });

  it('records where a journey started and finished when the trail knows', () => {
    const fixes = [
      fix(0, 0, { mode: 'vehicle', placeId: 'home' }),
      fix(2, 1500, { mode: 'vehicle' }),
      fix(4, 3000, { mode: 'vehicle' }),
      fix(6, 3010, { mode: 'still', placeId: 'work' }),
    ];
    const [j] = segmentJourneys(fixes);
    expect(j.fromPlaceId).toBe('home');
    expect(j.toPlaceId).toBe('work');
  });
});

describe('summariseDay', () => {
  it('adds the day up without double-counting a minute', () => {
    const fixes = [
      ...[0, 2, 4].map((m, i) => fix(m, i * 1500, { mode: 'vehicle', speedKmh: 45 })),
      ...[60, 62, 64].map((m, i) => fix(m, 3000 + i * 400, { mode: 'walking', speedKmh: 5 })),
    ];
    const day = summariseDay(segmentJourneys(fixes));
    expect(day.count).toBe(2);
    expect(day.minutesMoving).toBe(8);
    expect(day.longestMinutes).toBe(4);
    expect(day.byMode.vehicle).toBe(4);
    expect(day.byMode.walking).toBe(4);
  });

  it('is empty, not zero-filled, for a day nobody moved', () => {
    const day = summariseDay([]);
    expect(day.count).toBe(0);
    expect(day.maxSpeedKmh).toBeNull();
    expect(day.byMode).toEqual({});
  });
});
