// Pure desk-layout geometry for the Research Canvas ("the Desk").
//
// All coordinates are WORLD-SPACE top-left card origins, snapped to GRID,
// matching the canvas drag idiom in
// src/routes/jkai/canvas/[slug]/+page.svelte (GRID = 20, top-left translate).
//
// No global mutable state, no Date/Math.random: scatterPosition is a pure
// function of (id, phase) so reloads and SSE reconnects are layout-stable.

/** Canvas snap grid — must match the canvas drag GRID so auto- and hand-placed
 *  cards share one grid. */
export const GRID = 20;

/** A world-space top-left position for a card. */
export interface Pos {
  x: number;
  y: number;
}

/** Minimal artefact shape consumed by organisedLayout.
 *  `kind` is the artefact type ('source' | 'fact' | 'entity'); relationships
 *  are edges only and never appear here. `override` carries a pinned /
 *  user-dragged position (non-null canvas_x/y) that must win in every mode. */
export interface LayoutArtefact {
  id: string;
  kind: string;
  categoryId?: string;
  override?: Pos | null;
}

/** A synthesis category / cluster column header. */
export interface LayoutCategory {
  id: string;
  title: string;
}

/** Snap a raw world coordinate to the canvas grid. */
export function snap(v: number): number {
  return Math.round(v / GRID) * GRID;
}

/**
 * Deterministic 32-bit unsigned hash of a string (FNV-1a).
 * Stable across processes; used to seed scatter positions so the same
 * artefact id always lands in the same spot.
 */
export function hashId(id: string): number {
  let h = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    // FNV prime multiply via shifts to stay in 32-bit range without BigInt.
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}

/**
 * Phase band geometry for GATHER scatter. Bands run left→right across the
 * desk; each phase owns one band. Card footprint (cardW/cardH) is reserved
 * inside every band so the *body* of a card never crosses a band boundary,
 * not just its top-left origin.
 */
export const BAND = {
  originX: 0,
  originY: 0,
  width: 720, // px per phase band (world units)
  height: 1600, // vertical envelope a band may scatter into
  cardW: 240, // reserved card footprint width
  cardH: 140, // reserved card footprint height
  pad: 20, // inner padding so cards don't touch the band edge
} as const;

/** Map an engine phase (1|2|3|'post') to a 0-based band index. */
export const PHASE_TO_BAND: Record<number | 'post', number> = {
  0: 0,
  1: 0,
  2: 1,
  3: 2,
  post: 2,
};

/**
 * Normalise a phase value to a band index. Accepts the numeric phases the
 * signature declares plus the 'post' literal the engine also emits.
 */
function bandIndex(phase: number | 'post'): number {
  if (phase === 'post') return PHASE_TO_BAND.post;
  return PHASE_TO_BAND[phase] ?? 0;
}

/**
 * Deterministic GATHER-mode scatter for an artefact id within its phase band.
 *
 * Two independent hashes seed the x and y channels so positions are
 * uncorrelated. The hash is mapped to a discrete grid-step index via modulo
 * (avoids floating-point bias that floats/0x100000000 introduce). The card
 * footprint is reserved inside the band so the whole card body stays within
 * `[lo, lo + width]` horizontally and the vertical envelope vertically.
 * Output is snapped to GRID so scattered and hand-dragged cards share one grid.
 */
export function scatterPosition(id: string, phase: number): Pos {
  const band = bandIndex(phase as number | 'post');

  // Two independent hashes: suffix with '\x01'/'\x02' gives uncorrelated seeds
  // for x and y, eliminating the correlation that would arise from splitting
  // a single 32-bit hash into two 16-bit channels.
  const hx = hashId(id + '\x01');
  const hy = hashId(id + '\x02');

  const lo = BAND.originX + band * BAND.width;
  const spanX = Math.max(0, BAND.width - BAND.cardW - 2 * BAND.pad);
  const spanY = Math.max(0, BAND.height - BAND.cardH - 2 * BAND.pad);

  // Map to discrete grid steps via modulo (no float-division bias).
  const stepsX = Math.max(1, Math.floor(spanX / GRID));
  const stepsY = Math.max(1, Math.floor(spanY / GRID));

  const x = lo + BAND.pad + (hx % (stepsX + 1)) * GRID;
  const y = BAND.originY + BAND.pad + (hy % (stepsY + 1)) * GRID;

  return { x: snap(x), y: snap(y) };
}

