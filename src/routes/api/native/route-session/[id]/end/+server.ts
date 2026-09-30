import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { withNativeAccess } from '$lib/server/native-handler';
import { listMembers } from '$lib/home/presence/members';
import { endRouteSession, getRouteSession } from '$lib/home/presence/route-session';

/**
 * POST /api/native/route-session/[id]/end — `{ reason: 'finished' | 'stopped' }`
 * from the walker's phone. Followers' cards get their last word and the share
 * link stops answering at once.
 */
export const POST: RequestHandler = withNativeAccess('any', async ({ params, request }, identity) => {
  const s = await getRouteSession(params.id);
  if (!s || s.deviceId !== identity.id) return json({ error: 'No such walk.' }, { status: 404 });
  const body = ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  const reason = body.reason === 'finished' ? 'finished' : 'stopped';
  await endRouteSession(params.id, reason, { members: await listMembers() });
  return { ok: true };
});
