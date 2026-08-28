// Shared-route discovery: named OSM route relations near a start point.
//
// Ported from the JKAImaps Overpass client (~/offline-maps/src/lib/geo/
// overpass.ts) — the mirror fallback and way-stitching are that code, adapted
// to run server-side. OSM route relations are community-mapped, named trails
// (the Teesdale Way, a national cycle route), which is the only legitimately
// open "routes people share" source: Wikiloc and AllTrails have no public API.
//
// Overpass is a shared free service, so results are cached in-process and a
// search only happens on an explicit ask, never on every map click.

import { haversineM } from './track';
import type { PlannerSport } from './ors';

// Order matters: the first two answered from this network when probed
// (2026-08-17); kumi.systems did not connect at all but stays as a last resort.
const OVERPASS_URLS = [
  'https://overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

async function overpassFetch(query: string, signal?: AbortSignal): Promise<OverpassResponse> {
  let lastError: Error | null = null;

  for (const url of OVERPASS_URLS) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        body: `data=${encodeURIComponent(query)}`,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        signal,
      });

      if (!response.ok) {
        lastError = new Error(`Overpass ${response.status} from ${new URL(url).host}`);
        continue; // 429s and mirror hiccups alike — try the other mirror
      }

      return (await response.json()) as OverpassResponse;
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') throw e;
      lastError = e instanceof Error ? e : new Error(String(e));
    }
  }

  throw lastError ?? new Error('All Overpass mirrors failed');
}

interface OverpassElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  nodes?: number[];
  members?: Array<{ type: string; ref: number }>;
  tags?: Record<string, string>;
}

export interface OverpassResponse {
  elements: OverpassElement[];
}

export interface SharedRouteSummary {
  osmId: number;
  name: string;
  /** OSM network grade: iwn/nwn/rwn/lwn on foot, icn/ncn/rcn/lcn on wheels. */
  network: string;
  /** From the relation's own distance tag, when the mappers recorded one. */
  distanceKm: number | null;
  operator: string | null;
  ref: string | null;
}

// Which OSM route relation types belong to which of our sports.
const ROUTE_FILTERS: Record<PlannerSport, string> = {
  run: '^(hiking|foot|walking|running)$',
  trail_run: '^(hiking|foot|walking|running)$',
  walk: '^(hiking|foot|walking)$',
  hike: '^(hiking|foot|walking)$',
  ride: '^bicycle$',
  mtb: '^mtb$',
};

const NETWORK_RANK: Record<string, number> = {
  iwn: 0,
  nwn: 1,
  rwn: 2,
  lwn: 3,
  icn: 0,
  ncn: 1,
  rcn: 2,
  lcn: 3,
};

export function networkLabel(network: string): string {
  switch (network) {
    case 'iwn':
      return 'International trail';
    case 'nwn':
      return 'National trail';
    case 'rwn':
      return 'Regional trail';
    case 'lwn':
      return 'Local trail';
    case 'icn':
      return 'International cycle route';
    case 'ncn':
      return 'National cycle route';
    case 'rcn':
      return 'Regional cycle route';
    case 'lcn':
      return 'Local cycle route';
    default:
      return 'Mapped route';
  }
}

/** A bbox `radiusKm` out from a point in each direction: [south, west, north, east]. */
export function bboxAround(
  lat: number,
  lng: number,
  radiusKm: number,
): [number, number, number, number] {
  const dLat = radiusKm / 111.32;
  const dLng = radiusKm / (111.32 * Math.max(0.1, Math.cos((lat * Math.PI) / 180)));
  return [lat - dLat, lng - dLng, lat + dLat, lng + dLng];
}

/** Pure: relation elements (tags only) → summaries, best network first. */
export function parseRelations(elements: OverpassElement[]): SharedRouteSummary[] {
  return elements
    .filter((el) => el.type === 'relation')
    .map((el): SharedRouteSummary => {
      const tags = el.tags ?? {};
      const distRaw = tags.distance ?? tags['distance:km'];
      let distanceKm: number | null = null;
      if (distRaw) {
        const parsed = parseFloat(distRaw.replace(/[^0-9.]/g, ''));
        if (!isNaN(parsed) && parsed > 0) distanceKm = parsed;
      }
      return {
        osmId: el.id,
        name: tags.name ?? tags['name:en'] ?? `Route ${el.id}`,
        network: tags.network ?? '',
        distanceKm,
        operator: tags.operator ?? null,
        ref: tags.ref ?? null,
      };
    })
    .filter((r) => r.name !== `Route ${r.osmId}` || r.ref)
    .sort((a, b) => (NETWORK_RANK[a.network] ?? 9) - (NETWORK_RANK[b.network] ?? 9));
}

