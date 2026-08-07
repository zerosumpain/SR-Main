// decks.ts — content for Reach / "Making the case".
//
// A deck builder is a good test of a claim this study makes elsewhere: that one registry
// serving every consumer is what keeps the surface area maintainable. Here four very
// different consumers — a human editor, a player, a language model composing a slide, and an
// agent tool — all validate against the same schema, so a block the model invents is rejected
// by the same code that rejects a bad hand edit.
//
// The other argument is about the constraint. The page is a fixed size and nothing scrolls,
// so overflow is not a rendering bug to be fixed later — it is the design brief.
//
// Counted from source on 7 August 2026.

export const STAGE = { w: 1280, h: 720 } as const;

export const COUNTS = {
  layouts: 10,
  blocks: 14,
  proseStyles: 14,
  quoteStyles: 3,
  effects: 23,
  backgroundEffects: 16,
  transitionEffects: 9,
} as const;

/**
 * How much prose actually fits, per register. These are the composer's own working limits —
 * the numbers it is told to compose within, not measurements taken afterwards.
 */
export interface Register {
  id: string;
  label: string;
  /** Words of body prose the page holds at this register. */
  capacity: number;
  what: string;
  /** What to do instead when the content will not fit. */
  fix: string;
}

export const REGISTERS: Register[] = [
  {
    id: 'statement', label: 'Statement', capacity: 60,
    what: 'One dominant element filling half the page — a claim, a number or a short quotation — and whitespace doing the rest.',
    fix: 'If it will not fit as a statement, it was never a statement. Make it prose or split it.',
  },
  {
    id: 'editorial', label: 'Editorial', capacity: 120,
    what: 'A left-aligned column. The safe general-purpose page.',
    fix: 'Past the limit, change register rather than shrinking the type: cards, a ledger, or numbered steps.',
  },
  {
    id: 'split', label: 'Beside a visual', capacity: 60,
    what: 'Argument on one side, evidence on the other — a chart, an image or a live embed.',
    fix: 'A visual takes the room. Cut the words to a caption, or give the visual its own page.',
  },
  {
    id: 'poster', label: 'Poster', capacity: 40,
    what: 'A full-bleed image with the words overlaid on a scrim. The boldest page in the set.',
    fix: 'Nothing survives here but a title and a line. Anything more belongs on the next slide.',
  },
];

export const OVERFLOW = {
  title: 'Overflow is cut off, not scrolled',
  body:
    'A slide is a fixed canvas that never scrolls, so text past the edge is simply gone — and gone in a way that looks fine in the editor and fails in the room. The composer is therefore given the limits as a hard rule rather than a preference, and told what to do instead of shrinking type: tighten the words, choose a denser register, or split the slide.',
} as const;

// ---------------------------------------------------------------------------
// One registry, four consumers
// ---------------------------------------------------------------------------

export const CONSUMERS = [
  { id: 'editor', label: 'The editor', what: 'A person dragging blocks around. Rejects an invalid block before it is saved.' },
  { id: 'player', label: 'The player', what: 'What an audience sees. Renders only block types the registry knows.' },
  { id: 'composer', label: 'The composer', what: 'A model choosing a layout and writing the blocks. Its output goes through the same validation.' },
  { id: 'tool', label: 'The agent tool', what: 'The assistant building a deck from a conversation. Same schemas, same refusals.' },
];

export const REGISTRY_NOTE = {
  title: 'The model gets the documentation, not a second schema',
  body:
    'The layout and block descriptions sent to the composer are generated from the registry itself, so the prompt cannot describe a block the code does not have. The alternative — a hand-written prompt beside a hand-written schema — drifts on the first change and fails as an invalid slide nobody can explain.',
} as const;

// ---------------------------------------------------------------------------
// The art director and its understudy
// ---------------------------------------------------------------------------

export const COMPOSE_PATHS = [
  {
    id: 'llm', label: 'The model composes', when: 'normally',
    what: 'A single call — not an agentic loop — picks the layout and writes the blocks, and is told the layouts of the neighbouring slides so the rhythm varies.',
  },
  {
    id: 'reject', label: 'The registry rejects it', when: 'the model returns something invalid',
    what: 'The output is thrown away and the heuristic composes instead. A malformed slide never reaches the deck.',
  },
  {
    id: 'down', label: 'The model is unavailable', when: 'the gateway times out or fails over and still fails',
    what: 'Same outcome, reached earlier: a deterministic composer picks a layout from the shape of the content.',
  },
];

export const FALLBACK_NOTE = {
  title: 'The fallback is the same code path, not an error state',
  body:
    'Composition either produces a valid slide or it does not happen — there is no partial result and no “the model was down” placeholder to clean up later. That is only affordable because the deterministic composer is good enough to ship, which is the price of making the clever path optional.',
} as const;

// ---------------------------------------------------------------------------
// Sharing
// ---------------------------------------------------------------------------

export const SHARING = [
  { k: 'Private by default', v: 'owner only', why: 'A deck is unreachable until it is either published or given a link, and the two are separate decisions.' },
  { k: 'Links are hashed', v: 'only the digest is stored', why: 'The same treatment as a project share. A database dump does not hand anyone a working link.' },
  { k: 'Links expire and revoke', v: 'per link, per recipient', why: 'One link per audience, so withdrawing access from one does not withdraw it from everybody.' },
  { k: 'How far they got', v: 'per slide, per link', why: 'The player beacons which slides a shared session actually reached. Anonymous, and only for link sessions — it answers “did they read past slide four”, which is the only useful question about a deck you have sent.' },
  { k: 'A tree, not a stack', v: 'slides can have children', why: 'A slide with children can be descended into during the talk, so the detail is there if it is asked for and absent if it is not.' },
  { k: 'Optimistic concurrency', v: 'a version per slide', why: 'Two editors, one slide: the second save is refused with a conflict rather than silently overwriting the first.' },
];

export const DECK_LESSON = {
  title: 'The constraint is the feature',
  body:
    'Every part of this — the registry, the fixed canvas, the word limits, the deterministic fallback — exists to stop the machine producing something that is technically a slide and unusable in a room. A generator with no constraints is a generator of drafts.',
} as const;
