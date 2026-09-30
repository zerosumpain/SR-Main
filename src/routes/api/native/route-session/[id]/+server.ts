import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { withNativeAccess } from '$lib/server/native-handler';
import { listMembers } from '$lib/home/presence/members';
import { journeyAccess } from '$lib/home/presence/live-journey';
import { isOwnerEmail } from '$lib/server/access';
import { getRouteSession, viewOf } from '$lib/home/presence/route-session';

/**
 * GET /api/native/route-session/[id] — one walk, for the follower's map: the
 * route, where they have been, and the walker's phone's reading. The walker,
 * the owner, and the people who follow the walker; nobody else, and the same
 * 404 for "not yours" as for "not there".
 */
export const GET: RequestHandler = withNativeAccess('any', async ({ params }, identity) => {
  const s = await getRouteSession(params.id);
  const email = identity.ownerEmail.trim().toLowerCase();
  const allowed = s && (s.walkerEmail === email || isOwnerEmail(email) || (await journeyAccess(s.subject, email)));
  if (!s || !allowed) return json({ error: 'No such walk.' }, { status: 404 });
  return viewOf(s, await listMembers());
});
