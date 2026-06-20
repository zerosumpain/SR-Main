// split-yarmouth.ts — fix the Great Yarmouth Yacht Station topology.
//
// The lower River Bure is ONE long graph edge that ends at the Bure/Yare
// confluence (the gateway to Breydon Water), and BOTH low Yarmouth bridges
// (Acle Road ~2.13 m, Vauxhall rail ~2.06 m) sit on it. There is no node at the
// Yacht Station, so the Yacht Station mooring snaps to the confluence node —
// which is DOWNSTREAM of both bridges. Routing a >2.06 m boat to the Yacht
// Station then wrongly requires it to clear Vauxhall.
//
// In reality the Yacht Station moorings are UPSTREAM (north) of both bridges
// (Broads Authority / norfolkbroadsboathire.biz: "the Yacht Station moorings are
// positioned above the Vauxhall Bridge"). You reach them from the north WITHOUT
// a low bridge (Ludham 2.59 m is the pinch); the bridges only gate continuing
// SOUTH through Yarmouth to Breydon.
//
// Fix: split the lower-Bure edge just upstream of the Acle Road bridge, insert a
// node `n-ys-yarmouth` there, and keep both bridges on the DOWNSTREAM segment.
// Idempotent. Runs AFTER build-graph, BEFORE build-restrictions (which re-snaps
// the bridges onto the split segments) and build-moorings (which snaps the Yacht
// Station mooring onto the new node). Run: npx tsx scripts/broads-pilot/split-yarmouth.ts
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BRIDGES } from './lib/seed-restrictions.ts';

const DIR = join(process.cwd(), 'static', 'broads-pilot');
const GP = join(DIR, 'graph.json');
const YS_NODE = 'n-ys-yarmouth';

type LatLng = [number, number];
const hav = (a: LatLng, b: LatLng) => {
  const R = 6371000, t = (d: number) => (d * Math.PI) / 180;
  const dla = t(b[0] - a[0]), dlo = t(b[1] - a[1]);
  const x = Math.sin(dla / 2) ** 2 + Math.cos(t(a[0])) * Math.cos(t(b[0])) * Math.sin(dlo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
};
const lenOf = (g: LatLng[]) => { let s = 0; for (let i = 1; i < g.length; i++) s += hav(g[i - 1], g[i]); return s; };
const nearestIdx = (geom: LatLng[], p: LatLng) => {
  let bi = -1, bd = Infinity;
  geom.forEach((q, i) => { const d = hav(q, p); if (d < bd) { bd = d; bi = i; } });
  return { bi, bd };
};

interface Edge { id: string; from: string; to: string; length_m: number; river: string; geometry: LatLng[]; restriction_ids: string[]; [k: string]: unknown }
interface Graph { nodes: { id: string; lat: number; lng: number }[]; edges: Edge[] }

const graph = JSON.parse(readFileSync(GP, 'utf8')) as Graph;
if (graph.nodes.some((n) => n.id === YS_NODE)) {
  console.log('· already split (n-ys-yarmouth exists) — nothing to do');
  process.exit(0);
}

const acle = BRIDGES.find((b) => b.id === 'yarmouth-acle-road')!;
const acleP: LatLng = [acle.lat, acle.lng];

// The lower-Bure edge = the River Bure edge whose geometry passes closest to the
// Acle Road bridge (robust whether or not restriction_ids are assigned yet).
let edge: Edge | null = null, best = Infinity;
for (const e of graph.edges) {
  if (!/bure/i.test(e.river)) continue;
  const { bd } = nearestIdx(e.geometry as LatLng[], acleP);
  if (bd < best) { best = bd; edge = e; }
}
if (!edge) throw new Error('lower-Bure edge not found');

const geom = edge.geometry as LatLng[];
const { bi: acleIdx } = nearestIdx(geom, acleP);
// Split one point UPSTREAM of the Acle Road bridge (toward the edge's FROM end).
// The edge runs north→confluence, so upstream = smaller index.
const K = Math.max(1, Math.min(geom.length - 2, acleIdx - 1));
const splitPt = geom[K];

const ysNode = { id: YS_NODE, lat: splitPt[0], lng: splitPt[1] };

// Partition any existing restriction_ids by which segment the bridge sits in.
const upIds: string[] = [], downIds: string[] = [];
for (const rid of edge.restriction_ids) {
  const b = BRIDGES.find((x) => x.id === rid);
  const idx = b ? nearestIdx(geom, [b.lat, b.lng]).bi : geom.length - 1;
  (idx <= K ? upIds : downIds).push(rid);
}

const up: Edge = { ...edge, id: `${edge.id}-up`, to: ysNode.id, geometry: geom.slice(0, K + 1), restriction_ids: upIds };
const down: Edge = { ...edge, id: `${edge.id}-yar`, from: ysNode.id, geometry: geom.slice(K), restriction_ids: downIds };
up.length_m = Math.round(lenOf(up.geometry as LatLng[]));
down.length_m = Math.round(lenOf(down.geometry as LatLng[]));

graph.nodes.push(ysNode);
graph.edges = graph.edges.filter((e) => e.id !== edge!.id);
graph.edges.push(up, down);
writeFileSync(GP, JSON.stringify(graph));

console.log(`✓ split ${edge.id} at idx ${K} (${splitPt[0].toFixed(5)},${splitPt[1].toFixed(5)}) → ${up.id} [${upIds}] + ${down.id} [${downIds}]`);
console.log(`  new node ${YS_NODE} sits ${Math.round(hav(splitPt, acleP))} m upstream of Acle Road bridge`);
