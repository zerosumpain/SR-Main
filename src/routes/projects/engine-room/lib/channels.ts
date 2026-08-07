// channels.ts — content for Memory / "Where it all comes from".
//
// The graph is fed by eight doors, and the interesting fact about them is that they are not
// peers: they differ in who authored the words, in whether the knowledge is pushed at the
// system or pulled by it, and in what one item costs. Those three differences are what the
// instrument on that page lets you compare.
//
// Grades below mirror the default source reliability table in the real scorer
// ($lib/jkai/intel/trust.ts, SOURCE_DEFAULT_GRADE). They are copied rather than imported —
// same rule as lib/memory.ts, which re-declares the matching ladder: a public page must not
// couple to an internal module. A drift is then a visible diff, not a silent one.
//
// Counted from source on 7 August 2026.

export type Arrival = 'pushed' | 'pulled' | 'derived';

export interface Channel {
  id: string;
  label: string;
  /** Who actually wrote the words — the question the grade answers. */
  author: string;
  arrival: Arrival;
  /** Default source reliability, A–F. 'F' is the absence of a judgement, not the bottom. */
  grade: 'A' | 'B' | 'C' | 'D' | 'E' | 'F';
  /** What one item costs to take in. */
  cost: string;
  /** Why it is graded where it is. */
  why: string;
}

/**
 * Ordered by grade, best first, then by how much of the graph they actually feed.
 * The last one is the newest and is deliberately ungraded — see UNGRADED below.
 */
export const CHANNELS: Channel[] = [
  {
    id: 'capture', label: 'Capture', author: 'You, typing or dictating a first-hand observation',
    arrival: 'pushed', grade: 'A', cost: 'one extraction call per note',
    why: 'First-party by definition. The claim can still be wrong — that is what the other axis is for — but nobody is between you and the record.',
  },
  {
    id: 'messaging', label: 'Messaging', author: 'You again, from a phone with nothing installed',
    arrival: 'pushed', grade: 'A', cost: 'one extraction call per note',
    why: 'The same authorship as capture, over a different pipe. Grading by pipe rather than by author would score the same sentence two ways.',
  },
  {
    id: 'documents', label: 'Documents', author: 'A third party, in a file you chose to keep',
    arrival: 'pushed', grade: 'B', cost: 'free when unchanged — the bytes are hashed first',
    why: 'Curated by you, written by someone else. The curation is real evidence and the authorship is not yours, so it sits one step below first-hand.',
  },
  {
    id: 'mail', label: 'Mail', author: 'A named correspondent whose address is verifiable',
    arrival: 'pulled', grade: 'B', cost: 'headers free, bodies budgeted',
    why: 'Identity is close to provable from the header. What they assert in the body is still their claim, not an observation.',
  },
  {
    id: 'research', label: 'Research', author: 'The research pipeline, over several web sources',
    arrival: 'pulled', grade: 'B', cost: 'one extraction call per finished run',
    why: 'Better than a raw page because it has already cross-checked. Still machine-summarised, so it cannot outrank a document somebody chose to keep.',
  },
  {
    id: 'web', label: 'The web', author: 'One fetched page of unknown provenance',
    arrival: 'pulled', grade: 'C', cost: 'one extraction call per page',
    why: 'The page may be excellent. Nothing about the fetch establishes that, and a grade records what is established.',
  },
  {
    id: 'automation', label: 'Automation', author: 'A pipeline, with nobody in the loop',
    arrival: 'derived', grade: 'C', cost: 'one extraction call per item written',
    why: 'Same as the web, for a different reason: the absence of a human is the thing being graded, not the quality of the pipeline.',
  },
  {
    id: 'conversation', label: 'Conversation', author: 'A thread with the assistant, re-read as it grows',
    arrival: 'derived', grade: 'F', cost: 'one call per turn early, thinning out later',
    why: 'The newest door, and the grading table has never been given an entry for it — so it scores neutrally rather than badly. That is the correct default and it is also a gap.',
  },
];

/** Stated on the page, because an unassessed source scoring neutrally is the whole design. */
export const UNGRADED = {
  title: 'The newest channel is ungraded, and that is not a bug',
  body:
    'A source the grading table has no entry for falls to F — which is “cannot be judged”, the absence of a verdict, not the bottom of the scale. It contributes the neutral midpoint, so a conversation-derived claim is neither helped nor punished for arriving through a door nobody has assessed yet.',
} as const;

