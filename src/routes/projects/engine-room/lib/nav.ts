// nav.ts — the information architecture, in one place.
//
// The first cut of this study was ten flat sections averaging 1,900 words each. That is a
// seventy-minute read and nobody finishes it. This file replaces that with four parts, each
// a short hub over three to five single-idea pages. Every page carries one instrument and a
// caption; the nav, the hubs and the next/previous links all read from here, so the order of
// the study is defined exactly once.

export const B = '/projects/engine-room';

export type PartId = 'turn' | 'memory' | 'reach' | 'change' | 'ground';

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
    lede: 'One message, from keystroke to answer: who picks the model, where the time goes, and who ends up paying for it.',
    tone: 'var(--accent-ink)',
    leaves: [
      { slug: 'trace', label: 'Trace a turn', instrument: 'Six stages × six layers, played back with a live clock',
        blurb: 'The whole study as one instrument — press play' },
      { slug: 'stream', label: 'Getting it back', instrument: 'Step a real frame sequence through two accumulators',
        blurb: 'How an answer arrives in pieces without mislaying any' },
      { slug: 'routing', label: 'Picking a model', instrument: 'Choose a seller by price, speed or precision',
        blurb: 'Four ways a model gets picked, and who actually serves it' },
      { slug: 'latency', label: 'Where the time goes', instrument: 'A measured waterfall, and five calls plotted',
        blurb: 'My code is 2% of the wait. The model is having a read' },
      { slug: 'cost', label: 'Where the money goes', instrument: 'A token budget you can re-spend',
        blurb: 'The thinking is cheap. The remembering is what costs' },
    ],
  },
  {
    id: 'memory',
    no: 'II',
    name: 'Memory',
    strap: 'What it knows',
    lede: 'Eight doors in, documents, entities, a graph and a drawer for the odds and ends — plus the gap between keeping a thing and believing it.',
    tone: 'var(--accent)',
    leaves: [
      { slug: 'channels', label: 'Where it all comes from', instrument: 'Compare eight doors on author, arrival and cost',
        blurb: 'Eight channels feed one graph. They are not equals' },
      { slug: 'retrieval', label: 'Finding things', instrument: 'Watch a document become searchable chunks',
        blurb: 'Two indexes kept deliberately apart, and why not one' },
      { slug: 'entities', label: 'Is this the same person?', instrument: 'Toggle evidence, watch confidence cross the bar',
        blurb: 'Ten signals, one threshold, and the safer mistake' },
      { slug: 'trust', label: 'Deciding what to believe', instrument: 'Grade a claim on two axes and watch the score assemble',
        blurb: 'A number you cannot take apart is just an opinion' },
      { slug: 'store', label: 'Somewhere to put anything', instrument: 'Ask as five principals, see who gets a yes',
        blurb: 'The junk drawer, with a bouncer on the door' },
      { slug: 'graph', label: 'How things connect', instrument: 'Exact against sampled ranking, plotted',
        blurb: 'Why the exact answer turned out to be the cheap one' },
      { slug: 'watch', label: 'Standing questions', instrument: 'Move an entity overnight, see if it is worth saying',
        blurb: 'Nine kinds of movement, and a bar built to stay quiet' },
      { slug: 'research', label: 'Reading the web', instrument: 'Same sources, two ways of composing them',
        blurb: 'Blend your sources and you will invent a fact' },
    ],
  },
  {
    id: 'reach',
    no: 'III',
    name: 'Reach',
    strap: 'What it can touch',
    lede: 'Mail, files, decks, credentials, the house, the outdoors. Every new ability costs context before it has done a single useful thing.',
    tone: 'var(--success)',
    leaves: [
      { slug: 'tools', label: 'The cost of being able', instrument: 'Spend the tool budget 155 ways or 21',
        blurb: 'A catalogue too fat to send, and the fix for it' },
      { slug: 'mcp', label: 'One doorway', instrument: 'Send a call through the gate and try to break it',
        blurb: 'How outside tools get in, and what stops the rough ones' },
      { slug: 'keys', label: 'Keys it can use and cannot read', instrument: 'Aim a credential somewhere it should not go',
        blurb: 'Where a key may travel is baked into the key' },
      { slug: 'drive', label: 'The filing cabinet', instrument: 'Drop six kinds of file in and watch where each one goes',
        blurb: 'The journey a photograph makes before it is searchable' },
      { slug: 'decks', label: 'Making the case', instrument: 'Pour words onto a fixed page until they fall off it',
        blurb: 'Slides where too much text falls off, as nature intended' },
      { slug: 'feeds', label: 'Reading from the outside', instrument: 'Stored status against what a probe just observed',
        blurb: 'A connector insisting it is fine is rarely evidence' },
      { slug: 'house', label: 'The house', instrument: 'Browse a house by room, and watch a dry run',
        blurb: 'Several hundred identifiers, rearranged into a building' },
      { slug: 'trails', label: 'Out of signal', instrument: 'Budget an offline map, then grade a route by climb',
        blurb: 'Route planning that keeps working where the phone does not' },
      { slug: 'workflows', label: 'Wiring it together', instrument: 'Three wirings, two of which silently lose data',
        blurb: 'Eighty-eight node types, and the join that eats a branch' },
    ],
  },
  {
    id: 'change',
    no: 'IV',
    name: 'Change',
    strap: 'How it rebuilds itself',
    lede: 'Every night it reads its own failures and writes improvements, and every build leaves a lesson behind. What it may install by itself, and what it very much may not.',
    tone: '#8a2d3a',
    leaves: [
      { slug: 'nights', label: 'The night shift', instrument: 'Eight phases, and the six caps that bound them',
        blurb: 'It marks its own homework at 3:30am, then acts on it' },
      { slug: 'gate', label: 'The gate', instrument: 'Try to get generated code past the deny-list',
        blurb: 'Fourteen patterns standing between a model and my server' },
      { slug: 'shipping', label: 'Getting it live', instrument: 'Push a change down the pipeline and break it',
        blurb: 'Six stages between a good idea and a live one' },
      { slug: 'lessons', label: "The build's memory", instrument: 'Ask the graph what it knows about a file or a failure',
        blurb: 'Every failed build is filed, and the next one reads the file' },
      { slug: 'limits', label: 'What it cannot do', instrument: 'Every guardrail, plotted by whether it actually holds',
        blurb: 'The difference between a wall and a strongly worded note' },
    ],
  },
  {
    id: 'ground',
    no: 'V',
    name: 'Ground',
    strap: 'Where it actually runs',
    lede: 'One codebase on two machines with different permissions, and four places a byte can end up. The unglamorous floor everything else is standing on.',
    tone: '#5a6b7a',
    leaves: [
      { slug: 'estate', label: 'Three places, one codebase', instrument: 'Pick a machine, see which subsystems wake up on it',
        blurb: 'What a process may do depends on where it woke up' },
      { slug: 'storage', label: 'Where the bytes live', instrument: 'Break something and see what actually recovers it',
        blurb: 'Four stores, and the one loss no backup will save you from' },
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
