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

/** The ranking arithmetic — the live constants, read from the relevance module. */
export const RELEVANCE = {
  neutralPrior: 0.5,
  outcomeFloor: 0.02,
  recencyFloor: 0.35,
  halfLifeDays: 120,
  staleWeight: 0.35,
  evidenceHalfWeight: 10,
  evidenceMaturity: 25,
  z: 1.96,
} as const;

/** The feedback loop: what one helpful build is worth, measured. */
export const FEEDBACK = {
  wilsonOneWin: 0.21,
  note:
    'A lesson that has helped once scores 0.21 on the confidence interval — well below the ' +
    '0.5 an unproven lesson starts at, because one success out of one is luck until proven ' +
    'otherwise. Outcome evidence only outweighs recency as observations accumulate, and the ' +
    'corpus-level readout refuses to claim outcome-based ranking below twenty-five resolved ' +
    'serves. Until then it says so: ranked by recency, too few to judge.',
} as const;

/** How a serve's worth is decided — mechanical rules, no model in the loop. */
export const RESOLUTION = [
  {
    k: 'The gate passed next',
    v: 'helpful',
    why: 'The build that was handed this context got a green gate on its next attempt. Whatever else is true, the serve preceded success.',
  },
  {
    k: 'The same error came back',
    v: 'unhelpful',
    why: 'The fingerprint that triggered the retrieval reappeared in the next gate run. Whatever was served did not address it, and the count says so.',
  },
  {
    k: 'A different error appeared',
    v: 'helpful',
    why: 'The original failure is gone even though the gate is still red — something new is failing now. That is progress, and it is what was asked for.',
  },
  {
    k: 'The build stopped',
    v: 'unresolved',
    why: 'Abandoned, provider error, no next iteration: there is no gate output to judge by, so nothing is guessed. A wrong "helpful" would be indistinguishable from a real one forever, which is why served always exceeds resolved.',
  },
] as const;

/** What the graph is physically made of. */
export const ANATOMY = [
  {
    k: 'File nodes',
    v: 'the spine',
    why: 'One node per source file the history has touched. Files persist where conversations do not — over a third of old build transcripts are already gone, and the files they edited are all still here.',
  },
  {
    k: 'Gate nodes',
    v: 'the checks',
    why: 'One node per named check a build must pass — the type-checker, the test runner, the bundler. Failures hang off the gate that caught them.',
  },
  {
    k: 'Episodes',
    v: 'fail → fix → pass',
    why: 'A verified chain: a gate failed, specific edits followed, the gate passed. Each carries the error fingerprint, the resolution and the verification, and links to every file involved.',
  },
  {
    k: 'Lessons',
    v: 'the curated notes',
    why: 'Hard-won notes written during real work — 272 files, 1.16 MB, imported verbatim, 117 of them citing specific source paths. Before the graph, no build could read a single one of them.',
  },
] as const;

/** The five kinds of edge. */
export const EDGE_KINDS = [
  { k: 'imports', why: 'this file loads that one' },
  { k: 'co_change', why: 'these files habitually change together' },
  { k: 'gated_by', why: 'this file has failed that check before' },
  { k: 'fixed_by', why: 'that edit resolved this failure' },
  { k: 'needs_context', why: 'work here has needed knowledge from there' },
] as const;

export const DEDUPE = {
  title: 'A natural key, computed server-side',
  body:
    'Every episode carries a fingerprint hashed from what it is — which repository, which ' +
    'source, which error, when, which files — computed on the server at insert. Re-running ' +
    'the full historical import twice lands on the same 83 episodes both times, and a ' +
    'nightly re-import can never duplicate the corpus or quietly resurrect something a ' +
    'person retired on purpose: the upsert never touches the retirement columns.',
} as const;

/** CGQL, as shipped: five verbs, hard caps, machine callers. */
export const CGQL = {
  grammar: [
    { k: 'seed', v: 'file: · gate: · fingerprint: · topic:"…"', why: 'Where a query starts. The first three are exact keys; topic is the one free-text door, for humans asking questions rather than builds hitting errors.' },
    { k: 'hops', v: '1 or 2', why: 'Walk outward from the seed along the edges — two at most, as a hard cap. An unbounded walk over a connected graph is the whole database.' },
    { k: 'pick', v: 'lessons · episodes · nodes', why: 'What to collect from the walked set, filterable by verdict and capped at ten per pick.' },
    { k: 'budget', v: '≤ 8,000 chars', why: 'The character ceiling on the answer, default 5,000 — the answer is destined for a prompt, and a prompt is a budget.' },
  ],
  security:
    'The language is deliberately weak: no joins, no subqueries, no arithmetic. Both callers ' +
    'are machines composing queries mechanically, and a language with more power than its ' +
    'callers use only widens what a prompt-injected string can ask for. The parser is the ' +
    'security boundary — every value reaching the database is bound, never spliced into SQL, ' +
    'and every keyword is checked against a fixed list.',
  topic:
    'Topic search is tokenised and scored — a hit in a title is worth three in a body, and ' +
    'at least half the query words must appear. The first version matched the whole phrase ' +
    'and returned silence for any query longer than one word; this codebase has now paid ' +
    'for that lesson twice, in two different search boxes.',
} as const;

/** How a raw gate failure becomes a retrieval key. Measured against 25 real sessions. */
export const FINGERPRINT = [
  {
    k: 'Strip the colour codes first',
    v: '246 → collapse',
    why: 'Test runners colour their output, and the same failure produced hundreds of "distinct" signatures depending on which invisible escape codes came along. Stripped, they collapse to a handful. Always strip before matching.',
  },
  {
    k: '“0 errors” is a pass',
    v: 'zero-cases first',
    why: 'A naive pattern read “found 0 errors” as a failure — the single most common false alarm in the first pass, thirty hits, all of them green runs. The zero-cases are now checked first, and no later pattern may resurrect a green run as a failure.',
  },
  {
    k: 'Key on the error class',
    v: 'never the command',
    why: 'Across 25 sessions and 8,647 command results, an agent re-ran a byte-identical command after a failure exactly once. Commands carry file lists that change every run; error classes recur constantly. So the class is the key.',
  },
] as const;

/** Proven end-to-end on two instrumented builds, 17 August 2026. */
export const PROOF = {
  body:
    'Two real builds were run to give the loop data. The first was served 4,987 characters ' +
    'keyed on its two files, completed in a single iteration with a green gate — and recorded ' +
    'nothing, which exposed a design gap: outcomes were only resolved when a next iteration ' +
    'began, so a build that got it right first time produced no evidence at all. The loop ' +
    'learned from struggle but not from success. Resolution now also runs when a build ' +
    'completes: success counts, empty serves are skipped, and infrastructure failures are ' +
    'never blamed on the context. The second build resolved its serve as helpful.',
} as const;

/** Where the graph can be read, argued with, and told to forget. */
export const GRAPH_SURFACES = [
  { k: 'The map', why: 'The graph drawn as itself: files, gates, episodes and lessons, with the stale ones flagged.' },
  { k: 'Ask', why: 'Type a CGQL query, or a question, and see the exact block a build would be handed — the same loader, the same budget.' },
  { k: 'Review', why: 'Reading and forgetting live together: every lesson with its evidence counts, and a retire button that demands a reason.' },
  { k: 'Serves', why: 'Every serve, including the empty ones. A predecessor logged “healthy” for sixty days while delivering nothing; a metric that cannot say “empty” always will.' },
] as const;

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
