import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { withNativeAccess } from '$lib/server/native-handler';
import { familyCaller } from '$lib/family/access.server';
import { familyId } from '$lib/family/roster.server';
import { NOT_FAMILY, parseReaction, toWire } from '$lib/family/backlog';
import { getItem, loadReactions, notifyReaction, setReaction } from '$lib/family/backlog.server';

/**
 * POST /api/native/family/backlog/[id]/reaction — `{ emoji }`, one of msg
 * family's quick set, or `{ emoji: null }` to take yours back. One per person
 * per item; a new one replaces the old. Whoever shared it is pushed when the
 * emoji is new or different, never for their own. Answers the item.
 */
export const POST: RequestHandler = withNativeAccess('any', async (event, identity, role) => {
  const caller = await familyCaller(event, identity, role);
  if (!caller) return json({ error: NOT_FAMILY }, { status: 403 });
  const emoji = parseReaction(await event.request.json().catch(() => null));
  if (!emoji.ok) return json({ error: emoji.error }, { status: emoji.status });
  const item = await getItem(event.params.id);
  if (!item) return json({ error: 'No such item.' }, { status: 404 });
  const changed = await setReaction(item.id, caller.email, emoji.value);
  if (changed && emoji.value) void notifyReaction(item, caller.email, emoji.value);
  return { item: toWire(item, familyId, await loadReactions([item.id])) };
});
