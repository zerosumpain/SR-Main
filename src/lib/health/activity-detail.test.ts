import { describe, expect, it } from 'vitest';
import type { ActivityDetail } from '$lib/trails/activities-service';
import type { ActivityPhysio } from '$lib/trails/physio-service';
import type { Split, TrackPoint } from '$lib/trails/track';
import {
  capitalise,
  comparisonNote,
  comparisons,
  decouplingNote,
  distanceAxis,
  fullLocalDate,
  heroStats,
  hrrNote,
  interpolate,
  meanOf,
  paceRange,
  provenanceNote,
  resample,
  sharePhrase,
  spell,
  splitRows,
  splitsNote,
  timeAxis,
  zoneRows,
  zonesNote,
} from './activity-detail';

function activity(over: Partial<ActivityDetail> = {}): ActivityDetail {
  return {
    id: 'a1',
    name: 'Curlew hill repeats',
    activityType: 'trail_run',
    sourceType: 'run',
    typeOverride: null,
    startDate: 1_755_453_840,
    startDateLocal: '2026-08-17 18:04:00',
    distanceM: 6200,
    durationS: 2600,
    activeDurationS: 2478,
    elevationGainM: 198,
    avgHeartrate: 154,
    maxHeartrate: 179,
    avgPaceSPerKm: 400,
    activeEnergyKj: 2088,
    hasTrack: true,
    polyline: null,
    temperatureC: 16,
    efficiencyFactor: 0.97,
    segmentCount: 4,
    excludedFromSegments: false,
    source: 'apple_health',
    rawType: 'HKWorkoutActivityTypeRunning',
    endDate: 1_755_456_318,
    timezone: 'Europe/London',
    elevationLossM: 191,
    totalEnergyKj: 2200,
    humidityPct: 74,
    avgCadence: 164,
    metadata: null,
    coordinates: null,
    bounds: null,
    elevation: [],
    splits: [],
    series: [],
    ...over,
  } as ActivityDetail;
}

function physio(over: Partial<ActivityPhysio> = {}): ActivityPhysio {
  return {
    trimp: 88,
    trimpBasis: 'series',
    ef: 0.97,
    decouplingPct: 4.2,
    hrr60: 32,
    hrrCurve: null,
    zones: null,
    zoneEdges: [93, 112, 130, 149, 167],
    hrMax: 186,
    hrMaxSource: 'tanaka',
    mets: 9.4,
    minHr: 68,
    temperatureC: 16,
    humidityPct: 74,
    typical: { paceSPerKm: 412, avgHr: 151, ef: 0.94, n: 68 },
    ...over,
  };
}

function split(over: Partial<Split> = {}): Split {
  return { index: 1, distanceM: 1000, durationS: 388, paceSPerKm: 388, elevationGainM: 42, ...over };
}

describe('spell / capitalise / sharePhrase', () => {
  it('spells the numbers the copy uses', () => {
    expect(spell(0)).toBe('zero');
    expect(spell(11)).toBe('eleven');
    expect(spell(30)).toBe('thirty');
    expect(spell(32)).toBe('thirty-two');
    expect(spell(99)).toBe('ninety-nine');
  });

  it('falls back to the numeral outside 0–99', () => {
    expect(spell(140)).toBe('140');
  });

  it('capitalises for the head of a sentence', () => {
    expect(capitalise(spell(32))).toBe('Thirty-two');
    expect(capitalise('')).toBe('');
  });

  it('turns a share into a phrase a person would say', () => {
    expect(sharePhrase(47.7)).toBe('nearly half');
    expect(sharePhrase(95)).toBe('almost all of');
    expect(sharePhrase(3)).toBe('a sliver of');
  });
});

