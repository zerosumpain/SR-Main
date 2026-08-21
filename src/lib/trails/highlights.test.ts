import { describe, it, expect } from 'vitest';
import {
  computeHighlights,
  collectChains,
  ordinal,
  typeNoun,
  type ActivityFacts,
  type EffortFacts,
} from './highlights';

function activity(over: Partial<ActivityFacts> & { id: string }): ActivityFacts {
  return {
    activityType: 'run',
    name: 'Outing',
    startDate: 1_700_000_000,
    day: '2023-11-14',
    minutesOfDay: 8 * 60,
    distanceM: 5000,
    durationS: 1800,
    movingS: 1800,
    elevationGainM: 50,
    avgHeartrate: 140,
    maxHeartrate: 165,
    avgPaceSPerKm: 360,
    activeEnergyKj: 1500,
    tempC: 12,
    indoor: false,
    excludedFromSegments: false,
    ...over,
  };
}

function effort(over: Partial<EffortFacts> & { activityId: string; segmentId: number }): EffortFacts {
  return {
    segmentName: 'peacock.sand.setts',
    segmentActivityType: 'run',
    lapIndex: 1,
    durationS: 300,
    paceSPerKm: 300,
    efficiencyFactor: 1.1,
    beatsPerKm: 700,
    avgHeartrate: 140,
    startS: 0,
    endS: 300,
    ...over,
  };
}

const kinds = (list: ReturnType<typeof computeHighlights>, id: string) =>
  (list.get(id) ?? []).map((h) => h.kind);

const find = (list: ReturnType<typeof computeHighlights>, id: string, kind: string) =>
  (list.get(id) ?? []).find((h) => h.kind === kind);

describe('ordinal', () => {
  it('handles the teens, which are the ones that go wrong', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 101, 111].map(ordinal)).toEqual([
      '1st',
      '2nd',
      '3rd',
      '4th',
      '11th',
      '12th',
      '13th',
      '21st',
      '22nd',
      '101st',
      '111th',
    ]);
  });
});

describe('typeNoun', () => {
  it('names the sports it knows and falls back readably', () => {
    expect(typeNoun('trail_run')).toBe('trail run');
    expect(typeNoun('ride', true)).toBe('rides');
    expect(typeNoun('kayak')).toBe('kayak');
  });
});

