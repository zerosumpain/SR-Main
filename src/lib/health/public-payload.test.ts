import { describe, it, expect } from 'vitest';
import { PUBLIC_FIELDS, pickPublic, disclosureLeaks } from './public-payload';

/** Roughly the shape /health builds for a signed-in owner. */
const ownerPayload = {
  // shared, allow-listed
  series: [{ date: '2026-08-20', rec: 61, hrv: 42, rhr: 54, slept: 7.2, strain: 11.4, steps: 9021, weight: 0 }],
  today: { date: '2026-08-20', rec: 61, hrv: 42, rhr: 54, slept: 7.2, strain: 11.4, steps: 9021, weight: 0 },
  headline: { primary: 'STEADY', ghost: 'steady' },
  strap: 'Recovery holding, sleep short.',
  rhrBaseline: 55,
  syncedAgoSeconds: 900,
  readiness: { score: 68, label: 'Ready', recommendation: 'Go steady' },
  vo2max: { sufficiency: 'ok', value: { vo2max: 48.2 } },
  stats: { weekly: { activities: 6, avgRecovery: 62 } },
  provenance: { seriesIsMock: false, correlationsAreIllustrative: false },

  // owner-only — none of this may survive the pick
  outings: [
    {
      id: 'apple:ABC',
      name: 'Outdoor Run',
      startDateLocal: '2026-08-20 06:41:12 +0100',
      highlight: { kind: 'segment_rank', label: 'Segment PB', segmentName: 'peacock.sand.setts' },
    },
  ],
  segments: {
    records: { fastestPace: { segmentId: 12, name: 'kettle.iron.lane' } },
  },
  dashboard: { workouts: [{ day: '2026-08-20', trimp: 88 }] },
  coach: {
    route: { coordinates: [[1.2954, 52.6289], [1.2961, 52.6301]] },
  },
};

describe('PUBLIC_FIELDS', () => {
  it('names nothing that could place him, bar the one documented carve-out', () => {
    // featuredActivities is opt-in: rows flagged `featured` by hand, whose
    // routes this page has shown publicly since it launched. It is the ONLY
    // place-bearing key on the list, and it is named here so that adding a
    // second one has to change this test.
    const carveOuts = new Set(['featuredActivities']);
    for (const f of PUBLIC_FIELDS) {
      if (carveOuts.has(f)) continue;
      expect(f).not.toMatch(/segment|outing|coach|dashboard|route|track|activit/i);
    }
  });
});

describe('pickPublic', () => {
  it('drops every owner-only key', () => {
    const publicPayload = pickPublic(ownerPayload as unknown as Record<string, unknown>);
    for (const key of ['outings', 'segments', 'dashboard', 'coach', 'correlations']) {
      expect(key in publicPayload).toBe(false);
    }
  });

  it('keeps the aggregate body metrics', () => {
    const publicPayload = pickPublic(ownerPayload as unknown as Record<string, unknown>);
    expect(publicPayload.series).toBeDefined();
    expect(publicPayload.readiness).toBeDefined();
    expect(publicPayload.vo2max).toBeDefined();
  });

  it('adds nothing that was not in the source', () => {
    const picked = pickPublic({ series: [] } as Record<string, unknown>);
    expect(Object.keys(picked)).toEqual(['series']);
  });
});

describe('disclosureLeaks', () => {
  it('passes a clean public payload', () => {
    expect(disclosureLeaks(pickPublic(ownerPayload as unknown as Record<string, unknown>))).toEqual([]);
  });

  it('catches a route smuggled in under any key', () => {
    const leaks = disclosureLeaks({ series: [], anything: { polyline: 'a}~fFabc' } });
    expect(leaks).toContain('anything.polyline: polyline');
  });

  it('catches a bare coordinate pair', () => {
    const leaks = disclosureLeaks({ start: [1.2954, 52.6289] });
    expect(leaks.some((l) => l.includes('coordinate pair'))).toBe(true);
  });

  it('catches a per-outing local clock', () => {
    const leaks = disclosureLeaks({ when: '2026-08-20 06:41:12 +0100' });
    expect(leaks).toContain('when: local timestamp');
  });

  it('catches a segment name even inside prose-free data', () => {
    expect(disclosureLeaks({ label: 'peacock.sand.setts' })).toContain('label: segment name');
  });

  it('catches the whole owner payload', () => {
    const leaks = disclosureLeaks(ownerPayload);
    expect(leaks.length).toBeGreaterThan(3);
  });

  it('exempts the hand-curated featured activities, and only those', () => {
    const withFeatured = {
      featuredActivities: [{ id: 1, name: 'Peak District', polyline: 'a}~fFabc' }],
    };
    expect(disclosureLeaks(withFeatured)).toEqual([]);

    const nested = { analytics: { featuredActivities: [{ polyline: 'a}~fFabc' }] } };
    expect(disclosureLeaks(nested).length).toBeGreaterThan(0);
  });

  it('does not mistake a plain 30-day series for geography', () => {
    const series = Array.from({ length: 30 }, (_, i) => ({
      date: `2026-08-${String(i + 1).padStart(2, '0')}`,
      rec: 60,
      hrv: 45,
      rhr: 54,
      slept: 7.1,
      strain: 10.2,
      steps: 8000,
      weight: 0,
    }));
    expect(disclosureLeaks({ series })).toEqual([]);
  });
});
