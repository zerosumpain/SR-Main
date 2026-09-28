import { metresBetween } from './cluster';
export interface PlaceLookup {
  label: string; address: string; kind: string; provider: string; precision: 'venue' | 'address' | 'street' | 'area';
}
const clean = (v: unknown, max = 300): string => typeof v === 'string' ? v.trim().slice(0, max) : '';
/** Require a nearby result. A remote centroid is not a confident building match. */
export function parseMapbox(value: unknown, lat: number, lon: number): PlaceLookup | null {
  const data = value as { features?: Array<{ properties?: Record<string, any>; geometry?: { coordinates?: number[] } }> };
  if (!Array.isArray(data?.features)) return null;
  for (const f of data.features) {
    const p = f.properties ?? {}, coords = f.geometry?.coordinates;
    if (!coords || coords.length < 2 || !coords.every(Number.isFinite)) continue;
    const type = p.feature_type;
    const distance = metresBetween(lat, lon, coords[1], coords[0]);
    if (!['address', 'street', 'place', 'locality', 'neighborhood'].includes(type) || distance > (type === 'address' ? 200 : type === 'street' ? 500 : 5000)) continue;
    const label = clean(p.name, 60), address = clean(p.full_address || [p.name, p.place_formatted].filter(Boolean).join(', '));
    if (!label) continue;
    return { label, address, kind: 'other', provider: 'Mapbox', precision: type === 'address' ? 'address' : type === 'street' ? 'street' : 'area' };
  }
  return null;
}
export function parseNominatim(value: unknown, lat: number, lon: number): PlaceLookup | null {
  const p = value as Record<string, any>;
  if (!p || !Number.isFinite(Number(p.lat)) || !Number.isFinite(Number(p.lon))) return null;
  const d = metresBetween(lat, lon, Number(p.lat), Number(p.lon));
  if (d > 500) return null;
  const a = p.address ?? {};
  const category = clean(p.type);
  const venue = ['school', 'college', 'university', 'cafe', 'restaurant', 'supermarket', 'fitness_centre'].includes(category) || p.category === 'shop';
  const road = clean(a.road || a.pedestrian || a.footway);
  const label = clean(venue && d <= 150 ? p.name : [a.house_number, road].filter(Boolean).join(' ') || a.village || a.town || a.city, 60);
  if (!label) return null;
  const kind = ['school', 'college', 'university'].includes(category) ? 'school' : category === 'cafe' || category === 'restaurant' ? 'cafe'
    : p.category === 'shop' || category === 'supermarket' ? 'shop' : category === 'fitness_centre' ? 'gym' : 'other';
  return { label, address: clean(p.display_name), kind: venue && d <= 150 ? kind : 'other', provider: 'OpenStreetMap',
    precision: venue && d <= 150 ? 'venue' : a.house_number ? 'address' : road ? 'street' : 'area' };
}
