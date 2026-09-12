import { describe, expect, it } from 'vitest';
import {
  MIN_PEERS,
  domainFor,
  medianOf,
  ordinal,
  peerMetrics,
  peerReading,
  percentileOf,
  quantile,
  swarm,
  swarmRows,
  typePlural,
  type PeerPoint,
  type PeerSet,
} from './activity-peers';

const RUN = peerMetrics(true);
const RIDE = peerMetrics(false);

/** A cohort of `values` for one metric, with the subject at `subjectIndex`. */
function cohort(
  key: string,
  values: Array<number | null>,
  subjectIndex = 0,
  activityType = 'run',
): PeerSet {
  return {
    activityType,
    days: 90,
    to: '2026-08-17',
    activities: values.map((_, i) => ({
      id: `apple:${i}`,
      name: `Outing ${i}`,
      day: `2026-08-${String(17 - i).padStart(2, '0')}`,
    })),
    values: { [key]: values },
    subjectIndex,
  };
}

describe('percentileOf', () => {
  it('is the share of the cohort below, with ties splitting the difference', () => {
    expect(percentileOf([1, 2, 3, 4], 4)).toBe(87.5);
    expect(percentileOf([1, 2, 3, 4], 1)).toBe(12.5);
    // Three identical outings each sit in the middle of their own tie rather
    // than one reading 0 and another 100.
    expect(percentileOf([5, 5, 5], 5)).toBe(50);
  });

  it('has no answer for an empty cohort', () => {
    expect(percentileOf([], 3)).toBeNull();
  });
});

describe('medianOf', () => {
  it('averages the middle pair on an even cohort', () => {
    expect(medianOf([4, 1, 3, 2])).toBe(2.5);
    expect(medianOf([3, 1, 2])).toBe(2);
    expect(medianOf([])).toBeNull();
  });
});

describe('domainFor', () => {
  it('anchors a magnitude metric at zero — rule 3', () => {
    const d = domainFor(RUN.distance, [6, 9, 12], 9);
    expect(d.lo).toBe(0);
    expect(d.hi).toBe(12);
  });

  it('spans the data for a metric with no real floor', () => {
    // A 0-180 bpm axis would clump every outing against the right-hand edge.
    const d = domainFor(RUN.avghr, [140, 150, 160], 150);
    expect(d.lo).toBeGreaterThan(100);
    expect(d.lo).toBeLessThan(140);
    expect(d.hi).toBeGreaterThan(160);
  });

  it('gives a dead-flat cohort a span, so no point lands on NaN', () => {
    const d = domainFor(RUN.avghr, [150, 150, 150], 150);
    expect(d.hi).toBeGreaterThan(d.lo);
  });

  it('widens to contain a subject outside its own cohort', () => {
    const d = domainFor(RUN.avghr, [140, 145], 190);
    expect(d.hi).toBeGreaterThanOrEqual(190);
  });

  it('cuts the axis at p95 when one outlier would flatten everything else', () => {
    // Nineteen rides under 10 km and one of 60: run to the maximum and 95% of
    // the cohort lands in the left sixth of the frame as a single blot.
    const values = [...Array.from({ length: 19 }, (_, i) => 4 + i * 0.2), 60];
    const d = domainFor(RUN.distance, values, 8);
    expect(d.hi).toBeLessThan(20);
    expect(d.beyondHi).toBe(1);
    expect(d.lo).toBe(0);
  });

  it('never cuts the axis in front of the subject', () => {
    const values = [...Array.from({ length: 19 }, (_, i) => 4 + i * 0.2), 60];
    const d = domainFor(RUN.distance, values, 60);
    expect(d.hi).toBeGreaterThanOrEqual(60);
    expect(d.beyondHi).toBe(0);
  });

  it('leaves a well-spread cohort alone — the cut is for outliers, not for tidiness', () => {
    const d = domainFor(RUN.distance, [2, 4, 6, 8, 10, 12], 6);
    expect(d.hi).toBe(12);
    expect(d.beyondHi).toBe(0);
  });

  it('will not cut a cohort too small for a 95th percentile to mean anything', () => {
    const d = domainFor(RUN.distance, [4, 5, 60], 5);
    expect(d.hi).toBe(60);
    expect(d.beyondHi).toBe(0);
  });
});

