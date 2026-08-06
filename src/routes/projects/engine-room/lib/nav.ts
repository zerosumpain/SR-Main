// nav.ts — the information architecture, in one place.
//
// The first cut of this study was ten flat sections averaging 1,900 words each. That is a
// seventy-minute read and nobody finishes it. This file replaces that with four parts, each
// a short hub over three to five single-idea pages. Every page carries one instrument and a
// caption; the nav, the hubs and the next/previous links all read from here, so the order of
// the study is defined exactly once.

export const B = '/projects/engine-room';

export type PartId = 'turn' | 'memory' | 'reach' | 'change';

export interface Leaf {
  /** Path segment under the part. */
  slug: string;
  label: string;
  /** One line for hubs and nav. Keep it under 15 words — it is a signpost, not a summary. */
  blurb: string;
  /** What you can actually operate on the page. Shown on hub cards. */
  instrument: string;
}

export interface Part {
  id: PartId;
  no: string;
  name: string;
  /** The question the part answers, in plain words. */
  strap: string;
  /** One line under the hub title. Under 25 words. */
  lede: string;
  /** CSS colour token for the part's accent. */
  tone: string;
  leaves: Leaf[];
}

export const PARTS: Part[] = [
  {
    id: 'turn',
    no: 'I',
    name: 'A turn',
    strap: 'What happens when you type',
    lede: 'One message, from keystroke to answer: who picks the model, where the time goes, and who pays for it.',
    tone: 'var(--accent-ink)',
    leaves: [
      { slug: 'trace', label: 'Trace a turn', instrument: 'Six stages × six layers, played back with a live clock',
        blurb: 'The whole study as one instrument — press play' },
      { slug: 'stream', label: 'Getting it back', instrument: 'Step a real frame sequence through two accumulators',
        blurb: 'How an answer arrives in pieces without losing any' },
      { slug: 'routing', label: 'Picking a model', instrument: 'Choose a seller by price, speed or precision',
        blurb: 'Four ways a model gets chosen, and who actually serves it' },
      { slug: 'latency', label: 'Where the time goes', instrument: 'A measured waterfall, and five calls plotted',
        blurb: 'The site is 2% of the wait — the rest is the model reading' },
      { slug: 'cost', label: 'Where the money goes', instrument: 'A token budget you can re-spend',
        blurb: 'Why context, not thinking, is the expensive part' },
    ],
  },
  {
    id: 'memory',
    no: 'II',
    name: 'Memory',
    strap: 'What it knows',
    lede: 'Documents, entities and a graph — and the difference between storing something and being able to find it.',
    tone: 'var(--accent)',
    leaves: [
      { slug: 'retrieval', label: 'Finding things', instrument: 'Watch a document become searchable chunks',
        blurb: 'Two deliberately separate indexes, and why not one' },
      { slug: 'entities', label: 'Is this the same person?', instrument: 'Toggle evidence, watch confidence cross the bar',
        blurb: 'Ten signals, one threshold, and what happens above it' },
      { slug: 'graph', label: 'How things connect', instrument: 'Exact against sampled ranking, plotted',
        blurb: 'Why an exact answer was cached rather than approximated' },
      { slug: 'research', label: 'Reading the web', instrument: 'Same sources, two ways of composing them',
        blurb: 'How merging sources invents facts, and what fixes it' },
    ],
  },
  {
    id: 'reach',
    no: 'III',
    name: 'Reach',
    strap: 'What it can touch',
    lede: 'Mail, files, the house, the calendar. Every capability costs context before it does anything at all.',
    tone: 'var(--success)',
    leaves: [
      { slug: 'tools', label: 'The cost of being able', instrument: 'Spend the tool budget 155 ways or 21',
        blurb: 'A catalogue too big to send, and the dispatcher that fixes it' },
      { slug: 'mcp', label: 'One doorway', instrument: 'Send a call through the gate and try to break it',
        blurb: 'How outside tools connect, and what stops the dangerous ones' },
      { slug: 'workflows', label: 'Wiring it together', instrument: 'Three wirings, two of which silently lose data',
        blurb: 'Eighty-eight node types, and the join that eats a branch' },
    ],
  },
  {
    id: 'change',
    no: 'IV',
    name: 'Change',
    strap: 'How it rebuilds itself',
    lede: 'It reads its own failures overnight and writes improvements. What it may install alone, and what it may not.',
    tone: '#8a2d3a',
    leaves: [
      { slug: 'nights', label: 'The night shift', instrument: 'Eight phases, and the six caps that bound them',
        blurb: 'It reads its own failures and writes improvements, unattended' },
      { slug: 'gate', label: 'The gate', instrument: 'Try to get generated code past the deny-list',
        blurb: 'Fourteen patterns that stop a machine shipping to itself' },
      { slug: 'shipping', label: 'Getting it live', instrument: 'Push a change down the pipeline and break it',
        blurb: 'Six stages between an idea and production' },
      { slug: 'limits', label: 'What it cannot do', instrument: 'Every guardrail, plotted by whether it actually holds',
        blurb: 'The difference between a wall and a polite request' },
    ],
  },
];

export const partById = (id: PartId) => PARTS.find((p) => p.id === id)!;
export const href = (part: PartId, slug?: string) => (slug ? `${B}/${part}/${slug}` : `${B}/${part}`);

/** Flat reading order: index → part → its leaves → next part … Used for prev/next links. */
export interface Step { href: string; label: string; part?: PartId }
export const ORDER: Step[] = [
  { href: B, label: 'The Engine Room' },
  ...PARTS.flatMap((p) => [
    { href: href(p.id), label: p.name, part: p.id },
    ...p.leaves.map((l) => ({ href: href(p.id, l.slug), label: l.label, part: p.id })),
  ]),
];

export const neighbours = (pathname: string) => {
  const clean = pathname.replace(/\/$/, '');
  const i = ORDER.findIndex((s) => s.href === clean);
  return { prev: i > 0 ? ORDER[i - 1] : null, next: i >= 0 && i < ORDER.length - 1 ? ORDER[i + 1] : null };
};

/** Old flat routes → their new home. Kept because the first version of this study was public. */
export const REDIRECTS: Record<string, string> = {
  trace: `${B}/turn/trace`,
  chat: `${B}/turn/stream`,
  models: `${B}/turn/routing`,
  tools: `${B}/reach/tools`,
  research: `${B}/memory/research`,
  automation: `${B}/reach/workflows`,
  building: `${B}/change/nights`,
  shipping: `${B}/change/shipping`,
  guardrails: `${B}/change/limits`,
};
