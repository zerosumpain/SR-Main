import type { LayoutServerLoad } from './$types';
import { isOwnerRequest } from '$lib/server/owner';
import { reachablePages } from '$lib/access/catalogue';
import { viewerOf } from '$lib/server/viewer';

/**
 * One thing, sitewide: is this the owner?
 *
 * The nav manifest marks owner-only destinations (`$lib/nav/site-nav`), and
 * without this every page would go on offering `/news`, `/drive`,
 * `/jkai` and `/research` to signed-out readers — five cells that each 302
 * straight back to `/login`. That was live on `/`, `/blog/*`, `/projects`,
 * `/decks` and `/releases` before this load existed.
 *
 * It is a session read (`locals.auth()`) plus, in dev only, a private-address
 * check — no database work. Pages that already compute their own `isOwner` keep
 * doing so; this is for the chrome, which has no load of its own.
 */
export const load: LayoutServerLoad = async (event) => {
  const { locals, getClientAddress } = event;
  const isOwner = await isOwnerRequest({ locals, getClientAddress }).catch(() => false);
  // While the owner views the site as someone else, the chrome says so on every
  // page ($lib/server/view-as). Only ever set for the owner's own session.
  const viewingAs = locals.viewingAs ? { email: locals.viewingAs.email, kind: locals.viewingAs.kind } : null;
  return { isOwner, navReach: isOwner ? [] : await memberReach(event), viewingAs };
};

/**
 * The pages a member's permissions open, so the nav offers them (and only
 * them). One lookup, for a signed-in non-owner only — the owner and signed-out
 * visitors cost nothing more than before. A lookup that fails offers nothing.
 */
async function memberReach(event: Parameters<LayoutServerLoad>[0]): Promise<string[]> {
  try {
    const viewer = await viewerOf(event);
    return viewer.kind === 'member' ? reachablePages(viewer.grants) : [];
  } catch {
    return [];
  }
}
