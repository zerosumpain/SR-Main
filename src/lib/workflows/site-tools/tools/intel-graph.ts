// `intel-graph` toolset — jkai reasoning over the entity graph's STRUCTURE.
//
// `knowledge_search` already retrieves text about a thing. What it cannot do is
// answer structural questions: how two people are connected, who sits between
// two parts of your world, what surrounds an entity two hops out. Those are the
// questions a graph exists for, and until now the graph could not be asked them
// from chat — since the Hermes cutover, chat reached intel only through flat
// ranked hits with the edges stripped off.
//
// Everything here is read-only and shares the cached graph analysis with the
// dashboard, so a chat question costs a lookup, not a recomputation.
import { register } from '../registry-internal';
import { normaliseName } from '$lib/jkai/intel/resolve/match';
import type { AdjacencyIndex } from '$lib/jkai/intel/analytics/model';

// The analytics modules reach `$lib/db`, and this file is imported by the tool
// registry — which is itself imported by route handlers and tests that have no
// business opening a database connection just to enumerate tool names. Loading
// them lazily inside the handlers keeps registry import free; every consumer
// that actually calls a tool pays the cost once, then the module cache serves
// the rest. (Registry import went from instant to 20s+ before this.)
// Named with a `load` prefix so they cannot be shadowed by a local variable of
// the obvious name inside a handler — `const paths = findPaths(...)` put the
// module-level `paths` loader in its function's temporal dead zone and threw.
const loadAnalytics = () => import('$lib/jkai/intel/analytics/load');
const loadPaths = () => import('$lib/jkai/intel/analytics/paths');
const loadModel = () => import('$lib/jkai/intel/analytics/model');
const loadSurprise = () => import('$lib/jkai/intel/analytics/surprise');
const loadInsights = () => import('$lib/jkai/intel/analytics/insights');
const loadCentrality = () => import('$lib/jkai/intel/analytics/centrality');
const loadSearchIntel = () => import('$lib/jkai/intel/search');

/**
 * Resolve a name the model typed to an entity id.
 *
 * The model writes names as they appear in prose, which rarely matches the
 * stored form exactly, so this walks from strict to loose: exact → normalised →
 * substring → normalised substring. Ambiguity is reported rather than guessed
 * at, because silently picking the wrong "Kelly" would poison the answer.
 */
function resolveEntity(
  index: AdjacencyIndex,
  query: string,
): { id: string; name: string } | { ambiguous: Array<{ id: string; name: string; type: string }> } | null {
  const q = query.trim();
  if (!q) return null;
  const nq = normaliseName(q);
  const nodes = index.ids.map((id) => index.byId.get(id)!).filter(Boolean);

  const exact = nodes.filter((n) => n.name.toLowerCase() === q.toLowerCase());
  if (exact.length === 1) return { id: exact[0].id, name: exact[0].name };

  const normalised = nodes.filter((n) => normaliseName(n.name) === nq);
  if (normalised.length === 1) return { id: normalised[0].id, name: normalised[0].name };

  const contains = nodes.filter((n) => normaliseName(n.name).includes(nq) && nq.length >= 3);
  const pool = exact.length ? exact : normalised.length ? normalised : contains;
  if (!pool.length) return null;
  if (pool.length === 1) return { id: pool[0].id, name: pool[0].name };

  // Several candidates: prefer the best-connected, but say so.
  const ranked = pool
    .slice()
    .sort((a, b) => (index.degree.get(b.id) ?? 0) - (index.degree.get(a.id) ?? 0));
  return {
    ambiguous: ranked.slice(0, 6).map((n) => ({ id: n.id, name: n.name, type: n.typeName })),
  };
}

function notFound(query: string) {
  return {
    success: false as const,
    error: `No entity in the intel graph matches "${query}". Try knowledge_search for text about it, or intel_find to list candidates.`,
  };
}

