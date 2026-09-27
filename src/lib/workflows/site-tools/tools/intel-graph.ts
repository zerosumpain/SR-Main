// `intel-graph` toolset — jkai reasoning over the entity graph's STRUCTURE.
//
// `knowledge_search` already retrieves text about a thing. What it cannot do is
// answer structural questions: how two people are connected, who sits between
// two parts of your world, what surrounds an entity two hops out. Those are the
// questions a graph exists for, and until now the graph could not be asked them
// from chat — since the cutover, chat reached intel only through flat
// ranked hits with the edges stripped off.
//
// Everything here is read-only. SR-Jkai-Core owns the graph; these read it
// through $lib/intel-client/read, whose analysis is cached for a minute, so a
// run of graph questions in one turn costs a lookup, not a recomputation.
import { register } from '../registry-internal';
import { normaliseName } from '$lib/intel-client/names';
import type { AdjacencyIndex } from '$lib/graph-analytics/model';
import { OWNER_INTEL_SCOPE, type IntelScope } from '$lib/intel-client/scope';

/**
 * Whose graph these tools read. Chat is the owner's (a member scope gets no
 * chat intel at all), so every handler reads the owner's scope — named here
 * rather than left to the analysis's default, so the one place PR B threads a
 * caller's scope through is obvious. Pure constant: no database on import.
 */
const TOOL_SCOPE: IntelScope = OWNER_INTEL_SCOPE;

// The analytics modules reach `$lib/db`, and this file is imported by the tool
// registry — which is itself imported by route handlers and tests that have no
// business opening a database connection just to enumerate tool names. Loading
// them lazily inside the handlers keeps registry import free; every consumer
// that actually calls a tool pays the cost once, then the module cache serves
// the rest. (Registry import went from instant to 20s+ before this.)
// Named with a `load` prefix so they cannot be shadowed by a local variable of
// the obvious name inside a handler — `const paths = findPaths(...)` put the
// module-level `paths` loader in its function's temporal dead zone and threw.
const loadAnalytics = () => import('$lib/intel-client/read');
const loadPaths = () => import('$lib/graph-analytics/paths');
const loadModel = () => import('$lib/graph-analytics/model');
const loadCentrality = () => import('$lib/graph-analytics/centrality');

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
    const { index, centrality: cent } = await getGraphAnalysis(TOOL_SCOPE);
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
    const analysis = await getGraphAnalysis(TOOL_SCOPE);
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
    const { index } = await getGraphAnalysis(TOOL_SCOPE);
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
