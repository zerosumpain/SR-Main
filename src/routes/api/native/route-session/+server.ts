import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { withNativeAccess } from '$lib/server/native-handler';
import { listMembers } from '$lib/home/presence/members';
import { journeyAccess } from '$lib/home/presence/live-journey';
import { isOwnerEmail } from '$lib/server/access';
import { openRouteSessions, readRouteLine, startRouteSession, viewOf } from '$lib/home/presence/route-session';

const SPORTS = new Set(['run', 'trail_run', 'walk', 'hike', 'ride', 'mtb']);

/**
 * POST /api/native/route-session — "Track me live": start sharing a route
 * walk with the family (and, with `share: true`, mint a link for somebody
 * without the app — returned once, stored only as a hash).
 *
 * GET /api/native/route-session — the walks this phone may follow now.
 *
 * Owner or member: whoever walks is followed by the people who follow them for
 * departures, under the same consent (`journeyAccess`).
 */
export const POST: RequestHandler = withNativeAccess('any', async ({ request, url }, identity) => {
  const b = ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  const route = readRouteLine(b.route);
  if (!route) return json({ error: 'That route has no line to follow.' }, { status: 400 });
  const sport = typeof b.sport === 'string' && SPORTS.has(b.sport) ? b.sport : null;
  if (!sport) return json({ error: 'Pick a sport.' }, { status: 400 });
  const totalM = typeof b.totalM === 'number' && Number.isFinite(b.totalM) && b.totalM > 0 ? b.totalM : null;
  if (!totalM) return json({ error: 'That route has no length.' }, { status: 400 });
  const routeName = typeof b.routeName === 'string' && b.routeName.trim() ? b.routeName.trim().slice(0, 120) : 'A route';

  const members = await listMembers();
  const started = await startRouteSession(
    {
      walkerEmail: identity.ownerEmail,
      deviceId: identity.id,
      routeId: typeof b.routeId === 'string' ? b.routeId.slice(0, 64) : null,
      routeName,
      sport,
      route,
      totalM,
      share: b.share === true,
    },
    members,
  );
  if ('error' in started) return json({ error: started.error }, { status: 403 });
  return json(
    {
      id: started.id,
      followers: started.followers,
      shareUrl: started.shareToken ? `${url.origin}/follow/${started.shareToken}` : null,
    },
    { status: 201 },
  );
});

export const GET: RequestHandler = withNativeAccess('any', async (_event, identity) => {
  const email = identity.ownerEmail.trim().toLowerCase();
  const members = await listMembers();
  const open = await openRouteSessions();
  const mine: ReturnType<typeof viewOf>[] = [];
  for (const s of open) {
    const allowed = s.walkerEmail === email || isOwnerEmail(email) || (await journeyAccess(s.subject, email));
    if (!allowed) continue;
    // The list is a list: no trail, and the route only as its ends.
    const v = viewOf(s, members);
    mine.push({ ...v, trail: [], route: [v.route[0], v.route[v.route.length - 1]] });
  }
  return { sessions: mine };
});
