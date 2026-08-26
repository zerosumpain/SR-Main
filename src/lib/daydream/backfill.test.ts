import { describe, it, expect } from 'vitest';
import { downsample, parseHistoryRow, MIN_GAP_SECONDS, MIN_MOVE_M, type RawFix } from './backfill';

const T0 = new Date('2026-08-26T09:00:00Z');
const at = (secs: number) => new Date(T0.getTime() + secs * 1000);

function fix(secs: number, lat = 51.5, lon = -0.12): RawFix {
  return { ts: at(secs), lat, lon, accuracyM: 10, state: 'home', batteryPct: 80 };
}

/** ~111 m per 0.001° of latitude. */
const northOf = (lat: number, m: number) => lat + m / 111_320;

describe('parseHistoryRow', () => {
  it('reads a position off an attribute-change row', () => {
    const f = parseHistoryRow({
      state: 'not_home',
      last_updated: '2026-08-26T09:00:00+00:00',
      attributes: { latitude: 51.5, longitude: -0.12, gps_accuracy: 15, battery_level: 64 },
    });
    expect(f).not.toBeNull();
    expect(f!.lat).toBe(51.5);
    expect(f!.accuracyM).toBe(15);
    expect(f!.batteryPct).toBe(64);
    expect(f!.state).toBe('not_home');
  });

  it('returns null for a row with no GPS', () => {
    // Which is most of them on `person.*` — the reason the tracker entity is
    // resolved from `source` rather than the person being used directly.
    expect(parseHistoryRow({ state: 'home', last_updated: '2026-08-26T09:00:00Z', attributes: {} })).toBeNull();
  });

  it('rejects Null Island', () => {
    expect(
      parseHistoryRow({
        state: 'home',
        last_updated: '2026-08-26T09:00:00Z',
        attributes: { latitude: 0, longitude: 0 },
      }),
    ).toBeNull();
  });

  it('returns null rather than an Invalid Date when the stamp is unusable', () => {
    expect(
      parseHistoryRow({ state: 'home', last_updated: 'not-a-date', attributes: { latitude: 51.5, longitude: -0.12 } }),
    ).toBeNull();
    expect(parseHistoryRow({ state: 'home', attributes: { latitude: 51.5, longitude: -0.12 } })).toBeNull();
  });

  it('prefers last_updated, which is what moves when only attributes change', () => {
    const f = parseHistoryRow({
      state: 'home',
      last_changed: '2026-08-26T08:00:00Z',
      last_updated: '2026-08-26T09:00:00Z',
      attributes: { latitude: 51.5, longitude: -0.12 },
    });
    expect(f!.ts.toISOString()).toBe('2026-08-26T09:00:00.000Z');
  });
});

describe('downsample', () => {
  it('always keeps the first fix', () => {
    expect(downsample([fix(0)])).toHaveLength(1);
  });

  it('thins a dense stationary stream down to the time interval', () => {
    // One fix every 20s for 10 minutes, never moving: 31 in, a handful out.
    const dense = Array.from({ length: 31 }, (_, i) => fix(i * 20));
    const kept = downsample(dense);
    expect(kept.length).toBeLessThan(8);
    expect(kept.length).toBeGreaterThan(2);
  });

  it('keeps a fast movement even inside the time window', () => {
    // Distance alone is why: sampling on time would smear a journey into a
    // straight line between two far-apart points.
    const moving = [
      fix(0),
      { ...fix(20), lat: northOf(51.5, 300) },
      { ...fix(40), lat: northOf(51.5, 600) },
    ];
    expect(downsample(moving)).toHaveLength(3);
  });

  it('keeps a long stationary dwell even with no movement', () => {
    // Time alone is why: sampling on distance would throw away the dwell that
    // defines a place in the first place.
    const dwell = [fix(0), fix(MIN_GAP_SECONDS + 1), fix(2 * MIN_GAP_SECONDS + 2)];
    expect(downsample(dwell)).toHaveLength(3);
  });

  it('drops a fix that is neither far enough nor late enough', () => {
    const tight = [fix(0), { ...fix(5), lat: northOf(51.5, MIN_MOVE_M / 4) }];
    expect(downsample(tight)).toHaveLength(1);
  });

  it('handles an empty stream', () => {
    expect(downsample([])).toEqual([]);
  });

  it('honours overridden thresholds', () => {
    const dense = Array.from({ length: 5 }, (_, i) => fix(i * 30));
    expect(downsample(dense, { minGapSeconds: 30, minMoveM: 10_000 })).toHaveLength(5);
    expect(downsample(dense, { minGapSeconds: 10_000, minMoveM: 10_000 })).toHaveLength(1);
  });
});
