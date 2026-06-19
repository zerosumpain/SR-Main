// build-moorings.ts — moorings.json from OSM (locations) + curated metadata
// overlay (tiers/charges/facilities). Snaps each to its nearest graph node.
//
// Run AFTER build-graph.ts:  npx tsx scripts/broads-pilot/build-moorings.ts

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { overpass, BROADS_BBOX, type OsmElement } from './lib/overpass.ts';
import { haversine } from './lib/geo.ts';
import { CURATED, EXTRA, F, type Meta, type Tier } from './lib/seed-moorings.ts';

interface GNode { id: string; lat: number; lng: number }
const DIR = join(process.cwd(), 'static', 'broads-pilot');
const graph = JSON.parse(readFileSync(join(DIR, 'graph.json'), 'utf8')) as {
  nodes: GNode[];
  edges: { geometry: [number, number][] }[];
};

// node_id = nearest junction (routing target).
const nearestNode = (lat: number, lng: number) => {
  let best: { id: string; d: number } | null = null;
  for (const n of graph.nodes) {
    const d = haversine(lat, lng, n.lat, n.lng);
    if (!best || d < best.d) best = { id: n.id, d };
  }
  return best!;
};
// True distance to the channel (nearest edge SEGMENT, not just its vertices) —
// used for the off-network drop test. Local equirectangular projection (metres).
function distToSegment(plat: number, plng: number, a: [number, number], b: [number, number]) {
  const k = (Math.cos((plat * Math.PI) / 180) * 111320);
  const px = plng * k, py = plat * 111320;
  const ax = a[1] * k, ay = a[0] * 111320;
  const bx = b[1] * k, by = b[0] * 111320;
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
const nearestEdgeDist = (lat: number, lng: number) => {
  let best = Infinity;
  for (const e of graph.edges)
    for (let i = 1; i < e.geometry.length; i++) {
      const d = distToSegment(lat, lng, e.geometry[i - 1], e.geometry[i]);
      if (d < best) best = d;
    }
  return best;
};
const slugify = (s: string, i: number) => `m-${s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'mooring'}-${i}`;

function tierFromTags(t: Record<string, string>): Meta {
  if (t.leisure === 'marina')
    return { tier: 'marina', rate: { amount: 0, unit: 'metre_night' }, facilities: F({ water: true, shore_power: true, toilets: true }), last_verified: '2025' };
  const fee = t.fee === 'yes';
  return { tier: fee ? 'ba_staffed' : 'ba_free', rate: { amount: 0, unit: fee ? 'night' : 'free' }, facilities: F({}), capacity_caveat: true, last_verified: '2025' };
}
const overlay = (name: string): Meta | null => CURATED.find((c) => c.match.test(name))?.meta ?? null;

interface OutMooring {
  id: string; name: string; lat: number; lng: number; node_id: string; tier: Tier;
  rate: Meta['rate']; waived_with_meal: boolean; facilities: ReturnType<typeof F>;
  capacity: number | null; capacity_caveat: boolean; last_verified: string; source: string;
}

async function main() {
  console.log('· fetching moorings/marinas from OSM…');
  const json = await overpass(`
    [out:json][timeout:120];
    ( nwr["leisure"="marina"](${BROADS_BBOX});
      nwr["mooring"](${BROADS_BBOX});
      nwr["waterway"="mooring"](${BROADS_BBOX});
      node["seamark:type"="mooring"](${BROADS_BBOX}); );
    out center tags;
  `);

  const raw: { name: string; lat: number; lng: number; meta: Meta; source: string }[] = [];
  for (const el of json.elements as OsmElement[]) {
    const t = el.tags || {};
    const lat = el.lat ?? (el as any).center?.lat;
    const lng = el.lon ?? (el as any).center?.lon;
    if (lat == null || lng == null) continue;
    const name = t.name || null;
    if (!name) continue; // skip bare unnamed mooring posts & unnamed marinas (noise)
    raw.push({ name, lat, lng, meta: overlay(name) ?? tierFromTags(t), source: 'osm' });
  }
  console.log(`  ${raw.length} named OSM moorings/marinas`);

  // Add EXTRA seeds (dedupe by proximity to any OSM mooring of the same kind).
  for (const e of EXTRA) {
    const dup = raw.some((r) => haversine(r.lat, r.lng, e.lat, e.lng) < 150);
    if (!dup) raw.push({ name: e.name, lat: e.lat, lng: e.lng, meta: e.meta, source: 'curated' });
  }

  // Snap to graph; drop anything not near the navigable network.
  const out: OutMooring[] = [];
  let dropped = 0;
  raw.forEach((r, i) => {
    const nn = nearestNode(r.lat, r.lng);
    if (nearestEdgeDist(r.lat, r.lng) > 500) { dropped++; return; } // off the navigable channel
    const m = r.meta;
    out.push({
      id: slugify(r.name, i), name: r.name, lat: r.lat, lng: r.lng, node_id: nn.id,
      tier: m.tier, rate: m.rate, waived_with_meal: m.waived_with_meal ?? false,
      facilities: F(m.facilities), capacity: m.capacity ?? null,
      capacity_caveat: m.capacity_caveat ?? false, last_verified: m.last_verified ?? '2025', source: r.source,
    });
  });

  writeFileSync(join(DIR, 'moorings.json'), JSON.stringify(out));
  const byTier = out.reduce((a, m) => ((a[m.tier] = (a[m.tier] || 0) + 1), a), {} as Record<string, number>);
  console.log(`✓ moorings.json: ${out.length} moorings (dropped ${dropped} off-network)`);
  console.log('  by tier:', JSON.stringify(byTier));
  if (out.length < 25) throw new Error(`too few moorings (${out.length}) — OSM data suspect`);
}

main().catch((e) => { console.error('build-moorings FAILED:', e); process.exit(1); });