/**
 * Pure: stitch a relation's member ways into one [lng, lat] line, reversing
 * ways as needed so consecutive ends meet. Gaps are tolerated — a long trail
 * relation is rarely perfectly contiguous in OSM.
 */
export function stitchRelation(data: OverpassResponse): {
  name: string;
  coordinates: [number, number][];
} {
  const nodes = new Map<number, [number, number]>();
  for (const el of data.elements) {
    if (el.type === 'node' && typeof el.lon === 'number' && typeof el.lat === 'number') {
      nodes.set(el.id, [el.lon, el.lat]);
    }
  }

  const ways = new Map<number, [number, number][]>();
  for (const el of data.elements) {
    if (el.type === 'way' && el.nodes) {
      const coords: [number, number][] = [];
      for (const nodeId of el.nodes) {
        const coord = nodes.get(nodeId);
        if (coord) coords.push(coord);
      }
      if (coords.length >= 2) ways.set(el.id, coords);
    }
  }

  const relation = data.elements.find((el) => el.type === 'relation');
  if (!relation) throw new Error('Relation not found in Overpass response');

  const orderedWayIds = (relation.members ?? [])
    .filter((m) => m.type === 'way')
    .map((m) => m.ref);

  const all: [number, number][] = [];
  for (const wayId of orderedWayIds) {
    const wayCoords = ways.get(wayId);
    if (!wayCoords?.length) continue;

    if (!all.length) {
      all.push(...wayCoords);
      continue;
    }

    const last = all[all.length - 1];
    const first = wayCoords[0];
    const end = wayCoords[wayCoords.length - 1];
    const distToFirst = Math.abs(last[0] - first[0]) + Math.abs(last[1] - first[1]);
    const distToLast = Math.abs(last[0] - end[0]) + Math.abs(last[1] - end[1]);
    const coords = distToLast < distToFirst ? [...wayCoords].reverse() : wayCoords;

    const joins =
      Math.abs(last[0] - coords[0][0]) < 0.000001 && Math.abs(last[1] - coords[0][1]) < 0.000001;
    all.push(...coords.slice(joins ? 1 : 0));
  }

  if (all.length < 2) throw new Error('Relation has no usable way geometry');

  return {
    name: relation.tags?.name ?? `Route ${relation.id}`,
    coordinates: all,
  };
}

/** Pure: line length in metres. */
export function lineDistanceM(coordinates: [number, number][]): number {
  let total = 0;
  for (let i = 1; i < coordinates.length; i++) {
    total += haversineM(coordinates[i - 1], coordinates[i]);
  }
  return total;
}

// In-process caches. Search results move only when the mappers do, so an hour
// is generous; geometry is immutable enough for a day.
const searchCache = new Map<string, { expiresAt: number; value: SharedRouteSummary[] }>();
const geometryCache = new Map<
  number,
  { expiresAt: number; value: { name: string; coordinates: [number, number][] } }
>();
const SEARCH_TTL_MS = 60 * 60 * 1000;
const GEOMETRY_TTL_MS = 24 * 60 * 60 * 1000;

export const DISCOVER_RADIUS_KM = 15;

export async function searchSharedRoutes(
  lat: number,
  lng: number,
  sport: PlannerSport,
  signal?: AbortSignal,
): Promise<SharedRouteSummary[]> {
  // ~1 km grid: near-identical start points share a cache entry.
  const key = `${sport}:${lat.toFixed(2)}:${lng.toFixed(2)}`;
  const hit = searchCache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value;

  const [south, west, north, east] = bboxAround(lat, lng, DISCOVER_RADIUS_KM);
  const query = `
    [out:json][timeout:15];
    relation["type"="route"]["route"~"${ROUTE_FILTERS[sport]}"](${south},${west},${north},${east});
    out tags;
  `;

  const data = await overpassFetch(query, signal);
  const value = parseRelations(data.elements ?? []).slice(0, 30);

  searchCache.set(key, { expiresAt: Date.now() + SEARCH_TTL_MS, value });
  return value;
}

export async function fetchSharedRouteGeometry(
  osmId: number,
  signal?: AbortSignal,
): Promise<{ name: string; coordinates: [number, number][] }> {
  const hit = geometryCache.get(osmId);
  if (hit && hit.expiresAt > Date.now()) return hit.value;

  const query = `
    [out:json][timeout:30];
    relation(${osmId});
    (._;>;);
    out body;
  `;

  const data = await overpassFetch(query, signal);
  const value = stitchRelation(data);

  geometryCache.set(osmId, { expiresAt: Date.now() + GEOMETRY_TTL_MS, value });
  return value;
}
