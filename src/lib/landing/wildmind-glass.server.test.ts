import { describe, expect, it } from 'vitest';
import { gzipSync } from 'node:zlib';
import recorded from './fixtures/wildmind-day16.json';
import youngRecorded from './fixtures/wildmind-between-lives.json';
import { parseSnapshot, project, type WildmindTerrain } from './wildmind';
import { BOARD, TILT, decodeBands, encodeBands, glassAt, type WildmindGlass } from './wildmind-glass';
import {
  BASE_LIFT,
  MAX_CARDS,
  MAX_CELL,
  MAX_GLASS_ACROSS,
  MAX_LIFT,
  MAX_POINTS,
  MAX_TREES,
  buildGlass,
  glassCached,
  glassGrid,
  march,
  ringArea,
  simplifyRing,
  smoothPath,
  thresholds,
} from './wildmind-glass.server';
import { traceGrid } from './wildmind-trace.server';

const NOW = Date.parse('2026-10-10T13:30:00Z');
const snap = parseSnapshot(recorded)!;
const young = parseSnapshot(youngRecorded)!;

/** A terrain from a height function (metres) and a seen test, every seen cell grass unless `cls` says otherwise. */
function terrain(w: number, h: number, height: (i: number, j: number) => number, seen = (_i: number, _j: number) => true, cls = (_i: number, _j: number) => 'grass'): WildmindTerrain {
  const names = ['grass', 'forest', 'marsh', 'shallow_fresh'];
  const t = Buffer.alloc(w * h);
  const hb = Buffer.alloc(w * h);
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      if (!seen(i, j)) continue;
      t[j * w + i] = names.indexOf(cls(i, j)) + 1;
      hb[j * w + i] = Math.max(1, Math.min(255, Math.round((height(i, j) + 2) * 10)));
    }
  return { origin: [0, 0], step: 1, w, h, terrains: names, t: t.toString('base64'), height: hb.toString('base64'), regions: [] };
}

/** Every number in a path, so a test can see where it reaches (absolute commands only for the first point of each ring). */
function pathOk(d: string) {
  expect(d).toMatch(/^[MmQqZzHh0-9.\- ]*$/);
  expect(d).not.toMatch(/NaN|Infinity|undefined/);
}

/** Every point a smoothed path passes through, in absolute units (M, then relative q pairs). */
function pathPoints(d: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const ring of d.split('z').filter(Boolean)) {
    const m = ring.match(/^M(-?[\d.]+)[ ]?(-?[\d.]+)q(.*)$/);
    if (!m) continue;
    let x = Number(m[1]);
    let y = Number(m[2]);
    out.push([x, y]);
    const ns = (m[3].match(/-?(?:\d+\.?\d*|\.\d+)/g) ?? []).map(Number);
    for (let k = 0; k + 3 < ns.length; k += 4) {
      x += ns[k + 2];
      y += ns[k + 3];
      out.push([x, y]);
    }
  }
  return out;
}

describe('the model’s grid', () => {
  it('reads the snapshot’s heights and kinds, water always under sea level and land on it', () => {
    const g = glassGrid(snap.terrain!)!;
    expect(g.block).toBe(1);
    expect([g.w, g.h]).toEqual([141, 93]);
    let seen = 0;
    for (let k = 0; k < g.seen.length; k++) {
      if (!g.seen[k]) continue;
      seen++;
      expect(g.height[k]).toBeGreaterThan(-2.01);
      expect(g.height[k]).toBeLessThan(23.6);
    }
    expect(seen).toBe(6067);
    expect(g.wood.reduce((n, v) => n + v, 0)).toBe(2187);
  });

  it('averages a valley wider than the cap in blocks, keeping it under MAX_GLASS_ACROSS', () => {
    const big = glassGrid(terrain(256, 200, (i, j) => (i + j) / 100))!;
    expect(big.block).toBe(2);
    expect(big.w).toBeLessThanOrEqual(MAX_GLASS_ACROSS);
    expect(big.h).toBe(100);
  });

  it('is null with nothing seen or a grid of the wrong size', () => {
    expect(glassGrid(terrain(10, 10, () => 1, () => false))).toBeNull();
    expect(glassGrid({ ...terrain(10, 10, () => 1), w: 11 })).toBeNull();
    expect(buildGlass(terrain(10, 10, () => 1, () => false), 'v')).toBeNull();
  });
});

