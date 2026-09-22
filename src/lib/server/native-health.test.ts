import { describe, it, expect, vi, beforeEach } from 'vitest';

// The service lane is the only thing this module talks to. Mocking it exercises
// the whole mapping — units, directions, the fingerprint — without a database,
// a gateway or SR-Health.
const responses = new Map<string, unknown>();
let failing: string | null = null;

vi.mock('$lib/server/extracted-app', () => ({
  getFromExtracted: vi.fn(async (_app: string, path: string) => {
    if (failing === path) throw new Error(`${path} is down`);
    if (!responses.has(path)) throw new Error(`unexpected path ${path}`);
    return responses.get(path);
  }),
}));

import { getNativeHealthSummary, fingerprintOf } from './native-health';

const CONTEXT = {
  seriesIsMock: false,
  strap: 'Body reporting in.',
  today: { rec: 61, hrv: 52, rhr: 58, slept: 7.4 },
  todayDeltas: { hrvDeltaPct: -8, rhrDelta: 3, sleepDelta: -0.75 },
  days: [
    { date: '2026-09-20', rec: 55, hrv: 48, rhr: 60, slept: 6.8, sleepScore: 71 },
    { date: '2026-09-21', rec: 58, hrv: 50, rhr: 59, slept: 8.15, sleepScore: 80 },
    { date: '2026-09-22', rec: 61, hrv: 52, rhr: 58, slept: 7.4, sleepScore: 77 },
  ],
  readiness: { score: 72.4, label: 'Ready', recommendation: 'Train as planned.' },
};

const STATS = {
  weekly: {
    activities: 4,
    // Metres, as the source reports them.
    totalDistance: 41203,
    // Seconds.
    totalDuration: 12840,
    totalElevation: 410.7,
    avgRecovery: 63,
    avgSleep: 71,
  },
  personalRecords: [
    { label: 'Longest Run', value: 21.1, unit: 'km', date: '2026-05-04' },
    { label: 'Fastest Pace', value: 4.53, unit: 'min/km', display: '4:32 /km', date: '2026-06-11' },
  ],
};

beforeEach(() => {
  responses.clear();
  responses.set('/api/health/context', structuredClone(CONTEXT));
  responses.set('/api/health/stats', structuredClone(STATS));
  failing = null;
});

/** Always fresh: the module caches for a minute and tests are faster than that. */
const summary = () => getNativeHealthSummary({ fresh: true });

describe('the four figures', () => {
  it('carries every figure with its unit and its window', async () => {
    const result = await summary();
    expect(result.figures.map((f) => f.key)).toEqual(['recovery', 'hrv', 'rhr', 'sleep']);
    expect(result.figures.map((f) => f.unit)).toEqual(['%', 'ms', 'bpm', 'h']);
    // A figure with no window is a number with no frame — /health's own rule.
    for (const figure of result.figures) expect(figure.caption).toBeTruthy();
  });

  it('knows that a resting heart rate going DOWN is the good direction', async () => {
    const result = await summary();
    const rhr = result.figures.find((f) => f.key === 'rhr')!;
    const hrv = result.figures.find((f) => f.key === 'hrv')!;
    // Both moved; only one of them moved the right way, and it is not the one
    // whose number went up.
    expect(rhr.direction).toBe('up');
    expect(rhr.improving).toBe(false);
    expect(hrv.direction).toBe('down');
    expect(hrv.improving).toBe(false);
  });

  it('renders sleep as hours and minutes, never as a decimal', async () => {
    const result = await summary();
    const sleep = result.figures.find((f) => f.key === 'sleep')!;
    expect(sleep.display).toBe('7h 24m');
    // 0.75 of an hour down is 45 minutes, and the sign is the typographic minus.
    expect(sleep.deltaDisplay).toBe('−45m');
  });

  it('says nothing rather than "+0" when a figure did not move', async () => {
    responses.set('/api/health/context', {
      ...structuredClone(CONTEXT),
      todayDeltas: { hrvDeltaPct: 0, rhrDelta: 0, sleepDelta: 0 },
    });
    const result = await summary();
    for (const figure of result.figures) {
      expect(figure.deltaDisplay).toBeNull();
      expect(figure.improving).toBeNull();
    }
  });

  it('renders a missing figure as an em dash, never as a zero', async () => {
    // Zero is MISSING in this data — the series service fills a gap rather than
    // dropping it, because a hole plots as a hole in every chart. "0 ms" is a
    // confident statement about a heart that did not report.
    responses.set('/api/health/context', {
      ...structuredClone(CONTEXT),
      today: { rec: 0, hrv: 0, rhr: 0, slept: 0 },
    });
    const result = await summary();
    expect(result.figures.map((f) => f.display)).toEqual(['—', '—', '—', '—']);
  });

  it('moves the fingerprint when a figure goes missing', async () => {
    const before = await summary();
    responses.set('/api/health/context', {
      ...structuredClone(CONTEXT),
      today: { ...CONTEXT.today, hrv: 0 },
    });
    // Losing a reading is itself worth being told about.
    expect((await summary()).fingerprint).not.toBe(before.fingerprint);
  });

  it('passes the series through in source order for a sparkline', async () => {
    const result = await summary();
    expect(result.figures.find((f) => f.key === 'rhr')!.series).toEqual([60, 59, 58]);
  });
});

