// Where the game is, and where to go next.
//
// Total ground ranks how far somebody roams — 91% of it has one visitor and no
// scoring rule can move it. The contested cells are the game, and they come in
// clumps: a park, a block, a lane two people both use. This module names those
// clumps (a battleground is a 4-connected component of cells with 2+ visitors)
// and, for each player, finds the neighbouring ground that is cheapest to take.
//
// Pure. The server names battlegrounds and strips `keys`.

import { connectedComponents } from './dissolve';
import { LOOP_WEIGHT, type TileOwnership } from './ownership';
import { parseTileKey, tileCentre, tileKeyOf, type Tile } from './tiles';

export interface BattlegroundCore {
  id: string;
  centre: [number, number];
  cells: number;
  holders: Array<{ subject: string; cells: number }>;
  /**
   * Cells whose owner is not who owned them at the start of the window.
   *
   * Deliberately literal: a cell nobody held a week ago and somebody holds now
   * COUNTS. It is a change of hands like any other, and one definition has to
   * serve three readers — this ranking, the page's "changed hands" figure and
   * the map focus's "changed" cells. Three places drawing their own line
   * between a first claim and a takeover is how they end up disagreeing.
   */
  handovers: number;
  contenders: string[];
  keys: string[];
}

export function findBattlegrounds(input: {
  visitors: Map<string, Set<string>>;
  ownerByCell: Map<string, string>;
  ownerThenByCell: Map<string, string>;
  minCells?: number;
}): BattlegroundCore[] {
  const minCells = input.minCells ?? 6;
  const contested: Tile[] = [];
  for (const [key, set] of input.visitors) if (set.size > 1) contested.push(parseTileKey(key));

  const out: BattlegroundCore[] = [];
  for (const component of connectedComponents(contested)) {
    if (component.length < minCells) continue;
    const keys = component.map((t) => tileKeyOf(t.x, t.y)).sort();
    const holders = new Map<string, number>();
    const contenders = new Set<string>();
    let handovers = 0;
    let latSum = 0;
    let lonSum = 0;
    for (const key of keys) {
      const owner = input.ownerByCell.get(key);
      if (owner) holders.set(owner, (holders.get(owner) ?? 0) + 1);
      for (const s of input.visitors.get(key) ?? []) contenders.add(s);
      const then = input.ownerThenByCell.get(key) ?? null;
      if ((owner ?? null) !== then) handovers += 1;
      const t = parseTileKey(key);
      const c = tileCentre(t.x, t.y);
      latSum += c.lat;
      lonSum += c.lon;
    }
    out.push({
      id: keys[0],
      centre: [round5(latSum / keys.length), round5(lonSum / keys.length)],
      cells: keys.length,
      holders: [...holders]
        .map(([subject, cells]) => ({ subject, cells }))
        .sort((a, b) => b.cells - a.cells || (a.subject < b.subject ? -1 : 1)),
      handovers,
      contenders: [...contenders].sort(),
      keys,
    });
  }
  return out.sort((a, b) => b.handovers - a.handovers || b.cells - a.cells || (a.id < b.id ? -1 : 1));
}

/**
 * The ceiling on `loopCells`, and the answer for ground that costs nothing.
 *
 * A zero gap is reachable — a neighbour where the challenger is already level
 * as runner-up, or a cell whose score has decayed to nothing — and `3 / 0` is
 * `Infinity`, which `JSON.stringify` writes as `null` into a field typed
 * `number`. Clamping here rather than at the route means every caller reads the
 * same number, and no route has to remember to do it.
 */
export const MAX_LOOP_CELLS = 999;

export interface NextMoveCore {
  subject: string;
  holder: string;
  cells: number;
  centre: [number, number];
  maxGap: number;
  loopCells: number;
  keys: string[];
}

/**
 * For each player, the largest clump among their cheapest neighbouring cells.
 *
 * `gap` is what a challenger must add to lead: the holder's decayed score less
 * the challenger's own score there. The challenger's score is known only when
 * they are the runner-up; otherwise it is taken as 0, which OVERSTATES the gap,
 * so a move is never sold as easier than it is. Cells with a gap over `maxGap`
 * are ignored — nothing short of a week of visits moves them.
 */
export function nextMoves(input: {
  owned: Map<string, TileOwnership>;
  subjects: string[];
  ring?: number;
  take?: number;
  maxGap?: number;
}): NextMoveCore[] {
  const ring = input.ring ?? 2;
  const take = input.take ?? 60;
  const maxGap = input.maxGap ?? 1;
  const out: NextMoveCore[] = [];

  for (const subject of input.subjects) {
    const mine = [...input.owned.values()].filter((o) => o.owner === subject);
    if (!mine.length) continue;
    const candidates = new Map<string, { o: TileOwnership; gap: number }>();
    for (const m of mine) {
      for (let dx = -ring; dx <= ring; dx++)
        for (let dy = -ring; dy <= ring; dy++) {
          if (!dx && !dy) continue;
          const key = tileKeyOf(m.tileX + dx, m.tileY + dy);
          const o = input.owned.get(key);
          if (!o || o.owner === subject || candidates.has(key)) continue;
          const own = o.runnerUp === subject ? o.runnerUpScore : 0;
          const gap = o.score - own;
          if (gap <= maxGap) candidates.set(key, { o, gap });
        }
    }
    if (!candidates.size) continue;
    const cheapest = [...candidates].sort((a, b) => a[1].gap - b[1].gap).slice(0, take);
    const tiles = cheapest.map(([, { o }]) => ({ x: o.tileX, y: o.tileY }));
    const comps = eightConnected(tiles).sort((a, b) => b.length - a.length);
    const best = comps[0];
    const keys = best.map((t) => tileKeyOf(t.x, t.y));
    const holders = new Map<string, number>();
    let gapMax = 0;
    let latSum = 0;
    let lonSum = 0;
    for (const key of keys) {
      const c = candidates.get(key)!;
      holders.set(c.o.owner, (holders.get(c.o.owner) ?? 0) + 1);
      gapMax = Math.max(gapMax, c.gap);
      const ll = tileCentre(c.o.tileX, c.o.tileY);
      latSum += ll.lat;
      lonSum += ll.lon;
    }
    const holder = [...holders].sort((a, b) => b[1] - a[1])[0][0];
    out.push({
      subject,
      holder,
      cells: keys.length,
      centre: [round5(latSum / keys.length), round5(lonSum / keys.length)],
      maxGap: gapMax,
      loopCells: gapMax > 0 ? Math.min(MAX_LOOP_CELLS, Math.floor(LOOP_WEIGHT / gapMax)) : MAX_LOOP_CELLS,
      keys,
    });
  }
  return out;
}

/** 8-connected components — a diagonal step is a step for a walker taking a clump. */
function eightConnected(tiles: Tile[]): Tile[][] {
  const remaining = new Map(tiles.map((t) => [tileKeyOf(t.x, t.y), t]));
  const out: Tile[][] = [];
  for (const start of [...remaining.keys()].sort()) {
    if (!remaining.has(start)) continue;
    const comp: Tile[] = [];
    const stack = [remaining.get(start)!];
    remaining.delete(start);
    while (stack.length) {
      const t = stack.pop()!;
      comp.push(t);
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++) {
          const key = tileKeyOf(t.x + dx, t.y + dy);
          const n = remaining.get(key);
          if (n) {
            remaining.delete(key);
            stack.push(n);
          }
        }
    }
    out.push(comp);
  }
  return out;
}

const round5 = (n: number) => Math.round(n * 1e5) / 1e5;
