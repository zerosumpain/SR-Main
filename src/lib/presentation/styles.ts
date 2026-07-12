// Style presets for text blocks — the single source the registry enum, both
// editor dropdowns (panel + canvas toolbar) and the LLM docs all read. Same
// contract as effects.ts/embeds.ts: allowlist with a doc line per entry.

export interface StyleDef {
  id: string;
  /** Dropdown label: "id — what it looks like". */
  label: string;
  /** When the art director should reach for it (embedded in BLOCK_DOCS). */
  doc: string;
}

export const PROSE_STYLES: StyleDef[] = [
  { id: 'body', label: 'body — paragraphs', doc: 'plain editorial paragraphs (the default)' },
  { id: 'lede', label: 'lede — large opener', doc: 'large opening type for the first paragraph of a story' },
  {
    id: 'band',
    label: 'band — inverted emphasis',
    doc: 'full-width INVERTED emphasis band for short rhythmic creeds ("Refusal. Auditability. Blast radius." — an *italic* line renders amber)',
  },
  {
    id: 'cards',
    label: 'cards — paragraph cards',
    doc: 'each paragraph becomes a bordered card (bold opener = card title) for detail-dense content instead of long paragraphs',
  },
  { id: 'aside', label: 'aside — mono footnote', doc: 'small mono footnote/source note' },
  {
    id: 'pull',
    label: 'pull — italic pull-text',
    doc: 'oversized italic pull-text between hairlines (a line worth lingering on that is NOT a quotation)',
  },
  { id: 'columns', label: 'columns — two-column body', doc: 'body flowed into two columns for dense reference text' },
  {
    id: 'callout',
    label: 'callout — petrol note box',
    doc: 'a tinted petrol note box (bold opener = its title) for warnings/key takeaways',
  },
  {
    id: 'numbered',
    label: 'numbered — 01/02/03 sequence',
    doc: 'editorial numbered sequence — each paragraph gets an oversized 01/02/03 numeral (bold opener = step title); for ordered arguments, phases, steps',
  },
  {
    id: 'ledger',
    label: 'ledger — spec-sheet rows',
    doc: 'spec-sheet rows — each paragraph opens with a **bold label** that sits in a left column, the rest is its value; for specifications, facts-at-a-glance, key–value detail',
  },
  {
    id: 'interview',
    label: 'interview — Q&A exchange',
    doc: 'Q&A exchange — paragraphs alternate question/answer, each opened by a **bold speaker label**; questions render italic serif, answers plain',
  },
  {
    id: 'manifesto',
    label: 'manifesto — shouted lines',
    doc: 'a stack of short declarative lines in huge display type, one paragraph per line (*italic* words flare accent); for creeds and rallying statements when the inverted band is too heavy',
  },
  {
    id: 'verse',
    label: 'verse — centered lyric',
    doc: 'centered italic serif with airy leading — for lyrical or reflective passages, epigraphs, dedications',
  },
  {
    id: 'checklist',
    label: 'checklist — ticked items',
    doc: 'bullet lines ("- ") render as accent-ticked ✓ items — for what is done, what ships, commitments kept',
  },
];

export const PROSE_STYLE_IDS = PROSE_STYLES.map((s) => s.id);

export const QUOTE_STYLES: StyleDef[] = [
  { id: 'rail', label: 'rail — accent left rail', doc: 'the default: accent-ink left rail, italic serif (a quote inside a busier page)' },
  {
    id: 'pull',
    label: 'pull — huge centered',
    doc: 'huge centered quotation under an oversized ornamental mark — when the quote IS the page',
  },
  {
    id: 'boxed',
    label: 'boxed — inset card',
    doc: 'an inset bordered card with a large opening quote glyph — a documentary aside beside other content',
  },
];

export const QUOTE_STYLE_IDS = QUOTE_STYLES.map((s) => s.id);

/** "id: doc; id: doc; …" — embedded into BLOCK_DOCS for the art director. */
export function styleDocsForLLM(defs: StyleDef[]): string {
  return defs.map((s) => `${s.id}: ${s.doc}`).join('; ');
}
