// sun.ts — where the sun stands for the owner just now, as the place view's sky
// needs it: an altitude in whole degrees and whether it is climbing.
//
// The server works this out from Home Assistant's position, rounded to the
// nearest half degree first (sun.server.ts), and sends the browser these two
// numbers and nothing else: never a latitude, a longitude, a timezone or an
// offset. The town in the dateline stays the only place the page names.
//
// Pure and client-safe: the browser uses sunAltitude() for the old default
// sky (the north of England) when the server has no position to give.

const DAY_MS = 86_400_000;
/** How far ahead "rising" looks. */
const RISE_LOOKAHEAD_MS = 10 * 60_000;

/** The sun for the owner, as the client receives it. */
export interface OwnerSun {
  /** Altitude above the horizon in whole degrees (negative below it). */
  alt: number;
  /** True while the sun climbs (morning), false while it sinks (afternoon). */
  rising: boolean;
}

/**
 * The sun's altitude in degrees for an instant, by default over the north of
 * England (about 54.5°N, 1.5°W). Low-precision solar position, good to a
 * fraction of a degree, which is all a sky colour needs.
 */
export function sunAltitude(ms: number, lat = 54.5, lon = -1.5): number {
  const rad = Math.PI / 180;
  const d = ms / DAY_MS - 10957.5; // days from J2000
  const g = (357.529 + 0.98560028 * d) * rad;
  const q = 280.459 + 0.98564736 * d;
  const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * rad;
  const e = (23.439 - 3.6e-7 * d) * rad;
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L));
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const gmst = (((18.697374558 + 24.06570982441908 * d) % 24) + 24) % 24;
  const ha = (gmst * 15 + lon) * rad - ra;
  const la = lat * rad;
  return Math.asin(Math.sin(la) * Math.sin(dec) + Math.cos(la) * Math.cos(dec) * Math.cos(ha)) / rad;
}

/** A coordinate to the nearest half degree (about 55 km of latitude): enough for the light, too coarse for a street. */
export function roundCoord(x: number): number {
  // + 0 turns -0 into 0, so a rounded value never carries a stray sign.
  return Math.round(x * 2) / 2 + 0;
}

/** The sun at a place and instant: whole degrees, and whether it is climbing. */
export function sunFrom(lat: number, lon: number, ms: number): OwnerSun {
  const now = sunAltitude(ms, lat, lon);
  const later = sunAltitude(ms + RISE_LOOKAHEAD_MS, lat, lon);
  return { alt: Math.round(now) + 0, rising: later > now };
}

/**
 * What the sky is drawn from: the owner's sun when the server sent one, or
 * the old default (the north of England just now, and the London morning
 * picking dawn over dusk) when it did not.
 */
export function skyLight(sun: OwnerSun | null | undefined, now: number, londonMorning: boolean): { alt: number; morning: boolean } {
  return sun ? { alt: sun.alt, morning: sun.rising } : { alt: sunAltitude(now), morning: londonMorning };
}

/**
 * Dev-only: `?sun=<degrees>&rising=<0|1>` pins the sun so screenshots hold
 * still. Null unless `dev` is true and `sun` is a number from -90 to 90, so a
 * production page never reads the address for it.
 */
export function sunOverride(params: URLSearchParams, dev: boolean): OwnerSun | null {
  if (!dev) return null;
  const raw = params.get('sun');
  if (raw == null || raw.trim() === '') return null;
  const alt = Number(raw);
  if (!Number.isFinite(alt) || alt < -90 || alt > 90) return null;
  const r = params.get('rising');
  return { alt: Math.round(alt) + 0, rising: r === '1' || r === 'true' };
}
