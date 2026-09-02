import { describe, it, expect } from 'vitest';
import {
  PUBLIC_FIELDS,
  pickPublic,
  disclosureLeaks,
  publicDashboard,
  publicSegmentForms,
} from './public-payload';

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
  it('names no struct that could place him', () => {
    // `featuredActivities` used to be carved out here — hand-flagged rows whose
    // routes the landing drew. The Field notes chapter went with the old public
    // document on 2026-09-02 and the key went with it, so there is no
    // place-bearing name on this list at all any more.
    //
    // `dashboardUpdatedAt` is the one entry that trips the pattern, and it is a
    // scalar: the ISO instant the payload finished being assembled. The struct
    // the name evokes is exactly what may NOT be allow-listed — it reaches the
    // anonymous browser through `publicDashboard()` or not at all.
    const scalarExceptions = new Set(['dashboardUpdatedAt']);
    for (const f of PUBLIC_FIELDS) {
      if (scalarExceptions.has(f)) continue;
      expect(f).not.toMatch(/segment|outing|coach|dashboard|route|track|activit/i);
    }
  });

  it('does not allow-list the two structs that have to be projected', () => {
    // The whole point of the projections: these keys are on the ANONYMOUS
    // payload, but they get there by being reshaped, never by being picked.
    for (const key of ['dashboard', 'segmentForms', 'segments', 'chains', 'coach']) {
      expect(PUBLIC_FIELDS as readonly string[]).not.toContain(key);
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

  it('no longer exempts the featured activities', () => {
    // This used to pass `featuredActivities` through untouched, because the
    // public landing drew those routes. It no longer renders them, so the last
    // place-bearing exemption is gone and a polyline under that key is a leak
    // like any other.
    const withFeatured = {
      featuredActivities: [{ id: 1, name: 'Peak District', polyline: 'a}~fFabc' }],
    };
    expect(disclosureLeaks(withFeatured).length).toBeGreaterThan(0);
  });

  it('steps over a stamp that says when a FIGURE was computed', () => {
    // Measured in production 2026-09-02: the anonymous payload tripped the
    // timestamp pattern thirteen times on one request, every one of this shape.
    // `asOf` is when the analytic ran, `observedAt` the date of the newest row.
    expect(disclosureLeaks({ dashboardUpdatedAt: '2026-09-02T09:14:00.000Z' })).toEqual([]);
    expect(disclosureLeaks({ vo2max: { asOf: '2026-09-02T09:14:00.000Z' } })).toEqual([]);
    expect(
      disclosureLeaks({ readiness: { factors: { hrvTrend: { observedAt: '2026-09-01T00:00:00Z' } } } }),
    ).toEqual([]);
    // Nested arbitrarily deep, and in any spelling.
    expect(disclosureLeaks({ a: { b: { as_of: '2026-09-02T09:14:00Z' } } })).toEqual([]);
    expect(disclosureLeaks({ instruments: [{ asOf: '2026-09-02T09:14:00Z' }] })).toEqual([]);
  });

  it('still catches the clock it was written for', () => {
    // The alternative fix was loosening the pattern to spare a UTC instant.
    // That would have blinded it to exactly this, which IS an activity start.
    expect(disclosureLeaks({ startedAt: '2026-08-20T06:41:12Z' })).toContain(
      'startedAt: local timestamp',
    );
    expect(disclosureLeaks({ when: '2026-08-20 06:41:12 +0100' })).toContain(
      'when: local timestamp',
    );
    // A key nobody thought to name is still the backstop's whole job.
    expect(disclosureLeaks({ note: '2026-08-20 06:41' })).toContain('note: local timestamp');
  });

  it('is silent on the exact payload that fired thirteen times in production', () => {
    // Copied from the VPS log, 2026-09-02 14:36:41. Every path the walker named
    // on a single anonymous request, and not one of them placed him.
    const stamp = '2026-09-02T09:14:00.000Z';
    const asOf = { sufficiency: 'ok', sampleSize: 28, asOf: stamp, value: {} };
    const live = {
      readiness: { factors: { hrvTrend: { observedAt: stamp } } },
      vo2max: asOf,
      sleepRegularity: asOf,
      acwr: asOf,
      monotony: asOf,
      polarised: asOf,
      circadian: asOf,
      autonomic: asOf,
      recoveryDebt: asOf,
      dashboard: {
        vo2: { result: asOf },
        load: { trimpAcwr: asOf, strainAcwr: asOf },
        zones28: { polarised: asOf },
      },
    };
    expect(disclosureLeaks(live)).toEqual([]);
  });

  it('does not let a route hide under a stamp key', () => {
    // The exemption is for the TIMESTAMP test only. Everything else the walker
    // does still runs on these keys.
    expect(disclosureLeaks({ asOf: 'ilqvHnb_@k@Uu@]w@a@_A_@}@]{@Wu@Om@Ge@Ai@?g@Bg@Fe@Jc@' }))
      .toContain('asOf: encoded polyline');
    expect(disclosureLeaks({ asOf: 'peacock.sand.setts' })).toContain('asOf: segment name');
    expect(disclosureLeaks({ updatedAt: { polyline: 'a}~fFabc' } }).length).toBeGreaterThan(0);
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

describe('disclosureLeaks — the spellings nobody thought of', () => {
  it('catches a route under a key the exact-name list would have missed', () => {
    expect(disclosureLeaks({ map: { summary_polyline: 'a}~fFabc' } })).toContain(
      'map.summary_polyline: summary_polyline',
    );
    expect(disclosureLeaks({ startLat: 52.6289 }).length).toBeGreaterThan(0);
    expect(disclosureLeaks({ geometry: [[1.29, 52.62]] }).length).toBeGreaterThan(0);
  });

  it('catches an encoded polyline sitting under an innocent key', () => {
    const encoded = 'ilqvHnb_@k@Uu@]w@a@_A_@}@]{@Wu@Om@Ge@Ai@?g@Bg@Fe@Jc@';
    expect(disclosureLeaks({ note: encoded })).toContain('note: encoded polyline');
  });

  it('does not cry wolf over ordinary prose or a whole-number pair', () => {
    expect(disclosureLeaks({ strap: 'Recovery is holding and sleep is short.' })).toEqual([]);
    expect(disclosureLeaks({ window: [7, 30] })).toEqual([]);
    expect(disclosureLeaks({ headline: { primary: 'STEADY', ghost: 'steady' } })).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The projections — 2026-09-02, when the anonymous /health became the same
// nine-section document one section shorter.

/** Structurally what `getTrailsDashboard` returns, trimmed to what matters here. */
const ownerDashboard = {
  profile: { hrMax: 188, hrRest: 48, sex: 'male', hrMaxSource: 'observed' },
  weeks: [{ weekStart: '2026-08-17', totalS: 14400, totalDistanceM: 42000, byType: { Run: 14400 } }],
  load: { days: [{ date: '2026-08-20', load: 88 }], trimpAcwr: null, strainAcwr: null },
  workouts: [
    {
      id: 'strava:14882913',
      // The reason this projection exists: a Strava title is usually a place.
      name: 'Morning run — Teesdale Way to the viaduct',
      activityType: 'Run',
      day: '2026-08-20',
      startDate: 1755671000,
      durationS: 3120,
      distanceM: 9800,
      avgHeartrate: 141,
      trimp: 88,
      ef: 1.82,
      beatsPerKm: 720,
      hrr60: 31,
    },
  ],
};

describe('publicDashboard', () => {
  it('keeps only the day off each workout', () => {
    const projected = publicDashboard(ownerDashboard);
    expect(projected?.workouts).toEqual([{ day: '2026-08-20' }]);
  });

  it('drops the title, the id and the clock — every one of them', () => {
    const serialised = JSON.stringify(publicDashboard(ownerDashboard));
    expect(serialised).not.toContain('Teesdale');
    expect(serialised).not.toContain('strava:14882913');
    expect(serialised).not.toContain('1755671000');
  });

  it('passes the aggregates through untouched', () => {
    const projected = publicDashboard(ownerDashboard);
    expect(projected?.weeks).toEqual(ownerDashboard.weeks);
    expect(projected?.load).toEqual(ownerDashboard.load);
    expect(projected?.profile).toEqual(ownerDashboard.profile);
  });

  it('survives a dashboard that failed to load', () => {
    expect(publicDashboard(null)).toBeNull();
  });

  it('leaves the owner struct alone', () => {
    publicDashboard(ownerDashboard);
    expect(ownerDashboard.workouts[0].name).toContain('Teesdale');
  });
});

const ownerForms = {
  gettable: 2,
  improving: 9,
  withForm: 61,
  nearest: { name: 'peacock.sand.setts', gapPct: 0.014 },
  taxonomy: { improving: 9, holding: 22, slipping: 30, noRead: 326, total: 387 },
  board: [
    { id: 412, name: 'kettle.iron.lane', activityType: 'Run', gapPct: 0.011, daysSincePb: 240, effortCount: 14 },
  ],
};

describe('publicSegmentForms', () => {
  it('keeps the counts and drops the names', () => {
    const projected = publicSegmentForms(ownerForms);
    expect(projected?.taxonomy).toEqual(ownerForms.taxonomy);
    expect(projected?.gettable).toBe(2);
    expect(projected?.improving).toBe(9);
    expect(projected?.nearest).toBeNull();
    expect(projected?.board).toEqual([]);
  });

  it('leaves nothing behind that names ground, or deep-links it', () => {
    const serialised = JSON.stringify(publicSegmentForms(ownerForms));
    expect(serialised).not.toContain('peacock');
    expect(serialised).not.toContain('kettle');
    expect(serialised).not.toContain('412');
  });

  it('survives a segment read that failed', () => {
    expect(publicSegmentForms(null)).toBeNull();
  });
});

describe('the anonymous payload, as the loader assembles it', () => {
  /** `/health/+page.server.ts` in `public` mode, in miniature. */
  const publicPayload = {
    ...pickPublic({
      ...(ownerPayload as unknown as Record<string, unknown>),
      dashboardUpdatedAt: '2026-09-02T09:14:00.000Z',
      acwr: { sufficiency: 'ok', value: { ratio: 1.08 } },
      forecast: { sleep: null, hrv: null, vo2max: null, acwr: null },
      moves: [{ id: 'sleep-window', rank: 1, title: 'Hold the sleep window', instruments: ['SRI'] }],
      tripwires: [
        {
          id: 'segment-pb',
          signal: 'Segment PB in range',
          state: 'TRIPPED',
          now: '2 gettable',
          // The clause that used to name the closest record is absent, not blank.
          meaning: 'The only positive tripwire here — a record is genuinely gettable.',
        },
      ],
      verdict: { headline: ['HOLDING', 'sleep is the lever'], body: ['One paragraph.'] },
      volume: { weekKm: 41.2, medianKm: 38.9, weekStart: '2026-08-17' },
    }),
    dashboard: publicDashboard(ownerDashboard),
    segmentForms: publicSegmentForms(ownerForms),
    segments: null,
    chains: [],
    coach: null,
  };

  it('discloses nothing the walker can find', () => {
    expect(disclosureLeaks(publicPayload)).toEqual([]);
  });

  it('carries the instrument layer the shared dashboard needs', () => {
    for (const key of ['acwr', 'forecast', 'moves', 'tripwires', 'verdict', 'volume', 'dashboard']) {
      expect(publicPayload[key as keyof typeof publicPayload]).toBeDefined();
    }
  });

  it('names no ground anywhere in it', () => {
    const serialised = JSON.stringify(publicPayload);
    for (const place of ['Teesdale', 'peacock', 'kettle', 'strava:']) {
      expect(serialised).not.toContain(place);
    }
  });

  it('still refuses the owner-only structs', () => {
    expect(publicPayload.coach).toBeNull();
    expect(publicPayload.segments).toBeNull();
    expect(publicPayload.chains).toEqual([]);
  });
});
