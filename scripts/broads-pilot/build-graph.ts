// build-graph.ts — extract the navigable Norfolk Broads waterway network from
// OpenStreetMap (Overpass) and emit a connected, routable graph as
// static/broads-pilot/graph.json.
//
// Run: npx tsx scripts/broads-pilot/build-graph.ts
//
// Approach (design spec §4, research brief §1):
//  1. Pull waterway=river|canal ways in the Broads bbox.
//  2. Split ways into edges at junction nodes (shared by ≥2 ways or way ends).
//  3. Keep components whose length ≥ 5% of the largest; bridge them with short
//     connectors (the Northern/Southern halves meet only at Great Yarmouth /
//     Breydon) so the result is ONE routable network. Drop tiny fragments.
//  4. Add destination nodes for the navigable broads (centroid + connector).
//  5. Assign a representative per-river speed limit to every edge.

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { overpass, BROADS_BBOX, type OsmElement } from './lib/overpass.ts';
import { haversine, UnionFind } from './lib/geo.ts';

type LatLng = [number, number];
interface GNode { id: string; lat: number; lng: number }
interface GEdge {
  id: string; from: string; to: string; length_m: number; limit_mph: number;
  river: string; way_id: number; geometry: LatLng[]; restriction_ids: string[];
  conservation?: boolean; tidal_zone?: 'breydon' | null;
}

const OUT_DIR = join(process.cwd(), 'static', 'broads-pilot');

// Navigable broads (name match → representative speed). Conservation broads are
// deliberately absent so powered craft are never routed into reserves.
const NAVIGABLE_BROADS: { match: RegExp; name: string; limit: number }[] = [
  { match: /wroxham broad/i, name: 'Wroxham Broad', limit: 5 },
  { match: /salhouse broad/i, name: 'Salhouse Broad', limit: 5 },
  { match: /malthouse broad|ranworth broad/i, name: 'Ranworth (Malthouse) Broad', limit: 5 },
  { match: /south walsham/i, name: 'South Walsham Broad', limit: 5 },
  { match: /barton broad/i, name: 'Barton Broad', limit: 5 },
  { match: /hickling broad/i, name: 'Hickling Broad', limit: 5 },
  { match: /horsey mere/i, name: 'Horsey Mere', limit: 5 },
  { match: /womack water/i, name: 'Womack Water', limit: 4 },
  { match: /oulton broad/i, name: 'Oulton Broad', limit: 6 },
];
const CONSERVATION = /hoveton great|cockshoot|upton broad|burnt fen|decoy broad|mautby/i;

function riverLimit(name: string | undefined, waterway: string): number {
  const n = (name || '').toLowerCase();
  if (n.includes('wensum')) return 4;
  if (n.includes('ant')) return 4;
  if (n.includes('chet')) return 4;
  if (n.includes('thurne')) return 5;
  if (n.includes('bure')) return 5;
  if (n.includes('yare')) return 6;
  if (n.includes('waveney')) return 5;
  if (waterway === 'canal') return 5;
  return 4;
}

