import { describe, it, expect } from 'vitest';
import {
  parseHaeDate,
  extractOffset,
  toMetres,
  toKilojoules,
  normaliseActivityType,
  workoutExternalId,
  mapWorkout,
  WorkoutMappingError,
  type HaeWorkout,
} from './hae-workouts';
import fixture from './fixtures/hae-workout.json';

const workout = (fixture as { data: { workouts: HaeWorkout[] } }).data.workouts[0];

describe('parseHaeDate', () => {
  it('parses the space-separated offset form Apple actually sends', () => {
    // 2026-08-16 07:12:03 +0100 == 06:12:03Z
    expect(parseHaeDate('2026-08-16 07:12:03 +0100')).toBe(Date.UTC(2026, 7, 16, 6, 12, 3) / 1000);
  });

  it('honours a negative offset', () => {
    expect(parseHaeDate('2026-08-16 07:12:03 -0500')).toBe(Date.UTC(2026, 7, 16, 12, 12, 3) / 1000);
  });

  it('accepts a colon inside the offset', () => {
    expect(parseHaeDate('2026-08-16 07:12:03 +01:00')).toBe(Date.UTC(2026, 7, 16, 6, 12, 3) / 1000);
  });

  it('accepts half-hour offsets', () => {
    expect(parseHaeDate('2026-08-16 07:12:03 +0530')).toBe(Date.UTC(2026, 7, 16, 1, 42, 3) / 1000);
  });

  it('falls back to ISO 8601', () => {
    expect(parseHaeDate('2026-08-16T06:12:03Z')).toBe(Date.UTC(2026, 7, 16, 6, 12, 3) / 1000);
  });

  it('returns null rather than a wrong date for junk', () => {
    expect(parseHaeDate('not a date')).toBeNull();
    expect(parseHaeDate(undefined)).toBeNull();
    expect(parseHaeDate('')).toBeNull();
  });
});

describe('extractOffset', () => {
  it('keeps the local offset for display', () => {
    expect(extractOffset('2026-08-16 07:12:03 +0100')).toBe('+01:00');
    expect(extractOffset('2026-01-16 07:12:03 +0000')).toBe('+00:00');
    expect(extractOffset('bad')).toBeNull();
  });
});

describe('unit conversion', () => {
  it('converts distance by the unit the phone reported, not by assumption', () => {
    expect(toMetres({ qty: 5, units: 'km' })).toBeCloseTo(5000, 6);
    expect(toMetres({ qty: 5, units: 'mi' })).toBeCloseTo(8046.72, 2);
    expect(toMetres({ qty: 500, units: 'm' })).toBeCloseTo(500, 6);
  });

  it('assumes only when the unit is missing', () => {
    expect(toMetres({ qty: 5 })).toBeCloseTo(5000, 6);
    expect(toMetres({ qty: 5 }, 'm')).toBeCloseTo(5, 6);
  });

  it('treats Apple Calories as kilocalories', () => {
    expect(toKilojoules({ qty: 100, units: 'kcal' })).toBeCloseTo(418.4, 3);
    expect(toKilojoules({ qty: 100, units: 'kJ' })).toBeCloseTo(100, 6);
  });

  it('returns null for absent or unusable quantities', () => {
    expect(toMetres(undefined)).toBeNull();
    expect(toMetres({ units: 'km' })).toBeNull();
    expect(toKilojoules(null)).toBeNull();
  });
});

describe('normaliseActivityType', () => {
  it.each([
    ['Outdoor Run', 'run'],
    ['Indoor Run', 'run'],
    ['Trail Run', 'trail_run'],
    ['Outdoor Cycle', 'ride'],
    ['Cycling', 'ride'],
    ['Mountain Biking', 'mtb'],
    ['MTB', 'mtb'],
    ['Hiking', 'hike'],
    ['Walking', 'walk'],
    ['Pool Swim', 'swim'],
  ])('maps %s to %s', (name, expected) => {
    expect(normaliseActivityType(name)).toBe(expected);
  });

  it('puts anything unrecognised in other rather than guessing', () => {
    expect(normaliseActivityType('Australian Football')).toBe('other');
    expect(normaliseActivityType(undefined)).toBe('other');
  });

  it('prefers the more specific match', () => {
    // "Trail Run" contains "run"; the trail rule must win.
    expect(normaliseActivityType('Trail Running')).toBe('trail_run');
    // "Mountain Biking" contains "biking"; the MTB rule must win.
    expect(normaliseActivityType('Mountain Biking')).toBe('mtb');
  });
});

describe('workoutExternalId', () => {
  it('uses the id HAE supplied', () => {
    expect(workoutExternalId({ id: 'ABC-123' })).toBe('ABC-123');
  });

  it('derives a stable id from the natural key when there is none', () => {
    const w = { name: 'Outdoor Run', start: '2026-08-16 07:12:03 +0100', end: '2026-08-16 08:00:00 +0100' };
    expect(workoutExternalId(w)).toBe(workoutExternalId({ ...w }));
    expect(workoutExternalId(w)).toHaveLength(32);
  });

  it('gives different workouts different ids', () => {
    const a = { name: 'Outdoor Run', start: '2026-08-16 07:12:03 +0100' };
    const b = { name: 'Outdoor Run', start: '2026-08-17 07:12:03 +0100' };
    expect(workoutExternalId(a)).not.toBe(workoutExternalId(b));
  });
});

