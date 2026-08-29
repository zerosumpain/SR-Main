import { describe, it, expect } from 'vitest';
import {
  signedArea,
  ringArea,
  ringPerimeter,
  pathLength,
  pointInRing,
  bboxOf,
  bboxesOverlap,
  segmentIntersection,
  isSimpleRing,
  windingNumber,
  type Vec2,
} from './rings';

const SQUARE: Vec2[] = [
  [0, 0],
  [100, 0],
  [100, 100],
  [0, 100],
];

describe('rings', () => {
  it('shoelace area of a 100 m square is 10,000 m2', () => {
    expect(ringArea(SQUARE)).toBeCloseTo(10_000, 6);
  });

  it('signed area carries the winding direction', () => {
    expect(signedArea(SQUARE)).toBeGreaterThan(0);
    expect(signedArea([...SQUARE].reverse())).toBeLessThan(0);
    expect(ringArea([...SQUARE].reverse())).toBeCloseTo(10_000, 6);
  });

  it('a degenerate ring has zero area', () => {
    expect(ringArea([[0, 0], [10, 0]])).toBe(0);
    expect(ringArea([[0, 0], [10, 0], [20, 0]])).toBeCloseTo(0, 9);
  });

  it('perimeter closes the ring, path length does not', () => {
    expect(ringPerimeter(SQUARE)).toBeCloseTo(400, 6);
    expect(pathLength(SQUARE)).toBeCloseTo(300, 6);
  });

  describe('pointInRing', () => {
    it('accepts an interior point and rejects an exterior one', () => {
      expect(pointInRing([50, 50], SQUARE)).toBe(true);
      expect(pointInRing([150, 50], SQUARE)).toBe(false);
      expect(pointInRing([50, -1], SQUARE)).toBe(false);
    });

    it('is not fooled by a vertex lying on the ray', () => {
      // y = 100 passes exactly through two vertices; the half-open crossing
      // rule must count each edge once or this reports "inside".
      expect(pointInRing([-5, 100], SQUARE)).toBe(false);
      expect(pointInRing([-5, 0], SQUARE)).toBe(false);
    });

    it('counts both lobes of a self-touching figure-of-eight', () => {
      // Two squares meeting at the origin, traced as one stroke. The lobes wind
      // in OPPOSITE directions, which is the case the rule has to survive.
      const eight: Vec2[] = [
        [0, 0], [100, 0], [100, 100], [0, 100], [0, 0],
        [-100, 0], [-100, -100], [0, -100],
      ];
      expect(pointInRing([50, 50], eight)).toBe(true);
      expect(pointInRing([-50, -50], eight)).toBe(true);
      expect(pointInRing([-50, 50], eight)).toBe(false);
      expect(pointInRing([50, -50], eight)).toBe(false);
    });

    it('a one-stroke figure-of-eight with lobes of opposite sign keeps both', () => {
      // The reviewers' shape: lobes are +1 and -1. A signed-AREA test cancels
      // them; a nonzero WINDING test does not, because a point is only ever
      // inside one lobe at a time.
      const eight: Vec2[] = [[0, 0], [-100, 50], [-100, -50], [0, 0], [100, -50], [100, 50]];
      expect(pointInRing([-50, 0], eight)).toBe(true);
      expect(pointInRing([50, 0], eight)).toBe(true);
      expect(pointInRing([200, 0], eight)).toBe(false);
    });

    it('the interior of a DOUBLY-WOUND ring is inside, not outside', () => {
      // Two laps of the same block, retraced exactly. Even-odd counts two
      // crossings for every interior point and calls the whole block outside,
      // so capture would flip on the PARITY of the lap count.
      const lap: Vec2[] = [[0, 0], [200, 0], [200, 200], [0, 200]];
      for (const n of [1, 2, 3, 4, 10]) {
        const wound: Vec2[] = [];
        for (let i = 0; i < n; i++) wound.push(...lap);
        expect(pointInRing([100, 100], wound), `${n} laps`).toBe(true);
        expect(pointInRing([300, 100], wound), `${n} laps, outside`).toBe(false);
      }
    });
  });

  describe('windingNumber', () => {
    it('counts the laps, which is what makes a repeated ring measurable', () => {
      const lap: Vec2[] = [[0, 0], [200, 0], [200, 200], [0, 200]];
      for (const n of [1, 2, 3, 10]) {
        const wound: Vec2[] = [];
        for (let i = 0; i < n; i++) wound.push(...lap);
        expect(Math.abs(windingNumber([100, 100], wound)), `${n} laps`).toBe(n);
        expect(windingNumber([300, 100], wound), `${n} laps, outside`).toBe(0);
        // The shoelace scales with the lap count; the ground does not.
        expect(ringArea(wound)).toBeCloseTo(n * 40_000, 6);
      }
    });
  });

  describe('isSimpleRing', () => {
    it('is true for a square and false for a bowtie', () => {
      expect(isSimpleRing(SQUARE)).toBe(true);
      expect(isSimpleRing([[0, 0], [100, 0], [0, 100], [100, 100]])).toBe(false);
    });
  });

  it('bbox and overlap', () => {
    expect(bboxOf(SQUARE)).toEqual({ minX: 0, minY: 0, maxX: 100, maxY: 100 });
    expect(bboxesOverlap(bboxOf(SQUARE), { minX: 50, minY: 50, maxX: 150, maxY: 150 })).toBe(true);
    expect(bboxesOverlap(bboxOf(SQUARE), { minX: 200, minY: 0, maxX: 300, maxY: 100 })).toBe(false);
  });

  describe('segmentIntersection', () => {
    it('finds a proper crossing', () => {
      const p = segmentIntersection([0, 0], [10, 10], [0, 10], [10, 0]);
      expect(p).not.toBeNull();
      expect(p![0]).toBeCloseTo(5, 9);
      expect(p![1]).toBeCloseTo(5, 9);
    });

    it('returns null for parallel and for collinear overlap', () => {
      expect(segmentIntersection([0, 0], [10, 0], [0, 5], [10, 5])).toBeNull();
      expect(segmentIntersection([0, 0], [10, 0], [5, 0], [15, 0])).toBeNull();
    });

    it('returns null when segments merely share an endpoint', () => {
      // Consecutive legs of a track touch at every vertex; counting those as
      // self-intersections would make every journey a loop.
      expect(segmentIntersection([0, 0], [10, 0], [10, 0], [10, 10])).toBeNull();
    });

    it('returns null when they would cross only beyond their ends', () => {
      expect(segmentIntersection([0, 0], [1, 1], [10, 0], [10, 5])).toBeNull();
    });
  });
});
