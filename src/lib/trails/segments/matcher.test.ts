import { describe, it, expect } from 'vitest';
import { discoverSegments } from './matcher';
import { makeSource } from './fixtures';

/** Total efforts across every segment found, for the "did it see the lap" tests. */
function effortsOn(segments: ReturnType<typeof discoverSegments>['segments'], id: string): number {
  return segments.reduce((n, s) => n + s.efforts.filter((e) => e.activityId === id).length, 0);
}

describe('discoverSegments — the 500 m / 20 m contract', () => {
  it('matches two traces of the same kilometre', () => {
    const { segments } = discoverSegments([
      makeSource('a', [[0, 0], [1000, 0]]),
      makeSource('b', [[0, 0], [1000, 0]]),
    ]);

    expect(segments).toHaveLength(1);
    expect(segments[0].distanceM).toBeGreaterThan(900);
    expect(segments[0].efforts.map((e) => e.activityId).sort()).toEqual(['a', 'b']);
  });

  it('matches traces 12 m apart — that is GPS drift, not a different path', () => {
    const { segments } = discoverSegments([
      makeSource('a', [[0, 0], [1000, 0]]),
      makeSource('b', [[0, 12], [1000, 12]]),
    ]);
    expect(segments).toHaveLength(1);
    expect(segments[0].efforts).toHaveLength(2);
  });

  it('refuses traces 45 m apart — that is the other side of the road', () => {
    const { segments } = discoverSegments([
      makeSource('a', [[0, 0], [1000, 0]]),
      makeSource('b', [[0, 45], [1000, 45]]),
    ]);
    expect(segments).toEqual([]);
  });

  it('finds the shared 600 m of two otherwise different walks', () => {
    const { segments } = discoverSegments([
      makeSource('a', [[0, 0], [600, 0], [600, 900]]),
      makeSource('b', [[0, 0], [600, 0], [1500, 0]]),
    ]);

    expect(segments).toHaveLength(1);
    expect(segments[0].distanceM).toBeGreaterThan(540);
    expect(segments[0].distanceM).toBeLessThan(700);
  });

  it('refuses a shared stretch of only 300 m', () => {
    const { segments } = discoverSegments([
      makeSource('a', [[0, 0], [300, 0], [300, 900]]),
      makeSource('b', [[0, 0], [300, 0], [1200, 0]]),
    ]);
    expect(segments).toEqual([]);
  });

  it('honours a raised minimum length', () => {
    const sources = [
      makeSource('a', [[0, 0], [800, 0]]),
      makeSource('b', [[0, 0], [800, 0]]),
    ];
    expect(discoverSegments(sources).segments).toHaveLength(1);
    expect(discoverSegments(sources, { minLengthM: 1000 }).segments).toEqual([]);
  });

  it('never returns a segment shorter than the threshold it claims', () => {
    // A winding shared path: the chord sum between resampled points reads
    // shorter than the distance walked, which is what let 479 m segments
    // through a "500 m" filter in the first place.
    const winding: Array<[number, number]> = [];
    for (let i = 0; i <= 60; i++) winding.push([i * 10, i % 2 === 0 ? 0 : 9]);

    for (const minLengthM of [500, 400, 600]) {
      const { segments } = discoverSegments(
        [makeSource('a', winding), makeSource('b', winding.map(([e, n]) => [e, n + 5]))],
        { minLengthM },
      );
      for (const segment of segments) {
        expect(segment.distanceM).toBeGreaterThanOrEqual(minLengthM);
      }
    }
  });

  it('spans the threshold in steps, not in points', () => {
    // 495 m used to qualify: 50 resampled points enclose only 49 steps, so a
    // "500 m" segment measured 490. It must not any more. Deliberately not
    // testing exactly 500 m — that lands on a float boundary where the summed
    // chords come to 499.999…, and a knife-edge case would pin rounding noise
    // rather than the rule.
    const at = (m: number): Array<[number, number]> => [[0, 0], [m, 0]];
    expect(
      discoverSegments([makeSource('a', at(560)), makeSource('b', at(560))]).segments,
    ).toHaveLength(1);
    expect(
      discoverSegments([makeSource('a', at(495)), makeSource('b', at(495))]).segments,
    ).toEqual([]);
  });
});

