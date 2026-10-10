// sun.server.ts — the owner's sun for the landing sky, from Home Assistant's
// position.
//
// The position is rounded to the nearest half degree BEFORE the sun is worked
// out, and only the result leaves this module: an altitude in whole degrees and
// whether it is climbing (OwnerSun). Never a coordinate, a timezone or an
// offset. Read by the landing page's load and by /api/vitals/state, from the
// same rounding, so the two agree.

import { getVitalsLocation, isColdFallback, peekVitalsLocation, type VitalsLocation } from '$lib/vitals/location';
import { within } from './showcase-data';
import { roundCoord, sunFrom, type OwnerSun } from './sun';

/** How long the front door waits for the position before drawing the default sky. */
const BUDGET_MS = 400;

/**
 * The sun at a resolved location, or null for the cold-start default (Home
 * Assistant has never answered), so the page draws its old default sky rather
 * than London's light labelled as the owner's.
 */
export function sunAt(loc: VitalsLocation, now: number): OwnerSun | null {
  if (isColdFallback(loc)) return null;
  if (!Number.isFinite(loc.lat) || !Number.isFinite(loc.lon)) return null;
  const { alt, rising } = sunFrom(roundCoord(loc.lat), roundCoord(loc.lon), now);
  return { alt, rising };
}

/**
 * The owner's sun now, without holding the page up. The location module's
 * newest answer is used as it stands, even past its ten minutes (a position
 * moves slowly; the sun is still worked out for `now`), and an expired one is
 * refreshed in the background, through the module's one shared read.
 *
 * Only before Home Assistant has ever answered is there nothing to use. Then
 * a page that draws the sky (`wait`, the place view) waits for that first
 * read up to its budget; any other view answers null at once, and the vitals
 * stream brings the sun should the visitor switch to the place later. A read
 * that outruns the budget (or fails) answers null and the default sky is
 * drawn; it still lands in the cache for the next visitor.
 */
export async function ownerSun(
  now: Date = new Date(),
  {
    wait = false,
    peek = peekVitalsLocation,
    locate = getVitalsLocation,
  }: { wait?: boolean; peek?: () => VitalsLocation | null; locate?: () => Promise<VitalsLocation> } = {},
): Promise<OwnerSun | null> {
  try {
    const known = peek();
    if (known) return sunAt(known, now.getTime());
    if (!wait) return null;
    const loc = await within<VitalsLocation | null>(locate(), BUDGET_MS, null);
    return loc ? sunAt(loc, now.getTime()) : null;
  } catch {
    return null;
  }
}
