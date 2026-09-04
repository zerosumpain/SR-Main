// src/lib/selfimprove/cluster.ts
//
// Finding the themes hiding in the queue.
//
// ── Why ─────────────────────────────────────────────────────────────────────
//
// Measured on production the day the queue board shipped: of **407 open
// backlog items, 175 look like restatements of something that already
// shipped** — 43% of the queue. A random 70-row sample collapsed to about
// twelve subjects. Eight open items ask for bank/PayPal duplicate-charge
// reconciliation while four items on that theme have already shipped, some
// before the open ones were written.
//
// The board can already fold restatements into one, and group by an
// `epicSlug`. What it could not do is FIND the groups. A person scrolling 339
// untried cards will not spot that rows 12, 88, 203 and 310 are one idea.
//
// ── The rule this file exists under ─────────────────────────────────────────
//
// **There is one definition of "related" in this engine and it is
// `narrative.ts`.** A second matcher here is precisely the bug that left every
// driver unrecorded for a fortnight, and precisely the false-positive class
// that once claimed "Live OpenRouter balance" was already served by
// `govuk_search` on the strength of "live" and "api". So every verdict below
// comes from `looksSameSubject`, and the only thing this module adds is which
// PAIRS get asked.
//
// PURE — no database, no clock, no LLM. Nothing here writes a sentence: an
// epic's label is the shortest member title, verbatim, and its keywords are
// the words the members actually share.

import { contentWords, looksSameSubject, subjectOverlap } from './narrative';
import type { BacklogItemData } from './types';

/**
 * A group of backlog items that appear to be the same subject.
 *
 * `open` is what a decision is about — the shipped members are shown because a
 * theme with three shipped things and five open ones is the finding, not a
 * coincidence.
 */
export interface Cluster {
  /** Stable across runs for the same membership — see `clusterSlug`. */
  slug: string;
  /** The shortest member title, verbatim. Never synthesised. */
  label: string;
  /** Content words shared by most members, longest first. */
  keywords: string[];
  /** Every member, open and settled, in the order they were queued. */
  memberSlugs: string[];
  openSlugs: string[];
  shippedSlugs: string[];
  /** Members an already-shipped sibling appears to cover. */
  servedCount: number;
}

export interface ClusterResult {
  clusters: Cluster[];
  /** Items that matched nothing. A queue where everything clusters is a
   *  matcher that has stopped discriminating. */
  singletons: number;
  /** Items inside a component too large to be a theme. Counted SEPARATELY:
   *  they are the opposite failure to a singleton — over-clustering, not
   *  under — and folding them into `singletons` would hide a runaway behind
   *  the very number that is supposed to detect one. */
  oversizedItems: number;
  /** Pairs the pre-filter admitted, how many the predicate accepted, and how
   *  many survived the strongest-links rule — reported so a change in any of
   *  the three can be seen rather than guessed at. */
  pairsConsidered: number;
  pairsPassed: number;
  pairsLinked: number;
  /** Components that blew the size cap and were dropped whole — the label and
   *  the size, because "one was dropped" without the size hides whether the
   *  cap is a little tight or the matcher has fallen over. */
  oversized: Array<{ label: string; size: number }>;
  /** Index keys skipped for being queue-wide generic. This is a real filter,
   *  not a free optimisation — see `clusterBacklog`. */
  skippedKeys: string[];
}

export interface ClusterOptions {
  /**
   * A component larger than this is not a theme — it is the matcher failing,
   * usually because a very generic title bridges two unrelated groups. Dropped
   * and REPORTED rather than written: a hundred-item "epic" is worse than none,
   * and silently splitting it would invent a boundary nothing measured.
   */
  maxClusterSize?: number;
  /** A cluster of one is just an item. */
  minClusterSize?: number;
  /** Keywords kept on the cluster, for display. */
  maxKeywords?: number;
  /**
   * How many of its STRONGEST partners each item is joined to.
   *
   * ONE, and the number was measured rather than chosen. Across production's
   * 455 rows:
   *
   * | links | clusters | grouped | biggest | runaway components |
   * |-------|----------|---------|---------|--------------------|
   * | 1     | 113      | **380** | **9**   | **none**           |
   * | 2     | 30       | 223     | 24      | 4, up to 53 items  |
   * | 3     | 19       | 109     | 20      | 2, one of 237      |
   * | every | 16       | 71      | 13      | 1 of 309           |
   *
   * Joining every passing pair is single linkage, and it chains distinct
   * themes together through a handful of generic bridging titles: at that
   * setting one component swallowed 309 of 455 rows, blew the size cap and was
   * dropped whole. Joining only the single strongest partner denies any bridge
   * that power — a real theme still holds together because its members are
   * each other's best match.
   *
   * The cost is that a large theme can split into two tight sub-themes rather
   * than staying whole. That is the failure worth having: grouping too little
   * leaves the owner two lanes to fold by hand, and grouping wrongly would
   * abandon the wrong items on a matcher's say-so.
   */
  linksPerItem?: number;
}

