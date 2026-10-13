// src/lib/trips/solver/order.ts
//
// Order one day's stops. Hard-timed items (booked slots, fixed times, locked
// stops) are anchors kept in time order; the rest go in by cheapest
// insertion (musts first, then nices in the person's order), then the
// sequence is improved by or-opt (move a run of 1–3) and 2-opt (reverse a
// run) until no move lowers the cost. First improvement wins and moves are
// tried in a fixed order, so the result is deterministic. Sized for ≤ ~12.

import type { Item } from './items';

export type SequenceCost = (seq: Item[]) => number;

const EPS = 1e-9;
const MAX_PASSES = 60;

function anchorsInOrder(seq: Item[]): boolean {
  let last = -Infinity;
  for (const item of seq) {
    if (item.fixedStartMin === null) continue;
    if (item.fixedStartMin < last) return false;
    last = item.fixedStartMin;
  }
  return true;
}

export function byInsertionOrder(a: Item, b: Item): number {
  const pa = a.priority === 'must' ? 0 : 1;
  const pb = b.priority === 'must' ? 0 : 1;
  return pa - pb || a.sortHint - b.sortHint || a.id.localeCompare(b.id);
}

/** Cheapest insertion of `item` into `seq` (earliest position on ties). */
export function insertCheapest(seq: Item[], item: Item, cost: SequenceCost): { seq: Item[]; cost: number } {
  let best: { seq: Item[]; cost: number } | null = null;
  for (let p = 0; p <= seq.length; p++) {
    const trial = [...seq.slice(0, p), item, ...seq.slice(p)];
    if (!anchorsInOrder(trial)) continue;
    const c = cost(trial);
    if (!best || c < best.cost - EPS) best = { seq: trial, cost: c };
  }
  return best ?? { seq: [...seq, item], cost: cost([...seq, item]) };
}

/** Improve a sequence in place of anchors' order; returns the best found. */
export function improve(seq: Item[], cost: SequenceCost): Item[] {
  let current = seq;
  let currentCost = cost(current);
  const n = current.length;
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    let improved = false;
    // or-opt: move a run of length 1..3 to another position
    outer: for (let len = 1; len <= Math.min(3, n - 1); len++) {
      for (let i = 0; i + len <= n; i++) {
        const run = current.slice(i, i + len);
        const rest = [...current.slice(0, i), ...current.slice(i + len)];
        for (let j = 0; j <= rest.length; j++) {
          if (j === i) continue;
          const trial = [...rest.slice(0, j), ...run, ...rest.slice(j)];
          if (!anchorsInOrder(trial)) continue;
          const c = cost(trial);
          if (c < currentCost - EPS) {
            current = trial;
            currentCost = c;
            improved = true;
            break outer;
          }
        }
      }
    }
    if (!improved) {
      // 2-opt: reverse current[i..j]
      outer2: for (let i = 0; i < n - 1; i++) {
        for (let j = i + 1; j < n; j++) {
          const trial = [
            ...current.slice(0, i),
            ...current.slice(i, j + 1).reverse(),
            ...current.slice(j + 1),
          ];
          if (!anchorsInOrder(trial)) continue;
          const c = cost(trial);
          if (c < currentCost - EPS) {
            current = trial;
            currentCost = c;
            improved = true;
            break outer2;
          }
        }
      }
    }
    if (!improved) break;
  }
  return current;
}

/** Order a day's items (no meals): anchors by time, cheapest insertion, then improve. */
export function orderDay(items: Item[], cost: SequenceCost): Item[] {
  const anchors = items
    .filter((i) => i.fixedStartMin !== null)
    .sort((a, b) => (a.fixedStartMin as number) - (b.fixedStartMin as number) || a.id.localeCompare(b.id));
  const flex = items.filter((i) => i.fixedStartMin === null).sort(byInsertionOrder);
  let seq = anchors;
  for (const item of flex) seq = insertCheapest(seq, item, cost).seq;
  return seq.length > 1 ? improve(seq, cost) : seq;
}