describe('discoverSegments — direction', () => {
  it('does not match the same path walked the other way', () => {
    const { segments } = discoverSegments([
      makeSource('a', [[0, 0], [1200, 0]]),
      makeSource('b', [[1200, 0], [0, 0]]),
    ]);
    expect(segments).toEqual([]);
  });

  it('treats a whole out-and-back that two outings both did as one stretch', () => {
    // Both walk out to 900 m and back. Neither ever covers that ground any
    // other way, so the shared stretch IS the out-and-back — and comparing
    // the two efforts still compares like with like, which is what the
    // direction rule is actually protecting.
    const { segments } = discoverSegments([
      makeSource('a', [[0, 0], [900, 0], [0, 0]]),
      makeSource('b', [[0, 0], [900, 0], [0, 0]]),
    ]);

    expect(segments).toHaveLength(1);
    expect(segments[0].efforts.map((e) => e.activityId).sort()).toEqual(['a', 'b']);
    expect(segments[0].distanceM).toBeGreaterThan(1600);
  });

  it('splits the one-way half out as soon as anyone walks only that half', () => {
    const { segments } = discoverSegments([
      makeSource('a', [[0, 0], [900, 0], [0, 0]]),
      makeSource('b', [[0, 0], [900, 0], [0, 0]]),
      // c goes out the same way and then carries on north instead of back.
      makeSource('c', [[0, 6], [900, 6], [900, 700]]),
    ]);

    const bySize = [...segments].sort((x, y) => y.distanceM - x.distanceM);
    expect(bySize).toHaveLength(2);

    // The full out-and-back, which only a and b did.
    expect(bySize[0].distanceM).toBeGreaterThan(1600);
    expect(bySize[0].efforts.map((e) => e.activityId).sort()).toEqual(['a', 'b']);

    // The outbound leg alone, which all three did.
    expect(bySize[1].distanceM).toBeGreaterThan(750);
    expect(bySize[1].distanceM).toBeLessThan(1000);
    expect(bySize[1].efforts.map((e) => e.activityId).sort()).toEqual(['a', 'b', 'c']);
  });
});

