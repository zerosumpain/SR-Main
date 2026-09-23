import { describe, it, expect, vi, beforeEach } from 'vitest';

// The service lane is the only thing this module talks to. Mocking it exercises
// the paths asked for and the whole projection without SR-Health.
const calls: string[] = [];
let respond: (path: string) => unknown = () => {
  throw new Error('no response set');
};

vi.mock('$lib/server/extracted-app', () => ({
  getFromExtracted: vi.fn(async (_app: string, path: string) => {
    calls.push(path);
    return respond(path);
  }),
}));

import {
  ACTIVITY_ROUTE_MAX,
  ELEVATION_MAX,
  HEART_RATE_MAX,
  SEGMENT_EFFORTS_MAX,
  SEGMENT_ROUTE_MAX,
  beforeToEpoch,
  downsample,
  getNativeActivities,
  getNativeActivity,
  getNativeSegment,
  getNativeSegments,
  isActivityId,
  isUpstreamNotFound,
  kcalFromKj,
  parseSegmentId,
  projectActivityDetail,
  projectActivityList,
  projectPhysio,
  projectSegmentDetail,
  projectSegmentList,
  type UpstreamActivityDetail,
  type UpstreamActivityRow,
  type UpstreamEffort,
  type UpstreamSegmentDetail,
  type UpstreamSegmentRow,
} from './native-trails';

beforeEach(() => {
  calls.length = 0;
});

const ROW: UpstreamActivityRow = {
  id: 'apple:ABC-123',
  name: 'Morning run',
  activityType: 'run',
  startDate: 1_758_600_000, // 2025-09-23T04:00:00Z
  startDateLocal: '2025-09-23T05:00:00',
  distanceM: 10_012.4,
  durationS: 3000,
  activeDurationS: 2940,
  elevationGainM: 88.2,
  avgHeartrate: 151,
  maxHeartrate: 178,
  avgPaceSPerKm: 293.6,
  activeEnergyKj: 2929,
  hasTrack: true,
  temperatureC: 12,
  efficiencyFactor: 1.4,
  segmentCount: 3,
};

function track(n: number): [number, number, number | null, number][] {
  return Array.from({ length: n }, (_, i) => [-1.5 + i * 1e-5, 54.5 + i * 2e-5, 40 + i * 0.01, i]);
}

const EFFORT: UpstreamEffort = {
  id: 7,
  activityId: 'apple:ABC-123',
  activityName: 'Morning run',
  activityType: 'run',
  startedAt: 1_758_600_300,
  durationS: 181,
  distanceM: 612,
  paceSPerKm: 295.8,
  avgHeartrate: 160,
  efficiencyFactor: 1.3,
};

function detail(overrides: Partial<UpstreamActivityDetail> = {}): UpstreamActivityDetail {
  return {
    ...ROW,
    source: 'apple_health',
    timezone: 'Europe/London',
    elevationLossM: 86,
    avgCadence: 170,
    coordinates: track(5000),
    bounds: { n: 54.6, s: 54.5, e: -1.4, w: -1.5 },
    elevation: Array.from({ length: 1000 }, (_, i) => ({ distanceM: i * 10.04, elevationM: 40 + i * 0.013 })),
    splits: [{ index: 1, distanceM: 1000, durationS: 290, paceSPerKm: 290, elevationGainM: 8 }],
    series: [
      { metric: 'cadence', units: 'spm', samples: [[0, 170]] },
      { metric: 'heart_rate', units: 'bpm', samples: Array.from({ length: 3000 }, (_, i) => [i, 120 + (i % 40)]) },
    ],
    ...overrides,
  };
}