describe('computeHighlights — the invariant', () => {
  it('gives every activity at least one highlight, however thin the corpus', () => {
    const activities = [
      activity({ id: 'a' }),
      activity({ id: 'b', activityType: 'swim', distanceM: null, durationS: 900 }),
      activity({ id: 'c', activityType: 'other', distanceM: null, tempC: null, indoor: null, minutesOfDay: null, day: null }),
    ];
    const result = computeHighlights(activities, []);
    for (const a of activities) {
      expect(result.get(a.id)?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it('holds for a single lonely activity', () => {
    const result = computeHighlights([activity({ id: 'solo' })], []);
    expect(kinds(result, 'solo')).toContain('only_one');
  });

  it('sorts each list best-first so the table can read [0]', () => {
    const activities = Array.from({ length: 10 }, (_, i) =>
      activity({ id: `a${i}`, startDate: 1_700_000_000 + i * 86_400, distanceM: 1000 * (i + 1) }),
    );
    const efforts = activities.map((a) =>
      effort({ activityId: a.id, segmentId: 1, durationS: 400 - a.distanceM! / 1000 }),
    );
    const result = computeHighlights(activities, efforts);
    for (const [, list] of result) {
      const weights = list.map((h) => h.weight);
      expect([...weights].sort((x, y) => y - x)).toEqual(weights);
    }
  });
});

describe('computeHighlights — segment placings', () => {
  const activities = Array.from({ length: 6 }, (_, i) =>
    activity({ id: `a${i}`, startDate: 1_700_000_000 + i * 86_400 }),
  );
  // a0 fastest through a5 slowest.
  const efforts = activities.map((a, i) =>
    effort({ activityId: a.id, segmentId: 7, durationS: 300 + i * 10 }),
  );

  it('ranks 1st through 5th and stops there', () => {
    const result = computeHighlights(activities, efforts);
    expect(find(result, 'a0', 'segment_rank')?.rank).toBe(1);
    expect(find(result, 'a0', 'segment_rank')?.label).toBe('Segment PB');
    expect(find(result, 'a4', 'segment_rank')?.rank).toBe(5);
    expect(find(result, 'a5', 'segment_rank')).toBeUndefined();
  });

  it('states the denominator of RANKED efforts, not the effort count', () => {
    // Only three efforts carry an efficiency factor; a "3rd most efficient"
    // claim must be out of 3, not out of 6.
    const partial = efforts.map((e, i) => ({
      ...e,
      efficiencyFactor: i < 3 ? 1.3 - i * 0.1 : null,
    }));
    const result = computeHighlights(activities, partial);
    expect(find(result, 'a2', 'segment_ef')?.outOf).toBe(3);
    expect(find(result, 'a2', 'segment_ef')?.rank).toBe(3);
  });

  it('shares a rank on a tie and skips the next, like the leaderboard', () => {
    const tied = activities.map((a, i) =>
      effort({ activityId: a.id, segmentId: 7, durationS: i < 2 ? 300 : 300 + i * 10 }),
    );
    const result = computeHighlights(activities, tied);
    expect(find(result, 'a0', 'segment_rank')?.rank).toBe(1);
    expect(find(result, 'a1', 'segment_rank')?.rank).toBe(1);
    expect(find(result, 'a2', 'segment_rank')?.rank).toBe(3);
  });

  it('needs three efforts before a placing is a fact', () => {
    const two = activities.slice(0, 2);
    const result = computeHighlights(
      two,
      two.map((a, i) => effort({ activityId: a.id, segmentId: 9, durationS: 300 + i })),
    );
    expect(kinds(result, 'a0')).not.toContain('segment_rank');
  });

  it('refuses efficiency and cost rankings outside pace sports', () => {
    const rides = activities.map((a) => ({ ...a, activityType: 'ride' }));
    const rideEfforts = efforts.map((e) => ({ ...e, segmentActivityType: 'ride' }));
    const result = computeHighlights(rides, rideEfforts);
    expect(kinds(result, 'a0')).toContain('segment_rank');
    expect(kinds(result, 'a0')).not.toContain('segment_ef');
    expect(kinds(result, 'a0')).not.toContain('segment_bpk');
  });

  it('drops an excluded activity out of the ranking entirely', () => {
    const withExclusion = activities.map((a) =>
      a.id === 'a0' ? { ...a, excludedFromSegments: true } : a,
    );
    const result = computeHighlights(withExclusion, efforts);
    // a1 was second; with the bad recording gone it is the PB, out of 5.
    expect(find(result, 'a1', 'segment_rank')?.rank).toBe(1);
    expect(find(result, 'a1', 'segment_rank')?.outOf).toBe(5);
    expect(kinds(result, 'a0')).not.toContain('segment_rank');
  });
});

describe('collectChains', () => {
  it('pairs consecutive segments and measures start-of-first to end-of-second', () => {
    const efforts = [
      effort({ activityId: 'a', segmentId: 1, startS: 0, endS: 300, durationS: 300 }),
      effort({ activityId: 'a', segmentId: 2, startS: 320, endS: 700, durationS: 380 }),
    ];
    const chains = collectChains(efforts);
    const occ = chains.get('1>2');
    expect(occ).toHaveLength(1);
    expect(occ![0].elapsedS).toBe(700);
  });

  it('does not chain across a coffee stop', () => {
    const efforts = [
      effort({ activityId: 'a', segmentId: 1, startS: 0, endS: 300 }),
      effort({ activityId: 'a', segmentId: 2, startS: 900, endS: 1200 }),
    ];
    expect(collectChains(efforts).size).toBe(0);
  });

  it('ranks the same pair across outings', () => {
    const activities = ['a', 'b', 'c'].map((id, i) =>
      activity({ id, startDate: 1_700_000_000 + i * 86_400 }),
    );
    const efforts = activities.flatMap((a, i) => [
      effort({ activityId: a.id, segmentId: 1, startS: 0, endS: 300 + i * 10 }),
      effort({
        activityId: a.id,
        segmentId: 2,
        segmentName: 'kettle.iron.lane',
        startS: 310 + i * 10,
        endS: 600 + i * 20,
      }),
    ]);
    const result = computeHighlights(activities, efforts);
    const best = find(result, 'a', 'back_to_back');
    expect(best?.rank).toBe(1);
    expect(best?.outOf).toBe(3);
    expect(best?.detail).toContain('peacock.sand.setts → kettle.iron.lane');
  });
});

describe('computeHighlights — records, conditions and clock', () => {
  const base = Array.from({ length: 8 }, (_, i) =>
    activity({
      id: `r${i}`,
      startDate: 1_700_000_000 + i * 86_400 * 3,
      day: `2023-11-${String(1 + i * 3).padStart(2, '0')}`,
      distanceM: 4000 + i * 500,
      elevationGainM: 20 + i * 10,
      avgPaceSPerKm: 400 - i * 5,
      activeEnergyKj: 1000 + i * 100,
      tempC: 5 + i * 3,
      minutesOfDay: 5 * 60 + i * 40,
    }),
  );

  it('crowns the longest, the biggest climb, the fastest and the biggest burn', () => {
    const result = computeHighlights(base, []);
    expect(find(result, 'r7', 'record_distance')?.rank).toBe(1);
    expect(find(result, 'r7', 'record_climb')?.rank).toBe(1);
    expect(find(result, 'r7', 'record_pace')?.rank).toBe(1);
    expect(find(result, 'r7', 'record_energy')?.rank).toBe(1);
  });

  it('names the hottest and the coldest, outdoors only', () => {
    const result = computeHighlights(base, []);
    expect(find(result, 'r7', 'hottest')?.rank).toBe(1);
    expect(find(result, 'r0', 'coldest')?.rank).toBe(1);

    const indoors = base.map((a) => ({ ...a, indoor: true }));
    const noWeather = computeHighlights(indoors, []);
    expect(kinds(noWeather, 'r7')).not.toContain('hottest');
  });

  it('treats unknown indoor-ness as unknown, not as outdoors', () => {
    const unknown = base.map((a) => ({ ...a, indoor: null }));
    const result = computeHighlights(unknown, []);
    expect(kinds(result, 'r7')).not.toContain('hottest');
  });

  it('finds the earliest and latest starts from the local clock', () => {
    const result = computeHighlights(base, []);
    expect(find(result, 'r0', 'earliest')?.rank).toBe(1);
    expect(find(result, 'r0', 'earliest')?.detail).toContain('05:00');
    expect(find(result, 'r7', 'latest')?.rank).toBe(1);
  });

  it('keeps records inside their own sport', () => {
    const mixed = [
      ...base,
      ...Array.from({ length: 5 }, (_, i) =>
        activity({
          id: `ride${i}`,
          activityType: 'ride',
          distanceM: 40_000 + i * 1000,
          avgPaceSPerKm: 120,
        }),
      ),
    ];
    const result = computeHighlights(mixed, []);
    // The 8 km run is still the longest RUN even though rides are 40 km.
    expect(find(result, 'r7', 'record_distance')?.rank).toBe(1);
    expect(find(result, 'r7', 'record_distance')?.detail).toContain('runs');
    expect(find(result, 'ride4', 'record_distance')?.rank).toBe(1);
    expect(find(result, 'ride4', 'record_distance')?.detail).toContain('rides');
  });

  it('keeps whole-activity efficiency inside pace sports', () => {
    const rides = Array.from({ length: 6 }, (_, i) =>
      activity({ id: `c${i}`, activityType: 'ride', distanceM: 20_000 + i * 1000 }),
    );
    const result = computeHighlights([...base, ...rides], []);
    expect(kinds(result, 'r7')).toContain('most_efficient');
    expect(kinds(result, 'c5')).not.toContain('most_efficient');
  });
});

describe('computeHighlights — rhythm', () => {
  it('marks a return after a long lay-off', () => {
    const activities = [
      activity({ id: 'x', startDate: 1_700_000_000, day: '2023-11-14' }),
      activity({ id: 'y', startDate: 1_700_000_000 + 40 * 86_400, day: '2023-12-24' }),
    ];
    const result = computeHighlights(activities, []);
    expect(find(result, 'y', 'first_since')?.detail).toBe('First run in 40 days');
    expect(kinds(result, 'x')).toContain('first_of_type');
  });

  it('counts a streak of consecutive days once per day', () => {
    const days = ['2024-03-01', '2024-03-02', '2024-03-03', '2024-03-04'];
    const activities = days.map((d, i) =>
      activity({ id: `s${i}`, day: d, startDate: 1_709_000_000 + i * 86_400 }),
    );
    const result = computeHighlights(activities, []);
    expect(find(result, 's2', 'streak')?.label).toBe('3-day streak');
    expect(find(result, 's3', 'streak')?.label).toBe('4-day streak');
    expect(kinds(result, 's0')).not.toContain('streak');
  });

  it('breaks the streak on a missed day', () => {
    const activities = [
      activity({ id: 'p', day: '2024-03-01', startDate: 1_709_000_000 }),
      activity({ id: 'q', day: '2024-03-02', startDate: 1_709_086_400 }),
      activity({ id: 'r', day: '2024-03-05', startDate: 1_709_345_600 }),
    ];
    const result = computeHighlights(activities, []);
    expect([...result.values()].flat().some((h) => h.kind === 'streak')).toBe(false);
  });
});
