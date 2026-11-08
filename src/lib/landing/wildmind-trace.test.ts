import { describe, expect, it } from 'vitest';
import recorded from './fixtures/wildmind-day16.json';
import { parseSnapshot, type WildmindTerrain } from './wildmind';
import { despeckle, MAX_ACROSS, MAX_CORNERS, traceCached, traceGrid, traceRings } from './wildmind-trace.server';

/** Walks a path's `M x y h… v… z` rings back to their corner lists. */
function rings(d: string): Array<Array<[number, number]>> {
  const out: Array<Array<[number, number]>> = [];
  for (const ring of d.split('z').filter(Boolean)) {
    const m = /^M(-?\d+) (-?\d+)(.*)$/.exec(ring);
    if (!m) throw new Error(`bad ring ${ring}`);
    let x = Number(m[1]);
    let y = Number(m[2]);
    const pts: Array<[number, number]> = [[x, y]];
    for (const [, k, v] of m[3].matchAll(/([hv])(-?\d+)/g)) {
      if (k === 'h') x += Number(v);
      else y += Number(v);
      pts.push([x, y]);
    }
    out.push(pts);
  }
  return out;
}

/** Even-odd area of a set of axis-aligned rings (shoelace per ring, signs ignored by parity). */
function cellsInside(d: string, w: number, h: number): Set<string> {
  const rs = rings(d);
  const inside = new Set<string>();
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      // Cast a ray right from the cell centre and count vertical edges crossed.
      const cx = i + 0.5;
      const cy = j + 0.5;
      let n = 0;
      for (const r of rs)
        for (let k = 0; k < r.length; k++) {
          const [ax, ay] = r[k];
          const [bx, by] = r[(k + 1) % r.length];
          if (ax === bx && ax > cx && Math.min(ay, by) < cy && Math.max(ay, by) > cy) n++;
        }
      if (n % 2) inside.add(`${i},${j}`);
    }
  return inside;
}

function grid(rows: string[], terrains = ['grass', 'deep_fresh', 'forest']): WildmindTerrain {
  const h = rows.length;
  const w = rows[0].length;
  const t = new Uint8Array(w * h);
  const height = new Uint8Array(w * h);
  rows.forEach((row, j) =>
    [...row].forEach((c, i) => {
      t[j * w + i] = c === '.' ? 0 : Number(c);
      height[j * w + i] = c === '.' ? 0 : c === '3' ? 70 : 30;
    }),
  );
  return { origin: [0, 0], step: 1, w, h, terrains, t: Buffer.from(t).toString('base64'), height: Buffer.from(height).toString('base64'), regions: [] };
}

describe('traceRings', () => {
  it('outlines a single cell as one closed square', () => {
    const r = traceRings(3, 3, (i, j) => i === 1 && j === 1);
    expect(r).toMatchObject({ rings: 1, corners: 4 });
    expect(r.d).toBe('M1 1h1v1h-1z');
  });

  it('closes every ring and covers exactly the cells inside, holes and saddles included', () => {
    const rows = ['11111.', '1...1.', '1.1.1.', '1...11', '11111.', '.1.1.1'];
    const w = rows[0].length;
    const h = rows.length;
    const inside = (i: number, j: number) => rows[j][i] === '1';
    const r = traceRings(w, h, inside);
    for (const ring of rings(r.d)) {
      // Back to the start (z closes a straight run).
      const [s, e] = [ring[0], ring[ring.length - 1]];
      expect(s[0] === e[0] || s[1] === e[1]).toBe(true);
    }
    const want = new Set<string>();
    rows.forEach((row, j) => [...row].forEach((c, i) => c === '1' && want.add(`${i},${j}`)));
    expect(cellsInside(r.d, w, h)).toEqual(want);
  });

  it('draws nothing for nothing', () => {
    expect(traceRings(4, 4, () => false)).toEqual({ d: '', rings: 0, corners: 0 });
  });
});

describe('despeckle', () => {
  const W = 5;
  const H = 3;
  // Classes: 0 sea, 4 wood, −1 unseen.
  const cls = Int8Array.from([4, 4, 4, 4, -1, 4, 0, 4, 4, -1, 4, 4, 4, 0, 0]);
  const high = Uint8Array.from([0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 1]);

  it('absorbs a patch smaller than the size into the ground round it, and lowers flecks of high ground', () => {
    const s = despeckle(W, H, cls, high, 2);
    expect([...s.cls]).toEqual([4, 4, 4, 4, -1, 4, 4, 4, 4, -1, 4, 4, 4, 0, 0]);
    expect([...s.high]).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1]);
  });

  it('never fills unseen ground, and leaves the inputs as they were', () => {
    const s = despeckle(W, H, cls, high, 8);
    expect(s.cls[4]).toBe(-1);
    expect(s.cls[9]).toBe(-1);
    expect(cls[6]).toBe(0);
  });
});

