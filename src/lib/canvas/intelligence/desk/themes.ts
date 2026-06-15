// Pure theme-grouping logic for the Research Desk ("Arrange by theme").
//
// Themes group artefacts by KIND/type rather than by synthesis cluster:
//   Sites · Videos · Facts · Challenges · People · Places · Organisations · Concepts
//
// All geometry is WORLD-SPACE top-left card origins, grid-snapped to GRID,
// matching the scatter/organised layouts in ./layout. No global mutable state,
// no Date/Math.random: themeOf + themeLayout are pure functions of their inputs
// so reloads and SSE reconnects are layout-stable.

import { snap, GRID, type Pos } from './layout';

/** Canonical theme keys an artefact can be grouped under. */
export type ThemeKey =
  | 'sites'
  | 'videos'
  | 'facts'
  | 'challenges'
  | 'people'
  | 'places'
  | 'orgs'
  | 'concepts';

/** Minimal artefact shape consumed by the theme grouping. Mirrors the relevant
 *  slice of DeskCard: kind + the fields that decide a theme (source domain,
 *  fact isCounterfactual, entity type). */
export interface ThemeArtefact {
  id: string;
  kind: string; // 'source' | 'fact' | 'entity'
  fields?: Record<string, unknown>;
}

/** Ordered list of themes — drives left→right cluster order AND header render
 *  order. Empty themes are simply skipped by themeLayout. */
export const THEMES: ReadonlyArray<{ key: ThemeKey; label: string }> = [
  { key: 'sites', label: 'Sites' },
  { key: 'videos', label: 'Videos' },
  { key: 'facts', label: 'Facts' },
  { key: 'challenges', label: 'Challenges' },
  { key: 'people', label: 'People' },
  { key: 'places', label: 'Places' },
  { key: 'orgs', label: 'Organisations' },
  { key: 'concepts', label: 'Concepts' },
];

/** Index of each theme key in THEMES order (for stable column placement). */
const THEME_ORDER = new Map<ThemeKey, number>(THEMES.map((t, i) => [t.key, i]));

/** Domains (or domain substrings) that mark a source as a VIDEO rather than a
 *  plain site. Matched case-insensitively against the source's domain. */
const VIDEO_DOMAINS = [
  'youtube.com',
  'youtu.be',
  'vimeo.com',
  'dailymotion.com',
  'twitch.tv',
  'tiktok.com',
];

/** True when a source domain belongs to a known video platform. */
function isVideoDomain(domain: unknown): boolean {
  if (typeof domain !== 'string' || domain.length === 0) return false;
  const d = domain.toLowerCase();
  return VIDEO_DOMAINS.some((v) => d === v || d.endsWith('.' + v) || d.includes(v));
}

/** Map an entity `type` string to its theme. Tolerant of common synonyms and
 *  casing; anything unrecognised falls through to 'concepts'. */
function entityTheme(type: unknown): ThemeKey {
  const t = typeof type === 'string' ? type.toLowerCase().trim() : '';
  if (t === 'person' || t === 'people') return 'people';
  if (t === 'place' || t === 'location' || t === 'geo' || t === 'geography') return 'places';
  if (
    t === 'org' ||
    t === 'organisation' ||
    t === 'organization' ||
    t === 'company' ||
    t === 'institution'
  ) {
    return 'orgs';
  }
  return 'concepts';
}

/**
 * Map a single artefact to its theme.
 *   - kind 'source' → 'sites', BUT a known video-platform domain → 'videos'.
 *   - kind 'fact'   → isCounterfactual ? 'challenges' : 'facts'.
 *   - kind 'entity' → by entity `type`: person→people, place/location/geo→places,
 *                     org/organisation/company→orgs, else→concepts.
 * Unknown kinds fall through to 'concepts' so every card lands somewhere.
 */
export function themeOf(card: ThemeArtefact): ThemeKey {
  const f = card.fields ?? {};
  if (card.kind === 'source') {
    return isVideoDomain(f.domain) ? 'videos' : 'sites';
  }
  if (card.kind === 'fact') {
    return f.isCounterfactual ? 'challenges' : 'facts';
  }
  if (card.kind === 'entity') {
    return entityTheme(f.type);
  }
  return 'concepts';
}

// ——— theme cluster geometry ———
//
// Each non-empty theme is laid out as a labelled block: a header slot at the
// top, then its cards wrap into a fixed-width grid beneath. Blocks are placed
// left→right in THEMES order; each block reserves enough horizontal room for
// its full card grid plus a gutter so two themes never overlap.

