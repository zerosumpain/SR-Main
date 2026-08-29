// The analysed graph — nodes and edges enriched with everything the analytics
// layer computes, so the dashboard can colour by community, size by centrality
// and filter by hop distance without a second round trip.
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getGraphAnalysis } from '$lib/jkai/intel/analytics/load';
import { hopNeighbourhood, components } from '$lib/jkai/intel/analytics/model';
import {
  applyGraphFilter,
  parseCsv,
  nodeTimeUnder,
  edgeTimeUnder,
  type GraphClock,
} from '$lib/jkai/intel/analytics/filter';
import { reconcileFromAnalysis } from '$lib/jkai/intel/cluster-store';
import { brokerageScore } from '$lib/jkai/intel/analytics/centrality';
import { labelForView } from '$lib/jkai/intel/analytics/cluster-label';
import { db } from '$lib/db';
import { intelCategories, intelEntityTypes } from '$lib/db/schema';
import { recencyOf, entityRelevance } from '$lib/jkai/intel/staleness';

/**
 * Above this many nodes the payload is trimmed to the most central entities.
 * A force layout of several thousand nodes is unreadable anyway, and shipping
 * it costs megabytes.
 */
const MAX_NODES = 600;

export const GET: RequestHandler = async ({ url }) => {
  const typeId = url.searchParams.get('typeId');
  const focusId = url.searchParams.get('focus');
  const hops = Math.min(Math.max(Number(url.searchParams.get('hops') ?? 2), 1), 5);
  const minDegree = Math.max(Number(url.searchParams.get('minDegree') ?? 0), 0);
  const communityFilter = url.searchParams.get('community');
  const q = url.searchParams.get('q');
  const categoryFilter = parseCsv(url.searchParams.get('categories'));
  const sourceFilter = parseCsv(url.searchParams.get('sources'));
  const entityFilter = parseCsv(url.searchParams.get('entities'));
  const qHopsParam = url.searchParams.get('qHops');

  // The recency window. Epoch ms, both open-ended by default.
  //
  // `since` is accepted as an absolute instant rather than a "last N days"
  // count deliberately: the client already has to render exact dates for the
  // custom range, and a server that re-derives "7 days ago" from its own clock
  // would disagree with the label the user is looking at whenever a request
  // crosses midnight.
  const since = numberParam(url.searchParams.get('since'));
  const until = numberParam(url.searchParams.get('until'));
  const clock: GraphClock = url.searchParams.get('clock') === 'added' ? 'added' : 'updated';
  const windowed = since !== null || until !== null;

  const analysis = await getGraphAnalysis();
  const { index, centrality, community } = analysis;

  // The durable identity behind each detected community. Colouring and placing
  // by the community INDEX repaints and rearranges the graph on every run — the
  // index is a size rank, and a day of ingest moves 70% of entities to a
  // different one. The roster's colour slot is assigned once and kept.
  //
  // Failing soft on purpose: the graph is the most-used surface here and must
  // render even if the roster is unavailable, in which case the client falls
  // back to the community index exactly as it did before.
  let clusterByCommunity = new Map<number, { key: string; colourIndex: number }>();
  const clusterLabels = new Map<number, string>();
  /** Names the user typed, which no filter may override. */
  const clusterNames = new Map<number, string | null>();
  let ubiquitous: ReadonlySet<string> = new Set<string>();
  try {
    const roster = await reconcileFromAnalysis(analysis);
    ubiquitous = roster.ubiquitous;
    const byKey = new Map(roster.clusters.map((c) => [c.key, c]));
    for (const [communityIndex, key] of roster.keyByIndex) {
      const stored = byKey.get(key);
      if (!stored) continue;
      clusterByCommunity.set(communityIndex, { key, colourIndex: stored.colourIndex });
      clusterLabels.set(communityIndex, stored.name ?? stored.autoLabel);
      clusterNames.set(communityIndex, stored.name);
    }
  } catch (err) {
    console.warn('[intel/network] cluster roster unavailable; colouring by community index', err);
    clusterByCommunity = new Map();
  }
  // One clock for the whole response, so two nodes of identical age cannot come
  // back with different recency because the loop took a millisecond.
  const now = Date.now();

  const filtered = applyGraphFilter(index, community.membership, {
    typeId,
    communityId: communityFilter ? Number(communityFilter) : null,
    minDegree,
    focusId,
    hops,
    q,
    qHops: qHopsParam === null ? 1 : Number(qHopsParam),
    categories: categoryFilter,
    sources: sourceFilter,
    entityIds: entityFilter,
    since,
    until,
    clock,
  });

  // Nodes and edges the window itself admitted, as opposed to the ones dragged
  // in as endpoints of a recent edge. Sets, because the node loop below is over
  // hundreds of ids and `Array.includes` inside it is the shape that turned a
  // hop lookup into 600 full-graph traversals here once already.
  const recentNodes = new Set(filtered.recentNodes);
  const recentEdges = new Set(filtered.recentEdges);

  // Everything the filter admitted, BEFORE the payload is trimmed to the most
  // central 600. Cluster reach and the filtered counts are both computed from
  // this rather than from `keep`: the trim is a rendering budget, not a
  // statement about the data, and reporting "chat reaches 600 entities" when it
  // reaches 2,816 would be the trim lying about the mailbox.
  const selected = filtered.keep;
  //
  // `minDegree > 1`, not `> 0`. The page opens at minDegree=1 to hide entities
  // connected to nothing — 2,632 of them on the live graph — so treating any
  // minDegree as a filter would put the whole page into its narrowed state
  // before the user had touched anything. The client draws the same line
  // (`shapeFilterCount` counts `minDegree > 1`); these two must agree or the
  // tiles and the graph disagree about whether a filter is on.
  const filtering =
    !!typeId ||
    !!focusId ||
    !!communityFilter ||
    !!q ||
    minDegree > 1 ||
    windowed ||
    categoryFilter.length > 0 ||
    sourceFilter.length > 0 ||
    entityFilter.length > 0;

  let keep = filtered.keep;

  let trimmed = false;
  if (keep.size > MAX_NODES) {
    const ranked = [...keep].sort(
      (a, b) => (centrality.pagerank.get(b) ?? 0) - (centrality.pagerank.get(a) ?? 0),
    );
    keep = new Set(ranked.slice(0, MAX_NODES));
    trimmed = true;
  }

  const maxPagerank = Math.max(1e-9, ...[...keep].map((id) => centrality.pagerank.get(id) ?? 0));

  // Hop distances from the focused entity, computed ONCE. This used to sit
  // inside the node loop, where it ran a full-graph BFS per node — 600 identical
  // traversals of a 5,000-node graph every time anyone double-clicked an entity
  // to centre the view on it.
  const hopsFrom = focusId ? hopNeighbourhood(index, focusId, hops) : null;

  const nodes = [...keep].map((id) => {
    const n = index.byId.get(id)!;
    return {
      id: n.id,
      name: n.name,
      type: n.typeName,
      typeId: n.typeId,
      icon: n.icon,
      color: n.color,
      summary: n.summary,
      confirmed: n.confirmed,
      confidence: n.confidence,
      noteCount: n.noteCount,
      degree: index.degree.get(id) ?? 0,
      // Normalised so the client can size nodes without knowing the scale.
      importance: (centrality.pagerank.get(id) ?? 0) / maxPagerank,
      betweenness: centrality.betweenness.get(id) ?? 0,
      brokerage: brokerageScore(id, centrality, index),
      community: community.membership.get(id) ?? 0,
      clusterKey: clusterByCommunity.get(community.membership.get(id) ?? 0)?.key ?? null,
      clusterColourIndex:
        clusterByCommunity.get(community.membership.get(id) ?? 0)?.colourIndex ?? null,
      hops: hopsFrom?.get(id) ?? null,
      categories: n.categories,
      sources: n.sources,
      aliases: n.aliases,
      // Inside the recency window on its OWN clock, as opposed to having been
      // pulled in as the endpoint of a recent edge. False for everything when
      // no window is set. Kept distinct for the same reason `matched` is: a
      // view that draws the context exactly like the hits cannot show you what
      // you asked for.
      recent: recentNodes.has(n.id),
      // How current this entity's evidence is, so the renderers can fade stale
      // material. Computed here rather than client-side so both the 2D and 3D
      // views agree and neither needs to know the decay curve.
      //
      // From `evidenceAt`, not `lastSeenAt`. `lastSeenAt` is the note clock,
      // which for email is the moment the sweep wrote the row — every Gmail
      // entity therefore scored a flat 1.000 and this field, added so the
      // renderers could fade stale material, was shipping a constant for most of
      // the graph. `evidenceAt` carries the observed time. See GraphNode.
      recency: Number(recencyOf(n.evidenceAt || n.lastSeenAt, now).toFixed(3)),
      // How much this entity should count RIGHT NOW — confidence discounted by
      // age, on the same curve and with the same pull as the entity card.
      //
      // Computed here rather than in the renderers so the 2D view, the 3D view
      // and the card cannot drift into three answers, and so the client never
      // has to guess a number from the three-value `confidence` text column —
      // which has no numeric mapping anywhere, deliberately (see staleness.ts).
      relevance: Number(
        entityRelevance(
          { confidence: n.confidenceScore, evidenceAt: n.evidenceAt || n.lastSeenAt },
          now,
        ).score.toFixed(3),
      ),
    };
  });

  const edges = analysis.snapshot.edges
    .filter((e) => keep.has(e.source) && keep.has(e.target))
    .map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      type: e.type,
      label: e.label,
      strength: e.strength,
      confidence: e.confidence,
      weight: e.weight,
      sourceKind: e.sourceKind,
      recency: Number(recencyOf(e.lastSeenAt, now).toFixed(3)),
      recent: recentEdges.has(e.id),
      // An edge whose ends sit in different clusters is the interesting kind.
      crossCommunity: community.membership.get(e.source) !== community.membership.get(e.target),
    }));

  const [types, categories] = await Promise.all([
    db
      .select({
        id: intelEntityTypes.id,
        name: intelEntityTypes.name,
        icon: intelEntityTypes.icon,
        color: intelEntityTypes.color,
      })
      .from(intelEntityTypes),
    db
      .select({
        id: intelCategories.id,
        slug: intelCategories.slug,
        name: intelCategories.name,
        color: intelCategories.color,
      })
      .from(intelCategories)
      .orderBy(intelCategories.name),
  ]);

  // The activity histogram behind the slicer, in whole UTC days.
  //
  // Computed over the WHOLE index and every edge, never over `keep` — exactly
  // the rule the source picker follows a few lines below, and for the same
  // reason. A histogram built from the filtered selection would redraw itself
  // every time the window moved, so dragging the window left would flatten the
  // bars you were dragging towards. A timeline that reacts to its own brush
  // cannot be used to aim.
  //
  // Bucketed by UTC day and returned as epoch ms, not as a formatted date. The
  // viewer is in Europe/London and the server is not; whose "day" a bar belongs
  // to is the client's question, and answering it here would be the local-day
  // ≠ UTC-day trap in a place nobody would look for it.
  const ACTIVITY_DAYS = 90;
  const dayStart = Math.floor(now / 86_400_000) * 86_400_000;
  const from = dayStart - (ACTIVITY_DAYS - 1) * 86_400_000;
  const buckets = new Map<number, { nodes: number; edges: number }>();
  for (let t = from; t <= dayStart; t += 86_400_000) buckets.set(t, { nodes: 0, edges: 0 });

  let olderNodes = 0;
  let olderEdges = 0;
  const bucketFor = (t: number) => Math.floor(t / 86_400_000) * 86_400_000;
  for (const id of index.ids) {
    const n = index.byId.get(id);
    if (!n) continue;
    const t = nodeTimeUnder(n, clock);
    if (!t) continue;
    const b = buckets.get(bucketFor(t));
    if (b) b.nodes++;
    else if (t < from) olderNodes++;
  }
  for (const e of analysis.snapshot.edges) {
    const t = edgeTimeUnder(e, clock);
    if (!t) continue;
    const b = buckets.get(bucketFor(t));
    if (b) b.edges++;
    else if (t < from) olderEdges++;
  }
  const activity = {
    from,
    to: dayStart,
    days: [...buckets.entries()].map(([t, c]) => ({ t, nodes: c.nodes, edges: c.edges })),
    // Everything off the left-hand end, so the slicer can say how much history
    // it is not drawing rather than implying the graph starts 90 days ago.
    olderNodes,
    olderEdges,
  };

  // Degree WITHIN the current selection, computed once over the edge list.
  //
  // This is the ordering a filtered cluster row is named on. Global centrality
  // is the wrong yardstick for a slice: "England" carries degree 10 across the
  // whole graph, nearly all of it football, so ranking the important-email slice
  // of a cluster by pagerank named it "England · London" when what the filter had
  // actually admitted was one eBay order.
  const degreeInView = new Map<string, number>();
  if (filtering) {
    for (const e of analysis.snapshot.edges) {
      if (!selected.has(e.source) || !selected.has(e.target)) continue;
      degreeInView.set(e.source, (degreeInView.get(e.source) ?? 0) + 1);
      degreeInView.set(e.target, (degreeInView.get(e.target) ?? 0) + 1);
    }
  }

  const comps = components(index);

  // How far each cluster reaches into the filtered selection.
  //
  // Singletons are dropped as they always were (Louvain gives every isolated
  // entity its own community, and 2,632 of those describe nothing), and a
  // cluster the filter does not touch at all is dropped too — that is the whole
  // point of the change. Ranked by reach rather than size so the clusters the
  // channel actually populates come first; ties break on true size so the
  // unfiltered ordering is unchanged.
  const clusterReach = [...community.communities.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([id, ids]) => ({ id, ids, reach: ids.filter((n) => selected.has(n)).length }))
    .filter((c) => c.reach > 0)
    .sort((a, b) => b.reach - a.reach || b.ids.length - a.ids.length);

  // Every source present in the graph, with how many entities it accounts for.
  //
  // Counted over the WHOLE index rather than the filtered `keep` set: this
  // populates the source picker, and a picker whose options vanish as you use
  // it cannot be used to get back. Deselecting 'email' must still show 'email'
  // with its count, or there is no way to re-enable it.
  const sourceCounts = new Map<string, number>();
  for (const id of index.ids) {
    for (const s of index.byId.get(id)?.sources ?? []) {
      sourceCounts.set(s, (sourceCounts.get(s) ?? 0) + 1);
    }
  }
  // Split into the three levels the picker offers. A facet is a source value
  // carrying a separator — 'email:bulk' is a kind, 'email@linkedin.com' is a
  // sender. Grouping them here rather than in the component keeps the parsing
  // in one place and lets the picker stay a renderer.
  const sources: Array<{ id: string; count: number }> = [];
  const sourceKinds: Array<{ id: string; source: string; kind: string; count: number }> = [];
  const sourceDomains: Array<{ id: string; source: string; domain: string; count: number }> = [];
  for (const [id, count] of sourceCounts) {
    const colon = id.indexOf(':');
    const at = id.indexOf('@');
    if (at > 0) sourceDomains.push({ id, source: id.slice(0, at), domain: id.slice(at + 1), count });
    else if (colon > 0) sourceKinds.push({ id, source: id.slice(0, colon), kind: id.slice(colon + 1), count });
    else sources.push({ id, count });
  }
  const byCount = <T extends { count: number; id: string }>(a: T, b: T) =>
    b.count - a.count || a.id.localeCompare(b.id);
  sources.sort(byCount);
  sourceKinds.sort(byCount);
  sourceDomains.sort(byCount);

  return json({
    nodes,
    edges,
    types,
    categories,
    sources,
    sourceKinds,
    sourceDomains,
    // The literal keyword hits, kept separate from `nodes` so the client can
    // highlight them rather than pretending the expanded neighbourhood matched.
    matched: filtered.matched.filter((id) => keep.has(id)),
    trimmed,
    filtering,
    stats: {
      totalNodes: index.ids.length,
      totalEdges: analysis.snapshot.edges.length,
      shown: nodes.length,
      communities: community.communities.size,
      modularity: Number(community.modularity.toFixed(3)),
      components: comps.length,
      largestComponent: comps[0]?.length ?? 0,
      isolated: comps.filter((c) => c.length === 1).length,
      // What the CURRENT filter admits, before the render trim. The tiles used
      // to read `totalNodes` unconditionally, so narrowing to one channel left
      // every number on the page unmoved — which reads as a filter that did
      // nothing, and was the most common reason to distrust the whole control.
      selectedNodes: selected.size,
      selectedEdges: analysis.snapshot.edges.filter(
        (e) => selected.has(e.source) && selected.has(e.target),
      ).length,
      selectedCommunities: clusterReach.length,
      // What the WINDOW itself admitted, before endpoint expansion. Reported so
      // "7 days" can honestly say "14 entities and 3 connections", rather than
      // quoting a selection two thirds of which is context.
      recentNodes: filtered.recentNodes.length,
      recentEdges: filtered.recentEdges.length,
    },
    // The clock the window was measured on, echoed back. The client picks it,
    // but a payload that does not say which clock produced these numbers is one
    // screenshot away from being unreadable.
    clock,
    window: { since, until },
    activity,
    // Clusters the filter actually reaches, largest reach first.
    //
    // `size` stays the cluster's TRUE size and `reach` says how much of it is
    // in view, because a cluster is a fact about the whole graph and shrinking
    // its stated size to the filtered slice would make "Policy" look like a
    // twelve-entity cluster whenever you narrowed to chat. When nothing is
    // filtered the two are equal and this is the old list exactly.
    communities: clusterReach
      .slice(0, 24)
      .map(({ id, ids, reach }) => ({
        id,
        size: ids.length,
        reach,
        key: clusterByCommunity.get(id)?.key ?? null,
        colourIndex: clusterByCommunity.get(id)?.colourIndex ?? null,
        // What to call this cluster given what the filter admits.
        //
        // The stored label describes the WHOLE cluster and stays that way — it
        // is the durable identity, and `size` beside `reach` already says the
        // row is a slice. But a name is a claim about what you are looking at,
        // and under a filter the whole-cluster name is a claim about entities
        // the filter removed: narrowed to important email, the cluster holding
        // one eBay order was labelled "Hany Shoukry · Silent dev box deals",
        // neither of which appears in any email.
        //
        // Null when nothing is filtered, so the client keeps the stored label
        // verbatim rather than recomputing an identical string. A name the USER
        // typed always wins — it is their word for this cluster, not a
        // description of its contents.
        inViewLabel:
          filtering && !clusterNames.get(id)
            ? labelForView(
                ids.map((n) => index.byId.get(n)).filter((n): n is NonNullable<typeof n> => Boolean(n)),
                (nodeId) => selected.has(nodeId),
                { pagerank: centrality.pagerank, ubiquitous },
                degreeInView,
              )
            : null,
        // The roster's label, which is the name the user gave it where there is
        // one. Falls back to the old rule — the most central member's name —
        // only when the roster could not be read; that rule produced "jkai",
        // "John Kelly" and "United Kingdom" for three of the biggest clusters,
        // which is why it is now the fallback rather than the rule.
        label:
          clusterLabels.get(id) ??
          ids
            .slice()
            .sort((a, b) => (centrality.pagerank.get(b) ?? 0) - (centrality.pagerank.get(a) ?? 0))
            .map((i) => index.byId.get(i)?.name)
            .find(Boolean) ??
          `Cluster ${id}`,
      })),
  });
};

/**
 * A finite epoch-ms query parameter, or null.
 *
 * Null rather than 0 for anything unparseable: 0 is a real instant (1970) and
 * `since=0` would read as "everything since the epoch", which is the opposite
 * of the "no window" that a malformed parameter should mean.
 */
function numberParam(raw: string | null): number | null {
  if (raw === null || raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}