describe('discoverSegments — repeats within one activity', () => {
  it('counts two laps of a loop as two efforts by the same activity', () => {
    const lap: Array<[number, number]> = [[0, 0], [800, 0], [800, 400], [0, 400], [0, 0]];
    const { segments } = discoverSegments([makeSource('a', [...lap, ...lap.slice(1)])]);

    expect(segments.length).toBeGreaterThan(0);
    expect(effortsOn(segments, 'a')).toBeGreaterThanOrEqual(2);
    for (const segment of segments) {
      expect(segment.efforts.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('counts a there-and-back-again repeat, which shares its turnaround', () => {
    // The hard case: at the turnaround the outbound and return points are
    // neighbours in index. Only heading tells them apart.
    const out: Array<[number, number]> = [[0, 0], [900, 0]];
    const back: Array<[number, number]> = [[900, 0], [0, 0]];
    const { segments } = discoverSegments([
      makeSource('a', [...out, ...back.slice(1), ...out.slice(1), ...back.slice(1)]),
    ]);

    expect(segments.length).toBeGreaterThan(0);
    expect(effortsOn(segments, 'a')).toBeGreaterThanOrEqual(2);
  });
});

describe('discoverSegments — grouping', () => {
  it('gathers three walks of the same lane into one segment', () => {
    const { segments } = discoverSegments([
      makeSource('a', [[0, 0], [1000, 0]]),
      makeSource('b', [[0, 8], [1000, -6]]),
      makeSource('c', [[0, -10], [1000, 5]]),
    ]);

    expect(segments).toHaveLength(1);
    expect(segments[0].efforts.map((e) => e.activityId).sort()).toEqual(['a', 'b', 'c']);
  });

  it('keeps a long shared stretch and its much shorter busy core apart', () => {
    // a and b share 2 km. c only joins for the last 600 m of it. The long
    // two-way stretch and the short three-way core are different comparisons
    // and both should survive.
    const { segments } = discoverSegments([
      makeSource('a', [[0, 0], [2000, 0]]),
      makeSource('b', [[0, 6], [2000, 6]]),
      makeSource('c', [[1400, -6], [2000, -6]]),
    ]);

    expect(segments.length).toBe(2);
    const bySize = [...segments].sort((x, y) => y.distanceM - x.distanceM);
    expect(bySize[0].distanceM).toBeGreaterThan(1800);
    expect(bySize[0].efforts).toHaveLength(2);
    expect(bySize[1].distanceM).toBeLessThan(700);
    expect(bySize[1].efforts).toHaveLength(3);
  });

  it('does not emit the same stretch twice from different references', () => {
    const walks = ['a', 'b', 'c', 'd'].map((id, i) =>
      makeSource(id, [[0, i * 4], [1400, i * 4]]),
    );
    const { segments } = discoverSegments(walks);
    expect(segments).toHaveLength(1);
    expect(segments[0].efforts).toHaveLength(4);
  });

  it('never mixes activity types', () => {
    const { segments } = discoverSegments([
      makeSource('run', [[0, 0], [1200, 0]], { activityType: 'run' }),
      makeSource('ride', [[0, 0], [1200, 0]], { activityType: 'ride' }),
    ]);
    expect(segments).toEqual([]);
  });

  it('respects a raised minimum effort count', () => {
    const sources = [
      makeSource('a', [[0, 0], [1200, 0]]),
      makeSource('b', [[0, 5], [1200, 5]]),
    ];
    expect(discoverSegments(sources).segments).toHaveLength(1);
    expect(discoverSegments(sources, { minEfforts: 3 }).segments).toEqual([]);
  });
});

describe('discoverSegments — the efforts it hands back', () => {
  it('times each effort on its own clock, at its own speed', () => {
    const { segments } = discoverSegments([
      makeSource('slow', [[0, 0], [1000, 0]], { speedMps: 1.5 }),
      makeSource('fast', [[0, 4], [1000, 4]], { speedMps: 3 }),
    ]);

    expect(segments).toHaveLength(1);
    const byId = Object.fromEntries(segments[0].efforts.map((e) => [e.activityId, e]));
    const slow = byId.slow.endS - byId.slow.startS;
    const fast = byId.fast.endS - byId.fast.startS;
    expect(slow / fast).toBeCloseTo(2, 0);
    expect(byId.slow.distanceM).toBeGreaterThan(800);
  });

  it('reports each effort its own measured distance, not the canonical one', () => {
    const { segments } = discoverSegments([
      makeSource('straight', [[0, 0], [1400, 0]]),
      // A wandering line over the same ground covers more of it.
      makeSource('weaving', [
        [0, 0], [200, 14], [400, -14], [600, 14], [800, -14], [1000, 14], [1200, -14], [1400, 0],
      ]),
    ]);

    expect(segments).toHaveLength(1);
    const byId = Object.fromEntries(segments[0].efforts.map((e) => [e.activityId, e]));
    expect(byId.weaving.distanceM).toBeGreaterThan(byId.straight.distanceM);
  });

  it('bridges a dropped fix rather than severing the stretch', () => {
    // b jumps 35 m off-line for 40 m of its path, then rejoins — one bad fix.
    const { segments } = discoverSegments([
      makeSource('a', [[0, 0], [1500, 0]]),
      makeSource('b', [[0, 0], [700, 0], [720, 35], [760, 35], [780, 0], [1500, 0]]),
    ]);

    expect(segments).toHaveLength(1);
    expect(segments[0].distanceM).toBeGreaterThan(1300);
  });

  it('ignores a trace that merely stands near the path', () => {
    const { segments } = discoverSegments([
      makeSource('walker', [[0, 0], [1500, 0]]),
      makeSource('loiterer', [[700, 3], [712, 6], [700, 3], [712, 6]], { spacingM: 2 }),
    ]);
    expect(segments).toEqual([]);
  });

  it('says so when it drops segments at the cap instead of going quiet', () => {
    const sources = Array.from({ length: 6 }, (_, i) =>
      makeSource(`w${i}`, [[i * 5000, 0], [i * 5000 + 1200, 0]]),
    ).flatMap((s, i) => [s, makeSource(`x${i}`, [[i * 5000, 5], [i * 5000 + 1200, 5]])]);

    const { segments, notes } = discoverSegments(sources, { maxSegments: 2 });
    expect(segments).toHaveLength(2);
    expect(notes.join(' ')).toMatch(/dropped at the 2-segment cap/);
  });
});
