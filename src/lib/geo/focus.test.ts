import { describe, expect, it } from 'vitest';
import { chooseFocus, FOCUS } from './focus';
import { tileAt, type Tile } from './tiles';

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
  it('falls back to the home box, still counting the change, when nothing dominates', () => {
    // Five equal away clusters: none touches home, and the heaviest is 20% of
    // the total, under awayShare. No cluster is chosen — but 100 cells moved.
    const changed = [54.9, 55.0, 55.1, 55.2, 55.3].flatMap((lat) => block(lat, -1.4, 20));
    const f = chooseFocus({ changed, active: [], home });
    expect(f.reason).toBe('home');
    expect(f.bounds).toEqual([[home.south, home.west], [home.north, home.east]]);
    expect(f.changedCells).toBe(100);
  });
  it('counts active cells at the lower weight', () => {
    // 30 active cells away (weight 30) vs 20 changed at home (weight 60): home.
    const f = chooseFocus({ changed: block(54.53, -1.55, 20), active: block(54.9, -1.4, 30), home });
    expect(f.reason).toBe('home');
  });
});
