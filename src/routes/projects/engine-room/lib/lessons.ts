// lessons.ts — the build-history graph ("the build's memory"), counted 17 August 2026.
//
// Everything on change/lessons renders from this file. The counts were measured on the
// live system on that date; the worked example in DEMO uses invented stand-in paths but
// real mechanics and real measured latencies. No figure on the page may appear that is
// not in here.

/** Why the graph is keyed on code rather than on prose. */
export const KEYS_NOTE = {
  title: 'Why the key is code, not a sentence',
  body:
    'Twenty-nine per cent of my instructions to the builder are twenty-five characters or ' +
    'fewer — "crack on" carries no meaning a search-by-similarity could use. The two keys ' +
    'that do work are mechanical and cost nothing to compute: the set of files a build is ' +
    'touching, and the fingerprint of the error its last attempt just produced.',
} as const;

/** The measured facts that shaped the design. Each is one row on the page. */
export const EVIDENCE = [
  {
    k: 'Tool actions that were built-ins',
    v: '5,214 of 5,214',
    why: 'Across 280 production build iterations, the builder never once called the bespoke retrieval tool it was offered. Anything it must know has to be in the prompt, or fetchable by the one channel it demonstrably uses.',
  },
  {
    k: 'Rediscovery per iteration',
    v: '10.5 actions',
    why: 'Each build iteration spends about ten actions re-finding things earlier builds already found, reading the average file six and a half times over. That is the waste the graph exists to cut.',
  },
  {
    k: 'Files the static digest described',
    v: '60 of 3,359',
    why: 'The fixed “here is the codebase” summary covered under two per cent of the files. A static briefing cannot know which two per cent the next build will need.',
  },
  {
    k: 'Merged changes that were repairs',
    v: '17.1%',
    why: 'Roughly one merged change in six existed to fix an earlier one. “Merged” is not the same claim as “correct”, so the graph records what failed after merging too.',
  },
  {
    k: 'Build transcripts already gone',
    v: '54 of 150',
    why: 'Over a third of historical build sessions have no surviving transcript. Files persist; conversations do not — so the graph hangs its memory on files and gates, not on chats.',
  },
] as const;

/** The two delivery channels, and the one they conspicuously are not. */
export const CHANNELS = [
  {
    k: 'Push',
    v: 'into the prompt',
    why: 'Computed before the build starts, from the files in hand and the last gate error, and appended to the prompt — no model call involved. A typical serve is about 5,000 characters aimed at exactly the files being touched.',
  },
  {
    k: 'Pull',
    v: 'over the shell',
    why: 'Mid-build, the agent can query the graph through the one transport it provably uses: running a command. The bespoke tool channel it was offered went unused 5,214 times out of 5,214, so nothing important rides on it.',
  },
] as const;

/** The live corpus, measured 17 August 2026. */
export const CORPUS = {
  nodes: 1_427,
  nodesAtHead: 1_252,
  edges: 6_396,
  episodes: 83,
  lessons: 273,
  staleLessons: 3,
  dbGrowthMb: 10,
} as const;

/** Measured retrieval latency in production, same date. */
export const LATENCY = [
  { k: 'Error fingerprint', v: '3–7 ms', why: 'The hot lane. The previous failure is already sitting in the build record, so it IS the query — no model call, no search.' },
  { k: 'File set, one hop out', v: '21 ms', why: 'The files in hand, plus what connects to them.' },
  { k: 'Topic search', v: '100 ms', why: 'Words are tokenised and scored, never matched as a whole phrase — whole-phrase matching returned silence for any query over one word.' },
  { k: 'Pull from the public server', v: '96 ms', why: 'A mid-build query, round trip.' },
] as const;