async function main() {
  console.log('· fetching waterways from Overpass…');
  const waysJson = await overpass(`
    [out:json][timeout:180];
    ( way["waterway"~"^(river|canal)$"](${BROADS_BBOX}); );
    out body; >; out skel qt;
  `);

  const coord = new Map<number, LatLng>();
  const ways: OsmElement[] = [];
  for (const el of waysJson.elements) {
    if (el.type === 'node' && el.lat != null && el.lon != null) coord.set(el.id, [el.lat, el.lon]);
    else if (el.type === 'way' && el.nodes && el.nodes.length >= 2) ways.push(el);
  }
  console.log(`  ${ways.length} ways, ${coord.size} nodes`);

  // Junction nodes: used by ≥2 ways, or the first/last node of any way.
  const useCount = new Map<number, number>();
  for (const w of ways) for (const n of w.nodes!) useCount.set(n, (useCount.get(n) || 0) + 1);
  const isJunction = (n: number, w: OsmElement, i: number) =>
    (useCount.get(n) || 0) >= 2 || i === 0 || i === w.nodes!.length - 1;

  // Build edges by splitting ways at junctions.
  const nodes = new Map<string, GNode>();
  const edges: GEdge[] = [];
  const nid = (osm: number) => `n${osm}`;
  const ensureNode = (osm: number) => {
    const c = coord.get(osm);
    if (!c) return false;
    const id = nid(osm);
    if (!nodes.has(id)) nodes.set(id, { id, lat: c[0], lng: c[1] });
    return true;
  };

  let edgeSeq = 0;
  for (const w of ways) {
    const name = w.tags?.name || w.tags?.waterway || 'waterway';
    const waterway = w.tags?.waterway || 'river';
    const limit = riverLimit(w.tags?.name, waterway);
    const refs = w.nodes!.filter((n) => coord.has(n));
    if (refs.length < 2) continue;

    let segStart = 0;
    for (let i = 1; i < refs.length; i++) {
      if (isJunction(refs[i], w, i) || i === refs.length - 1) {
        const slice = refs.slice(segStart, i + 1);
        const geom = slice.map((n) => coord.get(n)!) as LatLng[];
        let len = 0;
        for (let k = 1; k < geom.length; k++)
          len += haversine(geom[k - 1][0], geom[k - 1][1], geom[k][0], geom[k][1]);
        const a = refs[segStart], b = refs[i];
        if (a !== b && len > 0 && ensureNode(a) && ensureNode(b)) {
          edges.push({
            id: `e${edgeSeq++}`, from: nid(a), to: nid(b), length_m: Math.round(len),
            limit_mph: limit, river: name, way_id: w.id, geometry: geom, restriction_ids: [],
          });
        }
        segStart = i;
      }
    }
  }
  console.log(`  built ${nodes.size} nodes, ${edges.length} edges`);

  // Connected components over the current graph.
  const idx = new Map<string, number>();
  [...nodes.keys()].forEach((k, i) => idx.set(k, i));
  const uf = new UnionFind(nodes.size);
  for (const e of edges) uf.union(idx.get(e.from)!, idx.get(e.to)!);

  const compLen = new Map<number, number>();
  const compRivers = new Map<number, Set<string>>();
  for (const e of edges) {
    const r = uf.find(idx.get(e.from)!);
    compLen.set(r, (compLen.get(r) || 0) + e.length_m);
    (compRivers.get(r) || compRivers.set(r, new Set()).get(r)!).add(e.river);
  }
  const ranked = [...compLen.entries()].sort((a, b) => b[1] - a[1]);
  console.log('  top components (km):', ranked.slice(0, 6).map(([, l]) => (l / 1000).toFixed(1)).join(', '));

  // The Broads navigable network is ONE connected component. Keep it. Other
  // components are kept only if they carry a CORE Broads river AND join the
  // network within a short confluence hop — never a long land crossing (which
  // would wrongly weld in a separate system like the Suffolk River Blyth).
  const CORE = /bure|yare|waveney|ant|thurne|chet|wensum/i;
  const hasCore = (r: number) => [...(compRivers.get(r) || [])].some((n) => CORE.test(n));
  const mainRoot = ranked[0][0];
  const compOf = (k: string) => uf.find(idx.get(k)!);
  const compNodeIds = (root: number) => [...nodes.keys()].filter((k) => compOf(k) === root);
  const keep = new Set<number>([mainRoot]);
  const bridges: { a: string; b: string; d: number }[] = [];
  const mainNodesAll = compNodeIds(mainRoot);
  for (const [r, l] of ranked) {
    if (r === mainRoot) continue;
    // nearest hop from this fragment to the main network
    let best: { a: string; b: string; d: number } | null = null;
    for (const a of compNodeIds(r)) {
      const na = nodes.get(a)!;
      for (const b of mainNodesAll) {
        const nb = nodes.get(b)!;
        const d = haversine(na.lat, na.lng, nb.lat, nb.lng);
        if (!best || d < best.d) best = { a, b, d };
      }
    }
    const rivers = [...(compRivers.get(r) || [])].slice(0, 3).join('/');
    // Keep if: a near-touching fragment (≤80 m gap = an OSM topology break, e.g.
    // the Stalham/Sutton navigable dykes), OR a core Broads river within a short
    // confluence hop. Everything else (the distant Suffolk Blyth, etc.) is dropped.
    const topologyGap = !!best && best.d <= 80;
    const coreConfluence = hasCore(r) && l >= 2000 && !!best && best.d <= 2500;
    if (topologyGap || coreConfluence) {
      keep.add(r);
      bridges.push(best!);
    } else {
      console.log(`  drop ${(l / 1000).toFixed(1)}km (${rivers}; hop ${best ? best.d.toFixed(0) : '∞'}m)`);
    }
  }

  // Filter nodes/edges to kept components.
  const inKeep = (k: string) => keep.has(compOf(k));
  for (const [k] of [...nodes]) if (!inKeep(k)) nodes.delete(k);
  let keptEdges = edges.filter((e) => nodes.has(e.from) && nodes.has(e.to));
  console.log(`  kept ${nodes.size} nodes / ${keptEdges.length} edges in ${keep.size} component(s)`);

  // Add short bridge connectors for genuine confluence gaps only.
  for (const br of bridges) {
    const na = nodes.get(br.a)!, nb = nodes.get(br.b)!;
    const yarmouth = na.lat > 52.56 && na.lat < 52.62 && na.lng > 1.68;
    keptEdges.push({
      id: `e${edgeSeq++}`, from: br.a, to: br.b, length_m: Math.round(br.d),
      limit_mph: 5, river: yarmouth ? 'Breydon Water' : 'connector',
      geometry: [[na.lat, na.lng], [nb.lat, nb.lng]],
      way_id: -1, restriction_ids: [], tidal_zone: yarmouth ? 'breydon' : null,
    });
    console.log(`  bridged ${br.d.toFixed(0)}m ${yarmouth ? '(Breydon)' : '(connector)'}`);
  }

  // Add destination nodes for the navigable broads.
  console.log('· fetching named broads…');
  const broadsJson = await overpass(`
    [out:json][timeout:120];
    ( way["natural"="water"]["name"](${BROADS_BBOX});
      relation["natural"="water"]["name"](${BROADS_BBOX}); );
    out body; >; out skel qt;
  `);
  const bcoord = new Map<number, LatLng>();
  const bwayNodes = new Map<number, number[]>();
  for (const el of broadsJson.elements) {
    if (el.type === 'node' && el.lat != null && el.lon != null) bcoord.set(el.id, [el.lat, el.lon]);
    else if (el.type === 'way' && el.nodes) bwayNodes.set(el.id, el.nodes);
  }
  // A broad may be a single way OR a multipolygon relation (Barton, Hickling).
  const ptsFor = (el: OsmElement): LatLng[] => {
    if (el.type === 'way' && el.nodes) return el.nodes.map((n) => bcoord.get(n)).filter(Boolean) as LatLng[];
    if (el.type === 'relation' && el.members) {
      const out: LatLng[] = [];
      for (const m of el.members)
        if (m.type === 'way')
          for (const n of bwayNodes.get(m.ref) || []) { const c = bcoord.get(n); if (c) out.push(c); }
      return out;
    }
    return [];
  };
  const riverNodeIds = [...nodes.keys()]; // snap broads to the river network only
  const seenBroad = new Set<string>();
  let broadsAdded = 0;
  for (const el of broadsJson.elements) {
    const name = el.tags?.name;
    if (!name || (el.type !== 'way' && el.type !== 'relation')) continue;
    if (CONSERVATION.test(name)) continue;
    const spec = NAVIGABLE_BROADS.find((b) => b.match.test(name));
    if (!spec || seenBroad.has(spec.name)) continue;
    const pts = ptsFor(el);
    if (pts.length < 3) continue;
    const cLat = pts.reduce((s, p) => s + p[0], 0) / pts.length;
    const cLng = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    // nearest existing river node = the access point from the river/dyke
    let best: { id: string; d: number } | null = null;
    for (const k of riverNodeIds) {
      const n = nodes.get(k)!;
      const d = haversine(cLat, cLng, n.lat, n.lng);
      if (!best || d < best.d) best = { id: k, d };
    }
    if (!best || best.d > 3000) continue; // sanity: broad should be near the network
    const slug = spec.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const bid = `broad-${slug}`;
    nodes.set(bid, { id: bid, lat: cLat, lng: cLng });
    keptEdges.push({
      id: `e${edgeSeq++}`, from: best.id, to: bid, length_m: Math.round(best.d),
      limit_mph: spec.limit, river: spec.name,
      geometry: [[nodes.get(best.id)!.lat, nodes.get(best.id)!.lng], [cLat, cLng]],
      way_id: -2, restriction_ids: [],
    });
    seenBroad.add(spec.name);
    broadsAdded++;
  }
  console.log(`  added ${broadsAdded} navigable broad destinations`);

  // Manual connectors for navigable staithes whose access dyke is missing or
  // disconnected in OSM — notably Stalham, the main Richardsons hire base (the
  // most common trip origin). The connector approximates the access dyke.
  const STAITHES = [
    { id: 'staithe-stalham', name: 'Stalham Staithe', lat: 52.7772, lng: 1.5072, limit: 4 },
    { id: 'staithe-sutton', name: 'Sutton Staithe', lat: 52.7745, lng: 1.5235, limit: 4 },
  ];
  const baseNodeIds = [...nodes.keys()].filter((k) => !k.startsWith('broad-') && !k.startsWith('staithe-'));
  let staithesAdded = 0;
  for (const s of STAITHES) {
    let best: { id: string; d: number } | null = null;
    for (const k of baseNodeIds) {
      const n = nodes.get(k)!;
      const d = haversine(s.lat, s.lng, n.lat, n.lng);
      if (!best || d < best.d) best = { id: k, d };
    }
    if (!best || best.d > 3000) continue;
    nodes.set(s.id, { id: s.id, lat: s.lat, lng: s.lng });
    keptEdges.push({
      id: `e${edgeSeq++}`, from: best.id, to: s.id, length_m: Math.round(best.d),
      limit_mph: s.limit, river: s.name,
      geometry: [[nodes.get(best.id)!.lat, nodes.get(best.id)!.lng], [s.lat, s.lng]],
      way_id: -3, restriction_ids: [],
    });
    staithesAdded++;
  }
  console.log(`  added ${staithesAdded} staithe connectors`);

  // Tag the Breydon Water crossing (the tidal Northern↔Southern bottleneck) so
  // the planner can raise the slack-water advisory. Open-water bbox at Yarmouth.
  const inBreydon = (p: LatLng) => p[0] >= 52.58 && p[0] <= 52.607 && p[1] >= 1.655 && p[1] <= 1.72;
  let breydonEdges = 0;
  for (const e of keptEdges) {
    if (e.tidal_zone === 'breydon') { breydonEdges++; continue; }
    if (e.geometry.some(inBreydon)) { e.tidal_zone = 'breydon'; breydonEdges++; }
  }
  console.log(`  tagged ${breydonEdges} Breydon (tidal) edges`);

  const graph = { nodes: [...nodes.values()], edges: keptEdges };
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, 'graph.json'), JSON.stringify(graph));
  const totalKm = keptEdges.reduce((s, e) => s + e.length_m, 0) / 1000;
  console.log(`✓ graph.json: ${graph.nodes.length} nodes, ${graph.edges.length} edges, ${totalKm.toFixed(1)} km`);

  if (graph.nodes.length < 200 || graph.edges.length < 200)
    throw new Error(`graph too small (${graph.nodes.length} nodes / ${graph.edges.length} edges) — Overpass data suspect`);
}

main().catch((e) => {
  console.error('build-graph FAILED:', e);
  process.exit(1);
});