register({
  name: 'intel_find',
  description:
    'Find entities in the intel knowledge graph by name or partial name. Returns each match with its type, how many things it connects to, and how central it is. ' +
    'Use this first when you need an entity id for the other intel tools, or when the user asks "do I know anything about X" and you want the graph view rather than the text view.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Name or partial name to look for.' },
      type: { type: 'string', description: 'Optional entity type filter, e.g. person, organisation, project.' },
      limit: { type: 'number', description: 'Max results (default 10, max 40).' },
    },
    required: ['query'],
  },
  category: 'Knowledge',
  toolset: 'intel-graph',
  handler: async (args) => {
    const query = typeof args.query === 'string' ? args.query.trim().toLowerCase() : '';
    if (!query) return { success: false, error: 'query is required' };
    const limit = Math.min(Math.max(Number(args.limit ?? 10), 1), 40);
    const typeFilter = typeof args.type === 'string' ? args.type.toLowerCase() : null;

    const { getGraphAnalysis } = await loadAnalytics();
    const { brokerageScore } = await loadCentrality();
    const { index, centrality: cent } = await getGraphAnalysis();
    const nq = normaliseName(query);

    const hits = index.ids
      .map((id) => index.byId.get(id)!)
      .filter((n) => n && (n.name.toLowerCase().includes(query) || normaliseName(n.name).includes(nq)))
      .filter((n) => !typeFilter || n.typeName === typeFilter)
      .sort((a, b) => (index.degree.get(b.id) ?? 0) - (index.degree.get(a.id) ?? 0))
      .slice(0, limit);

    return {
      success: true,
      data: {
        count: hits.length,
        entities: hits.map((n) => ({
          id: n.id,
          name: n.name,
          type: n.typeName,
          summary: n.summary,
          connections: index.degree.get(n.id) ?? 0,
          isBroker: brokerageScore(n.id, cent, index) > 0.02,
          confirmed: n.confirmed,
        })),
        note: hits.length ? undefined : 'Nothing in the entity graph matches. knowledge_search may still find text.',
      },
    };
  },
});

register({
  name: 'intel_neighbourhood',
  description:
    'What surrounds an entity in the intel graph, out to N hops. Returns the connected entities grouped by hop distance, with the relationship describing each link. ' +
    'Use when the user asks who or what is around something ("who works on X", "what is connected to Y"), or to gather context before answering about an entity.',
  parameters: {
    type: 'object',
    properties: {
      entity: { type: 'string', description: 'Entity name or id.' },
      hops: { type: 'number', description: 'How far to walk out (default 2, max 4).' },
      limit: { type: 'number', description: 'Max entities returned (default 40, max 120).' },
    },
    required: ['entity'],
  },
  category: 'Knowledge',
  toolset: 'intel-graph',
  handler: async (args) => {
    const query = typeof args.entity === 'string' ? args.entity : '';
    const hops = Math.min(Math.max(Number(args.hops ?? 2), 1), 4);
    const limit = Math.min(Math.max(Number(args.limit ?? 40), 1), 120);

    const { getGraphAnalysis } = await loadAnalytics();
    const { hopNeighbourhood } = await loadModel();
    const analysis = await getGraphAnalysis();
    const { index, community } = analysis;
    const resolved = resolveEntity(index, query);
    if (!resolved) return notFound(query);
    if ('ambiguous' in resolved) {
      return { success: false, error: 'Several entities match that name.', data: { candidates: resolved.ambiguous } };
    }

    const reach = hopNeighbourhood(index, resolved.id, hops);
    const centre = index.byId.get(resolved.id)!;

    const edgeLabel = (a: string, b: string) => {
      const e = analysis.snapshot.edges.find(
        (x) => (x.source === a && x.target === b) || (x.source === b && x.target === a),
      );
      return e?.label ?? e?.type ?? 'related to';
    };

    const entries = [...reach.entries()]
      .filter(([id]) => id !== resolved.id)
      .sort((a, b) => a[1] - b[1] || (index.degree.get(b[0]) ?? 0) - (index.degree.get(a[0]) ?? 0))
      .slice(0, limit);

    const byHop: Record<string, Array<Record<string, unknown>>> = {};
    for (const [id, hop] of entries) {
      const n = index.byId.get(id);
      if (!n) continue;
      const key = `hop${hop}`;
      (byHop[key] ??= []).push({
        id: n.id,
        name: n.name,
        type: n.typeName,
        connections: index.degree.get(id) ?? 0,
        // Only the first hop has a direct relationship to describe.
        ...(hop === 1 ? { relationship: edgeLabel(resolved.id, id) } : {}),
        differentCluster: community.membership.get(resolved.id) !== community.membership.get(id),
      });
    }

    return {
      success: true,
      data: {
        entity: { id: centre.id, name: centre.name, type: centre.typeName, summary: centre.summary },
        directConnections: index.degree.get(resolved.id) ?? 0,
        totalWithin: entries.length,
        byHop,
      },
    };
  },
});

