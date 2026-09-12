// The board is a PARTITION of the ground, and the only way to be sure of that
// is to draw it.
//
// homeserv holds no Mapbox credential, so the landgrab map cannot be rendered
// by automation on a dev box — `data-lg-sources` stays "0" for the whole QA
// run and the preview script says so. That leaves the honeycomb itself
// unwitnessed by anything but the unit tests below it, which is how a lattice
// with a hairline seam in it ships.
//
// So this draws the same rings `TerritoryMap` hands Mapbox, into an SVG, and
// asserts the properties a reader would otherwise have to notice by eye: no
// hex belongs to two people, a solid block has no hole in it, and every held
// hex is one the unclaimed mesh would also have drawn — which is what "the
// claims sit ON the board" means.
//
//   LANDGRAB_BOARD_SVG=/tmp/board.svg npx vitest run src/lib/geo/board-render
//
// writes the picture out as well. It is a side effect of a real test, not a
// test of its own: without the variable nothing is written.

import { describe, expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { hexCentreWorld, hexKey, hexRings, hexesInBounds, type Hex } from './hex';
import { resolveHexBoard } from './hex-board';
import { tileAt, tileCentre, type Tile } from './tiles';
import type { TileOwnership } from './ownership';

const HOME = tileAt(54.5253, -1.5535);
const COLOURS: Record<string, string> = { john: '#c4570a', katie: '#2f6f8f', rory: '#6b7f3a' };

/** A few cells wide, following a turning path — a walk, not a blob. */
function walk(sx: number, sy: number, legs: Array<[number, number]>): Tile[] {
  const out: Tile[] = [];
  let x = sx;
  let y = sy;
  for (const [dx, dy] of legs) {
    for (let i = 0; i < 6; i++) {
      x += dx;
      y += dy;
      out.push({ x, y });
    }
  }
  return out;
}

function block(x0: number, y0: number, w: number, h: number): Tile[] {
  const out: Tile[] = [];
  for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) out.push({ x: x0 + x, y: y0 + y });
  return out;
}

const own = (owner: string, tiles: Tile[], score: number): TileOwnership[] =>
  tiles.map((t) => ({
    tileX: t.x,
    tileY: t.y,
    owner,
    score,
    runnerUp: null,
    runnerUpScore: 0,
    lastEventAt: new Date('2026-09-10T00:00:00Z'),
    ownerSince: new Date('2026-09-01T00:00:00Z'),
  }));

/** John's ground with Rory's block walk punched through it, Katie's estate
 *  below, and two walks leaving the frame — the shapes the real ledger makes. */
const OWNED: TileOwnership[] = [
  ...own('john', block(HOME.x, HOME.y, 14, 11), 4),
  ...own('john', walk(HOME.x + 14, HOME.y + 4, [[1, 0], [1, 1], [0, 1], [1, 0], [1, -1]]), 3),
  ...own('katie', block(HOME.x + 16, HOME.y + 12, 9, 8), 5),
  ...own('katie', walk(HOME.x + 4, HOME.y + 13, [[1, 0], [0, 1], [1, 0], [1, 0]]), 2),
  // Higher score on ground inside John's block: the hole has to punch through.
  ...own('rory', block(HOME.x + 6, HOME.y + 2, 4, 4), 9),
  ...own('rory', walk(HOME.x + 26, HOME.y + 2, [[0, 1], [1, 1], [1, 0], [0, 1]]), 3),
];

const nw = tileCentre(HOME.x - 4, HOME.y - 4);
// Wide enough to hold every walk in OWNED: a fixture that leaves the frame
// would fail the "every held hex is on the mesh" test for the wrong reason.
const se = tileCentre(HOME.x + 44, HOME.y + 30);
const VIEW = { north: nw.lat, west: nw.lon, south: se.lat, east: se.lon };

