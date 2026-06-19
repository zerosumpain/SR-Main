// build-restrictions.ts — write static/broads-pilot/restrictions.json from the
// curated seed. Bridges snap onto their river edge; ZONES (Breydon Water +
// conservation broads) use the ACTUAL OpenStreetMap water-body polygon so the
// highlight sits exactly over the water (falling back to a circle if OSM has no
// match). Run AFTER build-graph.ts.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { haversine } from './lib/geo.ts';
import { overpass, BROADS_BBOX, type OsmElement } from './lib/overpass.ts';
import { BRIDGES, LOCK, ZONES, type SeedBridge } from './lib/seed-restrictions.ts';

type LatLng = [number, number];
interface Edge { id: string; river: string; geometry: LatLng[]; restriction_ids: string[] }
const DIR = join(process.cwd(), 'static', 'broads-pilot');
const graph = JSON.parse(readFileSync(join(DIR, 'graph.json'), 'utf8')) as { edges: Edge[] };

// ---- bridges: snap onto the expected river edge ----
for (const e of graph.edges) e.restriction_ids = [];
function snap(b: SeedBridge): { id: string; d: number; p: LatLng } | null {
  let best: { id: string; d: number; p: LatLng } | null = null;
  const onRiver = (river: string) => b.attach_rivers.some((r) => river.toLowerCase().includes(r.toLowerCase()));
  for (const pass of [true, false]) {
    for (const e of graph.edges) {
      if (pass && !onRiver(e.river)) continue;
      for (const p of e.geometry) { const d = haversine(b.lat, b.lng, p[0], p[1]); if (!best || d < best.d) best = { id: e.id, d, p }; }
    }
    if (best) break;
  }
  return best;
}

// ---- zone polygons from OSM ----
function circle(center: LatLng, r: number, n = 28): LatLng[] {
  const [lat, lng] = center; const pts: LatLng[] = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * 2 * Math.PI;
    pts.push([lat + (r * Math.cos(a)) / 111320, lng + (r * Math.sin(a)) / (111320 * Math.cos((lat * Math.PI) / 180))]);
  }
  return pts;
}
function decimate(ring: LatLng[], max: number): LatLng[] {
  if (ring.length <= max) return ring;
  const step = Math.ceil(ring.length / max);
  const out = ring.filter((_, i) => i % step === 0);
  const last = ring[ring.length - 1];
  if (out[out.length - 1][0] !== last[0] || out[out.length - 1][1] !== last[1]) out.push(last);
  return out;
}
// Stitch multipolygon outer ways into one ring by connecting shared endpoints.
function stitch(ways: number[][]): number[] {
  const rem = ways.filter((w) => w.length >= 2).map((w) => [...w]);
  if (!rem.length) return [];
  const ring = rem.shift()!;
  let changed = true;
  while (rem.length && changed) {
    changed = false;
    const end = ring[ring.length - 1];
    for (let i = 0; i < rem.length; i++) {
      const w = rem[i];
      if (w[0] === end) { ring.push(...w.slice(1)); rem.splice(i, 1); changed = true; break; }
      if (w[w.length - 1] === end) { ring.push(...w.slice(0, -1).reverse()); rem.splice(i, 1); changed = true; break; }
    }
  }
  return ring;
}

async function fetchZonePolys(): Promise<Map<string, LatLng[]>> {
  const names = ZONES.map((z) => z.name.replace(/[().]/g, '')).join('|');
  const json = await overpass(`
    [out:json][timeout:120];
    ( way["natural"="water"]["name"~"^(${names})$",i](${BROADS_BBOX});
      relation["natural"="water"]["name"~"^(${names})$",i](${BROADS_BBOX}); );
    out body; >; out skel qt;
  `);
  const coord = new Map<number, LatLng>();
  const wayNodes = new Map<number, number[]>();
  for (const el of json.elements as OsmElement[]) {
    if (el.type === 'node' && el.lat != null && el.lon != null) coord.set(el.id, [el.lat, el.lon]);
    else if (el.type === 'way' && el.nodes) wayNodes.set(el.id, el.nodes);
  }
  const ringOf = (ids: number[]): LatLng[] => ids.map((n) => coord.get(n)).filter(Boolean) as LatLng[];
  const out = new Map<string, LatLng[]>();
  for (const el of json.elements as OsmElement[]) {
    const name = el.tags?.name;
    if (!name) continue;
    const zone = ZONES.find((z) => z.name.toLowerCase() === name.toLowerCase());
    if (!zone || out.has(zone.id)) continue;
    let ring: LatLng[] = [];
    if (el.type === 'way' && el.nodes) ring = ringOf(el.nodes);
    else if (el.type === 'relation' && el.members) {
      const outers = el.members.filter((m) => m.type === 'way' && (m.role === 'outer' || m.role === '')).map((m) => wayNodes.get(m.ref)).filter(Boolean) as number[][];
      ring = ringOf(stitch(outers));
    }
    if (ring.length >= 4) out.set(zone.id, decimate(ring, 160));
  }
  return out;
}

async function main() {
  const assoc: { bridge: string; edge: string; dist_m: number }[] = [];
  let maxD = 0;
  const outBridges = BRIDGES.map((b) => {
    const s = snap(b);
    if (!s) throw new Error(`no edge found for bridge ${b.id}`);
    const e = graph.edges.find((x) => x.id === s.id)!;
    if (!e.restriction_ids.includes(b.id)) e.restriction_ids.push(b.id);
    assoc.push({ bridge: b.id, edge: s.id, dist_m: Math.round(s.d) });
    maxD = Math.max(maxD, s.d);
    const { attach_rivers, ...rest } = b;
    return { ...rest, lat: s.p[0], lng: s.p[1] };
  });
  console.table(assoc);

  console.log('· fetching zone water-body polygons from OSM…');
  let polys = new Map<string, LatLng[]>();
  try { polys = await fetchZonePolys(); } catch (e) { console.warn('  zone fetch failed, using circles:', e); }
  const zones = ZONES.map((z) => {
    const osm = polys.get(z.id);
    return { id: z.id, type: z.type, geometry: osm ?? circle(z.center, z.radius_m), source: osm ? 'osm' : 'circle', notes: `${z.name} — ${z.notes}` };
  });
  for (const z of zones) console.log(`  ${z.id}: ${z.source} (${z.geometry.length} pts)`);

  writeFileSync(join(DIR, 'restrictions.json'), JSON.stringify({ bridges: outBridges, lock: LOCK, zones }));
  writeFileSync(join(DIR, 'graph.json'), JSON.stringify(graph));
  console.log(`✓ restrictions.json: ${outBridges.length} bridges, 1 lock, ${zones.length} zones (${zones.filter((z) => z.source === 'osm').length} from OSM); max bridge snap ${maxD.toFixed(0)} m`);
}

main().catch((e) => { console.error('build-restrictions FAILED:', e); process.exit(1); });
