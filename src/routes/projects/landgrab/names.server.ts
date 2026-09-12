// Naming a patch of ground: the household's own places first, the geocoder
// second.
//
// SERVER ONLY, and nothing runs at import time — `db` and the geocoder are only
// touched inside `nameFor`, so the page's guard test can import the load
// function with `$lib/db` mocked to `{}`.

import { and, eq, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { daydreamPlaces } from '$lib/db/schema';
import { suggestPlaceName } from '$lib/daydream/geocode';

/** A confirmed place names ground within this many metres, unless its own
 *  clustered radius is wider. A cell is 44 m; a battleground is a clump. */
const PLACE_RADIUS_M = 250;

/**
 * `budget.uncached` is decremented per UNCACHED geocoder call; at zero the name
 * is null and the page prints coordinates. Nominatim is one request a second
 * and a page load must not queue behind it. A cache hit costs one indexed read,
 * so it is refunded — the second load of a page names everything it named the
 * first time without spending anything.
 */
export async function nameFor(
  centre: [number, number],
  budget: { uncached: number },
): Promise<string | null> {
  const [lat, lon] = centre;
  try {
    // A coarse degree box first so the scan is bounded, then the real
    // cos-corrected distance. 0.01 lat / 0.02 lon is ~1.1 km either way at
    // 54.5N, comfortably wider than any place radius this compares against.
    const rows = await db
      .select({
        label: daydreamPlaces.label,
        lat: daydreamPlaces.lat,
        lon: daydreamPlaces.lon,
        radiusM: daydreamPlaces.radiusM,
      })
      .from(daydreamPlaces)
      .where(
        and(
          eq(daydreamPlaces.status, 'active'),
          sql`${daydreamPlaces.label} is not null`,
          sql`abs(${daydreamPlaces.lat} - ${lat}) < 0.01`,
          sql`abs(${daydreamPlaces.lon} - ${lon}) < 0.02`,
        ),
      );
    let best: { label: string; d: number } | null = null;
    for (const r of rows) {
      if (!r.label) continue;
      const d = Math.hypot(
        (r.lat - lat) * 111_195,
        (r.lon - lon) * 111_195 * Math.cos((lat * Math.PI) / 180),
      );
      if (d <= Math.max(PLACE_RADIUS_M, r.radiusM) && (!best || d < best.d)) {
        best = { label: r.label, d };
      }
    }
    if (best) return best.label;
  } catch {
    /* naming never blocks the page */
  }

  if (budget.uncached <= 0) return null;
  budget.uncached -= 1;
  try {
    const s = await suggestPlaceName(lat, lon);
    // The budget exists to ration NETWORK calls. `suggestPlaceName` caches its
    // own answers, so a hit cost nothing and the spend is refunded — otherwise
    // a page with a dozen named battlegrounds would go quiet after three of
    // them for ever, even once every name was already on disk.
    if (s.source === 'cache') budget.uncached += 1;
    return s.name ?? (s.address ? s.address.split(',')[0].trim() : null);
  } catch {
    return null;
  }
}