export const THEME = {
  originX: 0,
  originY: 0,
  /** Card box (kept in sync with ArtefactCard.svelte / layout.CARD_W/H). */
  cardW: 240,
  cardH: 140,
  /** Cards laid in a column within a theme before wrapping to the next column. */
  rowsPerCol: 6,
  /** Horizontal stride between card columns inside a theme block. */
  colStride: 280,
  /** Vertical stride between stacked cards inside a column. */
  rowStride: 168,
  /** Rows reserved at the top of every block for the theme header. */
  headerRows: 1,
  /** Horizontal gutter between adjacent theme blocks. */
  blockGap: 120,
} as const;

/** Header-slot world position for a theme block whose left edge is `blockX`. */
export function themeHeaderPos(blockX: number): Pos {
  return { x: snap(blockX), y: snap(THEME.originY) };
}

/** Number of card columns a theme block of `n` cards occupies. */
function colsFor(n: number): number {
  return Math.max(1, Math.ceil(n / THEME.rowsPerCol));
}

/** Pixel width a theme block of `n` cards reserves (cols × stride). */
function blockWidth(n: number): number {
  return colsFor(n) * THEME.colStride;
}

/**
 * Lay out all given cards grouped by theme.
 *
 * - Cards are bucketed by themeOf, preserving input order within a bucket.
 * - Each NON-EMPTY theme becomes a labelled block; empty themes are skipped
 *   and consume no horizontal space.
 * - Within a block, cards stack into columns of `rowsPerCol`, wrapping to a new
 *   column; row 0 is reserved for the theme header.
 * - Blocks are placed left→right in THEMES order; each block's left edge is the
 *   running cursor, advanced by the block's own width plus `blockGap`, so no two
 *   theme blocks ever overlap.
 *
 * Returns a Map keyed by artefact id with a position for EVERY input card.
 * Deterministic and grid-snapped.
 */
export function themeLayout(cards: ThemeArtefact[]): Map<string, Pos> {
  // 1) Bucket by theme, preserving input order within each bucket.
  const buckets = new Map<ThemeKey, ThemeArtefact[]>();
  for (const c of cards) {
    const key = themeOf(c);
    let arr = buckets.get(key);
    if (!arr) {
      arr = [];
      buckets.set(key, arr);
    }
    arr.push(c);
  }

  // 2) Place non-empty blocks left→right in THEMES order.
  const out = new Map<string, Pos>();
  let cursorX = THEME.originX;
  const orderedKeys = [...buckets.keys()].sort(
    (a, b) => (THEME_ORDER.get(a) ?? 0) - (THEME_ORDER.get(b) ?? 0),
  );

  for (const key of orderedKeys) {
    const members = buckets.get(key)!;
    if (members.length === 0) continue;
    const blockX = cursorX;
    members.forEach((m, i) => {
      const col = Math.floor(i / THEME.rowsPerCol);
      const row = (i % THEME.rowsPerCol) + THEME.headerRows;
      out.set(m.id, {
        x: snap(blockX + col * THEME.colStride),
        y: snap(THEME.originY + row * THEME.rowStride),
      });
    });
    cursorX = blockX + blockWidth(members.length) + THEME.blockGap;
  }

  return out;
}

/**
 * Header positions + labels + counts for the active theme blocks, in the SAME
 * left→right order themeLayout placed them. Useful for rendering world-space
 * labelled headers above each cluster. Returns one entry per NON-EMPTY theme.
 */
export function themeHeaders(
  cards: ThemeArtefact[],
): Array<{ key: ThemeKey; label: string; count: number; pos: Pos }> {
  const buckets = new Map<ThemeKey, number>();
  for (const c of cards) {
    const key = themeOf(c);
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  const orderedKeys = [...buckets.keys()].sort(
    (a, b) => (THEME_ORDER.get(a) ?? 0) - (THEME_ORDER.get(b) ?? 0),
  );
  const labelOf = new Map<ThemeKey, string>(THEMES.map((t) => [t.key, t.label]));

  const out: Array<{ key: ThemeKey; label: string; count: number; pos: Pos }> = [];
  let cursorX = THEME.originX;
  for (const key of orderedKeys) {
    const count = buckets.get(key)!;
    if (count === 0) continue;
    out.push({
      key,
      label: labelOf.get(key) ?? key,
      count,
      pos: themeHeaderPos(cursorX),
    });
    cursorX = cursorX + blockWidth(count) + THEME.blockGap;
  }
  return out;
}

// Re-export GRID-related geometry consumers may want alongside themes.
export { GRID };