/** Forgetting, and what it takes for the graph to be believed. */
export const HYGIENE = [
  {
    k: 'Retiring needs a reason',
    v: 'tombstone',
    why: 'A lesson is retired by marking it, with a written reason, reversibly. A nightly re-import can never quietly resurrect something a person forgot on purpose.',
  },
  {
    k: 'Stale is flagged, not hidden',
    v: 'ranks down',
    why: 'A lesson whose cited files have all gone from its own repository is marked and ranked down — never silently dropped. Checked against the wrong repository, 21% of citations read as dead; scoped correctly, 3 of 273 lessons actually are.',
  },
  {
    k: 'The sweep refuses to guess',
    v: 'fails shut',
    why: 'The staleness sweep checks a known-good file first. If that sentinel reads as missing, the sweep stops rather than quarantining the whole corpus on bad information.',
  },
  {
    k: 'Empty serves are counted',
    v: 'no vanity metric',
    why: 'A serve that delivered nothing is recorded as exactly that. A predecessor here logged “healthy” for sixty days while doing nothing at all, which is what a metric that cannot say “empty” will always do.',
  },
] as const;

/** The feedback loop: what one helpful build is worth, measured. */
export const FEEDBACK = {
  wilsonOneWin: 0.21,
  neutralPrior: 0.3,
  observationsToMatter: 25,
  note:
    'A lesson that has helped once scores 0.21 on the confidence interval — below the 0.30 a ' +
    'never-served lesson starts with. One success is not evidence of reliability, and the ' +
    'ranking is built to know that: outcome-based ordering only takes over after roughly ' +
    'twenty-five resolved observations. Until then, recency rules.',
} as const;

/** The number the graph exists to beat. */
export const BASELINE = {
  iterationsPerBuild: 3.85,
  last30Days: 5.14,
  failingPct: 29,
} as const;

/** A worked retrieval, offline. Paths are stand-ins; mechanics and latencies are real. */
export interface DemoHit {
  kind: 'lesson' | 'episode';
  title: string;
  note: string;
}
export interface DemoQuery {
  id: string;
  label: string;
  query: string;
  latency: string;
  what: string;
  hits: DemoHit[];
}
export const DEMO: DemoQuery[] = [
  {
    id: 'fingerprint',
    label: 'The error it just hit',
    query: 'gate: TypeError — cannot read field of undefined · send.ts:112',
    latency: '3–7 ms',
    what: 'The previous failure is already in the build record, so it is the query. Keyed on the class of error, not the exact command — identical commands almost never recur, error classes constantly do.',
    hits: [
      {
        kind: 'episode',
        title: 'Same error class, seen before: failed → two edits → passed',
        note: 'What was edited last time this class of failure cleared, served before the next attempt begins.',
      },
    ],
  },
  {
    id: 'files',
    label: 'The files in hand',
    query: 'files: chat/stream.ts, chat/send.ts · one hop out',
    latency: '21 ms',
    what: 'No error yet — the build is just starting. The file set alone is enough to pull in what previous builds learned about these exact files and their neighbours.',
    hits: [
      {
        kind: 'lesson',
        title: 'Status frames are not answer text — accumulate them separately',
        note: 'A curated note citing one of these files, written after a real failure.',
      },
      {
        kind: 'episode',
        title: 'The stream test on this file has failed before, and what fixed it',
        note: 'A verified fail → fix → pass chain touching the same file set.',
      },
    ],
  },
  {
    id: 'topic',
    label: 'A topic, in words',
    query: 'topic: "timeout"',
    latency: '100 ms',
    what: 'The slow lane, for when a human is asking rather than a build. Words are tokenised and scored individually — the first version matched whole phrases and returned silence for anything over one word.',
    hits: [
      {
        kind: 'lesson',
        title: 'The transport default of five minutes silently kills delegated work',
        note: 'Scored by how many query tokens it matches, then by outcome history.',
      },
      {
        kind: 'lesson',
        title: 'A watchdog needs a different fuse for each kind of waiting',
        note: 'Second match, lower score — fewer matching tokens.',
      },
    ],
  },
];