describe('the cards', () => {
  it('runs from the water card and sea level up a step at a time, never more than MAX_CARDS', () => {
    const g = glassGrid(snap.terrain!)!;
    expect(thresholds(g)).toEqual([-2, 0, 1.5, 2.5, 3.5, 4.5, 5.5]);
    const flat = glassGrid(terrain(8, 8, () => 0.4))!;
    expect(thresholds(flat)).toEqual([-2, 0]);
    const alps = glassGrid(terrain(20, 20, (i) => i * 1.2))!;
    const t = thresholds(alps);
    expect(t.length).toBeLessThanOrEqual(MAX_CARDS);
    expect(t[t.length - 1]).toBeLessThanOrEqual(19 * 1.2);
    for (let k = 1; k < t.length; k++) expect(t[k]).toBeGreaterThan(t[k - 1]);
  });

  it('stands each card higher than the one below, and none past MAX_LIFT', () => {
    for (const s of [snap, young]) {
      const { glass } = buildGlass(s.terrain!, s.terrainVersion)!;
      expect(glass.cards[0].lift).toBe(BASE_LIFT);
      for (let k = 1; k < glass.cards.length; k++) expect(glass.cards[k].lift).toBeGreaterThan(glass.cards[k - 1].lift);
      expect(glass.cards.at(-1)!.lift).toBeLessThanOrEqual(MAX_LIFT);
    }
    const alps = buildGlass(terrain(30, 30, (i, j) => (i + j) * 0.5), 'alps')!.glass;
    expect(alps.cards.at(-1)!.lift).toBeLessThanOrEqual(MAX_LIFT);
  });
});

describe('marching squares', () => {
  it('rings a single cell, a block and a block with a hole, inside on the right', () => {
    const one = march(3, 3, (i, j) => (i === 1 && j === 1 ? 1 : -1));
    expect(one).toHaveLength(1);
    // Clockwise in y-down space: a positive area.
    expect(ringArea(one[0])).toBeGreaterThan(0);
    const holed = march(5, 5, (i, j) => (i === 2 && j === 2 ? -1 : 1));
    expect(holed).toHaveLength(2);
    const areas = holed.map(ringArea).sort((a, b) => a - b);
    expect(areas[0]).toBeLessThan(0);
    expect(areas[1]).toBeGreaterThan(0);
  });

  it('splits a saddle by the cell’s mean', () => {
    const joined = march(2, 2, (i, j) => (i === j ? 3 : -1));
    const apart = march(2, 2, (i, j) => (i === j ? 1 : -3));
    expect(joined).toHaveLength(1);
    expect(apart).toHaveLength(2);
  });

  it('simplifies without losing a ring’s shape, and smooths it into a path', () => {
    const circle = Array.from({ length: 64 }, (_, k): [number, number] => [10 + 8 * Math.cos((k / 64) * Math.PI * 2), 10 + 8 * Math.sin((k / 64) * Math.PI * 2)]);
    const s = simplifyRing(circle, 0.3);
    expect(s.length).toBeLessThan(32);
    expect(Math.abs(ringArea(s) - ringArea(circle))).toBeLessThan(ringArea(circle) * 0.05);
    const d = smoothPath([s], ([x, y]) => [x, y]);
    pathOk(d);
    for (const [x, y] of pathPoints(d)) expect(Math.hypot(x - 10, y - 10)).toBeGreaterThan(6.5);
  });
});

