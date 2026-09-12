import { describe, expect, it } from 'vitest';
import { chooseFocus, FOCUS } from './focus';
import { tileAt, tileCentre, type Tile } from './tiles';

const home = { name: 'Darlington', south: 54.497, north: 54.556, west: -1.607, east: -1.49, centre: [54.5253, -1.5535] as [number, number] };
/** n cells in a compact block around a point. */
function block(lat: number, lon: number, n: number): Tile[] {
  const c = tileAt(lat, lon);
  const side = Math.ceil(Math.sqrt(n));
  const out: Tile[] = [];
  for (let i = 0; i < n; i++) out.push({ x: c.x + (i % side), y: c.y + Math.floor(i / side) });
  return out;
}
const inside = (b: [[number, number], [number, number]], lat: number, lon: number) =>
  lat >= b[0][0] && lat <= b[1][0] && lon >= b[0][1] && lon <= b[1][1];
/** Cells per bin edge — 32 at binShift 5. */
const BIN = 1 << FOCUS.binShift;
/** A w x h rectangle of cells with its north-west corner at (x0, y0). */
function rect(x0: number, y0: number, w: number, h: number): Tile[] {
  const out: Tile[] = [];
  for (let dx = 0; dx < w; dx++) for (let dy = 0; dy < h; dy++) out.push({ x: x0 + dx, y: y0 + dy });
  return out;
}
const at = (t: Tile) => tileCentre(t.x, t.y);

describe('chooseFocus', () => {
  it('is quiet on the home box when nothing moved', () => {
    const f = chooseFocus({ changed: [], active: [], home });
    expect(f.reason).toBe('quiet');
    expect(f.bounds).toEqual([[home.south, home.west], [home.north, home.east]]);
    expect(f.changedCells).toBe(0);
  });
  it('focuses home when the change is in Darlington', () => {
    const f = chooseFocus({ changed: block(54.53, -1.55, 40), active: block(54.53, -1.55, 40), home });
    expect(f.reason).toBe('home');
    expect(inside(f.bounds, 54.53, -1.55)).toBe(true);
    expect(f.changedCells).toBe(40);
    expect(f.label).toMatch(/^Darlington · 40 cells changed hands/);
  });
  it('stays home when an away cluster is not twice as heavy', () => {
    const f = chooseFocus({ changed: [...block(54.53, -1.55, 40), ...block(54.9, -1.4, 60)], active: [], home });
    expect(f.reason).toBe('home');
  });
  it('goes away when an away cluster is at least twice as heavy and a quarter of the total', () => {
    const f = chooseFocus({ changed: [...block(54.53, -1.55, 20), ...block(54.9, -1.4, 60)], active: [], home });
    expect(f.reason).toBe('away');
    expect(inside(f.bounds, 54.9, -1.4)).toBe(true);
    expect(inside(f.bounds, 54.53, -1.55)).toBe(false);
    expect(f.label).toMatch(/away from Darlington/);
  });
  it('never zooms tighter than the minimum span', () => {
    const f = chooseFocus({ changed: block(54.53, -1.55, 2), active: [], home });
    const latSpanM = (f.bounds[1][0] - f.bounds[0][0]) * 111_195;
    expect(latSpanM).toBeGreaterThanOrEqual(FOCUS.minSpanM - 1);
  });
  it('falls back to the home box, counting only what moved inside it, when nothing dominates', () => {
    // Five equal away clusters: none touches home, and the heaviest is 20% of
    // the total, under awayShare. No cluster is chosen — but 100 cells moved.
    const changed = [54.9, 55.0, 55.1, 55.2, 55.3].flatMap((lat) => block(lat, -1.4, 20));
    const f = chooseFocus({ changed, active: [], home });
    expect(f.reason).toBe('home');
    expect(f.bounds).toEqual([[home.south, home.west], [home.north, home.east]]);
    // None of the 100 sit in the home box, and changedCells counts what is
    // inside the bounds returned — the window total is handovers.cells.
    expect(f.changedCells).toBe(0);
  });
  it('keeps a block straddling a bin edge as one cluster', () => {
    // 64 columns starting 16 into a bin: three bins (16 / 32 / 16 columns), each
    // far above the floor, joined only by the 8-connected flood fill. The block
    // is ~2.8 km wide, so the fit is driven by the cells and not by minSpanM —
    // drop the flood fill and only the middle bin survives, which cannot reach
    // either end.
    const c = tileAt(54.53, -1.55);
    const x0 = c.x - (c.x % BIN) + BIN - 16;
    const y0 = c.y - (c.y % BIN) + 4;
    const cells = rect(x0, y0, 64, 4);
    const f = chooseFocus({ changed: cells, active: [], home });
    const west = at({ x: x0, y: y0 });
    const east = at({ x: x0 + 63, y: y0 });
    expect(inside(f.bounds, west.lat, west.lon)).toBe(true);
    expect(inside(f.bounds, east.lat, east.lon)).toBe(true);
    expect(f.changedCells).toBe(cells.length);
  });
  it('leaves a sub-floor satellite bin out of the fit', () => {
    // 208 cells in one bin (624) against 10 in the bin next door (30, 4.8%),
    // under clusterFloor. The satellite is 8-connected, so the floor is the
    // only thing keeping it out; admit it and the fit stretches over it.
    const c = tileAt(54.53, -1.55);
    const x0 = c.x - (c.x % BIN);
    const y0 = c.y - (c.y % BIN);
    const heavy = rect(x0, y0, 16, 13);
    const satellite = rect(x0 + BIN + 16, y0, 10, 1);
    const f = chooseFocus({ changed: [...heavy, ...satellite], active: [], home });
    const s0 = at(satellite[0]);
    expect(inside(f.bounds, s0.lat, s0.lon)).toBe(false);
    expect(f.changedCells).toBe(heavy.length);
  });
  it('counts active cells at the lower weight', () => {
    // 30 active cells away (weight 30) vs 20 changed at home (weight 60): home.
    const f = chooseFocus({ changed: block(54.53, -1.55, 20), active: block(54.9, -1.4, 30), home });
    expect(f.reason).toBe('home');
  });
});
