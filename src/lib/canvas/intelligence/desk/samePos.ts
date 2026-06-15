// src/lib/canvas/intelligence/desk/samePos.ts
//
// Tiny pure helper for the Research Desk morph-gating optimisation.
//
// The desk arms its 520ms `transition: transform` only on cards whose
// world-space position actually CHANGED since the last render flush
// (e.g. on the GATHER⇄SYNTHESIZE mode flip). Comparing positions needs a
// cheap, allocation-free equality check that treats a missing "previous"
// position (a brand-new card) as "not moved" so streamed-in cards don't
// each re-arm a transition during GATHER.

export interface XY {
  x: number;
  y: number;
}

/**
 * True when two positions are identical (or one is absent → treated as equal,
 * i.e. "no movement to animate"). A brand-new card has no previous position,
 * so we deliberately report `same` to suppress a spurious morph on first paint.
 */
export function samePos(a: XY | undefined, b: XY | undefined): boolean {
  if (!a || !b) return true;
  return a.x === b.x && a.y === b.y;
}
