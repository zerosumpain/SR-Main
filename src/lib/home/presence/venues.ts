// src/lib/home/presence/venues.ts
//
// The cafés, restaurants, pubs and shops inside a big place. A place the
// owner drew round a whole town centre ("Town", 200 m) swallows every stop in
// it: a lunch at Café W and an hour in Waterstones are both "Town", so the
// patterns page saw almost no eating out and no shop by name. This reads the
// stops inside a big place off the trail — still within 40 m, fifteen
// minutes for a meal, ten for a shop — and files one as a food or shop stop
// by the nearest named thing on the map. The map is OpenStreetMap's, fetched
// once per big place (`venues.server.ts`). PURE.
//
// A town centre is dense — 67 food places and 187 shops inside Darlington's
// 230 m — and a phone indoors is good to about 15 m. So a stop is filed only
// when the nearest named thing within 20 m is that kind (a car park nearer
// wins: the stop was parking), and it carries a venue's NAME only when that
// venue is clearly the nearest of its kind: the next is at least six metres
// and half as far again further off. A place that is itself one shop (the
// owner's "H. Samuel") never has shops split out of it.

import { metresBetween } from './cluster';
import type { Category } from './patterns';

/** `type` is the map's own: "cafe", "fast food", "clothes". `shop` marks a shop (maps kept before it was added say `type: 'shop'`). */
export interface Poi { lat: number; lon: number; food: boolean; shop?: boolean; name: string; type: string }

const isShop = (p: Poi) => !!p.shop || p.type === 'shop';

/** Big enough to hold several businesses; a house or a single shop is never split. */
export const SPLIT_MIN_RADIUS_M = 150;
const FOOD = new Set(['restaurant', 'cafe', 'pub', 'bar', 'fast_food', 'food_court', 'ice_cream', 'biergarten']);
const STILL_M = 40;
const FOOD_MINS = 15;
const SHOP_MINS = 10;
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
    const type = t.amenity || t.shop || t.leisure || t.tourism || '';
    const name = (t.name || (t.amenity === 'parking' ? 'Car park' : '')).trim().slice(0, 60);
    if (!name || !type) continue;
    const shop = !t.amenity && !!t.shop;
    out.push({ lat: lat!, lon: lon!, food: FOOD.has(t.amenity ?? ''), ...(shop ? { shop: true } : {}), name, type: type.replace(/_/g, ' ') });
  }
  return out;
}

export interface Point { t: number; lat: number; lon: number; accuracyM: number | null }
export interface VenueStop { start: number; end: number; kind: 'food' | 'shop'; category: Category; name: string | null; type: string; lat: number; lon: number }

/** "clothes" → "Clothes shop"; the trades that are not shops say what they are. */
const SHOP_WORDS: Record<string, [string, Category]> = {
  shop: ['Shop', 'shops'], supermarket: ['Supermarket', 'shops'], convenience: ['Convenience store', 'shops'],
  department_store: ['Department store', 'shops'], 'department store': ['Department store', 'shops'], mall: ['Shopping centre', 'shops'],
  bakery: ['Bakery', 'shops'], butcher: ['Butcher', 'shops'], jewelry: ['Jeweller', 'shops'], charity: ['Charity shop', 'shops'],
  hairdresser: ['Hairdresser', 'services'], beauty: ['Beauty salon', 'services'], 'dry cleaning': ['Dry cleaner', 'services'],
  optician: ['Optician', 'health'], chemist: ['Chemist', 'health'], 'mobile phone': ['Phone shop', 'shops'],
  florist: ['Florist', 'shops'], greengrocer: ['Greengrocer', 'shops'], newsagent: ['Newsagent', 'shops'], books: ['Bookshop', 'shops'],
  toys: ['Toy shop', 'shops'], shoes: ['Shoe shop', 'shops'], wigs: ['Wig shop', 'shops'], tobacco: ['Tobacconist', 'shops'],
  variety_store: ['Variety store', 'shops'], 'variety store': ['Variety store', 'shops'], stationery: ['Stationer', 'shops'],
};
export function shopKind(type: string): [string, Category] {
  const known = SHOP_WORDS[type];
  if (known) return known;
  const t = type.charAt(0).toUpperCase() + type.slice(1);
  return [/shop$/i.test(t) ? t : `${t} shop`, 'shops'];
}
const FOOD_WORDS: Record<string, string> = { cafe: 'Café', restaurant: 'Restaurant', pub: 'Pub', bar: 'Bar', 'fast food': 'Takeaway', 'food court': 'Food court', 'ice cream': 'Ice cream', biergarten: 'Beer garden' };

const median = (v: number[]) => { const s = [...v].sort((a, b) => a - b); return s[s.length >> 1]; };

/** A place the owner named after one shop on its map is that shop: never split into its neighbours. */
export function isOneShop(label: string | null | undefined, pois: Poi[]): boolean {
  const own = (label ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return own.length >= 3 && pois.some((p) => isShop(p) && p.name.toLowerCase().replace(/[^a-z0-9]/g, '') === own);
}

/** The food and shop stops in one stay's points (in time order), against the map round it. */
export function venueStops(points: Point[], pois: Poi[], opts: { shops?: boolean } = {}): VenueStop[] {
  const out: VenueStop[] = [];
  if (!pois.length) return out;
  const shops = opts.shops !== false;
  let i = 0;
  while (i < points.length) {
    let j = i;
    while (j + 1 < points.length && points[j + 1].t - points[j].t <= MAX_GAP_MINS * MINUTE
      && metresBetween(points[i].lat, points[i].lon, points[j + 1].lat, points[j + 1].lon) <= STILL_M) j++;
    const mins = (points[j].t - points[i].t) / MINUTE;
    if (mins >= Math.min(FOOD_MINS, SHOP_MINS)) {
      const seg = points.slice(i, j + 1);
      const lat = median(seg.map((p) => p.lat)), lon = median(seg.map((p) => p.lon));
      const acc = median(seg.map((p) => p.accuracyM ?? 99));
      const near = pois.map((p) => ({ p, d: metresBetween(lat, lon, p.lat, p.lon) })).sort((a, b) => a.d - b.d);
      const first = near[0];
      const kind = !first || acc > 30 || first.d > NEAR_M ? null
        : first.p.food && mins >= FOOD_MINS ? 'food' : shops && isShop(first.p) && mins >= SHOP_MINS ? 'shop' : null;
      if (kind) {
        const same = near.filter((x) => (kind === 'food' ? x.p.food : isShop(x.p)));
        const sure = !same[1] || (same[1].d - same[0].d >= CLEAR_M && same[1].d >= same[0].d * CLEAR_RATIO);
        const [label, category] = kind === 'food' ? [FOOD_WORDS[same[0].p.type] ?? 'Café', 'food' as Category] : shopKind(same[0].p.type);
        // Unsure which: the kind of the nearest still says what it was, but not which one.
        out.push({ start: seg[0].t, end: seg.at(-1)!.t, kind, category: sure ? category : kind === 'food' ? 'food' : 'shops',
          name: sure ? same[0].p.name : null, type: sure ? label : 'several close by, not sure which', lat, lon });
      }
    }
    i = j + 1;
  }
  return out;
}