const DEFAULTS = { maxClusterSize: 24, minClusterSize: 2, maxKeywords: 5, linksPerItem: 1 } as const;

/**
 * Stable identity for a cluster.
 *
 * Derived from the SORTED member slugs, so the same grouping arrived at on
 * five nights is one row rather than five — the identity rule
 * `slugForCapability` and `slugifyIdea` already follow. Membership changing is
 * a different cluster, which is correct: it is a different claim.
 */
export function clusterSlug(memberSlugs: string[]): string {
  const joined = [...memberSlugs].sort().join('|');
  // A short, stable, non-cryptographic digest. Two clusters colliding here
  // would merge two proposals, so it carries the member count as a cheap
  // discriminator on top of the hash.
  let h = 2166136261;
  for (let i = 0; i < joined.length; i++) {
    h ^= joined.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `epic:${memberSlugs.length}-${(h >>> 0).toString(36)}`;
}

/** Words shared by at least half the members, longest first. Deterministic,
 *  and drawn from the members' own titles rather than written. */
export function sharedKeywords(titles: string[], max: number): string[] {
  if (titles.length === 0) return [];
  const counts = new Map<string, number>();
  for (const t of titles) {
    for (const w of contentWords(t)) counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  const threshold = Math.max(2, Math.ceil(titles.length / 2));
  return [...counts.entries()]
    .filter(([, n]) => n >= threshold)
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length || a[0].localeCompare(b[0]))
    .slice(0, max)
    .map(([w]) => w);
}

/** The shortest title, verbatim — usually the most general phrasing of a
 *  theme, and never a sentence this code made up. */
export function labelFor(titles: string[]): string {
  return [...titles].sort((a, b) => a.length - b.length || a.localeCompare(b))[0] ?? 'Untitled';
}

/** Union-find. Small enough to keep here rather than take a dependency. */
class Groups {
  private parent = new Map<string, string>();

  find(a: string): string {
    let root = this.parent.get(a) ?? a;
    if (root === a) {
      this.parent.set(a, a);
      return a;
    }
    root = this.find(root);
    this.parent.set(a, root);
    return root;
  }

  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

/**
 * Group a backlog into themes.
 *
 * ── Two filters, and which one is free ─────────────────────────────────────
 *
 * Asking `looksSameSubject` about every pair of 455 items is 103,285 calls.
 * The predicate needs **three** shared content words, which implies at least
 * one — so an inverted index over `contentWords` that only pairs items sharing
 * a word generates a strict SUPERSET of the pairs that could ever pass. That
 * half is free: every pair it skips is one the predicate would have rejected.
 *
 * Skipping words that appear across a large share of the queue is **not**
 * free, and calling it an optimisation would be a lie. If two titles share
 * exactly three words and all three are queue-wide generic, this drops a pair
 * the predicate would have accepted. That is a deliberate second filter, and
 * it is wanted: grouping two ideas on nothing but the three most common words
 * in the corpus is the same false positive that once had "Live OpenRouter
 * balance" served by `govuk_search` on "live" and "api". The words it dropped
 * are REPORTED, so the judgement is visible rather than buried.
 */
export function clusterBacklog(
  items: BacklogItemData[],
  servedSlugs: ReadonlySet<string> = new Set(),
  opts: ClusterOptions = {},
): ClusterResult {
  const maxClusterSize = opts.maxClusterSize ?? DEFAULTS.maxClusterSize;
  const minClusterSize = opts.minClusterSize ?? DEFAULTS.minClusterSize;
  const maxKeywords = opts.maxKeywords ?? DEFAULTS.maxKeywords;
  const linksPerItem = opts.linksPerItem ?? DEFAULTS.linksPerItem;

  const bySlug = new Map(items.map((i) => [i.slug, i]));
  const titles = new Map(items.map((i) => [i.slug, i.title ?? '']));

  // ── Index ───────────────────────────────────────────────────────────────
  const index = new Map<string, string[]>();
  for (const item of items) {
    for (const w of contentWords(item.title ?? '')) {
      const list = index.get(w);
      if (list) list.push(item.slug);
      else index.set(w, [item.slug]);
    }
  }
  // A word carried by a third of the queue is not a discriminator.
  const tooCommon = Math.max(12, Math.ceil(items.length / 3));

  // Pairs are held as TUPLES, not a delimiter-joined string. An earlier
  // version keyed them as `a + separator + b` and split on it, and a stray
  // byte in that separator silently made every title lookup miss — the
  // clusterer returned zero groups while every count above it looked healthy.
  // Nothing here needs a parseable key, so nothing here has one.
  const candidates = new Map<string, [string, string]>();
  const skippedKeys: string[] = [];
  for (const [word, slugs] of index) {
    if (slugs.length < 2) continue;
    if (slugs.length > tooCommon) {
      skippedKeys.push(word);
      continue;
    }
    for (let a = 0; a < slugs.length; a++) {
      for (let b = a + 1; b < slugs.length; b++) {
        const lo = slugs[a] < slugs[b] ? slugs[a] : slugs[b];
        const hi = slugs[a] < slugs[b] ? slugs[b] : slugs[a];
        candidates.set(lo + '|' + hi, [lo, hi]);
      }
    }
  }

  // ── Verdicts ────────────────────────────────────────────────────────────
  //
  // `looksSameSubject` decides WHETHER two titles are the same subject;
  // `subjectOverlap` says how strongly, off the same tokens. Both come from
  // narrative.ts, which is the one definition of "related" in this engine.
  const best = new Map<string, Array<{ other: string; score: number; tightness: number }>>();
  let pairsPassed = 0;
  for (const [a, b] of candidates.values()) {
    const ta = titles.get(a) ?? '';
    const tb = titles.get(b) ?? '';
    if (!looksSameSubject(ta, tb)) continue;
    pairsPassed++;
    const { score, tightness } = subjectOverlap(ta, tb);
    for (const [from, other] of [
      [a, b],
      [b, a],
    ] as const) {
      const list = best.get(from);
      if (list) list.push({ other, score, tightness });
      else best.set(from, [{ other, score, tightness }]);
    }
  }

  // Join each item to its STRONGEST partners only. A real theme survives
  // because its members are each other's best matches; a generic title that
  // merely passes against two unrelated groups no longer welds them together.
  const groups = new Groups();
  let pairsLinked = 0;
  for (const [from, list] of best) {
    // Score, then tightness, then the slug so the result is deterministic.
    // Tightness matters: a three-word title scores 1.00 against both its exact
    // twin and a six-word title that merely contains it, and letting the
    // alphabet break that tie is how a generic bridging title wins a link it
    // has no business winning.
    list.sort(
      (x, y) => y.score - x.score || y.tightness - x.tightness || x.other.localeCompare(y.other),
    );
    for (const { other } of list.slice(0, linksPerItem)) {
      groups.union(from, other);
      pairsLinked++;
    }
  }

  // ── Components ──────────────────────────────────────────────────────────
  const members = new Map<string, string[]>();
  for (const item of items) {
    const root = groups.find(item.slug);
    const list = members.get(root);
    if (list) list.push(item.slug);
    else members.set(root, [item.slug]);
  }

  const clusters: Cluster[] = [];
  const oversized: Array<{ label: string; size: number }> = [];
  let singletons = 0;
  let oversizedItems = 0;

  for (const [, memberSlugs] of members) {
    if (memberSlugs.length < minClusterSize) {
      singletons += memberSlugs.length;
      continue;
    }
    const memberTitles = memberSlugs.map((s) => titles.get(s) ?? '');
    if (memberSlugs.length > maxClusterSize) {
      oversized.push({ label: labelFor(memberTitles), size: memberSlugs.length });
      oversizedItems += memberSlugs.length;
      continue;
    }
    // Queue order, so a cluster reads oldest-first like the queue does.
    const ordered = [...memberSlugs].sort((a, b) =>
      (bySlug.get(a)?.createdAt ?? '').localeCompare(bySlug.get(b)?.createdAt ?? '') || a.localeCompare(b),
    );
    clusters.push({
      slug: clusterSlug(ordered),
      label: labelFor(memberTitles),
      keywords: sharedKeywords(memberTitles, maxKeywords),
      memberSlugs: ordered,
      openSlugs: ordered.filter((s) => bySlug.get(s)?.status === 'open'),
      shippedSlugs: ordered.filter((s) => bySlug.get(s)?.status === 'shipped'),
      servedCount: ordered.filter((s) => servedSlugs.has(s)).length,
    });
  }

  // Biggest first, then most already-shipped: a theme with several shipped
  // members and several still open is the one worth ruling on.
  clusters.sort(
    (a, b) =>
      b.openSlugs.length - a.openSlugs.length ||
      b.shippedSlugs.length - a.shippedSlugs.length ||
      a.label.localeCompare(b.label),
  );

  return {
    clusters,
    singletons,
    oversizedItems,
    pairsConsidered: candidates.size,
    pairsPassed,
    pairsLinked,
    oversized,
    skippedKeys: skippedKeys.sort(),
  };
}

/**
 * How much a cluster is worth ruling on, 0..1.
 *
 * Shallow arithmetic over named inputs, the rule `scoreCapability` set: a
 * number nobody can decompose is a number nobody should act on. Size leads
 * because folding six restatements saves five slots; the served count leads
 * next because those are slots that would rebuild finished work.
 */
export function clusterWeight(c: Cluster): { score: number; components: Record<string, number> } {
  const size = 0.1 * Math.min(6, Math.max(0, c.openSlugs.length - 1));
  const served = 0.06 * Math.min(5, c.servedCount);
  const shipped = c.shippedSlugs.length > 0 ? 0.1 : 0;
  const score = Math.min(1, Math.round((size + served + shipped) * 1000) / 1000);
  return { score, components: { size, served, shipped } };
}
