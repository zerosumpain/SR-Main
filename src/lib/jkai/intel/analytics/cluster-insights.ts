// What the ROSTER noticed, as opposed to what the graph noticed.
//
// Every detector in ./insights is a pure function over one snapshot, which is
// why none of them can answer a question about change: a snapshot has no
// yesterday in it. The cluster roster does — it survives recomputation by
// design — so these three findings become possible for the first time, and they
// are the ones worth having:
//
//   emerging   a neighbourhood formed recently and is growing
//   merging    two neighbourhoods that were separate are now one
//   dormant    a neighbourhood has had no new evidence for a long time
//
// `merging` is the valuable one. "Two areas of your life just connected" is a
// structural fact about the whole graph that no entity-level detector can see,
// because at entity level it is just one more edge.
//
// Kept out of ./insights on purpose. That module is pure over a GraphAnalysis
// and exhaustively tested without a database; these need the stored roster, and
// dragging a DB dependency into it would cost that. Same split as
// insight-store.ts against the detectors it persists.

import type { StoredCluster, ReconcileChanges } from './cluster-identity';
import type { Insight } from './insights';

const DAY_MS = 86_400_000;

/** A cluster younger than this is still "new" rather than established. */
export const EMERGING_AGE_DAYS = 21;

/** Below this a cluster is too small for its appearance to mean anything. */
export const EMERGING_MIN_SIZE = 8;

/** No new evidence for this long and a cluster has gone quiet. */
export const DORMANT_DAYS = 45;

/** Dormancy is only worth reporting for a cluster of some substance. */
export const DORMANT_MIN_SIZE = 12;

export interface ClusterInsightInput {
  clusters: StoredCluster[];
  changes: ReconcileChanges;
  /** Newest evidence per cluster key, epoch ms — from the graph, not the roster. */
  freshestEvidence: Map<string, number>;
  now?: number;
}

const labelOf = (cluster: StoredCluster) => cluster.name ?? cluster.autoLabel;

/**
 * Two clusters became one.
 *
 * Reported from `mergedFrom` rather than by comparing sizes, because a merge is
 * a statement about IDENTITY — these two things the roster was tracking
 * separately are now one thing — and only the matcher knows that happened.
 */
function detectMerging(input: ClusterInsightInput): Insight[] {
  const byKey = new Map(input.clusters.map((c) => [c.key, c]));
  return input.changes.merged
    .map((key) => {
      const cluster = byKey.get(key);
      if (!cluster || !cluster.mergedFrom.length) return null;
      const absorbed = cluster.mergedFrom
        .map((k) => byKey.get(k))
        .filter((c): c is StoredCluster => Boolean(c));
      if (!absorbed.length) return null;

      const names = absorbed.map(labelOf).join(', ');
      const name = labelOf(cluster);
      return {
        id: `cluster_merging:${key}`,
        kind: 'cluster_merging' as const,
        title: `${name} has absorbed ${absorbed.length === 1 ? names : `${absorbed.length} other clusters`}`,
        detail:
          `${name} and ${names} were separate neighbourhoods in your graph and are now one. ` +
          `Something has connected them — either genuinely, which is worth knowing, or through an ` +
          `over-general entity that belongs in neither.`,
        // A merge of two substantial clusters matters more than one absorbing a
        // fragment, so the score follows the smaller party's size.
        score: Math.min(1, Math.min(...absorbed.map((c) => c.size)) / 40),
        entityIds: cluster.members.slice(0, 6),
        action: 'ask' as const,
        actionLabel: `Why did ${name} and ${names} merge?`,
        actionPayload:
          `In my intel graph, the clusters "${name}" and "${names}" were separate and have just ` +
          `merged into one. What connected them, and is that a real relationship or an artefact?`,
      };
    })
    .filter((i): i is NonNullable<typeof i> => Boolean(i));
}

