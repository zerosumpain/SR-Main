import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { withNativeAccess } from '$lib/server/native-handler';
import { familyCaller, NOT_FAMILY } from '$lib/family/access.server';
import { familyId } from '$lib/family/roster.server';
import { parseBody, replyView } from '$lib/family/messages';
import { getMessage, replyToMessage } from '$lib/family/messages.server';

/**
 * POST /api/native/family/messages/:id/replies — `{ body }`: an emoji from the
 * quick replies or a line of text, from the app or straight from the
 * notification. Stored under the message and pushed to its sender only.
 * Answers `{ reply, pushed }`. A reply to a reply is refused: replies hang off
 * the message. Family only, as the list.
 */
export const POST: RequestHandler = withNativeAccess('any', async (event, identity, role) => {
  const caller = await familyCaller(event, identity, role);
  if (!caller) return json({ error: NOT_FAMILY }, { status: 403 });
  const message = await getMessage(event.params.id);
  if (!message || message.replyTo) return json({ error: 'That message has gone.' }, { status: 404 });
  const input = parseBody(await event.request.json().catch(() => null));
  if ('error' in input) return json({ error: input.error }, { status: 400 });
  const { reply, pushed } = await replyToMessage(message, caller.email, caller.parent, input.body);
  return json({ reply: replyView(reply, familyId, () => true), pushed }, { status: 201 });
});
