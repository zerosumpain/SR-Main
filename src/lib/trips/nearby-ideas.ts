// src/lib/trips/nearby-ideas.ts
//
// v6: ideas that always come back. When the planner fails, runs out of time
// or returns nothing that fits, "Make a suggestion" falls back to
// OpenStreetMap: places around the gap (somewhere to eat for a meal slot,
// otherwise attractions, museums, viewpoints, parks, churches, markets)
// within the distance the gap allows, ranked by closeness to the line between
// the stop before and the stop after. Each candidate is then verified with
// the solver like any other idea (./ideas `verifyIdea`). PURE: the Overpass
// call is in ./ideas.server.

import type { DayStage, LatLng, TravellerProfile, Wish } from './model';
import type { Gap } from './ideas';

/** Walking pace for the reach estimate (metres per minute, ~4.8 km/h). */
const WALK_M_PER_MIN = 80;
const MIN_RADIUS_M = 300;
const MAX_RADIUS_M = 1500;

export interface NearbyCandidate {
  title: string;
  kind: string;
  place: { name: string; location: LatLng; osmId: string; address: string | null };
  durationMin: number;
  why: string;
  fit: string;
}

/** Straight-line metres between two points (equirectangular; fine at city scale). */
export function metresBetween(a: LatLng, b: LatLng): number {
  const R = 6_371_000;
  const x = ((b.lng - a.lng) * Math.PI) / 180 * Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180);
  const y = ((b.lat - a.lat) * Math.PI) / 180;
  return Math.sqrt(x * x + y * y) * R;
}

/** Metres from `p` to the segment a→b. */
export function metresFromLine(p: LatLng, a: LatLng, b: LatLng): number {
  const kx = Math.cos((a.lat * Math.PI) / 180) * 111_320;
  const ky = 110_540;
  const [px, py] = [(p.lng - a.lng) * kx, (p.lat - a.lat) * ky];
  const [bx, by] = [(b.lng - a.lng) * kx, (b.lat - a.lat) * ky];
  const len = bx * bx + by * by;
  const t = len ? Math.max(0, Math.min(1, (px * bx + py * by) / len)) : 0;
  return Math.hypot(px - t * bx, py - t * by);
}

/** Where to look: between the two ends of the gap (or at whichever is known). */
export function gapCentre(gap: Gap): LatLng | null {
  const a = gap.before.location;
  const b = gap.after.location;
  if (a && b) return { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 };
  return a ?? b ?? null;
}

const visitFloor = (gap: Gap) => (gap.meal ? 45 : 20);

/** How far to look: half of what the gap leaves after a short visit, at walking pace, from the centre. */
export function nearbyRadiusM(gap: Gap): number {
  const spare = Math.max(0, gap.freeMin - visitFloor(gap));
  const ends = gap.before.location && gap.after.location ? metresBetween(gap.before.location, gap.after.location) / 2 : 0;
  return Math.round(Math.min(MAX_RADIUS_M, Math.max(MIN_RADIUS_M, (spare / 2) * WALK_M_PER_MIN + ends)));
}

/** The Overpass query for the gap: places to eat for a meal slot, otherwise things to see. */
export function nearbyIdeasQuery(gap: Gap, centre: LatLng, radiusM: number): string {
  const around = `(around:${Math.round(radiusM)},${centre.lat.toFixed(6)},${centre.lng.toFixed(6)})`;
  const lines =
    gap.meal === 'breakfast'
      ? [`nwr["amenity"~"^(cafe)$"]["name"]${around};`, `nwr["shop"="bakery"]["name"]${around};`]
      : gap.meal
        ? [`nwr["amenity"~"^(restaurant|cafe)$"]["name"]${around};`]
        : [
            `nwr["tourism"~"^(attraction|museum|gallery|viewpoint)$"]["name"]${around};`,
            `nwr["leisure"~"^(park|garden)$"]["name"]${around};`,
            `nwr["amenity"="place_of_worship"]["name"]["wikidata"]${around};`,
            `nwr["amenity"="marketplace"]["name"]${around};`,
          ];
  return `[out:json][timeout:15];(\n${lines.join('\n')}\n);out center tags 80;`;
}

/** Soft dietary hints from the profile ("vegetarian", "vegan", "gluten"…): a ranking nudge, never a filter. */
export function dietaryHints(profile: Pick<TravellerProfile, 'constraints' | 'preferences'> | null): string[] {
  const text = [...(profile?.constraints ?? []), ...(profile?.preferences ?? [])].map((x) => x.text.toLowerCase()).join(' ');
  return ['vegetarian', 'vegan', 'gluten', 'halal', 'kosher'].filter((h) => text.includes(h));
}