describe('quantile', () => {
  it('interpolates between the bracketing values', () => {
    expect(quantile([1, 2, 3, 4, 5], 0.5)).toBe(3);
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(quantile([7], 0.95)).toBe(7);
    expect(quantile([], 0.5)).toBeNull();
  });
});

describe('peerReading', () => {
  it('places the subject and words it with the metric’s own comparative', () => {
    const set = cohort('distance', [12, 3, 4, 5, 6, 20], 0);
    const r = peerReading(set, RUN.distance)!;
    expect(r.n).toBe(6);
    expect(r.value).toBe(12);
    expect(Math.round(r.percentile!)).toBe(75);
    expect(r.phrase).toContain('Longer than 75%');
    expect(r.phrase).toContain('runs');
  });

  it('says SLOWER for a high pace, never flipping the number to look like a win', () => {
    // Seconds per km: 400 is the slowest of the five.
    const set = cohort('pace', [400, 300, 310, 320, 330, 500], 0);
    const r = peerReading(set, RUN.pace)!;
    expect(Math.round(r.percentile!)).toBe(75);
    expect(r.phrase).toContain('Slower than 75%');
  });

  it('says FASTER for a high speed on a ride, off the same column', () => {
    const set = cohort('pace', [32, 20, 22, 24, 26, 40], 0, 'ride');
    const r = peerReading(set, RIDE.pace)!;
    expect(r.phrase).toContain('Faster than 75%');
    expect(r.phrase).toContain('rides');
  });

  it('refuses a percentile on a cohort under MIN_PEERS — rule 2', () => {
    const set = cohort('distance', [8, 6, 7], 0);
    const r = peerReading(set, RUN.distance)!;
    expect(r.n).toBe(3);
    expect(r.n).toBeLessThan(MIN_PEERS);
    expect(r.percentile).toBeNull();
    expect(r.phrase).toContain('too few to place');
  });

  it('names an outright extreme rather than placing it at a percentile', () => {
    const set = cohort('distance', [40, 1, 2, 3, 4, 5, 6, 7, 8, 9], 0);
    expect(peerReading(set, RUN.distance)!.phrase).toBe('Longest of all 10 runs in 90 days.');

    const shortest = cohort('distance', [1, 4, 5, 6, 7, 8], 0);
    expect(peerReading(shortest, RUN.distance)!.phrase).toBe(
      'Shortest of all 6 runs in 90 days.',
    );
  });

  it('will not call a JOINT top the longest — a tie is not a superlative', () => {
    const set = cohort('distance', [12, 12, 4, 5, 6], 0);
    const r = peerReading(set, RUN.distance)!;
    expect(r.phrase).toContain('Longer than');
    expect(r.phrase).not.toContain('Longest');
  });

  it('uses the sport’s own superlative on a ride', () => {
    const set = cohort('pace', [40, 20, 22, 24, 26], 0, 'ride');
    expect(peerReading(set, RIDE.pace)!.phrase).toBe('Fastest of all 5 rides in 90 days.');
  });

  it('drops the outings that lack the metric but keeps the ones that have it', () => {
    const set = cohort('maxhr', [180, null, 170, null, 160, 150], 0);
    const r = peerReading(set, RUN.maxhr)!;
    expect(r.n).toBe(4);
    expect(r.points.map((p) => p.value)).toEqual([150, 160, 170, 180]);
  });

  it('reports the subject as missing rather than inventing a position', () => {
    const set = cohort('trimp', [null, 40, 50, 60, 70], 0);
    const r = peerReading(set, RUN.trimp)!;
    expect(r.value).toBeNull();
    expect(r.percentile).toBeNull();
    expect(r.phrase).toContain('Not recorded');
  });

  it('has nothing to show when not one outing carries the metric', () => {
    expect(peerReading(cohort('mets', [null, null, null]), RUN.mets)).toBeNull();
  });

  it('has nothing to show without a cohort at all', () => {
    expect(peerReading(null, RUN.distance)).toBeNull();
  });

  it('flags exactly one point as the subject, and orders the rest by value', () => {
    const set = cohort('distance', [7, 3, 11, 5], 2);
    const r = peerReading(set, RUN.distance)!;
    expect(r.points.filter((p) => p.subject)).toHaveLength(1);
    expect(r.points.find((p) => p.subject)!.value).toBe(11);
    expect(r.points.map((p) => p.value)).toEqual([3, 5, 7, 11]);
  });
});

