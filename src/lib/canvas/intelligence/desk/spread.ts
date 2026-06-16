// src/lib/canvas/intelligence/desk/spread.ts
//
// Pure layout for the "click a group heading → spread its cards into open space
// to explore them" interaction. Given the focused group's member ids and a
// world-space anchor (the viewport centre captured at click time), lay the
// members out in a clean, evenly-spaced grid centred on the anchor, with the
// heading card sitting just above the grid.
//
// No global state, no Date/Math.random — deterministic for a given input so the
// spread is stable while focused.

import { snap, type Pos } from './layout';

/** Card box + generous gutters so spread cards are readable and never overlap. */
export const SPREAD = {
  cardW: 240,
  cardH: 132,
  /** Cell = card + gutter. */
  cellW: 300,
  cellH: 200,
  /** Max columns before wrapping to a new row. */
  maxCols: 5,
  /** Header card footprint (matches GroupHeaderCard). */
  headerW: 264,
  headerH: 92,
  /** Vertical gap between the heading card and the top of the member grid. */
  headerGap: 40,
} as const;

export interface SpreadResult {
  /** member cardId → world-space top-left position. */
  positions: Map<string, Pos>;
  /** world-space top-left of the heading card. */
  heading: Pos;
}

/** Columns for `n` members: a roughly-square grid, capped at maxCols. */
export function spreadCols(n: number): number {
  if (n <= 1) return 1;
  return Math.min(SPREAD.maxCols, Math.ceil(Math.sqrt(n)));
}

/**
 * Lay `memberIds` into a grid centred on `anchor` (world space), with the
 * heading card centred above the grid. Grid-snapped + deterministic.
 */
export function spreadLayout(memberIds: string[], anchor: Pos): SpreadResult {
  const n = memberIds.length;
  const cols = spreadCols(n);
  const rows = Math.max(1, Math.ceil(n / cols));

  const gridW = cols * SPREAD.cellW;
  const gridH = rows * SPREAD.cellH;

  // Heading sits above the grid; the grid block (heading + gap + grid) is
  // centred vertically on the anchor.
  const blockH = SPREAD.headerH + SPREAD.headerGap + gridH;
  const blockTop = anchor.y - blockH / 2;

  const heading: Pos = {
    x: snap(anchor.x - SPREAD.headerW / 2),
    y: snap(blockTop),
  };

  const gridTop = blockTop + SPREAD.headerH + SPREAD.headerGap;
  const gridLeft = anchor.x - gridW / 2;
  const cellPadX = (SPREAD.cellW - SPREAD.cardW) / 2;
  const cellPadY = (SPREAD.cellH - SPREAD.cardH) / 2;

  const positions = new Map<string, Pos>();
  memberIds.forEach((id, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    positions.set(id, {
      x: snap(gridLeft + col * SPREAD.cellW + cellPadX),
      y: snap(gridTop + row * SPREAD.cellH + cellPadY),
    });
  });

  return { positions, heading };
}