const DIET_TAG: Record<string, string> = { vegetarian: 'diet:vegetarian', vegan: 'diet:vegan', gluten: 'diet:gluten_free', halal: 'diet:halal', kosher: 'diet:kosher' };

function kindOf(tags: Record<string, string>): string {
  if (tags.shop === 'bakery') return 'bakery';
  if (tags.amenity === 'place_of_worship') return 'church';
  return tags.amenity ?? tags.tourism ?? tags.leisure ?? 'place';
}

const KIND_WORD: Record<string, string> = {
  restaurant: 'a restaurant',
  cafe: 'a café',
  bakery: 'a bakery',
  museum: 'a museum',
  gallery: 'a gallery',
  viewpoint: 'a viewpoint',
  attraction: 'a sight',
  park: 'a park',
  garden: 'a garden',
  church: 'a church',
  marketplace: 'a market',
};

function defaultMinutes(kind: string, gap: Gap): number {
  if (gap.meal === 'breakfast') return 30;
  if (gap.meal) return kind === 'cafe' ? 45 : gap.meal === 'dinner' ? 75 : 60;
  return ({ museum: 60, gallery: 60, park: 40, garden: 40, viewpoint: 20, church: 25, marketplace: 30 } as Record<string, number>)[kind] ?? 40;
}

const STAGE_WORD: Record<DayStage, string> = { morning: 'the morning', lunch: 'lunch', afternoon: 'the afternoon', evening: 'the evening' };

/**
 * Up to `limit` candidates from an Overpass answer: named, not already a
 * wish, ranked by distance from the line between the gap's ends (a soft
 * bonus for a dietary match or a wikidata entry), each with a duration that
 * leaves the walk in and out inside the gap.
 */
export function nearbyCandidates(
  answer: unknown,
  gap: Gap,
  existing: Array<Pick<Wish, 'title' | 'place'>>,
  hints: string[] = [],
  limit = 8,
): NearbyCandidate[] {
  const elements = (answer as { elements?: unknown[] } | null)?.elements;
  const centre = gapCentre(gap);
  if (!Array.isArray(elements) || !centre) return [];
  const a = gap.before.location ?? centre;
  const b = gap.after.location ?? centre;
  const names = new Set(existing.flatMap((w) => [w.title, w.place?.name ?? '']).map((n) => n.trim().toLowerCase()).filter(Boolean));
  const ids = new Set(existing.map((w) => w.place?.osmId).filter(Boolean));
  const out: Array<NearbyCandidate & { score: number }> = [];
  for (const raw of elements) {
    const e = raw as { type?: string; id?: number; lat?: number; lon?: number; center?: { lat?: number; lon?: number }; tags?: Record<string, string> };
    const tags = e.tags ?? {};
    const name = (tags['name:en'] ?? tags.name ?? '').trim();
    const lat = Number(e.lat ?? e.center?.lat);
    const lng = Number(e.lon ?? e.center?.lon);
    if (!name || !Number.isFinite(lat) || !Number.isFinite(lng) || !e.type || e.id == null) continue;
    const osmId = `${e.type}/${e.id}`;
    const key = name.toLowerCase();
    if (ids.has(osmId) || names.has(key) || out.some((c) => c.title.toLowerCase() === key)) continue;
    const at = { lat, lng };
    const kind = kindOf(tags);
    const inMin = Math.max(1, Math.round(metresBetween(a, at) / WALK_M_PER_MIN));
    const outMin = Math.max(1, Math.round(metresBetween(at, b) / WALK_M_PER_MIN));
    const room = gap.freeMin - inMin - outMin - 5;
    if (room < 15) continue;
    const durationMin = Math.max(15, Math.min(defaultMinutes(kind, gap), room));
    const diet = hints.some((h) => /^(yes|only)$/.test(tags[DIET_TAG[h]] ?? ''));
    const score = metresFromLine(at, a, b) - (diet ? 150 : 0) - (tags.wikidata ? 100 : 0);
    const address = [tags['addr:street'], tags['addr:housenumber']].filter(Boolean).join(' ') || null;
    out.push({
      title: name,
      kind,
      place: { name, location: at, osmId, address },
      durationMin,
      why: `${(KIND_WORD[kind] ?? 'a place').replace(/^./, (c) => c.toUpperCase())} near the way from ${gap.before.title} to ${gap.after.title}, found on OpenStreetMap${diet ? ` (marked ${hints.join('/')} friendly)` : ''}.`,
      fit: `About ${inMin} min walk from ${gap.before.title}, ${durationMin} min for ${gap.meal ? gap.meal : STAGE_WORD[gap.stage]}, ${outMin} min on to ${gap.after.title}.`,
      score,
    });
  }
  out.sort((x, y) => x.score - y.score || x.title.localeCompare(y.title));
  return out.slice(0, limit).map(({ score: _s, ...c }) => c);
}
