// Durable identity for a detected community.
//
// Louvain returns a partition, not a roster. `community.ts` renumbers so the
// largest community is index 0, which makes the index a SIZE RANK and not an
// identity — and on the live graph that rank churns violently. Measured on
// production (2026-08-14, 9,042 entities / 10,368 edges): one day of ordinary
// ingest moved 70.6% of connected entities to a different community index, and
// ten of the top twelve clusters changed index. So an index is worth nothing
// tomorrow. Anything hung on one — a name, a colour, a saved lens, a URL — is
// hung on a different set of entities by morning.
//
// What DOES survive is membership. Matched by overlap, the top clusters map onto
// their previous-day selves at a Jaccard of 0.83–1.00. That gap between "the
// index is noise" and "the body is stable" is the whole reason this module
// exists: it recovers the identity the numbering throws away.
//
// This is the same move `insight-store.ts` makes for findings — an ephemeral
// computed thing gets an identity that survives recomputation, and a judgement
// the user made about it (there, a dismissal; here, a name) is never silently
// overwritten by the next run.
//
// PURE — no clock, no DB, no randomness. `now` and `mintKey` are injected so the
// matching is exhaustively testable and two runs over the same input agree.

/**
 * How much overlap makes two clusters the SAME cluster.
 *
 * 0.35 sits well below the 0.83 a real cluster scores against its previous-day
 * self, and well above the ~0.1 two genuinely different clusters reach by
 * sharing a few popular entities. Being generous here is the safer error: the
 * cost of a missed match is a cluster losing its name, the cost of a false match
 * is a name landing on the wrong body — and the first is visible while the
 * second is not.
 */
export const MATCH_THRESHOLD = 0.35;

/**
 * Overlap below which a new cluster is not even recorded as having split from
 * anything. Above it but below MATCH_THRESHOLD means "this came out of that" —
 * the case where one cluster genuinely breaks in two.
 */
export const SPLIT_THRESHOLD = 0.15;

/**
 * Communities smaller than this are not tracked at all.
 *
 * Matches MIN_MEANINGFUL_SIZE in community.ts. The production graph detects
 * ~2,900 communities of which 2,632 are single isolated entities; minting a
 * durable record for each would fill the roster with 2,632 things that are not
 * clusters and cannot be described.
 */
export const MIN_TRACKED_SIZE = 5;

/** Palette slots available; mirrors CLUSTER_COLOURS in components/intel/graph-visual. */
const COLOUR_SLOTS = 10;

/** How many changed ids are kept. Enough to list; not enough to bloat a record. */
export const DELTA_SAMPLE = 25;

export interface ClusterDelta {
  /** Up to DELTA_SAMPLE entity ids that arrived. */
  joined: string[];
  /** Up to DELTA_SAMPLE entity ids that left. */
  left: string[];
  joinedCount: number;
  leftCount: number;
  at: string;
}

export interface StoredCluster {
  key: string;
  /** User-set name. Null means "show the generated label". */
  name: string | null;
  /** Regenerated on every reconcile. Always present. */
  autoLabel: string;
  /** Palette slot, assigned at first sight and kept for life. */
  colourIndex: number;
  members: string[];
  size: number;
  firstSeenAt: string;
  lastSeenAt: string;
  narrative: string | null;
  narrativeAt: string | null;
  /** The member fingerprint the narrative was written against. */
  narrativeFingerprint: string | null;
  /** Keys this cluster absorbed at the last reconcile. */
  mergedFrom: string[];
  /** Key this cluster broke away from, if it did. */
  splitFrom: string | null;
  /** False once a reconcile no longer finds it. The record is kept regardless. */
  live: boolean;
  /**
   * What changed at the last reconcile that moved this cluster.
   *
   * Computed here because this is the only place both member lists exist at
   * once. Storing the ids rather than a bare count is what lets the card say
   * WHICH entities arrived, which is the version of "what changed" worth
   * reading; the counts are kept separately because the id lists are capped and
   * would otherwise understate a large intake.
   *
   * Null until the cluster moves, and left alone by a reconcile that changes
   * nothing — so "nothing joined this run" and "nothing has ever joined" stay
   * distinguishable, and a quiet run does not erase yesterday's intake.
   */
  delta: ClusterDelta | null;
  /** When the user last named this cluster. Null while it is unnamed. */
  namedAt: string | null;
  /**
   * The membership at the moment the user named it.
   *
   * Kept because matching is CHAINED, and a chain of individually reasonable
   * matches can walk a cluster a long way from what it was. Replaying a real
   * week of production ingest through this module: six clusters were named on
   * day −7 and all six still held their key on day 0, but two of them had drifted
   * to a 0.19 and a 0.30 overlap with the body they were named on — one of them
   * had become a cluster the labeller now calls something else entirely. Every
   * individual day's match was well above threshold; the drift accumulated.
   *
   * Tightening the threshold is the wrong fix — the cluster would simply lose
   * its key and its name, which is worse. So the drift is measured and shown
   * instead, and the user decides whether the name still fits.
   *
   * Only populated for clusters the user actually renamed, so this costs a few
   * member lists rather than one per cluster. Null means "never named".
   */
  namedMembers: string[] | null;
}

