// Assembling what a cluster surface renders.
//
// Lives here rather than in the route because THREE surfaces need it — the
// clusters API, the cluster index page and one cluster's own page — and a
// +server.ts cannot export a helper at all: a non-handler export breaks the
// route at runtime.
import { getGraphAnalysis } from './analytics/load';
import { detectCommunities } from './analytics/community';
import { nameDrift, fingerprint, NAME_DRIFT_WARNING } from './analytics/cluster-identity';
import { describeComposition } from './analytics/cluster-label';
import { reconcileFromAnalysis } from './cluster-store';
import { entityRelevance } from './staleness';
import { components } from './analytics/model';
import type { GraphAnalysis } from './analytics/load';
import type { GraphNode } from './analytics/model';

/** Members listed on a card before it asks you to open the cluster. */
const PREVIEW_MEMBERS = 6;
/** Bridges listed per cluster. */
const MAX_BRIDGES = 5;

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * Build the view the cluster surfaces render.
 *
 * `signal` is the ordering, and it exists because ordering by SIZE puts four
 * retail-email clusters (Costco, Brakeburn, UKCC, the competitions pile) above
 * both clusters carrying actual work — DfE Data Spine and IBCA.
 *
 * Source diversity times the log of size. The log keeps a five-entity cluster
 * from outranking a two-hundred-entity one on a tidy source mix, while stopping
 * size from dominating outright.
 *
 * Median relevance was tried here first and measurably made things WORSE — it is
 * confidence times freshness, and marketing email is both recent and confidently
 * extracted, so it promoted exactly what it was meant to demote (IBCA 7th→10th,
 * DfE 9th→12th). Relevance is still reported per cluster because it is worth
 * knowing; it is just not what "matters" means here.
 */
/**
 * Re-tune, re-detect and reconcile against the CURRENT graph.
 *
 * Shared by the two callers that can start one — the owner pressing the button
 * on /jkai/intel, and the maintenance route that lets an ingest or a backfill
 * follow itself with a recalculation instead of waiting for someone to open the
 * page. One implementation, so the two cannot drift into different answers.
 *
 * Drops the cached analysis as well as the roster memo: recalculating is the
 * operation for "the graph has changed since you last looked", and reusing a
 * cached snapshot would make it a no-op for up to a minute.
 */
export async function recalculateClusterRoster(resolution?: number) {
  const { invalidateGraphAnalysis } = await import('./analytics/load');
  const { autoTuneResolution } = await import('./analytics/community');

  invalidateGraphAnalysis();
  const analysis = await getGraphAnalysis(true);
  const tuning = resolution === undefined ? autoTuneResolution(analysis.index) : null;
  const roster = await buildClusterRoster(analysis, resolution ?? tuning?.resolution);
  return { ...roster, candidates: tuning?.candidates ?? null };
}

