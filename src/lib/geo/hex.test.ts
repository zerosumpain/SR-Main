import { describe, expect, it } from 'vitest';
import {
  HEX_HEIGHT_TILES,
  HEX_R,
  HEX_WIDTH_TILES,
  hexAt,
  hexCentre,
  hexCentreWorld,
  hexesForTile,
  hexesInBounds,
  hexKey,
  hexOfWorld,
  hexRings,
  hexWidthPx,
  packHexes,
  parseHexKey,
  unpackHexes,
  type Hex,
} from './hex';
import { tileAt, tileCentre } from './tiles';

/** Darlington, the ground this board is actually drawn over. */
const HOME = { lat: 54.5253, lon: -1.5535 };

describe('the lattice', () => {
  it('covers exactly one cell of ground per hex', () => {
    // (3*sqrt(3)/2) * R^2 = 1 tile unit squared, which is one z19 cell.
    expect((3 * Math.sqrt(3) * HEX_R * HEX_R) / 2).toBeCloseTo(1, 12);
  });

  it('is 1.075 cells across the flats and 1.241 vertex to vertex', () => {
    expect(HEX_WIDTH_TILES).toBeCloseTo(1.07457, 5);
    expect(HEX_HEIGHT_TILES).toBeCloseTo(1.24081, 5);
  });

  it('sizes a hex on screen from the slippy zoom', () => {
    // 256 px per z19 tile at zoom 19, halving with every zoom level below it.
    expect(hexWidthPx(19)).toBeCloseTo(256 * 1.07457, 2);
    expect(hexWidthPx(15)).toBeCloseTo(16 * 1.07457, 3);
    expect(hexWidthPx(14)).toBeCloseTo(hexWidthPx(15) / 2, 6);
  });

  it('round-trips a hex through its own centre', () => {
    for (let q = -3; q <= 3; q++) {
      for (let r = -3; r <= 3; r++) {
        const [wx, wy] = hexCentreWorld(q, r);
        expect(hexOfWorld(wx, wy)).toEqual({ q, r });
      }
    }
  });

  it('round-trips a hex near Darlington through latitude and longitude', () => {
    const h = hexAt(HOME.lat, HOME.lon);
    const c = hexCentre(h.q, h.r);
    expect(hexAt(c.lat, c.lon)).toEqual(h);
  });

  it('assigns every point to exactly one hex', () => {
    // A dense scatter over several hexes' worth of ground: whichever hex claims
    // a point, that point must be nearer its centre than any other hex's.
    const [ox, oy] = hexCentreWorld(0, 0);
    let checked = 0;
    for (let i = 0; i < 40; i++) {
      for (let j = 0; j < 40; j++) {
        const wx = ox + (i / 40) * 4 - 2;
        const wy = oy + (j / 40) * 4 - 2;
        const h = hexOfWorld(wx, wy);
        const [hx, hy] = hexCentreWorld(h.q, h.r);
        const mine = (hx - wx) ** 2 + (hy - wy) ** 2;
        for (let q = h.q - 2; q <= h.q + 2; q++) {
          for (let r = h.r - 2; r <= h.r + 2; r++) {
            const [ax, ay] = hexCentreWorld(q, r);
            expect(mine).toBeLessThanOrEqual((ax - wx) ** 2 + (ay - wy) ** 2 + 1e-9);
          }
        }
        checked++;
      }
    }
    expect(checked).toBe(1600);
  });

  it('makes a ring of six corners at the circumradius', () => {
    const [ring] = hexRings([{ q: 12, r: -7 }]);
    expect(ring).toHaveLength(6);
    // Shoelace over the ring in tile units would need the forward projection
    // back; the cheap invariant is that all six corners sit at R from centre.
    const [cx, cy] = hexCentreWorld(12, -7);
    const n = 2 ** 19;
    for (const [lat, lon] of ring) {
      const wx = ((lon + 180) / 360) * n;
      const latRad = (lat * Math.PI) / 180;
      const wy = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
      expect(Math.hypot(wx - cx, wy - cy)).toBeCloseTo(HEX_R, 6);
    }
  });

  it('memoises latitudes without changing them', () => {
    const hexes: Hex[] = [
      { q: 0, r: 5 },
      { q: 1, r: 5 },
      { q: 2, r: 5 },
    ];
    const [a, b, c] = hexRings(hexes);
    // Same row, so the four corner latitudes are shared exactly — this is the
    // property the cache relies on, not merely a consequence of it.
    expect(a.map((p) => p[0])).toEqual(b.map((p) => p[0]));
    expect(b.map((p) => p[0])).toEqual(c.map((p) => p[0]));
    expect(a.map((p) => p[1])).not.toEqual(b.map((p) => p[1]));
  });
});

