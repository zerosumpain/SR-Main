// Slide layout archetypes — the predetermined "page designs" of sr. decks.
// One source of truth: SlideView renders them, the registry/tools validate
// against them, the composer and the jkai builder read the docs to choose
// impactfully. Server-safe (no Svelte).

export interface LayoutDef {
  label: string;
  /** One-liner surfaced to the LLM (composer + jkai tool descriptions). */
  doc: string;
}

export const LAYOUTS = {
  default: {
    label: 'Editorial',
    doc: 'Left-aligned editorial column. The safe general-purpose page.',
  },
  center: {
    label: 'Centered',
    doc: 'Centered column. Title, close and transitional moments.',
  },
  'full-bleed': {
    label: 'Full bleed',
    doc: 'Media/interactive edge to edge with minimal padding. Use for embed, iframe or a hero image.',
  },
  statement: {
    label: 'Statement',
    doc: 'ONE dominant element at poster scale with generous whitespace — a single quote, bigNumber or masthead. The boldest text page; use for the thesis or a gut-punch number.',
  },
  split: {
    label: 'Split',
    doc: 'Two columns: text blocks left (38%), visual blocks (image/chart/embed/iframe/timeline) right (62%), vertically centered. Argument beside evidence.',
  },
  'split-flip': {
    label: 'Split (flipped)',
    doc: 'Mirror of split — visuals left, text right. Alternate with split for rhythm.',
  },
  grid: {
    label: 'Grid',
    doc: 'A leading full-width block, then the rest in a two-column grid. For stat/evidence-dense slides (statRow, several quotes/cards).',
  },
  poster: {
    label: 'Poster',
    doc: 'The first image block becomes a full-bleed dimmed backdrop; remaining text blocks overlay bottom-left on a scrim. The boldest media page — needs an image block.',
  },
} as const satisfies Record<string, LayoutDef>;

export type SlideLayoutId = keyof typeof LAYOUTS;

export const LAYOUT_IDS = Object.keys(LAYOUTS) as SlideLayoutId[];

export function isLayout(v: unknown): v is SlideLayoutId {
  return typeof v === 'string' && v in LAYOUTS;
}

/** Compact "id — doc" list for LLM-facing tool descriptions and prompts. */
export function layoutDocsForLLM(): string {
  return Object.entries(LAYOUTS)
    .map(([id, d]) => `${id} — ${d.doc}`)
    .join(' | ');
}

/** Block types that count as "visual" when a split layout assigns columns. */
export const VISUAL_BLOCK_TYPES = new Set(['image', 'chart', 'embed', 'iframe', 'timeline']);