describe('traceGrid', () => {
  it('gives null for a grid with nothing seen', () => {
    expect(traceGrid(grid(['....', '....']), 'v')).toBeNull();
  });

  it('gives null for a grid that does not match its size', () => {
    expect(traceGrid({ ...grid(['11', '11']), w: 3 }, 'v')).toBeNull();
  });

  it('sorts cells into classes and outlines the seen land', () => {
    const t = traceGrid(grid(['1122', '1133', '..33']), 'v1')!;
    expect(t.map).toMatchObject({ version: 'v1', w: 4, h: 3, metresPerUnit: 2 });
    expect(t.map.layers.map((l) => l.cls)).toEqual(['fresh', 'open', 'wood']);
    expect(cellsInside(t.map.seen, 4, 3).size).toBe(10);
    expect(cellsInside(t.map.layers.find((l) => l.cls === 'wood')!.d, 4, 3)).toEqual(new Set(['2,1', '3,1', '2,2', '3,2']));
    // Height 70 bytes is high ground; the forest cells carry it.
    expect(cellsInside(t.map.relief!, 4, 3)).toEqual(new Set(['2,1', '3,1', '2,2', '3,2']));
  });

  it('merges cells and traces again past the corner cap', () => {
    // A checkerboard is all corners: 4 per cell per class at one cell a unit.
    const n = 64;
    const rows = Array.from({ length: n }, (_, j) => Array.from({ length: n }, (_, i) => ((i + j) % 2 ? '1' : '3')).join(''));
    const t = traceGrid(grid(rows), 'cb')!;
    expect(t.corners).toBeLessThanOrEqual(MAX_CORNERS);
    expect(t.map.w).toBeLessThan(n);
    expect(t.frame.per).toBeGreaterThan(1);
    expect(t.map.metresPerUnit).toBe(2 * t.frame.per);
  });

  it('draws Wildmind’s widest grid cell for cell', () => {
    // Wildmind sends at most 192 cells across (GRID_MAX); none of them is merged.
    expect(MAX_ACROSS).toBeGreaterThanOrEqual(192);
    const rows = Array.from({ length: 8 }, (_, j) => Array.from({ length: 192 }, (_, i) => (Math.floor(i / 12) + j) % 3 === 0 ? '3' : '1').join(''));
    const t = traceGrid({ ...grid(rows), step: 2 }, 'w192')!;
    expect(t.map.w).toBe(192);
    expect(t.frame.per).toBe(2);
    expect(t.map.metresPerUnit).toBe(4);
  });

  it('simplifies before it shrinks: specks go, the resolution stays', () => {
    // Stripes of forest flecked with single cells of grass: over the cap
    // until the flecks are absorbed, then well under it at full size.
    const n = 120;
    const rows = Array.from({ length: n }, (_, j) =>
      Array.from({ length: n }, (_, i) => (Math.floor(j / 6) % 2 ? (i % 3 === 1 && j % 3 === 1 ? '1' : '3') : '1')).join(''),
    );
    const t = traceGrid(grid(rows), 'specks')!;
    expect(t.frame.per).toBe(1);
    expect(t.map.w).toBe(n);
    expect(t.corners).toBeLessThanOrEqual(MAX_CORNERS);
  });

  it('keeps a wide frame under the most cells across', () => {
    const rows = Array.from({ length: 4 }, () => '1'.repeat(200));
    const t = traceGrid(grid(rows), 'wide')!;
    expect(t.map.w).toBeLessThanOrEqual(MAX_ACROSS);
  });

  it('traces the real day-16 valley small', () => {
    const snap = parseSnapshot(recorded)!;
    const t = traceGrid(snap.terrain!, snap.terrainVersion)!;
    expect(t.map.w).toBe(141);
    expect(t.map.h).toBe(93);
    expect(t.map.layers.length).toBeLessThanOrEqual(7);
    expect(t.corners).toBeLessThanOrEqual(MAX_CORNERS);
    const size = t.map.seen.length + t.map.layers.reduce((s, l) => s + l.d.length, 0) + (t.map.relief?.length ?? 0);
    expect(size).toBeLessThan(12_000);
    expect(t.map.labels[0]).toMatchObject({ name: 'Mirror Mere', landmark: true });
  });

  it('remembers the last two versions', () => {
    const a = grid(['11']);
    const first = traceCached(a, 'a');
    expect(traceCached(a, 'a')).toBe(first);
    traceCached(a, 'b');
    traceCached(a, 'c');
    expect(traceCached(a, 'a')).not.toBe(first);
  });
});