describe('hexesForTile', () => {
  it('leaves no gap under a solid block of cells', () => {
    const origin = tileAt(HOME.lat, HOME.lon);
    const claimed = new Set<string>();
    for (let dx = 0; dx < 8; dx++) {
      for (let dy = 0; dy < 8; dy++) {
        for (const h of hexesForTile(origin.x + dx, origin.y + dy)) claimed.add(hexKey(h.q, h.r));
      }
    }
    // Every hex whose centre falls strictly inside the block must be claimed:
    // that is what "no speckle" means, and one direction of the mapping alone
    // fails it.
    let interior = 0;
    for (const key of claimed) {
      const { q, r } = parseHexKey(key);
      const [wx, wy] = hexCentreWorld(q, r);
      if (wx > origin.x + 1 && wx < origin.x + 7 && wy > origin.y + 1 && wy < origin.y + 7) interior++;
    }
    expect(interior).toBeGreaterThan(20);

    for (let wx = origin.x + 1.05; wx < origin.x + 7; wx += 0.31) {
      for (let wy = origin.y + 1.05; wy < origin.y + 7; wy += 0.31) {
        const h = hexOfWorld(wx, wy);
        expect(claimed.has(hexKey(h.q, h.r))).toBe(true);
      }
    }
  });

  it('always claims the hex holding the cell centre, and at most three', () => {
    const origin = tileAt(HOME.lat, HOME.lon);
    for (let dx = 0; dx < 20; dx++) {
      for (let dy = 0; dy < 20; dy++) {
        const x = origin.x + dx;
        const y = origin.y + dy;
        const hexes = hexesForTile(x, y);
        const c = hexOfWorld(x + 0.5, y + 0.5);
        expect(hexes[0]).toEqual(c);
        expect(hexes.length).toBeGreaterThanOrEqual(1);
        expect(hexes.length).toBeLessThanOrEqual(3);
        for (const h of hexes) expect(hexes.filter((o) => o.q === h.q && o.r === h.r)).toHaveLength(1);
      }
    }
  });

  it('averages one hex per cell, because a hex is one cell of area', () => {
    const origin = tileAt(HOME.lat, HOME.lon);
    const claimed = new Set<string>();
    const cells = 30 * 30;
    for (let dx = 0; dx < 30; dx++) {
      for (let dy = 0; dy < 30; dy++) {
        for (const h of hexesForTile(origin.x + dx, origin.y + dy)) claimed.add(hexKey(h.q, h.r));
      }
    }
    // Edge feathering inflates it a little; the ratio is near one, never double.
    expect(claimed.size / cells).toBeGreaterThan(0.95);
    expect(claimed.size / cells).toBeLessThan(1.25);
  });

  it('puts a cell centre inside the hex it is assigned to', () => {
    const origin = tileAt(HOME.lat, HOME.lon);
    const centre = tileCentre(origin.x, origin.y);
    expect(hexAt(centre.lat, centre.lon)).toEqual(hexesForTile(origin.x, origin.y)[0]);
  });
});

describe('hexesInBounds', () => {
  const view = { south: 54.52, west: -1.56, north: 54.53, east: -1.545 };

  it('covers every corner of the viewport', () => {
    const hexes = hexesInBounds(view, 100_000);
    expect(hexes).not.toBeNull();
    const keys = new Set(hexes!.map((h) => hexKey(h.q, h.r)));
    for (const [lat, lon] of [
      [view.south, view.west],
      [view.south, view.east],
      [view.north, view.west],
      [view.north, view.east],
      [(view.south + view.north) / 2, (view.west + view.east) / 2],
    ] as Array<[number, number]>) {
      const h = hexAt(lat, lon);
      expect(keys.has(hexKey(h.q, h.r))).toBe(true);
    }
  });

  it('returns each hex once', () => {
    const hexes = hexesInBounds(view, 100_000)!;
    expect(new Set(hexes.map((h) => hexKey(h.q, h.r))).size).toBe(hexes.length);
  });

  it('refuses a viewport it cannot afford rather than truncating one', () => {
    expect(hexesInBounds({ south: 50, west: -6, north: 58, east: 2 }, 6000)).toBeNull();
    // And it refuses BEFORE building the list, so a whole-country viewport is
    // cheap to say no to.
    expect(hexesInBounds(view, 4)).toBeNull();
  });

  it('grows with the viewport', () => {
    const small = hexesInBounds(view, 100_000)!.length;
    const big = hexesInBounds({ south: 54.5, west: -1.58, north: 54.55, east: -1.52 }, 100_000)!.length;
    expect(big).toBeGreaterThan(small * 4);
  });
});

describe('packing', () => {
  const sample: Hex[] = [
    { q: 153_680, r: 176_230 },
    { q: 153_681, r: 176_230 },
    { q: 153_682, r: 176_230 },
    { q: 153_679, r: 176_231 },
    { q: -4, r: -9 },
  ];

  it('round-trips, in row-major order', () => {
    const back = unpackHexes(packHexes(sample));
    expect(back).toEqual([...sample].sort((a, b) => a.r - b.r || a.q - b.q));
  });

  it('does not care what order it is given', () => {
    const shuffled = [sample[3], sample[0], sample[4], sample[2], sample[1]];
    expect(unpackHexes(packHexes(shuffled))).toEqual(unpackHexes(packHexes(sample)));
  });

  it('spends one small pair per neighbour after the first', () => {
    const run: Hex[] = Array.from({ length: 50 }, (_, i) => ({ q: 153_680 + i, r: 176_230 }));
    const packed = packHexes(run);
    expect(packed.slice(0, 2)).toEqual([153_680, 176_230]);
    expect(packed.slice(2)).toEqual(Array.from({ length: 49 }, () => [1, 0]).flat());
  });

  it('is empty for an empty board', () => {
    expect(packHexes([])).toEqual([]);
    expect(unpackHexes([])).toEqual([]);
  });

  it('drops a truncated trailing half-pair rather than reading a NaN hex', () => {
    expect(unpackHexes([5, 7, 1])).toEqual([{ q: 5, r: 7 }]);
  });
});
