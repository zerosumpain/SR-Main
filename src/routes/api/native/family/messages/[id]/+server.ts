import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { withNativeAccess } from '$lib/server/native-handler';
import { familyCaller, NOT_FAMILY } from '$lib/family/access.server';
import { deleteMessage } from '$lib/family/messages.server';

/**
 * DELETE /api/native/family/messages/:id — the sender takes back a message
 * (with its replies) or one of their replies (an emoji or a line). Anyone
 * else's is refused (403). Answers `{ deleted: true }`; one already gone 404s.
 * Family only, as the list.
 */
export const DELETE: RequestHandler = withNativeAccess('any', async (event, identity, role) => {
  const caller = await familyCaller(event, identity, role);
  if (!caller) return json({ error: NOT_FAMILY }, { status: 403 });
  const outcome = await deleteMessage(event.params.id, caller.email);
  if (outcome === 'gone') return json({ error: 'That message has gone.' }, { status: 404 });
  if (outcome === 'not-yours') return json({ error: 'Only the person who sent it can delete it.' }, { status: 403 });
  return { deleted: true };
});