describe('fullLocalDate', () => {
  it('reads the local string rather than re-interpreting it as a Date', () => {
    expect(fullLocalDate('2026-08-17 18:04:00', 1_755_453_840, 'Europe/London')).toBe(
      'Monday 17 August 2026 · 18:04 · Europe/London',
    );
  });

  it('keeps a late-evening workout on its own day', () => {
    // The classic failure: 23:40 local read as UTC and printed as the next day.
    expect(fullLocalDate('2026-08-17T23:40:00', 0, null)).toBe('Monday 17 August 2026 · 23:40');
  });

  it('falls back to the epoch when the local string is unusable', () => {
    expect(fullLocalDate('', 0, null)).toContain('1970');
  });
});

describe('heroStats', () => {
  it('draws the eight base cells even where a figure is missing', () => {
    const cells = heroStats(activity({ avgHeartrate: null, maxHeartrate: null }), null);
    expect(cells).toHaveLength(8);
    expect(cells.map((c) => c.key)).toEqual([
      'distance', 'moving', 'pace', 'climb', 'descent', 'avghr', 'maxhr', 'energy',
    ]);
    expect(cells.find((c) => c.key === 'avghr')?.value).toBe('—');
    expect(cells.find((c) => c.key === 'avghr')?.unit).toBeNull();
  });

  it('adds the four physiology cells only when each figure exists', () => {
    const cells = heroStats(activity(), physio());
    expect(cells).toHaveLength(12);
    expect(cells.find((c) => c.key === 'trimp')).toMatchObject({ value: '88', lit: true });
    expect(cells.find((c) => c.key === 'hrr60')).toMatchObject({ value: '−32', unit: 'bpm' });
    expect(cells.find((c) => c.key === 'mets')?.value).toBe('9.4');
  });

  it('drops a physiology cell rather than printing a zero', () => {
    const cells = heroStats(activity(), physio({ trimp: null, hrr60: null }));
    expect(cells.map((c) => c.key)).not.toContain('trimp');
    expect(cells.map((c) => c.key)).not.toContain('hrr60');
    expect(cells).toHaveLength(10);
  });

  it('reads km/h on wheels and pace on foot', () => {
    expect(heroStats(activity(), null).find((c) => c.key === 'pace')).toMatchObject({
      label: 'Avg pace',
      value: '6:40',
      unit: '/km',
    });
    expect(
      heroStats(activity({ activityType: 'ride' }), null).find((c) => c.key === 'pace'),
    ).toMatchObject({ label: 'Avg speed', unit: 'km/h' });
  });

  it('reports energy in the unit it is stored in', () => {
    expect(heroStats(activity(), null).find((c) => c.key === 'energy')).toMatchObject({
      value: '2088',
      unit: 'kJ',
    });
  });
});

describe('paceRange', () => {
  it('spans the 5th to 95th percentile of the trace, in seconds per km', () => {
    // A degree of longitude at the equator is ~111.3 km; 0.001° ≈ 111 m.
    const points: TrackPoint[] = [];
    for (let i = 0; i < 60; i++) {
      // A steady 111 m every 30 s → 270 s/km, with one 10× jump the
      // percentile bounds must not let through.
      const dt = i === 30 ? 3 : 30;
      points.push([0.001 * i, 0, null, i === 0 ? 0 : points[i - 1][3] + dt]);
    }
    const range = paceRange(points);
    expect(range).not.toBeNull();
    expect(range!.slowSPerKm).toBeGreaterThan(range!.fastSPerKm);
    expect(range!.slowSPerKm).toBeGreaterThan(200);
    // The one 10× step is outside the 95th percentile and never sets the bound.
    expect(range!.fastSPerKm).toBeGreaterThan(100);
  });

  it('is null without a usable trace', () => {
    expect(paceRange(null)).toBeNull();
    expect(paceRange([[0, 0, null, 0]])).toBeNull();
  });
});

