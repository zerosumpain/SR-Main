// Produces the exact /api/jkai/intel/network payload for a given database, so
// the client-side graph views can be exercised at production scale without
// booting the app (and its schedulers) against a copy of production data.
//
//   INTEL_DB_URL=postgresql://... npx tsx scripts/dump-intel-network-payload.ts out.json
//
// The shaping below mirrors src/routes/api/jkai/intel/network/+server.ts. It is
// a diagnostic, not a second implementation: if that endpoint changes, this
// drifts, and the only thing that costs is a less faithful repro.
import { Pool } from 'pg';
import { buildIndex, components, type GraphSnapshot, type GraphNode, type GraphEdge } from '../src/lib/jkai/intel/analytics/model';
import { computeCentrality, brokerageScore } from '../src/lib/jkai/intel/analytics/centrality';
import { detectCommunities } from '../src/lib/jkai/intel/analytics/community';

const url = process.env.INTEL_DB_URL;
if (!url) throw new Error('set INTEL_DB_URL');
const out = process.argv[2] ?? 'network-payload.json';
const MAX_NODES = 600;
const minDegree = Number(process.env.MIN_DEGREE ?? 1);

const pool = new Pool({ connectionString: url, max: 2 });

const toStringArray = (raw: unknown): string[] =>
  Array.isArray(raw) ? raw.filter((v) => typeof v === 'string') : [];

const entityRes = await pool.query(`
  SELECT e.id, e.name, e.type_id,
         COALESCE(t.name,'unknown') AS type_name,
         COALESCE(t.icon,'🔷') AS icon,
         COALESCE(t.color,'#7dd3fc') AS color,
         e.summary, e.confidence, e.confirmed, e.created_at, e.updated_at,
         e.aliases,
         COALESCE(ne.note_count,0) AS note_count, ne.last_seen_at,
         COALESCE(ne.categories, ARRAY[]::text[]) AS categories,
         COALESCE(ne.sources,    ARRAY[]::text[]) AS sources
  FROM intel_entities e
  LEFT JOIN intel_entity_types t ON t.id = e.type_id
  LEFT JOIN (
    SELECT ne.entity_id,
           COUNT(DISTINCT ne.note_id)::int AS note_count,
           MAX(n.created_at) AS last_seen_at,
           ARRAY_AGG(DISTINCT cat.value) FILTER (WHERE cat.value IS NOT NULL) AS categories,
           ARRAY_AGG(DISTINCT n.source)  FILTER (WHERE n.source IS NOT NULL)  AS sources
    FROM intel_note_entities ne
    JOIN intel_notes n ON n.id = ne.note_id
    LEFT JOIN LATERAL jsonb_array_elements_text(COALESCE(n.categories,'[]'::jsonb)) AS cat(value) ON TRUE
    GROUP BY ne.entity_id
  ) ne ON ne.entity_id = e.id
  WHERE e.merged_into_id IS NULL
`);

const nodes: GraphNode[] = entityRes.rows.map((r) => ({
  id: String(r.id),
  name: String(r.name ?? ''),
  typeId: String(r.type_id ?? ''),
  typeName: String(r.type_name ?? 'unknown'),
  icon: String(r.icon ?? '🔷'),
  color: String(r.color ?? '#7dd3fc'),
  summary: r.summary == null ? null : String(r.summary),
  confidence: String(r.confidence ?? 'medium'),
  confirmed: Boolean(r.confirmed),
  createdAt: r.created_at ? new Date(r.created_at).getTime() : 0,
  updatedAt: r.updated_at ? new Date(r.updated_at).getTime() : 0,
  noteCount: Number(r.note_count ?? 0),
  lastSeenAt: r.last_seen_at ? new Date(r.last_seen_at).getTime() : 0,
  aliases: toStringArray(r.aliases),
  categories: toStringArray(r.categories),
  sources: toStringArray(r.sources),
}));

const edgeRes = await pool.query(`
  SELECT r.id,
         COALESCE(sm.id, r.source_entity_id) AS source,
         COALESCE(tm.id, r.target_entity_id) AS target,
         r.type, r.label, r.confidence, r.strength, r.created_at, r.weight, r.last_seen_at,
         n.source AS source_kind
  FROM intel_relationships r
  LEFT JOIN intel_entities s  ON s.id  = r.source_entity_id
  LEFT JOIN intel_entities sm ON sm.id = s.merged_into_id
  LEFT JOIN intel_entities t  ON t.id  = r.target_entity_id
  LEFT JOIN intel_entities tm ON tm.id = t.merged_into_id
  LEFT JOIN intel_notes n     ON n.id  = r.source_note_id
  WHERE r.suppressed IS NOT TRUE
`);