export async function buildClusterRoster(analysis: GraphAnalysis, resolution?: number) {
  const reconciled = await reconcileFromAnalysis(analysis, { resolution });
  const { index, centrality } = analysis;
  const now = Date.now();

  const partition =
    reconciled.resolution === analysis.community.resolution
      ? analysis.community
      : detectCommunities(index, reconciled.resolution);

  const live = reconciled.clusters.filter((c) => c.live);
  const keyOf = new Map<string, string>();
  for (const cluster of live) {
    for (const id of cluster.members) keyOf.set(id, cluster.key);
  }

  // Cross-cluster structure, walked once: which entities bridge out, and how
  // heavily each pair of clusters is joined.
  const bridgeReach = new Map<string, Set<string>>();
  const pairCounts = new Map<string, number>();
  for (const edge of analysis.snapshot.edges) {
    const a = keyOf.get(edge.source);
    const b = keyOf.get(edge.target);
    if (!a || !b || a === b) continue;
    const pair = a < b ? `${a}|${b}` : `${b}|${a}`;
    pairCounts.set(pair, (pairCounts.get(pair) ?? 0) + 1);
    for (const [id, other] of [
      [edge.source, b],
      [edge.target, a],
    ] as const) {
      const reach = bridgeReach.get(id);
      if (reach) reach.add(other);
      else bridgeReach.set(id, new Set([other]));
    }
  }

  const view = live.map((cluster) => {
    const members = cluster.members
      .map((id) => index.byId.get(id))
      .filter((n): n is GraphNode => Boolean(n));

    const relevances = members.map(
      (n) =>
        entityRelevance({ confidence: n.confidenceScore, evidenceAt: n.evidenceAt || n.lastSeenAt }, now)
          .score,
    );
    const medianRelevance = median(relevances);
    const composition = describeComposition(members);

    const ranked = [...members].sort(
      (a, b) => (centrality.pagerank.get(b.id) ?? 0) - (centrality.pagerank.get(a.id) ?? 0),
    );

    const bridges = ranked
      .map((n) => ({ node: n, reach: bridgeReach.get(n.id) }))
      .filter((b) => b.reach && b.reach.size > 0)
      .sort((a, b) => (b.reach?.size ?? 0) - (a.reach?.size ?? 0))
      .slice(0, MAX_BRIDGES)
      .map((b) => ({
        id: b.node.id,
        name: b.node.name,
        type: b.node.typeName,
        reaches: [...(b.reach ?? [])],
      }));

    // The span the evidence actually covers, from the observation clock rather
    // than the ingest clock — every email note is written on the night its sweep
    // ran, so dating a cluster by `createdAt` makes them all this week's.
    const observed = members.map((n) => n.evidenceAt || n.lastSeenAt).filter((t) => t > 0);

    const drift = nameDrift(cluster);

    return {
      key: cluster.key,
      label: cluster.name ?? cluster.autoLabel,
      autoLabel: cluster.autoLabel,
      name: cluster.name,
      colourIndex: cluster.colourIndex,
      size: cluster.size,
      composition,
      medianRelevance: Number(medianRelevance.toFixed(3)),
      signal: Number((composition.diversity * Math.log1p(cluster.size)).toFixed(3)),
      span: observed.length
        ? { from: new Date(Math.min(...observed)).toISOString(), to: new Date(Math.max(...observed)).toISOString() }
        : null,
      members: ranked.slice(0, PREVIEW_MEMBERS).map((n) => ({
        id: n.id,
        name: n.name,
        type: n.typeName,
        icon: n.icon,
      })),
      bridges,
      delta: cluster.delta,
      firstSeenAt: cluster.firstSeenAt,
      lastSeenAt: cluster.lastSeenAt,
      mergedFrom: cluster.mergedFrom,
      splitFrom: cluster.splitFrom,
      narrative: cluster.narrative,
      narrativeAt: cluster.narrativeAt,
      // Stale means "written about a different set of entities", not "written a
      // while ago" — a narrative does not rot with time, it rots when its
      // subject changes.
      narrativeStale:
        Boolean(cluster.narrative) && cluster.narrativeFingerprint !== fingerprint(cluster.members),
      nameDrift: drift === null ? null : Number(drift.toFixed(3)),
      nameDrifted: drift !== null && drift >= NAME_DRIFT_WARNING,
      namedAt: cluster.namedAt,
    };
  });

  view.sort((a, b) => b.signal - a.signal || b.size - a.size);

  const comps = components(index);
  const connected = index.ids.filter((id) => (index.degree.get(id) ?? 0) > 0).length;
  const tracked = new Set(live.map((c) => c.key));

  return {
    clusters: view,
    resolution: reconciled.resolution,
    changes: reconciled.changes,
    stats: {
      totalEntities: index.ids.length,
      connected,
      isolated: index.ids.length - connected,
      tracked: live.length,
      // Everything the tracked clusters do NOT cover, so the UI can account for
      // the whole graph rather than quietly showing half of it.
      untracked: connected - live.reduce((sum, c) => sum + c.size, 0),
      modularity: Number(partition.modularity.toFixed(3)),
      components: comps.length,
    },
    // One node per cluster, linked by how many relationships cross between them.
    // The only view that can show the whole graph: the entity views ship the 600
    // most central nodes of nine thousand.
    clusterGraph: {
      nodes: view.map((c) => ({
        key: c.key,
        label: c.label,
        size: c.size,
        colourIndex: c.colourIndex,
        signal: c.signal,
      })),
      links: [...pairCounts.entries()]
        .map(([pair, count]) => {
          const [source, target] = pair.split('|');
          return { source, target, count };
        })
        .filter((l) => tracked.has(l.source) && tracked.has(l.target))
        .sort((a, b) => b.count - a.count),
    },
  };
}