describe('zoneRows / zonesNote', () => {
  const zones = { z0: 12, z1: 84, z2: 246, z3: 678, z4: 1182, z5: 276 };
  const edges = [93, 112, 130, 149, 167];

  it('returns six rows with absolute bands that do not overlap', () => {
    const rows = zoneRows(zones, edges);
    expect(rows).toHaveLength(6);
    expect(rows.map((r) => r.range)).toEqual([
      '< 93', '93–111', '112–129', '130–148', '149–166', '167+',
    ]);
  });

  it('marks the zone the outing actually sat in', () => {
    const rows = zoneRows(zones, edges);
    expect(rows.filter((r) => r.lead).map((r) => r.label)).toEqual(['Z4']);
    expect(rows[4].pct).toBeCloseTo(47.7, 0);
  });

  it('keeps an empty zone as a zero row rather than dropping the column', () => {
    const rows = zoneRows({ z0: 0, z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 }, edges);
    expect(rows).toHaveLength(6);
    expect(rows.every((r) => r.pct === 0 && !r.lead)).toBe(true);
  });

  it('writes the note off the distribution', () => {
    const note = zonesNote(zoneRows(zones, edges));
    expect(note).toContain('Nearly half this outing sat in Z4');
    expect(note).toContain('eleven percent went above Z4');
  });

  it('does not claim time went above the top band', () => {
    // Z5 has nothing above it, so the "and n percent went above" clause has to
    // go — it read as "sat in Z5 and 67% went above it".
    const top = zonesNote(zoneRows({ z0: 0, z1: 0, z2: 60, z3: 120, z4: 360, z5: 1080 }, edges));
    expect(top).toContain('sat in Z5');
    expect(top).not.toContain('went above');
  });
});

describe('splitRows / splitsNote', () => {
  const splits: Split[] = [
    split({ index: 1, durationS: 388, paceSPerKm: 388, elevationGainM: 42 }),
    split({ index: 2, durationS: 412, paceSPerKm: 412, elevationGainM: 58 }),
    split({ index: 3, durationS: 374, paceSPerKm: 374, elevationGainM: 12 }),
    split({ index: 4, durationS: 418, paceSPerKm: 418, elevationGainM: 54 }),
    split({ index: 5, distanceM: 200, durationS: 91, paceSPerKm: 455, elevationGainM: 0 }),
  ];

  it('flags the trailing split without touching its numbers', () => {
    const rows = splitRows(splits);
    const last = rows[4];
    expect(last.partial).toBe(true);
    // Reported at its TRUE distance, with the pace left as the extrapolation
    // the service computed. Neither is recomputed here.
    expect(last.distanceM).toBe(200);
    expect(last.paceSPerKm).toBe(455);
  });

  it('scales the bars against the slowest split on the table', () => {
    const rows = splitRows(splits);
    // The 200 m trailing split is long enough for its extrapolation to be
    // worth trusting, so it is the slowest row and the 100% bar.
    expect(rows[4].relative).toBeCloseTo(100, 5);
    expect(rows[3].relative).toBeCloseTo((418 / 455) * 100, 5);
    expect(rows[2].relative).toBeLessThan(rows[0].relative);
  });

  it('will not let a tiny trailing fragment squash every real bar', () => {
    // 12 m read as a full kilometre: an extrapolation nothing should be scaled
    // against. The full kilometres keep the scale to themselves.
    const rows = splitRows([
      ...splits.slice(0, 4),
      split({ index: 5, distanceM: 12, durationS: 11, paceSPerKm: 917, elevationGainM: 0 }),
    ]);
    expect(rows[3].relative).toBeCloseTo(100, 5);
    expect(rows[4].relative).toBe(100);
  });

  it('marks the fastest full split and the biggest climb, once each', () => {
    const rows = splitRows(splits);
    expect(rows.filter((r) => r.fastest).map((r) => r.index)).toEqual([3]);
    expect(rows.filter((r) => r.biggestClimb).map((r) => r.index)).toEqual([2]);
  });

  it('says when pace is reading the gradient rather than the legs', () => {
    const note = splitsNote(splitRows(splits));
    expect(note).toContain('Split 3 is the quickest and the flattest');
    expect(note).toContain('reading of the gradient');
  });

  it('is empty with too few splits to compare', () => {
    expect(splitsNote(splitRows([split()]))).toBe('');
    expect(splitRows([])).toEqual([]);
  });
});

