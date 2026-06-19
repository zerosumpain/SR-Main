// Diagnostic: re-derive components from graph.json (ignoring synthetic edges
// way_id<0) and describe each — node count, km, bbox, dominant rivers.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { UnionFind } from './lib/geo.ts';

const g = JSON.parse(readFileSync(join(process.cwd(), 'static', 'broads-pilot', 'graph.json'), 'utf8'));
const idx = new Map<string, number>();
g.nodes.forEach((n: any, i: number) => idx.set(n.id, i));
const uf = new UnionFind(g.nodes.length);
const real = g.edges.filter((e: any) => e.way_id >= 0);
for (const e of real) uf.union(idx.get(e.from)!, idx.get(e.to)!);

const comps = new Map<number, { nodes: string[]; km: number; rivers: Map<string, number> }>();
for (const e of real) {
  const r = uf.find(idx.get(e.from)!);
  const c = comps.get(r) || comps.set(r, { nodes: [], km: 0, rivers: new Map() }).get(r)!;
  c.km += e.length_m / 1000;
  c.rivers.set(e.river, (c.rivers.get(e.river) || 0) + e.length_m / 1000);
}
const node = (id: string) => g.nodes[idx.get(id)!];
for (const [r, i] of idx) {
  const root = uf.find(i);
  comps.get(root)?.nodes.push(r);
}
const ranked = [...comps.entries()].sort((a, b) => b[1].km - a[1].km).slice(0, 5);
for (const [, c] of ranked) {
  const lats = c.nodes.map((n) => node(n).lat);
  const lngs = c.nodes.map((n) => node(n).lng);
  const rivers = [...c.rivers.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([n, km]) => `${n} ${km.toFixed(1)}km`).join(', ');
  console.log(`comp ${c.km.toFixed(1)}km, ${c.nodes.length} nodes | bbox lat[${Math.min(...lats).toFixed(3)},${Math.max(...lats).toFixed(3)}] lng[${Math.min(...lngs).toFixed(3)},${Math.max(...lngs).toFixed(3)}]`);
  console.log(`     rivers: ${rivers}`);
}
const conn = g.edges.filter((e: any) => e.way_id < 0);
console.log(`\nsynthetic edges (${conn.length}):`);
for (const e of conn) {
  const a = node(e.from), b = node(e.to);
  console.log(`  ${e.river} ${e.length_m}m  [${a.lat.toFixed(3)},${a.lng.toFixed(3)}] → [${b.lat.toFixed(3)},${b.lng.toFixed(3)}]`);
}