const edges: GraphEdge[] = edgeRes.rows.map((r) => ({
  id: String(r.id),
  source: String(r.source),
  target: String(r.target),
  type: String(r.type ?? 'related_to'),
  label: r.label == null ? null : String(r.label),
  confidence: String(r.confidence ?? 'medium'),
  strength: String(r.strength ?? 'moderate'),
  createdAt: r.created_at ? new Date(r.created_at).getTime() : 0,
  weight: Number.isFinite(Number(r.weight)) ? Number(r.weight) : 0.5,
  lastSeenAt: r.last_seen_at ? new Date(r.last_seen_at).getTime() : 0,
  sourceKind: r.source_kind == null ? null : String(r.source_kind),
}));

const snapshot: GraphSnapshot = { nodes, edges };
const index = buildIndex(snapshot);

const t0 = performance.now();
const centrality = await computeCentrality(index);
const community = detectCommunities(index);
console.error(`analysis: ${(performance.now() - t0).toFixed(0)} ms for ${index.ids.length} nodes / ${edges.length} edges`);

let keep = new Set(index.ids.filter((id) => (index.degree.get(id) ?? 0) >= minDegree));
let trimmed = false;
if (keep.size > MAX_NODES) {
  const ranked = [...keep].sort(
    (a, b) => (centrality.pagerank.get(b) ?? 0) - (centrality.pagerank.get(a) ?? 0),
  );
  keep = new Set(ranked.slice(0, MAX_NODES));
  trimmed = true;
}

const maxPagerank = Math.max(1e-9, ...[...keep].map((id) => centrality.pagerank.get(id) ?? 0));
const recency = () => 1;

const payloadNodes = [...keep].map((id) => {
  const n = index.byId.get(id)!;
  return {
    id: n.id, name: n.name, type: n.typeName, typeId: n.typeId, icon: n.icon,
    color: n.color, summary: n.summary, confirmed: n.confirmed, confidence: n.confidence,
    noteCount: n.noteCount, degree: index.degree.get(id) ?? 0,
    importance: (centrality.pagerank.get(id) ?? 0) / maxPagerank,
    betweenness: centrality.betweenness.get(id) ?? 0,
    brokerage: brokerageScore(id, centrality, index),
    community: community.membership.get(id) ?? 0,
    hops: null,
    categories: n.categories, sources: n.sources, aliases: n.aliases,
    recency: recency(),
  };
});

const payloadEdges = edges
  .filter((e) => keep.has(e.source) && keep.has(e.target))
  .map((e) => ({
    id: e.id, source: e.source, target: e.target, type: e.type, label: e.label,
    strength: e.strength, confidence: e.confidence, weight: e.weight,
    sourceKind: e.sourceKind, recency: recency(),
    crossCommunity: community.membership.get(e.source) !== community.membership.get(e.target),
  }));

const comps = components(index);
const payload = {
  nodes: payloadNodes,
  edges: payloadEdges,
  types: [], categories: [], sources: [],
  matched: [],
  trimmed,
  stats: {
    totalNodes: index.ids.length,
    totalEdges: edges.length,
    shown: payloadNodes.length,
    communities: community.communities.size,
    modularity: Number(community.modularity.toFixed(3)),
    components: comps.length,
    largestComponent: comps[0]?.length ?? 0,
    isolated: comps.filter((c) => c.length === 1).length,
  },
  communities: [...community.communities.entries()]
    .filter(([, ids]) => ids.length > 1)
    .slice(0, 24)
    .map(([id, ids]) => ({ id, size: ids.length, label: `Cluster ${id}` })),
};

const { writeFileSync } = await import('node:fs');
writeFileSync(out, JSON.stringify(payload));
const bytes = JSON.stringify(payload).length;
console.error(`wrote ${out}: ${payloadNodes.length} nodes / ${payloadEdges.length} edges, ${(bytes / 1024).toFixed(0)} KB`);
console.error(`brokerage > 0.02: ${payloadNodes.filter((n) => n.brokerage > 0.02).length} of ${payloadNodes.length}`);
await pool.end();
