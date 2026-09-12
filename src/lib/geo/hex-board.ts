// Held cells -> a coloured board.
//
// SERVER-ONLY (see rings.ts) — this reads `TileOwnership`, which carries a
// score and a last-event time. The lattice arithmetic it stands on is in
// `./hex`, which is client-safe on purpose: the browser draws the same hexes
// this file assigns.
//
// The square cell remains the scoring atom. Nothing here re-scores anything;
// it projects an answer the ledger already gave onto the shape the map now
// draws.

import { hexKey, hexesForTile, parseHexKey, type Hex } from './hex';
import { isTie, type TileOwnership } from './ownership';
import type { Tile } from './tiles';

/** What one player holds, in hexes. */
export type HexBoard = Map<string, Hex[]>;

interface Claim {
  score: number;
  /** Most recent contributing event, for the tie-break. */
  at: number;
}

/**
 * Who holds each hex, from who holds each cell.
 *
 * A hex takes the argmax of the SUMMED scores of the cells that fed it, ties
 * broken by the most recent contributing event and then by subject name — the
 * same ladder `standingsAt` walks, so a contested hex resolves the way a
 * contested cell does rather than by whichever cell was iterated first.
 *
 * SMALL HOLDINGS INSIDE STRONGER ONES ARE UNDER-DRAWN, and can vanish. A hex
 * goes wholly to one subject, and the lattice is offset from the cell grid, so
 * a cell can contribute only to hexes somebody else wins outright. Measured:
 * a lone cell inside a 7x7 block at nine times the score draws nothing at all
 * 14% of the time, and a 2x2 inside one draws fewer than four hexes 32% of the
 * time. That is quantisation, not unfairness — at 47 m a single cell inside
 * somebody else's ground is below the board's resolution — and it is why the
 * CELL count stays the number of record everywhere else on the page. The map
 * key keys its isolate control off the drawn board rather than off the
 * leaderboard, so a player the board cannot show cannot be isolated into a
 * blank map.
 *
 * It SUMS rather than taking the strongest single cell. At the shipped size the
 * two rules agree — measured over a 12x12 block of Darlington, 138 hexes have
 * one claimant cell and 10 have two, and none has three — so summing buys
 * nothing today. It is the rule that stays right if `HEX_R` is ever retuned to
 * something chunkier, where a hex would be fed by four or five cells and
 * "whoever has most of it" is the only answer a reader would accept.
 */
export function resolveHexBoard(owned: Iterable<TileOwnership>): HexBoard {
  const claims = new Map<string, Map<string, Claim>>();
  for (const o of owned) {
    const at = o.lastEventAt.getTime();
    for (const h of hexesForTile(o.tileX, o.tileY)) {
      const key = hexKey(h.q, h.r);
      let bySubject = claims.get(key);
      if (!bySubject) claims.set(key, (bySubject = new Map()));
      const held = bySubject.get(o.owner);
      if (held) {
        held.score += o.score;
        if (at > held.at) held.at = at;
      } else {
        bySubject.set(o.owner, { score: o.score, at });
      }
    }
  }

  const board: HexBoard = new Map();
  for (const [key, bySubject] of claims) {
    let winner: string | null = null;
    let best: Claim | null = null;
    for (const [subject, claim] of bySubject) {
      if (!best || beats(subject, claim, winner!, best)) {
        winner = subject;
        best = claim;
      }
    }
    // `=== null`, not falsy: an empty-string subject is a subject.
    if (winner === null) continue;
    const list = board.get(winner);
    const hex = parseHexKey(key);
    if (list) list.push(hex);
    else board.set(winner, [hex]);
  }
  return board;
}

function beats(subject: string, claim: Claim, heldBy: string, held: Claim): boolean {
  if (!isTie(claim.score, held.score)) return claim.score > held.score;
  if (claim.at !== held.at) return claim.at > held.at;
  return subject < heldBy;
}

/**
 * The hexes a set of cells covers, deduplicated and unowned.
 *
 * The handover layer's shape: ground that changed hands is drawn as an outline
 * over whoever holds it now, so it needs the cells' footprint rather than a
 * second opinion about who owns them.
 */
export function hexesForTiles(tiles: Iterable<Tile>): Hex[] {
  const seen = new Set<string>();
  const out: Hex[] = [];
  for (const t of tiles) {
    for (const h of hexesForTile(t.x, t.y)) {
      const key = hexKey(h.q, h.r);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(h);
    }
  }
  return out;
}
