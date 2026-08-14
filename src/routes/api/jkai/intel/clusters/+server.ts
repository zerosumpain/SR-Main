// The cluster roster — named, durable, and describable.
//
//   GET                             the roster, ranked, with the cluster-level map
//   POST { action: 'recalculate' }  re-tune, re-detect, reconcile, return the roster
//   POST { action: 'rename', … }    name a cluster, or clear the name
//   POST { action: 'narrate', key } write (or rewrite) a cluster's narrative
//
// The roster is deliberately NOT part of /network: that route ships the entity
// graph trimmed to its 600 most central nodes, and cluster-level questions are
// about all 9,000. Keeping them apart is what lets the cluster surfaces describe
// the whole graph while the entity views stay a readable size.
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getGraphAnalysis, invalidateGraphAnalysis } from '$lib/jkai/intel/analytics/load';
import { autoTuneResolution, detectCommunities } from '$lib/jkai/intel/analytics/community';
import { nameDrift, NAME_DRIFT_WARNING } from '$lib/jkai/intel/analytics/cluster-identity';
import { describeComposition } from '$lib/jkai/intel/analytics/cluster-label';
import { fingerprint } from '$lib/jkai/intel/analytics/cluster-identity';
import {
  reconcileFromAnalysis,
  renameCluster,
  loadClusters,
  setClusterNarrative,
} from '$lib/jkai/intel/cluster-store';
import { assembleClusterBriefContext, generateBrief } from '$lib/jkai/intel/brief';
import { entityRelevance } from '$lib/jkai/intel/staleness';
import { components } from '$lib/jkai/intel/analytics/model';
import type { GraphAnalysis } from '$lib/jkai/intel/analytics/load';
import type { StoredCluster } from '$lib/jkai/intel/analytics/cluster-identity';
import type { GraphNode } from '$lib/jkai/intel/analytics/model';

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
async function buildRoster(analysis: GraphAnalysis, resolution?: number) {
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

export const GET: RequestHandler = async ({ url }) => {
  const requested = url.searchParams.get('resolution');
  const resolution = requested === null ? undefined : Number(requested);
  if (resolution !== undefined && (!Number.isFinite(resolution) || resolution <= 0)) {
    throw error(400, 'resolution must be a positive number');
  }
  const analysis = await getGraphAnalysis();
  return json(await buildRoster(analysis, resolution));
};

export const POST: RequestHandler = async ({ request }) => {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const action = String(body.action ?? '');

  if (action === 'recalculate') {
    // Drop the analysis as well as the roster memo: recalculating is the button
    // for "the graph has changed since you last looked", and reusing a cached
    // snapshot would make it a no-op for up to a minute.
    invalidateGraphAnalysis();
    const analysis = await getGraphAnalysis(true);
    const requested = body.resolution === undefined ? undefined : Number(body.resolution);
    if (requested !== undefined && (!Number.isFinite(requested) || requested <= 0)) {
      throw error(400, 'resolution must be a positive number');
    }
    const tuning = requested === undefined ? autoTuneResolution(analysis.index) : null;
    const roster = await buildRoster(analysis, requested ?? tuning?.resolution);
    return json({ ...roster, candidates: tuning?.candidates ?? null });
  }

  if (action === 'rename') {
    const key = String(body.key ?? '').trim();
    if (!key) throw error(400, 'key is required');
    const raw = body.name === null || body.name === undefined ? '' : String(body.name);
    if (raw.length > 120) throw error(400, 'a cluster name must be 120 characters or fewer');
    const updated: StoredCluster | null = await renameCluster(key, raw);
    if (!updated) throw error(404, 'no such cluster');
    return json({
      key: updated.key,
      name: updated.name,
      label: updated.name ?? updated.autoLabel,
      namedAt: updated.namedAt,
    });
  }

  if (action === 'narrate') {
    const key = String(body.key ?? '').trim();
    if (!key) throw error(400, 'key is required');

    const analysis = await getGraphAnalysis();
    const roster = await buildRoster(analysis);
    const view = roster.clusters.find((c) => c.key === key);
    if (!view) throw error(404, 'no such cluster');

    const stored = (await loadClusters()).find((c) => c.key === key);
    if (!stored) throw error(404, 'no such cluster');

    // Served from store unless the membership has moved or a rewrite is asked
    // for. A narrative costs a model call and does not go stale with time — only
    // when the cluster it describes stops being the same set of entities.
    if (stored.narrative && !view.narrativeStale && body.force !== true) {
      return json({
        key,
        narrative: stored.narrative,
        narrativeAt: stored.narrativeAt,
        cached: true,
      });
    }

    const ranked = [...stored.members].sort(
      (a, b) => (analysis.centrality.pagerank.get(b) ?? 0) - (analysis.centrality.pagerank.get(a) ?? 0),
    );

    const context = await assembleClusterBriefContext(ranked, {
      label: view.label,
      size: view.size,
      types: view.composition.types,
      sources: view.composition.sources,
      sourceless: view.composition.sourceless,
      noteTotal: view.composition.noteTotal,
      diversity: view.composition.diversity,
      span: view.span,
      bridges: view.bridges.map((b) => ({ name: b.name, reaches: b.reaches })),
    });

    const result = await generateBrief(context);
    // Persisted against the membership it was written for, so the card can tell
    // "written about this cluster" from "written about what this cluster was".
    await setClusterNarrative(key, result.markdown, stored.members);

    return json({
      key,
      narrative: result.markdown,
      narrativeAt: new Date().toISOString(),
      cached: false,
      citations: result.citations,
      droppedMarkers: result.droppedMarkers,
    });
  }

  throw error(400, `unknown action: ${action || '(none)'}`);
};
