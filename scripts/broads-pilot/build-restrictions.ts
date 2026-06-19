// build-restrictions.ts — write static/broads-pilot/restrictions.json from the
// curated seed, snapping each bridge onto the nearest point of its expected
// river and stamping its id onto that graph edge's restriction_ids (so the
// router gates passage by boat air-draft/beam).
//
// Run AFTER build-graph.ts:  npx tsx scripts/broads-pilot/build-restrictions.ts

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { haversine } from './lib/geo.ts';
import { BRIDGES, LOCK, ZONES, type SeedBridge } from './lib/seed-restrictions.ts';

type LatLng = [number, number];
interface Edge { id: string; river: string; geometry: LatLng[]; restriction_ids: string[] }
const DIR = join(process.cwd(), 'static', 'broads-pilot');
const graph = JSON.parse(readFileSync(join(DIR, 'graph.json'), 'utf8')) as { edges: Edge[] };

// Idempotent: clear any prior associations before re-stamping.
for (const e of graph.edges) e.restriction_ids = [];

function snap(b: SeedBridge): { id: string; d: number; p: LatLng } | null {
  let best: { id: string; d: number; p: LatLng } | null = null;
  const onRiver = (river: string) =>
    b.attach_rivers.some((r) => river.toLowerCase().includes(r.toLowerCase()));
  for (const pass of [true, false]) {
    // pass 1: only edges of the expected river; pass 2 (fallback): any edge.
    for (const e of graph.edges) {
      if (pass && !onRiver(e.river)) continue;
      for (const p of e.geometry) {
        const d = haversine(b.lat, b.lng, p[0], p[1]);
        if (!best || d < best.d) best = { id: e.id, d, p };
      }
    }
    if (best) break;
  }
  return best;
}

const assoc: { bridge: string; edge: string; dist_m: number; snapped: string }[] = [];
let maxD = 0;
// Output bridges carry the snapped (on-channel) coordinate so markers sit on the water.
const outBridges = BRIDGES.map((b) => {
  const s = snap(b);
  if (!s) throw new Error(`no edge found for bridge ${b.id}`);
  const e = graph.edges.find((x) => x.id === s.id)!;
  if (!e.restriction_ids.includes(b.id)) e.restriction_ids.push(b.id);
  assoc.push({ bridge: b.id, edge: s.id, dist_m: Math.round(s.d), snapped: `${s.p[0].toFixed(4)},${s.p[1].toFixed(4)}` });
  maxD = Math.max(maxD, s.d);
  const { attach_rivers, ...rest } = b;
  return { ...rest, lat: s.p[0], lng: s.p[1] };
});
console.table(assoc);

function circle(center: LatLng, r: number, n = 18): LatLng[] {
  const [lat, lng] = center;
  const pts: LatLng[] = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * 2 * Math.PI;
    const dLat = (r * Math.cos(a)) / 111320;
    const dLng = (r * Math.sin(a)) / (111320 * Math.cos((lat * Math.PI) / 180));
    pts.push([lat + dLat, lng + dLng]);
  }
  return pts;
}
const zones = ZONES.map((z) => ({
  id: z.id, type: z.type, geometry: circle(z.center, z.radius_m), notes: `${z.name} — ${z.notes}`,
}));

writeFileSync(join(DIR, 'restrictions.json'), JSON.stringify({ bridges: outBridges, lock: LOCK, zones }));
writeFileSync(join(DIR, 'graph.json'), JSON.stringify(graph));

const tagged = graph.edges.filter((e) => e.restriction_ids.length).length;
console.log(`✓ restrictions.json: ${outBridges.length} bridges, 1 lock, ${zones.length} zones`);
console.log(`✓ graph.json: ${tagged} edges carry a bridge restriction; max snap = ${maxD.toFixed(0)} m`);
if (maxD > 700) console.warn(`⚠ a bridge snapped ${maxD.toFixed(0)} m from its seed coordinate — verify it`);
