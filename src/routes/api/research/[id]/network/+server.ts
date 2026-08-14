/**
 * One research session's entity network, analysed with the Intel graph's own
 * machinery and returned in the shape `NetworkGraph.svelte` already consumes.
 *
 * Deliberately a mirror of `/api/jkai/intel/network`: same analytics, same node
 * and edge fields, same stats block. That is what lets the research dashboard
 * render the intel component rather than a second, thinner force layout — see
 * `$lib/deepdive/session-graph` for the translation and why the invented fields
 * hold the values they do.
 *
 * Computed per request rather than cached. The intel graph caches because it is
 * one global structure rebuilt from thousands of rows; a session's graph is a
 * couple of hundred rows scoped by `session_id`, and the whole pass measures in
 * single-digit milliseconds.
 */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { researchSessions, entities, relationships } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { buildIndex, components } from '$lib/jkai/intel/analytics/model';
import { computeCentrality, brokerageScore } from '$lib/jkai/intel/analytics/centrality';
import { detectCommunities } from '$lib/jkai/intel/analytics/community';
import { buildSessionSnapshot } from '$lib/deepdive/session-graph';

export const GET: RequestHandler = async ({ params }) => {
  const [session] = await db
    .select({ id: researchSessions.id, report: researchSessions.report })
    .from(researchSessions)
    .where(eq(researchSessions.id, params.id))
    .limit(1);

  if (!session) return json({ error: 'Session not found' }, { status: 404 });

  const [entityRows, relationshipRows] = await Promise.all([
    db
      .select({
        id: entities.id,
        name: entities.name,
        type: entities.type,
        description: entities.description,
      })
      .from(entities)
      .where(eq(entities.sessionId, params.id)),
    db
      .select({
        id: relationships.id,
        fromEntityId: relationships.fromEntityId,
        toEntityId: relationships.toEntityId,
        relationshipType: relationships.relationshipType,
        strength: relationships.strength,
        sentiment: relationships.sentiment,
      })
      .from(relationships)
      .where(eq(relationships.sessionId, params.id)),
  ]);

  const centrality = ((session.report as { entity_centrality?: Record<string, number> } | null)
    ?.entity_centrality ?? {}) as Record<string, number>;

  const snapshot = buildSessionSnapshot(entityRows, relationshipRows, { centrality });

  if (snapshot.nodes.length === 0) {
    return json({
      nodes: [],
      edges: [],
      communities: [],
      stats: { totalNodes: 0, totalEdges: 0, shown: 0, communities: 0, modularity: 0, components: 0, largestComponent: 0, isolated: 0 },
      trimmed: false,
    });
  }

  const index = buildIndex(snapshot);
  const scores = await computeCentrality(index);
  const community = detectCommunities(index);

  // Normalised so the client can size nodes without knowing the scale — the
  // same contract the intel endpoint has with the same component.
  const maxPagerank = Math.max(1e-9, ...index.ids.map((id) => scores.pagerank.get(id) ?? 0));

  const nodes = snapshot.nodes.map((n) => ({
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
    degree: index.degree.get(n.id) ?? 0,
    importance: (scores.pagerank.get(n.id) ?? 0) / maxPagerank,
    betweenness: scores.betweenness.get(n.id) ?? 0,
    brokerage: brokerageScore(n.id, scores, index),
    community: community.membership.get(n.id) ?? 0,
    clusterKey: null,
    clusterColourIndex: null,
    hops: null,
    categories: n.categories,
    sources: n.sources,
    aliases: n.aliases,
    // A research entity is exactly as current as the run that produced it —
    // there is no ingest clock and nothing ages between phases, so the
    // renderers' staleness fade must not fire. See session-graph.ts.
    recency: 1,
    relevance: 1,
  }));

  const edges = snapshot.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    type: e.type,
    label: e.label,
    strength: e.strength,
    confidence: e.confidence,
    weight: e.weight,
    sourceKind: e.sourceKind,
    recency: 1,
    crossCommunity: community.membership.get(e.source) !== community.membership.get(e.target),
  }));

  const comps = components(index);

  return json({
    nodes,
    edges,
    trimmed: snapshot.trimmed,
    stats: {
      totalNodes: snapshot.totalNodes,
      totalEdges: snapshot.totalEdges,
      shown: nodes.length,
      communities: community.communities.size,
      modularity: Number(community.modularity.toFixed(3)),
      components: comps.length,
      largestComponent: comps[0]?.length ?? 0,
      isolated: comps.filter((c) => c.length === 1).length,
    },
    // Named after their most central member. The intel graph gets its labels
    // from the durable cluster roster, which is global and has no meaning for a
    // single session — so the fallback rule IS the rule here.
    communities: [...community.communities.entries()]
      .filter(([, ids]) => ids.length > 1)
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 12)
      .map(([id, ids]) => ({
        id,
        size: ids.length,
        key: null,
        colourIndex: null,
        label:
          ids
            .slice()
            .sort((a, b) => (scores.pagerank.get(b) ?? 0) - (scores.pagerank.get(a) ?? 0))
            .map((i) => index.byId.get(i)?.name)
            .find(Boolean) ?? `Cluster ${id}`,
      })),
  });
};
