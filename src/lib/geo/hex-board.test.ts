import { describe, expect, it } from 'vitest';
import { hexesForTiles, resolveHexBoard } from './hex-board';
import { hexKey, hexesForTile, hexOfWorld } from './hex';
import type { TileOwnership } from './ownership';
import { tileAt } from './tiles';

const HOME = tileAt(54.5253, -1.5535);

function held(
  owner: string,
  x: number,
  y: number,
  score = 1,
  at = '2026-09-01T00:00:00.000Z',
): TileOwnership {
  return {
    tileX: x,
    tileY: y,
    owner,
    score,
    runnerUp: null,
    runnerUpScore: 0,
    lastEventAt: new Date(at),
    ownerSince: new Date(at),
  };
}

describe('resolveHexBoard', () => {
  it('gives a lone cell its hexes', () => {
    const board = resolveHexBoard([held('john', HOME.x, HOME.y)]);
    expect([...board.keys()]).toEqual(['john']);
    expect(board.get('john')).toEqual(hexesForTile(HOME.x, HOME.y));
  });

  it('draws a solid block with no holes in it', () => {
    const owned: TileOwnership[] = [];
    for (let dx = 0; dx < 6; dx++) {
      for (let dy = 0; dy < 6; dy++) owned.push(held('john', HOME.x + dx, HOME.y + dy));
    }
    const mine = new Set(board(owned, 'john'));
    for (let wx = HOME.x + 1.05; wx < HOME.x + 5; wx += 0.27) {
      for (let wy = HOME.y + 1.05; wy < HOME.y + 5; wy += 0.27) {
        const h = hexOfWorld(wx, wy);
        expect(mine.has(hexKey(h.q, h.r))).toBe(true);
      }
    }
  });

  it('gives a contested hex to whoever has more of it, not to whoever came first', () => {
    // Hexes are 1.075 cells across, so SOME pairs of neighbouring cells share
    // one and some do not. Find a pair that does rather than assuming it.
    const pair = sharingPair();
    const owned = [held('john', pair.a.x, pair.a.y, 1), held('katie', pair.b.x, pair.b.y, 9)];
    const katie = new Set(board(owned, 'katie'));
    for (const key of pair.shared) expect(katie.has(key)).toBe(true);
    expect(new Set(board(owned, 'john')).size).toBeGreaterThan(0);
  });

  it('holds the board to about one hex per cell', () => {
    const owned: TileOwnership[] = [];
    for (let dx = 0; dx < 12; dx++) {
      for (let dy = 0; dy < 12; dy++) owned.push(held('john', HOME.x + dx, HOME.y + dy));
    }
    const drawn = resolveHexBoard(owned).get('john')!.length;
    // 148 against 144 on this ground: the edge feathering, and nothing more.
    expect(drawn / owned.length).toBeGreaterThan(0.98);
    expect(drawn / owned.length).toBeLessThan(1.1);
  });

  it('breaks a dead-level tie on the most recent event, then on the name', () => {
    const recent = [
      held('john', HOME.x, HOME.y, 5, '2026-09-01T00:00:00.000Z'),
      held('katie', HOME.x, HOME.y, 5, '2026-09-05T00:00:00.000Z'),
    ];
    // Both feed exactly the same hexes with exactly the same score.
    expect(board(recent, 'katie').length).toBeGreaterThan(0);
    expect(board(recent, 'john')).toHaveLength(0);

    const level = [
      held('katie', HOME.x, HOME.y, 5, '2026-09-01T00:00:00.000Z'),
      held('fintan', HOME.x, HOME.y, 5, '2026-09-01T00:00:00.000Z'),
    ];
    expect(board(level, 'fintan').length).toBeGreaterThan(0);
    expect(board(level, 'katie')).toHaveLength(0);
  });

  it('never hands the same hex to two people', () => {
    const owned: TileOwnership[] = [];
    for (let dx = 0; dx < 10; dx++) {
      for (let dy = 0; dy < 10; dy++) {
        owned.push(held(dx % 2 ? 'john' : 'katie', HOME.x + dx, HOME.y + dy, 1 + (dx % 3)));
      }
    }
    expectDisjoint(owned);
  });

  it('is empty for an empty ledger', () => {
    expect(resolveHexBoard([]).size).toBe(0);
  });
});

describe('hexesForTiles', () => {
  it('deduplicates the footprint of overlapping cells', () => {
    const tiles = [
      { x: HOME.x, y: HOME.y },
      { x: HOME.x + 1, y: HOME.y },
      { x: HOME.x, y: HOME.y },
    ];
    const out = hexesForTiles(tiles);
    expect(new Set(out.map((h) => hexKey(h.q, h.r))).size).toBe(out.length);
    const union = new Set([
      ...hexesForTile(HOME.x, HOME.y).map((h) => hexKey(h.q, h.r)),
      ...hexesForTile(HOME.x + 1, HOME.y).map((h) => hexKey(h.q, h.r)),
    ]);
    expect(new Set(out.map((h) => hexKey(h.q, h.r)))).toEqual(union);
  });

  it('is empty for no cells', () => {
    expect(hexesForTiles([])).toEqual([]);
  });
});

/** Two neighbouring cells that claim a hex in common, and that hex. */
function sharingPair(): { a: { x: number; y: number }; b: { x: number; y: number }; shared: string[] } {
  for (let dx = 0; dx < 8; dx++) {
    for (let dy = 0; dy < 8; dy++) {
      const a = { x: HOME.x + dx, y: HOME.y + dy };
      for (const b of [
        { x: a.x + 1, y: a.y },
        { x: a.x, y: a.y + 1 },
      ]) {
        const bKeys = new Set(hexesForTile(b.x, b.y).map((h) => hexKey(h.q, h.r)));
        const shared = hexesForTile(a.x, a.y)
          .map((h) => hexKey(h.q, h.r))
          .filter((k) => bKeys.has(k));
        if (shared.length) return { a, b, shared };
      }
    }
  }
  throw new Error('no neighbouring cells share a hex — the lattice size is wrong');
}

function board(owned: TileOwnership[], subject: string): string[] {
  return (resolveHexBoard(owned).get(subject) ?? []).map((h) => hexKey(h.q, h.r));
}

function expectDisjoint(owned: TileOwnership[]): void {
  const seen = new Set<string>();
  for (const hexes of resolveHexBoard(owned).values()) {
    for (const h of hexes) {
      const key = hexKey(h.q, h.r);
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  }
}
