// Accuracy + cost of sampled-source betweenness against an exact pass.
//
//   npx tsx scripts/bench-intel-betweenness.ts [nodes] [edges]
//
// Sampling is the only approximation in the analytics layer, and what consumes
// betweenness is either a RANKING (watchlist broker percentile, insight order)
// or the coarse `brokerage > 0.02` threshold that decides labels and broker
// cages. So this measures those, not the raw values: rank correlation over the
// top of the distribution, and the agreement of the threshold set.
import { buildIndex, type GraphSnapshot, type GraphNode, type GraphEdge } from '../src/lib/jkai/intel/analytics/model';
import { betweenness, brokerageScore, type CentralityScores } from '../src/lib/jkai/intel/analytics/centrality';

const N = Number(process.argv[2] ?? 5338);
const E = Number(process.argv[3] ?? 5356);

let seed = 42;
const rnd = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};

const nodes: GraphNode[] = Array.from({ length: N }, (_, i) => ({
  id: `n${i}`, name: `Entity ${i}`, typeId: 't1', typeName: 'person', icon: '🔷',
  color: '#7dd3fc', summary: null, confidence: 'medium', confirmed: false,
  createdAt: 0, updatedAt: 0, noteCount: 1, lastSeenAt: 0,
  aliases: [], categories: [], sources: ['email'],
}));

const targets: number[] = [];
const edges: GraphEdge[] = [];
for (let i = 0; i < E; i++) {
  const a = Math.floor(rnd() * N);
  const b = targets.length && rnd() < 0.6 ? targets[Math.floor(rnd() * targets.length)] : Math.floor(rnd() * N);
  if (a === b) continue;
  targets.push(a, b);
  edges.push({
    id: `e${i}`, source: `n${a}`, target: `n${b}`, type: 'related_to', label: null,
    confidence: 'medium', strength: 'moderate', createdAt: 0, weight: 0.5,
    lastSeenAt: 0, sourceKind: 'email',
  });
}

const snapshot: GraphSnapshot = { nodes, edges };
const index = buildIndex(snapshot);

// The module picks its own path by size, so the exact reference is obtained by
// running the same code over a graph small enough to stay on the exact branch
// is not possible here — instead we re-implement the exact pass once, in the
// obvious O(V·E) way, purely as a reference oracle for this benchmark.
function exactBetweenness(): Map<string, number> {
  const ids = index.ids;
  const n = ids.length;
  const pos = new Map(ids.map((id, i) => [id, i]));
  const nbrs = ids.map((id) => [...(index.neighbours.get(id) ?? [])].map((x) => pos.get(x)!));
  const total = new Float64Array(n);
  const dist = new Int32Array(n);
  const sigma = new Float64Array(n);
  const delta = new Float64Array(n);
  const order = new Int32Array(n);

  for (let s = 0; s < n; s++) {
    dist.fill(-1); sigma.fill(0); delta.fill(0);
    sigma[s] = 1; dist[s] = 0;
    order[0] = s;
    let head = 0, tail = 1;
    while (head < tail) {
      const v = order[head++];
      for (const w of nbrs[v]) {
        if (dist[w] < 0) { dist[w] = dist[v] + 1; order[tail++] = w; }
        if (dist[w] === dist[v] + 1) sigma[w] += sigma[v];
      }
    }
    for (let i = tail - 1; i > 0; i--) {
      const w = order[i];
      for (const v of nbrs[w]) {
        if (dist[v] === dist[w] - 1) delta[v] += (sigma[v] / sigma[w]) * (1 + delta[w]);
      }
      total[w] += delta[w];
    }
  }
  const denom = n > 2 ? (n - 1) * (n - 2) : 1;
  return new Map(ids.map((id, i) => [id, total[i] / denom]));
}

console.log(`graph: ${N} nodes / ${edges.length} edges\n`);

const t1 = performance.now();
const exact = exactBetweenness();
const exactMs = performance.now() - t1;

const t2 = performance.now();
const approx = await betweenness(index);
const approxMs = performance.now() - t2;

console.log(`exact (reference)   ${exactMs.toFixed(0).padStart(8)} ms`);
console.log(`shipped (sampled)   ${approxMs.toFixed(0).padStart(8)} ms   ${(exactMs / approxMs).toFixed(0)}x faster\n`);

const ids = index.ids;
const scoresFor = (m: Map<string, number>): CentralityScores => ({
  degree: index.degree, betweenness: m, pagerank: new Map(),
});

// 1. Does the ranking survive? Spearman over the nodes that have any
//    betweenness at all — the tail of exact zeros is noise either way.
const nonZero = ids.filter((id) => (exact.get(id) ?? 0) > 0);
const rankMap = (m: Map<string, number>) => {
  const sorted = [...nonZero].sort((a, b) => (m.get(b) ?? 0) - (m.get(a) ?? 0));
  return new Map(sorted.map((id, i) => [id, i]));
};
const rE = rankMap(exact);
const rA = rankMap(approx);
const k = nonZero.length;
let d2 = 0;
for (const id of nonZero) {
  const d = rE.get(id)! - rA.get(id)!;
  d2 += d * d;
}
const spearman = 1 - (6 * d2) / (k * (k * k - 1));
console.log(`nodes with betweenness > 0 : ${k}`);
console.log(`spearman rank correlation  : ${spearman.toFixed(4)}`);

// 2. Top-N overlap — what the dashboard actually surfaces.
for (const topN of [10, 25, 50, 100]) {
  const top = (m: Map<string, number>) =>
    new Set([...ids].sort((a, b) => (m.get(b) ?? 0) - (m.get(a) ?? 0)).slice(0, topN));
  const a = top(exact), b = top(approx);
  const overlap = [...a].filter((x) => b.has(x)).length;
  console.log(`top-${String(topN).padEnd(4)} overlap          : ${overlap}/${topN}`);
}

// 3. The `brokerage > 0.02` threshold — the one hard cut-off in the UI
//    (2D labels, 3D broker cages, the intel-graph tool's isBroker).
const brokerSet = (m: Map<string, number>) => {
  const s = scoresFor(m);
  return new Set(ids.filter((id) => brokerageScore(id, s, index) > 0.02));
};
const bE = brokerSet(exact), bA = brokerSet(approx);
const inter = [...bE].filter((x) => bA.has(x)).length;
console.log(`\nbrokerage > 0.02  exact=${bE.size}  sampled=${bA.size}  agreed=${inter}` +
  `  missed=${bE.size - inter}  extra=${bA.size - inter}`);

// 4. Determinism — the watchlist alerts on change, so two passes over the same
//    graph must agree exactly or it invents notifications.
const again = await betweenness(index);
const identical = ids.every((id) => approx.get(id) === again.get(id));
console.log(`deterministic across passes : ${identical}`);
