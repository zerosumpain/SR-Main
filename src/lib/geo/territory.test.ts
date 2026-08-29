// End to end over the geometry core: two people's real walks -> capture events
// -> ownership -> the rings the page would draw. This is the brief's hardest
// sentence ("people can win geometry within another's") as one test.
import { describe, it, expect } from 'vitest';
import { detectLoops } from './loops';
import { captureEvents, resolveOwnership, type CaptureEvent } from './ownership';
import { dissolveTiles } from './dissolve';
import { tileAreaM2, tileCentre, tileKeyOf } from './tiles';
import { square, walk, ORIGIN } from './test-fixtures';

const NOW = new Date('2026-08-29T12:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

describe('territory', () => {
  it('katie punches a hole through john and the map is a handful of rings', () => {
    const john = detectLoops(walk(square(600))).rings[0];
    const katie = detectLoops(walk(square(150, [200, 200]))).rings[0];

    const events: CaptureEvent[] = [
      ...captureEvents('john', john.tiles, daysAgo(30)),
      ...[2, 4, 6, 8, 10].flatMap((d) => captureEvents('katie', katie.tiles, daysAgo(d))),
    ];

    const owned = resolveOwnership(events, NOW);
    const held = (who: string) =>
      [...owned.values()].filter((t) => t.owner === who).map((t) => ({ x: t.tileX, y: t.tileY }));

    const johnRegions = dissolveTiles(held('john'));
    const katieRegions = dissolveTiles(held('katie'));

    // John keeps one piece of ground with a hole in the middle of it.
    expect(johnRegions).toHaveLength(1);
    expect(johnRegions[0].holes).toHaveLength(1);
    // Katie's territory is the hole, as one solid piece.
    expect(katieRegions).toHaveLength(1);
    expect(katieRegions[0].holes).toHaveLength(0);
    expect(katieRegions[0].tileCount).toBe(katie.tiles.length);

    // The whole map is a handful of rings, not a cell per square.
    const rings = [...johnRegions, ...katieRegions].reduce((n, r) => n + 1 + r.holes.length, 0);
    expect(rings).toBeLessThan(10);
    expect(owned.size).toBeGreaterThan(150);
  });

  it('leaderboard area is cell count times the per-latitude constant', () => {
    const ring = detectLoops(walk(square(600))).rings[0];
    const cell = tileAreaM2(tileCentre(ring.tiles[0].x, ring.tiles[0].y).lat);
    const boardArea = ring.tiles.length * cell;
    // The two are computed by completely different routes — a cell count and a
    // shoelace — so they agree only up to the quantisation along the boundary,
    // which is about perimeter x cell / (2 x area), here roughly 15%. Measured
    // 6.9%. The leaderboard reports the CELL COUNT figure; this asserts the
    // shoelace has not drifted into a different order of magnitude, which is
    // what a projection bug would look like.
    expect(Math.abs(boardArea - ring.areaM2)).toBeLessThan(ring.areaM2 * 0.15);
    expect(Math.abs(cell - tileAreaM2(ORIGIN.lat))).toBeLessThan(1);
  });

  it('a second lap the same day changes nothing at all — not even the decay', () => {
    const ring = detectLoops(walk(square(600))).rings[0];
    const once = captureEvents('john', ring.tiles, daysAgo(1));
    const twice = [
      ...once,
      ...captureEvents('john', ring.tiles, new Date(daysAgo(1).getTime() + 3_600_000)),
    ];
    const a = resolveOwnership(once, NOW);
    const b = resolveOwnership(twice, NOW);
    expect(b.size).toBe(a.size);
    for (const [k, v] of a) expect(b.get(k)!.score).toBeCloseTo(v.score, 9);
    expect(a.get(tileKeyOf(ring.tiles[0].x, ring.tiles[0].y))).toBeDefined();
  });
});
