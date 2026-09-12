import { describe, expect, it } from 'vitest';
import { MAX_LOOP_CELLS, findBattlegrounds, nextMoves } from './battlegrounds';
import { tileKeyOf } from './tiles';
import type { TileOwnership } from './ownership';

const k = tileKeyOf;
const own = (x: number, y: number, owner: string, score: number, runnerUp: string | null = null, runnerUpScore = 0): [string, TileOwnership] => [
  k(x, y),
  { tileX: x, tileY: y, owner, score, runnerUp, runnerUpScore, lastEventAt: new Date(0), ownerSince: new Date(0) },
];

describe('findBattlegrounds', () => {
  it('clusters contested cells and ranks by handovers then size', () => {
    const visitors = new Map<string, Set<string>>();
    const ownerByCell = new Map<string, string>();
    const ownerThenByCell = new Map<string, string>();
    // Cluster A: 3x3 at (10,10), john vs katie, two cells flipped.
    for (let x = 10; x < 13; x++) for (let y = 10; y < 13; y++) {
      visitors.set(k(x, y), new Set(['john', 'katie']));
      ownerByCell.set(k(x, y), x === 10 ? 'katie' : 'john');
      ownerThenByCell.set(k(x, y), 'john');
    }
    // Cluster B: 2x3 at (50,50), rory vs john, no flips — six cells, meets the floor.
    for (let x = 50; x < 52; x++) for (let y = 50; y < 53; y++) {
      visitors.set(k(x, y), new Set(['rory', 'john']));
      ownerByCell.set(k(x, y), 'rory');
      ownerThenByCell.set(k(x, y), 'rory');
    }
    // A lone contested cell — under the floor, dropped.
    visitors.set(k(90, 90), new Set(['john', 'fintan']));
    ownerByCell.set(k(90, 90), 'john');
    // An uncontested cell — never a battleground.
    visitors.set(k(91, 91), new Set(['john']));

    const b = findBattlegrounds({ visitors, ownerByCell, ownerThenByCell, minCells: 6 });
    expect(b).toHaveLength(2);
    expect(b[0]).toMatchObject({ id: k(10, 10), cells: 9, handovers: 3, contenders: ['john', 'katie'] });
    expect(b[0].holders).toEqual([{ subject: 'john', cells: 6 }, { subject: 'katie', cells: 3 }]);
    expect(b[1]).toMatchObject({ id: k(50, 50), cells: 6, handovers: 0 });
    expect(b[0].keys).toHaveLength(9);
  });

  it('counts a first claim as a handover — unowned a week ago, owned now', () => {
    const visitors = new Map<string, Set<string>>();
    const ownerByCell = new Map<string, string>();
    const ownerThenByCell = new Map<string, string>();
    // 2x3 at (0,0) — six cells, the default floor. Every cell is john's now.
    for (let x = 0; x < 2; x++) for (let y = 0; y < 3; y++) {
      visitors.set(k(x, y), new Set(['john', 'katie']));
      ownerByCell.set(k(x, y), 'john');
      // (1,2) is absent from the "then" map: nobody held it at the start.
      if (!(x === 1 && y === 2)) ownerThenByCell.set(k(x, y), 'john');
    }

    const [b] = findBattlegrounds({ visitors, ownerByCell, ownerThenByCell });
    expect(b).toMatchObject({ cells: 6, handovers: 1 });
  });
});

describe('nextMoves', () => {
  it('finds the cheapest neighbouring ground for each player', () => {
    const owned = new Map<string, TileOwnership>([
      own(10, 10, 'katie', 2),
      own(11, 10, 'john', 0.05, 'katie', 0.01), // cheap, adjacent to katie's cell
      own(12, 10, 'john', 0.06),                // cheap, within 2 of katie's
      own(20, 20, 'john', 5),                   // expensive and far
    ]);
    const moves = nextMoves({ owned, subjects: ['katie', 'john'] });
    const katie = moves.find((m) => m.subject === 'katie')!;
    expect(katie).toMatchObject({ holder: 'john', cells: 2 });
    expect(katie.maxGap).toBeCloseTo(0.06, 5);
    expect(katie.loopCells).toBe(Math.floor(3 / 0.06));
    // John's only neighbour is katie's cell at score 2 — over the gap ceiling, so no move.
    expect(moves.find((m) => m.subject === 'john')).toBeUndefined();
  });
  it('returns nothing for a player with no ground', () => {
    expect(nextMoves({ owned: new Map(), subjects: ['katie'] })).toEqual([]);
  });

  it('welds a clump across a corner — a diagonal step is a step', () => {
    const owned = new Map<string, TileOwnership>([
      own(10, 10, 'katie', 2),
      own(11, 11, 'john', 0.05), // diagonal from katie's cell
      own(12, 12, 'john', 0.06), // diagonal from (11,11), 4-adjacent to nothing
    ]);
    const [move] = nextMoves({ owned, subjects: ['katie'] });
    // 4-connectivity would see two clumps of one and report cells: 1.
    expect(move).toMatchObject({ holder: 'john', cells: 2 });
    expect(move.maxGap).toBeCloseTo(0.06, 5);
  });

  it('clamps loopCells for ground that costs nothing', () => {
    const owned = new Map<string, TileOwnership>([
      own(10, 10, 'katie', 2),
      own(11, 10, 'john', 0.02, 'katie', 0.02), // katie is already level here
    ]);
    const [move] = nextMoves({ owned, subjects: ['katie'] });
    expect(move.maxGap).toBe(0);
    expect(move.loopCells).toBe(MAX_LOOP_CELLS);
    expect(Number.isFinite(move.loopCells)).toBe(true);
  });
});
