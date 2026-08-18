// tests/lib/trails/physio-service.test.ts — the exported pure assembly
// helpers only; the DB-backed functions are exercised in QA against real rows.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  buildLoadDays,
  weeklyVolume,
  mondayOf,
  polarisedFromZones,
  type WorkoutPhysio,
} from '$lib/trails/physio-service';

function workout(day: string, trimp: number | null, extra: Partial<WorkoutPhysio> = {}): WorkoutPhysio {
  return {
    id: `apple:${day}-${Math.abs(trimp ?? 0)}`,
    name: 'w',
    activityType: 'run',
    day,
    startDate: Math.floor(Date.parse(day + 'T08:00:00Z') / 1000),
    durationS: 3600,
    distanceM: 10000,
    avgHeartrate: 150,
    trimp,
    ef: null,
    hrr60: null,
    ...extra,
  };
}

describe('buildLoadDays', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-18T12:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('zero-fills rest days from the first workout through today, never before', () => {
    const days = buildLoadDays([workout('2026-08-11', 50), workout('2026-08-14', 80)]);
    expect(days[0]).toEqual({ date: '2026-08-11', load: 50 });
    expect(days[days.length - 1]).toEqual({ date: '2026-08-18', load: 0 });
    expect(days).toHaveLength(8);
    expect(days.find((d) => d.date === '2026-08-12')!.load).toBe(0);
  });

  it('sums same-day workouts and skips trimpless ones', () => {
    const days = buildLoadDays([
      workout('2026-08-18', 30),
      workout('2026-08-18', 20),
      workout('2026-08-18', null),
    ]);
    expect(days).toEqual([{ date: '2026-08-18', load: 50 }]);
  });

  it('returns empty when nothing carries a load', () => {
    expect(buildLoadDays([])).toEqual([]);
    expect(buildLoadDays([workout('2026-08-18', null)])).toEqual([]);
  });
});

describe('weeklyVolume', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-18T12:00:00Z')); // a Tuesday
  });
  afterEach(() => vi.useRealTimers());

  it('emits exactly N zero-filled Monday buckets, oldest first', () => {
    const weeks = weeklyVolume([], 12);
    expect(weeks).toHaveLength(12);
    expect(weeks[11].weekStart).toBe('2026-08-17');
    expect(weeks[0].weekStart).toBe('2026-06-01');
    expect(weeks.every((w) => w.totalS === 0)).toBe(true);
  });

  it('buckets workouts into their week and splits seconds by type', () => {
    const weeks = weeklyVolume(
      [
        workout('2026-08-17', 10),
        workout('2026-08-18', 10, { activityType: 'ride', durationS: 1800 }),
        workout('2026-08-10', 10),
      ],
      12,
    );
    const current = weeks[11];
    expect(current.totalS).toBe(3600 + 1800);
    expect(current.byType).toEqual({ run: 3600, ride: 1800 });
    expect(weeks[10].totalS).toBe(3600);
  });
});

describe('mondayOf', () => {
  it('maps any day to its Monday', () => {
    expect(mondayOf('2026-08-17')).toBe('2026-08-17'); // Monday
    expect(mondayOf('2026-08-18')).toBe('2026-08-17'); // Tuesday
    expect(mondayOf('2026-08-23')).toBe('2026-08-17'); // Sunday
  });
});

describe('polarisedFromZones', () => {
  it('returns null on an all-zero aggregate', () => {
    expect(polarisedFromZones({ z0: 0, z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 })).toBeNull();
  });

  it('feeds seconds as milliseconds into the polarised model', () => {
    const r = polarisedFromZones({ z0: 0, z1: 3000, z2: 1500, z3: 300, z4: 300, z5: 0 });
    expect(r).not.toBeNull();
  });
});
