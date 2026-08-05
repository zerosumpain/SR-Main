// The longest the event loop is blocked while the insights path runs.
//
//   INTEL_DB_URL=postgresql://... npx tsx scripts/bench-intel-loop-block.ts
//
// This is the number that decides whether production stays up, not wall clock.
// /api/health/workflow-engine returns 503 once a single blocking span passes 5s,
// and a systemd watchdog restarts the service on a 503 — which kills whatever
// request was in flight and reaches the browser as a 502. Measured on the live
// graph before the yields went in: 65s, then 5-7s.
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

/** Samples the loop every 10ms; a gap longer than that is a blocking span. */
function watchLoop() {
  let worst = 0;
  let last = Date.now();
  const timer = setInterval(() => {
    const now = Date.now();
    worst = Math.max(worst, now - last - 10);
    last = now;
  }, 10);
  timer.unref?.();
  return {
    reset() { worst = 0; last = Date.now(); },
    peek() { return worst; },
    stop() { clearInterval(timer); },
  };
}

const er = await pool.query(`
  SELECT e.id, e.name, e.type_id, COALESCE(t.name,'unknown') type_name,
         COALESCE(t.icon,'x') icon, COALESCE(t.color,'#000') color,
         e.summary, e.confidence, e.confirmed, e.embedding::text AS embedding, e.aliases
  FROM intel_entities e LEFT JOIN intel_entity_types t ON t.id = e.type_id
  WHERE e.merged_into_id IS NULL`);

const embeddings = new Map<string, number[]>();
const nodes: GraphNode[] = er.rows.map((r) => {
  const id = String(r.id);
  if (typeof r.embedding === 'string' && r.embedding.trim()) {
    const v = r.embedding.trim().replace(/^\[|\]$/g, '').split(',').map(Number);
    if (v.length && v.every(Number.isFinite)) embeddings.set(id, v);
  }
  return {
    id, name: String(r.name ?? ''), typeId: String(r.type_id ?? ''), typeName: String(r.type_name),
    icon: String(r.icon), color: String(r.color), summary: r.summary == null ? null : String(r.summary),
    confidence: String(r.confidence ?? 'medium'), confirmed: Boolean(r.confirmed),
    createdAt: 0, updatedAt: 0, noteCount: 0, lastSeenAt: 0, evidenceAt: 0,
    aliases: arr(r.aliases), categories: [], sources: [],
  };
});

const rr = await pool.query(`
  SELECT r.id, COALESCE(sm.id, r.source_entity_id) source, COALESCE(tm.id, r.target_entity_id) target,
         r.type, r.label, r.confidence, r.strength, r.weight
  FROM intel_relationships r
  LEFT JOIN intel_entities s ON s.id = r.source_entity_id
  LEFT JOIN intel_entities sm ON sm.id = s.merged_into_id
  LEFT JOIN intel_entities t ON t.id = r.target_entity_id
  LEFT JOIN intel_entities tm ON tm.id = t.merged_into_id
  WHERE r.suppressed IS NOT TRUE`);

const edges: GraphEdge[] = rr.rows.map((r) => ({
  id: String(r.id), source: String(r.source), target: String(r.target),
  type: String(r.type ?? 'related_to'), label: r.label == null ? null : String(r.label),
  confidence: String(r.confidence ?? 'medium'), strength: String(r.strength ?? 'moderate'),
  createdAt: 0, weight: Number(r.weight) || 0.5, lastSeenAt: 0, sourceKind: null,
}));

const snapshot: GraphSnapshot = { nodes, edges };
const index = buildIndex(snapshot);
console.log(`graph: ${nodes.length} nodes / ${edges.length} edges, ${embeddings.size} embeddings\n`);

const loop = watchLoop();
const run = async <T>(label: string, fn: () => Promise<T> | T): Promise<T> => {
  loop.reset();
  const t0 = performance.now();
  const out = await fn();
  const ms = performance.now() - t0;
  console.log(
    `${label.padEnd(34)} wall ${ms.toFixed(0).padStart(6)} ms   longest block ${loop.peek().toString().padStart(5)} ms` +
      (loop.peek() >= 5000 ? '   <-- WATCHDOG TRIPS' : ''),
  );
  return out;
};

const centrality = await run('computeCentrality', () => computeCentrality(index));
const community = await run('detectCommunities', () => detectCommunities(index));
const analysis = {
  snapshot, index, centrality, community, embeddings,
  suppressedPairs: new Set<string>(), computedAt: Date.now(),
};

await run('generateInsights', () => generateInsights(analysis as never));
await run('scoreSurprisingLinks maxHops=3', () =>
  scoreSurprisingLinks({ index, membership: community.membership, embeddings }, { maxHops: 3, limit: 20, minScore: 0.08 }));
await run('predictMissingLinks', () =>
  predictMissingLinks({ index, membership: community.membership, suppressedPairs: new Set() }, { limit: 15, minScore: 0.8 }));

loop.stop();
await pool.end();
