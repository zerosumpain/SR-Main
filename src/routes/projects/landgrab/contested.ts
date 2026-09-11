// The contested board, as a pure function.
//
// Total ground answers the wrong question. On 2026-09-11 the ledger held
// 19,479 cells and only 2,504 of them — 12.9% — had ever been visited by more
// than one person; 91% of John's territory had been visited by nobody else at
// all. So a board ranked on area ranks how far somebody roams, and no scoring
// rule can change it, because there is no rule that takes a cell off the only
// person who has ever stood there.
//
// This is the other half: the ground two or more people have both walked, who
// holds it now, and what share of their own contested ground each is winning.
// It is a real table where the area board is a formality — at the time of
// writing Rory held 171 contested cells off 28 active days, against John's
// 1,585 off 420.
//
// Pure and separate from the load because the load needs a database and this
// needs testing.

import type { ContestedStanding } from './types';

/** What the page knows about each cell: who has stood on it, and who holds it. */
export interface ContestInput {
  /** Cell key -> every subject with at least one capture event there. */
  visitors: Map<string, Set<string>>;
  /** Cell key -> the subject who owns it now. Absent means nobody. */
  ownerByCell: Map<string, string>;
  /** The roster, in the order the board should break ties. */
  subjects: string[];
}

export interface ContestResult {
  /** How many cells more than one person has visited. */
  cells: number;
  board: ContestedStanding[];
}

/**
 * Rank the contest.
 *
 * `visited` counts contested cells this person has stood on — NOT every cell
 * they have stood on, which would make the rate meaningless for whoever roams
 * furthest. `winRate` is therefore "of the ground you actually compete for,
 * how much are you holding", and a walker who never leaves the estate can top
 * it.
 */
export function resolveContest({ visitors, ownerByCell, subjects }: ContestInput): ContestResult {
  const contested: string[] = [];
  for (const [key, set] of visitors) if (set.size > 1) contested.push(key);

  const holds = new Map<string, number>();
  const visits = new Map<string, number>();
  for (const key of contested) {
    const owner = ownerByCell.get(key);
    if (owner) holds.set(owner, (holds.get(owner) ?? 0) + 1);
    for (const s of visitors.get(key) ?? []) visits.set(s, (visits.get(s) ?? 0) + 1);
  }

  const board = subjects
    .map((subject) => {
      const visited = visits.get(subject) ?? 0;
      const held = holds.get(subject) ?? 0;
      return { subject, holds: held, visited, winRate: visited ? held / visited : 0 };
    })
    // Most ground held first; then the better rate, so two people on the same
    // count are split by how efficiently they got there rather than by name.
    .sort((a, b) => b.holds - a.holds || b.winRate - a.winRate);

  return { cells: contested.length, board };
}
