// Times what /api/jkai/intel/insights actually does per request, on a real
// graph. The analysis snapshot is cached for 60s; everything below it is not,
// so each of these is paid in full on every dashboard poll.
//
//   INTEL_DB_URL=postgresql://... npx tsx scripts/bench-intel-insights.ts
import { Pool } from 'pg';
import { buildIndex, type GraphSnapshot, type GraphNode, type GraphEdge } from '../src/lib/jkai/intel/analytics/model';
import { computeCentrality } from '../src/lib/jkai/intel/analytics/centrality';
import { detectCommunities } from '../src/lib/jkai/intel/analytics/community';
import { generateInsights } from '../src/lib/jkai/intel/analytics/insights';
import { scoreSurprisingLinks, predictMissingLinks } from '../src/lib/jkai/intel/analytics/surprise';

const url = process.env.INTEL_DB_URL;
if (!url) throw new Error('set INTEL_DB_URL');
const pool = new Pool({ connectionString: url, max: 2 });

const arr = (raw: unknown): string[] => (Array.isArray(raw) ? raw.filter((v) => typeof v === 'string') : []);

const er = await pool.query(`
  SELECT e.id, e.name, e.type_id, COALESCE(t.name,'unknown') type_name,
         COALESCE(t.icon,'🔷') icon, COALESCE(t.color,'#7dd3fc') color,
         e.summary, e.confidence, e.confirmed, e.created_at, e.updated_at, e.embedding::text AS embedding, e.aliases,
         COALESCE(ne.note_count,0) note_count, ne.last_seen_at,
         COALESCE(ne.categories, ARRAY[]::text[]) categories, COALESCE(ne.sources, ARRAY[]::text[]) sources
  FROM intel_entities e
  LEFT JOIN intel_entity_types t ON t.id = e.type_id
  LEFT JOIN (
    SELECT ne.entity_id, COUNT(DISTINCT ne.note_id)::int note_count, MAX(n.created_at) last_seen_at,
           ARRAY_AGG(DISTINCT cat.value) FILTER (WHERE cat.value IS NOT NULL) categories,
           ARRAY_AGG(DISTINCT n.source) FILTER (WHERE n.source IS NOT NULL) sources
    FROM intel_note_entities ne JOIN intel_notes n ON n.id = ne.note_id
    LEFT JOIN LATERAL jsonb_array_elements_text(COALESCE(n.categories,'[]'::jsonb)) AS cat(value) ON TRUE
    GROUP BY ne.entity_id
  ) ne ON ne.entity_id = e.id
  WHERE e.merged_into_id IS NULL`);

const embeddings = new Map<string, number[]>();
const nodes: GraphNode[] = er.rows.map((r) => {
  const id = String(r.id);
  if (typeof r.embedding === 'string' && r.embedding.trim()) {
    const v = r.embedding.trim().replace(/^\[|\]$/g, '').split(',').map(Number);
    if (v.every(Number.isFinite) && v.length) embeddings.set(id, v);
  }
  return {
    id, name: String(r.name ?? ''), typeId: String(r.type_id ?? ''), typeName: String(r.type_name),
    icon: String(r.icon), color: String(r.color), summary: r.summary == null ? null : String(r.summary),
    confidence: String(r.confidence ?? 'medium'), confirmed: Boolean(r.confirmed),
    createdAt: r.created_at ? new Date(r.created_at).getTime() : 0,
    updatedAt: r.updated_at ? new Date(r.updated_at).getTime() : 0,
    noteCount: Number(r.note_count ?? 0),
    lastSeenAt: r.last_seen_at ? new Date(r.last_seen_at).getTime() : 0,
    aliases: arr(r.aliases), categories: arr(r.categories), sources: arr(r.sources),
  };
});

const rr = await pool.query(`
  SELECT r.id, COALESCE(sm.id, r.source_entity_id) source, COALESCE(tm.id, r.target_entity_id) target,
         r.type, r.label, r.confidence, r.strength, r.created_at, r.weight, r.last_seen_at
  FROM intel_relationships r
  LEFT JOIN intel_entities s ON s.id = r.source_entity_id
  LEFT JOIN intel_entities sm ON sm.id = s.merged_into_id
  LEFT JOIN intel_entities t ON t.id = r.target_entity_id
  LEFT JOIN intel_entities tm ON tm.id = t.merged_into_id
  WHERE r.suppressed IS NOT TRUE`);

const edges: GraphEdge[] = rr.rows.map((r) => ({
  id: String(r.id), source: String(r.source), target: String(r.target), type: String(r.type ?? 'related_to'),
  label: r.label == null ? null : String(r.label), confidence: String(r.confidence ?? 'medium'),
  strength: String(r.strength ?? 'moderate'), createdAt: 0, weight: Number(r.weight) || 0.5,
  lastSeenAt: 0, sourceKind: null,
}));

const snapshot: GraphSnapshot = { nodes, edges };
const index = buildIndex(snapshot);
console.log(`graph: ${nodes.length} nodes / ${edges.length} edges, ${embeddings.size} embeddings\n`);

const time = async <T>(label: string, fn: () => T | Promise<T>): Promise<T> => {
  const t0 = performance.now();
  const out = await fn();
  console.log(`${label.padEnd(42)} ${(performance.now() - t0).toFixed(0).padStart(9)} ms`);
  return out;
};

const centrality = await time('computeCentrality  (cached 60s)', () => computeCentrality(index));
const community = await time('detectCommunities  (cached 60s)', () => detectCommunities(index));

const analysis = {
  snapshot, index, centrality, community, embeddings,
  suppressedPairs: new Set<string>(), computedAt: Date.now(),
};

console.log('\n-- per request, NOT cached --');
await time('generateInsights', () => generateInsights(analysis as never));
await time('scoreSurprisingLinks maxHops=3 (shipped)', () =>
  scoreSurprisingLinks({ index, membership: community.membership, embeddings }, { maxHops: 3, limit: 20, minScore: 0.08 }));
await time('scoreSurprisingLinks maxHops=2', () =>
  scoreSurprisingLinks({ index, membership: community.membership, embeddings }, { maxHops: 2, limit: 20, minScore: 0.08 }));
await time('predictMissingLinks', () =>
  predictMissingLinks({ index, membership: community.membership, suppressedPairs: new Set() }, { limit: 15, minScore: 0.8 }));

await pool.end();