describe('activity rows', () => {
  it('turns epoch seconds into ISO and kilojoules into kilocalories', () => {
    const { activities } = projectActivityList({ rows: [ROW] }, 30);
    const row = activities[0];
    expect(row.startDate).toBe('2025-09-23T04:00:00.000Z');
    expect(row.startDateLocal).toBe('2025-09-23T05:00:00');
    // 2929 kJ / 4.184 = 700.05 kcal.
    expect(row.energyKcal).toBe(700);
    expect(row.movingS).toBe(2940);
    expect(row.paceSPerKm).toBe(293.6);
    expect(row.highlight).toBeNull();
  });

  it('says where each row came from, and what was folded into it', () => {
    const { activities } = projectActivityList(
      {
        rows: [
          { ...ROW, source: 'companion', alsoFrom: [] },
          { ...ROW, source: 'apple', alsoFrom: ['companion'] },
          ROW,
        ],
      },
      30,
    );
    expect(activities.map((a) => [a.source, a.alsoFrom])).toEqual([
      ['companion', []],
      ['apple', ['companion']],
      // An older Health that sent neither.
      [null, []],
    ]);
  });

  it('keeps a missing energy reading missing rather than zero', () => {
    expect(kcalFromKj(null)).toBeNull();
    const { activities } = projectActivityList({ rows: [{ ...ROW, activeEnergyKj: null }] }, 30);
    expect(activities[0].energyKcal).toBeNull();
  });

  it('carries the highlight when Health includes one', () => {
    const { activities } = projectActivityList(
      { rows: [{ ...ROW, highlight: { label: '2nd fastest', detail: 'on Riverside' } }] },
      30,
    );
    expect(activities[0].highlight).toEqual({ label: '2nd fastest', detail: 'on Riverside' });
  });

  it('hands back a cursor only when a full page came back', () => {
    const rows = [ROW, { ...ROW, id: 'apple:OLDER', startDate: ROW.startDate - 86_400 }];
    expect(projectActivityList({ rows }, 2).nextBefore).toBe('2025-09-22T04:00:00.000Z');
    // A short page is the end of history.
    expect(projectActivityList({ rows }, 3).nextBefore).toBeNull();
    expect(projectActivityList({ rows: [] }, 30).nextBefore).toBeNull();
  });
});

describe('activity detail', () => {
  it('turns the route round to [lat, lng] and thins it to what a phone draws', () => {
    const result = projectActivityDetail({ activity: detail(), physio: null, segments: [], highlights: [] });
    const route = result.activity.route;
    expect(route).toHaveLength(ACTIVITY_ROUTE_MAX);
    // The first point is [lng -1.5, lat 54.5] upstream.
    expect(route[0]).toEqual([54.5, -1.5]);
    // The finish survives the thinning — a route that stops short on the map is a lie.
    const last = track(5000).at(-1)!;
    expect(route.at(-1)).toEqual([Math.round(last[1] * 1e5) / 1e5, Math.round(last[0] * 1e5) / 1e5]);
  });

  it('sends an empty route, not null, for an activity with no track', () => {
    const result = projectActivityDetail({
      activity: detail({ coordinates: null, hasTrack: false, bounds: null }),
      physio: null,
      segments: [],
      highlights: [],
    });
    expect(result.activity.route).toEqual([]);
    expect(result.activity.bounds).toBeNull();
  });

  it('caps the elevation profile and the heart-rate trace', () => {
    const result = projectActivityDetail({ activity: detail(), physio: null, segments: [], highlights: [] });
    expect(result.activity.elevation).toHaveLength(ELEVATION_MAX);
    expect(result.activity.elevation[0]).toEqual({ d: 0, e: 40 });
    expect(result.activity.heartRate).toHaveLength(HEART_RATE_MAX);
    expect(result.activity.heartRate[0]).toEqual({ t: 0, v: 120 });
    expect(result.activity.heartRate.at(-1)!.t).toBe(2999);
  });

  it('reads heart rate from the heart_rate series and not whichever comes first', () => {
    const result = projectActivityDetail({
      activity: detail({ series: [{ metric: 'cadence', units: 'spm', samples: [[0, 170]] }] }),
      physio: null,
      segments: [],
      highlights: [],
    });
    // Cadence is not a heart rate; with no heart_rate series the trace is empty.
    expect(result.activity.heartRate).toEqual([]);
  });

  it('flattens the zones into an ordered list and renames ef', () => {
    const physio = projectPhysio({
      trimp: 88,
      ef: 1.42,
      decouplingPct: 3.1,
      hrr60: 31,
      zones: { z0: 10, z1: 600.4, z2: 1200, z3: 700, z4: 90, z5: 0 },
    });
    expect(physio.efficiencyFactor).toBe(1.42);
    expect(physio.zones).toEqual([
      { zone: 0, seconds: 10 },
      { zone: 1, seconds: 600 },
      { zone: 2, seconds: 1200 },
      { zone: 3, seconds: 700 },
      { zone: 4, seconds: 90 },
      { zone: 5, seconds: 0 },
    ]);
    expect(projectPhysio({ trimp: null, ef: null, decouplingPct: null, hrr60: null, zones: null }).zones).toEqual([]);
  });

  it("shows each segment with the effort's own time and the rank's own denominator", () => {
    const result = projectActivityDetail({
      activity: detail(),
      physio: null,
      highlights: [{ label: 'PB', detail: 'Riverside' }],
      segments: [
        {
          segmentId: 4,
          name: 'Riverside',
          descriptor: '600 m, flat',
          segmentDistanceM: 600,
          effortCount: 19,
          effort: EFFORT,
          rankByTime: 3,
          rankedByTimeOf: 4,
        },
      ],
    });
    expect(result.segments[0]).toEqual({
      segmentId: 4,
      name: 'Riverside',
      descriptor: '600 m, flat',
      distanceM: 612,
      durationS: 181,
      paceSPerKm: 295.8,
      avgHeartrate: 160,
      rankByTime: 3,
      rankedByTimeOf: 4,
      effortCount: 19,
    });
    expect(result.highlights).toEqual([{ label: 'PB', detail: 'Riverside' }]);
    expect(result.activity.highlight).toEqual({ label: 'PB', detail: 'Riverside' });
  });
});