export interface ReconcileInput {
  /** community index → member entity ids, straight from CommunityResult. */
  detected: Map<number, string[]>;
  stored: StoredCluster[];
  labelFor: (memberIds: string[]) => string;
  mintKey: () => string;
  /** ISO instant for this reconcile. */
  now: string;
}

export interface ReconcileChanges {
  created: string[];
  matched: string[];
  retired: string[];
  /** Keys that absorbed at least one other cluster. */
  merged: string[];
  /** Newly created keys that came out of an existing cluster. */
  split: string[];
}

export interface ReconcileResult {
  clusters: StoredCluster[];
  /** Detected community index → stable key. Absent for untracked fragments. */
  keyByIndex: Map<number, string>;
  changes: ReconcileChanges;
}

/**
 * Order-independent fingerprint of a member set.
 *
 * Cheap FNV-1a over the sorted ids rather than a crypto hash: this runs on every
 * reconcile over a few hundred clusters, it is compared for equality and never
 * for secrecy, and keeping it dependency-free lets the module stay pure.
 */
export function fingerprint(memberIds: readonly string[]): string {
  let hash = 0x811c9dc5;
  for (const id of [...memberIds].sort()) {
    for (let i = 0; i < id.length; i++) {
      hash ^= id.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    hash ^= 0x2c; // separator, so ['ab','c'] and ['a','bc'] differ
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * How far a cluster has moved from the body its name was typed on, 0..1.
 *
 * 0 means it is still exactly what was named; 1 means nothing in common. Null
 * for a cluster nobody has named, where the question does not arise.
 */
export function nameDrift(cluster: Pick<StoredCluster, 'name' | 'namedMembers' | 'members'>): number | null {
  if (!cluster.name || !cluster.namedMembers?.length) return null;
  return 1 - jaccard(new Set(cluster.namedMembers), cluster.members);
}

/**
 * Above this, a name is worth querying rather than trusting.
 *
 * Set from the replay: over a real week the two clusters that had genuinely
 * become something else landed at 0.70 and 0.81 drift, while the two that were
 * still plainly themselves sat at 0.08 and 0.18. Nothing real fell in between,
 * so the boundary is drawn in the gap rather than at a round number.
 */
export const NAME_DRIFT_WARNING = 0.5;

/** Intersection over union. Two empty sets score 0, not NaN. */
export function jaccard(a: ReadonlySet<string>, b: readonly string[]): number {
  if (!a.size && !b.length) return 0;
  let intersection = 0;
  const seen = new Set<string>();
  for (const id of b) {
    if (seen.has(id)) continue;
    seen.add(id);
    if (a.has(id)) intersection++;
  }
  const union = a.size + seen.size - intersection;
  return union ? intersection / union : 0;
}

/**
 * Match this run's communities onto the stored roster, one to one.
 *
 * Greedy by descending overlap. That ordering is what makes the result
 * independent of the order either list arrives in, and it is what settles the
 * awkward cases: when two stored clusters both want the same detected one, the
 * better overlap takes the key and the loser is retired into the winner's
 * `mergedFrom` — which is the honest description of what happened to the graph.
 *
 * Retired clusters are kept, never deleted. A cluster that goes quiet for a
 * fortnight and comes back should come back with its name on it, and a name the
 * user typed is not something to throw away because a sweep could not find its
 * subject this evening.
 */
export function reconcileClusters(input: ReconcileInput): ReconcileResult {
  const { detected, stored, labelFor, mintKey, now } = input;

  const tracked = [...detected.entries()]
    .filter(([, members]) => members.length >= MIN_TRACKED_SIZE)
    // Largest first, so when two candidates tie on overlap the bigger body wins
    // the key — the deterministic tiebreak that keeps this order-independent.
    .sort((a, b) => b[1].length - a[1].length || a[0] - b[0]);

  const byKey = new Map(stored.map((c) => [c.key, { ...c, mergedFrom: [...c.mergedFrom] }]));

  // Every (stored, detected) pair worth considering, best overlap first.
  const pairs: Array<{ key: string; index: number; score: number }> = [];
  for (const candidate of byKey.values()) {
    const members = new Set(candidate.members);
    for (const [index, detectedMembers] of tracked) {
      const score = jaccard(members, detectedMembers);
      if (score >= SPLIT_THRESHOLD) pairs.push({ key: candidate.key, index, score });
    }
  }
  pairs.sort((a, b) => b.score - a.score || a.key.localeCompare(b.key) || a.index - b.index);

  const keyForIndex = new Map<number, string>();
  const indexForKey = new Map<string, number>();
  /** Stored clusters that wanted a detected cluster someone else took. */
  const losers = new Map<number, string[]>();

  for (const pair of pairs) {
    if (indexForKey.has(pair.key)) continue;
    if (keyForIndex.has(pair.index)) {
      // Someone with a better overlap already claimed this body. Only a
      // would-be MATCH counts as a merge; a mere split-level overlap does not
      // mean this cluster was absorbed.
      if (pair.score >= MATCH_THRESHOLD) {
        const list = losers.get(pair.index);
        if (list) list.push(pair.key);
        else losers.set(pair.index, [pair.key]);
      }
      continue;
    }
    if (pair.score < MATCH_THRESHOLD) continue;
    keyForIndex.set(pair.index, pair.key);
    indexForKey.set(pair.key, pair.index);
  }

  // A key filed as a loser can still go on to win a body of its own.
  //
  // `indexForKey` cannot prevent that while the pairing runs: it is only set
  // when a key CLAIMS a body, so at the moment a key loses one, the claim it
  // will make on another has not happened yet. The pass below is where both
  // facts are finally known, and a cluster that is about to be the identity of
  // some other community was plainly not absorbed by this one.
  //
  // Left in, it broke the whole roster rather than merely mislabelling it. The
  // winner retires each of its losers and drops them from `byKey`, so a key
  // retired here and matched later read as `undefined` when its own community
  // came round — production, 2026-08-29: recalculation 500'd on
  // `Cannot read properties of undefined (reading 'members')` and every surface
  // that reads the roster had been failing with it for three days.
  for (const [index, keys] of [...losers]) {
    const absorbed = keys.filter((key) => !indexForKey.has(key));
    if (absorbed.length === keys.length) continue;
    if (absorbed.length) losers.set(index, absorbed);
    else losers.delete(index);
  }

  const changes: ReconcileChanges = {
    created: [],
    matched: [],
    retired: [],
    merged: [],
    split: [],
  };

  const usedColours = new Set<number>();
  for (const [index] of tracked) {
    const key = keyForIndex.get(index);
    if (key) usedColours.add(byKey.get(key)!.colourIndex);
  }
  let colourFallback = 0;
  const nextColour = (): number => {
    for (let slot = 0; slot < COLOUR_SLOTS; slot++) {
      if (!usedColours.has(slot)) {
        usedColours.add(slot);
        return slot;
      }
    }
    // Every slot taken: cycle. Ten colours cannot uniquely name a hundred
    // clusters, and pretending otherwise would be worse than repeating one.
    return colourFallback++ % COLOUR_SLOTS;
  };

  const result: StoredCluster[] = [];
  const keyByIndex = new Map<number, string>();

  /**
   * A key no cluster already holds — including the retired ones.
   *
   * `mintKey` is injected and this module cannot assume anything about it, so
   * reusing a key that a retired cluster still carries has to be impossible
   * here rather than merely unlikely at the call site. A collision would splice
   * two unrelated clusters' histories together, and the resulting record would
   * look entirely legitimate.
   */
  const taken = new Set(stored.map((c) => c.key));
  const mintUnique = (): string => {
    for (let attempt = 0; attempt < 100; attempt++) {
      const candidate = mintKey();
      if (!taken.has(candidate)) {
        taken.add(candidate);
        return candidate;
      }
    }
    let suffix = 2;
    let candidate = `${mintKey()}-${suffix}`;
    while (taken.has(candidate)) candidate = `${mintKey()}-${++suffix}`;
    taken.add(candidate);
    return candidate;
  };

  for (const [index, members] of tracked) {
    const autoLabel = labelFor(members);
    const existingKey = keyForIndex.get(index);
    const absorbed = losers.get(index) ?? [];

    if (existingKey) {
      const previous = byKey.get(existingKey)!;
      const wasMember = new Set(previous.members);
      const isMember = new Set(members);
      const joined = members.filter((id) => !wasMember.has(id));
      const left = previous.members.filter((id) => !isMember.has(id));
      result.push({
        ...previous,
        delta:
          joined.length || left.length
            ? {
                joined: joined.slice(0, DELTA_SAMPLE),
                left: left.slice(0, DELTA_SAMPLE),
                joinedCount: joined.length,
                leftCount: left.length,
                at: now,
              }
            : previous.delta,
        // `name` is deliberately untouched — it is the user's judgement, and the
        // same protection PROTECTED_STATUSES gives a dismissed insight.
        autoLabel,
        members,
        size: members.length,
        lastSeenAt: now,
        live: true,
        mergedFrom: absorbed.length
          ? [...new Set([...previous.mergedFrom, ...absorbed])]
          : previous.mergedFrom,
      });
      keyByIndex.set(index, existingKey);
      changes.matched.push(existingKey);
      if (absorbed.length) changes.merged.push(existingKey);
      byKey.delete(existingKey);
      for (const loser of absorbed) {
        const record = byKey.get(loser);
        if (!record) continue;
        result.push({ ...record, live: false, lastSeenAt: now });
        byKey.delete(loser);
      }
      continue;
    }

    // New body. If it overlaps an existing cluster enough to be recognisable but
    // not enough to BE it, that is a split, and saying so is more useful than
    // reporting a cluster that appeared from nowhere.
    let splitFrom: string | null = null;
    let bestOverlap = SPLIT_THRESHOLD;
    for (const candidate of stored) {
      const score = jaccard(new Set(candidate.members), members);
      if (score >= bestOverlap) {
        bestOverlap = score;
        splitFrom = candidate.key;
      }
    }

    const key = mintUnique();
    result.push({
      key,
      name: null,
      autoLabel,
      colourIndex: nextColour(),
      members,
      size: members.length,
      firstSeenAt: now,
      lastSeenAt: now,
      narrative: null,
      narrativeAt: null,
      narrativeFingerprint: null,
      mergedFrom: absorbed,
      splitFrom,
      live: true,
      // A cluster that has just appeared has not changed — everything in it
      // arriving at once is what "new" means, not an intake worth reporting.
      delta: null,
      namedAt: null,
      namedMembers: null,
    });
    keyByIndex.set(index, key);
    changes.created.push(key);
    if (splitFrom) changes.split.push(key);
    for (const loser of absorbed) {
      const record = byKey.get(loser);
      if (!record) continue;
      result.push({ ...record, live: false, lastSeenAt: now });
      byKey.delete(loser);
    }
  }

  // Anything left in the roster was not found this run.
  for (const leftover of byKey.values()) {
    if (leftover.live) changes.retired.push(leftover.key);
    result.push({ ...leftover, live: false });
  }

  return { clusters: result, keyByIndex, changes };
}