/**
 * The extraction cadence for a conversation. Mirrors chat-extract's ramp.
 *
 * The number that matters is the median: production threads run three to five real assistant
 * turns, and the previous cadence — turn 2, then every fourth — was therefore a near-total
 * loss. Most threads extracted exactly once and everything said afterwards never reached the
 * graph at all.
 */
export const CADENCE = {
  denseUntil: 8,
  midUntil: 24,
  midEvery: 3,
  lateEvery: 6,
  medianTurns: '3–5',
  oldCost: 60,
  newCost: 18,
  marathon: 60,
} as const;

// ---------------------------------------------------------------------------
// The mail sweep — the channel where the two halves are visible
// ---------------------------------------------------------------------------

/** Everything the nightly rolling sweep is bounded by. All from the real constants. */
export const SWEEP = {
  /** Rolling window, in days. Twelve weeks. */
  windowDays: 84,
  /** Threads one run may LIST. Listing is ids and headers, so it is cheap. */
  maxThreads: 2000,
  /** Threads whose BODY one run will pay a model to read. */
  extractBudget: 150,
  /** Gmail's own page size for the listing call. */
  pageSize: 100,
  /** Messages per thread beyond which repetition, not information, is being added. */
  maxMessages: 40,
  /** Participants before a thread is treated as a broadcast rather than a conversation. */
  maxParticipants: 25,
  /** Characters kept per message before the note is capped again downstream. */
  maxMessageChars: 4000,
} as const;

export const HALVES = [
  {
    id: 'structural', label: 'From the headers',
    what: 'Who wrote to whom, and when. Participants become people; every from-to pair becomes a correspondence edge.',
    cost: 'free',
    confidence: 'asserted high',
    why: 'A from-header is machine-written provenance. It is the more trustworthy half and the cheaper half at the same time, which almost never happens, so it runs for every thread regardless of budget.',
  },
  {
    id: 'semantic', label: 'From the bodies',
    what: 'What the conversation was about: entities, relationships and dates, read by a model.',
    cost: 'one model call per thread',
    confidence: 'a reading, not a record',
    why: 'Only as good as its input, and raw mail is terrible input — a five-message thread carries the same paragraph five times inside nested quoting. The body is cut at the first quote boundary so only new text survives.',
  },
] as const;

export const QUOTE_TRAP = {
  title: 'Re-reading a quote chain inflates the evidence',
  body:
    'A twelve-deep reply chain fed in whole looks like twelve independent assertions of the same fact. Corroboration is the heaviest term in the confidence score, so the effect is not a bigger bill — it is a graph that believes one observation twelve times.',
} as const;

// ---------------------------------------------------------------------------
// Staleness — what a rolling window does to the shape of the graph
// ---------------------------------------------------------------------------

/**
 * Decay on evidence weight. Exponential to a floor, never a cliff at the window edge — a
 * cliff makes the whole graph lurch every night as threads age out.
 */
export const DECAY = {
  halfLifeDays: 42,
  floor: 0.15,
  /** How much of a weight is exposed to age. The rest is earned by corroboration and stays. */
  pull: 0.5,
} as const;

/** weight × (1 − pull + pull × recency), with recency floored. Mirrors decayWeight(). */
export function decayed(weight: number, ageDays: number): number {
  const recency = Math.max(DECAY.floor, Math.min(1, Math.pow(0.5, ageDays / DECAY.halfLifeDays)));
  return weight * (1 - DECAY.pull + DECAY.pull * recency);
}

export const DECAY_NOTE = {
  title: 'Why the decay is partial',
  body:
    'Multiplying a weight by a floor-level recency would make a ten-times-corroborated relationship from May weaker than one passing mention this morning. Half the weight is earned by corroboration and the calendar cannot take it away; only the other half is exposed to age.',
} as const;

/** The one line the whole page turns on. */
export const CHANNEL_LESSON = {
  title: 'A source is not a pipe',
  body:
    'The grade answers “who wrote this”, never “how did it arrive”. Two of the eight channels carry words you wrote yourself and are graded identically for that reason, even though one is a note on a phone and the other is a message thread. Grading by transport would score the same sentence two different ways depending on which app it left.',
} as const;