describe('comparisons', () => {
  it('reads improvements as good and costs as accent', () => {
    const result = comparisons(activity(), physio());
    expect(result).not.toBeNull();
    expect(result!.n).toBe(68);
    expect(result!.rows).toEqual([
      { label: 'Pace', text: '3% faster', tone: 'good' },
      { label: 'Heart rate', text: '+3 bpm', tone: 'cost' },
      { label: 'Efficiency', text: '+3%', tone: 'good' },
    ]);
  });

  it('does not compare against a median built from under three outings', () => {
    expect(comparisons(activity(), physio({ typical: { paceSPerKm: 412, avgHr: 151, ef: 0.94, n: 2 } }))).toBeNull();
    expect(comparisons(activity(), null)).toBeNull();
  });

  it('sums the rows up without naming a population norm', () => {
    const note = comparisonNote(comparisons(activity(), physio())!.rows);
    expect(note).toContain('never a population norm');
  });
});

describe('the derived paragraphs', () => {
  it('reads HRR60 out with its band', () => {
    expect(hrrNote(32)).toContain('Thirty-two beats off in the first minute');
    expect(hrrNote(32)).toContain('Above thirty');
    expect(hrrNote(14)).toContain('Under twenty beats');
    expect(hrrNote(null)).toBe('');
  });

  it('reads decoupling either side of the 5% line', () => {
    expect(decouplingNote(4.2, 2478)).toContain('held to the end');
    expect(decouplingNote(7.1, 2478)).toContain('went past it');
    expect(decouplingNote(null, 2478)).toBe('');
  });

  it('says whose type this is and what load was computed from', () => {
    const label = (t: string) => (t === 'trail_run' ? 'Trail run' : 'Run');
    expect(provenanceNote(activity(), physio(), label)).toContain('straight from the source');
    expect(provenanceNote(activity(), physio(), label)).toContain('heart-rate series');
    expect(
      provenanceNote(activity({ typeOverride: 'trail_run' }), physio({ trimpBasis: 'average' }), label),
    ).toContain('The watch called this a run');
    expect(
      provenanceNote(activity({ typeOverride: 'trail_run' }), physio({ trimpBasis: 'average' }), label),
    ).toContain('computed from the average');
  });
});

describe('series geometry', () => {
  it('bucket-averages rather than sampling, so a spike does not survive', () => {
    const points: Array<[number, number]> = [];
    for (let i = 0; i < 100; i++) points.push([i, i === 50 ? 500 : 100]);
    const out = resample(points, 10);
    expect(out).toHaveLength(10);
    expect(Math.max(...out.map((p) => p[1]))).toBeLessThan(200);
    expect(out[0][0]).toBeGreaterThanOrEqual(0);
  });

  it('leaves a short series alone', () => {
    const points: Array<[number, number]> = [[0, 1], [1, 2]];
    expect(resample(points, 10)).toBe(points);
  });

  it('labels the axes off the last point', () => {
    expect(timeAxis([[0, 1], [2478, 2]])).toEqual(['0:00', '20:39', '41:18']);
    expect(distanceAxis([[0, 1], [6200, 2]])).toEqual(['0 km', '3.1 km', '6.2 km']);
    expect(timeAxis([])).toEqual([]);
  });

  it('finds a value between samples, and refuses to invent one outside them', () => {
    const curve: Array<[number, number]> = [[0, 179], [40, 158], [90, 141]];
    expect(interpolate(curve, 0)).toBe(179);
    expect(interpolate(curve, 40)).toBe(158);
    expect(interpolate(curve, 65)).toBeCloseTo(149.5, 5);
    expect(interpolate(curve, 120)).toBeNull();
    expect(interpolate([[0, 1]], 0)).toBeNull();
  });

  it('means a series for the dashed average line', () => {
    expect(meanOf([[0, 100], [1, 200]])).toBe(150);
    expect(meanOf([])).toBeNull();
  });
});
