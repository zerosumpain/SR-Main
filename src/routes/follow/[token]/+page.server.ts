import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { listMembers } from '$lib/home/presence/members';
import { firstName, sharedRouteSession } from '$lib/home/presence/route-session';

/**
 * /follow/<token> — somebody walking a route, for a person without the app.
 *
 * Public by design (`/follow` in PUBLIC_PATHS): the token IS the permission —
 * 256 bits, stored hashed, minted only when the walker asked for a link, and
 * dead the moment the walk ends or six hours pass. Unknown, ended and expired
 * all 404 alike. What it shows is the least that answers "where are they on
 * the route": the line, the latest position, how far along, and a first name.
 * Never the trail — a forwarded link should not say where the walk began.
 */
export const load: PageServerLoad = async ({ params, setHeaders }) => {
  setHeaders({ 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow' });
  const shared = await sharedRouteSession(params.token);
  if (!shared) throw error(404, 'This link has ended.');
  const { session: s, last } = shared;
  const members = await listMembers().catch(() => []);
  const name = members.find((m) => m.subject === s.subject)?.displayName ?? 'They';
  const p = (s.progress ?? null) as { alongM?: number; remainingM?: number; offRoute?: boolean; offRouteM?: number; timeLeftS?: number | null } | null;
  return {
    name: firstName(name),
    routeName: s.routeName,
    sport: s.sport,
    route: s.route,
    position: last ? ([last[0], last[1]] as [number, number]) : null,
    totalM: s.totalM,
    alongM: p?.alongM ?? null,
    remainingM: p?.remainingM ?? null,
    offRoute: p?.offRoute === true,
    offRouteM: p?.offRouteM ?? null,
    timeLeftS: p?.timeLeftS ?? null,
    lastFixAt: s.lastFixAt?.toISOString() ?? null,
  };
};
