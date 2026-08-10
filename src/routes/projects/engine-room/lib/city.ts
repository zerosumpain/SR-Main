// city.ts — the content model for the isometric set piece on the index.
//
// The band map answers "what is in here". It is accurate and it is a diagram, and a
// diagram asks the reader to do the animating in their own head. This does it for them:
// one message, walked through the machine as a journey across a small town, with the
// bill ticking up in the corner.
//
// Everything here is prose and geometry only. Every FIGURE the scene quotes traces back
// to the same measured constants the rest of the study uses (tools.ts, models.ts), so the
// set piece can never drift away from the pages that prove it.

/** A building on the isometric grid. Footprint in tiles, height in projected pixels. */
export interface Block {
  id: string;
  label: string;
  /** One line, shown when the message is inside it. */
  what: string;
  gx: number;
  gy: number;
  w: number;
  d: number;
  h: number;
  /** Roof colour. Walls are derived from it. */
  tone: string;
  /** The chapter this building belongs to, so a click can open it. */
  section?: string;
}

/**
 * Six buildings on a 9×7 plot. Laid out so the message's route reads left to right along
 * the front, up to the tower, and back — never crossing itself, which is the whole reason
 * the plot is this shape.
 */
export const BLOCKS: Block[] = [
  {
    id: 'surface', label: 'The front desk', gx: 0, gy: 0, w: 1.5, d: 1.5, h: 30,
    what: 'Where you type. Thin on purpose — it holds no cleverness the other doors lack.',
    tone: '#0e5b66', section: 'turn/stream',
  },
  {
    id: 'agent', label: 'The runtime', gx: 3.4, gy: 0, w: 1.7, d: 1.7, h: 68,
    what: 'Picks up the turn, decides what to send, dispatches the tools, streams the answer back.',
    tone: '#c2703d', section: 'turn/trace',
  },
  {
    id: 'gateway', label: 'The tower', gx: 6.9, gy: 0, w: 1.6, d: 1.6, h: 100,
    what: 'One doorway to every model. Also, knowingly, the single point of failure.',
    tone: '#8a2d3a', section: 'turn/routing',
  },
  {
    id: 'ground', label: 'The works', gx: 0, gy: 3.5, w: 1.5, d: 1.5, h: 18,
    what: 'Power, plumbing, the nightly van to the off-site store. Nobody photographs this one.',
    tone: '#5a6b7a', section: 'ground/estate',
  },
  {
    id: 'memory', label: 'The archive', gx: 3.4, gy: 3.5, w: 1.7, d: 1.7, h: 42,
    what: 'One database with everything in it. The runtime calls here before it calls anywhere else.',
    tone: '#5f7d4f', section: 'memory/retrieval',
  },
  {
    id: 'world', label: 'The outside', gx: 6.9, gy: 3.5, w: 1.6, d: 1.6, h: 26,
    what: 'Mail, the house, the web, the wearables. Everything it can read or reach out and prod.',
    tone: '#7a6a4f', section: 'reach/tools',
  },
];

/**
 * The street plan, named rather than derived. An earlier version inferred a road wherever
 * two centres happened to share an axis, which is a rule that quietly stops being true the
 * moment a footprint changes size — and it did.
 */
export const ROADS: Array<[string, string]> = [
  ['surface', 'agent'],
  ['agent', 'gateway'],
  ['surface', 'ground'],
  ['agent', 'memory'],
  ['gateway', 'world'],
  ['ground', 'memory'],
  ['memory', 'world'],
];

/**
 * One leg of the journey. `to` is a block id; the caption is what is happening while the
 * message is in transit toward it.
 *
 * `cost` is the running bill in pennies AFTER this leg, so the meter only ever moves when
 * something has actually been paid for. The two paid legs are the ones that reach the
 * tower — everything else in this system is free, which is the point the meter is making.
 */
export interface Leg {
  to: string;
  /** Shown while travelling. Present tense, one clause. */
  caption: string;
  /** Milliseconds this leg takes on screen. Roughly proportional to the real thing. */
  ms: number;
  /** Running total in pennies. */
  cost: number;
}

export const ROUTE: Leg[] = [
  { to: 'surface', caption: 'You press send.', ms: 700, cost: 0 },
  { to: 'agent', caption: 'The runtime picks up the turn.', ms: 900, cost: 0 },
  { to: 'memory', caption: 'It fetches what it already knows — free, and next door.', ms: 1000, cost: 0 },
  { to: 'agent', caption: 'Back with an armful of context.', ms: 900, cost: 0 },
  { to: 'world', caption: 'A tool call, out to the world and back.', ms: 1200, cost: 0 },
  { to: 'agent', caption: 'Everything is now bundled into one enormous prompt.', ms: 900, cost: 0 },
  { to: 'gateway', caption: 'Up to the tower. This is the part with a meter on it.', ms: 1300, cost: 0.09 },
  { to: 'agent', caption: 'The answer comes back in pieces, and is reassembled.', ms: 1100, cost: 0.14 },
  { to: 'surface', caption: 'On your screen. Four and a bit seconds, most of it up the tower.', ms: 900, cost: 0.14 },
];

/** The closing line, shown once the run finishes. */
export const VERDICT = {
  head: 'Nearly all of that was carrying, not thinking.',
  body:
    'Five of the nine legs are free and happen inside the building. The two that cost anything are the two that leave it. That ratio is the whole reason this thing is affordable to run, and it is why the interesting engineering is in what gets sent — not in how fast the code goes.',
  section: 'turn/cost',
};

/**
 * The same town at half past three in the morning, with nobody in it.
 *
 * Reuses the geometry deliberately: the point being made is that the night shift is not a
 * separate machine bolted on the side, it is the same buildings doing something else while
 * the lights are off. The last leg is the one that matters — it goes OUT, to a draft pull
 * request, because there is no route from here into production that does not pass a human.
 */
export const NIGHT_ROUTE: Leg[] = [
  { to: 'ground', caption: '03:30. The lights are off and the night shift clocks on.', ms: 900, cost: 0 },
  { to: 'archive-read', caption: 'It reads back every question it answered badly today.', ms: 1200, cost: 0 },
  { to: 'agent', caption: 'And writes a tool to do better next time.', ms: 1200, cost: 0 },
  { to: 'works-test', caption: 'Into the sandbox: a scan for anything it must not contain, then every smoke case.', ms: 1400, cost: 0 },
  { to: 'agent2', caption: 'It passed. Registered live, no restart, nobody asked.', ms: 1000, cost: 0 },
  { to: 'world-pr', caption: 'The bigger idea it had is too large to install itself — so it raises a draft.', ms: 1300, cost: 0 },
  { to: 'surface-wait', caption: 'And there it stops, waiting for someone to wake up and read it.', ms: 1100, cost: 0 },
];

/** Aliases so the night route can revisit a building without repeating an id. */
export const NIGHT_ALIAS: Record<string, string> = {
  'archive-read': 'memory',
  'works-test': 'ground',
  agent2: 'agent',
  'world-pr': 'world',
  'surface-wait': 'surface',
};

export const NIGHT_VERDICT = {
  head: 'It can write the code. It cannot ship it.',
  body:
    'Small self-contained tools it installs on its own, after a static scan and a smoke test in which every case must pass. Anything larger becomes a draft pull request with my name on the approval. There is no code path by which it merges one — I have gone looking for it more than once, which is either diligence or a lack of trust in my own work.',
  section: 'change/nights',
};
