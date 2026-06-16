import type { LayoutServerLoad } from './$types';
import { requireProjectPublic } from '$lib/projects/guard';

// The public landscape is gated by the per-project visibility toggle (public by default).
// The /workbench/** subtree adds its own owner-only guard. We also surface `authed` so the
// nav can reveal the private workbench tabs to the signed-in owner.
export const load: LayoutServerLoad = async (event) => {
  const { authedPrivate, viaShare } = await requireProjectPublic('dfe-data-strategy', event);
  const session = await event.locals.auth();
  const authed = !!session?.user;
  const noStore = authedPrivate || viaShare;
  event.setHeaders({
    'cache-control': noStore ? 'private, no-store' : 'public, max-age=0, s-maxage=600',
    ...(noStore ? { 'x-robots-tag': 'noindex' } : {}),
  });
  return { authed };
};
