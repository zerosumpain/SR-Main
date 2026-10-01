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
 * Deterministic signed jitter in the closed range [-range, +range] from a string
 * seed (reuses hashId). Returns 0 when range ≤ 0. Stable across processes/reloads
 * so a jittered desk is layout-stable (no Date/Math.random).
 */
export function jitter(seed: string, range: number): number {
  if (range <= 0) return 0;
  const span = 2 * range + 1;
  return (hashId(seed) % span) - range;
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
 * The SYNTHESIZE clean zone sits BELOW the scatter region with a generous gap
 * so that organised clusters never overlap raw research scatter cards.
 *
 * Scatter occupies Y = [BAND.originY … BAND.originY + BAND.height)
 *                     = [0 … 1600)
 * The synthesis zone starts at Y = 1600 + SYNTHESIS_ZONE_GAP = 1600 + 280 = 1880
 * (grid-snapped).  All organised layout coordinates are offsets from
 * (ORG.originX, ORG.originY), so moving those two values relocates the whole zone.
 *
 * The zone also spreads across the full scatter width (3 × BAND.width = 2160 px)
 * so category columns have room to breathe.
 */

/** Vertical gap between the bottom of the scatter envelope and the top of the
 *  synthesis zone (world-space pixels). Must be large enough to read as a
 *  deliberate separation at any zoom level. */
export const SYNTHESIS_ZONE_GAP = 280;

/** Top-left world-space origin of the synthesis zone (grid-snapped). */
export const SYNTHESIS_ZONE_ORIGIN: Pos = {
  x: snap(BAND.originX),
  y: snap(BAND.originY + BAND.height + SYNTHESIS_ZONE_GAP),
};

/**
 * Organised (SYNTHESIZE) layout geometry. Category columns run left→right;
 * facts/sources stack under a reserved header slot inside each column; entities
 * collect into a bottom rail that wraps. All values are GRID-aligned.
 *
 * originX / originY are derived from SYNTHESIS_ZONE_ORIGIN so the organised
 * zone always sits below the scatter region with a clear spatial separation.
 */
export const ORG = {
  originX: SYNTHESIS_ZONE_ORIGIN.x,
  originY: SYNTHESIS_ZONE_ORIGIN.y,
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
  let maxRow: number = ORG.headerRows;

  // Rail cursor.
  let railIdx = 0;

  for (const a of artefacts) {
    // 1) Pinned / dragged cards win verbatim and consume no slot.
    // Do NOT snap override coordinates — the user may have dragged to a
    // non-grid position; we must honour it exactly (spec §3.6/§5.7).
    if (a.override) {
      out.set(a.id, { x: a.override.x, y: a.override.y });
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

// ——— SYNTHESIZE-mode accumulation helpers (added in Milestone 7) ———
//
// These power the morph/sticky/pinned motion contract (see desk/positioning.ts).
// `organisedLayout` (above) is the authoritative packer; these helpers describe
// the bounding box of the organised core and place NEW (post-synthesis) loose
// arrivals AROUND that core rather than over it. All geometry derives from the
// existing ORG constants so a single source of truth governs the layout.

/** Card box used by the accumulation packer; kept in sync with ArtefactCard.svelte. */
export const CARD_W = 220;
export const CARD_H = 120;
/** Width of a category column — derived from the ORG column stride. */
export const COL_W = ORG.colStride;

/** Pixel bounding box of a positions map (each entry is a CARD_W×CARD_H card). */
export function organisedCorePxBounds(
  positions: Map<string, Pos>,
): { minX: number; minY: number; maxX: number; maxY: number } {
  if (positions.size === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of positions.values()) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x + CARD_W > maxX) maxX = p.x + CARD_W;
    if (p.y + CARD_H > maxY) maxY = p.y + CARD_H;
  }
  return { minX, minY, maxX, maxY };
}

/**
 * Deterministic scatter for a NEW arrival that lands AROUND the organised core
 * (to the right of it) rather than over it. Falls back to plain scatterPosition
 * when the core is empty. Grid-snapped, so accumulated and hand-dragged cards
 * share one grid.
 */
export function accumulationScatter(
  id: string,
  coreBounds: { minX: number; minY: number; maxX: number; maxY: number },
): Pos {
  const empty = coreBounds.maxX === 0 && coreBounds.maxY === 0
    && coreBounds.minX === 0 && coreBounds.minY === 0;
  if (empty) return scatterPosition(id, 99);
  const h = hashId(id);
  const laneW = COL_W; // a column-wide gutter to the right of the core
  const x = coreBounds.maxX + ORG.railGap + (h % 3) * laneW;
  const span = Math.max(CARD_H * 4, coreBounds.maxY - coreBounds.minY);
  const y = coreBounds.minY + ((h >> 3) % span);
  return { x: snap(x), y: snap(y) };
}

// ——— PILE LAYOUT (Milestone 4) ———
//
// A grid of overlapping "piles". Each group from grouping.ts becomes one pile,
// packed left→right (wrapping past PILE.perRow). A COLLAPSED pile is a fanned
// stack: member i sits at anchor + i*{fanDx, fanDy} (snapped), capped at
// maxVisible so members past the cap stack at the cap position (hidden behind
// the visible fan; the desk renders a "+N" badge for them). An EXPANDED pile
// spreads its members into a vertical column at the anchor (rowStride apart, no
// cap). Pure + deterministic + grid-snapped. Manual/pinned overrides are NOT
// applied here — posOf re-asserts those after this layout (priority unchanged).
//
// Imports are local to keep layout.ts free of a hard dependency cycle: grouping
// imports themes (not layout), so layout may type-only import grouping safely.

import type { Group, GroupCard } from './grouping';

export const PILE = {
  /** Top-left origin of the pile grid (reuses the synthesis zone origin). */
  originX: SYNTHESIS_ZONE_ORIGIN.x,
  originY: SYNTHESIS_ZONE_ORIGIN.y,
  /** Card box — kept in sync with the desk card footprint. */
  cardW: CARD_W,
  cardH: CARD_H,
  /** Nominal pile-column width, used only to budget a row before it wraps
   *  (perRow × colStride). Anchors are NOT placed on a fixed colStride grid — they
   *  flow left→right by each pile's ACTUAL footprint width (see pileFootprint), so
   *  a wide multi-fan-column pile can never overlap its neighbour. */
  colStride: 460,
  /** Minimum vertical distance between pile anchor rows (rows actually advance by
   *  the tallest pile in the row, but never less than this). */
  pileRowStride: 460,
  /** Gap (px) left between one pile's footprint and the next, both horizontally
   *  (between anchors in a row) and vertically (between rows). */
  pileGap: 90,
  /** Max signed offset (px) applied to each pile's anchor, seeded by group key, so
   *  the piles read as a hand-strewn desk rather than a rigid grid. Smaller than
   *  pileGap so a jittered pile can never bleed into its neighbour. */
  anchorJitter: 22,
  /** Piles per row before wrapping to the next anchor row. */
  perRow: 5,
  /** Fan offset applied per member in a collapsed pile.
   *  At 26×18, a card is 220×120 so each member peeks out by ~26px / ~18px —
   *  clearly visible even on a dense desk. */
  fanDx: 26,
  fanDy: 18,
  /** Max fan spread (number of members before the fan wraps to a second column).
   *  Large groups wrap rather than hiding cards — every member stays visible. */
  fanWrapAt: 8,
  /** Horizontal stride between fan columns when a pile is too large to fan linearly. */
  fanColStride: 260,
  /** Vertical stride between members of an EXPANDED pile's column (row 0 = anchor). */
  rowStride: 160,
} as const;

/**
 * Pixel footprint (width × height) of a pile with `n` members, in its collapsed
 * fan or expanded column form. The width is what the anchor packer advances by,
 * so a wide pile never overlaps its neighbour.
 *
 * Collapsed fan: members wrap into ceil(n / fanWrapAt) columns; the widest
 * column has min(n, fanWrapAt) members. Width spans the rightmost card edge;
 * height spans the tallest column.
 * Expanded: a single vertical column, cardW wide, n cards tall.
 */
export function pileFootprint(n: number, expanded: boolean): { w: number; h: number } {
  const count = Math.max(1, n);
  if (expanded) {
    return { w: PILE.cardW, h: (count - 1) * PILE.rowStride + PILE.cardH };
  }
  const fanCols = Math.ceil(count / PILE.fanWrapAt);
  const widestColRows = Math.min(count, PILE.fanWrapAt);
  const w = (fanCols - 1) * PILE.fanColStride + (widestColRows - 1) * PILE.fanDx + PILE.cardW;
  const h = (widestColRows - 1) * PILE.fanDy + PILE.cardH;
  return { w, h };
}

/**
 * Place every grouped card into a pile.
 *
 * @param groups       Ordered groups (drives left→right anchor packing).
 * @param memberOf     cardId → groupKey (from grouping.ts).
 * @param cards        All desk cards; only those whose memberOf key is a known
 *                     group get a position (orphans are skipped).
 * @param expanded     Set of group keys currently expanded (spread to a column);
 *                     groups not in the set render as a collapsed fan.
 * @returns            Map<cardId, Pos>, grid-snapped, deterministic.
 */
export function pileLayout(
  groups: Group[],
  memberOf: Map<string, string>,
  cards: GroupCard[],
  expanded: Set<string>,
): Map<string, Pos> {
  // Bucket member cards per group, preserving input order (stable stacking).
  const membersByGroup = new Map<string, string[]>();
  const groupKeys = new Set(groups.map((g) => g.key));
  for (const c of cards) {
    const key = memberOf.get(c.id);
    if (key === undefined || !groupKeys.has(key)) continue; // orphan — skip
    let arr = membersByGroup.get(key);
    if (!arr) {
      arr = [];
      membersByGroup.set(key, arr);
    }
    arr.push(c.id);
  }

  // Anchor (top-left of the i=0 member) for each group. Piles FLOW left→right by
  // their actual footprint width (so a wide multi-fan-column pile never overlaps
  // its neighbour), wrapping to a new row after PILE.perRow piles OR when the row
  // would exceed its width budget. Each row advances vertically by the tallest
  // pile in the previous row. A small per-pile wobble (seeded by group key) keeps
  // it from reading as a rigid grid.
  const anchorOf = new Map<string, Pos>();
  const rowBudget = PILE.perRow * PILE.colStride;
  let cursorX = PILE.originX;
  let rowTop = PILE.originY;
  let rowMaxH = 0;
  let placedInRow = 0;
  for (const g of groups) {
    const n = membersByGroup.get(g.key)?.length ?? 0;
    if (n === 0) continue;
    // Pack by the COLLAPSED footprint regardless of expand state, so expanding a
    // pile only spreads its own cards downward — it never reshuffles the anchors
    // of neighbouring piles (an expanded pile overflows into the space below it).
    const fp = pileFootprint(n, false);
    // Wrap to a new row past perRow piles, or if this pile would overflow the row
    // budget — but always place at least one pile per row.
    if (placedInRow > 0 && (placedInRow >= PILE.perRow || cursorX + fp.w > PILE.originX + rowBudget)) {
      cursorX = PILE.originX;
      // Advance by the tallest pile in the row (+ gap), but never less than the
      // nominal row stride so rows keep a consistent rhythm.
      rowTop += Math.max(rowMaxH + PILE.pileGap, PILE.pileRowStride);
      rowMaxH = 0;
      placedInRow = 0;
    }
    anchorOf.set(g.key, {
      x: snap(cursorX + jitter(g.key + '\x01', PILE.anchorJitter)),
      y: snap(rowTop + jitter(g.key + '\x02', PILE.anchorJitter)),
    });
    cursorX += fp.w + PILE.pileGap;
    if (fp.h > rowMaxH) rowMaxH = fp.h;
    placedInRow++;
  }

  const out = new Map<string, Pos>();
  for (const [key, anchor] of anchorOf) {
    const members = membersByGroup.get(key) ?? [];
    const isExpanded = expanded.has(key);
    members.forEach((id, i) => {
      if (isExpanded) {
        // Vertical column at the anchor — every member a distinct slot.
        out.set(id, {
          x: snap(anchor.x),
          y: snap(anchor.y + i * PILE.rowStride),
        });
      } else {
        // Collapsed fan: every member gets a unique offset so a slice of each
        // card is always visible. Large piles wrap into a second fan column
        // rather than stacking any cards on top of each other. The fan stays a
        // clean linear offset (NO per-card positional jitter) so the
        // "no hidden cards" guarantee holds exactly; the strewn-desk feel comes
        // from the per-pile anchor wobble above + the per-card tilt in the view.
        const fanCol = Math.floor(i / PILE.fanWrapAt);
        const fanRow = i % PILE.fanWrapAt;
        out.set(id, {
          x: snap(anchor.x + fanCol * PILE.fanColStride + fanRow * PILE.fanDx),
          y: snap(anchor.y + fanRow * PILE.fanDy),
        });
      }
    });
  }

  return out;
}
