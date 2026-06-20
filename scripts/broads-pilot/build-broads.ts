// build-broads.ts — extract the open-water polygons of the named Norfolk Broads
// (and meres) so the map can boldly highlight the broads themselves, not just a
// centroid node. Writes static/broads-pilot/broads.json.
//
// Run: npx tsx scripts/broads-pilot/build-broads.ts
//
// Strategy:
//  1. Pull named natural=water ways + relations in the Broads bbox (same query
//     build-graph uses for centroids — here we keep the geometry).
//  2. Assemble outer rings (a broad may be a single closed way OR a multipolygon
//     relation: stitch its outer member ways into closed rings).
//  3. Filter to actual broads/meres by name + a minimum area (drops ponds and
//     river/dyke polygons). Breydon Water is excluded — it's drawn as a tidal zone.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { overpass, BROADS_BBOX, type OsmElement } from './lib/overpass.ts';
import { haversine } from './lib/geo.ts';

type LatLng = [number, number];

const OUT_DIR = join(process.cwd(), 'static', 'broads-pilot');
const MIN_AREA_M2 = 15000; // ~1.5 ha — well below the smallest navigable broad, above ponds
const NEAR_NETWORK_M = 2000; // keep only broads on the navigable system (drops isolated coastal lagoons)

// Keep names that read as a broad/mere/open water; drop rivers, dykes, cuts, the
// Breydon tidal estuary (already a zone), and non-broad water (marinas, the
// ornamental Venetian Waterway, Lake Lothing harbour).
const KEEP = /broad|mere|sound|fleet|pool|\bwater\b/i;
const DROP = /river|canal|\bcut\b|dyke|dike|drain|breydon|channel|spit|marsh|marina|venetian|lothing|harbou?r/i;

/** Shoelace area (m²) of a ring via local equirectangular projection. */
function ringArea(ring: LatLng[]): number {
  if (ring.length < 3) return 0;
  const lat0 = ring[0][0];
  const kx = Math.cos((lat0 * Math.PI) / 180) * 111320;
  const ky = 110540;
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const [latA, lngA] = ring[i];
    const [latB, lngB] = ring[(i + 1) % ring.length];
    a += (lngA * kx) * (latB * ky) - (lngB * kx) * (latA * ky);
  }
  return Math.abs(a) / 2;
}

/** Stitch a set of open/closed ways (node-id lists) into closed rings. */
function stitchRings(ways: number[][]): number[][] {
  const pool = ways.map((w) => [...w]).filter((w) => w.length >= 2);
  const rings: number[][] = [];
  while (pool.length) {
    let ring = pool.shift()!;
    let progress = true;
    while (ring[0] !== ring[ring.length - 1] && progress) {
      progress = false;
      for (let i = 0; i < pool.length; i++) {
        const w = pool[i];
        const head = ring[0], tail = ring[ring.length - 1];
        if (w[0] === tail) { ring = ring.concat(w.slice(1)); pool.splice(i, 1); progress = true; break; }
        if (w[w.length - 1] === tail) { ring = ring.concat([...w].reverse().slice(1)); pool.splice(i, 1); progress = true; break; }
        if (w[w.length - 1] === head) { ring = w.slice(0, -1).concat(ring); pool.splice(i, 1); progress = true; break; }
        if (w[0] === head) { ring = [...w].reverse().slice(0, -1).concat(ring); pool.splice(i, 1); progress = true; break; }
      }
    }
    rings.push(ring);
  }
  return rings;
}

async function main() {
  console.log('· fetching named broads (with geometry)…');
  const json = await overpass(`
    [out:json][timeout:120];
    ( way["natural"="water"]["name"](${BROADS_BBOX});
      relation["natural"="water"]["name"](${BROADS_BBOX}); );
    out body; >; out skel qt;
  `);

  // graph nodes (built earlier) — used to keep only broads on the navigable system
  let netNodes: LatLng[] = [];
  try {
    const g = JSON.parse(readFileSync(join(OUT_DIR, 'graph.json'), 'utf8')) as { nodes: { lat: number; lng: number }[] };
    netNodes = g.nodes.map((n) => [n.lat, n.lng]);
  } catch { console.warn('  (graph.json not found — skipping network-proximity filter)'); }
  const nearNetwork = (rings: LatLng[][]): boolean => {
    if (!netNodes.length) return true;
    for (const r of rings) for (const [la, ln] of r)
      for (const [nla, nln] of netNodes) if (haversine(la, ln, nla, nln) < NEAR_NETWORK_M) return true;
    return false;
  };

  const coord = new Map<number, LatLng>();
  const wayNodes = new Map<number, number[]>();
  for (const el of json.elements) {
    if (el.type === 'node' && el.lat != null && el.lon != null) coord.set(el.id, [el.lat, el.lon]);
    else if (el.type === 'way' && el.nodes) wayNodes.set(el.id, el.nodes);
  }

  const toCoords = (ids: number[]): LatLng[] => ids.map((n) => coord.get(n)).filter(Boolean) as LatLng[];

  // outer rings (as coords) for a named way or relation
  const outerRings = (el: OsmElement): LatLng[][] => {
    if (el.type === 'way' && el.nodes) {
      const r = toCoords(el.nodes);
      return r.length >= 3 ? [r] : [];
    }
    if (el.type === 'relation' && el.members) {
      const outerWays = el.members
        .filter((m) => m.type === 'way' && (m.role === 'outer' || m.role === ''))
        .map((m) => wayNodes.get(m.ref))
        .filter(Boolean) as number[][];
      return stitchRings(outerWays).map(toCoords).filter((r) => r.length >= 3);
    }
    return [];
  };

  // name → { rings, area } keeping the largest representation of a given name
  const byName = new Map<string, { id: string; name: string; rings: LatLng[][]; area_m2: number }>();
  for (const el of json.elements) {
    const name = el.tags?.name;
    if (!name || (el.type !== 'way' && el.type !== 'relation')) continue;
    if (!KEEP.test(name) || DROP.test(name)) continue;
    const rings = outerRings(el);
    if (!rings.length) continue;
    const area = rings.reduce((s, r) => s + ringArea(r), 0);
    if (area < MIN_AREA_M2) continue;
    if (!nearNetwork(rings)) continue;
    const prev = byName.get(name);
    if (!prev || area > prev.area_m2) {
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      // round coords to 5 dp (~1 m) to keep the file small
      const round = (rs: LatLng[][]): LatLng[][] => rs.map((r) => r.map(([la, ln]) => [Math.round(la * 1e5) / 1e5, Math.round(ln * 1e5) / 1e5] as LatLng));
      byName.set(name, { id: `broad-${slug}`, name, rings: round(rings), area_m2: Math.round(area) });
    }
  }

  const broads = [...byName.values()].sort((a, b) => b.area_m2 - a.area_m2);
  console.log(`  kept ${broads.length} broads/meres:`);
  for (const b of broads) console.log(`    ${b.name} — ${(b.area_m2 / 10000).toFixed(1)} ha, ${b.rings.length} ring(s)`);

  const out = { built_at: new Date().toISOString(), source: 'OpenStreetMap (natural=water)', broads };
  writeFileSync(join(OUT_DIR, 'broads.json'), JSON.stringify(out));
  console.log(`✓ wrote broads.json (${broads.length} features)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