register({
  name: 'intel_path',
  description:
    'How two entities in the intel graph are connected — the chain of relationships between them, and alternative routes. ' +
    'Use for "how is A connected to B", "is there any link between X and Y", or to check whether two things you are discussing are actually related.',
  parameters: {
    type: 'object',
    properties: {
      from: { type: 'string', description: 'First entity name or id.' },
      to: { type: 'string', description: 'Second entity name or id.' },
      maxHops: { type: 'number', description: 'Longest route to consider (default 5, max 6).' },
    },
    required: ['from', 'to'],
  },
  category: 'Knowledge',
  toolset: 'intel-graph',
  handler: async (args) => {
    const fromQ = typeof args.from === 'string' ? args.from : '';
    const toQ = typeof args.to === 'string' ? args.to : '';
    const maxHops = Math.min(Math.max(Number(args.maxHops ?? 5), 1), 6);

    const { getGraphAnalysis } = await loadAnalytics();
    const { findPaths } = await loadPaths();
    const { index } = await getGraphAnalysis();
    const a = resolveEntity(index, fromQ);
    const b = resolveEntity(index, toQ);
    if (!a) return notFound(fromQ);
    if (!b) return notFound(toQ);
    if ('ambiguous' in a) return { success: false, error: `"${fromQ}" is ambiguous.`, data: { candidates: a.ambiguous } };
    if ('ambiguous' in b) return { success: false, error: `"${toQ}" is ambiguous.`, data: { candidates: b.ambiguous } };

    const paths = findPaths(index, a.id, b.id, { maxHops, limit: 3 });

    return {
      success: true,
      data: {
        from: a.name,
        to: b.name,
        connected: paths.length > 0,
        paths: paths.map((p) => ({
          hops: p.hops,
          // A readable chain is what the model should quote back.
          chain: p.nodes
            .map((id, i) => {
              const name = index.byId.get(id)?.name ?? id;
              const step = p.steps[i];
              return step ? `${name} —[${step.edges[0]?.label ?? step.edges[0]?.type ?? 'related to'}]→` : name;
            })
            .join(' '),
          entities: p.nodes.map((id) => index.byId.get(id)?.name ?? id),
        })),
        note: paths.length
          ? undefined
          : `No route within ${maxHops} hops. They sit in unconnected parts of the graph — which may itself be worth saying.`,
      },
    };
  },
});