describe('the week', () => {
  it('converts metres to kilometres and seconds to minutes', async () => {
    const result = await summary();
    // 41,203 metres is a number nobody reads as a distance.
    expect(result.week).toMatchObject({
      activities: 4,
      distanceKm: 41.2,
      durationMinutes: 214,
      elevationM: 411,
    });
  });

  it('prefers a record\'s rendered display over its raw value', async () => {
    const result = await summary();
    expect(result.records[1].display).toBe('4:32 /km');
    // And falls back to value + unit where there is no rendering.
    expect(result.records[0].display).toBe('21.1 km');
  });

  it('keeps the four figures when the weekly block is unavailable', async () => {
    failing = '/api/health/stats';
    const result = await summary();
    expect(result.figures).toHaveLength(4);
    expect(result.week).toBeNull();
    expect(result.records).toEqual([]);
  });

  it('throws when the series itself is unavailable', async () => {
    failing = '/api/health/context';
    // Without it there is nothing to render, and the app has a designed state
    // for that. Four dashes would read as "you did nothing yesterday".
    await expect(summary()).rejects.toThrow();
  });
});

describe('the fingerprint', () => {
  it('is stable across calls that changed nothing', async () => {
    const a = await summary();
    const b = await summary();
    expect(a.fingerprint).toBe(b.fingerprint);
  });

  it('does not hash the time it was generated', async () => {
    // Asserted by MOVING the stamp rather than by hoping two calls land in
    // different milliseconds — they do not, and the first version of this test
    // asserted they would. `generatedAt` in the hash would make every poll a
    // change, and the three-hour floor would become the only thing standing
    // between the phone and a notification every three hours, for ever.
    const result = await summary();
    const later = { ...result, generatedAt: '2027-01-01T00:00:00.000Z' };
    expect(fingerprintOf(later)).toBe(result.fingerprint);
  });

  it('moves when a figure moves', async () => {
    const before = await summary();
    responses.set('/api/health/context', {
      ...structuredClone(CONTEXT),
      today: { ...CONTEXT.today, rhr: 61 },
    });
    const after = await summary();
    expect(after.fingerprint).not.toBe(before.fingerprint);
  });

  it('ignores a wobble under the rounding the screen shows', async () => {
    const before = await summary();
    responses.set('/api/health/context', {
      ...structuredClone(CONTEXT),
      today: { ...CONTEXT.today, hrv: 52.01 },
    });
    // Otherwise a source that reports more precision than the screen does turns
    // the three-hour floor into a notification every three hours, for ever.
    expect((await summary()).fingerprint).toBe(before.fingerprint);
  });

  it('is not fooled by a day gained at midnight', async () => {
    const before = await summary();
    const grown = structuredClone(CONTEXT);
    grown.days.push({ date: '2026-09-23', rec: 61, hrv: 52, rhr: 58, slept: 7.4, sleepScore: 77 });
    responses.set('/api/health/context', grown);
    expect((await summary()).fingerprint).toBe(before.fingerprint);
  });

  it('distinguishes demonstration data from measurement', async () => {
    const real = await summary();
    responses.set('/api/health/context', { ...structuredClone(CONTEXT), seriesIsMock: true });
    const mock = await summary();
    expect(mock.isMock).toBe(true);
    expect(mock.fingerprint).not.toBe(real.fingerprint);
  });

  it('hashes only what it claims to', async () => {
    const result = await summary();
    expect(fingerprintOf(result)).toBe(result.fingerprint);
    expect(result.fingerprint).toHaveLength(16);
  });
});
