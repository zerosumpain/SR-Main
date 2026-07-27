// The analysed graph — nodes and edges enriched with everything the analytics
// layer computes, so the dashboard can colour by community, size by centrality
// and filter by hop distance without a second round trip.
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getGraphAnalysis } from '$lib/jkai/intel/analytics/load';
import { hopNeighbourhood, components } from '$lib/jkai/intel/analytics/model';
import { applyGraphFilter, parseCsv } from '$lib/jkai/intel/analytics/filter';
import { brokerageScore } from '$lib/jkai/intel/analytics/centrality';
import { db } from '$lib/db';
import { intelCategories, intelEntityTypes } from '$lib/db/schema';

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
  const entityFilter = parseCsv(url.searchParams.get('entities'));
  const qHopsParam = url.searchParams.get('qHops');

  const analysis = await getGraphAnalysis();
  const { index, centrality, community } = analysis;

  const filtered = applyGraphFilter(index, community.membership, {
    typeId,
    communityId: communityFilter ? Number(communityFilter) : null,
    minDegree,
    focusId,
    hops,
    q,
    qHops: qHopsParam === null ? 1 : Number(qHopsParam),
    categories: categoryFilter,
    entityIds: entityFilter,
  });

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
      hops: focusId ? (hopNeighbourhood(index, focusId, hops).get(id) ?? null) : null,
      categories: n.categories,
      aliases: n.aliases,
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

  const comps = components(index);

  return json({
    nodes,
    edges,
    types,
    categories,
    // The literal keyword hits, kept separate from `nodes` so the client can
    // highlight them rather than pretending the expanded neighbourhood matched.
    matched: filtered.matched.filter((id) => keep.has(id)),
    trimmed,
    stats: {
      totalNodes: index.ids.length,
      totalEdges: analysis.snapshot.edges.length,
      shown: nodes.length,
      communities: community.communities.size,
      modularity: Number(community.modularity.toFixed(3)),
      components: comps.length,
      largestComponent: comps[0]?.length ?? 0,
      isolated: comps.filter((c) => c.length === 1).length,
    },
    communities: [...community.communities.entries()]
      .filter(([, ids]) => ids.length > 1)
      .slice(0, 24)
      .map(([id, ids]) => ({
        id,
        size: ids.length,
        // Name a cluster after its most central member — far more useful than
        // "Community 3".
        label:
          ids
            .slice()
            .sort((a, b) => (centrality.pagerank.get(b) ?? 0) - (centrality.pagerank.get(a) ?? 0))
            .map((i) => index.byId.get(i)?.name)
            .find(Boolean) ?? `Cluster ${id}`,
      })),
  });
};