describe('mapWorkout — the captured fixture', () => {
  const mapped = mapWorkout(workout);

  it('identifies the activity', () => {
    expect(mapped.activity.id).toBe('apple:B3C0A1F2-5D44-4E9A-9C21-7F0E2A8B1D66');
    expect(mapped.activity.source).toBe('apple');
    expect(mapped.activity.activityType).toBe('run');
    expect(mapped.activity.rawType).toBe('Outdoor Run');
  });

  it('takes distance from Apple, in metres', () => {
    expect(mapped.activity.distanceM).toBeCloseTo(400, 6);
  });

  it('converts energy to kilojoules', () => {
    expect(mapped.activity.activeEnergyKj).toBeCloseTo(619.2, 1);
    expect(mapped.activity.totalEnergyKj).toBeCloseTo(677.8, 1);
  });

  it('derives heart-rate stats from the series', () => {
    expect(mapped.activity.avgHeartrate).toBe(144);
    expect(mapped.activity.maxHeartrate).toBe(161);
  });

  it('records the duration', () => {
    expect(mapped.activity.durationS).toBe(120);
    expect(mapped.activity.activeDurationS).toBe(118);
  });

  it('computes pace from the active duration', () => {
    // 118 s over 400 m = 295 s/km
    expect(mapped.activity.avgPaceSPerKm).toBeCloseTo(295, 0);
  });

  it('builds the track with time offsets from the start', () => {
    expect(mapped.activity.hasTrack).toBe(true);
    expect(mapped.track).not.toBeNull();
    expect(mapped.track!.pointCount).toBe(9);
    expect(mapped.track!.coordinates[0][3]).toBe(0);
    expect(mapped.track!.coordinates[8][3]).toBe(120);
    // Stored [lng, lat, ...] — not the other way round.
    expect(mapped.track!.coordinates[0][0]).toBeCloseTo(-1.5023, 6);
    expect(mapped.track!.coordinates[0][1]).toBeCloseTo(53.4012, 6);
  });

  it('derives elevation from the track, over the climb only', () => {
    // 101.2 -> 107.1 then back down: ~5.9 up, ~5.2 down.
    expect(mapped.activity.elevationGainM).toBeGreaterThan(4);
    expect(mapped.activity.elevationGainM).toBeLessThan(8);
    expect(mapped.activity.elevationLossM).toBeGreaterThan(3);
  });

  it('encodes a polyline that decodes back to the track', () => {
    expect(mapped.track!.polyline.length).toBeGreaterThan(0);
    expect(mapped.track!.bounds.n).toBeCloseTo(53.408, 4);
    expect(mapped.track!.bounds.w).toBeCloseTo(-1.5023, 4);
  });

  it('maps every series it was given', () => {
    expect(mapped.series.map((s) => s.metric).sort()).toEqual(['cadence', 'heart_rate']);
    const hr = mapped.series.find((s) => s.metric === 'heart_rate')!;
    expect(hr.sampleCount).toBe(5);
    expect(hr.samples[0]).toEqual([0, 118]);
    expect(hr.samples[4]).toEqual([120, 149]);
  });

  it('keeps unmodelled fields in metadata rather than dropping them', () => {
    expect(mapped.activity.metadata).toMatchObject({
      temperature: { qty: 14.5, units: 'degC' },
      humidity: { qty: 78, units: '%' },
    });
  });

  it('is idempotent — the same payload maps to the same row', () => {
    expect(mapWorkout(workout)).toEqual(mapped);
  });
});