describe('the drawn board', () => {
  const board = resolveHexBoard(OWNED);
  const mesh = hexesInBounds(VIEW, 20_000);

  it('gives nobody a hex somebody else already has', () => {
    const seen = new Set<string>();
    for (const hexes of board.values()) {
      for (const h of hexes) {
        expect(seen.has(hexKey(h.q, h.r))).toBe(false);
        seen.add(hexKey(h.q, h.r));
      }
    }
  });

  it('lays every held hex exactly on the unclaimed mesh', () => {
    // The claims are drawn OVER the board, never instead of it: a held hex the
    // mesh does not contain would be a second lattice half a hex out of step.
    const open = new Set(mesh!.map((h) => hexKey(h.q, h.r)));
    for (const hexes of board.values()) {
      for (const h of hexes) expect(open.has(hexKey(h.q, h.r))).toBe(true);
    }
  });

  it('punches the block walk through, rather than colouring over it', () => {
    const rory = new Set((board.get('rory') ?? []).map((h) => hexKey(h.q, h.r)));
    const john = new Set((board.get('john') ?? []).map((h) => hexKey(h.q, h.r)));
    expect(rory.size).toBeGreaterThan(10);
    for (const key of rory) expect(john.has(key)).toBe(false);
    // And John still holds the ring around the hole.
    expect(john.size).toBeGreaterThan(rory.size * 3);
  });

  it('leaves no hole inside a solid block', () => {
    // On its own, so the assertion is about the block and not about where a
    // walk happened to wander off to. Every mesh hex whose centre is strictly
    // inside the block's ground must be coloured — that is the speckle the
    // one-directional mapping would leave, and the reason `hexesForTile`
    // unions both directions.
    const solid = resolveHexBoard(own('john', block(HOME.x, HOME.y, 12, 12), 4)).get('john')!;
    const mine = new Set(solid.map((h) => hexKey(h.q, h.r)));
    const nw2 = tileCentre(HOME.x, HOME.y);
    const se2 = tileCentre(HOME.x + 11, HOME.y + 11);
    const inner = hexesInBounds(
      { north: nw2.lat, west: nw2.lon, south: se2.lat, east: se2.lon },
      20_000,
    )!;
    const hexCentresInside = inner.filter((h) => {
      const c = hexCentreWorld(h.q, h.r);
      return c[0] > HOME.x + 1 && c[0] < HOME.x + 11 && c[1] > HOME.y + 1 && c[1] < HOME.y + 11;
    });
    expect(hexCentresInside.length).toBeGreaterThan(60);
    for (const h of hexCentresInside) expect(mine.has(hexKey(h.q, h.r))).toBe(true);
  });

  it('draws, when asked to', () => {
    const target = process.env.LANDGRAB_BOARD_SVG;
    const svg = render(board, mesh!);
    expect(svg.startsWith('<svg')).toBe(true);
    if (target) writeFileSync(target, svg);
  });
});

function render(board: Map<string, Hex[]>, mesh: Hex[]): string {
  const width = 1100;
  const mercY = (lat: number) => {
    const r = (lat * Math.PI) / 180;
    return -Math.log(Math.tan(r) + 1 / Math.cos(r)) * (180 / Math.PI);
  };
  const scale = width / (VIEW.east - VIEW.west);
  const height = Math.round((mercY(VIEW.south) - mercY(VIEW.north)) * scale);
  const path = (ring: Array<[number, number]>) =>
    ring
      .map(
        ([lat, lon], i) =>
          `${i ? 'L' : 'M'}${((lon - VIEW.west) * scale).toFixed(1)} ${((mercY(lat) - mercY(VIEW.north)) * scale).toFixed(1)}`,
      )
      .join('') + 'Z';

  const parts = [`<rect width="${width}" height="${height}" fill="#faf7f1"/>`];
  parts.push('<g fill="none" stroke="#c9c2b6" stroke-width="0.7">');
  for (const ring of hexRings(mesh)) parts.push(`<path d="${path(ring)}"/>`);
  parts.push('</g>');
  for (const [subject, hexes] of board) {
    const c = COLOURS[subject] ?? '#8a8580';
    parts.push(`<g fill="${c}" fill-opacity="0.3" stroke="${c}" stroke-width="1.1">`);
    for (const ring of hexRings(hexes)) parts.push(`<path d="${path(ring)}"/>`);
    parts.push('</g>');
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${parts.join('')}</svg>`;
}