const SEGMENT: UpstreamSegmentRow = {
  id: 4,
  name: 'Riverside',
  descriptor: '600 m, flat',
  activityType: 'run',
  distanceM: 600,
  elevationGainM: 2,
  elevationLossM: 3,
  gradientPct: -0.2,
  terrain: 'flat',
  effortCount: 3,
  lastEffortAt: 1_758_600_300,
  bests: { durationS: 175, paceSPerKm: 291.7 },
  form: { direction: 'improving', deltaPct: -2.1, daysSincePb: 12, spark: [190, 181, 175], pbDurationS: 175 },
};

describe('segments', () => {
  it('orders by the most recent effort, never-done last, and caps the list', () => {
    const rows: UpstreamSegmentRow[] = [
      { ...SEGMENT, id: 1, lastEffortAt: 100 },
      { ...SEGMENT, id: 2, lastEffortAt: null },
      { ...SEGMENT, id: 3, lastEffortAt: 300 },
    ];
    expect(projectSegmentList({ rows }, 100).segments.map((s) => s.id)).toEqual([3, 1, 2]);
    expect(projectSegmentList({ rows }, 1).segments.map((s) => s.id)).toEqual([3]);
  });

  it('flattens the bests and keeps only the form fields the phone reads', () => {
    const [row] = projectSegmentList({ rows: [SEGMENT] }, 100).segments;
    expect(row.lastEffortAt).toBe('2025-09-23T04:05:00.000Z');
    expect(row.bestDurationS).toBe(175);
    expect(row.bestPaceSPerKm).toBe(291.7);
    expect(row.form).toEqual({ direction: 'improving', deltaPct: -2.1, daysSincePb: 12, spark: [190, 181, 175] });
  });

  it('marks the best effort, newest first, and caps the efforts', () => {
    const efforts: UpstreamEffort[] = Array.from({ length: 150 }, (_, i) => ({
      ...EFFORT,
      id: i,
      startedAt: 1_700_000_000 + i * 86_400,
      durationS: i === 20 ? 175 : 200 + i,
    }));
    const segment: UpstreamSegmentDetail = {
      ...SEGMENT,
      coordinates: track(1000),
      efforts,
      conditions: { meanC: 11, quickestC: 9, slowestC: 14 },
    };
    const result = projectSegmentDetail({ segment });
    expect(result.efforts).toHaveLength(SEGMENT_EFFORTS_MAX);
    expect(result.efforts[0].id).toBe(149);
    expect(result.efforts[0].startedAt).toBe(new Date((1_700_000_000 + 149 * 86_400) * 1000).toISOString());
    expect(result.segment.route).toHaveLength(SEGMENT_ROUTE_MAX);
    expect(result.segment.route[0]).toEqual([54.5, -1.5]);
    expect(result.segment.elevationLossM).toBe(3);
    expect(result.segment.conditions).toEqual({ meanC: 11, quickestC: 9, slowestC: 14 });
    // Effort 20 is the PB but is older than the newest hundred, so none shown is best.
    expect(result.efforts.some((e) => e.isBest)).toBe(false);

    const recent = projectSegmentDetail({ segment: { ...segment, efforts: efforts.slice(0, 30) } });
    expect(recent.efforts.filter((e) => e.isBest).map((e) => e.id)).toEqual([20]);
  });

  it('falls back to the form PB when the bests are empty', () => {
    const segment: UpstreamSegmentDetail = {
      ...SEGMENT,
      bests: { durationS: null, paceSPerKm: null },
      coordinates: [],
      efforts: [{ ...EFFORT, durationS: 175 }, { ...EFFORT, id: 8, durationS: 190 }],
      conditions: null,
    };
    const result = projectSegmentDetail({ segment });
    expect(result.efforts.map((e) => e.isBest)).toEqual([true, false]);
    expect(result.segment.route).toEqual([]);
    expect(result.segment.conditions).toBeNull();
  });
});

