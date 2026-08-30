import { describe, it, expect } from 'vitest';
import { render } from 'svelte/server';
import StateOfPlay from './StateOfPlay.svelte';
import type { TrailsDashboard, WeekVolume, WorkoutPhysio } from '$lib/trails/physio-service';
import type { WeeklyVolumeRead } from './types';

// The week-volume tile is ONE week: the last COMPLETE one. `volume` (from
// `weeklyVolumeSummary`) measures that week against the twelve-week median;
// `dashboard.weeks.at(-1)` is a different week for most of any given week —
// the bucket the latest workout fell in, usually the current unfinished one.
// The tile used to take its headline from the first and its session count,
// duration and "Nwk low" tag from the second.

const MONDAYS = [
  '2026-06-15', '2026-06-22', '2026-06-29', '2026-07-06',
  '2026-07-13', '2026-07-20', '2026-07-27', '2026-08-03',
  '2026-08-10', '2026-08-17', '2026-08-24',
];

function week(weekStart: string, km: number, hours: number): WeekVolume {
  return { weekStart, totalS: Math.round(hours * 3600), totalDistanceM: km * 1000, byType: {} };
}

function workout(id: string, day: string): WorkoutPhysio {
  return {
    id, name: `outing ${id}`, activityType: 'Run', day,
    startDate: Math.floor(Date.parse(`${day}T09:00:00Z`) / 1000),
    durationS: 3000, distanceM: 8000, avgHeartrate: 140,
    trimp: 60, ef: null, beatsPerKm: null, hrr60: null,
  };
}

function dashboard(weeks: WeekVolume[], workouts: WorkoutPhysio[]): TrailsDashboard {
  return {
    profile: { hrMax: 185, hrRest: 50, hrMaxSource: 'tanaka' } as TrailsDashboard['profile'],
    vo2: { result: null, series: [] },
    rhr: null, hrv: null, hrvSdnn: null, recovery: [],
    workouts,
    efficiency: { ef: null, bkm: null },
    load: { days: [], trimpAcwr: null, strainAcwr: null },
    weeks,
    zones28: null,
  };
}

function tile(d: TrailsDashboard | null, volume: WeeklyVolumeRead | null): string {
  const body = render(StateOfPlay, {
    props: {
      today: null, series: [], rhrBaseline: 0, todayDeltas: null, syncedAgoSeconds: 120,
      readiness: null, dashboard: d, vo2max: null, acwr: null, volume,
    },
  }).body;
  // The tile's own slice of the markup: from its label to the next label.
  const from = body.indexOf('Week volume');
  expect(from, 'no week-volume tile rendered').toBeGreaterThan(-1);
  const next = body.indexOf('VO', from);
  return body.slice(from, next > from ? next : undefined);
}

describe('StateOfPlay — the week-volume tile names ONE week', () => {
  // Ten complete weeks to 23 Aug, then the current part-week from 24 Aug.
  // Ten complete weeks, the last of them 22 km — deliberately NOT the thinnest,
  // so any low-run tag on this fixture came from the part-week.
  const COMPLETE_KM = [18, 19, 20, 21, 20, 19, 21, 20, 19, 22];
  const weeks = [
    ...MONDAYS.slice(0, 10).map((m, i) => week(m, COMPLETE_KM[i], 2.5)),
    week('2026-08-24', 2.1, 0.4), // in progress: two days in
  ];
  // Four sessions in the last complete week, one so far in the current one.
  const workouts = [
    workout('a', '2026-08-17'), workout('b', '2026-08-19'),
    workout('c', '2026-08-21'), workout('d', '2026-08-23'),
    workout('e', '2026-08-25'),
  ];
  const volume: WeeklyVolumeRead = { weekKm: 22, medianKm: 20.5, weekStart: '2026-08-17' };

  it('counts the sessions of the COMPLETE week, not everything since its Monday', () => {
    const t = tile(dashboard(weeks, workouts), volume);
    expect(t).toContain('4 sessions');
    expect(t).not.toContain('5 sessions');
  });

  it('quotes the complete week\'s duration, not the part-week\'s', () => {
    // 2.5h for the week to 23 Aug; the current part-week is 0.4h ≈ 24m.
    const t = tile(dashboard(weeks, workouts), volume);
    expect(t).toContain('2h30m');
    expect(t).not.toContain('24m');
  });

  it('does not tag a low run off the part-week that has only just started', () => {
    // 2.1 km two days into the week is the lowest number in the bucket list and
    // will be until Friday — which is why the tag used to fire nearly daily.
    const t = tile(dashboard(weeks, workouts), volume);
    expect(t).not.toContain('wk low');
  });

  it('still tags a genuine low run measured over COMPLETE weeks only', () => {
    const low = [
      ...MONDAYS.slice(0, 9).map((m) => week(m, 25, 3)),
      week('2026-08-17', 9, 1.2), // the last complete week, and the thinnest
      week('2026-08-24', 2.1, 0.4),
    ];
    const t = tile(dashboard(low, workouts), { weekKm: 9, medianKm: 25, weekStart: '2026-08-17' });
    expect(t).toContain('wk low');
  });

  it('draws its bars over the same complete weeks the tag counts', () => {
    // Seven bars, and none of them the part-week: the tag says "7wk low".
    const low = [
      ...MONDAYS.slice(0, 9).map((m) => week(m, 25, 3)),
      week('2026-08-17', 9, 1.2),
      week('2026-08-24', 2.1, 0.4),
    ];
    const t = tile(dashboard(low, workouts), { weekKm: 9, medianKm: 25, weekStart: '2026-08-17' });
    expect(t).toContain('7wk low');
  });

  it('reads the headline off the same week as the foot', () => {
    const t = tile(dashboard(weeks, workouts), volume);
    expect(t).toContain('22.0');   // the complete week
    expect(t).not.toContain('2.1'); // never the part-week's growing distance
  });

  it('handles a bucket list whose last week is itself complete', () => {
    // `weeklyVolume` anchors on the LAST WORKOUT's Monday, so with nothing
    // logged this week the final bucket is a past complete week. "All but the
    // last" would have been the wrong rule; the tile defers to volume.weekStart.
    const settled = MONDAYS.slice(0, 10).map((m, i) => week(m, COMPLETE_KM[i], 2.5));
    const t = tile(dashboard(settled, workouts.slice(0, 4)), volume);
    expect(t).toContain('4 sessions');
    expect(t).toContain('2h30m');
  });

  it('says so plainly when no week has completed yet', () => {
    const t = tile(dashboard([week('2026-08-24', 2.1, 0.4)], workouts), null);
    expect(t).toContain('no completed week');
    expect(t).not.toContain('2.1');
  });

  it('survives no dashboard at all', () => {
    expect(() => tile(null, null)).not.toThrow();
  });
});