describe('buildGlass on the day-sixteen valley', () => {
  const built = buildGlass(snap.terrain!, snap.terrainVersion)!;
  const g = built.glass;

  it('stays inside its caps and the board, every path well formed', () => {
    expect(built.points).toBeLessThanOrEqual(MAX_POINTS);
    expect(built.trees).toBeLessThanOrEqual(MAX_TREES);
    expect(built.trees).toBeGreaterThan(200);
    for (const c of g.cards) {
      pathOk(c.d);
      for (const [x, y] of pathPoints(c.d)) {
        expect(x).toBeGreaterThanOrEqual(-1);
        expect(x).toBeLessThanOrEqual(BOARD.w + 1);
        expect(y).toBeGreaterThanOrEqual(-1);
        expect(y).toBeLessThanOrEqual(BOARD.d + 1);
      }
      for (const d of [...(c.wood ?? []), c.wet ?? '']) pathOk(d);
    }
    expect(g.cards[0].d.length).toBeGreaterThan(100);
    expect(g.cards.some((c) => c.wood)).toBe(true);
    expect(g.cards.some((c) => c.wet)).toBe(true);
    // The water card carries no trees.
    expect(g.cards[0].wood).toBeUndefined();
  });

  it('fits the seen ground to the board, centred, foreshortened by TILT', () => {
    expect(g.sv / g.su).toBeCloseTo(TILT, 2);
    expect(g.su).toBeLessThanOrEqual(MAX_CELL);
    const xs = g.cards.flatMap((c) => pathPoints(c.d).map(([x]) => x));
    const left = Math.min(...xs);
    const right = Math.max(...xs);
    expect(Math.abs(left - (BOARD.w - right))).toBeLessThan(6);
    expect(right - left).toBeGreaterThan(BOARD.w * 0.85);
  });

  it('codes every cell’s card, and stands the people on land', () => {
    const bands = decodeBands(g);
    expect(bands.length).toBe(g.gw * g.gh);
    expect(Math.max(...bands)).toBeLessThan(g.cards.length);
    const traced = traceGrid(snap.terrain!, snap.terrainVersion)!;
    const w = project(snap, NOW, NOW, traced);
    for (const p of w.people) {
      const at = glassAt(g, bands, p.x, p.y);
      expect(at.lift).toBeGreaterThan(g.cards[0].lift);
      expect(at.x).toBeGreaterThan(0);
      expect(at.x).toBeLessThan(BOARD.w);
      expect(at.y + at.lift).toBeGreaterThan(0);
      expect(at.y + at.lift).toBeLessThan(BOARD.d);
    }
  });

  it('is small enough to send once per version', () => {
    expect(gzipSync(JSON.stringify(g)).length).toBeLessThan(10 * 1024);
  });

  it('is built once per version', () => {
    expect(glassCached(snap.terrain!, snap.terrainVersion)).toBe(glassCached(snap.terrain!, snap.terrainVersion));
  });
});

describe('buildGlass, other valleys', () => {
  it('sets a young valley small on a bare board', () => {
    const { glass } = buildGlass(young.terrain!, young.terrainVersion)!;
    expect(glass.su).toBeLessThanOrEqual(MAX_CELL);
    const xs = glass.cards.flatMap((c) => pathPoints(c.d).map(([x]) => x));
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(BOARD.w * 0.8);
  });

  it('caps a speckled valley’s outlines by simplifying harder', () => {
    // A field of single-cell bumps: thousands of rings before simplification.
    const noise = terrain(150, 120, (i, j) => ((i * 7 + j * 13) % 5 === 0 ? 4 : 0.5 + ((i * j) % 7) * 0.4));
    const built = buildGlass(noise, 'noise')!;
    expect(built.points).toBeLessThanOrEqual(MAX_POINTS);
    for (const c of built.glass.cards) pathOk(c.d);
  });

  it('caps the trees in a valley that is all forest', () => {
    const wood = buildGlass(terrain(140, 90, () => 1, undefined, () => 'forest'), 'wood')!;
    expect(wood.trees).toBeLessThanOrEqual(MAX_TREES);
  });

  it('maps a coarser map’s units onto the model’s cells', () => {
    const t = terrain(40, 40, (i) => i / 10);
    const fine = buildGlass(t, 'a', 1)!.glass;
    const coarse = buildGlass(t, 'b', 2)!.glass;
    expect(coarse.per).toBe(2 * fine.per);
    expect(coarse.su).toBeCloseTo(2 * fine.su, 2);
    // The same ground, named in either unit, stands at the same place.
    expect(glassAt(coarse, decodeBands(coarse), 10, 10)).toEqual(glassAt(fine, decodeBands(fine), 20, 20));
  });
});

describe('the band code', () => {
  it('round-trips, and survives a short or bad code', () => {
    const grid = Uint8Array.from([0, 0, 0, 1, 2, 2, 5, 5, 5, 5, 0]);
    const code = encodeBands(grid);
    expect(code).toBe('a3bc2f4a');
    expect(decodeBands({ bands: code, gw: 11, gh: 1 })).toEqual(grid);
    expect(decodeBands({ bands: 'c2', gw: 2, gh: 2 })).toEqual(Uint8Array.from([2, 2, 0, 0]));
    expect(decodeBands({ bands: '!!', gw: 2, gh: 1 })).toEqual(Uint8Array.from([0, 0]));
  });

  it('stands a point off the grid on its nearest edge cell', () => {
    const g: WildmindGlass = { version: 'v', ox: 0, oy: 0, su: 1, sv: 0.32, cards: [{ lift: 2, d: '' }, { lift: 5, d: '' }], tree: [1, 1], bands: 'b4', gw: 2, gh: 2, per: 1 };
    expect(glassAt(g, decodeBands(g), -5, 99)).toEqual({ x: -5, y: 99 * 0.32 - 5, lift: 5 });
  });
});
