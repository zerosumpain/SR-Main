import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { withNativeAccess } from '$lib/server/native-handler';
import { familyCaller } from '$lib/family/access.server';
import { NOT_FAMILY } from '$lib/family/backlog';
import { setDigest } from '$lib/family/backlog.server';

/**
 * PUT /api/native/family/backlog/digest — `{ on }`: the caller's evening
 * round-up of what others added to the backlog (7pm London, once a day,
 * nothing on a quiet day). Off until they turn it on. Answers `{ digest }`.
 */
export const PUT: RequestHandler = withNativeAccess('any', async (event, identity, role) => {
  const caller = await familyCaller(event, identity, role);
  if (!caller) return json({ error: NOT_FAMILY }, { status: 403 });
  const body = (await event.request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body.on !== 'boolean') return json({ error: 'Send { on: true } or { on: false }.' }, { status: 400 });
  await setDigest(caller.email, body.on);
  return { digest: body.on };
});