/**
 * Is the roster old enough for "new" to mean anything?
 *
 * On the run that first builds the roster, every cluster is minted at once and
 * every one of them looks brand new — which on the production graph would fire
 * a hundred "this is a new area" findings simultaneously, on the day the
 * feature ships, about clusters that have been there for months. The roster has
 * to have been watching for longer than the window it reports against before
 * anything it says about newness is worth reading.
 *
 * Judged from the OLDEST cluster: that is when the roster started, regardless of
 * how much has been minted since.
 */
function rosterHasHistory(clusters: StoredCluster[], now: number): boolean {
  const oldest = clusters.reduce((min, c) => {
    const at = Date.parse(c.firstSeenAt);
    return Number.isFinite(at) && at < min ? at : min;
  }, Number.POSITIVE_INFINITY);
  if (!Number.isFinite(oldest)) return false;
  return (now - oldest) / DAY_MS > EMERGING_AGE_DAYS;
}

/** A neighbourhood that did not exist a few weeks ago. */
function detectEmerging(input: ClusterInsightInput): Insight[] {
  const now = input.now ?? Date.now();
  if (!rosterHasHistory(input.clusters, now)) return [];
  return input.clusters
    .filter((c) => c.live && c.size >= EMERGING_MIN_SIZE)
    .filter((c) => {
      const age = (now - Date.parse(c.firstSeenAt)) / DAY_MS;
      return Number.isFinite(age) && age <= EMERGING_AGE_DAYS;
    })
    // A cluster that split off an existing one is not a new area of interest,
    // it is the same area described more finely — and saying "new" about it
    // would be the kind of finding that is technically true and useless.
    .filter((c) => !c.splitFrom)
    .map((c) => {
      const name = labelOf(c);
      const age = Math.max(1, Math.round((now - Date.parse(c.firstSeenAt)) / DAY_MS));
      return {
        id: `cluster_emerging:${c.key}`,
        kind: 'cluster_emerging' as const,
        title: `${name} is a new area in your graph`,
        detail:
          `${c.size} entities have formed a distinct cluster in the last ${age} day${age === 1 ? '' : 's'}. ` +
          `Nothing in the graph grouped this way before.`,
        score: Math.min(1, c.size / 60),
        entityIds: c.members.slice(0, 6),
        action: 'research' as const,
        actionLabel: `Deep dive on ${name}`,
        actionPayload: `${name} — what this is, why it has come up now, and what it connects to`,
      };
    });
}

/** A neighbourhood nothing has added to for a long time. */
function detectDormant(input: ClusterInsightInput): Insight[] {
  const now = input.now ?? Date.now();
  return input.clusters
    .filter((c) => c.live && c.size >= DORMANT_MIN_SIZE)
    .map((c) => {
      const freshest = input.freshestEvidence.get(c.key);
      if (!freshest) return null;
      const quiet = (now - freshest) / DAY_MS;
      if (!Number.isFinite(quiet) || quiet < DORMANT_DAYS) return null;
      const name = labelOf(c);
      const days = Math.round(quiet);
      return {
        id: `cluster_dormant:${c.key}`,
        kind: 'cluster_dormant' as const,
        title: `${name} has gone quiet`,
        detail:
          `${c.size} entities, and nothing new observed for ${days} days. Either this line of ` +
          `enquiry has finished, or it is still live and nothing is feeding the graph about it.`,
        // Bounded well below the others: dormancy is context, not an alarm.
        score: Math.min(0.55, (quiet / 180) * 0.55),
        entityIds: c.members.slice(0, 6),
        action: 'review' as const,
        actionLabel: `Review ${name}`,
        actionPayload: `${name} — is this still relevant, and should anything be watching it?`,
      };
    })
    .filter((i): i is NonNullable<typeof i> => Boolean(i));
}

export function generateClusterInsights(input: ClusterInsightInput): Insight[] {
  return [...detectMerging(input), ...detectEmerging(input), ...detectDormant(input)].sort(
    (a, b) => b.score - a.score,
  );
}
