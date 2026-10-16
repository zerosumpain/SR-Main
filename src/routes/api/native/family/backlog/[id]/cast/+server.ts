import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { withNativeAccess } from '$lib/server/native-handler';
import { familyCaller } from '$lib/family/access.server';
import { NOT_FAMILY } from '$lib/family/backlog';
import { getItem } from '$lib/family/backlog.server';
import { prepareCast } from '$lib/family/backlog-cast.server';

/**
 * POST /api/native/family/backlog/[id]/cast — get this item ready for the TV.
 *
 * Answers `ready` (a link the TV can play for six hours, no login needed),
 * `preparing` (the server is fetching it; ask again after `retryAfterSeconds`)
 * or `fallback` (play it from the phone: `mirror`, or `youtube_app`, which
 * casts by itself). Asking again is always safe: it joins the fetch already
 * running rather than starting another. POST, not GET, because it can start
 * a download — and the native gate keeps view-as away from anything but reads.
 */
export const POST: RequestHandler = withNativeAccess('any', async (event, identity, role) => {
  const caller = await familyCaller(event, identity, role);
  if (!caller) return json({ error: NOT_FAMILY }, { status: 403 });
  const item = await getItem(event.params.id);
  if (!item) return json({ error: 'No such item.' }, { status: 404 });
  return prepareCast(item, event.url.origin);
});
