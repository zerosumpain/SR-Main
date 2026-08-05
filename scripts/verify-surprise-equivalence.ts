// Proves the BFS-tree rewrite of scoreSurprisingLinks returns exactly what the
// per-pair-BFS version returned, on the real graph.
//
//   INTEL_DB_URL=postgresql://... npx tsx scripts/verify-surprise-equivalence.ts
//
// Temporary: needs src/lib/jkai/intel/analytics/__surprise_old.ts, produced with
//   git show <sha>:src/lib/jkai/intel/analytics/surprise.ts > …/__surprise_old.ts
import { Pool } from 'pg';
import { buildIndex, type GraphSnapshot, type GraphNode, type GraphEdge } from '../src/lib/jkai/intel/analytics/model';
import { detectCommunities } from '../src/lib/jkai/intel/analytics/community';
import { scoreSurprisingLinks as newImpl } from '../src/lib/jkai/intel/analytics/surprise';
import { scoreSurprisingLinks as oldImpl } from '../src/lib/jkai/intel/analytics/__surprise_old';

const url = process.env.INTEL_DB_URL;
if (!url) throw new Error('set INTEL_DB_URL');
const pool = new Pool({ connectionString: url, max: 2 });
const arr = (raw: unknown): string[] => (Array.isArray(raw) ? raw.filter((v) => typeof v === 'string') : []);

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
    createdAt: 0, updatedAt: 0, noteCount: 0, lastSeenAt: 0,
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
const { membership } = detectCommunities(index);
console.log(`graph: ${nodes.length} nodes / ${edges.length} edges\n`);

// A big limit so the comparison covers the whole ranked list, not just the
// twenty the endpoint ships — a rewrite that only agreed on the podium would
// still be a behaviour change further down.
const OPTS = { maxHops: 3, limit: 100000, minScore: 0.08 };
const ctx = { index, membership, embeddings };

const t1 = performance.now();
const oldOut = oldImpl(ctx, OPTS);
const oldMs = performance.now() - t1;

const t2 = performance.now();
const newOut = newImpl(ctx, OPTS);
const newMs = performance.now() - t2;

console.log(`old (per-pair BFS)  ${oldMs.toFixed(0).padStart(8)} ms  -> ${oldOut.length} links`);
console.log(`new (BFS tree)      ${newMs.toFixed(0).padStart(8)} ms  -> ${newOut.length} links`);
console.log(`speedup: ${(oldMs / newMs).toFixed(0)}x\n`);

const key = (l: { a: string; b: string }) => (l.a < l.b ? `${l.a}|${l.b}` : `${l.b}|${l.a}`);
const oldMap = new Map(oldOut.map((l) => [key(l), l]));
const newMap = new Map(newOut.map((l) => [key(l), l]));

const onlyOld = [...oldMap.keys()].filter((k) => !newMap.has(k));
const onlyNew = [...newMap.keys()].filter((k) => !oldMap.has(k));
console.log(`pairs only in old: ${onlyOld.length}`);
console.log(`pairs only in new: ${onlyNew.length}`);

let scoreDiffs = 0, reasonDiffs = 0, maxDelta = 0;
for (const [k, o] of oldMap) {
  const n = newMap.get(k);
  if (!n) continue;
  const d = Math.abs(o.score - n.score);
  if (d > 1e-12) { scoreDiffs++; maxDelta = Math.max(maxDelta, d); }
  if (JSON.stringify(o.reasons) !== JSON.stringify(n.reasons)) reasonDiffs++;
}
console.log(`shared pairs with differing score  : ${scoreDiffs} (max delta ${maxDelta})`);
console.log(`shared pairs with differing reasons: ${reasonDiffs}`);

// Order matters too: the endpoint slices the top N off this list.
const sameOrder = oldOut.length === newOut.length && oldOut.every((l, i) => key(l) === key(newOut[i]));
console.log(`\nidentical ranked order: ${sameOrder}`);
console.log(sameOrder && !onlyOld.length && !onlyNew.length && !scoreDiffs && !reasonDiffs
  ? '\nEQUIVALENT — byte-for-byte the same result set.'
  : '\nNOT EQUIVALENT — investigate before shipping.');

await pool.end();