register({
  name: 'intel_insights',
  description:
    'Find entities in the intel graph that are semantically related to a topic, plus any structural insights about them (brokers, unexpected connections, missing links, emerging hubs, stale entities). ' +
    'Pass a `query` (e.g. "insurance", "home automation", "John Kelly") to get the most relevant entities with their type, summary, and connection count, plus insights scoped to that topic. ' +
    'Omit `query` for the full graph-wide analytics view. This is the primary tool for topic-specific graph enrichment — cheaper than chaining intel_find + intel_neighbourhood manually.',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description:
          'REQUIRED for topic-specific lookups: natural-language query for the entities you want. Uses semantic embeddings + name matching to find the most relevant entities, then returns them with their type, summary, connections, and any structural insights involving them. ' +
          'Omit for the full graph-wide analytics view.',
      },
      kind: {
        type: 'string',
        description:
          'Optional filter: broker, unlikely_relation, missing_link, orphan, isolated_cluster, emerging_hub, stale_hub, thin_evidence, type_outlier, dominant_cluster.',
      },
      limit: { type: 'number', description: 'Max insights to return (default 10, max 30).' },
      entityLimit: { type: 'number', description: 'Max matching entities to scope to (default 10, max 30). Only used when query is provided.' },
    },
  },
  category: 'Knowledge',
  toolset: 'intel-graph',
  handler: async (args) => {
    const limit = Math.min(Math.max(Number(args.limit ?? 10), 1), 30);
    const kind = typeof args.kind === 'string' ? args.kind : null;
    const query = typeof args.query === 'string' ? args.query.trim() : '';
    const entityLimit = Math.min(Math.max(Number(args.entityLimit ?? 10), 1), 30);

    const { getGraphAnalysis, ensureEmbeddings } = await loadAnalytics();
    const { generateInsights } = await loadInsights();
    const analysis = await getGraphAnalysis();
    await ensureEmbeddings(analysis);
    let found = await generateInsights(analysis);

    let matchedEntities: Array<{ id: string; name: string; type: string; summary: string | null; connections: number }> | undefined;

    if (query) {
      const { searchIntel } = await loadSearchIntel();
      const searchResult = await searchIntel(query, { limit: entityLimit, ordering: 'relevant' });
      const entityIds = new Set(
        searchResult.items.filter((i) => i.kind === 'entity').map((i) => i.id),
      );

      // Also match by name via the analysis index — searchIntel uses embeddings
      // which may miss entities whose name is a substring match but whose
      // embedding doesn't rank them top-N. Union both signal sources.
      const nq = query.toLowerCase();
      for (const [id, node] of analysis.index.byId) {
        if (node.name.toLowerCase().includes(nq)) entityIds.add(id);
      }

      matchedEntities = [...entityIds]
        .map((id) => {
          const n = analysis.index.byId.get(id);
          if (!n) return null;
          return {
            id: n.id,
            name: n.name,
            type: n.typeName,
            summary: n.summary,
            connections: analysis.index.degree.get(n.id) ?? 0,
          };
        })
        .filter(Boolean) as Array<{ id: string; name: string; type: string; summary: string | null; connections: number }>;

      // Filter insights to only those involving matched entities
      if (matchedEntities.length > 0) {
        const matchIds = new Set(matchedEntities.map((e) => e.id));
        found = found.filter((i) => i.entityIds.some((id) => matchIds.has(id)));
      }
    }

    if (kind) found = found.filter((i) => i.kind === kind);

    return {
      success: true,
      data: {
        count: found.length,
        graph: {
          entities: analysis.index.ids.length,
          relationships: analysis.snapshot.edges.length,
          clusters: analysis.community.communities.size,
          modularity: Number(analysis.community.modularity.toFixed(3)),
        },
        entities: matchedEntities,
        insights: found.slice(0, limit).map((i) => ({
          kind: i.kind,
          title: i.title,
          detail: i.detail,
          confidence: Number(i.score.toFixed(2)),
          entities: i.entityIds.map((id) => analysis.index.byId.get(id)?.name).filter(Boolean),
          suggestedAction: `${i.action}: ${i.actionPayload}`,
        })),
        note: matchedEntities && matchedEntities.length === 0
          ? 'No entities matched the query. Try a different term, or omit query for the full graph-wide view.'
          : undefined,
      },
    };
  },
});

register({
  name: 'intel_unlikely_relations',
  description:
    'Surprising connections in the intel graph — pairs of entities that are connected but sit in different clusters, share no context, and are about unrelated subjects. ' +
    'Each comes with the reasons it was flagged and the entities it runs through. Use when the user asks what is unexpected, what they would not have guessed, or for non-obvious leads.',
  parameters: {
    type: 'object',
    properties: {
      limit: { type: 'number', description: 'Max results (default 10, max 25).' },
      maxHops: { type: 'number', description: 'Longest connection to consider surprising (default 3).' },
    },
  },
  category: 'Knowledge',
  toolset: 'intel-graph',
  handler: async (args) => {
    const limit = Math.min(Math.max(Number(args.limit ?? 10), 1), 25);
    const maxHops = Math.min(Math.max(Number(args.maxHops ?? 3), 2), 4);

    const { getGraphAnalysis, ensureEmbeddings } = await loadAnalytics();
    const { scoreSurprisingLinks } = await loadSurprise();
    const analysis = await getGraphAnalysis();
    await ensureEmbeddings(analysis);
    const links = await scoreSurprisingLinks(
      { index: analysis.index, membership: analysis.community.membership, embeddings: analysis.embeddings },
      { maxHops, limit, minScore: 0.05 },
    );
    const name = (id: string) => analysis.index.byId.get(id)?.name ?? id;

    return {
      success: true,
      data: {
        count: links.length,
        relations: links.map((l) => ({
          a: name(l.a),
          b: name(l.b),
          hops: l.hops,
          surprise: Number(l.score.toFixed(3)),
          why: l.reasons.join('; '),
          via: l.via.map(name),
        })),
        note: links.length ? undefined : 'Nothing surprising found — the graph may be too small or too uniform yet.',
      },
    };
  },
});