/**
 * Organised (SYNTHESIZE) layout geometry. Category columns run left→right;
 * facts/sources stack under a reserved header slot inside each column; entities
 * collect into a bottom rail that wraps. All values are GRID-aligned.
 */
export const ORG = {
  originX: 0,
  originY: 0,
  colStride: 320, // horizontal distance between column left edges
  rowStride: 180, // vertical distance between stacked cards in a column
  headerRows: 1, // rows reserved at the top of a column for the CategoryHeader
  railGap: 240, // extra vertical gap between the tallest column and the rail
  railWidth: 1600, // rail wraps when an entity would exceed this width
  entityStride: 200, // horizontal distance between entity chips on the rail
  railRowStride: 120, // vertical distance between wrapped rail rows
} as const;

/** Y of row index `r` within a column (row 0 = header slot). */
function rowY(r: number): number {
  return snap(ORG.originY + r * ORG.rowStride);
}

/** X of column index `c`. */
function colX(c: number): number {
  return snap(ORG.originX + c * ORG.colStride);
}

/**
 * SYNTHESIZE-mode placement.
 *
 * - Category columns are laid left→right in `categories` order. Artefacts whose
 *   categoryId matches none of them (or is undefined) fall into a trailing
 *   "uncategorised" column.
 * - Non-entity artefacts (facts, sources) stack vertically under a reserved
 *   header slot in their column, in array order.
 * - Entities ignore categoryId and collect into a bottom rail spanning beneath
 *   the columns, wrapping to new rail rows past `railWidth`.
 * - Any artefact with a non-null `override` keeps that exact position and does
 *   NOT consume a column or rail slot (pinned / user-dragged cards never move).
 *
 * Returns a Map keyed by artefact id. Deterministic and grid-snapped.
 */
export function organisedLayout(
  artefacts: LayoutArtefact[],
  categories: LayoutCategory[],
): Map<string, Pos> {
  const out = new Map<string, Pos>();
  const railSlots: { id: string; row: number; col: number }[] = [];

  // Column index per category id; named columns first, uncategorised last.
  const colOf = new Map<string, number>();
  categories.forEach((c, i) => colOf.set(c.id, i));
  const uncategorisedCol = categories.length;

  // Per-column next free (non-header) row, starting after the header slot.
  const nextRow = new Array<number>(categories.length + 1).fill(ORG.headerRows);

  // Deepest column row reached, to anchor the rail below everything.
  let maxRow = ORG.headerRows;

  // Rail cursor.
  let railIdx = 0;

  for (const a of artefacts) {
    // 1) Pinned / dragged cards win verbatim and consume no slot.
    if (a.override) {
      out.set(a.id, { x: snap(a.override.x), y: snap(a.override.y) });
      continue;
    }

    // 2) Entities → bottom rail (categoryId ignored).
    if (a.kind === 'entity') {
      const perRow = Math.max(1, Math.floor(ORG.railWidth / ORG.entityStride));
      const railRow = Math.floor(railIdx / perRow);
      const railCol = railIdx % perRow;
      out.set(a.id, {
        x: snap(ORG.originX + railCol * ORG.entityStride),
        y: 0, // placeholder; resolved to the real rail Y in the post-pass below
      });
      // Stash the rail coordinates so the post-pass can offset Y by the column depth.
      railSlots.push({ id: a.id, row: railRow, col: railCol });
      railIdx++;
      continue;
    }

    // 3) Facts / sources → category column stack.
    const col = a.categoryId !== undefined && colOf.has(a.categoryId)
      ? colOf.get(a.categoryId)!
      : uncategorisedCol;
    const row = nextRow[col];
    nextRow[col] = row + 1;
    if (row > maxRow) maxRow = row;
    out.set(a.id, { x: colX(col), y: rowY(row) });
  }

  // Post-pass: anchor the entity rail beneath the tallest column.
  const railBaseY = snap(rowY(maxRow + 1) + ORG.railGap);
  for (const s of railSlots) {
    const p = out.get(s.id)!;
    out.set(s.id, { x: p.x, y: snap(railBaseY + s.row * ORG.railRowStride) });
  }

  return out;
}
