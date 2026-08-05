// Times the intel analytics pipeline on a synthetic graph the size of the live
// one, so an optimisation can be measured rather than asserted.
//
//   npx tsx scripts/bench-intel-analytics.ts [nodes] [edges]
//
// Defaults match production on 2026-08-05: 5,338 entities / 5,356 relationships.
import { buildIndex, type GraphSnapshot, type GraphNode, type GraphEdge } from '../src/lib/jkai/intel/analytics/model';
import { betweenness, pagerank } from '../src/lib/jkai/intel/analytics/centrality';
import { detectCommunities } from '../src/lib/jkai/intel/analytics/community';

const N = Number(process.argv[2] ?? 5338);
const E = Number(process.argv[3] ?? 5356);

// Deterministic PRNG so two runs of the bench compare like with like.
let seed = 42;
const rnd = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};

const nodes: GraphNode[] = Array.from({ length: N }, (_, i) => ({
  id: `n${i}`,
  name: `Entity ${i}`,
  typeId: 't1',
  typeName: 'person',
  icon: '🔷',
  color: '#7dd3fc',
  summary: null,
  confidence: 'medium',
  confirmed: false,
  createdAt: 0,
  updatedAt: 0,
  noteCount: 1,
  lastSeenAt: 0,
  aliases: [],
  categories: [],
  sources: ['email'],
}));

// Preferential attachment, so the degree distribution is heavy-tailed like the
// real graph rather than uniform — betweenness cost is sensitive to that.
const targets: number[] = [];
const edges: GraphEdge[] = [];
for (let i = 0; i < E; i++) {
  const a = Math.floor(rnd() * N);
  const b = targets.length && rnd() < 0.6 ? targets[Math.floor(rnd() * targets.length)] : Math.floor(rnd() * N);
  if (a === b) continue;
  targets.push(a, b);
  edges.push({
    id: `e${i}`,
    source: `n${a}`,
    target: `n${b}`,
    type: 'related_to',
    label: null,
    confidence: 'medium',
    strength: 'moderate',
    createdAt: 0,
    weight: 0.5,
    lastSeenAt: 0,
    sourceKind: 'email',
  });
}

const snapshot: GraphSnapshot = { nodes, edges };

const time = async <T>(label: string, fn: () => T | Promise<T>): Promise<T> => {
  const t0 = performance.now();
  const out = await fn();
  console.log(`${label.padEnd(22)} ${(performance.now() - t0).toFixed(0).padStart(8)} ms`);
  return out;
};

console.log(`graph: ${N} nodes / ${edges.length} edges\n`);

const index = await time('buildIndex', () => buildIndex(snapshot));
await time('betweenness', () => betweenness(index));
await time('pagerank', () => pagerank(index));
await time('detectCommunities', () => detectCommunities(index));
