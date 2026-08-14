// What to call a cluster before anyone has named it.
//
// The rule this replaces was "name it after its most central member", which is
// a reasonable-sounding rule that the production graph shows up badly. Its top
// twelve labels on 2026-08-14:
//
//   jkai · Johnkelly Main · John Kelly · Costco UK · Brakeburn · UKCC ·
//   DfE Data Spine · IBCA · United Kingdom · Apple Calendar · User · OpenAI
//
// Three of those name the operator or his email address, one names the country
// he lives in and one names the platform he is reading them on. None of the five
// distinguishes its cluster from any other, because the reason those entities
// are central is that they are attached to EVERYTHING — which is exactly what
// makes them useless as names.
//
// The rule also moved labels that should not have moved: over a single day
// "Mole Valley Farmers" became "UKCC" and "London" became "United Kingdom",
// same bodies of entities both times, because one hub overtook another in the
// centrality ordering. A name that changes when nothing changed is worse than a
// dull one.
//
// So: two leaders rather than one, with the entities that lead everything
// excluded, and a composition fallback for the cluster that is genuinely just a
// pile of one kind of thing.
//
// PURE — no DB, no clock. Used by the reconcile pass and unit-tested directly.

import type { AdjacencyIndex, GraphNode } from './model';

/**
 * How many distinct clusters an entity must touch before it stops being a
 * useful name for any one of them.
 *
 * This started as "leads more than a quarter of all clusters" and that rule
 * never fired once: on the production graph no entity leads more than a single
 * cluster, because leading is what makes a cluster form around you. The signal
 * that actually separates a generic hub from a subject is REACH — how many
 * distinct clusters an entity has a neighbour in.
 *
 * Measured over the 106 tracked clusters, reach is 1 at the median, 2 at p90 and
 * 5 at p99, with a long thin tail:
 *
 *   Johnkelly Main 72 · John Kelly 25 · jkai 22 · United Kingdom 21 ·
 *   Darlington 14 · WhatsApp 13 · Privacy Policy 12 · London 11 …
 *   … IBCA 9 · Home Assistant 9 · Department for Education 9
 *
 * 20 is four times p99, which is where the operator's own email address, his
 * name, the platform and the country he lives in sit — and comfortably above
 * IBCA, DfE and Home Assistant, which are the best names in the whole set and
 * must not be disqualified by a rule aimed at the others.
 */
export const UBIQUITY_REACH = 20;

/** How many leaders a name is built from. */
const LEADERS = 2;

/**
 * How long one half of a label may be before a shorter alternative is preferred.
 *
 * Entity names in this graph include things like "2023 Volkswagen Caddy & 30
 * Piece DeWalt XR Kit competition", and a label built from two of those is
 * sixty-five characters in a rail row eleven ems wide. A long name is not
 * rejected — sometimes it is the only name there is — it just loses to a
 * shorter one, and is clipped if it wins anyway.
 */
const MAX_LABEL_PART = 32;

/** Types whose plural is not formed by adding an s. */
const IRREGULAR_PLURALS: Record<string, string> = {
  person: 'people',
};

export interface LabelContext {
  pagerank: Map<string, number>;
  /** Entities that lead so many clusters they cannot distinguish one. */
  ubiquitous: ReadonlySet<string>;
}

export interface ClusterComposition {
  size: number;
  /** Entity type → count, biggest first. */
  types: Array<[string, number]>;
  /** Note source → how many entities carry it, biggest first. */
  sources: Array<[string, number]>;
  /** Entities with no provenance at all. */
  sourceless: number;
  /** Total note links across the cluster. */
  noteTotal: number;
  /**
   * How evenly the cluster's evidence is spread across kinds of source, 0..1.
   *
   * Shannon entropy of the source mix. This is the figure that separates a
   * SUBJECT from a FEED, and it was arrived at by measurement after two more
   * obvious ideas failed on the real graph:
   *
   *   size            puts four retail-email clusters above both work clusters.
   *   median relevance made it WORSE — relevance is confidence times freshness,
   *                   and marketing email is both recent and confidently
   *                   extracted, so it rewards precisely the noise. IBCA fell
   *                   from 7th to 10th, DfE Data Spine from 9th to 12th.
   *
   * Diversity ranks IBCA 1st and DfE 2nd, and drops the mailshots off the list
   * entirely: Brakeburn scores 0.04, Zavvi 0.04, CMaxOwnersClub 0.00, because
   * every entity in them came from one source. IBCA is 0.70 and DfE 0.72 —
   * file, chat and research all corroborating the same body.
   */
  diversity: number;
}

/**
 * The note sources an entity can carry, from `intel_notes.source`. Used only to
 * put `diversity` on a 0..1 scale — the ranking is unaffected by the choice,
 * since rescaling by a constant cannot reorder anything.
 */
export const KNOWN_SOURCES = ['email', 'chat', 'file', 'research', 'web', 'whatsapp', 'workflow'];

function pluralise(typeName: string, count: number): string {
  const readable = typeName.replace(/_/g, ' ');
  if (count === 1) return readable;
  return IRREGULAR_PLURALS[typeName] ?? `${readable}s`;
}

