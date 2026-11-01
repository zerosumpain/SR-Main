// src/lib/home/presence/venues.ts
//
// The cafés, restaurants and pubs inside a big place. A place the owner drew
// round a whole town centre ("Town", 200 m) swallows every stop in it: a
// lunch at Café W and an hour in Waterstones are both "Town", so the
// patterns page saw almost no eating out. This reads the stops inside a big
// place off the trail — fifteen minutes or more still, within 40 m — and
// files one as a food stop when the nearest named thing on the map is a
// café, restaurant or pub. The map is OpenStreetMap's, fetched once per big
// place (`venues.server.ts`). PURE.
//
// A town centre is dense — 68 food places inside Darlington's 230 m — and a
// phone indoors is good to about 15 m. So a stop is FOOD only when the
// nearest named thing within 20 m is food (a car park or a shop nearer wins),
// and it carries a venue's NAME only when that venue is clearly the nearest
// food: the next is at least six metres and half as far again further off.

import { metresBetween } from './cluster';

export interface Poi { lat: number; lon: number; food: boolean; name: string; type: string }

/** Big enough to hold several businesses; a house or a single shop is never split. */
export const SPLIT_MIN_RADIUS_M = 150;
const FOOD = new Set(['restaurant', 'cafe', 'pub', 'bar', 'fast_food', 'food_court', 'ice_cream', 'biergarten']);
const STILL_M = 40;
const STOP_MINS = 15;
const MAX_GAP_MINS = 6;
const NEAR_M = 20;
const CLEAR_M = 6;
const CLEAR_RATIO = 1.5;
const MINUTE = 60_000;

/** Named amenities, shops and attractions round a place, and every car park. */
export function overpassQuery(lat: number, lon: number, radiusM: number): string {
  const around = `(around:${Math.round(radiusM + 30)},${lat.toFixed(6)},${lon.toFixed(6)})`;
  return `[out:json][timeout:25];(nwr["amenity"]["name"]${around};nwr["amenity"="parking"]${around};nwr["shop"]["name"]${around};`
    + `nwr["leisure"]["name"]${around};nwr["tourism"]["name"]${around};);out center tags;`;
}

export function poisFromOverpass(answer: unknown): Poi[] {
  const els = (answer as { elements?: Array<{ lat?: number; lon?: number; center?: { lat?: number; lon?: number }; tags?: Record<string, string> }> })?.elements;
  if (!Array.isArray(els)) return [];
  const out: Poi[] = [];
  for (const e of els) {
    const t = e.tags ?? {}, lat = e.lat ?? e.center?.lat, lon = e.lon ?? e.center?.lon;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const type = t.amenity || (t.shop ? 'shop' : t.leisure || t.tourism || '');
    const name = (t.name || (t.amenity === 'parking' ? 'Car park' : '')).trim().slice(0, 60);
    if (!name || !type) continue;
    out.push({ lat: lat!, lon: lon!, food: FOOD.has(t.amenity ?? ''), name, type: type.replace(/_/g, ' ') });
  }
  return out;
}

export interface Point { t: number; lat: number; lon: number; accuracyM: number | null }
export interface FoodStop { start: number; end: number; name: string | null; type: string; lat: number; lon: number }

const median = (v: number[]) => { const s = [...v].sort((a, b) => a - b); return s[s.length >> 1]; };

/** The food stops in one stay's points (in time order), against the map round it. */
export function foodStops(points: Point[], pois: Poi[]): FoodStop[] {
  const out: FoodStop[] = [];
  if (!pois.length) return out;
  let i = 0;
  while (i < points.length) {
    let j = i;
    while (j + 1 < points.length && points[j + 1].t - points[j].t <= MAX_GAP_MINS * MINUTE
      && metresBetween(points[i].lat, points[i].lon, points[j + 1].lat, points[j + 1].lon) <= STILL_M) j++;
    if (points[j].t - points[i].t >= STOP_MINS * MINUTE) {
      const seg = points.slice(i, j + 1);
      const lat = median(seg.map((p) => p.lat)), lon = median(seg.map((p) => p.lon));
      const acc = median(seg.map((p) => p.accuracyM ?? 99));
      const near = pois.map((p) => ({ p, d: metresBetween(lat, lon, p.lat, p.lon) })).sort((a, b) => a.d - b.d);
      if (acc <= 30 && near[0] && near[0].d <= NEAR_M && near[0].p.food) {
        const food = near.filter((x) => x.p.food);
        const sure = !food[1] || (food[1].d - food[0].d >= CLEAR_M && food[1].d >= food[0].d * CLEAR_RATIO);
        out.push({ start: seg[0].t, end: seg.at(-1)!.t, name: sure ? food[0].p.name : null, type: food[0].p.type, lat, lon });
      }
    }
    i = j + 1;
  }
  return out;
}
