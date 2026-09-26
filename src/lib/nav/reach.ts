import { page } from '$app/state';

/**
 * The pages this viewer's permissions open — `navReach` from the root layout
 * (see `reachablePages` in $lib/access/catalogue). Empty for the owner (who
 * needs no list), a signed-out visitor, and outside a request, where it
 * answers "nothing" the way `currentIsOwner` answers "not the owner".
 *
 * Kept out of `page-path.ts` on purpose: that file is held byte for byte by
 * three extracted apps, none of which has members.
 */
export function currentReach(): readonly string[] {
  try {
    const reach = page.data?.navReach;
    return Array.isArray(reach) ? reach : [];
  } catch {
    return [];
  }
}
