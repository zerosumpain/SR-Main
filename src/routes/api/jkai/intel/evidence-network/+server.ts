// The evidence view of the graph: notes and entities, an edge per mention.
//
// Returns the SAME payload shape as /api/jkai/intel/network so the 2D and 3D
// renderers, the cluster picker and the source picker all work against it
// unchanged. That is the whole reason this is a sibling route rather than a
// second component: the question is different, the drawing is not.
//
// A node id starting `note:` is a piece of evidence; anything else is an
// entity. The client needs that distinction only to decide what a click opens.
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { parseCsv } from '$lib/jkai/intel/analytics/filter';
import {
  analyseEvidenceGraph,
  buildEvidenceGraph,
  isEvidenceNode,
  styleForSource,
} from '$lib/jkai/intel/analytics/evidence-graph';
import { components } from '$lib/jkai/intel/analytics/model';
import { db } from '$lib/db';
import { intelCategories, intelEntityTypes } from '$lib/db/schema';
import { recencyOf } from '$lib/jkai/intel/staleness';

/** Same ceiling as the entity view — a force layout beyond this is a smudge. */
const MAX_NODES = 600;

export const GET: RequestHandler = async ({ url }) => {
  const sourceFilter = parseCsv(url.searchParams.get('sources'));
  const q = (url.searchParams.get('q') ?? '').trim().toLowerCase();
  const noteLimit = Number(url.searchParams.get('notes') ?? 400);

  const built = await buildEvidenceGraph({
    sources: sourceFilter,
    limit: Number.isFinite(noteLimit) ? noteLimit : 400,
  });
  const { index, community, rank } = analyseEvidenceGraph(built.snapshot);
  const now = Date.now();

  // Trimmed by pagerank over the BIPARTITE graph, so a note that many entities
  // hang off and an entity many notes point at both survive. Trimming by note
  // count alone would keep the biggest documents and strand them.
  let keep = new Set(index.ids);
  let trimmed = false;
  if (keep.size > MAX_NODES) {
    keep = new Set(
      [...keep].sort((a, b) => (rank.get(b) ?? 0) - (rank.get(a) ?? 0)).slice(0, MAX_NODES),
    );
    trimmed = true;
  }

  const matched = q
    ? [...keep].filter((id) => {
        const n = index.byId.get(id);
        return n ? `${n.name} ${n.summary ?? ''}`.toLowerCase().includes(q) : false;
      })
    : [];

  const maxRank = Math.max(1e-9, ...[...keep].map((id) => rank.get(id) ?? 0));

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
      importance: (rank.get(id) ?? 0) / maxRank,
      betweenness: 0,
      brokerage: 0,
      community: community.membership.get(id) ?? 0,
      clusterKey: null,
      clusterColourIndex: null,
      hops: null,
      categories: n.categories,
      sources: n.sources,
      aliases: n.aliases,
      recency: Number(recencyOf(n.evidenceAt || n.lastSeenAt, now).toFixed(3)),
      // Evidence is not scored for confidence the way an entity is — it IS the
      // thing confidence is computed from — so this reports recency rather than
      // inventing a relevance the record cannot support.
      relevance: Number(recencyOf(n.evidenceAt || n.lastSeenAt, now).toFixed(3)),
      /** True for a note node. The client uses it to route a click. */
      evidence: isEvidenceNode(n.id),
    };
  });

  const edges = built.snapshot.edges
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

  // Counted over the whole built graph, not the trimmed set — same rule as the
  // entity view: a picker whose options vanish as you use them cannot be used
  // to get back.
  const sourceCounts = new Map<string, number>();
  for (const n of built.snapshot.nodes) {
    for (const s of n.sources) sourceCounts.set(s, (sourceCounts.get(s) ?? 0) + 1);
  }
  const sources = [...sourceCounts]
    .map(([id, count]) => ({ id, count }))
    .sort((a, b) => b.count - a.count || a.id.localeCompare(b.id));

  const comps = components(index);
  const clusterReach = [...community.communities.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([id, ids]) => ({ id, ids, reach: ids.filter((n) => keep.has(n)).length }))
    .filter((c) => c.reach > 0)
    .sort((a, b) => b.reach - a.reach || b.ids.length - a.ids.length);

  return json({
    nodes,
    edges,
    types: [
      // The synthetic type, so the type picker can isolate evidence or hide it.
      { id: 'evidence', name: 'Evidence', icon: '◇', color: styleForSource(null).color },
      ...types,
    ],
    categories,
    sources,
    sourceKinds: [],
    sourceDomains: [],
    matched,
    trimmed,
    filtering: sourceFilter.length > 0 || Boolean(q),
    mode: 'evidence',
    stats: {
      totalNodes: built.snapshot.nodes.length,
      totalEdges: built.snapshot.edges.length,
      shown: nodes.length,
      communities: community.communities.size,
      modularity: Number(community.modularity.toFixed(3)),
      components: comps.length,
      largestComponent: comps[0]?.length ?? 0,
      isolated: comps.filter((c) => c.length === 1).length,
      selectedNodes: built.snapshot.nodes.length,
      selectedEdges: built.snapshot.edges.length,
      selectedCommunities: clusterReach.length,
      /** How much of each side is in play — the number this view exists for. */
      evidenceNodes: built.noteCount,
      entityNodes: built.entityCount,
    },
    communities: clusterReach.slice(0, 24).map(({ id, ids, reach }) => ({
      id,
      size: ids.length,
      reach,
      key: null,
      colourIndex: null,
      // No roster here — these clusters are a partition of a DIFFERENT graph
      // and have no durable identity, so they are named after their most
      // central member exactly as the entity view does when its roster is
      // unavailable.
      label:
        ids
          .slice()
          .sort((a, b) => (rank.get(b) ?? 0) - (rank.get(a) ?? 0))
          .map((i) => index.byId.get(i)?.name)
          .find(Boolean) ?? `Group ${id}`,
    })),
  });
};
