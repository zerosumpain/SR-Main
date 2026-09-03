import type { LayoutServerLoad } from './$types';
import { isOwnerRequest } from '$lib/server/owner';

/**
 * One thing, sitewide: is this the owner?
 *
 * The nav manifest marks owner-only destinations (`$lib/nav/site-nav`), and
 * without this every page would go on offering `/news`, `/drive`, `/live`,
 * `/jkai` and `/research` to signed-out readers — five cells that each 302
 * straight back to `/login`. That was live on `/`, `/blog/*`, `/projects`,
 * `/decks`, `/heart` and `/releases` before this load existed.
 *
 * It is a session read (`locals.auth()`) plus, in dev only, a private-address
 * check — no database work. Pages that already compute their own `isOwner` keep
 * doing so; this is for the chrome, which has no load of its own.
 */
export const load: LayoutServerLoad = async ({ locals, getClientAddress }) => {
  const isOwner = await isOwnerRequest({ locals, getClientAddress }).catch(() => false);
  return { isOwner };
};
