// src/lib/tools/tools/location-scrub.ts
//
// The second wall behind the family and games chat tools (workflow knit
// 2026-11-11, slice 3). The rule it holds: no chat tool returns another
// person's coordinates, live position, trail or address. Each tool already
// picks its fields by name; this walks whatever it is about to return and
// drops every key that names a position, so a field added to a service row
// later cannot ride out through a spread. Pure.

/** Keys that carry where somebody is, was, or lives. Compared lower-cased, without `_` or `-`. */
const LOCATION_KEYS = new Set([
  'lat', 'lon', 'lng', 'latitude', 'longitude', 'coord', 'coords', 'coordinate', 'coordinates',
  'position', 'positions', 'location', 'locations', 'livelocation', 'lastlocation', 'address', 'addresses',
  'suggestedaddress', 'postcode', 'polygon', 'polygons', 'polyline', 'bounds', 'bbox', 'focus', 'geometry',
  'geojson', 'geo', 'accuracy', 'heading', 'bearing', 'altitude', 'trail', 'trails', 'route', 'shape',
  'radiusm', 'place', 'places', 'hexids', 'centre', 'center', 'email', 'fromemail', 'cancelledbyemail',
]);

/** A longer key ending in one of these is a position too: `homeAddress`, `lastLatitude`. */
const LOCATION_SUFFIX = /(?:address|latitude|longitude|coordinates|coords|postcode|(?<!al)location)$/;

export function isLocationKey(key: string): boolean {
  const k = key.toLowerCase().replace(/[_-]/g, '');
  return LOCATION_KEYS.has(k) || LOCATION_SUFFIX.test(k);
}

export interface ScrubOptions {
  /** Longest array kept; the rest is dropped. Default 40. */
  maxItems?: number;
  /** Longest string kept. Default 600. */
  maxChars?: number;
  /** Deepest nesting kept. Default 6. */
  maxDepth?: number;
}

/** `value` without any location-bearing key, with arrays, strings and depth capped. */
export function scrubLocation<T>(value: T, opts: ScrubOptions = {}, depth = 0): T {
  const maxItems = opts.maxItems ?? 40;
  const maxChars = opts.maxChars ?? 600;
  const maxDepth = opts.maxDepth ?? 6;
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return (value.length > maxChars ? `${value.slice(0, maxChars)}…` : value) as T;
  if (typeof value !== 'object') return value;
  if (value instanceof Date) return value.toISOString() as T;
  if (depth >= maxDepth) return undefined as T;
  if (Array.isArray(value)) {
    return value.slice(0, maxItems).map((v) => scrubLocation(v, opts, depth + 1)).filter((v) => v !== undefined) as T;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (isLocationKey(k)) continue;
    const next = scrubLocation(v, opts, depth + 1);
    if (next !== undefined) out[k] = next;
  }
  return out as T;
}