describe('ids, cursors and failures', () => {
  it('accepts a source-prefixed activity id and nothing that could escape the path', () => {
    expect(isActivityId('apple:6F9619FF-8B86-D011-B42D-00C04FC964FF')).toBe(true);
    expect(isActivityId('strava:12345')).toBe(true);
    expect(isActivityId('ABC')).toBe(false);
    expect(isActivityId('apple:../../admin')).toBe(false);
    expect(isActivityId('apple:a/b')).toBe(false);
    expect(isActivityId('apple:a?x=1')).toBe(false);
  });

  it('takes only canonical positive integers as segment ids', () => {
    expect(parseSegmentId('42')).toBe(42);
    for (const bad of ['0', '-1', '07', '1e3', '1.5', 'abc', '', '99999999999999999']) {
      expect(parseSegmentId(bad)).toBeNull();
    }
  });

  it('reads an ISO cursor as epoch seconds and ignores a bad one', () => {
    expect(beforeToEpoch('2025-09-23T04:00:00.000Z')).toBe(1_758_600_000);
    expect(beforeToEpoch(null)).toBeNull();
    expect(beforeToEpoch('')).toBeNull();
    expect(beforeToEpoch('yesterday')).toBeNull();
  });

  it("tells Health's 404 apart from Health being down", () => {
    expect(isUpstreamNotFound(new Error('health/api/trails/activities/x returned 404'))).toBe(true);
    expect(isUpstreamNotFound(new Error('health/api/trails/activities/x returned 500'))).toBe(false);
    expect(isUpstreamNotFound(new Error('health/api/trails/segments timed out after 6000ms'))).toBe(false);
    expect(isUpstreamNotFound('returned 404')).toBe(false);
  });

  it('downsamples evenly and keeps both ends', () => {
    expect(downsample([1, 2, 3], 5)).toEqual([1, 2, 3]);
    expect(downsample([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 3)).toEqual([0, 5, 10]);
    expect(downsample([1, 2, 3], 0)).toEqual([]);
  });
});

describe('the service-lane calls', () => {
  it('pages the activity list with an epoch cursor', async () => {
    respond = () => ({ rows: [ROW], total: 1 });
    const result = await getNativeActivities({ limit: 30, before: 1_758_600_000 });
    expect(calls).toEqual(['/api/trails/activities?limit=30&before=1758600000']);
    expect(result.activities).toHaveLength(1);
  });

  it('encodes the activity id into the upstream path', async () => {
    respond = () => ({ activity: detail(), physio: null, segments: [], highlights: [] });
    await getNativeActivity('apple:ABC-123');
    expect(calls).toEqual(['/api/trails/activities/apple%3AABC-123']);
  });

  it('asks for the segment list and a segment by id', async () => {
    respond = (path) =>
      path === '/api/trails/segments'
        ? { rows: [SEGMENT], types: [] }
        : { segment: { ...SEGMENT, coordinates: [], efforts: [], conditions: null } };
    await getNativeSegments({ limit: 100 });
    await getNativeSegment(4);
    expect(calls).toEqual(['/api/trails/segments', '/api/trails/segments/4']);
  });
});
