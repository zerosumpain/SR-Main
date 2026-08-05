// memory.ts — content for the Memory section: retrieval, the knowledge graph, entity
// resolution and the flexible datastore.
//
// The matching ladder below mirrors the real scoring function: a primary name/address
// signal sets a base confidence, then structural and semantic corroboration adjust it, and
// 0.85 is the bar for an automatic merge. Worked examples are neutral stand-ins — the real
// ones in the source are actual people and are not reproduced here.

export const AUTO_MERGE = 0.85;
export const MIN_SHARED_NEIGHBOURS = 2;

export interface Signal {
  id: string;
  label: string;
  base: number | null;      // sets confidence outright (primary signals)
  delta?: number;           // adjusts it (corroborating signals)
  cap?: number;
  kind: 'primary' | 'corroborating' | 'negative';
  what: string;
  why: string;
}

/** Primary signals are mutually exclusive — the strongest that applies wins. */
export const SIGNALS: Signal[] = [
  {
    id: 'same_email', label: 'Same address', base: 0.98, kind: 'primary',
    what: 'Both records carry the same email address, and that address provably belongs to one identity.',
    why: 'An address IS an identity claim, so this outranks every name rule. It is also the one signal comparing display names can never reach — two names that look nothing alike can be provably one person.',
  },
  {
    id: 'identical_name', label: 'Identical name', base: 0.97, kind: 'primary',
    what: 'The normalised names are character-for-character the same.',
    why: 'Strong, but never quite as strong as an address: two real people do share a name.',
  },
  {
    id: 'canonical_name', label: 'Same name, different packaging', base: 0.93, kind: 'primary',
    what: 'A filename, a slug with its namespace, a company with its legal suffix — the same name wearing a different wrapper.',
    why: 'Scored just below identical, because the packaging was the only thing that differed.',
  },
  {
    id: 'name_reordering', label: 'Name reordered', base: 0.93, kind: 'primary',
    what: '“Patel, Anita” against “Anita Patel”.',
    why: 'Mail headers produce the reversed form constantly, so this is common rather than exotic.',
  },
  {
    id: 'acronym', label: 'Acronym pair', base: 0.9, kind: 'primary',
    what: 'An initialism against the phrase it stands for.',
    why: 'Reliable when it fires, and it fires often in a corpus full of organisations.',
  },
  {
    id: 'initial_expansion', label: 'Initial expanded', base: 0.7, kind: 'primary',
    what: '“A. Patel” against “Anita Patel”.',
    why: 'Deliberately well below the bar. It is suggestive, and there are a lot of A. Patels.',
  },
  {
    id: 'token_subset', label: 'One name contains the other', base: 0.55, kind: 'primary',
    what: 'Every word of one name appears in the other.',
    why: 'The weakest signal in the set, and the one that most often looks convincing and is wrong.',
  },
  {
    id: 'shared_neighbours', label: 'Shared connections', base: null, delta: 0.15, cap: 0.95, kind: 'corroborating',
    what: `The two records already share at least ${MIN_SHARED_NEIGHBOURS} connections in the graph.`,
    why: 'Evidence neither the names nor the embeddings can reach. “Card ending 4021” and “Card *4021” read as barely half similar, and share four neighbours. One shared neighbour would be meaningless in a graph this dense — two is the floor.',
  },
  {
    id: 'semantic', label: 'Semantically similar', base: null, delta: 0.2, cap: 0.95, kind: 'corroborating',
    what: 'The two records’ embeddings sit close together in meaning-space.',
    why: 'Only corroborates something else; on its own it needs to be far more certain before it counts, because “similar” and “the same” are different claims.',
  },
  {
    id: 'conflicting_email', label: 'Different addresses', base: null, kind: 'negative',
    what: 'Both records carry an address, and the addresses differ.',
    why: 'Positive evidence they are NOT the same, strong enough to overrule name similarity. Held just below the bar rather than dropped — it may still be one person with two addresses, but that is a human’s decision.',
  },
];

/** Worked pairs the ladder is designed around. Names are neutral stand-ins. */
export const PAIRS = [
  {
    id: 'cards', a: 'Card ending 4021', b: 'Card *4021',
    on: ['token_subset', 'shared_neighbours'],
    story: 'The names read as barely half similar and no name rule fires strongly. Four shared connections settle it.',
  },
  {
    id: 'church', a: 'Church of England', b: 'Free Church of England',
    on: ['token_subset'],
    story: 'Every word of the first appears in the second, so the weakest signal fires — and they share no connections. Two genuinely different organisations, correctly kept apart.',
  },
  {
    id: 'person', a: 'A. Patel', b: 'Anita Patel (Finance)',
    on: ['same_email'],
    story: 'The names look unalike and every name rule is weak. The shared address settles it on its own.',
  },
  {
    id: 'twins', a: 'Sam Okafor', b: 'Sam Okafor',
    on: ['identical_name', 'conflicting_email'],
    story: 'Identical names — and two different addresses. Two real people. Held below the bar for a human to look at rather than merged or discarded.',
  },
];

