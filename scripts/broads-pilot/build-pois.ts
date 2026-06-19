// build-pois.ts — pois.json (pubs / attractions / curated walks) + mooring_pois.json
// (precomputed mooring→nearby-POI adjacency). OSM for locations + curated overlay
// for famous pubs and dog-friendly walks. Every POI gets deep-links out.
//
// Run AFTER build-graph.ts & build-moorings.ts:
//   npx tsx scripts/broads-pilot/build-pois.ts

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { overpass, BROADS_BBOX, type OsmElement } from './lib/overpass.ts';
import { haversine } from './lib/geo.ts';
import { PUB_OVERLAY, WALKS } from './lib/seed-pois.ts';

type LatLng = [number, number];
const DIR = join(process.cwd(), 'static', 'broads-pilot');
const graph = JSON.parse(readFileSync(join(DIR, 'graph.json'), 'utf8')) as { edges: { geometry: LatLng[] }[] };
const moorings = JSON.parse(readFileSync(join(DIR, 'moorings.json'), 'utf8')) as { id: string; lat: number; lng: number }[];

function distToSegment(plat: number, plng: number, a: LatLng, b: LatLng) {
  const k = Math.cos((plat * Math.PI) / 180) * 111320;
  const px = plng * k, py = plat * 111320, ax = a[1] * k, ay = a[0] * 111320, bx = b[1] * k, by = b[0] * 111320;
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
const distToChannel = (lat: number, lng: number) => {
  let best = Infinity;
  for (const e of graph.edges) for (let i = 1; i < e.geometry.length; i++) {
    const d = distToSegment(lat, lng, e.geometry[i - 1], e.geometry[i]);
    if (d < best) best = d;
  }
  return best;
};

const dogFromTag = (v?: string): boolean | null => (v === 'yes' || v === 'leashed' ? true : v === 'no' ? false : null);
const deepGoogle = (name: string, lat: number, lng: number) =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(name + ' Norfolk Broads')}&query_place_id=`;
const deepTripadvisor = (name: string) =>
  `https://www.tripadvisor.com/Search?q=${encodeURIComponent(name + ' Norfolk Broads')}`;

interface Poi {
  id: string; name: string; kind: 'pub' | 'walk' | 'attraction' | 'shop' | 'fuel';
  lat: number; lng: number; dog_friendly: boolean | null; food: boolean; description: string;
  place_id: string | null; tripadvisor_url: string; google_url: string; osm_id?: string; source: string;
}

async function main() {
  console.log('· fetching POIs from OSM…');
  const json = await overpass(`
    [out:json][timeout:120];
    ( nwr["amenity"~"^(pub|bar)$"](${BROADS_BBOX});
      nwr["tourism"~"^(attraction|museum|viewpoint)$"](${BROADS_BBOX});
      nwr["leisure"="nature_reserve"](${BROADS_BBOX});
      nwr["historic"="windmill"](${BROADS_BBOX});
      nwr["man_made"="windpump"](${BROADS_BBOX}); );
    out center tags;
  `);

  const pois: Poi[] = [];
  let seq = 0;
  for (const el of json.elements as OsmElement[]) {
    const t = el.tags || {};
    const name = t.name;
    if (!name) continue;
    const lat = el.lat ?? (el as any).center?.lat;
    const lng = el.lon ?? (el as any).center?.lon;
    if (lat == null || lng == null) continue;
    if (distToChannel(lat, lng) > 550) continue; // keep only waterside / walkable-from-mooring POIs

    const isPub = t.amenity === 'pub' || t.amenity === 'bar';
    const kind: Poi['kind'] = isPub ? 'pub' : 'attraction';
    const overlay = isPub ? PUB_OVERLAY.find((p) => p.match.test(name))?.meta : undefined;
    const desc = overlay?.description ||
      (kind === 'pub' ? `${t.amenity === 'restaurant' ? 'Restaurant' : 'Pub'} near the water${t.cuisine ? ` (${t.cuisine})` : ''}.`
        : (t.historic === 'windmill' || t.man_made === 'windpump') ? 'Historic Broads drainage mill.'
        : t.leisure === 'nature_reserve' ? 'Broads nature reserve.' : 'Broads attraction.');
    pois.push({
      id: `p-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 36)}-${seq++}`,
      name, kind, lat, lng,
      dog_friendly: overlay?.dog_friendly ?? dogFromTag(t.dog),
      food: overlay?.food ?? (isPub ? t.food !== 'no' : false),
      description: desc, place_id: null,
      tripadvisor_url: deepTripadvisor(name), google_url: deepGoogle(name, lat, lng),
      osm_id: `${el.type}/${el.id}`, source: 'osm',
    });
  }
  console.log(`  ${pois.length} OSM POIs near water`);

  // Curated walks (OSM doesn't model these as points).
  for (const w of WALKS) {
    pois.push({
      id: w.id, name: w.name, kind: 'walk', lat: w.lat, lng: w.lng,
      dog_friendly: w.dog_friendly, food: false, description: w.description, place_id: null,
      tripadvisor_url: deepTripadvisor(w.name), google_url: deepGoogle(w.name, w.lat, w.lng), source: 'curated',
    });
  }

  // Precompute mooring → nearby POIs (within 1 km, sorted by distance).
  const adjacency: Record<string, { poi_id: string; dist_m: number; on_foot: boolean }[]> = {};
  for (const m of moorings) {
    const near = pois
      .map((p) => ({ poi_id: p.id, dist_m: Math.round(haversine(m.lat, m.lng, p.lat, p.lng)) }))
      .filter((x) => x.dist_m <= 1000)
      .sort((a, b) => a.dist_m - b.dist_m)
      .map((x) => ({ ...x, on_foot: x.dist_m <= 1000 }));
    adjacency[m.id] = near;
  }

  writeFileSync(join(DIR, 'pois.json'), JSON.stringify(pois));
  writeFileSync(join(DIR, 'mooring_pois.json'), JSON.stringify(adjacency));
  const pubs = pois.filter((p) => p.kind === 'pub').length;
  const walks = pois.filter((p) => p.kind === 'walk').length;
  const attractions = pois.filter((p) => p.kind === 'attraction').length;
  const withNeighbours = Object.values(adjacency).filter((a) => a.length).length;
  console.log(`✓ pois.json: ${pois.length} (${pubs} pubs, ${walks} walks, ${attractions} attractions)`);
  console.log(`✓ mooring_pois.json: ${withNeighbours}/${moorings.length} moorings have nearby POIs`);
  if (pubs < 15) throw new Error(`too few pubs (${pubs}) — OSM data suspect`);
}

main().catch((e) => { console.error('build-pois FAILED:', e); process.exit(1); });