/** Count, biggest first, ties broken by name so the order is deterministic. */
function ranked(counts: Map<string, number>): Array<[string, number]> {
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

/**
 * Entities that touch so many clusters they cannot distinguish one.
 *
 * Measured across the whole graph rather than per cluster, because that is the
 * only place the information exists: nothing about "Johnkelly Main" seen from
 * inside one cluster reveals that it also has neighbours in seventy-one others.
 *
 * These are DEMOTED rather than banned — see `composeClusterLabel`. An entity
 * being everywhere makes it a poor first word, not a fact worth suppressing.
 */
export function findUbiquitousEntities(
  index: Pick<AdjacencyIndex, 'ids' | 'neighbours'>,
  membership: Map<string, number>,
  tracked: ReadonlySet<number>,
): Set<string> {
  const out = new Set<string>();
  // Nothing can be ubiquitous across fewer than two clusters.
  if (tracked.size < 2) return out;

  for (const id of index.ids) {
    const reach = new Set<number>();
    const own = membership.get(id);
    if (own !== undefined && tracked.has(own)) reach.add(own);
    for (const neighbour of index.neighbours.get(id) ?? []) {
      const community = membership.get(neighbour);
      if (community !== undefined && tracked.has(community)) reach.add(community);
      if (reach.size >= UBIQUITY_REACH) break;
    }
    if (reach.size >= UBIQUITY_REACH) out.add(id);
  }
  return out;
}

/**
 * Is `candidate` saying the same thing as something already in the name?
 *
 * The leaders of a cluster are often an entity and its own sub-document — the
 * IBCA cluster's two most central members are "IBCA" and "IBCA Data Strategy" —
 * and pairing those spends the second slot repeating the first.
 */
/** Trim an overlong name at a word boundary where there is one nearby. */
function clip(name: string): string {
  if (name.length <= MAX_LABEL_PART) return name;
  const cut = name.slice(0, MAX_LABEL_PART);
  const space = cut.lastIndexOf(' ');
  return `${(space > MAX_LABEL_PART * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

function echoes(candidate: string, taken: readonly string[]): boolean {
  const a = candidate.toLowerCase();
  return taken.some((existing) => {
    const b = existing.toLowerCase();
    return a.includes(b) || b.includes(a);
  });
}

/** The shape of a cluster: what kinds of thing, on what evidence. */
export function describeComposition(members: readonly GraphNode[]): ClusterComposition {
  const types = new Map<string, number>();
  const sources = new Map<string, number>();
  let sourceless = 0;
  let noteTotal = 0;

  for (const member of members) {
    types.set(member.typeName, (types.get(member.typeName) ?? 0) + 1);
    noteTotal += member.noteCount;
    // De-duplicated per entity: `sources` is already a union across the notes
    // asserting it, but a caller assembling one by hand can repeat itself, and
    // counting a source twice for one entity would overstate its reach.
    const seen = new Set(member.sources);
    if (!seen.size) sourceless++;
    for (const source of seen) sources.set(source, (sources.get(source) ?? 0) + 1);
  }

  const total = [...sources.values()].reduce((sum, n) => sum + n, 0);
  let entropy = 0;
  if (total > 0) {
    for (const n of sources.values()) {
      const p = n / total;
      if (p > 0) entropy -= p * Math.log(p);
    }
    entropy /= Math.log(KNOWN_SOURCES.length);
  }

  return {
    size: members.length,
    types: ranked(types),
    sources: ranked(sources),
    sourceless,
    noteTotal,
    diversity: Number(entropy.toFixed(4)),
  };
}

/**
 * A name for a cluster nobody has named.
 *
 * Two leaders, not one: a single name reads as a claim that the cluster IS that
 * entity, and it is the pairing that actually says what the neighbourhood is —
 * "Costco UK · Brakeburn" is recognisably retail email in a way that either
 * alone is not.
 */
export function composeClusterLabel(members: readonly GraphNode[], ctx: LabelContext): string {
  if (!members.length) return 'Unnamed cluster';

  const candidates = [...members]
    .filter((m) => m.name.trim().length > 0)
    .sort(
      (a, b) =>
        (ctx.pagerank.get(b.id) ?? 0) - (ctx.pagerank.get(a.id) ?? 0) || a.id.localeCompare(b.id),
    );

  // Demotion, not exclusion. A cluster genuinely about jkai should still say
  // "jkai" — it just should not say ONLY that, because so does everything jkai
  // touches. Sorting the ubiquitous entities behind the specific ones lets the
  // distinguishing name lead and keeps the familiar one as context.
  const ordered = [
    ...candidates.filter((m) => !ctx.ubiquitous.has(m.id)),
    ...candidates.filter((m) => ctx.ubiquitous.has(m.id)),
  ];

  // Two passes: everything that fits a rail row, then the overlong names as a
  // fallback. Within each pass centrality order is preserved, so a short name
  // only wins where one exists at all.
  const chosen: string[] = [];
  for (const pass of [true, false]) {
    for (const member of ordered) {
      const name = member.name.trim();
      if (name.length <= MAX_LABEL_PART !== pass) continue;
      if (echoes(name, chosen)) continue;
      chosen.push(clip(name));
      if (chosen.length === LEADERS) break;
    }
    if (chosen.length === LEADERS) break;
  }

  if (chosen.length) return chosen.join(' · ');

  // Nothing nameable at all — every member is unnamed, or every name echoes the
  // first. Describe the cluster instead. Honest, and it cannot collide with
  // another cluster's label the way a shared hub name does.
  const composition = describeComposition(members);
  const [dominantType, count] = composition.types[0] ?? ['entity', members.length];
  return `${members.length} ${pluralise(dominantType, count)}`;
}
