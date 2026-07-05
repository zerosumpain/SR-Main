import type { LayoutServerLoad } from './$types';
import { requireProjectPublic } from '$lib/projects/guard';
import { isOwnerEmail } from '$lib/server/access';
import { getIntelSnapshot } from './lib/intel.server';
import type { IntelLayoutData } from './lib/intelTargets';

// The public landscape is gated by the per-project visibility toggle (public by default).
// The /workbench/** subtree adds its own owner-only guard. We also surface `authed` so the
// nav can reveal the private tabs to the signed-in owner, and the intelligence snapshot so
// every section page can show what newly arrived (there is no standalone radar page).
export const load: LayoutServerLoad = async (event) => {
  const { authedPrivate, viaShare } = await requireProjectPublic('dfe-data-strategy', event);
  const session = await event.locals.auth();
  // `authed` reveals the owner-only Author tabs — gate on owner, not just any
  // signed-in guest.
  const authed = isOwnerEmail(session?.user?.email);
  const noStore = authedPrivate || viaShare;
  event.setHeaders({
    'cache-control': noStore ? 'private, no-store' : 'public, max-age=0, s-maxage=600',
    ...(noStore ? { 'x-robots-tag': 'noindex' } : {}),
  });
  const snap = await getIntelSnapshot(); // cached 60s; never throws
  const intel: IntelLayoutData = { items: snap.items.slice(0, 40), lastRun: snap.lastRun };
  return { authed, intel };
};
