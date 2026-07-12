// Progressive reveal (build steps) — pure helpers shared by the player, the
// editor and tests. A content block may carry `step: N` (1–12): it stays
// hidden until the presenter has advanced N times within the slide. Blocks
// without a step are always visible.

import type { ArrowKey } from './navigation';
import type { Block } from './types';

/** Highest step number on the slide (0 = nothing staged). */
export function maxStep(blocks: Block[]): number {
  return blocks.reduce((m, b) => Math.max(m, ('step' in b ? (b.step ?? 0) : 0)), 0);
}

/**
 * Should an arrow press act on the slide's build steps instead of navigating?
 * Only the CURRENT plane's axis participates: its forward key reveals the
 * next step, its backward key re-hides the last one. The cross-axis keys
 * (entering/exiting a journey) always navigate.
 */
export function stepArrow(
  axis: 'h' | 'v',
  key: ArrowKey,
  stepIndex: number,
  max: number,
): 'reveal' | 'unreveal' | null {
  if (max <= 0) return null;
  const forward = axis === 'h' ? 'right' : 'down';
  const backward = axis === 'h' ? 'left' : 'up';
  if (key === forward && stepIndex < max) return 'reveal';
  if (key === backward && stepIndex > 0) return 'unreveal';
  return null;
}