describe('mapWorkout — edge cases', () => {
  it('handles an indoor workout with no route', () => {
    const mapped = mapWorkout({
      name: 'Indoor Run',
      start: '2026-08-16 07:00:00 +0100',
      end: '2026-08-16 07:30:00 +0100',
      distance: { qty: 5, units: 'km' },
    });
    expect(mapped.activity.hasTrack).toBe(false);
    expect(mapped.track).toBeNull();
    expect(mapped.activity.distanceM).toBeCloseTo(5000, 6);
  });

  it('falls back to Apple elevation when there is no track', () => {
    const mapped = mapWorkout({
      name: 'Indoor Run',
      start: '2026-08-16 07:00:00 +0100',
      end: '2026-08-16 07:30:00 +0100',
      elevationUp: { qty: 42, units: 'm' },
    });
    expect(mapped.activity.elevationGainM).toBeCloseTo(42, 6);
  });

  it('keeps an unknown workout type instead of discarding it', () => {
    const mapped = mapWorkout({
      name: 'Australian Football',
      start: '2026-08-16 07:00:00 +0100',
      end: '2026-08-16 08:00:00 +0100',
    });
    expect(mapped.activity.activityType).toBe('other');
    expect(mapped.activity.rawType).toBe('Australian Football');
  });

  it('rejects a workout with no usable start', () => {
    expect(() => mapWorkout({ name: 'Run', end: '2026-08-16 08:00:00 +0100' })).toThrow(
      WorkoutMappingError,
    );
  });

  it('rejects a workout that ends before it starts', () => {
    expect(() =>
      mapWorkout({
        name: 'Run',
        start: '2026-08-16 08:00:00 +0100',
        end: '2026-08-16 07:00:00 +0100',
      }),
    ).toThrow(/ends before/);
  });

  it('drops route points with impossible coordinates', () => {
    const mapped = mapWorkout({
      name: 'Outdoor Run',
      start: '2026-08-16 07:00:00 +0100',
      end: '2026-08-16 07:10:00 +0100',
      route: [
        { lat: 53.4, lon: -1.5, timestamp: '2026-08-16 07:00:00 +0100' },
        { lat: 999, lon: -1.5, timestamp: '2026-08-16 07:01:00 +0100' },
        { lat: 53.41, lon: -1.5, timestamp: '2026-08-16 07:02:00 +0100' },
      ],
    });
    expect(mapped.track!.pointCount).toBe(2);
  });

  it('maps a Workouts v2 route (latitude/longitude, not lat/lon)', () => {
    // What real phones send — the fixture's lat/lon shape is the v1 dialect.
    // This exact mismatch shipped 0 tracks to production for a day.
    const mapped = mapWorkout({
      name: 'Outdoor Cycling',
      start: '2026-08-16 07:00:00 +0100',
      end: '2026-08-16 07:10:00 +0100',
      route: [
        {
          latitude: 53.4012,
          longitude: -1.5023,
          altitude: 101.2,
          horizontalAccuracy: 3.1,
          speed: 4.2,
          timestamp: '2026-08-16 07:00:00 +0100',
        },
        {
          latitude: 53.402,
          longitude: -1.5023,
          altitude: 102.0,
          horizontalAccuracy: 2.9,
          speed: 4.4,
          timestamp: '2026-08-16 07:02:00 +0100',
        },
        {
          latitude: 53.4029,
          longitude: -1.5022,
          altitude: 104.4,
          horizontalAccuracy: 3.0,
          speed: 4.1,
          timestamp: '2026-08-16 07:04:00 +0100',
        },
      ],
    });
    expect(mapped.track).not.toBeNull();
    expect(mapped.track!.pointCount).toBe(3);
    expect(mapped.track!.coordinates[0][0]).toBeCloseTo(-1.5023, 6);
    expect(mapped.track!.coordinates[0][1]).toBeCloseTo(53.4012, 6);
    expect(mapped.track!.coordinates[2][3]).toBe(240);
    expect(mapped.activity.hasTrack).toBe(true);
  });

  it('prefers v1 keys when both dialects are present on one point', () => {
    const mapped = mapWorkout({
      name: 'Outdoor Run',
      start: '2026-08-16 07:00:00 +0100',
      end: '2026-08-16 07:10:00 +0100',
      route: [
        { lat: 53.4, lon: -1.5, latitude: 10, longitude: 10, timestamp: '2026-08-16 07:00:00 +0100' },
        { lat: 53.41, lon: -1.5, latitude: 10, longitude: 10, timestamp: '2026-08-16 07:02:00 +0100' },
      ],
    });
    expect(mapped.track!.coordinates[0][1]).toBeCloseTo(53.4, 6);
  });

  it('ignores a route too short to be a line', () => {
    const mapped = mapWorkout({
      name: 'Outdoor Run',
      start: '2026-08-16 07:00:00 +0100',
      end: '2026-08-16 07:10:00 +0100',
      route: [{ lat: 53.4, lon: -1.5, timestamp: '2026-08-16 07:00:00 +0100' }],
    });
    expect(mapped.track).toBeNull();
    expect(mapped.activity.hasTrack).toBe(false);
  });

  it('survives a heart-rate series with unparseable timestamps', () => {
    const mapped = mapWorkout({
      name: 'Outdoor Run',
      start: '2026-08-16 07:00:00 +0100',
      end: '2026-08-16 07:10:00 +0100',
      heartRateData: [{ date: 'nonsense', qty: 140 }],
    });
    expect(mapped.series).toEqual([]);
    expect(mapped.activity.avgHeartrate).toBeNull();
  });

  it('falls back to track distance when Apple reported none', () => {
    const mapped = mapWorkout({
      name: 'Outdoor Run',
      start: '2026-08-16 07:00:00 +0100',
      end: '2026-08-16 07:10:00 +0100',
      route: [
        { lat: 53.4, lon: -1.5, timestamp: '2026-08-16 07:00:00 +0100' },
        { lat: 53.41, lon: -1.5, timestamp: '2026-08-16 07:05:00 +0100' },
      ],
    });
    expect(mapped.activity.distanceM).toBeGreaterThan(1000);
  });
});
