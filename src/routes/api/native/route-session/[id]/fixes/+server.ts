import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { withNativeAccess } from '$lib/server/native-handler';
import { listMembers } from '$lib/home/presence/members';
import { recordRouteFixes } from '$lib/home/presence/route-session';

/**
 * POST /api/native/route-session/[id]/fixes — `{ fixes: [{lat,lng,t}], progress }`
 * from the WALKER's phone only (the device that started it). Fixes queued with
 * no signal arrive late and in a batch; each carries its own time. Answers
 * `ended: true` once the session is over, which tells the phone to stop.
 */
export const POST: RequestHandler = withNativeAccess('any', async ({ params, request }, identity) => {
  const body = await request.json().catch(() => null);
  const result = await recordRouteFixes(params.id, identity.id, body, await listMembers());
  if ('error' in result) return json({ error: result.error }, { status: result.status });
  return result;
});
