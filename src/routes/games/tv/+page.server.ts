import type { PageServerLoad } from './$types';
import { TV_COOKIE } from '$lib/games/party';
import { tvFromToken } from '$lib/games/tv-devices.server';
import { listMembers } from '$lib/home/presence/members';
import { approvedPacks } from '$lib/games/quiz-packs.server';

/**
 * /games/tv — sr. tv: the TV's games screen, opened by the Android TV app
 * (or the TV's own browser). Public (`/games` in PUBLIC_PATHS): a TV has no
 * login. Unlinked, it only shows a code for the owner to approve; linked (the
 * `sr_tv` cookie), it hosts a party. The family's first names come from the
 * members list here, at runtime, for the host's lines — never from source.
 */
export const load: PageServerLoad = async ({ cookies, setHeaders }) => {
  setHeaders({ 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow' });
  const tv = await tvFromToken(cookies.get(TV_COOKIE)).catch(() => null);
  if (!tv) return { linked: false as const };
  const family = tv
    ? await listMembers()
        .then((all) => all.map((m) => m.displayName?.split(' ')[0]).filter((n): n is string => !!n))
        .catch(() => [] as string[])
    : [];
  // Kelly's Quiz Night packs John has approved (titles only), for the menu's tile.
  const packs = await approvedPacks().catch(() => []);
  return { linked: true as const, tvName: tv.name, family: [...new Set(family)].slice(0, 12), packs };
};