describe('swarm', () => {
  const points = (values: number[]): PeerPoint[] =>
    values.map((value, i) => ({
      id: `a${i}`,
      name: `A${i}`,
      day: '2026-08-17',
      value,
      subject: false,
    }));

  it('keeps well-separated points on the baseline row', () => {
    const dots = swarm(points([0, 25, 50, 75, 100]), { lo: 0, hi: 100 }, 600, 9);
    expect(dots.every((d) => d.row === 0)).toBe(true);
    expect(dots[0].x).toBe(0);
    expect(dots[4].x).toBe(600);
  });

  it('stacks collisions downward so no outing hides under another', () => {
    const dots = swarm(points([50, 50, 50, 50]), { lo: 0, hi: 100 }, 600, 9);
    expect(dots.map((d) => d.row)).toEqual([0, 1, 2, 3]);
    expect(swarmRows(dots)).toBe(3);
  });

  it('never exceeds maxRows, and keeps every point when it would', () => {
    const dots = swarm(points(new Array(30).fill(50)), { lo: 0, hi: 100 }, 600, 9, 5);
    expect(dots).toHaveLength(30);
    expect(swarmRows(dots)).toBeLessThanOrEqual(4);
  });

  it('survives a domain with no span', () => {
    const dots = swarm(points([5, 5]), { lo: 5, hi: 5 }, 600, 9);
    expect(dots.every((d) => Number.isFinite(d.x))).toBe(true);
  });

  it('pins a value past the axis cut to the edge and flags it, never drops it', () => {
    const dots = swarm(points([10, 50, 300]), { lo: 0, hi: 100 }, 600, 9);
    expect(dots).toHaveLength(3);
    const over = dots.find((d) => d.point.value === 300)!;
    expect(over.x).toBe(600);
    expect(over.beyond).toBe('hi');
    expect(dots.find((d) => d.point.value === 50)!.beyond).toBeNull();
  });

  it('pins a value below the axis cut to the left edge', () => {
    const dots = swarm(points([-40, 50]), { lo: 0, hi: 100 }, 600, 9);
    const under = dots.find((d) => d.point.value === -40)!;
    expect(under.x).toBe(0);
    expect(under.beyond).toBe('lo');
  });
});

describe('wording helpers', () => {
  it('spells ordinals, teens included', () => {
    expect(ordinal(1)).toBe('1st');
    expect(ordinal(2)).toBe('2nd');
    expect(ordinal(3)).toBe('3rd');
    expect(ordinal(11)).toBe('11th');
    expect(ordinal(21)).toBe('21st');
    expect(ordinal(113)).toBe('113th');
  });

  it('pluralises the known sports and falls back for anything else', () => {
    expect(typePlural('trail_run')).toBe('trail runs');
    expect(typePlural('mtb')).toBe('MTB rides');
    expect(typePlural('kayak')).toBe('kayaks');
  });
});

describe('peerMetrics', () => {
  it('gives the pace cell minutes per km for a runner and km/h for a rider', () => {
    expect(RUN.pace.label).toBe('Avg pace');
    expect(RUN.pace.format(360)).toBe('6:00 /km');
    expect(RIDE.pace.label).toBe('Avg speed');
    expect(RIDE.pace.format(24)).toBe('24.0 km/h');
  });

  it('keys every descriptor by the hero cell it describes', () => {
    for (const [key, metric] of Object.entries(RUN)) expect(metric.key).toBe(key);
  });

  it('anchors at zero only where zero is a real floor — rule 3', () => {
    const anchored = Object.values(RUN)
      .filter((m) => m.zeroAnchored)
      .map((m) => m.key)
      .sort();
    expect(anchored).toEqual(['climb', 'descent', 'distance', 'energy', 'mets', 'moving', 'trimp']);
  });
});
