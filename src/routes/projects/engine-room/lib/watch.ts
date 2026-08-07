// watch.ts — content for Memory / "Standing questions".
//
// Every other surface over the graph answers "what does this look like now". This one
// answers "what moved", which is a different question and needs a yesterday that survived a
// restart. Two design choices carry the page: every threshold is both relative AND absolute,
// and a cluster is identified by an anchor rather than by its label.
//
// Counted from source on 7 August 2026.

export interface Alarm {
  id: string;
  label: string;
  what: string;
  /** Why it is worth waking up for. */
  why: string;
}

/** The nine things a watch run can notice. One of them deliberately never alarms. */
export const ALARMS: Alarm[] = [
  { id: 'degree_jump', label: 'It gained connections', what: 'Half again as many links as last time, and at least three more in absolute terms.', why: 'Something has started happening around it that was not happening a week ago.' },
  { id: 'degree_collapse', label: 'It lost connections', what: 'Down to under two-fifths of its links, and at least three fewer.', why: 'Rated above a comparable gain on purpose: gaining links adds to the picture, losing them puts a hole in one you were already relying on.' },
  { id: 'community_move', label: 'It changed cluster', what: 'It now sits with a different group of entities than it did before.', why: 'The company something keeps is often the first thing to change and the last thing anybody notices.' },
  { id: 'new_important_neighbour', label: 'It met somebody important', what: 'A new connection to an entity in the top half of the graph by influence.', why: 'A new link to a peripheral node is noise; a new link to a hub is a development.' },
  { id: 'became_broker', label: 'It became a bridge', what: 'It moved into the top tenth for sitting between otherwise-unconnected parts of the graph.', why: 'A broker is where information has to pass through. Becoming one is a structural change, not a busier week.' },
  { id: 'ceased_broker', label: 'It stopped being a bridge', what: 'It left that top tenth.', why: 'Either the gap it spanned closed, or it stopped being the way across.' },
  { id: 'confidence_drop', label: 'The evidence weakened', what: 'Its confidence score fell by more than fifteen points.', why: 'Nothing about the entity changed; what is known about it did.' },
  { id: 'disappeared', label: 'It left the graph', what: 'It is watched and no longer present.', why: 'Usually a merge into something else. Worth saying so rather than letting it silently stop reporting.' },
  { id: 'appeared', label: 'It joined the watchlist', what: 'A baseline was recorded: how many connections it has, and whether it is currently a bridge.', why: 'The one kind that never raises an alarm — you just put it there on purpose, so telling you is noise. It is still reported, so the baseline is visible.' },
];

/** The thresholds, exactly as the real ones are written. */
export const THRESHOLDS = {
  jumpRatio: 1.5,
  jumpMin: 3,
  collapseRatio: 0.6,
  collapseMin: 3,
  importantNeighbour: 0.5,
  confidenceDrop: 0.15,
  brokerPercentile: 0.9,
  snapshotNeighbours: 8,
} as const;

export const BOTH_KINDS = {
  title: 'Every threshold is relative and absolute',
  body:
    'Relative alone fires on nothing: one connection becoming two is a hundred-per-cent jump and means less than nothing. Absolute alone never fires on a small entity and fires constantly on a hub. A change has to clear both bars to be worth a sentence at seven in the morning, and neither bar on its own is a rule anybody would keep.',
} as const;

export const ANCHOR = {
  title: 'A cluster is identified by a member, not by its number',
  body:
    'Community detection hands out arbitrary integer labels: the same grouping can come back as one, two, three today and three, one, two tomorrow. Comparing those numbers would report almost every watched entity as having changed cluster on almost every night. The snapshot stores the smallest member id of the group instead, which is stable under relabelling — so “it moved” means it genuinely moved.',
} as const;

export const SNAPSHOT = {
  title: 'A diff needs a yesterday that survived a restart',
  body:
    'A snapshot on its own says nothing about change, so the previous one is persisted and the comparison is done against it. The comparison itself takes both snapshots and has no clock and no database in it, which is what makes every alarm rule testable without any real data — an alarm nobody can test is an alarm nobody will act on.',
} as const;

// ---------------------------------------------------------------------------
// Lenses
// ---------------------------------------------------------------------------

export const LENS = {
  title: 'A perspective, written down once',
  body:
    'Every surface over the graph grew its own filter bar, which meant “the work material” had to be re-specified three times and the three did not agree. A lens is that specification saved once: a set of filters plus the standing instructions the assistant should carry while it is active, addressed by a name that fits in a link.',
} as const;

export const LENS_RULES = [
  {
    k: 'An empty lens matches everything',
    why: 'The natural way to write a filter chain — start at false, allow each match in — turns a lens with no filters into one that hides the entire graph. Starting from everything and narrowing is the shape that behaves the way a reader expects at every point in between.',
  },
  {
    k: 'A question that cannot be answered is skipped',
    why: 'An entity whose evidence was not loaded is not an entity with no evidence. Answering an unanswerable question with “no” empties the view for a reason nobody can see, so absent information skips the filter and only present-but-empty fails it.',
  },
  {
    k: 'The database does what it can, and says what it cannot',
    why: 'Cluster membership is computed, not stored, so it cannot be a condition in the query. The filter builder hands those parts back separately and flags that analysis is required, rather than pretending one query covered everything.',
  },
];

export const LENS_FILTERS = [
  { k: 'By kind', v: 'people, organisations, projects…' },
  { k: 'By where it came from', v: 'any of the eight channels' },
  { k: 'By half of a life', v: 'professional or personal' },
  { k: 'By cluster', v: 'computed, not a column' },
  { k: 'By confidence', v: 'a floor under the score' },
  { k: 'By what it says', v: 'a text match on the name' },
];

export const STANDING = {
  title: 'A filter that also changes the answer',
  body:
    'A lens carries instructions as well as conditions, so activating one both narrows what is visible and tells the assistant what to assume while it is on. The same named thing therefore means one thing to a query and a compatible thing to a conversation, instead of the two drifting apart the moment either is edited.',
} as const;

export const WATCH_LESSON = {
  title: 'The useful signal is the difference',
  body:
    'A graph tells you its shape whenever you ask. Nothing in it tells you what changed since you last looked, and that is the only part worth an interruption — which is why the whole of this is built around keeping a yesterday, and around thresholds designed to stay quiet.',
} as const;