export const RETRIEVAL = [
  { k: 'Chunk size', v: '1,000 chars', why: 'With a 150-character overlap, and the split nudged backwards to a sentence boundary — so a fact is not severed mid-clause and lost to both chunks.' },
  { k: 'Two indexes, on purpose', v: '3,072 and 1,536 dims', why: 'A per-collection index for “chat with these documents” uses the larger, more expensive embedding; the always-on index behind file mentions uses the smaller one. Different jobs, different budgets.' },
  { k: 'How many passages', v: '10, or 8', why: 'Ten for a dedicated collection, eight by default for an in-chat mention. Both discard anything below a minimum similarity rather than padding the list out.' },
  { k: 'Where the index lives', v: 'In the database', why: 'No second store to keep in sync, no separate service to be down on its own.' },
  { k: 'What is retrieved', v: 'Passages with provenance', why: 'Each passage arrives carrying where it came from, so a claim can be traced back rather than asserted.' },
  { k: 'Who may see it', v: 'Filtered before assembly', why: 'Retrieval is scoped to what the requester is allowed to read, before anything reaches a prompt.' },
];

export const DATASTORE = [
  { k: 'Collections + records', why: 'Schema-free storage for the long tail of things not worth a migration and a typed table.' },
  { k: 'Row-level permissions', why: 'Who may read or write is a property of the row, not of the endpoint that happens to reach it.' },
  { k: 'A query language', why: 'So a workflow node and an agent tool can both express a filter without either learning SQL.' },
  { k: 'An audit trail', why: 'Every write is attributable. In a system where a machine writes at 3am, “who did this” must have an answer.' },
  { k: 'Expiry', why: 'Records can be given a lifetime, so scratch data does not become permanent by neglect.' },
  { k: 'Three surfaces, one store', why: 'A workflow node, an agent toolset and an admin interface — all reading and writing the same thing.' },
];

export const GRAPH_FACTS = [
  {
    title: 'Caching bought accuracy, not speed',
    body: 'Ranking the most connected entities exactly took 40 seconds. Rewriting the data structure — not the algorithm — brought it to 1.7, with results identical bit for bit. Then a sampled approximation was measured too: 0.25 seconds, but it moved eight of the top fifty and dropped rank correlation to 0.92. It was rejected, and the exact result is cached for a minute instead.',
    lesson: 'The usual framing is that caching hides slowness. Here it made an exact algorithm affordable, so the dashboard could keep telling the truth rather than an estimate. Note the order too: the twenty-four-fold win came from how the data was laid out, before anyone considered giving up precision.',
  },
  {
    title: 'A blast radius, not a rate limit',
    body: 'The nightly pass will merge at most twenty-five pairs. That cap is not there for performance — it is there so that a bad night is twenty-five reversible mistakes rather than four hundred. Every merge is reversible, and reversing them is a routine operation rather than a recovery procedure.',
    lesson: 'When an automated process changes data, the useful question is not “how fast can it go” but “how much can it get wrong before someone looks”. Those are different numbers and only one of them matters at 4am.',
  },
  {
    title: 'A stale result must not install itself',
    body: 'The analysis is computed in the background and shared between concurrent callers. That has a race: a write lands while a computation is mid-flight, the computation finishes, and it writes a snapshot that predates the change. A generation counter is taken at the start and checked before storing.',
    lesson: 'Without it, a merge landing at the wrong moment silently vanishes from the dashboard for a minute — which reads as data corruption rather than as a cache being a cache.',
  },
  {
    title: 'The clock you record is not the clock you mean',
    body: 'A row’s creation timestamp records when the sweep that found it ran, not when the thing it describes happened. The evidence was stark: over a thousand notes shared a single ingest day, against thirty-four distinct days on which the things themselves had actually occurred. A timeline built on the first column is a history in which almost everything happened at once.',
    lesson: 'Any ingested record needs the observation time as a field distinct from the ingestion time, and the difference has to be visible — or the two silently collapse into an answer that is wrong and looks fine.',
  },
  {
    title: 'A scale where everything looked the same',
    body: 'Relationship strength was drawn from a bucketed category rather than the underlying weight. Ninety-six per cent of edges — four and a half thousand of them — landed in the same middle bucket and rendered at an identical width. The picture was technically correct and carried almost no information.',
    lesson: 'A visual encoding derived from a coarse category will collapse. Read the continuous value and bucket it for display if you must, but never let the bucket be the only thing you kept.',
  },
];
