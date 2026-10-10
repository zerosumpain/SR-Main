import { describe, expect, it } from 'vitest';
import { curveRing, ringArea, smoothMap, smoothPath, staircaseRings } from './wildmind-smooth';
import { wildmindFixture } from './wildmind.fixture';

const NOW = Date.parse('2026-10-10T13:30:00Z');

/** Every absolute point a smoothed path passes through or bends towards. */
function points(d: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let x = 0;
  let y = 0;
  const re = /([Mqz])([^Mqz]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(d))) {
    const n = (m[2].match(/-?\d*\.?\d+/g) ?? []).map(Number);
    if (m[1] === 'M') {
      [x, y] = n;
      out.push([x, y]);
    } else if (m[1] === 'q') {
      out.push([x + n[0], y + n[1]]);
      x += n[2];
      y += n[3];
      out.push([x, y]);
    }
  }
  return out;
}

describe('staircase rings', () => {
  it('reads the tracer’s rings and tells an island from a hole', () => {
    const rings = staircaseRings('M0 0h4v4h-4zM1 1v2h2v-2z');
    expect(rings).toEqual([
      [
        [0, 0],
        [4, 0],
        [4, 4],
        [0, 4],
      ],
      [
        [1, 1],
        [1, 3],
        [3, 3],
        [3, 1],
      ],
    ]);
    expect(ringArea(rings[0])).toBe(16);
    expect(ringArea(rings[1])).toBe(-4);
  });
});

describe('smoothing', () => {
  it('draws a ring as curves that stay inside its cells’ bounds', () => {
    const d = curveRing(staircaseRings('M0 0h6v2h2v4h-8z')[0]);
    expect(d).toMatch(/^M[\d.]+ [\d.]+(q[-\d. ]+)+z$/);
    for (const [x, y] of points(d)) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(8);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(6);
    }
  });

  it('turns a one-cell staircase into a straight diagonal (one curve, not a step per cell)', () => {
    // A right triangle stepped one cell at a time down its long side.
    let d = 'M0 0h1';
    for (let i = 0; i < 9; i++) d += 'v1h1';
    d += 'v1h-10z';
    const rings = staircaseRings(d);
    expect(rings[0].length).toBeGreaterThan(18);
    expect((curveRing(rings[0]).match(/q/g) ?? []).length).toBeLessThan(8);
  });

  it('drops specks and fills small holes, keeping the rest', () => {
    const d = 'M0 0h10v10h-10zM2 2v2h2v-2zM20 20h1v1h-1zM5 5v4h4v-4z';
    const rings = (p: string) => (p.match(/M/g) ?? []).length;
    expect(rings(smoothPath(d, 4, 12))).toBe(2); // the land and the big hole
    expect(rings(smoothPath(d, 4, 12, true))).toBe(1); // its rim only
    expect(smoothPath('M0 0h1v1h-1z')).toBe('');
  });

  it('smooths the real valley into fewer, cleaner rings, the same each time', () => {
    const map = wildmindFixture(NOW).map!;
    const s = smoothMap(map);
    expect(smoothMap(map)).toBe(s);
    const count = (d: string) => (d.match(/M/g) ?? []).length;
    const before = count(map.seen) + map.layers.reduce((n, l) => n + count(l.d), 0);
    const after = count(s.seen) + s.layers.reduce((n, l) => n + count(l.d), 0);
    expect(after).toBeLessThan(before);
    expect(s.seen).not.toMatch(/[hv]/);
    expect(count(s.edge)).toBe(2);
    // Small enough to send in the page: well under the tracer's grid.
    const size = s.seen.length + s.edge.length + s.layers.reduce((n, l) => n + l.d.length, 0);
    expect(size).toBeLessThan(24_000);
  });
});
