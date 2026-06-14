// src/lib/canvas/intelligence/desk/positioning.ts
//
// The morph/sticky/pinned motion contract, as a pure function.
// The component renders card transforms from effectivePosition() inside a
// CSS-transition'd translate, so changes animate (ease-in-out) automatically.

import { scatterPosition, accumulationScatter } from './layout';

export type DeskMode = 'gather' | 'synthesize';

export interface PosCard {
  id: string;
  kind: string;
  phase: number; // 1|2|3, with 4 = 'post' / synthesis-era arrival (store folds 'post'→4)
  canvasX: number | null;
  canvasY: number | null;
  pinned: boolean;
  deskState: string; // 'unfiled' | 'filed' | 'synthesized' | 'archived'
  deskCategory: string | null;
}

type Bounds = { minX: number; minY: number; maxX: number; maxY: number };

/** A post-synthesis ("post" phase) arrival, which accumulates around the core
 *  rather than landing in a fixed intake band. The store folds 'post'→4; we
 *  also accept the plan's 99 literal for robustness. */
function isPostArrival(phase: number): boolean {
  return phase >= 4;
}

/**
 * Where a card should render right now.
 * Priority:
 *   1. Manual position (pinned OR user-dragged → non-null canvasX/Y) — wins in both modes.
 *   2. Already filed/synthesized — STAYS at its organised slot (sticky), even in GATHER.
 *   3. Unfiled new arrival (post phase) — scatters AROUND the core.
 *   4. Unfiled original arrival — deterministic phase-banded scatter.
 * If a filed card lacks an organised slot (e.g. mid-stream), fall back to scatter
 * so it never collapses to (0,0).
 */
export function effectivePosition(
  card: PosCard,
  _mode: DeskMode,
  organised: Map<string, { x: number; y: number }>,
  coreBounds: Bounds,
): { x: number; y: number } {
  // 1. Manual position always wins (pinned or user-dragged).
  if (card.canvasX != null && card.canvasY != null) {
    return { x: card.canvasX, y: card.canvasY };
  }

  const isFiled = card.deskState === 'synthesized' || card.deskState === 'filed';

  // 2. Sticky: a filed card keeps its organised slot in BOTH modes.
  if (isFiled) {
    const slot = organised.get(card.id);
    if (slot) return slot;
    // No slot yet → park around the core rather than (0,0).
    return accumulationScatter(card.id, coreBounds);
  }

  // 3 & 4. Unfiled cards.
  // Post-synthesis arrivals accumulate around the organised core.
  if (isPostArrival(card.phase)) {
    return accumulationScatter(card.id, coreBounds);
  }
  // Original intake → deterministic phase-banded scatter.
  return scatterPosition(card.id, card.phase);
}
